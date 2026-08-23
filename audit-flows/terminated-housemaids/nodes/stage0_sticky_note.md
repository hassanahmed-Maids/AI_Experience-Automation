## 0-Fetch Profiles · sub-workflow
Called by `1-Score` once per chunk of 25 maids. Exists so the parent retains **kilobytes, not profiles** — one housemaid payload is **154 keys** and a month is 80 maids. Only the seven fields the gates and the verifier read cross the boundary.

**Pacing 2 in flight / 500 ms = 4 req/s**, the `ERP-LOAD-POLICY.md` §1 ceiling. It was **5 / 500 ms** until 2026-08-23, and this note said that matched the golden's rail — it matched an *older* golden. 5/500 is 10 req/s, two and a half times over. §1 caps the **in-flight count at 2** as well as the rate, which is a separate rule: 3/750 ms is exactly 4 req/s and still violates it, because it holds three connections open at once. Bursts are what got the ERP account disabled in June 2026.

**This flow takes no lease and runs no budget gate, on purpose.** `1-Score` acquires the ERP lease (`9gVijqvtLVEhQZXz`) before its first ERP call and releases it on both rails, and its `Resolve Maids` projects the run's whole ERP cost against the budget before chunking. A sub-workflow that took its own lease would deadlock against the caller holding it. Both facts are now *declared* in `Expand Maids` (`ERP-COMPLIANCE: lease-held-by-caller`, `budget-gate-in-caller`) rather than assumed — the 2026-08-23 audit found this flow depending on a caller that held no lease at all and saying nothing about it.

**Circuit breaker in `Project Profiles`** (§5), generated from `tools/erp_breaker.js` so it can be byte-compared rather than eyeballed. `Expand Maids` stamps `erp_t0` one node before the batch fires and carries `run_id`, which is what the breaker reads. A trip stops the *remaining* chunks — within a chunk nothing can be saved, because the HTTP node returns only when its last request is done.

**Gate 30's one retry is `retryOnFail` with `neverError` off** — deliberately. With `neverError: true` the node never throws, so the built-in retry never fires and the rule is silently unimplemented. Still unreachable after the retry ⇒ `reachable: false`, which the parent scores `pending / erp_unreachable` — **never a finding**.

Responses pair to maids **by index**, so a count mismatch throws rather than attributing one maid's termination record to another.
