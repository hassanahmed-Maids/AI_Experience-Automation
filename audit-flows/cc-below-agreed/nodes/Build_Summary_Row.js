// Build Summary Row - ONE row per run, for the Run Summary tab.
//
// This is the runs-log record in the shape the sheet wants. COUNTS, FLAGS AND
// TOTALS ONLY: no client name, no contract id, no per-case figure, and - because
// this check reads the client message log - no quoted amount for any individual
// client and no template text of any kind. That restriction is company policy,
// not preference, and it is why the case-level detail lives on its own tab.
//
// ASSERTED, NOT ASSUMED: the object returned at the bottom of this file is built
// from `record.results`, `record.completeness` and `record.evidence`, which are
// aggregates by construction. Nothing here reads `record.cases` or any case
// object. If a future edit needs a per-case value on this tab, it belongs on the
// Cases tab instead.
const payload = $('Build Case Payload').first().json;
const runsLog = $('Build Runs Log').first().json;
const validated = $('Validate Inputs').first().json;
const record = runsLog.record || {};
const summary = (payload.result_data && payload.result_data.summary) || {};

function s(v) { return v === null || v === undefined ? '' : String(v); }
function n0(v) { return Number(v) || 0; }
function blankIfNull(v) { return v === null || v === undefined ? '' : Number(v) || 0; }

const completeness = record.completeness || {};
const cohort = record.cohort || {};
const results = record.results || {};
const evidence = record.evidence || {};
const reasons = results.reason_codes || {};
const windows = Array.isArray(record.persistence_windows) ? record.persistence_windows : [];
const perWindowRows = completeness.payment_rows_per_window || {};

function reason(code) { return Number(reasons[code]) || 0; }

console.log(JSON.stringify({ stage: 'build_summary_row', run_id: validated.run_id,
  candidates: n0(results.candidates_provisional),
  inconclusive: n0(results.inconclusive_cant_tell) }));

return [{ json: {
  run_id: s(validated.run_id),
  audit_month: s(validated.audit_month),
  window_from: s(validated.range_start),
  window_to: s(validated.range_end),
  // The three persistence windows, so a reader can see WHICH months the
  // persistence verdict rested on. Keys only - no amounts.
  persistence_windows: windows.map(function (w) { return s(w.key); }).join(' | '),
  persistence_window_rows: windows.map(function (w) {
    return s(w.key) + '=' + n0(perWindowRows[w.key]); }).join(' | '),
  triggered: s((validated.params && validated.params.trigger) || 'webhook'),
  delivery: 'google_sheets',
  overall: s(summary.overall),
  run_note: s(payload.notes),

  // ---- the funnel: cohort -> in scope -> paid -> candidates -> can't tell -> in flight
  cohort_contracts: n0(cohort.contracts),
  cohort_from_population_only: n0(cohort.from_population_only),
  cohort_from_payment_stub_only: n0(cohort.from_payment_stub_only),
  cohort_from_both: n0(cohort.from_both),
  maidless_contracts_kept: n0(cohort.maidless_kept),
  live_out_unknown: n0(cohort.live_out_unknown),
  cases_total: n0(results.cases),
  cases_scored: n0(results.scored),
  cases_carried: n0(results.carried),
  out_of_scope_nothing_received: n0(results.out_of_scope_nothing_received),
  in_scope: n0(results.cases) - n0(results.out_of_scope_nothing_received) - n0(results.carried),
  paid_in_full_or_not_owed: n0(results.paid_in_full_or_not_owed),
  // NOT "findings". Every one of these is provisional and carries
  // requires_verifier - the contractual rate is not reliably what was billed.
  candidates_provisional: n0(results.candidates_provisional),
  inconclusive_cant_tell: n0(results.inconclusive_cant_tell),
  in_flight: n0(results.in_flight),
  requires_verifier: n0(results.requires_verifier),
  total_candidate_shortfall_aed: n0(results.total_candidate_shortfall_aed),

  // ---- reason-code tallies
  green_out_of_scope_nothing_received: reason('out_of_scope_nothing_received'),
  green_no_maid_coverage: reason('no_maid_coverage'),
  green_prorated_first_month: reason('prorated_first_month'),
  green_freeze_overlap: reason('freeze_overlap'),
  green_paid_in_full: reason('paid_in_full'),
  green_overpaid: reason('overpaid'),
  pending_payment_in_flight: reason('payment_in_flight'),
  candidate_shortfall_persistent: reason('shortfall_persistent'),
  candidate_shortfall_unstable: reason('shortfall_unstable'),
  scorer_defect_unscored: reason('unscored'),
  carried_forward: reason('carried_forward'),

  // ---- verifier outcomes, if the verdicts merged back before the summary ran.
  // Blank means NOT YET VERIFIED - never "nothing found".
  verified_underpaid: n0((results.finding_reasons || {})['Underpaid']),
  verified_under_billed: n0((results.finding_reasons || {})['Under-billed']),

  // ---- completeness, and both reconciliation flags spelled out
  population_rows: blankIfNull(completeness.population_rows),
  population_pages: blankIfNull(completeness.population_pages),
  population_floor: blankIfNull(completeness.population_floor),
  population_sweep_reconciled: completeness.population_reconciled === true
    ? 'yes' : 'NO - declared unreconciled (route strips totalElements/totalPages; terminator + floor only)',
  status_rows_read: blankIfNull(completeness.status_rows),
  status_sweep_reconciled: completeness.status_sweep_reconciled === true
    ? 'yes' : 'NO - declared unreconciled (advancesearch has no top-level total; nested one caps at 40)',
  both_sweeps_reconciled: completeness.both_sweeps_reconciled === true ? 'yes' : 'no',
  gate2_status: 'PENDING TECHNICAL - waiting on the ERP team to make the population route countable',

  // ---- staleness. A stale bake does not error; it silently manufactures
  // inconclusive cases, so the date and the unknown-template count belong on the
  // face of every run.
  template_lookup_pulled_on: s(evidence.template_lookup_pulled_on),
  templates_in_lookup: n0(evidence.templates_in_lookup),
  unknown_or_unresolved_templates: n0(evidence.unknown_or_unresolved_templates),
  candidates_with_no_quote_found: n0(evidence.candidates_with_no_quote_found),
  candidates_with_message_read_failure: n0(evidence.candidates_with_message_read_failure),
  gate4_departure_cases: n0(evidence.gate4_departure_cases),
  snowflake_item_discount_unavailable_cases: n0(evidence.snowflake_item_discount_unavailable_cases),

  tolerance_aed: 5.00,
  exception_register_applied: 'no - INERT on run 1 (owner\'s clean-slate ruling 2026-08-13)',
  run1_expectation: s(record.run1_expectation),
  residue_bounds: s(record.residue_bounds),

  spec_version: s(record.spec_version),
  flow_version: s(record.flow_version),
  caveats: (Array.isArray(record.caveats) ? record.caveats : []).join(' || '),
  completed_at: new Date().toISOString()
} }];
