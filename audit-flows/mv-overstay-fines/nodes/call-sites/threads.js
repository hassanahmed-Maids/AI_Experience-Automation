// --- call site: the complaint-thread fan-out -------------------------------------------------
// One call per complaint selected for evidence, capped at MAX_THREADS_PER_CASE = 8 per red case
// by `Split Relevant Complaints`. This is the last ERP phase of the run and the widest one per
// entity, which is why the pre-flight gate budgets nine calls per transaction downstream of
// enrichment rather than one.
//
// WHAT CAN AND CANNOT FIRE HERE:
//   consecutive_failures - LIVE. Five in a row abort the run. Nothing further is saved in ERP
//                          calls, since this is the last fan-out, but the run stops instead of
//                          writing verdicts built on evidence that was never read - and the
//                          lease is released on the error rail rather than held to the end.
//   degraded_rate        - LIVE more often here than in any other phase of this flow: the batch
//                          is up to eight items per red case, so a handful of reds already
//                          clears the 20-response floor that the complaints batch usually misses.
//   latency              - CANNOT FIRE. One batch per run for key `threads`, no `erp_t0` stamped
//                          anywhere in this flow, so elapsedMs is null and the rule is disabled
//                          before it is reached. `baseline_carried` logs false every run.
//
// `Get Complaint Thread` was already on continueRegularOutput and stays there so its failures
// are counted here. `Attach Threads to Cases` folds a failed item in as a complaint with an
// empty thread, which is visible in the bundle as `thread_fetched: true` with no messages - the
// verifier then judges a case whose evidence was not actually read. That is the shape this
// breaker is protecting against, and the consecutive rule is what stops it becoming a whole
// run's worth of verdicts.
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'Complaint threads (MV Overstay Fines)',
  key: 'threads',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
