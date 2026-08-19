// Rows for the "Audit Findings" tab: every IN-SCOPE contract that is not green.
// Greens and out-of-scope contracts are deliberately not repeated here - they
// are all in the Cases data table, and the Audit Runs row carries their counts,
// so the two tabs reconcile without duplicating 5,000 uninteresting rows.
//
// NO NAMES. The population payload carries clientName and maidName; both were
// dropped at Stage 1's projection and neither may appear in a sheet.
const summary = $("Reconcile + Aggregate").first().json;
const rows = [];
for (const i of $("Read Cases For Run").all()) {
  const r = i.json;
  if (!r || !r.run_id) continue;
  if (String(r.scope || "") !== "in_scope") continue;
  if (String(r.state || "") === "green") continue;
  rows.push({ json: {
    run_id: r.run_id,
    audit_month: r.audit_month,
    contract_id: r.contract_id,
    client_id: r.client_id,
    cohort: r.cohort_now,
    contract_start_date: r.contract_start_date,
    state: r.state,
    verdict: r.verdict,
    reason_code: r.reason_code,
    monthly_rate_aed: r.agreed_monthly_rate,
    card_price_aed: r.card_price_for_month,
    gap_aed: r.gap_aed,
    rate_entry: r.rate_entry,
    flags: r.flags,
    needs_human: r.needs_human,
  } });
}
// Recorded so the verifier downstream knows what SHOULD have landed.
if (rows.length === 0) {
  return [];
}
return rows;
