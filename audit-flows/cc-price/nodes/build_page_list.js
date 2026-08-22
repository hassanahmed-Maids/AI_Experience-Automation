// Pages are enumerated HERE rather than by n8n's pagination, because this route
// pages inside the request BODY and $pageCount does not resolve in jsonBody -
// it renders the literal string "undefined" and ERP answers NumberFormatException.
// Run 92491 failed exactly that way.
// ERP-COMPLIANCE: no-breaker-because this node reads a batch of ONE. Get Independent Count makes
// a single request (page=0&size=1), and not one of section 5's three detectors can reach its
// threshold on a single response: consecutive needs 5, rate needs 20 samples, and latency needs
// a baseline that is only ever taken from a batch of 200+ calls. A breaker here would be present
// and permanently mute, which reads as coverage and is not - the false-clearance shape this
// project keeps finding.
//
// What stops the run instead, on both halves of the failure:
//   - the call FAILS      -> Get Independent Count carries onError continueErrorOutput, so it
//                            routes to Release Lease (error) -> Fail Loudly, and the operator
//                            gets ERP's own status and body rather than a guess. This node does
//                            not even execute.
//   - the call SUCCEEDS but the total is unusable -> the throw below.
const ic = $("Get Independent Count").first().json;
const total = Number(ic && ic.total);
if (!isFinite(total) || total <= 0) {
  throw new Error("INDEPENDENT COUNT UNAVAILABLE: contract/search/page returned no usable total, so the number of pages cannot be determined and completeness could not be proven. Run stopped; no contract was scored.");
}
const SIZE = 500;
const fullPages = Math.ceil(total / SIZE);
// Deliberately fetch ONE page beyond the expected end. It must come back empty.
// If it does not, the population grew past what the independent count promised
// and the run must stop rather than quietly truncate.
const params = $("Parse + Assert Card").first().json.params;
// STAMPED HERE, immediately before the fetch, because Population Guard's breaker measures the
// sweep from this moment and scopes its latency baseline to this run. Every page item carries
// the same t0 - one stamp, taken once, not one per page.
const erpT0 = Date.now();
const out = [];
for (let p = 0; p <= fullPages; p++) {
  out.push({ json: { page: p, size: SIZE, is_probe_page: p === fullPages, total_expected: total,
                     run_id: params.run_id, erp_t0: erpT0 } });
}
return out;
