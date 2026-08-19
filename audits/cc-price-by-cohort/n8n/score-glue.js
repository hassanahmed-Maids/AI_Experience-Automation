// --- n8n glue -------------------------------------------------------------
// Everything above this line is inlined verbatim from the tested sources.
// Everything below maps the ERP payloads onto the scorer's contract shape and
// onto the Cases table's columns.

if (typeof $input === 'undefined') {
  // Required as a module by test-node-parity.js, which proves the SHIPPED body
  // still agrees with scorer-month.js on every harness case.
  module.exports = { scoreMonth, resolveMonthlyRate, parseEntry, monthBounds, lastCompletedMonth, liveOutAt };
} else {
  const baton = $("Receive Baton").first().json;
  const params = baton.params;
  const card = baton.price_card.windows;
  const runId = params.run_id;
  const auditMonth = params.audit_month;
  if (!auditMonth) {
    throw new Error("params.audit_month is missing. Stage 2 refuses to score without a named audit month - scoring 'now' is what produced the withdrawn 2026-08-18 findings.");
  }

  // ERP sends booleans as booleans on the dynamic API and as strings elsewhere.
  // An unrecognised value stays NULL and routes to a human; it is never guessed,
  // because live-in is the cheaper cohort and a wrong guess clears real gaps.
  const coerceBool = function (v) {
    if (v === true || v === false) return v;
    const s = String(v === null || v === undefined ? "" : v).trim().toLowerCase();
    if (s === "") return null;
    if (s === "true" || s === "out" || s === "1") return true;
    if (s === "false" || s === "in" || s === "0") return false;
    return null;
  };
  const pick = function (a, b) { return (a === null || a === undefined || a === "") ? b : a; };
  const str = function (v) { return (v === null || v === undefined) ? "" : String(v); };

  const out = [];
  for (const it of $input.all()) {
    const j = it.json;
    const row = j.row;
    const d = j.details || {};
    const plan = d.paymentPlan || {};

    const base = {
      run_id: runId,
      case_key: runId + ":" + row.contract_id,
      contract_id: str(row.contract_id),
      client_id: str(row.client_id),
      audit_month: auditMonth,
      contract_start_date: str(pick(row.start_inline, d.contractStartDate)),
      maid_nationality: str(j.nationality),
      live_out: "",
      scope: "in_scope",
      scope_reason: "",
      cohort_now: "",
      cohort_at_start: "",
      agreed_monthly_rate: 0,
      card_price_for_month: 0,
      card_price_at_start: 0,
      gap_aed: 0,
      rate_entry: "",
      state: "",
      verdict: "",
      reason_code: "",
      reason_text: "",
      test_price_in_month: false,
      test_price_at_start: false,
      test_any_historic_price: false,
      test_upgrading_nationality: false,
      test_pro_rated: false,
      unimplemented_tests: "upgrading_nationality",
      retired_tests: "pro_rated",
      flags: "",
      needs_human: false,
      living_switch: false,
      unpriceable_at_start: false,
      payment_term_nationality_mismatch: false,
      payment_term_surface_unavailable: true,
      plan_item_discount_unreadable: false,
      additional_discount_present: false,
      credit_note_discount_present: false,
      pil_blocked: false,
      price_card_checksum_ok: baton.price_card.checksum_ok === true,
      scored_at: new Date().toISOString(),
      nationality_source: str(j.nationality_source),
    };

    // The monthly rate lives in details.paymentPlan.paymentsInfo. If that call
    // failed there is no rate to read, so the contract is a pending - never
    // scored from a partial payload and never quietly dropped from the run.
    if (j.details_status !== 200) {
      out.push({ json: Object.assign({}, base, {
        state: "pending",
        verdict: "Can't tell",
        reason_code: "details_unreadable_" + j.details_status,
        reason_text: "contract details returned HTTP " + j.details_status + ", so paymentsInfo could not be read",
        flags: "details_unreadable",
        needs_human: true,
      }) });
      continue;
    }

    const c = {
      contract_id: row.contract_id,
      maid_nationality: str(j.nationality),
      live_out: coerceBool(pick(row.live_out_inline, d.liveOut)),
      contract_start_date: pick(row.start_inline, d.contractStartDate),
      date_of_termination: d.dateOfTermination || null,
      scheduled_date_of_termination: pick(row.scheduled_termination_inline, d.scheduledDateOfTermination) || null,
      payments_info: Array.isArray(plan.paymentsInfo) ? plan.paymentsInfo : [],
      additional_discount: str(plan.additionalDiscount),
      credit_note_discount: str(plan.creditNoteDiscount),
      live_in_out_logs: Array.isArray(j.logs)
        ? j.logs.map(function (l) { return { date: l.date || null, oldValue: l.oldValue || null, newValue: l.newValue || null }; })
        : [],
    };

    const r = scoreMonth(c, card, { audit_month: auditMonth });
    const flags = r.flags.slice();

    // The live-in/out log decides which cohort applied during the month. If that
    // call failed the cohort rests on the population's current value alone, so
    // the verdict is not safe to clear - needs_human is one-way.
    if (j.logs_status !== 200) {
      flags.push("logs_unreadable_" + j.logs_status);
      if (r.scope === "in_scope") {
        r.needs_human = true;
        if (r.state === "green") { r.state = "pending"; r.verdict = "Can't tell"; r.reason_code = "cleared_on_a_test_but_gate_requires_review"; }
      }
    }

    const t = r.tests || {};
    out.push({ json: Object.assign({}, base, {
      live_out: c.live_out === null ? "unknown" : String(c.live_out),
      scope: r.scope,
      scope_reason: str(r.scope_reason),
      cohort_now: str(r.cohort),
      cohort_at_start: str(r.cohort_at_start),
      agreed_monthly_rate: r.actual_rate === null || r.actual_rate === undefined ? 0 : r.actual_rate,
      card_price_for_month: r.card_price === null || r.card_price === undefined ? 0 : r.card_price,
      card_price_at_start: r.card_price_at_start === null || r.card_price_at_start === undefined ? 0 : r.card_price_at_start,
      gap_aed: r.gap_aed === null || r.gap_aed === undefined ? 0 : r.gap_aed,
      rate_entry: str(r.rate_entry),
      state: str(r.state),
      verdict: str(r.verdict),
      reason_code: str(r.scope === "out_of_scope" ? r.scope_reason : r.reason_code),
      reason_text: (r.scope === "out_of_scope"
        ? "out of scope for " + auditMonth + ": " + r.scope_reason + (r.scope_detail ? " (" + r.scope_detail + ")" : "")
        : str(r.reason_code)) + (flags.length ? " | flags: " + flags.join(",") : ""),
      test_price_in_month: t.price_in_month === true,
      test_price_at_start: t.price_at_contract_start === true,
      test_any_historic_price: t.any_historic_price === true,
      flags: flags.join(","),
      needs_human: r.needs_human === true,
      living_switch: flags.indexOf("living_switch_in_month") !== -1,
      unpriceable_at_start: flags.indexOf("unpriceable_at_start") !== -1,
      additional_discount_present: flags.indexOf("additional_discount_context_only") !== -1,
      credit_note_discount_present: flags.indexOf("credit_note_discount_context_only") !== -1,
    }) });
  }
  return out;
}
