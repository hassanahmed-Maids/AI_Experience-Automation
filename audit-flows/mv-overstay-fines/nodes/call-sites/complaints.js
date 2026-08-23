// --- call site: the maid-complaints fan-out --------------------------------------------------
// One list call per RED case, `GET /complaints/...`, in the evidence phase that runs after the
// cases have been scored and written. Kept in its own node rather than at the top of
// `Split Relevant Complaints`, which is the keyword/ordering filter and is the part of this
// branch a reader needs to understand.
//
// WHAT CAN AND CANNOT FIRE HERE:
//   consecutive_failures - LIVE, and it is the threshold that matters most in this phase. Each
//                          red case here is worth up to eight further thread calls, so five
//                          consecutive failures stopping the run saves the largest block of
//                          calls this flow can still avoid making.
//   degraded_rate        - USUALLY INERT, and that is worth knowing rather than assuming. The
//                          batch is one item per RED case, and a normal month produces far fewer
//                          than 20 reds - the last manual run had 20 findings in total. Below
//                          20 responses the rate rule is not evaluated at all, by design, so on
//                          most runs this phase is watched by the consecutive rule alone.
//   latency              - CANNOT FIRE. One batch per run for key `complaints`, and no `erp_t0`
//                          is stamped anywhere in this flow. `baseline_carried` logs false.
//
// `Get Maid Complaints` was already on continueRegularOutput before this node existed, and stays
// there: its failures have to arrive as items to be counted. Note what that costs downstream and
// is NOT fixed here - `Split Relevant Complaints` reads a failed item as a page with no
// `content`, so the case ends up with zero complaints rather than an unread marker. That is
// pre-existing behaviour, not a consequence of this node, and it is the reason the consecutive
// rule is the one doing real work in this phase: a run whose complaint reads are failing must be
// stopped, because nothing further down will tell you they failed.
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'Maid complaints (MV Overstay Fines)',
  key: 'complaints',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
