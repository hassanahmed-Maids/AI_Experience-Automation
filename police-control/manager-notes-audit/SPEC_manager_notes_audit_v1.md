# Spec — Manager Notes Audit

| | |
| --- | --- |
| **Requested by** | Police & Control, maids.cc |
| **Spec version** | v1 |
| **Date** | 2026-09-05 |
| **Delivered on** | MaidsInsights (Snowflake is the warehouse underneath — they are not interchangeable) |
| **UI mockup** | https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051 |
| **Evidence log** | `snowflake-discovery.md` (every table claim, with the statement that proved it) |
| **Status** | Draft — blocked on the access grants in §7 before any number can be verified |

---

## 1. Business Logic

**The control.** Every month managers add money to housemaids' payslips — roughly 1,300
additions worth about AED 0.5m a month, some AED 6.3m a year across ~16,000 payments. Each
addition is supposed to be justified by whatever rule governs that type of payment. Today
nobody checks. This report checks, one addition at a time.

**The failure it catches.** Four shapes:

| # | Failure | Plain statement |
| --- | --- | --- |
| F1 | **Over-limit** | More money paid than the rule allowed |
| F2 | **Duplicate** | The same payment made twice |
| F3 | **Not entitled** | Paid against a rule that never applied to that maid |
| F4 | **No basis** | Nothing behind it explaining why it was paid |

**Reader and action.** A Police & Control auditor opens the dashboard once a month and works
the month's cases one at a time. A second person reviews before anything is acted on —
maker–checker. Red means money went out above what was allowed, or with nothing behind it.
Amber means the check could not reach a conclusion, and always says why. Green means a rule
actually ran and cleared the payment.

**Grain.** **One row per manager note.** Not per maid, not per month, not per payment type.
A maid who received four additions in a month is four separate cases, judged separately.

**Population in scope.** Every addition that was *applied*, actually *paid*, and is not a
refund, windowed on the **month it was paid in** — not the month it was created in. Both
contract types are in scope, because contract type decides which payments a maid may
receive at all: company-contract maids we hired, and MaidVisa maids who are our employees
only on paper. Additions with a **negative amount are in scope**: money being taken back is
not an overpayment, but it is not nothing either, so it is reported rather than silently
dropped.

**Explicitly out of scope.**

| Excluded | Why |
| --- | --- |
| Deductions and penalty deductions (`NOTE_TYPE IN ('DEDUCTION','PENALTY_DEDUCTION')`) | The underlying feed stopped recording amounts and then stopped recording rows. A test built on them would report a clean result forever. |
| Office-work payments | A separate check owns them. `PAYROLL.RAW_DATA.OFFICESTAFF*` is a different population. |
| Client-side notes | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES` — different records, opposite direction. |
| Free-text notes on a maid's profile | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS` — no money attached. |

**Refresh expectation.** Monthly and **manual**, run after the payroll month is paid.
Deliberately never scheduled: recurring warehouse processes go through the ERP team, and ad
hoc Snowflake is not a governed system of record. This spec is the handoff.

**Archetype.** Primarily *exception / rule-breach list*, with an *authorised-vs-actual*
comparison inside several group rules. Each row therefore names the rule it breached, in the
rule's own words.

**Relationship to the ERP's own auditor.** Part of this audit already runs inside the ERP:
an internal payroll-auditor role already detects flight-home payments over the limit and
repeated additions, and signs them off. **This dashboard is an independent second check.**
An internal sign-off is displayed as context and **never clears a case here.** No test may
read the sign-off as evidence; it may only be shown in the drill-down.

---

## 2. Data Points Needed

Verdicts and the statements behind them are in `snowflake-discovery.md`. **No row of data
has been read** — the role has no warehouse (§7). Everything below is structural evidence
from metadata; content claims are marked `NEEDS COMPUTE`.

### 2.1 Verified present in Snowflake

| # | Data point | Location | Key columns | Grain | Notes |
| --- | --- | --- | --- | --- | --- |
| D1 | Manager notes | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID`, `HOUSEMAID_ID`, `NOTE_TYPE`, `AMOUNT`, `REASON`, `NOTE_REASON`, `NOTE_DATE`, `REQUESTED_BY`, `APPROVED_BY` | one row per note — **unproven**, see H1 | `REASON` is the payment type. `MANAGER` is all-NULL. |
| D2 | Payslip month + payslip's own additions total | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH`, `ADDITIONS`, `PAID_ON_DATE_FORMATTED`, `IS_TRANSFERRED` | maid × payroll month | Anchors the paid-month window and the tie-out. |
| D3 | Maid profile | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID`, `HOUSEMAID_TYPE`, `NATIONALITY`, `NATIONALITY_CATEGORY`, `START_DATE`, `SALARY_STARTING_DATE`, `NET_HIRED_DATE`, `DATE_OF_TERMINATION`, `MODE_OF_TERMINATION`, `IS_DELETED`, `EXCLUDED_FROM_PAYROLL` | one row per maid | Contract type and nationality live here. |
| D4 | Authorising expense record | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `RELATED_TO_TYPE`, `RELATED_TO_ID`, `REQUEST_STATUS`, `AMOUNT`, `CURRENCY_NAME`, `BENEFICIARY_TYPE`, `BENEFICIARY_NAME`, `APPROVED_BY`, `REQUESTED_BY`, `PAYMENT_METHOD`, `REFUNDED`, `EXPENSE_PAYMENT_ID`, `CREATION_DATE` | one row per expense request | **Secure expense categories are excluded from this view entirely.** |
| D5 | Expense head | `…MONEY_CONTROL_SILVER.EXPENSES_REQUESTS.EXPENSE_TYPE`, with `…MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` | — | — | Name resolved from `mmdb.expenses`. |
| D6 | Referral evidence | `…HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | referral, referred maid, bonus-requested date, cancelled date | one row per referral bonus | Confirms the picklist name `'Referral bonus'`. **No scheme price.** |
| D7 | Flight tickets purchased | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | `HOUSEMAID_ID`, `TICKET_TYPE`, `BUYER`, `ORIGINAL_FARE`, `FARE_IN_REF_CURRENCY`, `CURRENCY_ID`, `EXCHANGE_RATE`, `PURCHASE_DATE`, `REFUNDED`, `IS_DELETED`, `IS_LATEST_HM_TICKET` | one row per ticket | Proves a ticket was bought. **No nationality cap.** `NEEDS COMPUTE`: is it still written to? |
| D8 | Vacation records | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_VACATIONS` | vacation start/end, contract | one row per vacation | For the repeating-cycle part of the flight rule. |
| D9 | Payment-type picklist | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | picklist item id, name | one row per picklist item | The 24 payment-type names. `NEEDS COMPUTE` to enumerate. |

### 2.2 Approved KPI definitions

`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` **exists**, but reading it needs
compute, so **the approved-definition check has not been performed.** That is an
*outstanding* check, not a negative result.

Until it runs, every metric in §3 is labelled **a new Police & Control definition, not an
approved KPI**, and should be added to the Data Catalog once agreed. If the container turns
out to hold a definition for any of them, that definition wins verbatim, with all its
filters (including flags such as `FAKE = false`), and this spec is amended.

### 2.3 New data ingestion request — not in Snowflake today

Format per `ingestion-request.md`. **Every native ERP column name below is
`UNVERIFIED — to be confirmed via Ask the Code`**, except the five marked ✅, which were read
directly out of the dbt model SQL embedded in the `HOUSEMAID_MANAGER_NOTES` view definition
(`p.ADDITION_REASON_ID`, `p.DEDUCTION_REASON_ID`, `p.EXPENSE_ID`, `p.NOTE_REASONE`,
`p.EMPLOYEE_MANAGER_ID`) and out of `MAIDS_REFERRALS_BONUSES` (`v.PURPOSE_ID`). No Ask the
Code token was available in this session (§7).

#### N1 — "Applied" flag on a manager note
- **Definition.** Whether the addition was actually applied to a payslip, as opposed to
  entered and left.
- **Source.** ERP — Payroll Management, `mmdb_transformed.payrollmanagernotes`
- **Native column.** UNVERIFIED
- **Why blocking.** The scope sentence says *applied*. Without it the population is wrong at
  the first step, and every number below inherits the error.
- **Join key.** `payrollmanagernotes.ID` → `HOUSEMAID_MANAGER_NOTES.ID` (NUMBER both sides)
- **History needed.** From 2024-01-01, backfill required
- **Grain in source.** one row per note

#### N2 — Paid flag and payslip month on a manager note
- **Definition.** Whether the note was paid, and the payroll month whose payslip carried it.
- **Source.** ERP — Payroll Management, `payrollmanagernotes`
- **Native column.** UNVERIFIED
- **Why blocking.** The audit is windowed on the month **paid**, not created. D2 gives that
  month only at maid × month grain, which cannot attribute one of a maid's four notes to a
  month. Without N2 the window is an inference, and a note near a month boundary lands in
  the wrong audit month.
- **Interim.** `NOTE_DATE` + D2's `PAID_ON_DATE_FORMATTED` for the maid × month. This is an
  approximation and **must** drive amber, not green — see T0 in §3.1.

#### N3 — Refund / reversal flag on a manager note
- **Definition.** Whether the note is a refund of an earlier payment.
- **Native column.** UNVERIFIED. **Do not** substitute `EXPENSES_REQUESTS.REFUNDED` — that
  is the refund state of the *expense request*, a different record.
- **Why blocking.** Refunds are out of scope by definition. Absent the flag, refunds sit in
  the population and inflate both the finding count and the money.

#### N4 — ✅ `EXPENSE_ID` on the note
- **Definition.** The expense category the note points at.
- **Native column.** `payrollmanagernotes.EXPENSE_ID` — read from the view's model SQL.
- **Status.** Present in the ERP and **used** in the view's join, but **not selected**, so
  it is invisible downstream. Expose it.
- **Note.** It is a **category**, not a payment. It does not identify *which* payment
  authorised the note. See H1/H2.

#### N5 — ✅ `ADDITION_REASON_ID` and `PURPOSE_ID` on the note
- **Definition.** The payment-type picklist ids (the view exposes only the resolved name).
- **Native columns.** `payrollmanagernotes.ADDITION_REASON_ID`, `payrollmanagernotes.PURPOSE_ID`
- **Why needed.** Group routing on a free-text name is fragile: a rename silently re-routes
  every note. Route on the id, display the name.

#### N6 — Note author and creation timestamp
- **Definition.** Which manager entered the addition, and when.
- **Native column.** `payrollmanagernotes.EMPLOYEE_MANAGER_ID` ✅ **exists but is profiled as
  having no non-null values** — it is dead in the warehouse. Find the column the ERP
  actually populates (creator / created_by) — UNVERIFIED.
- **Why needed.** "Who made this addition" is not answerable today. A repeat-offender view
  and any escalation path need it.

#### N7 — Internal payroll-auditor sign-off
- **Definition.** The ERP payroll-auditor role's own detection and sign-off on a note.
- **Native table.** UNVERIFIED — probe `PAYROLLAUDITTODOS` and neighbours in
  `erp/magnamedia-payroll-management`.
- **Use.** **Context only, displayed in the drill-down. It never clears a case here.**
  Specified explicitly so nobody wires it into a test later.

#### N8 — A real key from note → authorising expense payment
- **Definition.** A stored relationship, if the ERP has one.
- **Status.** As far as the warehouse shows, the ERP **copies fields across rather than
  storing a relationship**. Ask the Code should confirm whether any FK exists.
- **If none exists**, the heuristic in H2 stands and the match rate is published on the face
  of the report.

#### N9 — Effective-dated salary history
- **Definition.** The salary in force for a maid on a given date.
- **Status.** `HOUSEMAIDS_INFO.BASIC_SALARY` / `PRIMARY_SALARY` hold the **current** value
  only. A part-month or final salary for a past month cannot be recomputed from a
  current-value column.
- **Candidate.** `mmdb` revision tables — `HOUSEMAIDS_INFO_REVISION` is referenced by other
  models and may serve. UNVERIFIED.
- **Sensitivity.** Individual salary values must never be displayed (§6).

#### N10 — Flight-home cap by nationality, and the entitlement cycle
- **Definition.** The maximum payable in lieu of a flight home, by nationality; the length of
  service after which it is due; the repeat cycle.
- **Source.** Not in the warehouse — zero candidate objects. Likely a policy document or a
  sheet.
- **Owner to name.** Payroll / HR policy owner.
- **Needed as.** An effective-dated table: nationality (or `NATIONALITY_CATEGORY`), cap
  amount, currency, valid-from, valid-to, plus the service threshold and cycle length.
  Without valid-from/valid-to, a cap changed mid-year retroactively re-judges settled months.

#### N11 — Referral and signing bonus scheme prices
- **Definition.** What a referral, and a signing bonus, were worth on a given date, and the
  conditions attached.
- **Source.** Not in the warehouse. `MAIDS_REFERRALS_BONUSES` records what was **paid**, never
  what was **due** — auditing paid against paid proves nothing.
- **Needed as.** Effective-dated scheme, per condition (nationality, contract type,
  live-in/live-out), with valid-from/valid-to.

#### N12 — Raffle winners list
- **Definition.** Who won, which draw, how much.
- **Source.** `SHOW OBJECTS LIKE '%RAFFLE%' IN ACCOUNT` returns **zero rows**. Not in the
  warehouse at all.
- **Owner to name.** Whoever runs the draw. If it is a sheet, §2.4 applies.

#### N13 — The loyalty payment rule
- **Definition.** The rule governing the loyalty payment.
- **Status.** **No written rule exists anywhere in the company.** This is not a data gap that
  ingestion fixes. Until a rule is written and agreed, every loyalty note is **permanently
  amber**, reason: *"no rule exists to test against"*. That is the honest verdict and the
  most valuable single line this dashboard reports.

**Join keys and their types.**

| From | To | Key | Types | Risk |
| --- | --- | --- | --- | --- |
| D1 | D3 | `HOUSEMAID_MANAGER_NOTES.HOUSEMAID_ID` → `HOUSEMAIDS_INFO.ID` | NUMBER → NUMBER | clean |
| D1 | D2 | `HOUSEMAID_ID` + derived paid month → `HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID` + `PAYROLL_MONTH` | NUMBER, DATE | maid × month, so **many notes to one payslip row** — never join before the note-level tests are complete, or the grain fans |
| D1 | D4 | heuristic — see H2 | NUMBER → NUMBER | **the match is not a key** |
| D1 | D9 | `REASON` (name) or `ADDITION_REASON_ID` (N5) → `PICKLISTS_INFO` | TEXT / NUMBER | prefer the id |

**Known data hygiene issues — each one silently returns the wrong answer rather than an
error.**

| # | Issue | Consequence if missed |
| --- | --- | --- |
| H1 | `HOUSEMAID_MANAGER_NOTES` LEFT JOINs `expensepayments` on `HOUSEMAID_ID + EXPENSE_ID` with no visible dedup. `EXPENSE_ID` is a **category**. | The view can emit **more rows than notes**. The entire grain — and therefore every count and every total — is wrong. **Assert `COUNT(*) = COUNT(DISTINCT ID)` before anything else is built.** If it fails, deduplicate at the note level *first* and treat multi-match notes as unmatched, not as matched-to-the-first. |
| H2 | There is no proper key from note to authorising payment. The ERP copies fields across. | The link is a heuristic. **A low match rate means unverified, never clean.** The match rate is a published metric (M10), not an internal detail. |
| H3 | `EXPENSES_REQUESTS` **excludes secure expense categories entirely** (`is_secure = 1`). | A note backed by a secure category is indistinguishable from a note backed by nothing. Must be **amber**, never red "no basis", never green. |
| H4 | `HOUSEMAIDS_INFO.IS_DELETED` and `EXCLUDED_FROM_PAYROLL` are **TEXT** `'00'/'01'`; `HOUSEMAID_PAYROLL_HISTORY.IS_TRANSFERRED` is **TEXT** `'YES'/'NO'`; `HOUSEMAIDS_TICKETS.IS_DELETED` is **TEXT** `'00'/'01'`. | `WHERE IS_DELETED = TRUE` matches nothing and raises no error. Zero rows reads exactly like "no findings". |
| H5 | `HOUSEMAID_TYPE` has **four** values: `Normal`, `MAID_VISA`, `FREEDOM_OPERATOR`, `WALKIN`. | An `IF MV THEN … ELSE CC` eligibility rule silently treats freedom-operator and walk-in maids as company-contract. They must route to **amber**. |
| H6 | `START_DATE` and `SALARY_STARTING_DATE` bottom out at `1970-01-01`; `HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE` and `EID` are entirely NULL; `HOUSEMAID_MANAGER_NOTES.MANAGER` is entirely NULL. | Epoch-zero is "unknown" wearing a date. Length-of-service arithmetic on it produces a confident wrong answer. Detect and route to amber. |
| H7 | `EXPENSES_REQUESTS.CURRENCY_NAME` spans ten currencies; `HOUSEMAIDS_TICKETS` carries its own `CURRENCY_ID` and `EXCHANGE_RATE`. | An amount-agreement test that compares AED to PHP without FX is wrong, not approximately right. |
| H8 | `EXPENSES_REQUESTS.AMOUNT` reaches 2.2 × 10¹¹; `STATUS_CHANGE_DATE` starts only Dec 2025. | One outlier dominates any "amount at risk" headline. Truncated status history cannot date approvals for earlier months — use `CREATION_DATE`. |
| H9 | `BENEFICIARY_NAME` and `RELATED_TO_NAME` return `''`, not NULL, when nothing matched. | `IS NULL` misses them; they read as present-and-blank. |
| H10 | `HOUSEMAID_PAYROLL_HISTORY.PAID_ON_DATE` is TEXT parsed by a three-format `TRY_TO_DATE` chain. | A fourth date format yields NULL silently — the note drops out of its month rather than erroring. |
| H11 | `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a **note id**, while that column is documented as a **housemaid id**. Ranges overlap. Every column of that view profiles as all-NULL. | One of the two is wrong today. **Do not reuse that join and do not source from that GOLD model.** Raised to the Data team as a defect regardless of this audit. |
| H12 | Timezone. `NOTE_DATE` and the payslip dates are `TIMESTAMP_NTZ` with no stated zone. | A note near midnight on the 1st or the 31st crosses a month boundary. State the zone (Gulf time assumed) and apply it once, centrally. |

### 2.4 If any reference source turns out to be a spreadsheet

For N10, N11 or N12, the ingestion request must additionally name: the exact file and tab
and its owner; whether the sheet is the **system of record** or a copy (and if a copy, the
origin); the header layout and whether it shifts month to month; whether historical tabs
share that layout; and any column a person fills in **by hand**. A hand-filled column must be
flagged loudly — an audit built on one is auditing the person who fills it, and that has to
be a deliberate choice rather than an accident of ingestion.

---

## 3. How a single note is judged

### 3.1 The ladder

Tests run in order. **The first test that fires decides the outcome.** Nothing falls through
into green by default.

| Test | Question | Fires when | Verdict |
| --- | --- | --- | --- |
| **T0** | Is this note in the audit month at all? | paid month ≠ audit month | *excluded from the population* (not a verdict) |
| **T0a** | Is the paid month **known**? | N2 absent, and D2 gives no unambiguous maid × month | **AMBER** — "paid month inferred, not recorded" |
| **T1** | Is the maid's profile readable? | no `HOUSEMAIDS_INFO` row, or `IS_DELETED = '01'`, or key dates are epoch-zero | **AMBER** — "maid profile unreadable" |
| **T2** | Does the note have a payment type? | `REASON IS NULL` or `''` | **RED (F4)** — "no payment type recorded" |
| **T3** | Is the amount negative or zero? | `AMOUNT <= 0` | **REPORTED** — negative: reported, never counted as an overpayment. Zero: **AMBER**, "zero-amount addition" |
| **T4** | Does it point at an authorised expense record, and does the amount agree? | see H2/H3 below | **RED (F1)** on disagreement beyond tolerance; **AMBER** if unmatched or secure-category; **passes** on agreement |
| **T5** | Is the expense head consistent with the payment type? | head ∉ heads allowed for that payment type | **RED (F3)** |
| **T6** | Is this a duplicate of another note? | see §3.3 | **RED (F2)** |
| **T7** | May this contract type receive this payment at all? | payment type ∉ types allowed for `HOUSEMAID_TYPE`; or `HOUSEMAID_TYPE ∈ {FREEDOM_OPERATOR, WALKIN}` → **AMBER** (H5) | **RED (F3)** / **AMBER** |
| **G** | **Exactly one** group rule runs — the rule for that payment type | §3.4 | per rule |
| — | Nothing settled it | | **AMBER**, with its reason stated |

T4 in detail. Match the note to an expense request by the heuristic (H2). Then:

- **matched, amounts agree within tolerance** → T4 passes (it does not, by itself, make the
  note green — the ladder continues);
- **matched, amounts disagree beyond tolerance** → **RED (F1)**, showing both amounts, both
  currencies and the approver;
- **matched, but currencies differ and no FX rate is available** → **AMBER** (H7);
- **unmatched, and the note's payment type is one that always has an expense record behind
  it** → **RED (F4), "no basis"** — but only if the match rate for that payment type is
  above the confidence floor (§3.5). Otherwise **AMBER**;
- **unmatched, and the expense category is secure** → **AMBER, "evidence withheld from the
  warehouse"** (H3). Because secure categories are invisible, this state cannot be
  *detected* from `EXPENSES_REQUESTS` alone; it is why the confidence floor exists.

### 3.2 The single-verdict rule — the thing that has broken six times

The defect that has recurred through every review round of this specification has one shape:
**something is marked as blocked on the screen while the underlying numbers still count
those notes as clean.** A guard that changes no number. Or a clearance that lets a note skip
a test that could not run. Every previous version fixed it in one group and left it live in
another. Treat this as the primary risk of the build, not a footnote.

The construction that makes it impossible:

**(a) Blocking is per test, not per group.** A group rule may contain several tests — one for
the amount, one for the entitlement, one for the timing. Each test independently returns one
of `RED` / `GREEN` / `BLOCKED(reason)` / `NOT_APPLICABLE`.

**(b) The asymmetry is deliberate.**

```
GREEN  ⟺  every applicable test RAN and returned GREEN
RED    ⟸  any single applicable test returned RED        (one is enough)
AMBER  ⟸  otherwise — i.e. some applicable test returned BLOCKED,
                       or no rule exists to run at all
```

A finding is evidence; a clearance is only the absence of one. So one red test outweighs any
number of greens, and one blocked test outweighs any number of greens.

**(c) One column, computed once.** The build produces a single note-level derived table with
exactly one `AUDIT_VERDICT ∈ {RED, AMBER, GREEN}`, one `BLOCKING_REASON`, one
`FAILURE_TYPE ∈ {F1,F2,F3,F4}`, and one `TEST_TRACE` (the per-test outcomes, for the
drill-down). **Every KPI tile, every chart, every filter, every export and every row colour
aggregates that one column.** No metric anywhere may re-derive eligibility, re-apply a
filter, or exclude a note on its own. If a number and a pill can disagree, the build is
wrong by construction.

**(d) Three assertions that must pass before publication.** These are part of the build, not
QA suggestions:

| # | Assertion | What it catches |
| --- | --- | --- |
| A1 | `COUNT(RED) + COUNT(AMBER) + COUNT(GREEN) = COUNT(notes in scope)`, and the same for the summed amounts | a note counted twice, or dropped between the table and the tiles |
| A2 | `COUNT(notes displayed as blocked) = COUNT(AMBER)` | the exact recurring defect — a screen guard that changes no number |
| A3 | For every note where `AUDIT_VERDICT = 'GREEN'`: `TEST_TRACE` contains **no** `BLOCKED` and **no** `NOT_RUN` entry | a clearance that let a note skip a test that could not run |

A1–A3 are displayed on the report, not hidden in a test suite. If one fails, the report shows
the failure instead of the numbers.

### 3.3 Duplicate detection (T6)

Two notes are duplicates when they are for the **same maid**, the **same payment type**, the
**same amount**, and fall within the **same entitlement window** for that payment type
(same calendar month for most types; the same entitlement cycle for flight-home).

- Both notes in a duplicate pair are shown, and **both** are cases; the pair is counted once
  in the duplicate metric and the money at risk is the **later** one.
- Where the entitlement window for a payment type is unknown (any type whose rule is
  missing), the duplicate test returns **BLOCKED**, not GREEN. A duplicate test that cannot
  see the window cannot clear anything.
- The flight-home duplicate is a special case worth naming: **cash paid in lieu of a ticket
  *and* a ticket bought** for the same journey (D7) is a duplicate even though the two
  records live in different tables.

### 3.4 The group rules

Every payment type maps to exactly one group. **Routing is on the payment-type id (N5), not
the name.** A payment type that maps to no group is **AMBER**, reason *"payment type not yet
assigned to a group"* — never green.

| Group | Payment types | Tests inside the group | Reference data | Buildable today? |
| --- | --- | --- | --- | --- |
| **A — Flight home** | flight-home money | A1 amount ≤ nationality cap · A2 service length ≥ threshold · A3 cycle not already consumed · A4 not duplicated against a purchased ticket (D7) | **N10 missing** | A4 only. A1–A3 **BLOCKED** → group amber |
| **B — Loyalty** | loyalty payment | none exist | **N13 — no rule exists anywhere** | **No.** Permanently amber until a rule is written |
| **C — Referral & signing bonus** | referral bonus, signing bonus | C1 amount = scheme price at the note date · C2 the referral/signing event exists and qualifies (D6) · C3 not already paid for the same event | **N11 missing** (price); D6 present (event) | C2, C3 only. C1 **BLOCKED** → group amber |
| **D — Part-month & final salary** | part-month salary, final salary | D1 recompute from dates and salary in force · D2 termination mode consistent (D3) · D3 window matches employment dates | **N9 missing** (effective-dated salary) | D2, D3 only. D1 **BLOCKED** → group amber |
| **E — Salary correction** | salary corrections | E1 proved by the expense record behind it (T4 already ran) · **or** E2 the stated reason justifies the payment | D4 present; E2 needs a judgement field (§3.6) | E1 yes where matched; E2 needs the judgement field |
| **F — Raffle** | raffle prize | F1 the maid is on the winners list for that draw — **and nothing else** | **N12 missing** | **No.** Amber |
| **G — Reimbursement** | reimbursing a maid for money she spent | G1 amount agrees with the expense record · G2 beneficiary is that maid (`BENEFICIARY_TYPE='MAID'` and the id matches) · G3 an approver is recorded | D4 present | **Yes**, where the note matches (H2) |
| **H — Unassigned** | any payment type not mapped above | — | — | Amber by construction |

Read the "Buildable today?" column as the design intends: a group where the reference data is
missing produces **amber**, and amber is a *result the dashboard reports*, not a failure of
the dashboard.

### 3.5 The confidence floor on the heuristic match

Because the note→expense link is a heuristic (H2) and the expense view has a blind spot
(H3), "no expense record found" is only evidence of absence when the heuristic is working.

- Compute the match rate **per payment type**, per month (M10).
- Where the match rate for a payment type is **below 80 %**, T4 may not return RED "no
  basis" for that payment type in that month. It returns **AMBER**, reason *"expense-record
  match unreliable for this payment type (match rate X %)"*.
- The floor is a starting value for P&C to set. It is stated on the report next to M10 so
  the reader knows what it is, and changing it is a spec change, not a dashboard setting.

### 3.6 Where the requirement needs capability, not just a column

Stated as requirements; the Snowflake team chooses the method. None of these may be trimmed
for feasibility.

- **Beneficiary name matching (G2).** Match `BENEFICIARY_NAME` to the maid despite spelling
  variation, transliteration and reversed name order. An ambiguous match becomes an
  **exception row**, never a silent drop.
- **Reason adjudication (E2).** Judge whether the free-text `NOTE_REASON` justifies the
  amount for a salary correction. The question put to the model, the allowed outputs
  (`justifies` / `does-not-justify` / `insufficient`) and the confidence threshold are all
  spec content. `insufficient` and any low-confidence result return **BLOCKED**, which makes
  the note amber — they never return GREEN.
- **FX (H7).** Convert to AED at the rate as of the note date. Where no rate is available,
  the amount test returns **BLOCKED**.

---

## 4. Metrics

Every metric below aggregates the single `AUDIT_VERDICT` column of §3.2(c). None re-derives
eligibility. All amounts in **AED**, 2 dp, rounded at row level and summed after — never
rounded on the total. All are **new Police & Control definitions pending the §2.2 check.**

### M1 — Cases in scope
- **Definition.** Count of manager notes in the audit month, applied, paid, not a refund.
- **Formula.** `COUNT(DISTINCT note_id)` over the scoped population.
- **Filters.** `NOTE_TYPE = 'ADDITION'`; applied (N1); paid (N2); not refund (N3); paid month = audit month; `HOUSEMAIDS_INFO.IS_DELETED <> '01'` (**string**, H4).
- **Nulls.** A note with a NULL amount is in scope and lands at T3 as amber; it is never dropped.

### M2 — Money in scope
- **Formula.** `SUM(AMOUNT)` over M1's population. Negatives included, at face value.
- **Also shown.** `SUM(AMOUNT) WHERE AMOUNT > 0` and `SUM(AMOUNT) WHERE AMOUNT < 0`
  separately, so a month of clawbacks cannot net away a month of overpayments.

### M3 — Findings (red)
- **Formula.** `COUNT(*) WHERE AUDIT_VERDICT = 'RED'`, and `SUM(AMOUNT)` likewise.
- **Broken out by** `FAILURE_TYPE` (F1–F4) — the one chart on the page.

### M4 — Unverifiable (amber)
- **Formula.** `COUNT(*) WHERE AUDIT_VERDICT = 'AMBER'`, and `SUM(AMOUNT)`.
- **Always accompanied by** the `BLOCKING_REASON` breakdown. An amber count without its
  reasons is not a result.

### M5 — Cleared (green)
- **Formula.** `COUNT(*) WHERE AUDIT_VERDICT = 'GREEN'`, and `SUM(AMOUNT)`.
- **Constraint.** Guaranteed by A3: a green note has no blocked and no unrun applicable test.

### M6 — Coverage, cases
- **Formula.** `(M3.count + M5.count) / M1` — the share of cases on which a verdict was
  actually reached.
- **Divide by zero.** Show `—` when M1 = 0.
- **Expectation on today's data:** roughly **a third**.

### M7 — Coverage, money
- **Formula.** `(M3.amount + M5.amount) / M2`, on positive amounts.
- **Expectation on today's data:** **under a tenth**.
- M6 and M7 are the honest headline. They are placed **before** the finding count in the KPI
  strip so no reader can mistake "few findings" for "few problems".

### M8 — Amount at risk
- **Definition.** The quantifiable excess on red cases only: for F1, `note amount − authorised
  amount`; for F2, the later note's amount; for F3 and F4, the full note amount.
- **Nulls / unquantifiable.** Excluded from M8 and counted in M3 — and the count of red cases
  with no quantifiable amount is displayed beside M8, so the two never silently diverge.
- **Outlier guard (H8).** Any single contribution above a stated threshold is listed
  separately rather than absorbed into the headline.

### M9 — Duplicate pairs
- **Formula.** `COUNT(DISTINCT duplicate_pair_id)`. Both notes appear as cases; the pair
  counts once here.

### M10 — Expense-record match rate
- **Formula.** `matched notes / notes whose payment type expects an expense record`, per
  payment type and month.
- **Why it is on the face of the report.** It is the health of the heuristic that several
  tests depend on. **A low match rate means unverified, never clean** — and it drives the
  §3.5 floor mechanically, not by anyone's judgement.

### Tie-out rules

Every P&C report needs an arithmetic identity that proves completeness. This one has three.

| # | Identity | If it does not hold |
| --- | --- | --- |
| **TO-1** | M3 + M4 + M5 = M1, in both count and money | the report shows the discrepancy instead of the numbers (A1) |
| **TO-2** | For each maid × payroll month: `SUM(scoped note amounts)` = `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS` | **each gap is its own exception row** — it means either a payslip addition with no note behind it, or a note the population missed. Both are findings, and this is the only test that can see a *missing* record, since a report built on rows that exist cannot see one that does not. |
| **TO-3** | `COUNT(displayed as blocked)` = M4 | A2 — the recurring defect |

TO-2 is the completeness backbone: `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS` is the independent
expected-population source that the note table alone could never provide.

---

## 5. The report

**Mockup:** https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051 —
the layout below, rendered with the §6 worked examples as visible rows. Figures on it are
illustrative and internally consistent; none has been read from the warehouse.

**Layout.** One screen: KPI strip → tie-out line → case table → one chart. Nothing else.

**KPI strip**, in this order, deliberately:

1. **Coverage — cases (M6)** and **Coverage — money (M7)**, first.
2. **Cases in scope (M1)** and **money in scope (M2)**.
3. **Findings (M3)** and **amount at risk (M8)**.
4. **Unverifiable (M4)** with its top blocking reason inline.
5. **Match rate (M10)** with the confidence floor stated next to it.

Each tile carries its metric id so a reader can trace it to §4.

**Tie-out line.** Displayed, not hidden: `M3 + M4 + M5 = M1 ✓` and the TO-2 residual in AED.
A failing tie-out replaces the numbers with the failure.

**Case table.** One row per note. Default sort: **amount at risk descending**, then paid
date. Columns:

| Column | Source | Format |
| --- | --- | --- |
| Verdict | `AUDIT_VERDICT` | pill: colour **and** the word |
| Failure type | `FAILURE_TYPE` | F1–F4 with the plain-English label |
| Rule breached / blocked because | rule text, or `BLOCKING_REASON` | the rule **in its own words** |
| Note id | D1 `ID` | numeric |
| Maid id | D1 `HOUSEMAID_ID` | numeric — **id only, never name, phone or salary** |
| Contract type | D3 `HOUSEMAID_TYPE` | CC / MV / other |
| Payment type | D1 `REASON` | text |
| Amount | D1 `AMOUNT` | AED #,##0.00, right-aligned |
| Authorised amount | D4 `AMOUNT` | AED #,##0.00, or `—` |
| Gap | derived | AED #,##0.00 |
| Approver | D4 `APPROVED_BY` | text |
| Paid month | derived (N2 / D2) | YYYY-MM |
| Internal sign-off | N7 | **context only — never clears** |
| Status | auditor workflow | New / Under review / Cleared / Escalated |

**Flags.** Red = money out above what was allowed, or with nothing behind it. Amber = could
not conclude, reason always shown. Green = a rule ran and cleared it. Colour is never the
only carrier — every pill has its word, and the failure type is its own column.

**Filters.** Audit month (default: last completed paid month), verdict, failure type,
payment type, contract type, blocking reason, reviewed/unreviewed. Defaults shown on screen.

**Drill-down.** Clicking a case opens the full `TEST_TRACE`: every test that applies, whether
it ran, and what it returned. This is what makes the amber verdict actionable and what makes
a green verdict auditable.

**Maker–checker.** The reviewed/cleared state is a **write-back**. That changes the build
from a dashboard to a small application, and the Snowflake team must know it up front — it is
called out here rather than discovered late. If write-back is out of scope for v1, the status
column is read-only and P&C tracks review outside the tool; say which before build.

**Provenance line.** One line naming the sources and the as-of timestamp, so a finding can be
cited in an audit note.

**Export.** Row-level CSV of the case table. P&C works cases one at a time.

**Sensitive data.** No maid name, phone number, contact detail or salary appears anywhere —
not in the table, not in the drill-down, not in the export, not in the mockup. Maids are
identified by internal id. The addition amount is the subject of the audit and is shown; the
maid's *salary* is not, and the table holding it is not named in any output.

---

## 6. Worked examples

Illustrative. Ids and amounts are synthetic; they exercise the arithmetic and the ladder.

### A — Cleared (green)
Reimbursement of AED 380 to maid #44711, matched to expense request #151204,
`BENEFICIARY_TYPE = 'MAID'`, beneficiary id matches, `APPROVED_BY` present, both AED.

T0–T3 pass. T4 matched, 380.00 = 380.00. T5 head "Maid reimbursement" consistent. T6 no
duplicate — window known. T7 CC may receive reimbursements. Group G: G1 ✓ G2 ✓ G3 ✓.
Every applicable test ran and returned green → **GREEN**. Gap AED 0.00. Contributes 0 to M8.

### B — Finding (red, F1)
Flight-home cash of AED 2,400 to maid #38820. Matched to expense request #149877 authorising
AED 1,500, both AED.

T4 fires: 2,400.00 − 1,500.00 = **AED 900.00** above the authorised amount → **RED (F1)**.
The ladder stops. Group A never runs, and it does not need to — one red test is enough.
M8 contribution: **AED 900.00**. Row shows both amounts and the approver.

Note what this example does *not* claim: it does not say the payment breached the nationality
cap, because the cap (N10) is not available. It says the payment exceeded what was
**authorised**, which is provable today.

### C — Unverifiable (amber) — the case that matters most
Loyalty payment of AED 1,000 to maid #51002. Profile readable, payment type recorded, amount
positive, no expense record expected for this type, no duplicate, contract type permitted.

Group B runs — and there is **no rule to run**. Test B returns `BLOCKED("no rule exists for
loyalty payments")`. Under §3.2(b), one blocked applicable test makes the note **AMBER**,
even though six tests returned green.

**This note contributes AED 1,000 to M4, and AED 0 to M5.** It is not a pass. On today's data
this is the single largest category of amber, and it is the dashboard's most valuable
output — it says, with a number attached, that a payment type worth real money has no written
rule anywhere in the company.

### D — Edge case: negative amount
Addition of **−AED 450** to maid #47120, clawing back an earlier overpayment.

T3 fires: negative → **REPORTED**, not counted as an overpayment. It appears in the case
table with its own label, contributes −450.00 to M2's negative subtotal (shown separately
from the positive subtotal), and **0** to M8. It is never netted against a positive finding.

### E — Edge case: the blind spot
Salary correction of AED 700 to maid #40155. No matching expense request found. The match
rate for salary corrections this month is **62 %**, below the 80 % floor.

T4 does **not** return RED "no basis". It returns `BLOCKED` → **AMBER**, reason *"expense
record match unreliable for this payment type (62 %)"*. Had the match rate been 94 %, the
same note would have been **RED (F4)**.

This is the difference between an audit and an accusation, and it is why M10 is on the face
of the report.

### F — Edge case: the grain trap
Maid #39004 has two expense payments in the same expense category in the same month. Because
`HOUSEMAID_MANAGER_NOTES` joins on `HOUSEMAID_ID + EXPENSE_ID` (H1), her single note can
appear **twice**.

Expected behaviour: assertion A1 catches it before publication; the note is deduplicated to
one case and its T4 outcome is **BLOCKED** ("multiple candidate expense records"), not
matched-to-the-first. Silently taking the first match would manufacture either a clean
clearance or a false finding, depending on which row sorted first.

---

## 7. Access and data still to be requested

The user asked explicitly for this list. Each item names what to ask for, from whom, and what
stays impossible until it lands.

### Blocking — nothing can be verified without these

| # | What to request | From | Precise ask | Blocked until then |
| --- | --- | --- | --- | --- |
| **R1** | **Snowflake warehouse compute** | Snowflake / Data platform admin | `GRANT USAGE ON WAREHOUSE <name> TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE`, and set it as the role's default. Evidence: `SHOW WAREHOUSES` returns **0 rows**; `CURRENT_WAREHOUSE()` is empty. | **Every** row-level check. No row count, no freshness, no join-cardinality test, no `COUNT(*) = COUNT(DISTINCT ID)` assertion (H1), no reading of the picklist to enumerate the 24 payment types. |
| **R2** | **`SELECT` on the views this spec names** | Data / BA owner of `BA_VIEWS` | `SELECT` for `PAYROLL_AND_MONEY_CONTROL_ROLE` on `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER`, `BA_VIEWS.MONEY_CONTROL_SILVER`, `BA_VIEWS.CORE_SILVER`. The role can *see* these objects; whether it can *read* them is untestable without R1. | Confirming R1 was enough. |
| **R3** | **Ask the Code bearer token** | The requester's own ERP Low-Code Platform session | A fresh JWT (`export ASK_THE_CODE_TOKEN=…`). Tokens expire within hours, so it is needed at the moment of use, not in advance. | Confirming every `UNVERIFIED` ERP column in §2.3 — N1, N2, N3, N6, N7, N8. Without it those stay named-but-unproven. |
| **R4** | **Ingestion of N1, N2, N3** (applied / paid+payslip month / refund flags) | ERP team → Data team | Add the three columns from `mmdb_transformed.payrollmanagernotes` to the warehouse, backfilled from 2024-01-01. | The **population itself**. Scope is "applied, paid, not a refund, windowed on the paid month"; none of those three predicates can be evaluated today. |
| **R5** | **Expose `EXPENSE_ID`, `ADDITION_REASON_ID`, `PURPOSE_ID`** on `HOUSEMAID_MANAGER_NOTES` | Data team (dbt model owner) | Add the columns to the model's SELECT — they are already in the source and already used in its join. | Routing on ids rather than free-text names (N5), and any independent re-check of the expense link. |

### Blocking for specific group rules

| # | What to request | From | Without it |
| --- | --- | --- | --- |
| **R6** | **Flight-home cap by nationality**, plus the service threshold and repeat cycle — **effective-dated** | Payroll / HR policy owner | Group A cannot test amount, entitlement or cycle. Only the ticket-duplicate test runs. |
| **R7** | **Referral and signing bonus scheme prices**, effective-dated, with conditions | Whoever owns the referral scheme | Group C cannot test amount. Auditing paid-against-paid proves nothing. |
| **R8** | **Raffle winners list** | Whoever runs the draw | Group F cannot run at all. Zero raffle objects exist in the warehouse. |
| **R9** | **Effective-dated salary history** | Data team (`mmdb` revision tables) | Group D cannot recompute a part-month or final salary. The profile carries only the current value. |
| **R10** | **A written loyalty payment rule** | Business owner of the loyalty payment | Group B stays permanently amber. **This is not a data request** — the rule does not exist anywhere in the company. Writing it is the fix. |
| **R11** | **Internal payroll-auditor sign-off table** | ERP team | The sign-off cannot be displayed as context. It must never be wired into a test. |

### Delivery and governance

| # | What to request | From | Note |
| --- | --- | --- | --- |
| **R12** | **MaidsInsights** workspace and publish rights for this dashboard | MaidsInsights owner | The dashboard is delivered on MaidsInsights; Snowflake is the warehouse underneath. Not interchangeable. |
| **R13** | **Confirmation of the approved-KPI position** | Data / BA team | Read `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (needs R1). If an approved definition exists for any §4 metric, it wins verbatim with all its filters. If none does, these should be added to the Data Catalog as new P&C definitions. |
| **R14** | **A decision on write-back** | Police & Control | Maker–checker status on a case is a write, which turns a dashboard into a small application. Decide before build, not after. |

### Two defects to raise regardless of this audit

| # | Defect | Where |
| --- | --- | --- |
| **X1** | `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a **manager-note id**, while that column is documented as a **housemaid id**. The ranges overlap, so a wrong reading matches rows and raises no error. Every column of that view profiles as all-NULL. One of the two artefacts is wrong today. | Data team |
| **X2** | `HOUSEMAID_MANAGER_NOTES` may emit more rows than there are notes (H1), and `MANAGER` is entirely NULL despite being a selected column. | Data team (dbt model owner) |

---

## 8. Open items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | Confirm `COUNT(*) = COUNT(DISTINCT ID)` on `HOUSEMAID_MANAGER_NOTES` (H1) | Snowflake team, after R1 | **Yes** — the grain of the whole report |
| O2 | Enumerate the 24 payment types from `PICKLISTS_INFO` and map each to a group (§3.4) | P&C + Payroll, after R1 | **Yes** — unmapped types are amber by construction |
| O3 | Resolve X1 before any use of `RELATED_TO_ID` | Data team | **Yes** for the expense link |
| O4 | Confirm `HOUSEMAIDS_TICKETS` is still being written to (`MAX(PURCHASE_DATE)`) | Snowflake team, after R1 | Yes for group A4 |
| O5 | Confirm `Normal` = company-contract and `MAID_VISA` = MaidVisa; decide the treatment of `FREEDOM_OPERATOR` and `WALKIN` (currently amber per H5) | P&C + Payroll | Yes for T7 |
| O6 | Set the confidence floor for M10 (starting value 80 %) | P&C | Yes for T4's red/amber boundary |
| O7 | Set the amount tolerance for T4, and whether it is absolute, percentage, or both | P&C | Yes for T4 |
| O8 | Confirm the timezone of `NOTE_DATE` and the payslip dates (H12) | Data team | Yes — it moves notes across month boundaries |
| O9 | Decide whether E2 (AI reason adjudication) is in v1 or deferred | P&C | No — group E still runs E1 |
| O10 | Agree the first audit month and the history window for backfill | P&C | No |
| O11 | Decide write-back (R14) | P&C | No — affects build shape |

An empty open-items table would be a good outcome. A hidden assumption would not be — so
these are stated rather than resolved by guesswork.

---

## 9. The honest current state

With the data available today this check can reach a verdict on roughly **a third of the
cases and under a tenth of the money**. The rest cannot be judged — not because those
payments are wrong, but because the rules or the reference data needed to judge them are not
in the warehouse, and in one significant case (the loyalty payment, N13/R10) do not exist
anywhere in the company.

That is the dashboard's most valuable output, and the design must not let it read as a pass.
It is why coverage sits first in the KPI strip, why amber always carries its reason, why
assertion A3 forbids a green verdict on a note that skipped a test, and why assertion A2
forces the blocked count and the amber count to be the same number.
