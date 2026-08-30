# E-ID Audit — build notes

Spec: Notion "E-ID Audit" v0.5 (road-map #57, module Visa). Status of this build:
**Phases 3–4 done offline, Phase 1 blocked on a token, Phase 2 not started.**

| Phase | State |
|---|---|
| 1 — working ERP token | **BLOCKED.** Needs one paste from the operator. See below. |
| 2 — probe every surface | Not started (needs Phase 1). Probe list drafted below. |
| 3 — document payloads | Done from the spec's own ERP-Variables rows, which are unusually complete and ERP-confirmed 2026-08-20. Call budget recounted below. |
| 4 — resolve business logic | Done. 13 deterministic gates + 5 verifier rules + 1 shared rule implemented or declared. 3 genuine questions remain, all already open on the spec. |
| 5 — build in n8n | Not started. Golden identified. |
| 6 — test end to end | Offline leg done: `scorer.test.js`, 53/53, all six spec cases reproduced. Live legs need Phase 1. |
| 7 — validate | Partial; population proof needs Phase 2. |

## What is built

`scorer.js` — the deterministic layer, ACP Orders 10–130, as standalone Node.
`scorer.test.js` — 53 assertions: the five named spec cases, the sixth
false-positive trap, and a guard for every edge the ERP-Variables rows name.

Run: `node audits/e-id/scorer.test.js`

This is deliberately standalone and tested before anything is built in n8n, so it
is a fixed reference: if a later refactor moves a known-good number, the refactor
is wrong. Reference data carries a checksum (`afe2ba7f`, 8 heads / 2 fee eras)
asserted before scoring.

### What the offline run reproduces

All six spec cases land where the spec says, from logic written against the rule
bodies rather than fitted to the answers:

- maid 21014 → **finding** at Order 50 (gap 0 days, the double submit)
- maid 28099 → **clean** at Order 120, never reaches a verifier
- maids 88623 / 67236 → **route to verifier** at Order 70
- maid 122251 → **pending** at Order 90, and never fires the duplicate gate
- maid 105395 → **route to verifier**, not a duplicate (the false-positive trap)
- maids 105241 / 109320 → **finding**, with the rename pairs collapsed

## Bugs the offline bench caught, in the bench itself

Writing the rename-pair fixtures at AED 354.55 on October-2025 dates failed: the
price era pivots on 2025-08-11, so those rows band OFF_PRICE and the case came
out `pending` instead of `finding`. The scorer was right and the fixture was
wrong. Worth recording because it is the exact failure the spec predicts for a
backfill — and it arrived from the *test* side, where it is much easier to
mistake for a scorer bug and "fix" by loosening the band.

## Call budget, recounted

The spec's own recount (≈1,700 detail calls/month vs a 500-call cap) is correct
and is the reason its *Still open* item 1 exists. Two things to add:

1. **The all-time history leg is not costed anywhere.** The duplicate rule is
   all-time by definition. Scoping it to "the ~30 candidate maids a month" is
   circular on an ERP-only build: you cannot identify the candidates without
   already having maid ids on all ~1,700 rows. Doing it honestly ERP-only means
   maid ids across the whole 20-month book (~30,000 rows), not 1,700.
2. **One probe could dissolve the whole question**, and it is not in the spec:
   does `advancesearchNew` accept a *filter* on the housemaid id even though it
   does not *return* one? If it does, all-time history per candidate maid costs
   ~30 calls instead of 30,000. Worth probing before anyone decides anything.

## Spec corrections filed

Nothing in the ERP-Variables rows contradicted the ERP evidence they cite — the
rows are in better shape than the skill's Phase 3 usually finds. Two things the
spec does not state and the build needs:

- **The expense heads of two test cases are not recorded.** Maid 122251
  (1708354 / 1711755 / 1711756) and maid 105395 (1487393 / 1490563) have amounts
  and dates on the spec but no head. Both are assumed `1682`/`738` in the bench
  and marked `ASSUMED`. This is load-bearing, not cosmetic: if the two 84.00 rows
  sit on a different head from the 353.91 row, they fall into a different case
  and 122251 stops parking at ❾. Confirm with the detail call in Phase 2.
- **A replacement may not share its application's phase.** Test cases put 454.62
  rows on both `748` (RENEW) and `1682` (NEW), so replacements are booked to both
  phases. If a maid's application is on a NEW head and her replacement on a RENEW
  head, they land in different cases and rule ❻ never fires — the replacement row
  then falls through to Order 130 rather than routing to a verifier. Measurable
  in Phase 2; not a question for a human.

## Declared gaps (each inflates `pending`, none clears anything silently)

- **Orders 80, 90, 110 and both 2026 short-lived bands park as pending** because
  the underlying charges are unnamed. On a May–June 2026 window that is ~1,022
  extra pending rows. Blocked on *Still open* items 2 and 3.
- **Verifier ❶–❺ have no readable input.** `eid_replacement_reason` and
  `eid_recovery_evidence` come back `UNKNOWN` on every row, so Order 70 routes
  **every** replacement to a human — ~121 rows / 1.2% of a six-month window.
  The deterministic layer is complete; the verifier layer is a human queue until
  an evidence source is found. Phase 2 should probe for one.
- **The flowchart's two unbuilt rules** (1-year vs 2-year option; fine
  responsibility) are NOT PASSED by design and are held on the spec.

## Phase 2 probe list (drafted, not run)

Population `POST /accounting/transactions/page/advancesearchNew`, pagecode
`ManageTransactions`, one call per head with `operation: "="` (a list with
`"in"` returns HTTP 500). Then, in order of how much they change the build:

1. Does the search accept a **housemaid-id filter**? (see Call budget, above)
2. Is there any route returning transactions **with `housemaids[]` inline**?
3. `GET /accounting/transactions/{id}` on the six test transactions — confirms
   the two assumed heads and the maid ids.
4. An evidence source for the replacement reason (complaints / notes / threads).
5. A wrong-pagecode control, to separate a missing permission from a bad
   pagecode — both return 401 and only `developermessage` distinguishes them.

## Golden to clone

`ZZ R-Visa probe (throwaway, read-only)` (`EQJKewOEsOVjDQO8`) for the probe
rails — same endpoint, same header set, correct `returnFullResponse` +
`ignoreHttpStatusErrors` shape. `CC Overstay Fines — generated v1`
(`3465kkSf4JYjlpXk`) for the check rails: same expense-head population shape,
same per-maid grouping, same delivery. Both in the Adeeb project.
