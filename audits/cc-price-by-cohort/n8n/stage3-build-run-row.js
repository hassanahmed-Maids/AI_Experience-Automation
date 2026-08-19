// One row for the "Audit Runs" tab. Percentages are of IN-SCOPE, and the tab's
// columns carry population_count / in_scope / out_of_scope side by side so a
// reader cannot mistake "out of scope" for "clean".
const s = $("Reconcile + Aggregate").first().json;
const inScope = Number(s.in_scope || 0);
const pct = function (n) { return inScope > 0 ? Math.round((Number(n || 0) / inScope) * 1000) / 10 : 0; };
const headline = String(s.notes || "").split(" Scope:")[0];

return [{ json: {
  run_id: s.run_id,
  audit_month: s.audit_month,
  overall: s.overall,
  headline: headline,
  population_count: s.population_count,
  in_scope: inScope,
  out_of_scope: s.out_of_scope,
  out_of_scope_reasons: s.out_of_scope_reasons,
  green: s.green,
  red: s.red,
  pending: s.pending,
  review: s.review,
  green_pct_of_in_scope: pct(s.green),
  red_pct_of_in_scope: pct(s.red),
  pending_pct_of_in_scope: pct(s.pending),
  gap_total_aed: s.gap_total_aed,
  population_complete: s.population_complete,
  price_card_checksum_ok: s.price_card_checksum_ok,
  blocked_surfaces: s.blocked_surfaces,
  unimplemented_tests: s.unimplemented_tests_declared,
  retired_tests: "pro_rated (retired: a partial month is out of scope)",
  started_at: s.started_at,
  completed_at: s.completed_at,
} }];
