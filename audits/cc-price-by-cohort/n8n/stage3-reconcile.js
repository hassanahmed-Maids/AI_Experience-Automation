const baton = $("Receive Baton").first().json;
const params = baton.params;
const pop = baton.population || {};
const s2 = baton.stage2 || {};
const card = baton.price_card || {};
const auditMonth = String(params.audit_month || "");

// GROUND TRUTH is the Cases table, never Stage 2's own counters. A write node
// reporting success is not evidence a row exists - that exact assumption hid a
// total write failure on 2026-08-18.
const rows = [];
for (const i of $input.all()) { if (i.json && i.json.run_id) rows.push(i.json); }
const casesFound = rows.length;
const populationCount = Number(pop.count === undefined ? 0 : pop.count);
const haltedEarly = s2.halted_early === true;

const fatal = [];
if (!haltedEarly && casesFound < populationCount) {
  fatal.push("only " + casesFound + " of " + populationCount + " contracts have a case row");
}
if (!haltedEarly && casesFound === 0 && populationCount > 0) {
  fatal.push("the Cases table holds nothing for this run");
}
if (pop.complete === false && !haltedEarly) {
  fatal.push("the population guard did not report a complete pull");
}
if (card.checksum_ok !== true) {
  fatal.push("the price card failed its checksum");
}
if (!auditMonth) {
  fatal.push("the run carries no audit_month, so its numbers describe no particular period");
}
if (fatal.length) {
  throw new Error("DELIVERY REFUSED: " + fatal.join("; ") + ". No run summary was written - a report covering part of the population would read like a complete audit.");
}

// SCOPE IS A THIRD OUTCOME. green/red/pending are shares of IN-SCOPE contracts,
// never of the population: "5,000 out of scope for July" must never be readable
// as "5,000 clean".
// above_card is a FOURTH in-scope outcome: valid, not a finding, not routed to a
// human, and never part of the gap total. Spec owner, 2026-08-19.
const c = { green: 0, red: 0, pending: 0, above_card: 0 };
const byReason = {};
const scopeReasons = {};
let inScope = 0, outOfScope = 0;
let review = 0, gapTotal = 0, livingSwitch = 0, unpriceableAtStart = 0, termMismatch = 0;
let noNationality = 0, noLivingAxis = 0, rateUnreadable = 0, multipleRates = 0, cardMidMonth = 0;
let detailsUnreadable = 0, logsUnreadable = 0;
let couldFlipOnUnimplemented = 0;
const sources = {};

for (const r of rows) {
  if (String(r.scope || "") === "out_of_scope") {
    outOfScope++;
    const sr = String(r.scope_reason || "unknown");
    scopeReasons[sr] = (scopeReasons[sr] || 0) + 1;
    continue;
  }
  inScope++;

  const st = String(r.state || "unknown");
  if (c[st] === undefined) c[st] = 0;
  c[st]++;
  const rc = String(r.reason_code || "unknown");
  byReason[rc] = (byReason[rc] || 0) + 1;
  if (r.needs_human === true) review++;
  if (st === "red") gapTotal += Number(r.gap_aed || 0);
  if (r.living_switch === true) livingSwitch++;
  if (r.unpriceable_at_start === true) unpriceableAtStart++;
  if (r.payment_term_nationality_mismatch === true) termMismatch++;
  if (rc === "no_nationality") noNationality++;
  if (rc === "no_living_axis") noLivingAxis++;
  if (rc === "rate_unreadable") rateUnreadable++;
  if (rc === "multiple_rates_in_month") multipleRates++;
  if (rc === "card_changed_mid_month") cardMidMonth++;
  const fl = String(r.flags || "");
  if (fl.indexOf("details_unreadable") !== -1) detailsUnreadable++;
  if (fl.indexOf("logs_unreadable") !== -1) logsUnreadable++;
  // upgrading_nationality can only ever CLEAR a contract, so the cases it might
  // flip are exactly those that failed every implemented test.
  if (r.test_price_in_month !== true && r.test_price_at_start !== true && r.test_any_historic_price !== true) couldFlipOnUnimplemented++;
  const src = String(r.nationality_source || "unknown");
  sources[src] = (sources[src] || 0) + 1;
}

const blocked = [];
if (noNationality > 0) blocked.push("maid nationality missing on " + noNationality + " contracts");
if (detailsUnreadable > 0) blocked.push("contract details unreadable (" + detailsUnreadable + ")");
if (logsUnreadable > 0) blocked.push("live-in/out logs unreadable (" + logsUnreadable + ")");
if (rateUnreadable > 0) blocked.push("paymentsInfo did not parse on " + rateUnreadable + " contracts");
if (multipleRates > 0) blocked.push("more than one monthly rate covers the month on " + multipleRates + " contracts");
if (cardMidMonth > 0) blocked.push("the card price changed mid-month for " + cardMidMonth + " contracts' cohorts");
if (rows.length > 0 && rows[0].payment_term_surface_unavailable === true) blocked.push("payment-term nationality not read, so that gate never fired");

const pendingShare = inScope > 0 ? (c.pending / inScope) : 1;

// A run where nothing could be judged must never read as a clean bill of health.
let overall;
let headline;
if (haltedEarly) {
  overall = "HALTED EARLY";
  headline = auditMonth + ": stopped deliberately by chunk.max_chunks after " + casesFound + " of " + populationCount + " contracts. NOT a complete audit - do not act on these as findings.";
} else if (inScope === 0) {
  overall = "INCONCLUSIVE";
  headline = auditMonth + ": no contract was in scope. All " + populationCount + " were excluded (" + JSON.stringify(scopeReasons) + "), so the check formed no opinion about anything.";
} else if (pendingShare >= 0.5) {
  overall = "INCONCLUSIVE";
  headline = auditMonth + ": could not judge " + c.pending + " of " + inScope + " in-scope contracts (" + Math.round(pendingShare * 100) + "%). This is NOT a pass - the check could not form an opinion on most of the population it could see.";
} else if (c.red > 0) {
  overall = "FINDINGS";
  headline = auditMonth + ": " + c.red + " of " + inScope + " in-scope contracts were priced below the card, AED " + Math.round(gapTotal) + " per month in total.";
} else {
  overall = "CLEAN";
  headline = auditMonth + ": no in-scope contract was priced below the card across " + inScope + " contracts.";
}
// The gap total sums RED only, so it can no longer be dragged negative by
// contracts paying above card. A negative total would now be a bug, not a fact.
if (gapTotal < 0) {
  throw new Error("IMPOSSIBLE GAP TOTAL: " + gapTotal + " is negative while summing only under-priced contracts."
    + " A red verdict must mean actual < expected. Run stopped rather than reporting a shortfall that cancels itself out.");
}

const notes = [];
notes.push("Scope: " + inScope + " in scope, " + outOfScope + " out of scope of " + populationCount + " active contracts. green/red/above_card/pending are shares of IN-SCOPE only. Out-of-scope reasons: " + JSON.stringify(scopeReasons) + ".");
notes.push(c.above_card + " in-scope contracts pay ABOVE the card. That is valid and is not a finding; they are excluded from red and from the gap total. Most are nationalities ERP prices above the card's collapsed Other bucket - see erp-price-matrix-mapping.md.");
notes.push("The monthly rate is read from paymentPlan.paymentsInfo for " + auditMonth + ", never from currentPayment.");
notes.push("One of the five spec tests is NOT implemented (upgrading_nationality) because no definition exists on the spec pages; it is scored NOT PASSED. " + couldFlipOnUnimplemented + " in-scope contracts failed every implemented test and could in principle have been cleared by it, so non-green counts are an upper bound. pro_rated is retired: a partial month is out of scope, so there is no pro-rated payment left to test.");
if (blocked.length) notes.push("Blocked surfaces: " + blocked.join("; ") + ".");
notes.push("Nationality source: " + JSON.stringify(sources) + ".");
notes.push("Reason codes: " + JSON.stringify(byReason) + ".");

return [{ json: {
  run_id: params.run_id,
  check_id: params.check_id,
  check_name: params.check_name,
  trigger: params.smoke === true ? "smoke" : "manual",
  started_at: params.started_at,
  completed_at: new Date().toISOString(),
  audit_month: auditMonth,
  population_count: populationCount,
  independent_count: Number(pop.independent_count === undefined || pop.independent_count === null ? 0 : pop.independent_count),
  population_delta: Number(pop.delta === undefined || pop.delta === null ? 0 : pop.delta),
  population_delta_pct: Number(pop.delta_pct === undefined || pop.delta_pct === null ? 0 : pop.delta_pct),
  population_complete: pop.complete === true,
  population_guard: String(pop.guard || ""),
  population_source: String(pop.source || ""),
  price_card_windows: Number(card.windows_parsed === undefined ? 0 : card.windows_parsed),
  price_card_cohorts: Number(card.cohorts === undefined ? 0 : card.cohorts),
  price_card_checksum_ok: card.checksum_ok === true,
  contracts_seen: casesFound,
  cases_scored: casesFound,
  in_scope: inScope,
  out_of_scope: outOfScope,
  out_of_scope_reasons: JSON.stringify(scopeReasons),
  erp_calls_made: Number(s2.erp_calls_made === undefined ? 0 : s2.erp_calls_made),
  green: c.green,
  red: c.red,
  above_card: c.above_card,
  pending: c.pending,
  review: review,
  unpriceable_at_start_count: unpriceableAtStart,
  living_switch_count: livingSwitch,
  payment_term_mismatch_count: termMismatch,
  unimplemented_tests_declared: "upgrading_nationality",
  unimplemented_tests_inflation: couldFlipOnUnimplemented,
  blocked_surfaces: blocked.join("; "),
  gap_total_aed: Math.round(gapTotal * 100) / 100,
  overall: overall,
  notes: headline + " " + notes.join(" "),
} }];
