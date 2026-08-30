# R-Visa Audit — build notes

Spec: **R-Visa Audit v0.6** (Notion `3c2fe1c78bf0817190fac75010bf9703`), plus the
18 rule rows tagged `Check = R-Visa Audit` and the check's 20 ERP-variable rows.

Status as of 2026-08-30: **deterministic scorer built and passing 91/91 offline.
ERP probing (Phases 2–3) and live testing (Phases 6–7) are blocked on a working
ERP token.** Nothing has been built in n8n beyond a throwaway read-only probe.

---

## Phase 1 — ERP token: BLOCKED

Both existing credential paths were tried before asking for anything. Both fail:

| Path | Result |
|---|---|
| n8n instance var `ERP_AUTH_TOKEN` (used by the shared *ERP read executor*) | **not set on this instance** |
| Stored credential `ERP Token 12th Aug 2026` (`uDGE06IdxKx74kFz`, Adeeb project) | **expired** |

The expired token returns **HTTP 500**, not 401:

```
{"status":500,"error":"Internal Server Error",
 "message":"Token not valid, {Token is expired}",
 "path":"/accounting/transactions/page/advancesearchNew"}
```

Evidence: workflow `EQJKewOEsOVjDQO8`, execution `110373`.

Needed from the operator: **the bearer token and the numeric device id**
(`secc-ch-ua-platform`), session-lasting. Taken as a runtime payload per run — not
written into a stored credential, and never a literal in a Code node or header.

**The token must be the operator's own.** ERP logs every read under the token's
identity, so a borrowed token attributes findings about named clients to someone
who did not produce them — and where that person also reviews the check, the
reviewer becomes the actor in their own evidence. If the operator's account lacks
a permission this check needs, that is a finding to report, not an obstacle to
route around.

## Phase 2 — probes: WRITTEN, NOT YET RUN

Probe flow `EQJKewOEsOVjDQO8` (*ZZ R-Visa probe*, Adeeb project, draft, read-only,
7 calls, serial). It emits statuses, envelope shapes and counts only — no names,
no amounts. Archive it after use.

| # | Surface | pagecode | What it settles |
|---|---|---|---|
| 1 | `POST /accounting/transactions/page/advancesearchNew` | `ManageTransactions` | token liveness |
| 2 | same, wrong pagecode | `AddEditTransaction` | separates a missing permission from a wrong header — both return 401 |
| 3 | same, dedicated R-visa head | `ManageTransactions` | **does the list payload carry a maid id?** — see the budget problem below |
| 4 | same, generic head, 2025 | `ManageTransactions` | the pre-cutover leg |
| 5 | same + `description like R-VISA` | `ManageTransactions` | can the server filter on text, or must the pre-cutover legs be sieved client-side over ~10× the rows |
| 6 | `GET /accounting/transactions/1486146` | `AddEditTransaction` | detail shape; spec test case 1 |
| 7 | `GET /visa/overstay-fines/housemaid/105870` | `VisaProcessingPage` | whether R-visa fines surface on the sibling route |

Four surfaces the check needs and for which **no route is established at all** —
these need `ask_erp_code` against the visa module once the token works:

- the **visa request / task history** (⓫'s preferred discriminator, and ❿)
- the **cancellation type** per maid (❿ — the sole clearance for a duplicate)
- **rejection status** and **refund-request date** (⓬, verifier ❸ — never observed on a payload)
- **contract term** and **issued visa validity** (❻ — we hold one side of the comparison only)

## Phase 3 — the call budget does not close, and the spec's mitigation has a hole

The spec budgets **500 calls/run** and proposes scoping the per-transaction detail
calls to two slices: fine-bearing rows (identifiable from the list payload by an
amount above the base fee) and repeat-payment candidates (*"identifiable by
grouping the list on whatever key it does carry"*).

**The second slice cannot be built that way.** A case is one maid carrying every
payment she has ever had, and ⓫ must key on the maid id — rule ❷ measures the
name-keyed alternative at ~4% precision (56 groups, 54 of which resolve to more
than one maid id). If the list payload does not carry a maid id, then identifying
repeat-payment candidates *requires* the maid id you were trying to avoid
fetching. The mitigation assumes its own conclusion.

So the architecture turns entirely on **probe 3**:

- **List payload carries a maid id** → one all-time sweep, ~48,192 rows at
  `size=200` ≈ **241 calls**, everything else client-side. Comfortably inside 500,
  and the duplicate question is fully answerable.
- **It does not** → a maid id costs one `GET /accounting/transactions/{id}` each.
  All-time that is ~48,000 calls; a month is ~1,400 against a budget of 500. **A
  flow built this way trips the breaker on its first run.**

If probe 3 comes back negative, the option I'd recommend — and would want signed
off rather than assumed — is to use **Snowflake to identify the candidate maid ids**
(its `TRANSACTIONS` view carries `HOUSEMAID_ID` on the very same rows) and **ERP to
confirm each candidate**, which is consistent with the spec's own division:
*the warehouse measures and explores, ERP is the authority*. Note the standing
org rule that recurring or scheduled warehouse pulls go to the ERP/Data team —
this check is manual-trigger only, which is why it is worth raising rather than
just building.

Also unresolved until a live walk: the spec's population figures are **warehouse
counts, not an ERP walk**. Before the first real run, one month must be walked
against ERP with `pulled == totalElements` asserted. A total from a paginated read
is worthless without it, and page 0 returns the newest rows, so *not found* and
*does not exist* are indistinguishable.

## Phase 4 — business logic: resolved, no blocking questions

Every open ruling in the spec already carries either a stated `Verdict` or a
conservative default, so none of them meets the bar for a blocking question
(spec-silent · unprobeable · outcome-changing · no safe default). Implemented as
written, flagged where it matters:

- **❽ — is a day-count shortfall a finding?** The rule's own `Verdict` is
  `finding (red)`, and red is the non-clearing direction. Implemented as red.
  This is the check's decisive ruling — it is the difference between ~18 findings
  a year and none — and it belongs to Malaz at sign-off, not to the build.
- **❹ which date is authoritative** — the rule already answers operationally:
  park the disagreements rather than pick a side.
- **❾ 601 days / ⓫ 30 days** — empirical boundaries, implemented as written. The
  measurement says 30 is probably the wrong band (the 31–90 band is *more*
  enriched for the double-payment signature than the 0–30 band that reds), but
  widening it is a business decision with 69 pairs behind it.
- **⓬ / verifier ❸ rejection sub-audit** — a rule the source states and never
  defines. Scored as not-passed, routed, and declared as not-executed in the run
  summary rather than quietly absorbed.

### Spec corrections filed

**1. ❺'s arithmetic justification is wrong, and implementing it literally
produces a check that reports nothing.** The rule body says the three base fees
*"differ by 10.81 and 100.00 — neither a multiple of 50 — so two bases can never
both fit"*, and on that basis instructs: park if more than one qualifies.
But `446.65 − 346.65 = 100.00 = 2 × 50` exactly. So 346.65 fits **every** amount
that 446.65 fits, always, with two extra fine days — the park clause fires on the
entire main-base population and every record exits `base-fee-unresolved`.

The failure mode is the expensive one: the flow runs clean, reports zero findings,
and looks like it simply found nothing.

Implemented tie-break: **take the highest base that fits, and annotate the
ambiguity on the record.** A fine is the rare exception (25 of 14,409 positive
2025 rows, 0.17%), so the parse implying the fewest fine days is right. This
reproduces every figure the spec verified independently — 92 fine days on
`1641662`, 54 on `1526423`, 2/7/9 on the three 2026 overcharges — which the
park-on-ambiguity reading cannot produce at all.

**2. Two test cases expect `clean` where the rules as written produce `pending`.**
Test case 2 (maid `61273`, 819-day gap, both payments on `NEW` heads) and test
case 3 (maid `94824`, two visa cycles) are both recorded as *clean*. But only ❾
and verifier ❶ can produce clean, and neither reaches these pairs: ❾'s day-gap
fallback is scoped to *"rows predating the December 2025 taxonomy"*, and ⓫
produces no verdict for payments in different cycles. Both land on the ⓭ floor as
`pending`.

`pending` is the safe direction and the shared requirement — *not red* — holds
either way, so this is implemented conservatively rather than forced to match the
table. Two things need stating in the spec: **which payment of a straddling pair
decides "predating the taxonomy"** (implemented as the earlier one, which is what
makes test case 2 come out clean), and **whether "different visa cycles" should
produce a clean rather than falling through**.

**3. ❺ vs test case 6.** The spec says transaction `1536291` (AED 798.05) *"must
reach ⓭ as pending"*, but ❺'s own `Verdict` property is `pending` and ❺ is where
the amount fails. Implemented at ❺, same verdict, more precise reason
(`base-fee-unresolved`). Cosmetic, but the run summary attributes it differently.

### Two consequences the run summary must state plainly

- **`pending` is the majority state, by design.** Only ❾ and verifier ❶ produce
  `clean`. Every ordinary payment that no gate reds lands on the ⓭ floor as
  pending — that is exactly what ⓭ is for (*never let silence mean clean*), but it
  means a reader seeing ~48,000 pending records is seeing correct behaviour, not a
  broken run. It must never be folded into a clean count.
- **Verifier ❷ reds every fine-bearing record.** `fine_repayment_responsibility`
  has never been observed as a field, so *unassigned* is unknowable rather than
  known-false, and the rule (rightly) refuses to default to the company bearing
  it. That is ~25 records a year, AED 26,900 of fine days in 2025, none ever
  assigned. Declared as an inflation, not presented as 25 discoveries.

## Phase 5–7 — status

- **Scorer built and tested offline: 91/91**, covering all six spec test cases,
  the three 2026 ❼ overcharges (reproducing the stated 4 excess days / AED 200),
  both population eras, all four deliberate exclusions, and guards for every edge
  the rules name (three bases, non-integer remainder, suppressed date, missing
  anchor, ambiguous anchor, blank-expense client refund, null maid id).
  Run: `node audit/r_visa/scorer.test.js`
- **Not started:** the n8n build. The golden to clone is **MV Overstay Fines**
  (`LDtsstXDfF99TnYe`) — same ERP surfaces, same fine arithmetic, and its rails
  (ERP lease, pre-flight budget gate, cohort-pull verification, runs-log-before-
  payload, data tables, draft-only delivery) are already proven. Its execution
  shape cannot be copied wholesale: MV Overstay is window-scoped, this check is
  all-time per maid.
- **Not started:** live testing. Needs the token.

## What needs a human

1. **The ERP token + device id** — one paste, the operator's own. Blocks everything.
2. **Sign-off before any run against production**, and before publishing or
   scheduling. This check's findings name real clients and real money; the spec
   names **Malaz** as reviewer and requires independent review before delivery.
   Build completion is not approval.
3. **Not blocking, but Malaz's to answer at sign-off:** ❽'s decisive ruling, and
   the three spec corrections above.
