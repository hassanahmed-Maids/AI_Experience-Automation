// Decide Lease (ERP Lease) - grant, refuse, or release the one-audit-at-a-time lease.
//
// WHY A LEASE EXISTS. Per-flow pacing bounds ONE flow to 4 req/s. It says nothing about two
// flows. VALIDATION.md §19 records two audits crashing in the same n8n instance within ten
// minutes, and at the settings of the time that was 60 req/s arriving at ERP from a system
// that believed it was being careful. Every per-flow limit is multiplied by however many
// audits are running, so the count has to be bounded somewhere, and the only place that can
// see across flows is shared state.
//
// WHY IT IS ITS OWN SUB-WORKFLOW. Every audit needs it and none of them should re-implement
// it. n8n has no shared-code mechanism, so a shared WORKFLOW is the nearest thing to a shared
// function: one place to fix, one place to read.
//
// THE THREE WAYS A LEASE GOES WRONG, all handled below rather than discovered later:
//   1. a run crashes holding it, and every later audit is blocked for ever
//      -> a lease older than STALE_AFTER_MS may be taken, and the takeover is logged
//   2. someone needs to override it right now, at 2am, with no idea why it is stuck
//      -> params.ignore_erp_lease, logged loudly and carried into the run record
//   3. a run releases someone ELSE'S lease and two audits proceed believing they are alone
//      -> release only ever frees a lease this run_id actually holds
//
// It is a COOPERATIVE lease, not a mutex. Nothing physically stops a flow that skips this
// check from calling ERP; what it stops is two flows that both use it colliding by accident.
// That is the honest description and it is the right one for the problem - the failure mode
// was never malice, it was two people starting audits ten minutes apart.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;   // ERP-LOAD-POLICY.md §4

const req = $('Read Lease Request').first().json;
const mode = req.mode;
const runId = req.run_id;
const checkId = req.check_id;
const ignore = req.ignore_lease === true;

// The Data Table returns zero rows when the lease has never been taken, which is a normal
// first-run state and not an error.
const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && r.lease_key === 'erp'; });
const row = rows[0] || null;

const nowMs = Date.now();
const nowIso = new Date().toISOString();

function ageMs(r) {
  const t = Number(r && r.acquired_at_ms);
  return Number.isFinite(t) && t > 0 ? nowMs - t : null;
}
function mins(ms) { return ms === null ? null : Math.round(ms / 60000); }

const held = !!row && row.state === 'held';
const heldBySelf = held && String(row.holder_run_id) === String(runId);
const age = row ? ageMs(row) : null;
const stale = held && age !== null && age > STALE_AFTER_MS;

let action, reason;

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
  if (!held) {
    action = 'acquire'; reason = row ? 'lease was free' : 'no lease row yet - first acquire';
  } else if (heldBySelf) {
    // Re-entrant on purpose: a retried or resumed run must not deadlock against itself.
    action = 'acquire'; reason = 're-acquired by the same run (idempotent)';
  } else if (stale) {
    action = 'acquire';
    reason = 'took over a STALE lease held by run ' + String(row.holder_run_id) + ' for ' +
             mins(age) + ' minutes, past the ' + Math.round(STALE_AFTER_MS / 60000) +
             '-minute limit. A crashed run must not block the queue for ever - but if that run ' +
             'is in fact still alive, two audits are now hitting ERP together.';
  } else if (ignore) {
    action = 'acquire';
    reason = 'OVERRIDE: params.ignore_erp_lease was set while run ' + String(row.holder_run_id) +
             ' held the lease (' + mins(age) + ' minutes). The reason to reach for this - a stuck ' +
             'lease - is indistinguishable from the reason not to - another audit genuinely ' +
             'running - so this is recorded on the run.';
  } else {
    action = 'refuse';
  }
} else {
  throw new Error('ERP Lease: mode must be "acquire" or "release", got "' + mode + '". There is ' +
    'no default: guessing acquire would block the queue and guessing release would free a lease ' +
    'held by someone else.');
}

console.log(JSON.stringify({ stage: 'erp_lease_decide', mode: mode, action: action,
  run_id: runId, check_id: checkId,
  previous_holder: row ? row.holder_run_id : null,
  previous_check: row ? row.holder_check_id : null,
  held_for_minutes: mins(age), stale: stale, override_used: ignore && action === 'acquire' && !stale && !heldBySelf,
  reason: reason || null }));

if (action === 'refuse') {
  throw new Error(
    'ERP LEASE HELD: audit "' + String(row.holder_check_id) + '" (run ' + String(row.holder_run_id) +
    ') has held the ERP lease for ' + mins(age) + ' minutes. Refusing to start. | ' +
    'Per-flow pacing bounds ONE audit to 4 req/s; it does nothing about two. Two audits running ' +
    'together is how ERP was taken down before - see ERP-LOAD-POLICY.md §4. | ' +
    'Wait for it to finish, or - if you believe that run is dead - re-fire with ' +
    'params.ignore_erp_lease: true, which is recorded on the run. A lease older than ' +
    Math.round(STALE_AFTER_MS / 60000) + ' minutes is taken over automatically, so a genuinely ' +
    'crashed run unblocks the queue on its own.');
}

// A NOOP MUST ECHO THE ROW BACK UNCHANGED, and getting this wrong is how the guard above
// would have defeated itself. The first version of this returned the standard payload for
// every action, so a no-op release - the case that exists specifically to protect ANOTHER
// run's lease - wrote this run's id into holder_run_id. The refusal message was correct and
// the write underneath it silently stole the lease anyway. Caught by the offline suite before
// this ever ran.
//
// The write downstream is unconditional, so this branch is what makes it harmless.
if (action === 'noop') {
  const unchanged = row || { lease_key: 'erp', state: 'free', holder_run_id: '',
                             holder_check_id: '', acquired_at_iso: '', acquired_at_ms: 0 };
  return [{ json: {
    lease_key: 'erp',
    state: unchanged.state || 'free',
    holder_run_id: String(unchanged.holder_run_id || ''),
    holder_check_id: String(unchanged.holder_check_id || ''),
    acquired_at_iso: String(unchanged.acquired_at_iso || ''),
    acquired_at_ms: Number(unchanged.acquired_at_ms) || 0,
    _action: 'noop', _reason: reason || null, _write: false
  } }];
}

// One row per lease key, upserted. state is carried explicitly rather than inferred from the
// holder being blank, so a half-written row can never read as "free".
return [{ json: {
  lease_key: 'erp',
  state: action === 'release' ? 'free' : 'held',
  holder_run_id: action === 'release' ? '' : String(runId),
  holder_check_id: action === 'release' ? '' : String(checkId),
  acquired_at_iso: action === 'release' ? '' : nowIso,
  acquired_at_ms: action === 'release' ? 0 : nowMs,
  _action: action,
  _reason: reason || null,
  _write: true
} }];
