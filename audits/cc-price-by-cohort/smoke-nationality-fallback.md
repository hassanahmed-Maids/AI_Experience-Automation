# Smoke run `SMOKE-NATFALLBACK-2` — the fallback, proven on live data

**2026-08-19.** 60 contracts at population offset 1940 (audit month 2026-07),
a slice chosen *because* it holds the densest cluster of maid-less contracts in
the population — 13 of them. A random 60 would have contained about 2.

## Result

| | |
|---|---|
| in scope | **60** (0 out of scope — the slice was picked for it) |
| green | 32 |
| above card | 13 |
| pending | 14 |
| red | 1 (AED 829/month) |

**Nationality source: 48 from the live maid, 10 from the active payment term,
2 unresolved.**

Before this change all 12 maid-less contracts in the slice were a guaranteed
`no_nationality` pending. Ten are now scored — 6 green, 2 above card, 2 pending
for unrelated gates that had already fired.

## The two that stayed unresolved are not a gap in the fallback

Both carry `cpt_status 0` and `logs_unreadable_null`, and they sit in the final
batch of five — the same batch that produced all five `logs_unreadable_null`
cases in the run. The ERP session died within about three minutes of the run
finishing (see `erp-401-pagecodes.md`), and the last batch caught it.

So the fallback resolved **10 of 10** maid-less contracts whose ERP call actually
completed. The two failures are a dead session, and they routed to `pending`
rather than being scored on an empty payload, which is the designed behaviour.

## upgrading_nationality fired zero times, and that is the expected answer

Thirteen cases report `unimplemented_tests: upgrading_nationality` — the 10
resolved off the payment term (the self-comparison guard correctly declares the
test untestable when the nationality *came from* the term) plus 3 whose CPT call
failed. The other 47 ran the test and none detected a switch.

That matches the separate 14-contract sample where the term's nationality agreed
with the contract's current maid 14/14. The state is genuinely rare; a sample of
60 finding none is the expected result, not evidence the test is inert. The
assertions are what prove the test fires — 15 of them, including three mutation
checks that each broke the suite.

## What the run also caught

`chunk.offset` was accepted by the webhook and silently discarded by Stage 1
(hardcoded `offset: 0`). The first attempt at this smoke therefore scored
contracts 0-59 — the newest contracts, every one out of scope — and reported
"60 of 60 out_of_scope" without erroring. It was only visible because the sample
had been *chosen* to contain 13 maid-less contracts and returned zero. Fixed;
see `decisions.md`.

## Timing, measured rather than modelled

60 contracts in 107 s = **1.78 s per contract**, ~8.9 s per batch of five. The
model said 5.17 s. Chunk default moved 1500 → 1000 on the measured figure: at
1.78 s/contract, 1500 is ~44 min against the instance's 40-min kill.
