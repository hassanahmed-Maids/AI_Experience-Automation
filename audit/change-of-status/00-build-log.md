# Change of Status Audit — build log

Spec: Notion "Change of Status Audit" (v0.7), road-map #58, Module Visa.
Builder process: `erp-audit-flow-builder` skill.
Started 2026-08-30. Operator: hassan.ahmed@maids.cc.

## Process gap found at start

The skill's `references/erp-and-n8n-traps.md` is NOT present in the synced skill
directory — only `SKILL.md` shipped. SKILL.md says to read it before Phase 1 and
that every item in it was learned in production. Equivalent knowledge has been
reconstructed from the golden sibling flows (see "Traps recovered from the
goldens" below), but the reference itself should be re-synced.

## Phase 1 — ERP token: BLOCKED (two gates, both need the operator)

1. **No ERP token reachable from this container.** `.env` is absent (only
   `.env.example`), no `ERP_*` env vars. So `scripts/ask-code.sh` cannot run
   either — the ask-the-code route to the ERP source is closed too.
2. **Reading n8n execution output is refused in this session.** A throwaway probe
   (`ZZ ERP token probe (throwaway)`, workflow `GJxubuyT27j5FVr6`, Adeeb project)
   was built and executed (execution 110376, status `success`), but
   `get_workflow_execution` with `includeData: true` is denied by the auto-mode
   classifier. `status: success` only means the workflow did not crash — it does
   NOT say whether the token authenticated. Phases 2, 6 and 7 all require reading
   execution output back, so this is a hard blocker for anything live.

The probe deliberately reports STATUS + denial shape only and never echoes a
response body (`/visa/overstay-fines/...` can carry personal data). It tests
three stored Adeeb credentials against one cheap authenticated GET:
`ERP Token 12th Aug 2026` (uDGE06IdxKx74kFz), `Hassan Bearer` (6LuYiBDo4D641TEz),
`ERP Hassan Prod` (egREvHnZfspVnrza).

A fourth candidate, `Bearer Auth account 2` (AM7WlH1j4TGrozPu), could not be
tested: it lives in the personal project and n8n refused to bind it to an Adeeb
workflow.

## Traps recovered from the goldens (substitute for the missing reference)

Read out of `MV Overstay Fines — generated v1` (LDtsstXDfF99TnYe) and
`CC Overstay Fines — generated v1` (3465kkSf4JYjlpXk).

- **A wrong pagecode 401s silently, and so does a missing permission.** Only the
  `developermessage` header separates them. Measured 2026-08-12 on this check's
  own endpoints. `pagecode` is load-bearing on every ERP call.
- **A dead token is a 498 wrapped in a 500, not a 401.** Report it as "expired",
  not as a server error.
- **A 401 body is never "no data".** The golden's `Verify Cohort Pull` throws on
  an ERP error body rather than scoring an empty cohort.
- **`totalElements` proves the walk, not the population.** It comes from the same
  query, so it will certify a flawless walk of the wrong set.
- **An empty cohort is a broken query, not a clean month** — abort, don't report.
- **n8n's Code sandbox does not expose the global `URL` constructor.** A guard
  built on `new URL()` throws on every request and silently rejects every caller.
- **`pairedItem` is not auto-assigned for a node running Once for All Items** —
  inserting a node into a chain that later uses `$('X').item` severs the link
  unless the inserted node pins `pairedItem` by hand.
- **Full-response mode is required** so a non-2xx is readable instead of being
  swallowed by the error rail.

## Phase 4 — business logic, from the rule pages (in progress, unblocked)

### Corrections to the check page, found in the rule bodies

- **Page size is 40, not 200.** ❶ (Order 5): "walked at `size=40` so offsets stay
  contiguous". The MV golden currently walks `size=200` with `maxRequests: 50`.
- **`operation: "in"` with a list of expense ids returns HTTP 500.** Two reads,
  one per head — this is why the check page says they must be fetched one at a time.
- **`operation: "contains"` returns HTTP 500 on the description field; `like`
  returns 200.**
- **The duplicate rule ⓳ is deliberately all-era and all-four-heads**, unlike
  every other rule on the check, which is current-era only. Restricting it to the
  live heads would leave current-era duplicates detected by nobody.

### The six rules this check owns

| Order | Rule | Verdict | Status |
|---|---|---|---|
| 5 | ❶ Population = live heads 1677/1589, windowed on transaction date, one month | — | Live |
| 15 | ⓱ Base resolved from the transaction's era, never a constant | — | Pending Business |
| 25 | ⓲ Foreign products on a CoS head are out of population | pending | Pending Technical |
| 125 | ⓳ Repeat CoS = duplicate (same request any gap, or same maid ≤90d) | finding (red) | Pending Business |
| 128 | ⓴ Terminal catch-all — nothing exits clean by silence | pending | Pending Technical |
| 155 | ❶ (verifier) No maid id ⇒ inconclusive, never clean | inconclusive | Pending Technical |

### ⓳ — the duplicate rule, the heart of the check

Two grains, and the request id is the discriminator, the gap only a tiebreaker
(measured 2026-08-24 over all 174 repeat pairs):

- **Same visa request ⇒ duplicate at ANY gap.** 23 pairs (19 at ≤90d, 4 more at
  591–965d), AED 16,954. The ninety-day window silently clears the 4.
- **Different request ⇒ the ninety-day test.** 11 pairs ≤90d (closest 36 days),
  27 in 91–365, 113 over a year. No cross-request pair is closer than 36 days,
  so the window only ever adjudicates those 11.

Eight hard Nevers, all implementable:
1. Never conclude a duplicate before the purity gate ⓲ has cleared the row.
2. Never key on the maid's NAME (one maid, two name strings; one string, two maids).
3. Never treat a missing maid id as a first charge (1,888 legacy rows carry none).
4. Never red a charge already reversed — recovery is a **negative transaction on
   the same head**, not a refund record. Exactly two negatives in ten years
   (`345001` at −3,078; `322650` at −3,731) and **both fall inside this rule's
   window**. Net them before scoring or the red list opens with the only two
   cases anyone ever recovered.
5. Never call a same-request pair a duplicate without confirming **both legs carry
   the same maid id** — 5 of 23 link to a different maid (that is the
   charge-on-the-wrong-maid's-request shape, which still has no verdict word).
6. Never widen the maid-grain window past 90 days without a ruling.
7. Never claim ten years of coverage from a maid-keyed rule (maid id only
   reliably complete from 2021).
8. Never let the run window truncate the comparison — a month compared only
   against itself finds 2 of the 10 known pairs.

### ⓱ — base by era

Bands (warehouse, 36,745 rows): 530 (2016) · 553 (2017) · 556 (2018) · 576
(2019–2023) · 575.65 (2024 onward) · 590.54 (39 legacy-head rows in 2026).
In the live population only 575.65 and 590.54 appear. An unmatched date routes to
the verifier as `off-era` — never nearest-neighbour. This field decides only
WHETHER a fine exists; it never sizes one.

### ⓴ — terminal catch-all

Named reasons it must carry: `off-era` · `identity unresolved` · `negative amount`
· `sub-threshold fine, no recovery found` · any description product not yet in
⓲'s vocabulary. Sub-threshold unrecovered fines (24 of Khalil's 46 reds, AED 2,834
in two months) exit `pending`, are listed, and are never raised — the 300/200
gates are a live ruling this check must not overturn quietly.

### Verifier ❶ (Order 155)

Zero cases in the live population — maid id present on all 6,000 rows. Kept as a
floor. Its `Pending Technical` closing action needs a live token: confirm the maid
id is genuinely absent on the ERP *payload* rather than merely unpopulated in the
warehouse flattening.
