// Every key a write node emits must exist as a column, or the row is rejected
// and the run reports a write that never happened. That is exactly what went
// wrong on 2026-08-18: Score Batch emitted nationality_source, the Cases table
// had no such column, every insert was refused, and the run said 30 rows.
//
// This compares the keys in the shipped node bodies against the live schemas
// recorded below. Update the schemas whenever a column is added or renamed.
const fs = require('fs');

const CASES = ["additional_discount_present","agreed_monthly_rate","audit_month","card_price_at_start","card_price_for_month","case_key","client_id","client_name","cohort_at_start","cohort_now","contract_id","contract_start_date","credit_note_discount_present","first_seen","flags","gap_aed","live_out","living_switch","maid_nationality","nationality_source","needs_human","payment_term_nationality_mismatch","payment_term_surface_unavailable","pil_blocked","plan_item_discount_unreadable","price_card_checksum_ok","rate_entry","reason_code","reason_text","retired_tests","run_id","scope","scope_reason","scored_at","state","test_any_historic_price","test_price_at_start","test_price_in_month","test_pro_rated","test_upgrading_nationality","times_reported","unimplemented_tests","unpriceable_at_start","verdict"];
const RUNS = ["audit_month","blocked_surfaces","cases_scored","check_id","check_name","completed_at","contracts_seen","erp_calls_made","gap_total_aed","green","in_scope","independent_count","living_switch_count","notes","out_of_scope","out_of_scope_reasons","overall","payment_term_mismatch_count","pending","population_complete","population_count","population_delta","population_delta_pct","population_guard","population_source","price_card_checksum_ok","price_card_cohorts","price_card_windows","red","review","run_id","started_at","trigger","unimplemented_tests_declared","unimplemented_tests_inflation","unpriceable_at_start_count"];
const SHEET_RUNS = ["run_id","audit_month","overall","headline","population_count","in_scope","out_of_scope","out_of_scope_reasons","green","red","pending","review","green_pct_of_in_scope","red_pct_of_in_scope","pending_pct_of_in_scope","gap_total_aed","population_complete","price_card_checksum_ok","blocked_surfaces","unimplemented_tests","retired_tests","started_at","completed_at"];
const SHEET_FINDINGS = ["run_id","audit_month","contract_id","client_id","cohort","contract_start_date","state","verdict","reason_code","monthly_rate_aed","card_price_aed","gap_aed","rate_entry","flags","needs_human"];

// Keys emitted from the LAST object literal region of a node body. Rather than
// parse JS, the emitted keys are listed per node and cross-checked against the
// file so a forgotten field cannot pass silently.
function keysIn(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a) : src.length;
  if (a === -1) throw new Error('marker not found in ' + file + ': ' + from);
  const seg = src.slice(a, b === -1 ? src.length : b);
  const found = {};
  const re = /^\s{2,8}([a-z_][a-z0-9_]*):/gim;
  let m;
  while ((m = re.exec(seg)) !== null) found[m[1]] = true;
  return Object.keys(found).sort();
}

const checks = [
  { label: 'Score Batch -> Cases', keys: keysIn('n8n/score-batch.gen.js', 'const base = {', '// The monthly rate lives'), cols: CASES },
  { label: 'Reconcile -> Runs', keys: keysIn('n8n/stage3-reconcile.js', 'return [{ json: {'), cols: RUNS },
  { label: 'Build Run Summary Row -> Audit Runs tab', keys: keysIn('n8n/stage3-build-run-row.js', 'return [{ json: {'), cols: SHEET_RUNS },
  { label: 'Build Findings Rows -> Audit Findings tab', keys: keysIn('n8n/stage3-build-findings-rows.js', 'rows.push({ json: {', '} });'), cols: SHEET_FINDINGS },
];

let bad = 0;
for (const c of checks) {
  // A check that extracted nothing is a broken check, not a passing one.
  if (c.keys.length === 0) { bad++; console.log('FAIL ' + c.label + ' - extracted zero keys, the marker or the regex is wrong'); continue; }
  const missing = c.keys.filter(function (k) { return c.cols.indexOf(k) === -1; });
  if (missing.length) { bad++; console.log('FAIL ' + c.label + ' - no column for: ' + missing.join(', ')); }
  else console.log('ok   ' + c.label + ' (' + c.keys.length + ' keys)');
}
process.exit(bad ? 1 : 0);
