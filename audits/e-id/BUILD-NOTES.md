# E-ID Audit — build notes

Spec: Notion "E-ID Audit" v0.5 (road-map #57, module Visa). Status of this build:
**Phases 3–4 done offline, Phase 1 blocked on a token, Phase 2 not started.**

| Phase | State |
|---|---|
| 1 — working ERP token | **Done.** Operator token verified against the 794-row reference count. |
| 2 — probe every surface | **Round 1 done, live, 2026-08-30.** Surface table below. One BLOCKER found. |
| 3 — document payloads | Done from the spec's own ERP-Variables rows, which are unusually complete and ERP-confirmed 2026-08-20. Call budget recounted below. |
| 4 — resolve business logic | Done. 13 deterministic gates + 5 verifier rules + 1 shared rule implemented or declared. 3 genuine questions remain, all already open on the spec. |
| 5 — build in n8n | **Done.** `ABNaSxxRV6vzQTNi`, 9 nodes, DRAFT, Adeeb project. Holds no ERP credential. |
| 6 — test end to end | **Offline complete: 84/84** (53 scorer + 31 deployed-node). Live legs need a fresh token. |
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

## Phase 2 — probe results (live ERP, 2026-08-30, execution 110701)

Read-only. 17 paced calls on the operator's own token. Throwaway probe flow
`x7MwvtXZdln2Q0iS` in the Adeeb project; it holds no ERP credential.

| Surface | Route | pagecode | Status | Shape | Can the check proceed? |
|---|---|---|---|---|---|
| Population sweep | `POST /accounting/transactions/page/advancesearchNew` | `ManageTransactions` | **200** | — | yes |
| Wrong-pagecode control | same | `ManageNothingAtAll` | 401 | `PAGE_NOT_FOUND` | (control) |
| Housemaid-id filter ×5 | same | `ManageTransactions` | **500** ×5 | rejected filter clause | no such filter |
| Transaction detail ×10 | `GET /accounting/transactions/{id}` | `AddEditTransaction` | **401** ×10 | `INSUFFICIENT_PERMISSIONS` | **BLOCKER** |

### Confirmed
- **The population route is exactly as documented.** `expense.id = 1682` over
  Feb-2026 returned `totalElements` **794**, matching the ERP-Variables row to the
  row. The expense object came back verbatim. The 8-head enumeration is sound.
- **`housemaids[]` really is absent from the search row**, and `contractId` really
  is an empty string. The spec's two structural claims both hold.
- **The wrong-pagecode discriminator is `PAGE_NOT_FOUND`** in `developermessage`.
  That is what separates a bad pagecode from a missing permission, and it is why
  the detail-route refusal below can be read as a permission gap rather than a
  header mistake.

### 🔴 BLOCKER — the maid id is unreachable on the operator's token

`GET /accounting/transactions/{id}` returned **401 INSUFFICIENT_PERMISSIONS on all
ten** spec test transactions — not `PAGE_NOT_FOUND`, so the route exists and the
token may not use it. Combined with the other two results, all three doors to the
maid id are shut:

1. the search response does not carry `housemaids[]`;
2. the search rejects a housemaid-id filter under all five property spellings tried
   (all HTTP 500 — and none returned the unfiltered count, so nothing was silently
   ignored);
3. the detail route, the only documented source, is refused.

**Consequence, and it is the whole check:** ACP ❷ (identity) can never be satisfied,
so every row parks unidentified, so ❺ (the duplicate rule) can never fire. The check
would run clean and find nothing. This is not the spec's call-budget problem — a
raised ERP budget does not help, because the calls are refused, not expensive.

This reframes *Still open* item 1. The question is no longer "ERP or warehouse,
which do we prefer" — **ERP cannot supply the population's identities at all on this
account today.** Either the permission is granted, or the population is a warehouse
read, which is a handover to the ERP/Data team rather than something to build here.

### Spec correction filed
`cc_overstay_txn_maid_id` records the maid id as *"Confirmed present and correct on
all five E-ID test-case transactions (1763388, 1763389, 1770515, 1489422, 1764251),
housemaids[] length 1 on each"*, read 2026-08-20. **On the operator's token on
2026-08-30 all five are 401.** Either that verification was made on a different
login, or the permission changed in ten days. The row should record the account the
read was made on; a "Confirmed" that does not name its login is not reproducible.

### Free win (pending round 2 read)
`vatAmount` and `vatType` are on the **search** row. The spec requires the VAT basis
to be read from ERP rather than the warehouse and implies the detail call for it. If
those fields carry real values inline, the comparison basis needs no detail call at
all. Round 2 (execution `110802`) checks this; the result is stored but unread —
the execution-read tool was intermittently refused.

### Undocumented fields on the search row
25 keys, of which the spec names five. Also present: `vatAmount`, `vatType`,
`supplier`, `paymentType`, `attachments`, `revenue`, `fromBucket`/`toBucket`
(+`...IsSecure`), `isDescriptionSecured`, `previouslyUnknown`, `qashioTransactionId`,
`license`, `creationDate`, `pnlValueDate`, `paymentId`, `id`.

## Phase 2 probe list (round 1 run; items 4-5 outstanding)

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

## Phase 5 — the built flow

**`E-ID Audit — generated v1 (draft)`**, workflow `ABNaSxxRV6vzQTNi`, Adeeb project.
DRAFT: never published, never scheduled, **no ERP credential attached** (confirmed
by read-back — the trigger reports "No credentials required"). The token arrives
per run in the request body.

Nine nodes, linear:

| # | Node | What it guarantees |
|---|---|---|
| 1 | Run Webhook | Manual only, per the spec's trigger rule |
| 2 | Guard and Reference | Token shape, window shape, and the **reference checksum** (`afe2ba7f`) — a moved constant aborts the run rather than rescoring the population against a new yardstick |
| 3 | Sweep Population | 8 heads × `operation "="`, `size=40`, 250 ms pacing. Asserts `pulled == totalElements` **per head**. Projects `description` away immediately |
| 4 | Resolve Identity | **One** preflight detail call decides availability; a refusal skips enrichment entirely rather than firing ~1,700 refusals at ERP |
| 5 | Score Cases | ACP Orders 10–130, first-match-wins |
| 6 | Write Runs Row | Runs log written **before** the case payload, per the standing build rule |
| 7 | Fan Out Cases | One item per case |
| 8 | Write Cases | Per-entity amounts and identifiers land in the case store, never the summary |
| 9 | Summarise | Counts, flags and totals only; declared gaps printed loudly |

Data tables: `EID_Runs` (`0k5TZZffQ6Mp38eS`), `EID_Cases` (`9FMtncMg3RKTrTHi`).

### Two design calls worth stating

**The zero-population stop is per-run, not per-head.** The heads are era-bound
(cutover December 2025), so a zero on one head is *normal* for a window on the
other side of it. Aborting per-head would abort every 2026 run. Aborting only when
all heads are empty is what ACP ❶'s run-stop actually means.

**Identity is decided by one call, not by 1,700 failures.** The naive build fires a
detail call per row and collects ~1,700 refusals. The preflight settles it once,
then the run proceeds honestly degraded.

## Phase 6 — test results

**Offline: 84 assertions, 0 failures.**

- `scorer.test.js` — 53/53. The standalone scorer: all five spec cases, the sixth
  false-positive trap, and a guard per named edge.
- `flow-score-node.test.js` — 31/31. The **deployed** node body, fed the shape the
  flow actually produces.

The degraded-path block is the one that matters for this build. Fed the real
duplicate (maid 21014's two 353.91 rows on 2026-02-24) **with no identity**, the
flow returns `pending` for both — it neither claims the finding it cannot prove nor
clears rows it never examined. Asserted explicitly:

```
NOTHING is cleared                              clean = 0
NOTHING is called a finding                     findings = 0
every case fires gate 20 only                   rules_fired = ["20"]
no maid id is invented                          maid_id = [""]
the real duplicate is neither found nor cleared verdict = ["pending"]
```

A partial identity budget is covered too: when enrichment resolves some rows and
runs out of budget on the rest, the unresolved rows still park — a half-finished
enrichment never clears the remainder.

**Live legs outstanding** (need a fresh token — the probe token expired 22:00 UTC):
1. live-small: one head, one week, `smoke_heads_only` — confirms paging, the
   completeness assert and the data-table writes against real rows;
2. live-full: one month, all eight heads — confirms the population count against
   the independent per-head figures already measured, and the ~50-call budget.

## Phase 7 — validation status

| Required | State |
|---|---|
| Test results vs every spec case | Done, 84/84, figures above |
| Field-level diff vs the golden | Not produced — this is not a clone of a golden; the rails were rebuilt because no sibling shares the era-banding or the rename collapse |
| Population proof + independent count | **Partial.** Head 1682/Feb-2026 proved at 794 against the warehouse-derived reference. Full 8-head proof needs the live-full run |
| Declared gaps | Done — identity, window-scoped duplicate rule, unwired delivery |
| Spec corrections filed | Done — `cc_overstay_txn_maid_id`, plus the two undocumented test-case heads |
| What still needs a human | Identity permission; open items 2/3/4; sign-off before any real run |

### Not wired, and deliberately so
Security Room portal, the colour-coded workbook, and the draft email to Malaz. The
runs log and case store are wired. The spec calls for all five; the other three need
credentials and destinations nobody has given me, and inventing them would be worse
than leaving them declared.
