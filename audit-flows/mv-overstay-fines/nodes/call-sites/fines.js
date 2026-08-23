// --- call site: the OS-fines fan-out ---------------------------------------------------------
// One call per identity-resolved transaction, `GET /visa/overstay-fines/housemaid/{maid_id}`.
// Judged in its own node because `Attach Fines` runs Once for Each Item and cannot see a batch.
//
// WHAT CAN AND CANNOT FIRE HERE:
//   consecutive_failures - LIVE. Five in a row stop the run before the payments fan-out spends
//                          one more call per transaction. This is the single mid-run saving the
//                          breaker actually buys in this flow: the three enrichment calls are
//                          sequential phases, so a trip here is a phase not made, not merely a
//                          run that ends sooner.
//   degraded_rate        - LIVE once the batch reaches 20 responses. This batch is the
//                          identity-RESOLVED subset of the detail batch, so it is smaller than
//                          it: a month whose unattributed share is high can drop it under 20,
//                          at which point only the consecutive rule is watching.
//   latency              - CANNOT FIRE. Same two reasons as `Judge Detail Batch`: this fan-out
//                          runs once per run so there is no earlier batch of key `fines` to
//                          baseline against, and no node stamps `erp_t0`, so elapsedMs is null.
//                          `baseline_carried` logs false every run.
//
// `Get Overstay Fines` was changed from continueErrorOutput to continueRegularOutput when this
// node was added (2026-08-23). Under the old setting a failed read went straight to the error
// rail, which is why `Attach Fines` used to say a failure "goes down the error rail rather than
// arriving here" - that sentence is now false and has been corrected in that node. The breaker
// wins the argument: failures must arrive as items or they are not counted, and an uncounted
// failure is the thing this whole section exists to notice. `Attach Fines` classifies the
// arriving error item as `fines_unreadable`, which routes the case to review - never to clean,
// and never to verifier rule 15 ("no fine on her OS tab"), which is a real finding and must
// stay distinguishable from a read that did not happen.
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'OS fines (MV Overstay Fines)',
  key: 'fines',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
