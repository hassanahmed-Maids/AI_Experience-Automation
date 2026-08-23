// --- call site: the transaction-detail fan-out -----------------------------------------------
// This node exists ONLY to judge the batch and hand it on unchanged. It is not pasted into
// `Attach Identity` for a reason that is structural rather than stylistic: that node runs Once
// for Each Item, so `$input.all()` does not exist there and it can never see a batch. A
// dedicated node is also the only place a 10 KB generated block does not bury the check's own
// identity logic.
//
// WHAT CAN AND CANNOT FIRE HERE, stated rather than implied:
//   consecutive_failures - LIVE. Five 5xx/429/timeouts in a row abort the run here, before the
//                          fines and payments fan-outs spend another two calls per transaction.
//                          This is the earliest per-entity verdict the flow can get.
//   degraded_rate        - LIVE once the batch reaches 20 responses. January measured ~161
//                          over-base transactions and August ~151 rows of cohort, so a real
//                          month always clears that floor. A hand-capped test cohort under 20
//                          does not, and is then protected by the consecutive rule alone.
//   latency              - CANNOT FIRE, for two independent reasons, and neither is a defect.
//                          The rule compares this batch against a baseline taken from an
//                          EARLIER batch of the same key in the same run, and this fan-out runs
//                          exactly once per run - there is no second batch to compare against.
//                          `Validate Inputs` also stamps no `erp_t0`, so elapsedMs is null and
//                          the check is disabled before the baseline question is even reached.
//                          `baseline_carried` logs false on every run. Said out loud because a
//                          latency check that silently never fires is the false-clearance shape
//                          this project keeps finding, and a green run must not be read as
//                          "all three thresholds looked and were happy".
//
// `Get Transaction Detail` stays on onError: continueRegularOutput ON PURPOSE, and that is the
// one setting this node depends on. Routing its failures to the error rail instead would leave
// this breaker counting successes only - a breaker that cannot see a failure is worse than no
// breaker, because its green gets quoted. A failed read arrives here as an item, is counted,
// and then reaches `Attach Identity`, which routes it to review as `detail_unreadable` rather
// than scoring it as an unattributed transaction.
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'Transaction detail (MV Overstay Fines)',
  key: 'detail',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
