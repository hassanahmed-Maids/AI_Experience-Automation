# DNA ticket drafts — R-Visa fee audit

Extracted from `SPEC_r_visa_audit_v1.md` §7. **Not filed.** Paste each body into Jira after sign-off.
Field values that pass DNA validation: `OKR = 1-3`, `Domain/Department = Money Control`,
`Priority = Not Urgent`. Set the issue type after the intake bot's pass — automation re-types new
tickets to `" New Request"` on creation.


> ⛔ **These are drafts. They must be confirmed by the requestor before anyone files them.**
> An earlier attempt filed them as **DNA-9529** and **DNA-9530** on 2026-09-06 without that
> confirmation. Both are now **Cancelled** with a withdrawal comment, and both had already been
> auto-assigned to a person (Bilal Alsayed and eddy.elrahi), so those two were notified. The Jira
> connector exposes no delete; removing the records entirely needs a project admin in the UI.
> **Do not reuse those keys — a re-file is a new pair of tickets.**
>
> **Rewritten 2026-09-06 against §8.** The withdrawn versions asserted a flat 60-day overstay grace
> and quoted fine-direction counts measured under it. Both are corrected below.
>
> **Duplicate search: done, 2026-09-06 (O2 closed).** DNA searched project-wide by summary and by
> full text for `R-visa`, `overstay`, `visa fee`, `duplicate payment`, `VISAREQUESTEXPENSES`,
> `LOST_VISA_EXPENSES`, `MISSING_EXPENSES`. **No ticket or model audits R-visa *fees*.** Every R-visa
> item in DNA is a process-speed KPI or a step-blocker alert. Two neighbours matter — O15 and O16.
>
> **Set the issue type yourself on creation** — Jira automation re-types new tickets to `" New Request"`.
> On the withdrawn pair it did so twice and reverted the correction both times, so expect to fix the
> type after the intake bot's pass rather than at creation.
> **Precedent to mirror:** DNA-9454 / DNA-9455 (P&C, eleven metrics, same AE→BI split); a second P&C
> audit pair is DNA-9446 / DNA-9449. Field values that pass validation: `OKR = 1-3`,
> `Domain/Department = Money Control`, `Priority = Not Urgent`.

### Ticket 1 — `Analytic Engineer Task` (draft)

**Summary.** `R-Visa fee audit — silver model: per-payment tests + per-maid verdict`

**What we need.** Police & Control audits every residence-visa fee paid for a CC or MV housemaid, to
catch a second fee inside one visa term, an overstay fine that disagrees with the dates, and a fine
nobody was made to repay. Everything the model reads is already in `BA_VIEWS` — `VISA_SILVER.VISAREQUESTEXPENSES`
and `MONEY_CONTROL_SILVER.TRANSACTIONS` — plus two ERP config reads named below.

> **No new object, grant, warehouse or pipeline is requested for the model itself. The ask is narrow:
> build one silver model at payment grain carrying nine test outcomes and one verdict column, plus a
> case-grain roll-up. The business logic is attached in full — you do not need to reverse-engineer it.**

**Playbook fields.**

| Field | Value |
| --- | --- |
| `TaskCategory` | New Snowflake model |
| `TargetSchemaOrDomain` | `VISA` (silver), consumed by Police & Control |
| `ModelName` | `RVISA_FEE_AUDIT` (payment grain) + `RVISA_FEE_AUDIT_CASES` (maid grain) |
| `Layer` | SILVER |
| `Grain` | One row per R-visa payment; roll-up one row per maid, all-time |
| `BusinessGoal` | Detect duplicate residence-visa fees and mis-stated overstay fines |
| `Consumer` | Police & Control (Security Room portal, workbook, email draft) |
| `SourceData` | D1–D4 plus the two ERP config reads (E1, E2) |
| `HistoricalBackfill` | Full history — the duplicate scan is all-time by design, not window-scoped |
| `BusinessOwner` | Malaz (Police & Control) |
| `Dependencies` | Blocks Ticket 2. Warehouse grant blocks verification, not build. **E1/E2 block the fine tests** |
| `OutOfScope` | Office staff; salary rows; client refunds; entry visa / MOHRE / change-of-status / EID / ILOE; VAT; **missing** R-visa payments (a separate check) |
| `References` | `SPEC_r_visa_audit_v1.md` §8; Notion *R-Visa Audit*; SD-67794 |

**The metrics, by fixed name and id.** M1 population · M2 cases · M3 amount at risk (money already
gone) · M4 duplicate exposure · M5 fine overcharge exposure · M6 fine undercharge exposure ·
**M6a underpaid exposure, reported separately and never summed into M3** · M7 unassigned-responsibility
exposure · M8 exception rate · M9 blocked rate · M10 anchor match rate. Every card and column carries
these ids.

**Verdict algebra.** Every test returns exactly one of four values — `RED(type)` / `GREEN` /
`BLOCKED(reason)` / `NOT_APPLICABLE`:

```
RED    ⟸ any applicable test returned RED
AMBER  ⟸ not RED, and any applicable test BLOCKED
GREEN  ⟺ every applicable test RAN and returned GREEN
```

Four rules that must hold: **no early exit** (evaluate every applicable test, record all outcomes in
`TEST_TRACE`); **one verdict column computed once**, aggregated by every tile, chart, filter, colour
and export, with nothing re-deriving eligibility; **no fourth state** — workflow state is a separate
column and `inconclusive` is not a synonym for clean; **blocking scoped to the single test** — a
missing anchor blocks the fine tests only, while the duplicate test still runs.

**What it reads.**

| Id | Object | Used for |
| --- | --- | --- |
| D1 | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | amount, transaction date, ids |
| D2 | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE`, `VISA_REQUEST_ID`, `OWNER_ID`/`OWNER_TYPE`, `TRANSACTION_ID`, `PAYMENT_DATE` |
| D3 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | expense-head reconciliation (TO-2) |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` | expense-head reconciliation (TO-2) |
| **E1** | ERP `PARAMETERS` (`CODE`, `VALUE`) — **not yet in Snowflake** | the overstay rate and grace, per §8.1 |
| **E2** | ERP `NEWREQUEST.TYPE_OF_PREVIOUS_VISA` — **not yet in Snowflake** | selects which E1 pair applies |

**🔴 The overstay arithmetic — corrected. Read this before writing the fine tests.**

An earlier draft of this spec used a flat **60-day grace** and a hardcoded **AED 50/day**. Verification
against the ERP code on 2026-09-06 found neither is a constant:

| `PARAMETERS.CODE` | Applies when `NEWREQUEST.TYPE_OF_PREVIOUS_VISA` is | Seed default |
| --- | --- | --- |
| `tourist_visa_grace_period` | `Tourist_Visit_Visa` | **0** |
| `employment_visa_grace_period` | `Company_Sponsorship`, `Private_Sponsorship` | **30** |
| `fine_for_tourist_visa` | `Tourist_Visit_Visa` | **50** AED/day |
| `fine_for_employment_visa` | `Company_Sponsorship`, `Private_Sponsorship` | **50** AED/day |

```
grace_days        = PARAMETERS.VALUE for the code selected by TYPE_OF_PREVIOUS_VISA
rate_per_day      = PARAMETERS.VALUE for the matching fine_for_* code
implied_fine_days = GREATEST(0, DATEDIFF(day, anchor_entry_date, rvisa_payment_date) − grace_days)
```

- **`TYPE_OF_PREVIOUS_VISA` is a required input.** Null or an unmapped value ⇒ the fine tests return
  `BLOCKED(previous_visa_type_unknown)`. **Never fall back to a default grace.**
- **Read both parameters as-at the payment date.** They are configurable. If `PARAMETERS` is not
  versioned, the historical values are unknowable and the fine tests on older rows are `BLOCKED` —
  that determination is itself a deliverable of this ticket.
- **Do not hardcode 50 or 60 anywhere.**

**The joins that exist and the ones that do not.** D2 `TRANSACTION_ID` → D1 `ID` (NUMBER→NUMBER,
**nullable on D2** — an unlinked expense is amber, not dropped). D2 `OWNER_ID` → D1 `HOUSEMAID_ID`
(NUMBER→NUMBER, **D1 fill rate unmeasured**). **There is no key at all** from an R-visa payment to
the entry-visa payment that starts the clock: candidate set is same `OWNER_ID`,
`PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')`, `PAYMENT_DATE ≤` the R-visa payment. Zero
candidates ⇒ BLOCKED. More than one ⇒ compute under **every** candidate; agree, the verdict stands;
disagree, BLOCKED. **Never take the first or the latest** — of 40 fine rows since 2025, 6 have more
than one candidate and the worst choice moves the answer by 965 days. Coverage on every join is
unmeasured, because this spec was written without warehouse compute.

**Traps — each silently produces wrong numbers.**

| Trap | Cost if ignored |
| --- | --- |
| **Hardcoding the grace or the rate** | The whole fine-direction result inverts. A 60-day grace understates `implied_fine_days` by 30–60 days on every row |
| Scoping the population on a joined column (`OWNER_TYPE`, `CONTRACT_TYPE`, `STATUS`) | Records vanish from every count and total while the tie-outs still balance on the survivors. **Scope is `PURPOSE` + date only** |
| Early-exit rule ladder | A record reaches green with an applicable test silently unrun |
| Keying duplicates on the maid's **name** from free text | ~4% precise: 56 groups in 2025, of which **54 resolve to more than one maid id**. Keyed on identity the answer is **2** |
| Filtering the population on description text | Throws away **33.6% of 2026 rows (3,826 of 11,392)**; before 2025-12-19 the renewal leg says `R-VISA` **zero times in 10,855 rows**, hiding **AED 2.16M** |
| `CONTRACT_TYPE` compared without `TRIM()` | Trailing space — the CC/MV split matches nothing, silently |
| `SUM(AMOUNT)` without a range guard | Observed max ≈ **19.7 trillion** |
| `PAYMENT_DATE` without excluding the `0025-11-06` sentinel | A two-thousand-year overstay |
| Duplicate scan limited to the reporting window | 2 repeat-payment maids inside 2025 versus **182 all-time** |
| Treating `GETTING_THE_CONFIRMATION_TO_PROCEED_STATUS` as a clearance | It is the audited system's own sign-off. Display as context; it never clears a case |

**Data asks — non-blocking for the model build.**

| Ask | What it unlocks |
| --- | --- |
| **Ingest E1 `PARAMETERS` and E2 `TYPE_OF_PREVIOUS_VISA` into Snowflake, with history if it exists** | The fine tests. Without them, T2/T3 are BLOCKED on every row |
| Authority tariff for the **base fee** (dated) | **Confirmed absent from the ERP** — the fee is user-entered on `NEWREQUESTEXPENSE.AMOUNT`, there is no price list by term. Only the Visa/PRO team can answer this |
| Fine payer ruling (§8.3) | Turns T5 from blocked into runnable, and makes M7 meaningful |
| Written-clearance text + AI judgement field | Unblocks the duplicate clearance route (9 pairs all-time) |
| Visa term source | Unblocks T8 — **until then no case can reach green** |

**What needs a decision, not engineering.** The revised T5 derived from `HOUSEMAID.HOUSEMAID_TYPE`
routing (O19) · `CONTRACT_TYPE` display-and-UI-filter only, never a model filter (resolved) · M6a
reported separately from M3 (resolved) · staff creator names out of the export · ship with
`CONSTANTS_UNSOURCED` on the provenance line.

**Sensitivity — so it does not stall at intake.** No salary, no IBAN, no contact detail. The
transaction **description** field is read to compute and never displayed or exported: a sibling check
measured that same field carrying passport numbers and visa ids from 2026-01 onward (31 of 1,738 rows
in January, 77 of 1,759 in February, rising), and the share on R-visa rows is unmeasured. Maid names
are never a key and never displayed. Staff creator names are excluded from the row-level export.

**Attached.** `DNA_ATTACHMENT_source_tables.md` *(Start here)* · `DNA_ATTACHMENT_verification_queries.md`
(every measured figure with the query that produced it, aggregate only) · `SPEC_r_visa_audit_v1.md`.

**Not a duplicate.**

| Ticket / object | Status | Why it does not overlap |
| --- | --- | --- |
| **DNA-9529 · DNA-9530** | **Cancelled** | An earlier, withdrawn version of *this* pair. Filed without sign-off and quoting the superseded 60-day grace. Not to be reused or reopened |
| DNA-5725 · DNA-7915 — Alert 946, *Money Lost — Overstay Fines Not Paid by Client* | Done / live | The closest thing that exists. An **alert** on client-paid overstay fines, not an audit of R-visa fee payments; no duplicate test, no fine-vs-dates arithmetic. Overlaps T5 only — read its conditions first and **do not inherit its filter** |
| DNA-6078 · DNA-2363 — R-Visa duration tables | Done | Process-speed measures, not money. They matter only because those tables are the candidate visa-term source, and DNA-6078 is a known defect in them |
| DNA-9454 · DNA-9455 — Applicant ticketing audit (P&C) | To Do | Same department and shape, different check. The precedent, not an overlap |
| DNA-9446 · DNA-9449 — Payroll audit | To Do | Different population and sources |
| SD-67794 | Open | The n8n / ERP-API build of the same check. Different runtime; three of its four declared blockers do not apply in a warehouse build |
| MV Overstay Fines · CC Overstay Fines · E-ID Audit · ILOE Checker · Change of Status | Sibling P&C checks | Share two policies and **no constants** — MV is expense 1677 / base 575.65 / client pays; CC is expense 1589 / maid's loan pays; R-Visa is neither |

**Done when — numeric acceptance criteria.**

1. `COUNT(*) − COUNT(DISTINCT PAYMENT_ID) = 0` on the payment-grain model — the grain holds.
2. `RED + AMBER + GREEN = COUNT(DISTINCT OWNER_ID)` exactly, residual **0**.
3. `Σ REASON_CODE buckets − AMBER total = 0` in both count and AED.
4. `COUNT(*) WHERE VERDICT='AMBER' AND REASON_CODE IS NULL = 0`.
5. `COUNT(DISTINCT VERDICT) = 3`.
6. Population reproduces the reference measurement within **±0.5%** on count and AED: 2025 =
   **19,311 rows / AED 8,684,562.33**; 2026-01-01→08-28 = **11,558 rows / AED 5,220,544.65**.
   *(Unaffected by the grace correction — the population does not depend on it.)* A larger gap means
   the `PURPOSE` route and the expense-head route disagree, and that gap is TO-2: reconcile it to
   named, quantified lines, never leave it as a residual.
7. Duplicate detection reproduces **≈2 duplicate-red cases within 2025** and **≈182 repeat-payment
   cases all-time**. A result near **56** means the name-keyed rule was rebuilt — fail the build.
   *(Unaffected by the grace correction.)*
8. **Fine-direction counts are re-measured, not asserted.** The prior figures (18 of 25 undercharge
   in 2025, 0 of 25 overcharge, 3 in 2026) were computed on the superseded 60-day grace and are
   **not targets**. The correct grace is smaller (0 or 30), so `implied_fine_days` rises and the
   direction of travel is fixed — these are the testable bounds:
   - undercharge in 2025 **≥ 18 of 25 fine rows**;
   - overcharge in 2025 **= 0**;
   - overcharge in 2026-01-01→08-20 **≤ 3** (transactions `1692426`, `1706249`, `1990079`).

   A run breaching any bound means the grace or the anchor is wrong, not the business.
9. All worked examples in §5 return the stated verdict. **Example E is a T3 undercharge under every
   candidate grace** — the exposure is AED **3,900** at a 30-day grace or AED **5,400** at 0 days
   (paid 92 days; entry-to-payment gap 200 days). The verdict is the assertion; the figure follows
   whichever grace `TYPE_OF_PREVIOUS_VISA` selects. The blocked example must land in AMBER and be
   **absent from the clean count**.
10. `COUNT(*) WHERE PURPOSE NOT IN (<profiled enum>) = 0` — a run guard, because the enum in the
    column comment is truncated.
11. `COUNT(*) WHERE fine_days > 0 AND TYPE_OF_PREVIOUS_VISA IS NULL AND VERDICT <> 'AMBER' = 0` —
    proves no row was scored on a defaulted grace.
12. Anchor match rate published per period; below **90%** the fine tests are withheld for that period
    and the period is labelled unverified.

### Ticket 2 — `BI Visualization Task` (draft)

**Summary.** `[Split from <AE key>] BI: R-Visa fee audit — Police & Control exception dashboard`

**Blocked by the AE ticket** — SQL/model work always blocks the visual build. File pre-split with the
blocks link set.

**Layout, restated in the description** (a Claude artifact link is not readable by the intake bot,
which logs it `UNVERIFIED` and falls back to the description):

KPI strip `M3` amount at risk — money already gone · `M6a` exposure not yet paid, **never summed with
M3** · `M8` exception rate with its denominator `M2` beside it · `M9` blocked rate · `M10` anchor
match rate → tie-out line showing TO-1 / TO-3 / TO-4 on screen → exception table at case grain,
default sort **amount at risk descending**, columns: case (maid id, **never a name**) · contract
CC / MV / Unknown, filterable, all on by default · payment count · verdict · rule breached in the
rule's own words · amount at risk · day arithmetic (`paid 92 d vs implied 170 d`) · both transaction
ids · workflow state → one chart, fine rows by outcome per period → provenance line → row-level CSV
export.

**Filters.** Period (default current year) · contract · verdict (default Red + Amber) · workflow
state. **The period filter scopes reporting only — the duplicate scan behind it is always all-time.**

**Drill-down.** A case opens its payments: date, amount, purpose, visa request id, the anchor used,
**the grace and rate applied and which `TYPE_OF_PREVIOUS_VISA` selected them**, every test outcome
from `TEST_TRACE`, and the blocking reason where present.

**Non-negotiables.** Row colour is driven by the single verdict column and nothing re-derives
eligibility · verdict shown as **label plus icon, never colour alone** · the `M8` denominator is
visible beside it · `M9` will be near 100% on day one because three tests are blocked pending data
asks, and the provenance line must say so.

**Provenance line, always visible:** *"Base fee unsourced — no authority tariff exists and the ERP
records it as a typed-in amount. Overstay grace and rate read from ERP `PARAMETERS` as-at payment
date. Term, responsibility and rejection tests blocked — no case can currently reach green."*

**Sensitivity.** Maid ids only, never names. The description field is never displayed and never
exported. Staff creator names are excluded from the export. Per-person detail goes to the workbook
only — counts and totals in chat, run summaries and email.

**Done when.** Every tile and the row colour aggregate the same verdict column (tile counts −
`GROUP BY VERDICT` counts = **0**) · the tie-out line renders on screen with residual **0** on each
identity · CSV export contains no description field and no staff name column, asserted on the
exported header · `M3` and `M6a` render as separate figures and no view sums them · **the drill-down
shows the grace and rate actually applied to each fine row**.
