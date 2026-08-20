// Decide Lease (ERP Lease) - grant, QUEUE, or release the one-audit-at-a-time lease.
//
// WHY A LEASE EXISTS. Per-flow pacing bounds ONE flow to 4 req/s. It says nothing about two
// flows. VALIDATION.md section 19 records two audits crashing in the same n8n instance within
// ten minutes, and at the settings of the time that was 60 req/s arriving at ERP from a system
// that believed it was being careful. Every per-flow limit is multiplied by however many audits
// are running, so the count has to be bounded somewhere, and the only place that can see across
// flows is shared state.
//
// WHY IT QUEUES RATHER THAN REFUSES. The first version threw at a held lease, which is correct
// but useless: the honest response to "someone else is using ERP" is to wait, not to make a
// person notice and re-fire by hand twenty minutes later. So a blocked run now takes a ticket
// and polls. What it CANNOT do is wait for ever, and pretending otherwise would hide the
// failure rather than remove it - see THE WAIT IS BOUNDED below.
//
// WHY A TICKET AND NOT JUST A RETRY. Polling alone is not a queue. Without a ticket, whoever
// happens to poll in the instant after a release wins, so a run that has waited twenty minutes
// can lose to one that arrived a second ago, repeatedly. The ticket records WHEN each run
// started waiting, and the lease is only granted to the head of the queue - which is the whole
// difference between "retries" and "queues".
//
// THE THREE WAYS A LEASE GOES WRONG, all handled below rather than discovered later:
//   1. a run crashes holding it, and every later audit is blocked for ever
//      -> a lease older than STALE_AFTER_MS may be taken BY THE HEAD OF THE QUEUE, and the
//         takeover is logged
//   2. someone needs to override it right now, at 2am, with no idea why it is stuck
//      -> params.ignore_erp_lease, logged loudly and carried into the run record
//   3. a run releases someone ELSE'S lease and two audits proceed believing they are alone
//      -> release only ever frees a lease this run_id actually holds
//
// AND THE FOURTH, WHICH THE QUEUE ADDS:
//   4. a queued run dies while waiting, and its ticket blocks the queue for ever
//      -> a ticket whose last_seen_ms has gone quiet for TICKET_STALE_MS is ignored for
//         ordering. Every poll refreshes last_seen_ms, so a live waiter keeps its place and a
//         dead one loses it without anybody cleaning up by hand.
//
// It is a COOPERATIVE lease, not a mutex. Nothing physically stops a flow that skips this check
// from calling ERP; what it stops is two flows that both use it colliding by accident. That is
// the honest description and it is the right one for the problem - the failure mode was never
// malice, it was two people starting audits ten minutes apart.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;   // ERP-LOAD-POLICY.md section 4
const TICKET_STALE_MS = 3 * 60 * 1000;       // 3 missed polls at the 60s poll interval
const DEFAULT_MAX_WAIT_MS = 20 * 60 * 1000;  // how long a run will queue before giving up

const req = $('Read Lease Request').first().json;
const mode = req.mode;
const runId = req.run_id;
const checkId = req.check_id;
const ignore = req.ignore_lease === true;

const askedWait = Number(req.max_wait_ms);
const maxWaitMs = Number.isFinite(askedWait) && askedWait >= 0 ? askedWait : DEFAULT_MAX_WAIT_MS;

// The Data Table returns zero rows when the lease has never been taken, which is a normal
// first-run state and not an error.
const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && r.lease_key === 'erp'; });
const row = rows[0] || null;

const nowMs = Date.now();
const nowIso = new Date().toISOString();

// ---- THE QUEUE ---------------------------------------------------------------------------
const tickets = (function () {
  try { return $('Get Queue').all().map(function (i) { return i.json; }); } catch (e) { return []; }
})().filter(function (t) { return t && t.ticket_key; });

const mine = tickets.filter(function (t) { return String(t.ticket_key) === String(runId); })[0] || null;
// A ticket keeps the time this run FIRST asked, across every poll. Re-stamping it each time
// would send a waiting run to the back of its own queue on every tick, which is a starvation
// bug that only shows up under contention - exactly when it matters.
const enqueuedAtMs = mine && Number(mine.enqueued_at_ms) > 0 ? Number(mine.enqueued_at_ms) : nowMs;
const enqueuedAtIso = mine && mine.enqueued_at_iso ? String(mine.enqueued_at_iso) : nowIso;
const waitedMs = nowMs - enqueuedAtMs;

// Live waiters only: a ticket that has stopped polling belongs to a run that is gone.
const live = tickets.filter(function (t) {
  if (String(t.state || '') !== 'waiting') return false;
  if (String(t.ticket_key) === String(runId)) return false;
  const seen = Number(t.last_seen_ms);
  return Number.isFinite(seen) && (nowMs - seen) <= TICKET_STALE_MS;
});
// Ordering: oldest request first, ties broken deterministically so two runs enqueued in the
// same millisecond still agree on which of them is first.
function aheadOfMe(t) {
  const e = Number(t.enqueued_at_ms) || 0;
  if (e !== enqueuedAtMs) return e < enqueuedAtMs;
  return String(t.ticket_key) < String(runId);
}
const ahead = live.filter(aheadOfMe);
const atHead = ahead.length === 0;
const queuePosition = ahead.length + 1;

function ageMs(r) {
  const t = Number(r && r.acquired_at_ms);
  return Number.isFinite(t) && t > 0 ? nowMs - t : null;
}
function mins(ms) { return ms === null ? null : Math.round(ms / 60000); }

const held = !!row && row.state === 'held';
const heldBySelf = held && String(row.holder_run_id) === String(runId);
const age = row ? ageMs(row) : null;
const stale = held && age !== null && age > STALE_AFTER_MS;

let action, reason, waitReason = null;

if (mode === 'release') {
  // RELEASING SOMEONE ELSE'S LEASE IS THE DANGEROUS CASE, because it is silent: the other
  // audit keeps running, the lease reads free, and the next audit starts alongside it. So a
  // release that does not match this run is a no-op that says so.
  if (!held) {
    action = 'noop'; reason = 'lease was already free';
  } else if (!heldBySelf) {
    action = 'noop';
    reason = 'lease is held by run ' + String(row.holder_run_id) + ', not by this run - refusing ' +
             'to release a lease held by another run, because doing so would let a third audit start ' +
             'alongside one that is still going';
  } else {
    action = 'release'; reason = 'released by its holder';
  }
} else if (mode === 'acquire') {
  if (heldBySelf) {
    // Re-entrant on purpose: a retried or resumed run must not deadlock against itself.
    action = 'acquire'; reason = 're-acquired by the same run (idempotent)';
  } else if (ignore) {
    // THE OVERRIDE DELIBERATELY JUMPS THE QUEUE. Its whole purpose is to get past a lease that
    // should not be there, and making it wait its turn behind the queue it is trying to escape
    // would defeat it.
    action = 'acquire';
    reason = 'OVERRIDE: params.ignore_erp_lease was set' +
             (held ? ' while run ' + String(row.holder_run_id) + ' held the lease (' + mins(age) + ' minutes)' : '') +
             '. The reason to reach for this - a stuck lease - is indistinguishable from the reason ' +
             'not to - another audit genuinely running - so this is recorded on the run.';
  } else if (held && stale && atHead) {
    action = 'acquire';
    reason = 'took over a STALE lease held by run ' + String(row.holder_run_id) + ' for ' +
             mins(age) + ' minutes, past the ' + Math.round(STALE_AFTER_MS / 60000) +
             '-minute limit. A crashed run must not block the queue for ever - but if that run ' +
             'is in fact still alive, two audits are now hitting ERP together.';
  } else if (held) {
    action = 'queue';
    waitReason = 'audit "' + String(row.holder_check_id) + '" (run ' + String(row.holder_run_id) +
                 ') has held the ERP lease for ' + mins(age) + ' minutes';
  } else if (!atHead) {
    // The lease is free but this run is not first in line. Taking it here is how a queue turns
    // back into a scramble.
    action = 'queue';
    waitReason = 'the lease is free but ' + ahead.length + ' run(s) asked before this one: ' +
                 ahead.map(function (t) { return String(t.ticket_key); }).slice(0, 5).join(', ');
  } else {
    action = 'acquire'; reason = row ? 'lease was free and this run is first in the queue'
                                    : 'no lease row yet - first acquire';
  }
} else {
  throw new Error('ERP Lease: mode must be "acquire" or "release", got "' + mode + '". There is ' +
    'no default: guessing acquire would block the queue and guessing release would free a lease ' +
    'held by someone else.');
}

const proceed = action !== 'queue';

console.log(JSON.stringify({ stage: 'erp_lease_decide', mode: mode, action: action,
  run_id: runId, check_id: checkId,
  previous_holder: row ? row.holder_run_id : null,
  previous_check: row ? row.holder_check_id : null,
  held_for_minutes: mins(age), stale: stale,
  override_used: ignore && action === 'acquire' && !heldBySelf,
  queue_position: queuePosition, waiters_ahead: ahead.length, live_waiters: live.length,
  waited_seconds: Math.round(waitedMs / 1000), max_wait_seconds: Math.round(maxWaitMs / 1000),
  reason: reason || waitReason || null }));

// THE WAIT IS BOUNDED, and not by patience. An ERP session lasts about four hours and every
// token dies at 22:00 UTC; an audit runs 45-90 minutes. A run that queues for hours reaches the
// front holding a token too short to finish with, and n8n's execution timeout caps it
// independently. So queueing turns "fails immediately" into "waits, then fails only when
// waiting is genuinely pointless" - which is a real improvement and is NOT the same as never
// failing. Saying otherwise would hide the failure rather than remove it.
if (action === 'queue' && waitedMs > maxWaitMs) {
  throw new Error(
    'ERP LEASE QUEUE TIMED OUT: waited ' + Math.round(waitedMs / 60000) + ' minutes for the ERP ' +
    'lease and gave up (limit ' + Math.round(maxWaitMs / 60000) + ' minutes). ' + String(waitReason) +
    '. | This run was position ' + queuePosition + ' in the queue. | The wait is capped on purpose: ' +
    'an ERP session lasts about four hours and every token dies at 22:00 UTC, so a run that queues ' +
    'for longer reaches the front with a token too short to finish. | Re-fire with a fresh token ' +
    'when the holder is done, raise params.max_wait_ms if you know the wait is worth it, or - if ' +
    'you believe the holder is dead - use params.ignore_erp_lease, which is recorded on the run.');
}

// A NOOP MUST ECHO THE ROW BACK UNCHANGED, and getting this wrong is how the guard above would
// have defeated itself. The first version of this returned the standard payload for every
// action, so a no-op release - the case that exists specifically to protect ANOTHER run's lease
// - wrote this run's id into holder_run_id. The refusal message was correct and the write
// underneath it silently stole the lease anyway. Caught by the offline suite before it ever ran.
//
// The same applies while QUEUEING: a waiting run must not touch the lease row at all.
const ticket = {
  _ticket_key: String(runId),
  _ticket_check_id: String(checkId),
  // A run that is proceeding stops competing. Its ticket is settled here rather than deleted by
  // a separate node, so there is no path on which the grant lands and the ticket survives it.
  _ticket_state: action === 'queue' ? 'waiting' : 'done',
  _ticket_enqueued_at_ms: enqueuedAtMs,
  _ticket_enqueued_at_iso: enqueuedAtIso,
  _ticket_last_seen_ms: nowMs
};

if (action === 'noop' || action === 'queue') {
  const unchanged = row || { lease_key: 'erp', state: 'free', holder_run_id: '',
                             holder_check_id: '', acquired_at_iso: '', acquired_at_ms: 0 };
  return [{ json: Object.assign({
    lease_key: 'erp',
    state: unchanged.state || 'free',
    holder_run_id: String(unchanged.holder_run_id || ''),
    holder_check_id: String(unchanged.holder_check_id || ''),
    acquired_at_iso: String(unchanged.acquired_at_iso || ''),
    acquired_at_ms: Number(unchanged.acquired_at_ms) || 0,
    _action: action, _reason: reason || waitReason || null, _write: false, _proceed: proceed,
    _queue_position: queuePosition, _waiters_ahead: ahead.length,
    _waited_ms: waitedMs, _max_wait_ms: maxWaitMs
  }, ticket) }];
}

// One row per lease key, upserted. state is carried explicitly rather than inferred from the
// holder being blank, so a half-written row can never read as "free".
return [{ json: Object.assign({
  lease_key: 'erp',
  state: action === 'release' ? 'free' : 'held',
  holder_run_id: action === 'release' ? '' : String(runId),
  holder_check_id: action === 'release' ? '' : String(checkId),
  acquired_at_iso: action === 'release' ? '' : nowIso,
  acquired_at_ms: action === 'release' ? 0 : nowMs,
  _action: action,
  _reason: reason || null,
  _write: true,
  _proceed: true,
  _queue_position: queuePosition,
  _waiters_ahead: ahead.length,
  _waited_ms: waitedMs,
  _max_wait_ms: maxWaitMs
}, ticket) }];
