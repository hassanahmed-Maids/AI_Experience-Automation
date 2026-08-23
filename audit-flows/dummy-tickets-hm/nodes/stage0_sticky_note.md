## 0-Fetch Tickets (sub-workflow)

Called by the parent **once per chunk of 25 applicants**, with `mode: each` on the parent's Execute Workflow node. That mode is not optional: the default passes all items in ONE call, and because this flow reads `$input.first()`, a June run silently enriched 25 of 93 applicants and still reported **success**. Only the every-applicant-must-return assertion below caught it.

**Exists so the parent retains kilobytes, not applicant trees** — the sibling CC chain had one sweep return 44.1 MB into its caller. `Project Tickets` emits only the fields the gates and the verifier read.

**Pacing 2 in flight / 500 ms = 4 req/s**, the `ERP-LOAD-POLICY.md` §1 ceiling. It was **5 / 500 ms** until 2026-08-23, and this note said that matched the golden's rail — it matched an *older* golden. 5/500 is 10 req/s, two and a half times over. §1 caps the **in-flight count at 2** as well as the rate, which is a separate rule: 3/750 ms is exactly 4 req/s and still violates it, because it holds three connections open at once. Bursts are what got the ERP account disabled in June 2026; the flow this replaces ran its detail sweep at 10/200.

**This flow takes no lease and runs no budget gate, on purpose.** `1-Score` acquires the ERP lease (`9gVijqvtLVEhQZXz`) before its first ERP call and releases it on both rails, and its `ERP Budget Gate` projects the run's whole ERP cost before the first per-entity call. A sub-workflow that took its own lease would deadlock against the caller holding it. Both facts are now *declared* in `Expand Applicants` (`ERP-COMPLIANCE: lease-held-by-caller`, `budget-gate-in-caller`) rather than assumed — the 2026-08-23 audit found this flow depending on a caller that held neither.

**Circuit breaker in `Project Tickets`** (§5), generated from `tools/erp_breaker.js` so it can be byte-compared rather than eyeballed. `Expand Applicants` stamps `erp_t0` one node before the batch fires and carries `run_id`, which is what the breaker reads. A trip stops the *remaining* chunks — within a chunk nothing can be saved, because the HTTP node returns only when its last request is done. This is the one place in the chain where the **latency** rule is meaningful: the parent's fan-outs each happen exactly once per run, so they have no earlier batch to baseline against, and this one repeats per chunk.

**Gate 30's one retry is `retryOnFail` on `Get Hustler Tickets`** — `maxTries: 2`, `waitBetweenTries: 1000` — and it works *because* `neverError` is **false**: a 500 genuinely throws, so it genuinely retries. Do not set `neverError: true` here; that would silence the throw and the retry would never fire. An item that still failed arrives with no `statusCode` and is scored `reachable: false`, which the parent records as `erp_unreachable` (pending) — never a finding, and never "applicant not found": ERP returns 500, not 404.

**Fails loud on misalignment.** Responses are paired to applicants BY INDEX, so a dropped or duplicated response would attribute one applicant's tickets to another — a wrong finding about a named person. A count mismatch throws rather than guessing.

`path_used` reports whether the exact ERP path or the tree-walk fallback produced the rows, so a silent schema change is visible in the run instead of quietly emptying the population.
