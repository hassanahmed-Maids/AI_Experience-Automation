// Chunk Candidates (WF-A) - split the enrichment candidates into chunks and hand each to
// WF-E, so no single execution holds every plan response.
//
// WHY, in one line: run 92534 crashed with both sweeps already staged, and the only thing
// left running was the per-contract enrichment chain - 5,632 candidates x 2 calls, ~22.7 MB
// of raw bodies, retained across four node outputs. See VALIDATION.md section 15.
//
// THE CHUNK SIZE IS A MEMORY BUDGET, NOT A THROUGHPUT KNOB. Chunks run SEQUENTIALLY (the
// caller is in `each` mode), so the wall-clock is the same whatever this is set to: the two
// HTTP nodes inside WF-E still make 11,264 calls, now at batchSize 2 / 500ms = 4 req/s, which
// is roughly 47 minutes (it was 15 / 500ms and ~26 minutes until 2026-08-20 - see
// audit-flows/ERP-LOAD-POLICY.md). What the size buys is a ceiling on what one sub-execution
// retains: 750 x 3,851 B is ~2.9 MB of plan bodies, and they are freed when the chunk ends. Raising it toward
// WF-E's own ceiling of 1,200 trades that ceiling for nothing.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};

const DEFAULT_CHUNK = 750;
const WFE_CEILING = 1200;   // must match CHUNK_MAX in WF-E's Read Chunk
const asked = Number(params.enrich_chunk_size);
const CHUNK = Number.isFinite(asked) && asked > 0 ? Math.min(asked, WFE_CEILING) : DEFAULT_CHUNK;

const bearer = (params.erp_auth && params.erp_auth.bearer) || '';
if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('Chunk Candidates: no usable bearer on the validated payload, so every enrichment ' +
    'call would 401. A 401 on the plan read presents downstream as an unreadable contract rate, which ' +
    'routes the case to a human rather than failing - so it is refused here, loudly, instead.');
}

const candidates = $input.all().map(function (i) { return i.json; });

// ONLY THE THREE IDS CROSS THE BOUNDARY. Sending whole cases would copy every case into
// every sub-execution's input for no benefit: WF-E reads nothing else, and the cases are
// already retained here, where `Join Enrichment` will put the deltas back onto them.
const slim = [];
for (const c of candidates) {
  slim.push({ case_key: String(c.case_key === undefined ? '' : c.case_key),
              contract_id: String(c.contract_id === undefined ? '' : c.contract_id),
              client_id: String(c.client_id === undefined ? '' : c.client_id) });
}


// ===================== ERP PRE-FLIGHT BUDGET GATE =====================
// audit-flows/ERP-LOAD-POLICY.md §3. Canonical copy: audit-flows/tools/erp_preflight_gate.js.
//
// WHY IT IS HERE AND NOT SOMEWHERE TIDIER: this node already knows the cohort size and already
// logged `calls_this_will_make` - it has always been able to see the cost and simply never
// refused it. The gate belongs at the last point before the first per-entity call, which is
// exactly here.
//
// PACING IS NOT VOLUME. tools/erp_load_check.py bounds requests per SECOND (2 concurrent /
// 500 ms = 4 req/s). Nothing there bounds how MANY there are, and a flow paced perfectly still
// makes ~13,400 calls on a 5,632-contract cohort. That is the shape that took ERP down three
// times: a flow tested on ten contracts behaves identically on five thousand.
// ======================================================================
// --- per-flow constants: EDIT THESE ---------------------------------------------------
const ERP_CALLS_PER_ENTITY = 2;      // calls this phase makes per entity
const ERP_CALLS_DOWNSTREAM = 2;      // per-entity calls LATER phases will make, worst case
const SWEEP_CALLS_FALLBACK = 185;    // sweeps already spent, when the run cannot report them
// ---------------------------------------------------------------------------------------

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const askedBudget = Number((params || {}).erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: gate 2 already counted the pages it walked,
// and a real number beats an estimate that quietly ages.
const _g2 = (function () {
  try { return $('Verify Bulk Pulls').first().json._gate2 || {}; } catch (e) { return {}; }
})();
const _measuredSweeps = (Number(_g2.population_pages) || 0) + (Number(_g2.status_pages) || 0) + 3;
const sweepCalls = _measuredSweeps > 3 ? _measuredSweeps : SWEEP_CALLS_FALLBACK;

const entities = slim.length;                       // the cohort about to be enriched
const projectedPhase = entities * ERP_CALLS_PER_ENTITY;
const projectedLater = entities * ERP_CALLS_DOWNSTREAM;
const projectedTotal = sweepCalls + projectedPhase + projectedLater;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  entities: entities, calls_per_entity: ERP_CALLS_PER_ENTITY,
  sweep_calls_spent: sweepCalls, projected_this_phase: projectedPhase,
  projected_downstream_worst_case: projectedLater, projected_total: projectedTotal,
  budget: budget, budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. Policy §7 says a run over
// SIGNOFF_THRESHOLD calls needs a recorded human decision. Setting params.erp_call_budget high
// enough IS that decision - it is an explicit, deliberate act in the payload - but a decision
// nobody can find later is not much of a record. So a high-volume run announces itself in the
// run's own log whether it is refused or allowed. Without this the threshold only ever appeared
// inside a refusal, which meant the one case it most needed to mark - a large run that was
// ALLOWED - was the case it said nothing about.
if (projectedTotal > SIGNOFF_THRESHOLD) {
  console.log(JSON.stringify({ stage: 'erp_preflight_high_volume',
    projected_total: projectedTotal, threshold: SIGNOFF_THRESHOLD, budget: budget,
    minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
    allowed: projectedTotal <= budget,
    note: 'ERP-LOAD-POLICY.md §7: a run this size needs a recorded human decision. The explicit ' +
          'params.erp_call_budget is that record; this line is where it can be found afterwards.' }));
}

if (projectedTotal > budget) {
  throw new Error(
    'ERP PRE-FLIGHT GATE: this run would make about ' + projectedTotal + ' ERP calls against a ' +
    'budget of ' + budget + '. Refusing to start the per-entity phase.\n' +
    '  cohort ' + entities + ' x ' + ERP_CALLS_PER_ENTITY + ' (this phase) = ' + projectedPhase + '\n' +
    '  cohort ' + entities + ' x ' + ERP_CALLS_DOWNSTREAM + ' (later phases, worst case) = ' + projectedLater + '\n' +
    '  sweeps already spent = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) + ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: cap the cohort (params.cohort_cap) so the run is ' +
    'a declared partial, or raise params.erp_call_budget because a full audit is genuinely wanted. ' +
    'The cohort is NOT trimmed automatically - a run that quietly audits part of the book and ' +
    'reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

const chunks = [];
for (let i = 0; i < slim.length; i += CHUNK) {
  chunks.push({ json: {
    bearer: bearer,
    cases: slim.slice(i, i + CHUNK),
    chunk_index: chunks.length,
    run_id: validated.run_id || ''
  } });
}

// ZERO CANDIDATES IS A REAL STATE and it is not an error: it means every contract in the
// cohort received nothing in the audited month, which gate 1 closes out to the sibling
// check. But it must not silently produce zero chunks that then read as a completed
// enrichment - so it is reported, and the downstream join is written to accept it.
if (chunks.length === 0) {
  console.log(JSON.stringify({ stage: 'chunk_candidates', candidates: 0, chunks: 0,
    note: 'no contract received anything in the audited month, so there is nothing to enrich. ' +
          'Gate 1 closed the whole cohort out; this is not a failure.' }));
  return [];
}

console.log(JSON.stringify({ stage: 'chunk_candidates', candidates: slim.length,
  chunks: chunks.length, chunk_size: CHUNK,
  calls_this_will_make: slim.length * 2,
  note: 'chunks run SEQUENTIALLY - this bounds memory per sub-execution, not runtime. ' +
        'The call count is unchanged and is the real cost: see VALIDATION.md section 15.' }));

return chunks;
