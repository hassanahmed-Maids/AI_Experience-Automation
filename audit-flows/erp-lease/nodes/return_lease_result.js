// Return Lease Result (ERP Lease) - VERIFY the write actually landed, then hand the caller a
// small, honest answer.
//
// This node now does two jobs, and the first one is the important one.
//
// ---------------------------------------------------------------------------------------
// 1. THE READ-BACK. Acquire is not atomic.
//
// Get Lease Row, Decide Lease and Write Lease are three separate nodes. Two audits starting
// within the same instant can both read "free", both decide to acquire, and both write. Last
// write wins, and BOTH proceed believing they are alone - the exact state the lease exists to
// prevent, reached through the lease itself. n8n's Data Table has no compare-and-swap, so
// there is no way to make the write conditional on the row still reading free.
//
// So the row is read back after a settle, and this node refuses if it does not name us. That
// turns a silent double-start into a loud single-loser: whoever's id is in the row proceeds,
// the other dies here. Exactly one winner, because the row holds exactly one holder_run_id -
// no coordination between the two runs is needed for them to agree on which of them it is.
//
// THE LOSER MUST NOT RELEASE. It does not hold the lease, and a release from a non-holder is
// already a no-op by construction (see Decide Lease), so a caller whose error rail fires a
// release cannot damage the winner. That property was built for a different reason and pays
// for itself again here.
//
// This narrows the race; it does not close it. A competitor stalled longer than the settle
// window is still missed. The honest guarantee is "two audits starting more than about a
// second apart cannot both proceed".
//
// ---------------------------------------------------------------------------------------
// 2. THE ANSWER. The caller does not need the row; it needs to know whether it may proceed,
// and - when a lease was taken from someone - that this happened. A takeover or an override
// is not a failure, but it is a fact the run record must carry, because the next question
// after a bad run is always "was anything else hitting ERP at the same time?"
const decided = $('Decide Lease').first().json;
const req = $('Read Lease Request').first().json;

const action = decided._action;
const takeover = /STALE/.test(String(decided._reason || ''));
const override = /OVERRIDE/.test(String(decided._reason || ''));

const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && r.lease_key === 'erp'; });
const confirmed = rows[0] || null;
const holder = confirmed ? String(confirmed.holder_run_id || '') : '';
const me = String(req.run_id || '');

console.log(JSON.stringify({ stage: 'erp_lease_verify', mode: req.mode, action: action,
  run_id: me, check_id: req.check_id,
  intended_holder: String(decided.holder_run_id || ''), confirmed_holder: holder || null,
  confirmed_state: confirmed ? confirmed.state : null,
  verified: !!confirmed,
  note: 'read-back after the settle; acquire is three nodes and therefore not atomic' }));

// The row cannot vanish between writing it and reading it. If it has, something is wrong with
// the store itself, and every later answer about who holds the lease is guesswork.
if (!confirmed) {
  throw new Error('ERP LEASE: wrote the lease row and read back NOTHING. The lease table ' +
    'returned no row for key "erp" immediately after an upsert, so this run cannot tell whether ' +
    'it holds the lease or not - and "cannot tell" must not become "proceed". Check the Data ' +
    'Table erp_audit_lease (nje7kLNpRssRtzsf) before running any audit.');
}

if (action === 'acquire' && holder !== me) {
  throw new Error(
    'ERP LEASE LOST THE RACE: this run wrote itself into the lease and read back run "' + holder +
    '" (audit "' + String(confirmed.holder_check_id || '') + '") holding it. Two audits acquired ' +
    'within the same instant. | Acquire is three nodes - read, decide, write - so both runs can ' +
    'see a free lease before either writes; the read-back is what catches it. Refusing to start, ' +
    'because the alternative is two audits on ERP believing they are alone, which is how ERP was ' +
    'taken down before. | This run holds nothing and must not release anything. Wait for run "' +
    holder + '" to finish and re-fire. See ERP-LOAD-POLICY.md §4.');
}

// A release that did not land is as dangerous as one that landed on someone else's lease: the
// next audit is blocked for the full staleness window by a run that has already finished.
if (action === 'release' && confirmed.state === 'held' && holder === me) {
  throw new Error('ERP LEASE: released the lease and read it back still held by this run (' + me +
    '). The write did not land, so the next audit would be blocked for the full 3-hour staleness ' +
    'window by a run that has already finished. Free it by hand in the Data Table erp_audit_lease.');
}

// A no-op must leave the row exactly as it found it. Finding OUR id in the row after a no-op
// means the write wrote us in - which is the bug the offline suite caught before this ever
// ran, and the reason Decide Lease echoes the unchanged row rather than the standard payload.
// Cheap to check, and it is the failure that hides best.
if (action === 'noop' && holder === me && me !== '') {
  throw new Error('ERP LEASE: a no-op ' + String(req.mode) + ' left THIS run (' + me + ') recorded as ' +
    'the holder. A no-op must leave the row untouched; writing ourselves in silently steals a ' +
    'lease another audit is still relying on. This is a defect in Decide Lease or Write Lease, ' +
    'not a state to work around.');
}

console.log(JSON.stringify({ stage: 'erp_lease_result', mode: req.mode, action: action,
  run_id: me, check_id: req.check_id,
  lease_state: confirmed.state, holder: holder || null,
  takeover: takeover, override: override,
  note: takeover || override
    ? 'THIS RUN TOOK A LEASE THAT SOMEONE ELSE HELD. If that other run was still alive, two '
      + 'audits were hitting ERP together - which is the thing the lease exists to prevent.'
    : 'lease handled normally' }));

// The CONFIRMED row is reported, not the intended one. They agree on every path that reaches
// here, and reporting the read-back is what makes that a fact rather than an assumption.
// A no_wait caller needs to know WHERE it is, not just that it did not get in: the position is
// what tells a human whether to wait for it or go and find out why.
return [{ json: {
  lease: 'erp',
  action: action,
  granted: action === 'acquire',
  queued: action === 'queue',
  queue_position: Number(decided._queue_position) || null,
  waiters_ahead: Number(decided._waiters_ahead) || 0,
  waited_ms: Number(decided._waited_ms) || 0,
  state: confirmed.state,
  holder_run_id: holder,
  holder_check_id: String(confirmed.holder_check_id || ''),
  verified: true,
  took_over_stale_lease: takeover,
  override_used: override,
  reason: decided._reason || null,
  run_id: me,
  check_id: req.check_id
} }];
