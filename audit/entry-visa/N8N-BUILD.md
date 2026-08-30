# The n8n build — what exists, what it proved

**Flow:** `Entry Visa Audit · 1-Score (draft)` — `Rr6WyZmR0ysXR1k3`, Adeeb project
**Probe:** `Entry Visa Audit · 0-Probe (throwaway)` — `bnXWEJxfUsYnwhDD` (Phase 2, blocked on grants)

Draft. Never published, never scheduled, never activated. Makes **zero ERP calls**.

---

## Why this stage takes no ERP lease

The golden sibling flows acquire the shared ERP lease (`9gVijqvtLVEhQZXz`) and run a budget
gate before their first ERP call. This one does neither, deliberately: the population is a
warehouse read and the scoring is pure, so there is nothing to pace and nothing to budget.
The lease belongs to the future enrichment stage, which is the only part that talks to ERP.

Declared in the canvas notes rather than left implied — the 2026-08-23 audit of a sibling
flow found it depending on a caller that held no lease and saying nothing about it, and an
undeclared dependency is indistinguishable from an unnoticed gap.

## The scorer node is generated, not hand-written

`audit/entry-visa/scorer.js` is canonical. `node audit/entry-visa/build-node.js` emits
`dist/score-node.js`, which is what the `Score Cases` node contains.

Same reason the golden generates its circuit breaker from `tools/erp_breaker.js`: the
offline scorer is the **fixed reference** the flow is checked against. If the two can drift,
it stops being one — someone edits the node in the UI, the offline tests still pass, and the
thing that actually runs is no longer the thing that was tested.

Two hazards were removed from `scorer.js` so the generated body can be embedded verbatim:
two backticks in a comment and three escaped apostrophes. Left in, the paste into n8n would
have terminated a string early and produced a subtly different node. The build script now
asserts zero backslashes, backticks and `${` before the code is used.

---

## Test 1 — end to end against the spec's own test cases

All seven ERP-verified spec test cases, combined into one population, driven through the
**real flow** via its webhook. Execution `110786`, status `success`.

The offline harness and the flow are given **the same fixtures from the same file** —
`test-cases.js` exports them, `e2e-payload.js` builds the payload and computes the expected
result with the offline scorer. If the two ever disagree, that is a finding about the flow,
not a fixture mismatch to be explained away.

| | expected (offline) | n8n returned |
|---|---|---|
| charge-grain cases | 9 | **9** |
| findings | 3 | **3** |
| clean | 5 | **5** |
| routed to verifier | 1 | **1** |
| pending | 0 | **0** |
| by gate | 7:3, 5:3, 6:2, 12:1 | **7:3, 5:3, 6:2, 12:1** |
| pair-grain cases | 2 (both gate 14) | **2 (both gate 14)** |
| recoverable, AED | 2,218.50 | **2,218.50** |
| pair-grain wasted, AED | 566.00 | **566.00** |
| declared gaps | GATE-7…, GATE-10… | **both, with 1 and 3 affected** |
| constants checksum | `a002fbe4` | **`a002fbe4`** |
| completeness guard | ran, delta 0 | **ran, delta 0** |

Exact match on every field.

Worth noting what the AED 566.00 is: two gate-14 findings of **AED 283.00 each**. One is
request 92147 — the SOP's own "≈283 lost" — and the other is request 115840, which arrives
at the same figure by a different route. Neither number is copied from the spec; both fall
out of the gate-14 valuation logic.

## Test 2 — the fail-closed guards actually fire

`success` means the workflow did not crash. It does not mean the guards work. Each was
driven to fail on purpose, and each was checked for the **right** error, not merely an error.

| # | Input | Execution | Fired at | Message |
|---|---|---|---|---|
| 1 | no population, no source | `110787` | `Load Population` | *"no population supplied and no source named … Refusing to score nothing and call it clean."* |
| 2 | `window_from` 2024-01-01 | `110788` | `Validate Run Input` | *"…before 2025-09-05 … An earlier window returns a silently empty population — which looks like a clean month. Refusing to run rather than reporting one."* |
| 3 | 1 row vs independent count 694 | `110789` | `Assert Population Complete` | *"population is 1 but the independent count says 694 (delta -693) … An unexplained delta is a finding about the run itself."* |

Test 3 is the one that matters most. A short read does not error, does not look empty, and
produces a perfectly plausible smaller number of findings — nothing downstream can tell it
from a clean month. Only an independent count catches it, and now it does.

---

## Output hygiene, verified on a real run

The run summary from execution `110786` carries **counts, flags and totals only**. No maid
id, no request id, no per-case amount, no name. Per-entity detail stays on the case objects,
which are bound for the case store — that store *is* "behind the case".

The summary also carries a **verifier-load warning** that fires above 60 routed cases. The
spec says 205 of 223 findings conclude deterministically and the verifier gets ~18 plus
routed exceptions, and that *"if the verifier starts receiving hundreds, a gate upstream has
stopped working"* — so the run says so itself rather than waiting for someone to notice.

---

## Deliberately not built

**ERP enrichment parsing.** It hangs on one unanswered question: does
`GET /visa/newRequest/{id}` expose `transactionId` on its embedded `expenses[]` rows? If not,
there is no ERP clock, gate 1's own population filter cannot be evaluated from ERP, and the
refund family becomes warehouse-clocked — and any parsing written now is thrown away.
Building it before the probe answers that is exactly how a flow ends up running clean and
being wrong.

**The case store and runs log.** Wired once the population source is real. A store full of
fixture rows would make a later real run hard to tell from a replay.

**Delivery.** Portal, workbook, runs log — all gated on sign-off.

## How to re-run the evidence

```
node audit/entry-visa/test-cases.js      # 23 cases, 82 assertions, offline
node audit/entry-visa/e2e-payload.js --expected   # what the flow must return
node audit/entry-visa/e2e-payload.js     # the payload to POST to the flow
node audit/entry-visa/build-node.js      # regenerate the n8n node from scorer.js
```
