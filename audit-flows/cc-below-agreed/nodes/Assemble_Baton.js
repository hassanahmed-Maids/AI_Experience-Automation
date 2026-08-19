// Assemble Baton - the handoff from WF-A (score) to WF-B (verify).
//
// WHY THE SPLIT EXISTS, and it is not about speed. n8n retains EVERY node's output
// for the life of the execution, so a single flow can never release the sweeps no
// matter how much is trimmed downstream. Run 89604 died at 94m44s in the measured
// 100.6-142.6 MB kill band; run 90669 ran 95m and its record could not be read at
// all. Ending WF-A's execution is the only mechanism that actually frees that
// memory - which is why Launch Verifier runs with waitForSubWorkflow: false. The
// sweep and case data dies with WF-A, and WF-B starts with a clean budget.
//
// THE BATON CARRIES IDENTITY, WINDOW, CREDENTIAL, CANDIDATES AND STATS - NOTHING
// ELSE. No cohort rows, no payment rows, no plan payloads. Anything WF-B needs it
// re-reads for the batch it is working on. Putting bulk data on the baton would
// move the problem rather than solve it.
//
// BATCH STATE IS NEVER STORED ON IT. batch_index and batch_size travel, but nothing
// resembling has_more does: WF-B computes that fresh each hop. A stale has_more on
// the final hop sends a zero-candidate self-call instead of routing to deliver.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};

// Candidates arrive as one item each from Select Candidates.
const candidates = $input.all().map(function (i) { return i.json; });

function pick(fn, dflt) { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } }

// Run facts are read from the record Build Runs Log already assembled, so the two
// cannot disagree. Read defensively: this node must not be the reason a run dies.
const record = pick(function () { return $('Build Runs Log').first().json.record; }, {}) || {};
const comp = record.completeness || {};
const res = record.results || {};
const coh = record.cohort || {};

const baton = {
  // Self-identifying and check-specific. A stage that accepts another check's baton
  // is silent cross-contamination, so the kind is asserted at every hop.
  kind: 'cc-below-agreed-baton',
  v: 1,

  run_id: validated.run_id,
  check_id: validated.check_id,
  callback_url: validated.callback_url,
  trigger: params.trigger || 'manual',

  audit_month: validated.audit_month,
  range_start: validated.range_start,
  range_end: validated.range_end,
  // WF-B's evidence nodes are lifted from this flow and read persistence_windows by
  // index, so the windows travel EXACTLY as derived here. Re-deriving them in WF-B
  // from a date would risk a different month boundary for the same run.
  persistence_windows: validated.persistence_windows || [],

  // The bearer travels because WF-B makes ERP calls. It is a 24-hour token and this
  // is a same-owner sub-workflow call, not an external hop.
  bearer: pick(function () { return params.erp_auth.bearer; }, ''),

  candidates: candidates,
  candidates_total: candidates.length,
  batch_index: 0,
  batch_size: Number(params.batch_size || 50),

  // evidence_cap marks a capped pipeline test. Its PRESENCE is the marker - never a
  // count comparison, because the cap is applied before the baton is assembled, so
  // candidates_total EQUALS the cap and a > test reads false.
  evidence_cap: params.evidence_cap === undefined ? null : params.evidence_cap,

  stats: {
    gate2: {
      contracts_collected: comp.population_rows === undefined ? null : comp.population_rows,
      contracts_declared_total: null,
      population_floor: comp.population_floor === undefined ? null : comp.population_floor,
      payment_rows: comp.payment_rows_per_window || null,
      status_rows: comp.status_rows === undefined ? null : comp.status_rows,
      status_sweep_reconciled: comp.status_sweep_reconciled === true,
      both_sweeps_reconciled: comp.both_sweeps_reconciled === true
    },
    cases: {
      total: res.cases === undefined ? null : res.cases,
      scored: res.scored === undefined ? null : res.scored,
      green: res.paid_in_full_or_not_owed === undefined ? null : res.paid_in_full_or_not_owed,
      pending: res.in_flight === undefined ? null : res.in_flight,
      needs_human: res.inconclusive_cant_tell === undefined ? null : res.inconclusive_cant_tell,
      red_provisional: res.candidates_provisional === undefined ? null : res.candidates_provisional
    },
    reason_codes: res.reason_codes || {},
    candidates_total: candidates.length,
    total_shortfall_aed: res.total_candidate_shortfall_aed === undefined ? null : res.total_candidate_shortfall_aed,

    // Coverage travels so WF-C can label the summary without recomputing it.
    pipeline_test: coh.pipeline_test === true,
    cohort_cap: coh.cohort_cap === undefined ? null : coh.cohort_cap,
    cohort_before_cap: coh.cohort_before_cap === undefined ? null : coh.cohort_before_cap,

    // Gate 19 evidence, so a reader can see the third source did its job.
    cohort_contracts: coh.contracts === undefined ? null : coh.contracts,
    from_terminated_only: coh.from_terminated_only === undefined ? null : coh.from_terminated_only,

    footprint: record.footprint || null,

    // Populated by WF-B when a surface fails population-wide. Empty here means not
    // yet assessed, never assessed-and-clean.
    access_gaps: [],
    pil_blocked: false
  },

  // Accumulates across batches by riding the baton. Never rebuilt by reading a
  // sheet back - that would reintroduce the partial-read risk the baton removes.
  verdicts: { processed: 0, by_verdict: {} },

  // A zero-candidate month is legitimate (nothing to verify), but launching WF-B
  // with an empty list is a wiring bug there. The guard belongs on the launch, not
  // in WF-B's validator, so it is surfaced here.
  has_candidates: candidates.length > 0
};

console.log(JSON.stringify({ stage: 'assemble_baton', run_id: baton.run_id,
  candidates_total: baton.candidates_total, batch_size: baton.batch_size,
  has_candidates: baton.has_candidates, pipeline_test: baton.stats.pipeline_test,
  footprint_mb: baton.stats.footprint ? baton.stats.footprint.est_total_mb : null }));

if (!baton.bearer) {
  throw new Error('Assemble Baton found no ERP bearer to hand to WF-B. WF-B makes ERP calls and ' +
    'would fail per-case instead of failing here, which would look like missing evidence rather ' +
    'than a missing credential.');
}

return [{ json: baton }];
