// --- call site: the overstay-fee payment fan-out ---------------------------------------------
// One search per contract, `POST /accounting/payments/...` filtered to contract.id AND
// typeOfPayment 8610. Judged in its own node because `Attach Payments` runs Once for Each Item.
//
// WHAT CAN AND CANNOT FIRE HERE:
//   consecutive_failures - LIVE, and this is the LAST per-entity ERP phase of the enrichment
//                          lane, so a trip here saves no further enrichment calls. What it does
//                          save is the evidence phase further downstream - one complaints list
//                          plus up to eight threads per red case - which is the larger half of
//                          this flow's call budget. Aborting here is still worth doing.
//   degraded_rate        - LIVE once the batch reaches 20 responses; same shrinking-subset
//                          caveat as the fines batch.
//   latency              - CANNOT FIRE. One batch per run for key `payments`, and no `erp_t0`
//                          anywhere in this flow, so elapsedMs is null and the comparison is
//                          disabled. `baseline_carried` logs false every run.
//
// `Get Overstay Payments` moved from continueErrorOutput to continueRegularOutput with this
// node, for the reason stated in `Judge Fines Batch`. The consequence is handled where it lands:
// `Attach Payments` treats a response with no `content` array as `payments_unreadable` and sends
// the case to review. That distinction is load-bearing in this check - a truncated or failed
// payment search reads as "never billed", which is exactly the false clean this flow was written
// to prevent (measured live on contract 1101801: contract.id alone returns 40 monthly-payment
// rows of 599 and zero overstay rows).
const _responses = $input.all().map(function (i) { return i.json; });
erpBreakerGuard({
  phase: 'Overstay-fee payments (MV Overstay Fines)',
  key: 'payments',
  responses: _responses,
  callsMade: _responses.length,
  minCallsForBaseline: 20
});
