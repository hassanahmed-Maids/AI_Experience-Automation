# MV Monthly Payment check — owner rulings

**All three answered 2026-08-19.** Implemented and covered by tests.

| # | Question | Ruling (verbatim) | Implemented as |
|---|---|---|---|
| 1 | Materiality floor | *"yes even the little amounts Matter, 0 payments do not tho"* | No floor on small amounts — a 1-fil shortfall opens a case. A month with **nothing at stake** raises no case. `materialityFloor` stays wired at 0 with a strictly-greater-than test, so a future floor is one line. |
| 2 | Pre-collected months | *"for pre collected contracts we only care about previous months, current months don't matter"* | The shift is a real **scope** shift: auditing month M tests M−1's obligation. Supersedes my earlier label-only reading. |
| 3 | VIP flags | *"both count as vip yes, vvip and vip"* | `vip OR vVip` clears a surviving amount mismatch. `vipCountsVVip: false` restores the narrow reading. |

## What ruling 2 changed, and the trap it exposed

Ruling 2 moved the implementation back toward the literal rule, and validating it against the
ledger of confirmed red **1074171** surfaced a suppression risk worth recording:

That contract paid 2,405 every month from 2026-01 to 2026-05, **bounced in 2026-06 with nothing
received**, then paid again in 2026-07. It also **terminated 2026-06-14**. So:

- Auditing **2026-07** tests 2026-06 → the verified red fires. ✔
- Auditing **2026-06** tests 2026-05, which was paid → correctly says nothing. ✔

**But gate 2 (contract life) must bound the SHIFTED month, not the audited one.** The audited
month in the case that finds the red is July, which is *past* the 14 June termination — so
bounding gate 2 on the audited month puts the whole case out of scope and **deletes the red**.
The month whose obligation is under test is the month that has to be inside the contract's life.
Asserted explicitly in the test suite.

Same reasoning for the first-partial-month suppression: contract 1099709 starts 26 June, so
auditing July tests June, and June's amount comparison must stay suppressed there.

## One reading of ruling 1 worth confirming

"0 payments do not [matter]" is implemented as **nothing at stake → no case**, measured from the
contract's own plan amount.

A subtlety: a `BOUNCED` row recorded as **0.00** against a real plan amount of, say, 1,638 **does**
still open a case, because the money at stake is what the client owed (1,638) and nothing was
received — the zero on the bounced row is a bookkeeping artifact, not the size of the loss. If the
owner meant "a month whose bounced row reads 0.00 shouldn't open a case", that is a different rule
and would suppress genuine misses. Flagged, asserted explicitly in the tests, and worth one line
of confirmation.

## Deliberately not asked

- **Whether relief covering a fully unpaid month should clear it.** The relief signals are free
  prose with no structured amount, so the case routes to a human either way; the answer would not
  change behaviour.
- **Amount tolerance.** Already ruled in the rule body — exact comparison stands.
- **The pricing question.** Permanently out of scope, ruled 2026-08-17.
