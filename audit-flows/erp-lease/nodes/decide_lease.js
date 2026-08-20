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
// and waits its turn, for as long as that takes - see THE QUEUE DOES NOT TIME OUT BY DEFAULT
// below for why there is no cap, and what that does and does not guarantee.
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
const TICKET_STALE_MS = 5 * 60 * 1000;       // 3 missed polls at the 90s poll interval

const req = $('Read Lease Request').first().json;
const mode = req.mode;
const runId = req.run_id;
const checkId = req.check_id;
const ignore = req.ignore_lease === true;

// WHO IS ASKING, for fair-share ordering. A short workspace handle - never an email address or
// anything else that identifies a person outside this workspace, because it is written to a
// table and printed in the run log.
//
// Absent, every run becomes its own operator, every round is 0, and the ordering degenerates to
// plain FIFO - which is exactly the previous behaviour, so a caller that does not pass this
// loses nothing it had.
function operatorKey(op, fallbackRunId) {
  const o = String(op === null || op === undefined ? '' : op).trim();
  return o || ('run:' + String(fallbackRunId));
}
const myOperator = operatorKey(req.operator, runId);

// THE QUEUE DOES NOT TIME OUT BY DEFAULT. It used to cap the wait at 20 minutes, which meant
// the safety mechanism itself could kill a run that had done nothing wrong - and a run failing
// because of the thing protecting ERP is the worst possible trade. A queued run now waits as
// long as it takes.
//
// max_wait_ms is still honoured when a caller passes one, for the case where somebody would
// genuinely rather fail fast than wait. Absent, there is no limit.
//
// WHAT THIS DOES NOT FIX, and it must not be read as fixed: an ERP token dies about four hours
// after login and every token dies at 22:00 UTC. Waiting three hours and then starting a
// 90-minute audit fails at the first call with a dead token. Removing the queue's own timeout
// stops the LEASE from failing the run; it cannot make an expired token work. The thing that
// actually makes the guarantee real is keeping holds short - slice long runs - so waits stay
// well inside a token's life. See ERP-LOAD-POLICY.md section 4.
//
// AND ZERO MEANS ABSENT, not "give up instantly". The When Called trigger declares max_wait_ms
// as a NUMBER, and n8n fills a declared-but-unsent number field with 0 - so a caller that omits
// it entirely arrives here with askedWait === 0. An earlier version tested `askedWait >= 0` and
// therefore read that as a zero-millisecond limit: execution 95750 was killed with "ERP LEASE
// QUEUE TIMED OUT ... (limit 0 minutes)" on its second attempt, having asked for no limit at
// all. `> 0` is the whole fix and it is not cosmetic.
const askedWait = Number(req.max_wait_ms);
const maxWaitMs = Number.isFinite(askedWait) && askedWait > 0 ? askedWait : Infinity;

// A NO_WAIT CALLER IS NEVER TIMED OUT, whatever it passed. It is not waiting inside this
// workflow at all - it asks, gets an answer, and re-invokes itself later - so waitedMs here is
// the age of the RUN's ticket across every attempt, which grows without bound BY DESIGN. Any
// finite cap measured against it would eventually kill a run that is behaving exactly as the
// self-re-invoke pattern intends. A no_wait caller that wants to give up can simply stop
// re-invoking; that decision belongs to it, not to the lease.
const noWait = req.no_wait === true;

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
// ---- FAIR SHARE BETWEEN OPERATORS ---------------------------------------------------------
// Several people share this n8n workspace, and plain FIFO is unfair the moment one of them
// queues more than one run: fire three audits and the next person is fourth, waiting three
// full holds through no fault of their own. The lease is per-RUN and a hold is 45-90 minutes,
// so that is most of a working day.
//
// So ordering is round-robin BETWEEN operators and FIFO WITHIN each one. Each ticket gets a
// ROUND - its index among its own operator's waiting tickets - and every operator's first
// ticket outranks everybody's second:
//
//   Hassan fires H1 H2 H3, then Abdullah fires A1
//   plain FIFO   -> H1 H2 H3 A1   (Abdullah waits three holds)
//   fair share   -> H1 A1 H2 H3   (Abdullah waits one)
//
// It needs no history and no counters: the round is computed from the queue as it stands, so
// there is no state to get out of step with reality. With one operator waiting it is identical
// to FIFO, which is the property that makes it safe to turn on.
//
// NOTE what this does NOT do: it does not let two audits run at once. ERP still sees exactly
// one. Sharing a ceiling is not the same as raising it.
const meEntry = { ticket_key: String(runId), operator: myOperator,
                  enqueued_at_ms: enqueuedAtMs, state: 'waiting' };
const waiting = live.concat([meEntry]);

function roundOf(t) {
  const op = operatorKey(t.operator, t.ticket_key);
  const e = Number(t.enqueued_at_ms) || 0;
  const k = String(t.ticket_key);
  let n = 0;
  for (const o of waiting) {
    if (operatorKey(o.operator, o.ticket_key) !== op) continue;
    const oe = Number(o.enqueued_at_ms) || 0;
    if (oe < e || (oe === e && String(o.ticket_key) < k)) n++;
  }
  return n;
}
const myRound = roundOf(meEntry);

// Ordering: round first, then oldest request, then a deterministic tie-break so two runs
// enqueued in the same millisecond still agree on which of them is first.
function aheadOfMe(t) {
  const r = roundOf(t);
  if (r !== myRound) return r < myRound;
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
    waitReason = 'the lease is free but ' + ahead.length + ' run(s) are ahead of this one in the ' +
                 'fair-share order: ' +
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
  operator: myOperator, queue_round: myRound,
  operators_waiting: Array.from(new Set(waiting.map(function (t) {
    return operatorKey(t.operator, t.ticket_key); }))).length,
  no_wait: noWait,
  waited_seconds: Math.round(waitedMs / 1000),
  max_wait_seconds: Number.isFinite(maxWaitMs) ? Math.round(maxWaitMs / 1000) : null,
  reason: reason || waitReason || null }));

// ONLY IF THE CALLER ASKED FOR A LIMIT. By default there is none: the lease must never be the
// reason a run fails. A caller that would genuinely rather fail fast than wait can still pass
// max_wait_ms and get this.
if (action === 'queue' && !noWait && Number.isFinite(maxWaitMs) && waitedMs > maxWaitMs) {
  throw new Error(
    'ERP LEASE QUEUE TIMED OUT: waited ' + Math.round(waitedMs / 60000) + ' minutes for the ERP ' +
    'lease and gave up, because THIS CALLER ASKED FOR A LIMIT of ' + Math.round(maxWaitMs / 60000) +
    ' minutes. ' + String(waitReason) + '. | This run was position ' + queuePosition + ' in the ' +
    'queue. | There is no default limit - the lease is not allowed to be the reason a run fails - ' +
    'so this only happened because params.max_wait_ms was set. Drop it to wait indefinitely, ' +
    're-fire with a fresh token when the holder is done, or - if you believe the holder is dead - ' +
    'use params.ignore_erp_lease, which is recorded on the run.');
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
  _ticket_operator: myOperator,
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
