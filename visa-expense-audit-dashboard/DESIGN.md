# Visa Expense Audit — consolidated dashboard design

**For:** Police & Control auditors · **Built on:** Snowflake (view layer + Streamlit-in-Snowflake app)
**Consolidates:** seven audit specs covering the visa-expense chain in `Visa_Process_Audit_Flow.pdf`
**Date:** 2026-09-14 · **Author:** Hassan Ahmed, P&C
**Interface mockup:** https://claude.ai/code/artifact/24a78ced-ae66-4e92-a646-14161af9ea70

> **Status — this is a design reference for a DNA handoff, not a build P&C runs.**
> The DNA team builds it; this document and the SQL under `sql/` exist so they do not have to
> reverse-engineer six specs. The SQL is a *reference implementation written from the specs and
> never executed* — see §9. The ticket pack that carries it is still to be drafted, and
> **DNA-9529 / DNA-9530 (the earlier R-visa pair) were withdrawn on 2026-09-06** for being
> "raised prematurely, before the requesting team had signed off the spec", so the pack must cover
>only audits whose specs have cleared. On that test, as at 2026-09-14:
>
> | Spec | Gate status |
> |---|---|
> | **Change of status v5** | ✅ **APPROVED** 2026-09-03, "ready for the Snowflake team" — file this first |
> | **ILOE v2** | ✅ "Nothing blocking" |
> | **Medical v4** | ✅ Gate run, 11 of 15 findings accepted and fixed, 4 rejected with evidence |
> | Entry visa v1 | 🟠 Rebuilt draft; open items O2–O7, none blocking |
> | **LAWP v4** | 🔴 The gate ran on **v1 only**. v2, v3 and v4 have never been gated, and v4 adds three rules and four metrics |
> | **E-ID v2** | 🔴 The gate covers **v1 only**; v2 adds a fourth audit. Its own open item 7 says re-run |
> | R-visa v6 | 🔴 Draft — §6 decisions outstanding, and its predecessor pair was withdrawn |

---

## 1. What this is

Seven separate audit specs exist, each with its own report, its own grain, its own money
semantics and its own tie-out. Each one is right on its own terms. Nobody can currently
answer the questions an auditor actually asks across them:

- *Where is the visa-expense money leaking, in order of size?*
- *How much of it can we still go and collect, and who collects it?*
- *Which of these checks actually ran, and which parts of the process nothing is watching?*

This dashboard answers those three, without flattening the seven specs into a single
number that would be false. **The hard part of consolidation is not the SQL — it is
deciding what may legitimately be added together.** Section 3 is that decision.

The seven:

| Audit | Process step | Spec | Canonical grain |
|---|---|---|---|
| **LAWP reservoir** | Phase 1 — work permit · MOHRE insurance · labour card | `SPEC_non_used_lawp_reservoir_v4` | payment (money) / bundle (cases) |
| **Entry visa** | Phase 2 — entry visa, inside/outside country | `SPEC_entry_visa_audit_v1` | charge (M2) / maid (M3) |
| **Medical** | Phase 3 — medical fitness test | `SPEC_medical_from_visa_expenses_v1` (v4) | one fee, one maid, one visa request |
| **ILOE** | Phase 3 — ILOE subscription + fines | `SPEC_iloe_checker_v2` | finding (payment or loan) |
| **R-visa** | Phase 3 — residence visa | `Rvisa_Duplicate_Payments_v6` | case = (`VISA_REQUEST_ID`, `PURPOSE`) |
| **Change of status** | Phase 2 — change of visa status, AED 575.65 + fine | `Change_of_Status_v5` **(approved)** | one Change of Status transaction |
| **E-ID** | Phase 3 — Emirates ID | `SPEC_e_id_audit_v2` | transaction / pair / maid, per sub-audit |

---

## 2. The shape of the page

Nine tabs. Eight of them an auditor works; one proves the report is honest.

```
┌ Portfolio ┬ LAWP ┬ Entry visa ┬ Change of status ┬ Medical ┬ ILOE ┬ R-visa ┬ E-ID ┬ Assurance ┐
```

**Every audit tab has the same four bands, in the same order**, so an auditor learns one
page and then knows seven:

```
1  KPI strip       3–5 tiles, each carrying its spec metric ID (M2, R3, M7 …)
2  Filter bar      one row + a "more filters" expander
3  In-view line    what the current filter selects, against the full population
4  Exception table worst-first by amount · flag stripe + flag WORD · drill-down · CSV
```

Two rules about that layout are load-bearing and are implemented, not just described:

- **The KPI strip reports the full population and does not respond to the filter bar.**
  Filtering to `RED` must not make the Undecided tile drop to zero — that is how an
  auditor ends up believing money disappeared. The in-view subtotal sits on its own line
  directly above the table (`showing 46 of 1,900 cases · AED 21,774 of AED 658,894 in view`).
  *(Rvisa_Duplicate_Payments_v6 §4)*
- **A non-zero tie-out variance blocks the audit.** The specs are unanimous that a report
  which does not tie is itself a finding. The tie-outs are **not** bars on each audit tab —
  they are control rows on Assurance, where a failing one is visible against every other
  guard rather than as a green bar people stop reading.
  *(ILOE §5 · e-ID §3.1 · medical §4 · LAWP §4 · entry visa §3)*

### Portfolio tab

- **One card per audit**, largest first — that audit's own total, its case count, and a split
  into Recoverable / Lost / counted-not-valued. Clicking a card opens that audit's tab.
- One chart: exposure by audit, stacked by class, direct-labelled

There is **no grand total across the seven** — the reason in §3.1 stands, it is just carried by
the absence of a total rather than by a caption explaining one.

Deliberately **not** on this tab: the **UNDECIDED class**, the **coverage map**, and the
per-tab **provenance line** and **tie-out bars**. Undecided money is still computed and still
shown on each audit's own tab; coverage and the tie-outs live on Assurance. The portfolio is
worked, not read, so it carries figures and nothing that explains figures.

### Assurance tab

Every guard the seven specs demand, in one place, each with a pass/fail and an as-of stamp:
coverage waterfalls, the two-sided tie-outs, head guards, match rates, unclassified counts,
loan-snapshot dedupe checks, and the baseline-drift table (§5). Then the **coverage map** —
every check in `Visa_Process_Audit_Flow.pdf` against whether a built check covers it (§6) —
and the named blind spots inside the checks that *are* built.

---

## 3. The consolidation model

### 3.1 Money may be summed within an exposure class, never across audits ungrouped

Three specs independently forbid a single exposure total, for the same reason each time:
money with a way to get it back and money that is simply gone are different things, and
adding them tells the reader something false.

> "There is no combined exposure figure, and the report must not print one." — entry visa M6
> "Never add the MV amber figure to it … The two are reported side by side, never summed." — e-ID §3.4c
> "Do not add the two AED totals together." — R-visa §0.6

So every case carries **one exposure class**, and money sums only within a class:

| Class | Means | Tile behaviour |
|---|---|---|
| **RECOVERABLE** | A defined route exists to get this money back, and it is still open | Lead tile — this is the actionable number |
| **LOST** | Money out with no recovery route. Count it, find out how it happened | Second tile |
| **UNDECIDED** | Judgeable later, or a person/ingestion must rule first | Third tile — *the number to drive down* |
| **UNVALUED** | A real finding the spec forbids putting a price on | Fourth tile — **count only, and it says so** |

`AMOUNT_AED` is **NULL**, never `0`, on an UNVALUED row, and a separate boolean
`AMOUNT_IS_VALUED` carries the distinction — so "we found nothing" and "we found something
we may not price" can never render the same.

### 3.2 Every case says who collects it

An exposure class says what kind of money it is. The auditor still needs to know who works
the row, and the seven specs each answer that in their own words. That answer becomes a column:

| `ACTION_OWNER` | Rows | The action |
|---|---|---|
| Visa team | entry visa M2, medical M1, LAWP M5 | File / re-file / chase the government refund claim |
| Payroll — charge the maid | ILOE R2, R3; e-ID fines & CC replacements; change of status R5 | Raise the missing loan, or chase the stalled one |
| Client billing | change of status R3 (MV fines above AED 300) | Bill the client for the overstay fine the company paid |
| MV client billing | e-ID MV replacements | Blocked until the client recharge route is ingested (e-ID N1) |
| P&C | every "paid twice" row; ILOE R4 | Find out how it happened; there is no claim to file |
| Engineering | medical (robot), R-visa S1 (re-payer defect) | The finding is a process defect, and it recurs |

And `WHO_IS_OUT_OF_POCKET` — COMPANY / MAID / CLIENT — because it is not always the
company. ILOE R1 is the case where **the maid** paid twice and is owed AED 124; a report
that assumes the company is always the victim renders that row as a company loss.
*(ILOE §4, "Where the money lands on R1")*

### 3.2b One audit can carry two totals that must never be added

LAWP v4 is the case: `M7` prices paperwork nobody took, `M12 + M13` price money paid
twice, and **one payment can sit in both**. The spec's instruction is explicit — *"print
two headline figures side by side"* — so the LAWP card carries its exposure total as
normal and its **AED 485,246.97 of paid-twice separately, below a rule, with the reason
printed.** The card model accommodates this rather than choosing one figure, because
choosing would be the error.

### 3.3 Case counts may be summed; case counts across grains may not

> "An exception is one case a person has to work." — e-ID §3.4b
> "Count the cases every time; count the money once." — LAWP R8

A case is a unit of human work in all six specs, so **summing case counts is legitimate and
it is the worklist size**. But a grain is per-audit, so:

- Each audit declares **one canonical grain** for the portfolio (`CASE_GRAIN`, displayed).
- Alternate grains stay **tab-local and never enter the portfolio.** R-visa is the live
  example: the per-request grain (45 confirmed, AED 16,853.50) is canonical; the per-maid
  pair classifier (68 A-pairs, AED 29,905 gross) is shown on the R-visa tab with its own
  tiles and is explicitly excluded from the portfolio, per §0.6 of that spec.
- LAWP shows **both** its grains side by side — 202 payments / 232 bundles — because that
  spec's headline finding is that confusing them overstated a prior dashboard by 41%.

### 3.4 The six specs measure over six different windows — so the first thing this does is put them on one clock

This is the single most surprising thing about consolidating them, and it must be visible:

| Audit | Spec window | Its clock |
|---|---|---|
| LAWP | reservoir entries Sep 2025 – Jul 2026 | `CREATION_DATE` of the work-permit fee (never resets) |
| Entry visa | applications from 2025-09-05 | `VISAREQUESTEXPENSES.CREATION_DATE` — the **application** date, never the posting date |
| Change of status | one closed month (July 2026 worked); live era from 2025-12-19 | `TRANSACTIONS.TRANSACTION_DATE`, and the maid's CC/MV type **on that date** from the type log |
| Medical | fees Jan 2025 – Sep 2026 | `CREATION_DATE` of the medical fee |
| ILOE | all history from 2024-02-10 | `TRANSACTION_DATE` (payments) / `BALANCE_DATE` (loans) |
| E-ID | 12 months to 2026-08-31 | `TRANSACTION_DATE` |
| R-visa | all-time | `TRANSACTIONS.TRANSACTION_DATE`, never the line-creation date |

One period control drives every tab, and **each tab states in its provenance line which
clock its dates are on**. The consequence, stated on the Portfolio tab: the baselines in §5
reproduce only at the `Spec window` preset. Any other period is a different measurement, not
a discrepancy.

### 3.5 Nothing is GREEN by silence

All six specs converge on this, and it is enforced in the unified view:

- `GREY` is a flag in its own right — *the check could not judge this at all* — and it is
  **counted and shown beside the red count**, never folded into clean.
- A `NOT_READ` verifier run state is not a verdict and is counted apart from `NOT_RELATED`,
  so the report can always tell *read and unexplained* from *never read*.
- `GREEN` means every applicable test **ran** and passed. The tile says so in words.

### 3.6 Recovery never changes a verdict

> "A refund can never turn a RED into a GREEN … the control-failure count would fall while
> the fault stayed put." — R-visa §1

`FLAG` and `RECOVERY_STATUS` are two independent columns everywhere, and recovery is
recomputed each run and never written back. The same rule makes the workflow status
(`New / Under review / Escalated / Closed`) a column that **must not feed any filter default
that changes a metric**.

### 3.7 One verifier contract across all four AI-verified audits

Entry visa, medical and e-ID each specify an AI verifier, and all three independently landed
on the same six verdicts with the same meanings. That is a consolidation the specs already
made; the schema just recognises it — one table, `T_VERIFIER_VERDICT`, keyed by
`(audit_code, case_id, text_hash)`:

`JUSTIFIED` · `PLAUSIBLE` · `AMBIGUOUS` · `NOT_RELATED` · `UNRESOLVED` · `NO_TEXT`
— plus `NOT_READ`, a **run state**, which stays GREY/RED and is counted separately.

The verdict is pinned to the hash of the exact text it read, so a case cannot move flag with
no data change. Reason categories stay per-audit (they mean different things), and only the
redacted quote the model returned is ever stored or displayed.

### 3.8 Personal data never leaves the predicate

Every spec says some version of this; the view layer enforces it once. These columns are
**never selected** into a view, a drill-down, an export or a chat reply:

`TRANSACTIONS.DESCRIPTION` · `TRANSACTIONS.CREATOR` · `TRANSACTIONS.LAST_MODIFIER` ·
`VISAREQUESTEXPENSES.DESCRIPTION` · `EMPLOYEE_NAME` · `CREATOR_NAME` · `LAST_MODIFIER_NAME` ·
`WAIVE_NOTES` / `REPAYMENT_NOTES` raw text · `VISAREQUESTSNOTES.TEXT` ·
`COMPLAINTS.COMPLAINT_DESCRIPTION` · `COMPLAINT_COMMENTS.TEXT`

Reading them as a **filter predicate** is permitted and necessary (the R-visa shared-head
description test, the ILOE fine classification). Selecting them is not. The maid is
`Maid #<id>` everywhere. Where a note carries an approval reference, the view extracts the
to-do id and discards the rest. *(ILOE R4 · R-visa §4 · entry visa V1 · medical §7.7)*

---

## 4. The tables and their filters

The stated requirement: **a table for each expense audit with every filter it could need.**

### 4.1 Filters every tab has

| Filter | Default | Note |
|---|---|---|
| Period | `Spec window` preset | Presets: spec window · last 3/6/12 months · YTD · all-time · custom |
| Flag | `RED` + `AMBER` | Multi-select. `GREY` count always shown on the strip even when filtered out |
| Rule / finding class | all | Multi-select, using the spec's own rule ids and words |
| CC / MV | both | `TRIM`med — `'CC '` and `'MV '` carry a trailing space in three tables |
| Exposure class | all | RECOVERABLE / LOST / UNDECIDED / UNVALUED |
| Action owner | all | Who works the row |
| Amount at stake | full range | Min/max. Unvalued rows are excluded by any non-zero minimum, and it says so |
| Age (days) | full range | Plus the spec's own bands where it has them |
| Verifier verdict | all | Only where the audit has a verifier; `NOT_READ` listed separately |
| Verifier reason | all | Per-audit category list |
| Review status | all | **Never a default that changes a metric** |
| Assignee | all | |
| Search | — | Maid id · transaction id · request/case id |
| Sort | amount desc | Worst-first, never by date |

### 4.2 Filters each tab adds

**LAWP reservoir**
outcome (consumed · cleared by reuse · under 60d · recoverable 60–120d · lost 120d+ · no fee on record · alert disagreement) ·
grain toggle (payment / bundle) · age band against the 0/60/120 clock · nationality ·
`HOUSEMAID_TYPE` (Normal-CC / MAID_VISA-MV) · `WORK_PERMIT_TYPE` (QUOTA / REPLACEMENT) ·
partial bundle (which of the three fees are present) · bundles-per-payment ·
alert-945 agreement · days to the refund deadline

**Entry visa**
band (inside country AED 739.50 / outside AED 89.50) · turn-down reason
(`Rejected` / `E_Visa_Need_Sponser_Visit`) · refund-claim state (never filed · cancelled by us ·
pending · received) · days unclaimed (incl. the negative-age cases, open item O2b) ·
wrong-type tag · list toggle (M2 refund never claimed / M3 paid twice) · charges-per-maid ·
maid-id disagreement (grey)

**Medical**
verdict (never claimed · refund failed · no fee charged · pending · clean) ·
`MEDICAL` vs `MEDICAL_RENEW` · refund era rate (AED 220 pre-2026 / AED 270 from 2026) ·
cancellation type · `Refund Medical Application` step created yes/no · days since fee ·
fee quarter (the regression trend, §12 of that spec) · duplicate-pair filter (audit 2) ·
has complaint thread / has staff note

**ILOE**
rule (R1 · R2 · R3 · R4) · subscription / fine / unclassified · loan type
(`_FINES` · `_PREMIUM` · `_PLAN`) · payment era (pre / post the 2025-03-02 rename) ·
outstanding band · days since loan · has to-do reference · bucket
(bulk-no-maid · unmatched reversal · office staff excluded · accounting adjustment) ·
who is out of pocket (company / maid) · repeat gap band (same-day · 1–119d · 365d+)

**R-visa**
**grain toggle (per-request case ↔ per-maid pair)** · verdict (Confirmed / Blocked / Clean) ·
blocking reason (multi — a case may carry several) · recovery (Unrecovered · Partial · Full ·
Unknown · N/A) · channel (Noqoodi · Card · mixed) · purpose (`APPLY_FOR_RVISA` /
`RENEW_RESIDENCE`) · fee era · term (1-year 343.50 / 2-year 443.50–457.46) ·
pair bucket (A same request · B renewal · C1 re-application · C2-S1 re-payer · C2-S2 term
mismatch · C2-S3 unexplained) · span days · year of last payment

**E-ID**
**sub-audit (duplicates / fines / replacements)** · charge class (`APPLICATION` ·
`APPLICATION_WITH_FINE` · `REPLACEMENT` · `TYPING_SERVICE` · `UNCLASSIFIED` · `REFUND`) ·
expense head · gap band (0–120 RED · 121–599 AMBER · 600+ normal renewal) · fine days ·
fine cap hit (50 days) · loan status (PAID · PARTIALLY_PAID · NOT_YET_PAID · none) ·
recovery route (maid loan / MV client — blocked on N1) · price era (pre / post 2025-08-11)

### 4.3 Columns

Each table carries the columns its own spec's §"The report" defines, in that order, plus the
five shared ones (`Flag` · `Exposure class` · `Action owner` · `Review status` · `Assignee`).
Every displayed metric carries its spec metric ID in the column header tooltip, so the
dashboard and the specs cannot drift apart. Amounts are right-aligned, fixed 2 dp, thousands
separated, with `AED` stated once in the header.

---

## 5. The dashboard ships the specs' measured baselines and reports its own drift

Every spec states measured values for nearly every metric, as of 2026-09-12/14. Those go into
`V_EXPECTED_BASELINE`, and the Assurance tab shows, per metric: **spec value · this run ·
delta**. A build that returns a different number is visibly wrong on day one rather than
plausibly wrong for a quarter.

Valid **only at the `Spec window` period preset** (§3.4) — the comparison is disabled and says
why at any other period.

| Audit | Metric | Spec baseline |
|---|---|---|
| LAWP | M6/M7 lost | 202 payments · 232 bundles · AED 271,171.06 |
| LAWP | M5 recoverable | 45 payments · AED 63,897.92 |
| LAWP | tie-out `M2+M3+M4+M5+M6 = M1` | 6,767+296+3+45+202 = 7,313 · variance 0 |
| Entry visa | M2 red | 188 cases · AED 90,276.00 |
| Entry visa | M3 paid twice | 105 charges / 99 maids · AED 74,580.90 |
| Entry visa | tie-out, charge side | 913 = 697 + 216 |
| Entry visa | tie-out, refund side | 892 = 701 + 119 + 70 + 2, cross-check 701 vs 697 |
| Change of status | M12 money at risk | AED 9,325 · 6 red · 34 amber · 0 grey · 5.8% of 104 fines |
| Change of status | tie-out 1 — base + fines + overage = M1 | 405,257.60 + 77,250.00 + 0.00 = 482,507.60 · variance 0.00 |
| Change of status | tie-out 2 — every fine has a destination | 55,025 + 8,775 + 2,325 + 1,300 + 500 + 9,325 + 0 = 77,250 |
| Medical | M1 / M2 / M3 | AED 39,910 · 173 cases · 11.6% latest quarter |
| Medical | tie-out | 132+41+9+971 = 1,153 · AED 273,010 |
| ILOE | R2 / R3 / R4 | 1,530 · AED 575,891.27 / 364 · AED 82,138.25 / 6 · AED 864.58 |
| ILOE | tie-out | 1,163,242.82 = 587,351.55 + 575,891.27 · variance 0.00 |
| R-visa | still out (M3) | AED 16,853.50 · 45 confirmed · 46 blocked · 69,033 clean |
| R-visa | waterfall | 71,791 − 802 − 1,770 − 1 = 69,218 |
| R-visa | pair classifier B median gap | 716 days against a 730-day term — *the check's own sanity test* |
| E-ID | M7 red | AED 57,390.34 · 149 cases |
| E-ID | class tie-out | 20,142 rows · AED 7,007,545.03 · variance AED 0.00 |

---

## 6. Coverage — what this dashboard does *not* check

Priced honestly, on the front page. Derived by walking every check in
`Visa_Process_Audit_Flow.pdf` against the six specs.

| Process step | Check in the flow | Covered by | Status |
|---|---|---|---|
| LAWP reservoir | >60 days in the pool = loss | LAWP M5/M6 | ✅ |
| LAWP reservoir | reuse confirmed, else loss | LAWP R2/R17 | ✅ |
| LAWP reservoir | replacement maid used it or passed it on | LAWP R2/R13 | ✅ |
| LAWP reservoir | **duplicate WP / MOHRE / labour-card payments for reservoir maids** | — | 🔴 **no check exists** |
| LAWP reservoir | **maids with duplicated payments appearing in the LAWP table** | — | 🔴 **no check exists** |
| Entry visa | no duplicate payments | entry visa M3 | ✅ |
| Entry visa | partial refund claimed on rejection | entry visa M2 | ✅ |
| Entry visa | correct inside/outside type | entry visa M4 | ✅ (reason column, by ruling) |
| Change of status | no duplicate payments | Change of status R1 | ✅ |
| LAWP reservoir | duplicate work-permit / MOHRE / labour-card payments | LAWP R20 / R20a → M13, M14 | ✅ **built in v4** |
| LAWP reservoir | maids with duplicated payments in the LAWP table | LAWP R18 → R19 → M11, M12 | ✅ **built in v4** |
| E-ID | 1-year vs 2-year matches contract and validity | E-ID M8 | ✅ **built in v2** — a monitor, 58 cases, no money figure |
| Change of status | fine responsibility | Change of status R3 / R5 / R6 | ✅ — MV to the client above AED 300, CC to the maid's loan above AED 200 |
| ILOE | no duplicate payments | ILOE R1 | ✅ (informational, by ruling) |
| ILOE | fine responsibility | ILOE R2/R3/R4 | ✅ |
| Medical | no duplicate payments | medical audit 2 | ✅ (low-volume monitor) |
| Medical | refund claimed within 90 days | medical audit 1 | ✅ |
| R-visa | no duplicate payments | R-visa T1 / pair bucket A | ✅ |
| R-visa | 1-year vs 2-year matches contract & validity | R-visa §3.8 | 🟠 **partial** — 25 cases AMBER, needs the issued validity read at build |
| R-visa | fine responsibility | R-visa §2.6 | 🟠 **partial** — the finding is defined ("nobody assessed fault") but no rule is built |
| E-ID | no duplicate payments | e-ID M2 | ✅ |
| E-ID | **1-year vs 2-year matches contract & validity** | — | 🔴 **not in the e-ID spec at all** |
| E-ID | lost card — whose fault, charge her loan | e-ID M4 + verifier cats 5/6 | ✅ |
| E-ID | fine responsibility | e-ID M3 | ✅ |

**Named blind spots carried from the specs**, shown on the Assurance tab with their sizes:

- **R-visa: 981 transactions on R-visa heads with no visa line at all** — 1.4% of the
  population, ten times the finding set, examined by no test. A proximity screen is
  specified but not yet built.
- **LAWP: paperwork that never entered the reservoir is invisible** — alert 944 owns it.
- **LAWP: PAWP bundles cannot be reliably excluded** (D8, 3.8–7.4% coverage) — the
  `HOUSEMAID_TYPE` proxy is in use and the caveat prints on the tab.
- **E-ID: the MV client recharge route is not in the warehouse** (N1) — 131 MV
  replacement cases, AED 58,649.84, can be neither cleared nor condemned.
- **LAWP: whether MOHRE insurance attaches to the paperwork or to the person is
  unanswered** — it decides AED 383,177.57 across 2,018 events. Routed to the process
  owner and reported as its own class, never red, until he rules (R20a).
- **E-ID: nobody knows what a one-year E-ID costs** — M8 finds 58 one-year-visa maids
  charged the two-year band and cannot price the gap, because the warehouse carries one
  price per era. Naming a cheaper one would be inventing a constant.
- **Entry visa: nothing before 2025-09-05 can be audited** — no dated rejection exists earlier.
- **Medical: `VISAREQUESTSNOTES` has no primary key** — note citations use a surrogate.
- **Change of status: M1 and M8 have never been reconciled against the approved P&L lines** —
  `OPENFLOW_DB` is not authorised under `MONEY_CONTROL_ROLE` (O3). And two of its ten rules
  (R5, R10) rest on aggregates rather than cases read one by one (O10).

---

## 7. Colour and flags

The page is status-coded, not series-coded, so it uses the fixed status palette throughout
and needs no categorical series colours at all.

| Flag | Word (always shown) | Light | Dark |
|---|---|---|---|
| Red | **ACTION** | `#d03b3b` | `#d03b3b` |
| Amber | **HOLD** | `#fab219` | `#fab219` |
| Grey | **UNREADABLE** | `#898781` | `#898781` |
| Green | **CLEAN** | `#0ca30c` | `#0ca30c` |

Never colour alone: every flag carries its word and an icon, so a row survives printing, a
screenshot into a finding, and colour vision deficiency. The flag drives a stripe on the left
edge of the row.

**Palette validation** (`dataviz/scripts/validate_palette.js`, both modes, `--pairs all`):
CVD separation **PASS** (worst pair ΔE 9.1 deutan) and normal-vision separation **PASS**
(worst ΔE 18.9) — the two checks that decide whether the marks are actually distinguishable.
The validator's lightness-band and chroma-floor checks fail by design: they are gates for
*categorical* palettes, and here `#898781` is grey deliberately — grey *means* "cannot be
judged" in all six specs. `#fab219` sits at 1.79:1 on the light surface, which triggers the
**relief rule**: every amber mark carries a visible direct label, and the table view is the
page itself.

One chart on the Portfolio tab (exposure by audit, stacked by class, direct-labelled, 2px
surface gap between segments). One chart, deliberately — a wall of charts hides the
exceptions, and the exceptions are the product.

---

## 8. Object layer

```
BA_VIEWS.*                                    read-only source (never written)
  │
POLICE_CONTROL.VISA_AUDIT                     ← substitute the real target at deploy
  ├─ shared          DIM_MAID · V_LOAN_LATEST · DIM_PRICE_ERA · V_VISA_EXPENSE_PAYMENT
  ├─ per audit       V_CASES_LAWP · V_CASES_ENTRY_VISA · V_CASES_MEDICAL
  │                  V_CASES_ILOE · V_CASES_RVISA · V_CASES_EID   (+ *_DETAIL drill-downs)
  ├─ portfolio       V_AUDIT_CASE (the union) · V_AUDIT_TIEOUT · V_AUDIT_CONTROL
  │                  V_AUDIT_COVERAGE · V_EXPECTED_BASELINE
  └─ writable        T_CASE_REVIEW · T_VERIFIER_VERDICT   (the only two tables written)
```

`V_LOAN_LATEST` matters more than it looks: **two specs independently discovered that
`HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` is snapshot history, not one row per loan**, and both
were wrong before they found it — ILOE overstated by AED 241,161 (+21.7%), e-ID's replacement
figure moved AED 5,041.82 between two runs of the same query. One shared view collapses it
once, with the explicit tie-break both specs require (`QUALIFY ROW_NUMBER()`, not `MAX`), so
the fix cannot be applied in one audit and forgotten in the other. The same applies to
`TRIM(CONTRACT_TYPE)`, the office-staff exclusion, and the transaction-date-vs-creation-date
clock — each written once in the shared layer.

**Refresh: manual, on demand.** No scheduled run, no task, no unattended report. Every spec
says so independently, and a standing Snowflake process goes to the ERP/Data team, not here.

---

## 9. Build order and what is not yet proven

1. Run `sql/90_validate.sql` **first**. It resolves every table and column the six specs
   name, and every guard they demand. Nothing below runs until it passes.
2. `00_setup` → `10_shared` → `21`–`26` → `30_unified`.
3. Compare against `V_EXPECTED_BASELINE` at the `Spec window` preset. Investigate every
   non-zero delta before the app goes to auditors.
4. Deploy the Streamlit app; grant the P&C role.

**Stated honestly:** this view layer was written from the six specs, not against a live
warehouse — every table and column name in it comes from a spec that measured it, and none
was invented, but the SQL itself has not been executed. Step 1 and step 3 exist precisely
because of that. Treat the first run as the measurement, and the baselines as the control.

**Open items that reach the dashboard** (each surfaces on its tab, none blocks the build):
entry visa O7 (`Active_Visa` / `Another_Issue` as turn-downs) and O2b (negative claim ages) ·
LAWP open item 3 (the unreconciled `LOST_VISA_EXPENSES` gap — recommended to adjudicate
before shipping) · e-ID N1 · R-visa §6 decisions and the 981 orphan transactions ·
medical VPMGOV-1211.
