// Build Sheet Rows - one flat row per contract-month, for the Cases tab.
//
// WHAT IS DELIBERATELY NOT HERE. The Cases tab IS the review queue, so it may
// carry per-case amounts and the client name that is already on the case. It may
// NOT carry: a message body (not one quoted template text, not one SMS or
// WhatsApp line), a phone number, or any maid personal detail beyond the name the
// case already holds. This check reads the client message log to resolve the
// quoted amount, so only the NUMBER and the template FAMILY cross into the sheet
// - never the text that carried them. The Run Summary tab is stricter still:
// counts, flags and totals only.
//
// The sheet itself is the sensitive artifact: restrict its sharing.
//
// LIFTED INTO WF-T 2026-08-19, with exactly ONE change: where the cases come from. In WF-A
// this node sat after Build Case Payload and read the payload's case list; here it runs
// per BATCH, before any run-level payload exists, so it reads the batch straight off the
// band-stamping node. Everything below this line is byte-identical to the WF-A original -
// the columns, the labels and the redaction rules are the sheet's contract and were not
// touched by the relocation.
const validated = $('Validate Inputs').first().json;
const cases = $('Stamp Display Bands').all().map(function (i) { return i.json; });
const WINDOWS = validated.persistence_windows || [];

function s(v) { return v === null || v === undefined ? '' : String(v); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function yn(v) { return v === true ? 'yes' : (v === false ? 'no' : 'unknown'); }

// The owner's words, not the state machine's - and the mapping is still marked
// PROPOSED. Note what is NOT here: no label says "finding". A candidate stays a
// candidate on this tab until the verifier's finding_reason lands beside it on the
// Verifier Verdicts tab (join on case_key).
function stateLabel(c) {
  const band = s(c.display_band);
  if (band === 'carried' || c.skip_computation === true) return 'Carried forward - not re-scored';
  if (band === 'not_in_scope') return 'Not in scope - nothing received (sibling check)';
  if (band === 'inconclusive') return 'Can\'t tell (inconclusive)';
  if (band === 'in_flight') return 'In flight';
  if (band === 'paid_in_full') return 'Paid in full / not owed';
  if (band === 'candidate') {
    const fr = s(c.finding_reason);
    if (fr === 'Underpaid') return 'Underpaid (verified)';
    if (fr === 'Under-billed') return 'Under-billed (verified)';
    return 'Candidate - under-billed or underpaid, unknown until verified';
  }
  return s(c.new_state);
}

const rows = cases.map(function (c) {
  const m = c.metadata || {};
  const cm = c.computed || {};
  const q = c.quoted || {};
  const months = cm.months || {};
  const pers = cm.persistence || {};
  const cov = cm.coverage || {};
  const pro = cm.prorated || null;

  // "unknown" is a real answer here and must not read as a zero: it means
  // currentPayment.amountValue could not be read, so the case has no verified
  // money figure at all - not a zero shortfall, and not a zero expectation.
  const known = cm.expected_known !== false;

  const row = {
    case_key: s(c.case_key),
    run_id: s(validated.run_id),
    audit_month: s(m.audit_month || validated.audit_month),
    state: stateLabel(c),
    state_code: s(c.new_state),
    band: s(c.display_band),
    reason_code: s(c.reason_code),
    finding_reason: s(c.finding_reason),      // filled by the verifier, blank here
    contract_id: s(m.contract_id),
    client_id: s(m.client_id),
    client_name: s(m.client_name),
    maid_name: s(m.maid_name),
    contract_status: s(m.contract_status),
    contract_start: s(m.contract_start),

    expected_aed: known ? n2(cm.expected) : 'unknown',
    expected_gross_aed: known ? n2(cm.expected_gross) : 'unknown',
    expected_note: s(cm.expected_note),
    prorated_days: pro ? Number(pro.days) || 0 : '',
    prorated_divisor: pro ? Number(pro.days_in_month) || 0 : '',
    actual_aed: n2(cm.actual),
    shortfall_aed: known ? n2(cm.shortfall) : 'unknown',
    variance_aed: known ? n2(cm.variance) : 'unknown',
    in_flight_aed: n2(cm.in_flight),
    tolerance_aed: n2(cm.tolerance),

    // Persistence: a wrong rate persists, a light month does not. The verdict is
    // what decides candidate strength; the variance is what proves it is the SAME
    // wrong number every month rather than three different dips.
    persistence_verdict: s(pers.verdict),
    persistence_months_short: Number(pers.months_short) || 0,
    persistence_months_seen: Number(pers.months_seen) || 0,
    persistence_variance_aed: pers.variance === null || pers.variance === undefined ? '' : n2(pers.variance),

    coverage_days: cov.days === null || cov.days === undefined ? 'unknown' : Number(cov.days),
    coverage_known: yn(cov.known),
    coverage_note: s(cov.why),

    refund_mp_reversing_aed: n2(m.refund_mp_reversing),
    refund_other_aed: n2(m.refund_other),
    unrecognised_refund: m.unrecognised_refund === true ? 'YES' : '',
    // types_seen is a map of payment type -> count. Joined, so one cell shows what
    // the month was actually made of.
    types_seen: Object.keys(m.types_seen || {}).map(function (k) {
      return k + '=' + (m.types_seen[k]); }).join(' | '),
    dead_rows: Number(m.dead_rows) || 0,
    bulk_only_rows: Number(m.bulk_only_rows) || 0,

    // Evidence, never a subtraction: the code does NOT net the discount off the
    // expectation (currentPayment.amountValue already reflects it) and the
    // disagreement with the rule as written is flagged for a ruling.
    discount_text: (Array.isArray(m.discount_text) ? m.discount_text : []).join(' | '),
    gate4_departure: m.gate4_departure ? 'yes' : 'no',
    snowflake_item_discount_available: /^UNAVAILABLE/.test(s(m.snowflake_item_discount)) ? 'no' : 'yes',

    // The two quoted amounts ARE the check. contract-rate quoted is what we told
    // the client the contract rate was; requested quoted is what accounting
    // actually asked for. If the client paid what we asked and that was below the
    // contract rate, we UNDER-BILLED. If we asked the contract rate and less
    // arrived, the client UNDERPAID. Amounts and template FAMILY only - the
    // message text stays out of the sheet.
    quoted_contract_rate_aed: q.contract_rate_quoted === null || q.contract_rate_quoted === undefined
      ? '' : n2(q.contract_rate_quoted),
    quoted_requested_aed: q.requested_quoted === null || q.requested_quoted === undefined
      ? '' : n2(q.requested_quoted),
    quoted_families_seen: (Array.isArray(q.families_seen) ? q.families_seen : []).join(' | '),
    quoted_no_quote_found: q.no_quote_found === true ? 'YES' : '',
    quoted_read_failed: q.read_failed === true ? 'YES' : '',
    quoted_lookup_pulled_on: s(q.lookup_pulled_on),

    requires_verifier: c.requires_verifier === true ? 'YES' : '',
    verifier_reason: s(c.verifier_reason),
    enriched: m.enriched === true ? 'yes' : 'no (settled before enrichment)',
    cohort_source: (Array.isArray(m.cohort_sources) ? m.cohort_sources : []).join(' | '),
    previous_state: s(c.previous_state),
    reason_text: s(c.reason_text),
    erp_client_link: m.client_id ? 'https://erp.maids.cc/client/client-profile/details/' + s(m.client_id) : '',
    written_at: new Date().toISOString()
  };

  // Per-month actuals for the three persistence windows, index 0 = the audited
  // month. Written as explicit columns rather than a blob so a reviewer can see
  // 2,100 / 2,100 / 2,100 against a 4,715 rate at a glance - which is the single
  // most persuasive shape in this whole check.
  for (let i = 0; i < WINDOWS.length; i++) {
    const w = WINDOWS[i];
    const mm = months[w.key];
    row['m' + i + '_key'] = s(w.key);
    row['m' + i + '_actual_aed'] = mm ? n2(mm.actual_net) : '';
    row['m' + i + '_in_flight_aed'] = mm ? n2(mm.in_flight) : '';
  }

  return { json: row };
});

console.log(JSON.stringify({ stage: 'build_sheet_rows', rows: rows.length,
  windows: WINDOWS.map(function (w) { return w.key; }) }));

// Zero rows would make the Sheets node fail on an empty input rather than write
// an empty result, so say so loudly instead of returning nothing.
if (rows.length === 0) {
  throw new Error('No cases to write to the sheet. A run that audited nothing must not look like a ' +
    'clean month - check the cohort and the completeness gate rather than the sheet.');
}

return rows;
