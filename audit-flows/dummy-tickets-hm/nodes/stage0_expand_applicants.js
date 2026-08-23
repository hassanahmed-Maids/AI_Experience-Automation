// One item per applicant id. The parent passes a chunk plus the run's ERP auth.
//
// ERP-COMPLIANCE: lease-held-by-caller - 1-Score acquires the ERP lease (9gVijqvtLVEhQZXz)
// before its first ERP call and releases it on both rails. A sub-workflow that took its own
// lease would deadlock against the caller that already holds it, so this flow must NOT acquire
// one - it must only ever be called by a holder. The declaration is here rather than implied,
// because the 2026-08-23 audit found this flow relying on a caller that held no lease at all
// and saying nothing about it: an undeclared dependency is indistinguishable from an unnoticed
// gap.
//
// ERP-COMPLIANCE: budget-gate-in-caller - the parent's ERP Budget Gate projects the whole run's
// ERP cost against the budget before the first per-entity call, which is upstream of this flow
// being called at all. Gating again here would only ever refuse a chunk of 25 that the run had
// already paid for.
const p = $input.first().json || {};
const ids = Array.isArray(p.applicant_ids) ? p.applicant_ids : [];
if (!p.erp_token) throw new Error('0-Fetch: erp_token missing from the parent baton. Refusing to call ERP unauthenticated.');
if (!ids.length) return [{ json: { _no_applicants: true, erp_token: p.erp_token } }];

// run_id and erp_t0 feed the circuit breaker in Project Tickets. erp_t0 is stamped HERE, one
// node before the ERP batch fires, so the elapsed clock measures this chunk's ERP time and not
// the parent's whole run - a mean ms/call computed over the parent's clock would look worse and
// worse on every later chunk and trip the latency rule on nothing.
const erpT0 = Date.now();
const runId = String(p.run_id || '');

return ids.map(id => ({ json: {
  applicant_id: id,
  run_id: runId,
  erp_t0: erpT0,
  chunk_index: p.chunk_index === undefined ? null : p.chunk_index,
  erp_token: p.erp_token,
  erp_device_id: p.erp_device_id || '',
  erp_is_auth: p.erp_is_auth || ''
}}));
