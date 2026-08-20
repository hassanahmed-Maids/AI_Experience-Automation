// Return Lease Result (ERP Lease) - hand the caller a small, honest answer.
//
// The caller does not need the row; it needs to know whether it may proceed, and - when a
// lease was taken from someone - that this happened. A takeover or an override is not a
// failure, but it is a fact the run record must carry, because the next question after a
// bad run is always "was anything else hitting ERP at the same time?"
const decided = $('Decide Lease').first().json;
const req = $('Read Lease Request').first().json;

const action = decided._action;
const takeover = /STALE/.test(String(decided._reason || ''));
const override = /OVERRIDE/.test(String(decided._reason || ''));

console.log(JSON.stringify({ stage: 'erp_lease_result', mode: req.mode, action: action,
  run_id: req.run_id, check_id: req.check_id,
  lease_state: decided.state, holder: decided.holder_run_id || null,
  takeover: takeover, override: override,
  note: takeover || override
    ? 'THIS RUN TOOK A LEASE THAT SOMEONE ELSE HELD. If that other run was still alive, two '
      + 'audits were hitting ERP together - which is the thing the lease exists to prevent.'
    : 'lease handled normally' }));

return [{ json: {
  lease: 'erp',
  action: action,
  granted: action === 'acquire',
  state: decided.state,
  holder_run_id: decided.holder_run_id || '',
  holder_check_id: decided.holder_check_id || '',
  took_over_stale_lease: takeover,
  override_used: override,
  reason: decided._reason || null,
  run_id: req.run_id,
  check_id: req.check_id
} }];
