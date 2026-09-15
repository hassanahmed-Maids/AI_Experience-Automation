# Spec — Police and Control Housemaid Payroll and Salaries

**Part 0 — The page and the shared frame.** Parts 1–6 are the six child specs, reproduced in full and unedited, prompts included.

| | |
| --- | --- |
| **Requested by** | Abdullah Mahdi, Police & Control |
| **Spec version** | v2 |
| **Date** | 2026-09-15 |
| **UI mockup** | Housemaid Payroll Checks — https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp |
| **Status** | Draft. The `spec-auditor` gate has **not** been run on this document. Each of the six checks it merges carries its own gate state, in §6. |
| **Merges** | SPEC_cc_salary_components_v8 · SPEC_maids_salary_check_v5 · SPEC_housemaid_loans_check_v2 · SPEC_loan_repayment_check_v2 · SPEC_with_client_no_contract_v3 · **SPEC_manager_notes_check_v2** |
| **Sibling page** | `SPEC_housemaid_visa_process_v3.md` — the seven visa-money audits, DNA-9829. Two live scope cross-references between the two documents; see OX10 |
| **Changelog** | [spec_history/housemaid_payroll_salaries.md](spec_history/housemaid_payroll_salaries.md) |

**What changed in v2.** Manager Notes joins as Part 6, and it is not an append — it is the only check
on the page that is **ready to build with no blocking open items**, it brings the page's first
`route` and `department` dimensions, and it **settles one open question and opens three more** that
only exist because six checks now sit on one page. Those are OX13, OX14, OX15 and OX16 in §5.

**What this document is.** One page audits the money that moves through a housemaid's pay: what her
salary is made of, what changed it, what the company spent on her that should have been charged
back, whether that debt was ever taken out of her pay, whether we are paying her at all while nobody
is billing for her, and whether every extra line added to her payslip was one she was owed. This
spec is the build document for that page. Part 0 states the frame the six checks share and describes
the page as built. **Parts 1–6 are the six child specs in full**, every data point, rule, metric,
worked example, open item and verifier prompt, exactly as they stand on disk. Where Part 0 and a Part
disagree, the Part is right and Part 0 carries the defect, except for section 4, where Part 0
describes the page and overrides the Parts' own UI sections.

**Plain terms:** six audits, one screen, one rulebook. This file is the rulebook. The six files it
names are the fine print.

---

## 1. Business Logic

**The control.** A housemaid's pay is assembled by rule, not by negotiation. Each part of it — the
wage declared to MOHRE, the accommodation amount — is set by her nationality and her living
arrangement. It may only rise by a route the company has defined. Money the company spends on her
behalf is supposed to land on her balance as a loan and come back out of her salary over the
following months. Anything added to her payslip beyond her salary should trace to a rule that
entitled her to that amount on that day. And on the MV side the whole payroll is funded by a client
who has agreed a worker salary in a contract. This page proves, at each of those points, that the
money that left was the money that should have left, and that the money owed back came back.

**The failure it catches.** Five shapes, and they are not the same kind of money:

| Shape | Plain terms | Which checks |
| --- | --- | --- |
| **Paid too much** | We pay her more than the rule, the authorisation, the entitlement, or the client's agreed salary | Salary Components · Salary Raises · **Manager Notes** |
| **Not collected** | We spent money on her and never charged it to her, or charged it and never took it | Expense → Loan · Loan Repayment |
| **Paid short** | She is paid less than the rule requires, or her record is unfinished | Salary Components · Salary Raises (MV, R5) |
| **Nobody billed** | We pay her every month and no contract covers her | With Client No Contract · Salary Raises (MV, R6) |
| **Control bypassed** | A rule was broken or an authorisation path skipped — **the money may still have been owed** | **Manager Notes** |

🔴 **The first two are company losses. The last three are not.** *Paid short* is entitlement not yet
paid to staff and is the largest number on the page. *Control bypassed* is a process failure on money
that was probably correct — Manager Notes carries **AED 16,626** of it and its own spec forbids adding
it to the money. **The five are never added together**, and §4 gives the page no total for exactly
that reason. See OX6.

**Reader and action.** Police & Control opens the page monthly, after payroll lock — except Manager
Notes, which is read live in whatever window the user picks. A **red** row is a finding to act on:
correct the component, produce the approval, raise the loan, take the deduction, tag the contract, or
decide whether an addition was owed and recover it. A **yellow** row needs a person or time before it
is a finding. A **grey** row is money **nobody has a rule for yet** — never a pass. Cleared cases are
not shown as rows; they are in the counts.

**Population in scope.** Housemaids only — CC (`Normal`, `FREEDOM_OPERATOR`, `WALKIN`) and MV
(`MAID_VISA`). Office staff, Dubai expat staff and part-time cleaners are excluded everywhere, and
n8n-sent and notifier templates are never in scope. Each check's own population and window is stated
in §1.1. **The page never sums money across checks**, because the units are months, cases, maids,
expense items and payslip lines, and the windows run from one live query to nine months.

**Grain.** Differs by check and is stated per check in §1.1. **Manager Notes is per NOTE, not per
maid** — every addition is its own payment event with its own rule and its own date, and there is
nothing to allocate. A count on the page always says its unit.

**Refresh expectation.** Monthly, after payroll lock, on demand. **Ad hoc only: no scheduled
unattended run.** Two exceptions in opposite directions: **Loan Repayment runs on the latest closed
month only** and must not be trended or backfilled — its ledger cannot reconstruct a past month
(Part 4 §6); **Manager Notes is live**, reading current data in whatever window the user selects,
which is what forces its check-design rule in §3.

### 1.1 The six checks, in the order money moves through her pay

| Step | Check | Roadmap | Authority spec | Window measured | One row is | AI verifier |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Salary Components (CC) | — | `SPEC_cc_salary_components_v8.md` | snapshot, as at 2026-09-10 | one maid, per run | **No**, by design — the rule is arithmetic |
| 2 | Salary Raises and MV Margin | #19, Payroll | `SPEC_maids_salary_check_v5.md` | one payroll month; August 2026 measured | one maid per payroll month | **Yes — two agents**, reader plus verifier |
| 3 | Expense → Loan Charged | #45, Payroll | `SPEC_housemaid_loans_check_v2.md` | 1 Jan – 10 Sep 2026; month parameter, earliest Jan 2026 | one expense item | Yes — the fault read (M6) |
| 4 | Loan Repayment | — | `SPEC_loan_repayment_check_v2.md` | **latest closed month only**; August 2026 measured | one maid per payroll month | Yes |
| 5 | With Client, No Contract | — | `SPEC_with_client_no_contract_v3.md` | one snapshot, stamped to the minute | one maid, one snapshot | **No** |
| 6 | **Manager Notes** | — | `SPEC_manager_notes_check_v2.md` | **live, user-chosen**; 12 months to 2026-09-15 measured | **one note** | Yes — V1, on every red note |

The order is the order money moves: what her pay is made of → what changed it → what she was charged
→ what was taken back → whether anyone is paying for her → what else was added to her payslip.

**Three things about this list the page must not flatten.** Check 6 is the **only one ready to build**
(§6) and the only one that is genuinely live. Check 5's own author **recommends against building it as
a dashboard at all** (Part 5 §6: two findings, AED 3,500, in a population of 5,558 where the median
untagged maid is re-tagged within a day). And Check 2's scope was cut on 2026-09-10 so that it looks
**only at raises made in the audited month**, which leaves every unexplained raise granted before the
check starts running examined by nothing. These are OX8 and OX7 in §5.

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

Every table below was read live under `MONEY_CONTROL_ROLE` on the date its child spec states.
Column-level detail, grain and the verification counts are in each child spec's §2; this table says
which tables each check reads, so the build team can see the shared footprint — and so the places two
checks read the same table for different purposes are visible.

| Table | Components | Raises | Expense→Loan | Repayment | With Client | Manager Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | ✓ population and both audited components | ✓ population, type, hire date | ✓ type and termination status | ✓ accommodation, deduction cap, salary start | ✓ status and type | ✓ maid master · ⚠ current state only |
| `…HOUSEMAID_PAYROLL_HISTORY` | ✓ **row presence** — the new-maid grace (M4) | ✓ salary paid (M1a) | | ✓ **`IS_TRANSFERRED='YES'`** — the population rule | ✓ transferred exposure (M7) | ✓ **`PAID_ON_DATE_FORMATTED`** — the day money moved (D14) |
| `…HOUSEMAIDS_INFO_REVISION` | ✓ component history, as-of rebuild | ✓ **every salary change and who made it** | | | | ✓ point-in-time `LIVE_OUT` (D7) |
| `…HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | | | ✓ the ledger clause on R1, and R2's match | ✓ **what she still owes** | | |
| `…HOUSEMAID_TYPE_LOGS` | | ✓ the MV→CC route, 24 continuous months | | | | ✓ **contract type as of** (D4) |
| `…HOUSEMAID_STATUS_LOGS` | | | | | ✓ where she came from (M6) | ✓ **status as of** (D5) — the authority, never the payslip |
| `…HOUSEMAID_MANAGER_NOTES` | | | | | | ✓ **the addition itself — the whole population** (D1) |
| `…HOUSEMAID_MANAGERACTIONLOGS` | | ✓ categories 6 and 7, via `ACTION_DATE` | | | | ✓ anti-attrition enrolment, via **`CREATION_DATE`** (D10) — see OX14 |
| `…RETRACTION_CASES_TOOL_CALLS` | | ✓ category 5, retention raise given | | | | |
| `…RESIGNATION_TO_DOS` | | ✓ background only, carries no amount | | | | |
| `…HOUSEMAID_TAGS_LOGS` | | | | | ✓ **cleaner tag — `IS_ACTIVE`, never the flattened string** | |
| `…HOUSEMAID_REFERRALS` | | | | | | ✓ the authorised referral amount (D8) |
| `…MAIDS_REFERRALS_BONUSES` | | | | | | ✓ paid amount only — ⚠ **circular as a price source** (D9) |
| `…WPS_RECORDS` | ✓ corroboration only — 93.7% | | | | | |
| `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | | | ✓ **the expense and its typed loan amount** | | | ✓ **the authorising request** (D2) — see OX13 |
| `…MONEY_CONTROL_SILVER.TRANSACTIONS` | | | ✓ the complete money record; the EID leg | | | |
| `…MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | | | ✓ code settings and `LOAN_TYPE` | | | ✓ head config (D3) — ⚠ not unique on `EXPENSE_TYPE` |
| `BA_VIEWS.SALES_SILVER.CONTRACTS` | | ✓ which contract was in force | | | ✓ **is anyone billed for her** | |
| `…SALES_SILVER.CONTRACTS_HISTORY` | | ✓ **the agreed worker salary as of the month (D18)** | | | | |
| `…SALES_SILVER.CONTRACTS_PAYMENTS_TERMS` | | ✓ when the terms changed — not what the salary is | | | | |
| `BA_VIEWS.MONEY_COLLECTION_SILVER.PAYMENTS_LOGS` | | ✓ corroboration; the cancelled-contract test | | | | |
| `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CONTRACTS_WITH_PRE_COLLECTED_SALARIES` | | ✓ why M10 exists — 88% of MV contracts | | | | |
| `…CLIENT_MANAGEMENT_SILVER.CLIENT_REPLACEMENTS` | | | | | ✓ **provisional only — 4.4% date agreement** | |
| `…CLIENT_MANAGEMENT_SILVER.COMPLAINTS` + `COMPLAINT_COMMENTS` | | ✓ verifier text | ✓ verifier text | ✓ verifier text | | ✓ verifier text, secondary to `NOTE_REASON` |
| `BA_VIEWS.CORE_SILVER.PICKLISTS_ITEMS_TAGS` | | ✓ the salary ladder and renewal raise | | | | |
| `BA_VIEWS.CORE_SILVER.USERS_INFO` | | ✓ who granted the raise | | | | ✓ **name → email bridge** (D11) |
| `BA_VIEWS.CORE_SILVER.OFFICE_STAFF` | | | | | | ✓ **department — email only, no name or id** (D12) |
| `BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES` | | | | | | ✓ department as of the note — **joins by NAME**, history starts 2025-06-15 (D13) |
| `BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS` | | ✓ the renewal route | | | | |
| `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | ✓ corroboration only — 92.2% | | | | | |
| **A hardcoded rate table** (not Snowflake) | ✓ **the standard itself** — 14 CC rules transcribed by hand | | | | | |
| **A daily snapshot table** (to be created) | | | | | ✓ **the clock; does not exist yet** | |

🔴 **Two of the six checks do not run on Snowflake alone.** Check 1's standard is a **hand-transcribed
constant**, not a query — six ERP rules changed on 2026-08-17 and one on 2026-09-08, and a stale
constant fails silently. Check 5's central metric, *how long has she been this way*, **cannot be
answered by any table that exists today** and needs a daily snapshot table built before it is correct.
Neither is an ingestion request; both are build obligations. They are the two places this page is not
self-verifying.

### 2.2 Approved KPI definitions reused

**None is reused as a metric.** `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` holds 1,066
approved SQL definitions across 971 `SEMANTIC_ID`s. Three touch this money and each is a cross-check,
never the number on the page:

| Entry | Used by | How |
| --- | --- | --- |
| `BI_PAYROLL_CC_MAID_SALARY_RAISES_BY_REASON` — Payroll KPI 3.4c, DNA-6364 | Raises | **Control total only.** Its reasons map onto categories 1, 2, 3 and 5 and disagree by up to 3×. It carries a literal `'Total salary raises'` row, so adding across reasons gives exactly twice the truth (326 against 163 for 2026-08). **Ruled 2026-09-10: register §3B as a NEW approved P&C definition** rather than reuse 3.4c, whose `fill_information_completed` gate lives in model SQL `BA_VIEWS` does not expose. Unreconciled gap: **20 rows and AED 33,950** |
| `client-management-dashboard__family-management-families-without-a-maid` | With Client | The **client-side mirror** of the same broken link, at a 3-day allowance against this check's 7. Different population, different question. **The maid-side allowance is 7 days, settled and not open** |
| The undeducted-loan KPI (CC 80.2% / MV 95.2%) | Manager Notes | Used **only to contradict a wrong reading of a loan field.** It defines none of the money |

**Every metric in Parts 1–6 is a new Police & Control definition and should be added to the Data
Catalog.**

*Method note for anyone rechecking `INSIGHTS_DASHBOARD_CONTAINER`: the approved SQL is nested inside
the `TOOLTIP_INFO` VARIANT under `tabs[].fields[]` where `type = 'sql'` — **not** under a `sql` key,
and a `LEFT(TOOLTIP_INFO, n)` preview shows only CSS selectors. Querying the wrong key returns a
confident zero.*

### 2.3 New data ingestion request — NOT yet in Snowflake

Six items. **One is blocking** and it is the highest-value ask in the family.

| # | Data point | Source | Needed by | Blocks |
| --- | --- | --- | --- | --- |
| **I3** | 🔴 **`PAID_ON_PAYROLL_MONTH` and `PAID`** | ERP — `payrollmanagernotes` | Manager Notes | **Yes.** Nothing in the warehouse says which payroll month a note pays for. The ERP writes these columns; they are simply not ingested. Without them the payslip is **guessed by month**, and the documented fallback needs a payroll-lock window whose column `LAST_PAYROLL_LOCK_DATE` **has no non-null values at all**. It has now bitten three separate findings |
| I1 | `CREATOR` (`BIGINT` → `USERS.ID`) | ERP — `payrollmanagernotes` | Manager Notes | **There is no author column for a manager note anywhere in the warehouse**, so **58% of the money is unattributable to a person.** `MANAGER` is unmapped in the JPA entity and 100% null; `REQUESTED_BY` is the *expense record's* requester carried through the join. ⚠️ **Ingesting the column alone is not sufficient** — `creator` is null inside background tasks and scheduled jobs, which is where most of this money is written. `RafflePerformerJob` already stamps `erp_user` when creator would be null, so the ask is *"do what the raffle job does"*, not a design |
| I2 | `FROM_MANAGER_ID` | ERP — `payrollmanagernotes` | Manager Notes | The owning-manager picklist. Airfare hardcodes `managers/jad`; five of six other automated paths set nothing |
| I4 | `INCENTIVE_AMOUNT` | ERP — `maidmanageractionlogs` | Manager Notes | The maid's enrolled anti-attrition tier. Not exposed, so C1 and C10 must **proxy** it as the largest whole-entitlement note she received across the window — NULL where she was never paid a whole month, which is **42 of 110 notes / AED 2,566** on C1's population alone |
| N1 | Delighter to-do completed tasks | ERP — `mmdb.delightertodos`, `…_completedtasks` | Raises | The structured approval for a retention raise and the only place its approved amount sits beside its decision. KPI 3.4c already reads these; they are not in `BA_VIEWS` |
| N2 | The CPT's own worker-salary field | ERP — `CONTRACTS_PAYMENTS_TERMS` carries no salary column | Raises (MV) | Nothing today. D18 is used instead and agrees with the CPT's timing on every hand-checked case. Ingesting it would let the rule **read the agreement directly rather than infer it** |

**Not ingestion requests, and they must not be filed as such:** Check 1's hand-transcribed rate table
(re-transcribe quarterly, tripwire in M0c) and Check 5's daily snapshot table, which this build creates
and writes and which **accrues** rather than being sourced.

**Join keys.** All maid-keyed joins are NUMBER to NUMBER, no conversion:
`HOUSEMAIDS_INFO.ID` = `HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID` = `HOUSEMAIDS_INFO_REVISION.ID`
= `HOUSEMAID_TYPE_LOGS.HOUSEMAID_ID` = `HOUSEMAID_STATUS_LOGS.HOUSEMAID_ID`
= `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS.HOUSEMAID_ID` = `COMPLAINTS.HOUSEMAID_ID`
= `HOUSEMAID_MANAGERACTIONLOGS.HOUSEMAID_ID` = `HOUSEMAID_MANAGER_NOTES.HOUSEMAID_ID`
= `RETRACTION_CASES_TOOL_CALLS.MAID_ID` = `RENEW_VISA_REQUESTS.OWNER_ID` = `CONTRACTS.HOUSEMAID_ID`.
Inside the complaint pair, `COMPLAINT_COMMENTS.COMPLAINT_ID` = `COMPLAINTS.ID` — **the comments table
has no maid id of its own.** On the expense side, `EXPENSES_REQUESTS.RELATED_TO_ID` → `HOUSEMAIDS_INFO.ID`
with `RELATED_TO_TYPE='MAID'`, and `TRANSACTIONS.EXPENSE_ID` → **`EXPENSES_CONFIGURATION.ID`, not a
request id**. `HOUSEMAID_MANAGER_NOTES.EXPENSE_ID` → **`EXPENSES_REQUESTS.ID`** (OX13).
`CONTRACTS_HISTORY.CONTRACT_ID` and `CONTRACTS_PAYMENTS_TERMS.CONTRACT_ID` → `CONTRACTS.ID`.

**As-of joins are interval containment and must be half-open:**
`day >= CHANGE_DATE::DATE AND (NEXT_CHANGE_DATE IS NULL OR day < NEXT_CHANGE_DATE::DATE)`.
**Written as `BETWEEN`, the change day is counted twice.** `HOUSEMAIDS_INFO_REVISION` is Envers and has
**no closing edge**, so it needs *latest revision at or before the day* via
`QUALIFY ROW_NUMBER() … ORDER BY changed_on DESC = 1`, not containment.

🔴 **There is no key joining an expense to a loan.** `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` carries
no expense or transaction reference at all. Check 3 therefore matches on **maid + loan type + exact
amount within ±45 days**, and that limitation is stated on every run. It is the single largest
structural weakness in this family: two of the six checks reason about a debt they cannot key to the
cost that created it.

### 2.4 Hygiene rules that travel across the six checks

Each was found in one check and applies wherever the same table is read.

| Rule | Found in | Plain terms |
| --- | --- | --- |
| **`IS_TRANSFERRED` is TEXT `'YES'`/`'NO'`, never a boolean.** `= TRUE` returns zero rows, raises no error, and reads exactly like *nobody was paid* | Components, Repayment, With Client | The flag is a word, not a tick |
| 🔴 **And nobody agrees what it means.** Repayment treats `'YES'` as *we paid her*; its own verifier found a case where staff say we had not. **Manager Notes measured it across all 24 payment types and concluded it tracks TERMINATION, not payment** — `MV Prorated Salary` runs at **59.9% not transferred** against **0.5–3.7% everywhere else**, and that type pays terminated maids. Reading it as *the money never left* would have removed **AED 506,309** that was almost certainly settled. **It is an amber flag, never a filter** — see OX1 | **all four that read it** | One column, three readings, one measurement |
| **The loan ledger is snapshot history.** The same loan is returned up to three times — same maid, same amount, different `STATUS` and `REPAID_AMOUNT` — and **`BALANCE_DATE` is identical across the copies**, so ordering by date picks one at random. Summing raw overstates by 12–22%. **Collapse to one row per `ID`, keeping the greatest `REPAID_AMOUNT`** | Expense→Loan, Repayment, GCC (sibling page) | Same loan, several rows — and the tie-break is not the date |
| **`REMAINING_AMOUNT` is 0 on every one of all 81,579 rows, including unpaid loans.** Outstanding is `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT` | Expense→Loan, Repayment | The column exists and is empty |
| **`HOUSEMAID_PAYROLL_HISTORY` is not one row per maid per month.** For 2026-08: 22 CC maids hold 66 rows, 15 with differing amounts; 7 MV maids hold 14 rows. **Deduplicate, and state which value you took** | Raises, With Client | Dedupe, and say how |
| 🔴 **And its `STATUS` column disagrees with the status log**, showing `WITH_CLIENT` where `HOUSEMAID_STATUS_LOGS` says `NO_SHOW_LEFT_CLIENT_HOME`. It is a snapshot of unknown timing. **Read status from the log, never from the payslip** | Manager Notes | Two answers, one is authoritative |
| **`HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE` is 100% NULL.** Do not build on it — and note a documented fallback in Manager Notes needed exactly this column and could not use it | Components, Manager Notes | The column exists and is empty |
| **Read `COMPLAINT_COMMENTS.TEXT`, never `ORIGINAL_TEXT`** (raw HTML), and **never `COMPLAINTS.GPT_SUMMARY`** (ERP's own compression, blank on most rows) | Raises, Expense→Loan, Repayment, Manager Notes | A verdict built on a summary is not a read |
| **`BASIC_SALARY_MODIFIED`, `LIVE_OUT_MODIFIED` and `IS_TAG_DELETED` have three states — `'00'`, `'01'` and NULL.** Always test `= '01'`; **never wrap them in `COALESCE` or use `IS DISTINCT FROM`** or 1.1 million NULL rows arrive as salary changes | Raises | Three states, not two |
| **Vocabularies that look like one.** `HOUSEMAID_TYPE_LOGS.TO_TYPE` is `MV`/`CC Live In`/`CC Live Out`; `HOUSEMAIDS_INFO.HOUSEMAID_TYPE` is `MAID_VISA`/`Normal`/`FREEDOM_OPERATOR`/`WALKIN`; `CONTRACTS.CONTRACT_TYPE` is `CC`/`MV`. **They share no values.** 🔴 A `LIKE '%MAID_VISA%'` against the type log **matched nothing and silently suppressed a real signal** | Raises, Components, With Client, Manager Notes | The same idea spelled three ways |
| **`HOUSEMAID_TYPE` is current state and maids switch.** Re-querying the same month a day later returned CC 458 / MV 849 where an earlier run gave 457 / 850. **Quote a figure with the date it was read** | Repayment | The answer moves while you read it |
| 🔴 **Current-state columns are not history, and one of them is never cleared.** `HOUSEMAIDS_INFO.DATE_OF_TERMINATION` **is not reset on re-hire**, so a returning maid reads as *terminated 558 days ago* forever. It voided a AED 3,000 finding | Manager Notes | Today's row does not describe a past day |
| **Salary and money columns are FLOAT. Round both sides to 2 dp before comparing** | Components, Raises | Compare rounded, not raw |
| **Current-state tables carry no snapshot column, so a past run cannot be rebuilt.** **Persist every run's output with its `AS_OF_DATE`** | Components, With Client | Yesterday's report cannot be re-derived |
| 🔴 **`AMOUNT > 0` is mandatory everywhere, and a zero-amount note is a CANCELLATION.** Narratives read *"postponed"*, *"confirmed NOT to release"*, *"Duplicated"*, *"paid manually"*. **A check may use another note's amount; it may never use another note's existence unless that note has `AMOUNT > 0`.** Pairing on existence produced **26 false pairs worth AED 46,000** and one retracted finding of **AED 49,500** | Manager Notes | A cancelled payment is not a payment |
| 🔴 **Absence is not zero.** Scoring *no entitlement record* as *entitlement of 0* turned one check from 16 maids / AED 11,500 into 40 maids / **~AED 58,000**. Scope with an **INNER join to the population that has the thing being compared** | Manager Notes | No record means untestable, not owed nothing |
| **`EXCLUDED_FROM_PAYROLL` is TEXT `'00'`/`'01'` on 1,532 maids — carry it as a column. `IS_DELETED` is true for 1 maid of 123,237**, so gating on it removes nothing | Raises | A gate that filters nothing |
| **Name-keyed joins need normalising on case AND internal whitespace** — `"Georgina  Wakim"` carries a double space — and text identity columns are `''` not NULL on absence, so `IS NOT NULL` clears a note nobody approved. Use `NULLIF(TRIM(x),'')`. **43% of approvals that exist carry a bare first name**, which resolves to a person only when unique | Manager Notes | An empty string is not a null |
| 🔴 **A tie-out that balances is not proof it is right.** Measure every bucket with **its own positive predicate**, *and* measure the **residue** — the count matching no bucket — and require it to be zero. Check 1 carries this scar twice: a balancing identity once hid 106 maids in the wrong bucket, and a later draft left **27 maids in no bucket at all** while both identities still summed | Components | Addends agreeing proves nothing about who was left out |
| 🔴 **A retracted check keeps its number and stays visible at zero.** A silently removed row is indistinguishable from a dropped one, and that is how an old AED 103,100 headline drifted | Manager Notes | Retired, not deleted |
| **All amounts are AED and no source carries a currency column**, so there is nothing to filter on **and nothing would reveal a non-AED row if one appeared** | all | No FX, and no warning either |

---

## 3. Metric Calculations

**Shared conventions.** Currency is AED throughout; no check converts. Amounts are held to two
decimals, rounded at row level and **never on a total**. A NULL money column reads as zero except
where a child spec says a NULL is a data-quality row rather than a pass. Division by zero displays a
dash, never 0%. Every metric id on the page is the child spec's own id; **the ids do not share a
namespace across checks** — Check 1's M4, Check 4's M4 and Check 6's C4 are unrelated.

**Flags, the same four on every table:**

| Flag | Means | On the page |
| --- | --- | --- |
| **Red** | A definite finding: money out above the rule, money in that never came back, or an addition nothing entitles her to | Row shown, red stripe, under *Paid too much*, *Not collected* or *Nobody billed* |
| **Yellow** | Needs a person or time: below the rule, inside a settling window, explained but not authorised, a payment date that cannot be established | Row shown, yellow stripe, under *Needs review* |
| **Grey** | 🔴 **No rule exists to test this**, money paid outside payroll, components not yet set up, or a clock that is unavailable | Row shown, grey stripe, under *Needs review* — **never green** |
| **Green** | Cleared: every applicable test ran and passed | **Not shown as a row**; counted in the tab labels and tiles |

🔴 **Grey is not a pass, and the page must never let it read as one.** Manager Notes leaves
**~AED 962,000 across four payment types untested** — not because they passed, but because no
entitlement rule exists to test them against. **A type with no rule is not a clean type.** The same
applies to Check 1's 76 excused maids and Check 5's unavailable clock.

**Tie-outs are build-time assertions, not page furniture.** Every check has at least one identity and
they are computed on every run; **a failed identity blocks that check's section** rather than printing
a number nobody can trust. They are not displayed. Two identities bind across checks:
**no check counts a subset of another** — a AED 3,050 row sat on a ledger for a week before it was
found to be a subset of another check — and **no figure is a sum of tests**, which caught four
separate near-misses, one of them 58%.

### 🔴 3.1 Which instant a check reads — and why it is not a detail

**One check defined a single as-of instant and applied it everywhere. That was wrong, and it cost 88%
of its own money.** A note is written at month end; payroll pays one to three days later. Those are
different days and the maid's state can differ on them.

| Instant | Definition |
| --- | --- |
| **`AS_OF(event)`** | State at the governed event's own date, by interval containment or latest-revision. **Never today's value** |
| **`AS_OF_PAYMENT`** | State on the day money actually moved — `HOUSEMAID_PAYROLL_HISTORY.PAID_ON_DATE_FORMATTED` |
| **`ENTITLEMENT_DAY`** | The day the rule's entitlement arose — the renewal, the enrolment, the first day of the pay period |

**The choice is decided by the rule, never by convenience:** a rule about **entitlement** ("was she
owed this?") reads `ENTITLEMENT_DAY`; a rule about **whether money should have left** reads
`AS_OF_PAYMENT`; `AS_OF(event)` is correct only where the event's own date *is* the governed event.

**What getting it wrong cost, measured:** one check read status at the note date. Of its 110 notes,
**63 went to maids who were back at work on the day payroll ran** — a `NO_SHOW` flag at month end that
reads `WITH_CLIENT` by the 3rd is a transient operational state, not abscondment. The check read
AED 13,257; it is **AED 1,613**.

**This rule is not Manager Notes' alone.** Check 2 already reads the contract's agreed salary *as of
the month* rather than current state, after the current-state column produced two of four reds and
five of six ambers as pure artefact. Check 3 reads the maid's type as of the charge date. **Any check
that compares a person's state to a payment must name which of the three instants it uses.**

### 🔴 3.2 What a live, user-chosen window forbids

Manager Notes reads current data in whatever window the user picks, which makes three things
impossible and the build must respect them:

1. **Lookbacks ignore the display window.** *"No second airfare within 5 months"* looks 5 months back
   from **the note**, even when the user is viewing one month. A check that sees only the displayed
   rows reports a clean month that is not clean.
2. **Anything expressed as a share of the window is not a check.** Requester concentration, producer
   share, "% of notes" — investigative tools, not dashboard rules.
3. **Base rates cannot live in the UI.** They are how a finding is *validated* before it becomes a
   check — a 10.6% month-end conversion rate retracted AED 5,100 — but a rate computed over the
   displayed window is not a rate.

**The testable surface is therefore one payment event, given a verdict on its own terms, with whatever
lookback its own rule needs.**

### 3.3 The AI verifier, where a check has one

Four of the six checks read free text to decide whether a human already explained a case: **Salary
Raises**, **Expense → Loan**, **Loan Repayment** and **Manager Notes**. **Salary Components has none
by design** — its rule is arithmetic against a published rate, and no note changes whether 1,000
equals 600. **With Client, No Contract has none** — its question is a clock, not a reason. All four
use the house contract; only their category lists differ, and those lists and the verbatim prompts
live in the child specs.

- **Six verdicts, never renamed or extended:** `JUSTIFIED` · `PLAUSIBLE` · `AMBIGUOUS` ·
  `NOT_RELATED` · `UNRESOLVED` · `NO_TEXT`. `NOT_READ` is a **run state, not a verdict** — model
  error, timeout, unparseable output, budget exhausted. It **stays red and is counted apart from
  `NOT_RELATED`**, so the report can never say a case was read when nobody read it.
- **Only `JUSTIFIED` ever clears**, and only on the narrow ground the child spec states. Explaining a
  case without authorising it is `PLAUSIBLE` and stays red or goes to the officer.
- **The verifier never computes an amount and never clears arithmetic.** Its whole output is a
  verdict, a category and a quote, so **an agent error can misjudge one case and can never move a
  total.**
- **`category_id` is null, and MUST be null, for `NOT_RELATED`, `NO_TEXT` and `UNRESOLVED`.** The open
  category is for a reason the model **found** that the list lacks a name for, never for the absence
  of one.
- **Four mechanical rules.** A verdict with no quote and no `source_id` is not a verdict. **Redaction
  happens at the model** — names, phone numbers, emails, URLs and ids become placeholders before the
  quote leaves it, and the report never re-fetches raw text for display. `threads_read` is compared
  against what was supplied; **lower means rejected and re-run**. Verdicts are pinned to
  `(case id, hash of the exact text set read)` so a case never moves flag with no data change.
- **One case per call. Never batch** — an angry thread primes the next one.
- **`claude-sonnet-5`, temperature 0, and the same prompt every run.**

**Evidence coverage is not uniform, and the page should not pretend it is.** Check 6's primary source
is `HOUSEMAID_MANAGER_NOTES.NOTE_REASON`, which is **unusually rich** — airfare narratives routinely
carry the whole decision (*"Postponed till she completes 22 months"*, *"Approved by Medhat to release
earlier todo/657202"*). The sibling GCC check's coverage is thin by contrast: only 2 of 14 shortfall
maids had a manager note in the window at all. **A `NO_TEXT` verdict means something different on
those two checks**, and the reader needs to know which they are looking at.

🔴 **The verifier pattern is still not uniform.** Check 2 runs **two** agents: a reader, then a
verifier that marks the reader's homework against six checks (V1 quote exists · V2 quote is complete ·
V3 supports this category · V4 authorises this amount · V5 is redacted · V6 everything was read). It
never overwrites the reader — a disagreement goes to the officer with both verdicts and the failed
check named, and a majority is never taken. **Checks 3, 4 and 6 run a single reader and therefore have
no V2 control** — and V2, the incomplete quote, is precisely the failure arithmetic cannot see. See
OX9.

---

## 4. Finalised UI Report

Mockup: **Housemaid Payroll Checks** — https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp

**This section describes the page as built and it overrides the §4 of every child spec where they
differ.** It follows the Visa Controls page (DNA-9829) as the house dashboard template — same
stylesheet, same tile / switch / table anatomy, same red-or-yellow row rule — so the two pages read as
one system.

⚠ **What in the mockup is measured and what is not.** Every **KPI tile figure, switch count and
narrative note is the measured number** from the child spec named on the tile. The **table rows are
illustrative**: where a child spec worked a real case the row carries its real ids and figures, and
every other row is a representative case of a shape the spec measured, with an id in range. **No table
row is a query output.**

**Layout.** Title bar with the as-of date → one sticky **date window** control → six reports stacked on
one scrolling page, in the §1.1 order, separated by a rule. No tabs across checks. Each report is:
heading → four KPI tiles → a switch → one exception table per switch position.

**Date window, and the three behaviours behind it.** Presets This month · Last month · Last quarter ·
Last 12 months (default) · Custom range. **Only Manager Notes is genuinely driven by it** — it reads
live data in whatever window is selected. Checks 1, 2 and 3 are keyed to a snapshot or a payroll month.
**Checks 4 and 5 cannot honour it at all** and carry *fixed window* beside the heading, the control
greying for them rather than silently returning a wrong answer: Loan Repayment's ledger records how
much of a loan was repaid but **not when**, so every past month looks better than it was; With Client's
untagged layer read 47, 52 then 45 within twenty minutes.

**KPI tiles**, four per check, each carrying the metric id from its child spec and a one-line unit
statement. Labels are the words on the screen:

| Check | Tile 1 (red) | Tile 2 | Tile 3 | Tile 4 |
| --- | --- | --- | --- | --- |
| Salary Components | Paid above the rule — the company's loss · M7 | Paid below the rule, or blank — owed to staff · M8 | Share of CC maids off their own rule · M3 | Excused — components not set up, never paid · M4 |
| Salary Raises | CC raises with nothing authorising them · R1 + R2 | MV — we pay her more than her client agreed · R4 | CC paid above her group's standard, **and the rest of the review queue** · A1 | Coverage — the share this check can judge · M6 |
| Expense → Loan | Expense paid, no loan raised and none on her ledger · R1 | Loan typed on the expense, never posted · R2 | **Awaiting the fault read — a human decides these · M4 · M1** | Exception rate, and its denominator · M3 |
| Loan Repayment | Owed, we paid her, nothing deducted · M4 | Collectable this month, after both caps · M5 | **Needs a human before Payroll is sent · verifier** | Median owed per finding — read before the count |
| With Client | With a client, no contract, past 7 days · M5 | Watch — 7 days or fewer · M3 − M5 | Untagged share, and the median age · M3 | Cleaners parked in `WITH_CLIENT` — not this check's |
| **Manager Notes** | **Additions nothing entitled her to · 11 checks** | **Money examined, and what no rule covers** | **Control broken, money may be owed — never in the total** | **Red rate, and its denominator** |

**Check 6's tiles sit above a tab row rather than a switch — see §4.1.**

🔴 **The yellow tile carries money, not a count — it is the size of the review queue.**
A tile that reads *146 cases* tells an officer how many rows to open and nothing about whether it is
worth opening them. The yellow tile therefore leads with **the AED of the cases that are neither red
nor green** — the money a human still has to rule on — with the case count in its sub-line. Five of
the six are priced from their own child spec:

| Check | Review-queue money | What it is |
| --- | --- | --- |
| Salary Components | **AED 375,856.00 / mo** | 1,365 maids below the rule — owed to staff, not a company loss |
| Salary Raises | **AED 202,019.00 / mo** | 657 above the standard, plus 5 held mismatches at AED 1,644/mo. **774 further rows carry no comparable figure** and the tile says so |
| Expense → Loan | **AED 28,125.56** | M1 for August, and M4 puts **every one of the 146 exceptions** in the read queue — nothing is actioned until fault is decided |
| Loan Repayment | **AED 11,386.00** | the two of the first ten read that did not stand. **1,204 of 1,214 findings are unread and their amount is not established** |
| With Client | **not priced** | 43 watch maids. **M7 sums transferred pay over red cases only**, so this layer has no measured exposure — see below |
| Manager Notes | **AED 16,626.00** | control findings, beside ~AED 962,000 that no rule can test (its own grey tile) |

⚠️ **Two of those cells are admissions, and the tile must print them rather than fill the gap with a
count.** Check 5's watch layer is **unpriced by construction** — `M7` is defined over red cases only,
so the spec has never costed the population it asks an officer to watch. Check 4's queue is **10 of
1,214 read**, so AED 11,386 is what is established, not what is there. **A yellow tile showing a tidy
number for either would be inventing the answer**, which is the same failure as showing grey as green.

🔴 **Check 4's yellow tile changed meaning, not just units.** It used to read *cleared by an exclusion
— 125 cases*, which belongs nearer green than yellow: a maid cleared by the wage floor is **a correct
zero, not a missed deduction**, and putting her in the review queue invites a review that should not
happen. The yellow tile now holds what actually needs a human — the verifier's unresolved output.

🔴 **There is no page total and there will not be one.** The six checks measure **money leaving above
the rule**, **money never collected**, **entitlement not yet paid to staff**, **pay with nobody
billed**, and **a control broken on money that was probably correct**. A single "at risk" figure would
add a AED 375,856 staff underpayment to a AED 15,342 overpayment and a AED 16,626 process failure and
report the sum as exposure. Each tile states its own unit and window; nothing sums across sections.

**The switch, the same five names on every table**, each with its count. **The five positions are the
five failure shapes in §1, one to one** — so a row's position is the kind of money it is, not merely
its colour. A check shows only the positions that apply to it:

| Position | Holds | Checks |
| --- | --- | --- |
| **Paid too much** | red rows: we pay more than the rule, the authorisation, the entitlement or the client's agreed salary | Components · Raises · Manager Notes |
| **Not collected** | red rows: money we spent on her that never came back | Expense → Loan · Loan Repayment |
| **Nobody billed** | red rows: we pay her every month and no contract covers her | With Client · Raises (MV, R6) |
| **Control bypassed** | a rule was broken or an authorisation skipped — **money may still have been owed, and it is never added to the money** | Manager Notes |
| **Needs review** | every yellow and grey row: below the rule, held, excused, unreadable, awaiting a verdict, or **no rule exists to test it** | all six |

**Why five and not the visa page's three.** That page audits fees that should come back, so two red
buckets cover it. This page carries two shapes it does not have — **pay that is correct in every amount
and funded by nobody**, and **a control broken on money that was probably owed**. Folding the first
into either red bucket would misname 60 maids at AED 75,350 a month; folding the second in would put
AED 16,626 of process failures into a loss total that its own spec forbids.

### 4.1 Manager Notes reads by payment type, not by outcome — the one section with a different anatomy

🔴 **Check 6 does not use the switch above. It uses a tab per payment type, plus one filter bar.**
The other five checks each audit **one homogeneous population** against one rule family, so a switch on
the outcome is the whole navigation they need. Check 6 audits **24 payment types under eleven separate
rules**, each type with its own entitlement source, its own owner and in several cases **no rule at
all** — and an officer works it *by payment type*, because that is the unit a rule and an owner attach
to. A single outcome switch would bury eleven rules in one list.

**The anatomy, and each part earns its place:**

1. **A tab per payment type**, ordered by red weight, plus an **All types** tab. Types with money but
   no red — Maids.at other expenses, Office work — **still get a tab showing a zero**, because their
   money is untested rather than clean, and a type that disappears reads as a type that passed.
   **Cross-type · C9** is its own tab: *note exceeds its approved request* fires on any type carrying
   an expense request, so it has no home of its own and must not be silently filed under one.
2. **A red-case count on every tab.** It is **live** — it recomputes under the filter bar, so the
   badge always describes what the officer would actually find inside. The badges sum to the
   All-types badge, and that identity is a build-time assertion like any other: **134 today**
   (55 + 25 + 22 + 16 + 5 + 4 + 4 + 3, with two types at zero).
3. **One filter bar, shared by every tab.** Outcome (All rows / Paid too much / Control bypassed /
   Needs review) · Route · Transferred · Department, plus Reset. **Filter state persists across tab
   switches** — an officer filtering to `direct` route keeps that filter while moving between types,
   which is the whole point of a unified bar rather than per-tab controls.
4. **The outcome filter preserves the page's own vocabulary.** Its positions are the §4 switch
   positions that apply to this check, so the five failure shapes still name the same things here as
   everywhere else. Check 6 has not been given a private language.

🔴 **Two rules about the counts, and both are load-bearing.**
**The tab badges respond to Route, Transferred and Department, but NOT to the outcome filter.** A badge
is *how much red is in this type*; if it moved with the outcome view, every badge would read zero while
the officer was looking at *Control bypassed*, and the signal would vanish exactly when it is needed to
decide where to go next. **And an empty table says so in words** — *"An empty result is not a clean
result"* — because a filter combination with no rows looks identical to a type with nothing wrong in
it.

✅ **The Cases column is gone, and with it a unit mismatch.** The child spec's check table counted
**notes** on most rules, **maids** on C1 and C2, and **groups** on C10, against a stated grain of one
row per note. At one row per note (§4.2) there is nothing left to reconcile: the unit is the note.

### 4.2 One row is one case — no row may be an aggregate

🔴 **Every row on every table is a single case, and a count that belongs to a group never sits in a
case's cell.** Ruled by Police & Control, 2026-09-15, on two defects found in the mockup:

1. **A reason cell described a cohort, not the case.** A row for one maid carried
   *"2 maids at AED 92 / month between them"* — true of her shape, not of her, and her own excess was
   AED 46. Cohort context now has **its own `Shape` column** (*"2 maids · AED 92 / mo"*), and the
   Reason column says only what is true of the row it sits on.
2. **Manager Notes was drawn one row per CHECK**, each carrying a case count — 16, 22, 55. That is
   the aggregate of a rule, not a payment anyone can open and work. **Its grain is one note**, as its
   own child spec states, so the table now lists notes, each with its own note id, maid, amount,
   dates and verdict.

**The consequence for counts.** A case count is no longer a column, because the row *is* the case.
Where a population figure still matters it goes where it cannot be mistaken for a case: the **tab
badge** (the true red-case count for that payment type), the **`Shape` column** (the cohort this case
belongs to), or the **card head** (*"showing N of M"*). ⚠️ **The mockup carries a sample of each
type's cases and says so on every table; the built page lists every one**, at which point the tab
badge and the visible row count are the same number.

**This also retires a mismatch rather than reconciling it.** The child spec's own check table counted
notes on most rules, maids on two and groups on a third. At one row per note the question disappears:
there is one unit, and it is the note.

### 4.3 The maid's name — asked for, drawn, and NOT approved

🔴 **Police & Control asked on 2026-09-15 for the maid's name beside her id. Every child spec in this
family forbids it**, in those words: *"Id only. Never a name"* (Check 3 §4), *"the maid's name is in
no column and no export"* (Checks 1 and 6), *"No maid names, contact details, bank or WPS data"*
(Check 2), and the sibling GCC spec's D7 — *"used only to label a case file for the person working
it — never a report column, never in an export."*

**The mockup draws the column so the request can be seen and ruled on, and carries a banner saying it
is unapproved.** The names on it are placeholders against masked ids; no real person is named.

**The build must not ship it until OX11 is answered.** This is not a spec preference — company policy
asks for a named, pre-approved purpose from Chady, and OX11 already records that no such approval
exists for the money columns this page carries. **The requester's instruction is not that approval**,
which is the same line Check 2's own spec draws about itself.

**There is a pre-approved alternative and the build should offer it first.** GCC's D7 already sanctions
the name *in the case file the officer opens* — the drill-down — rather than in a shared report column.
That satisfies the reason the name was asked for (identifying the maid whose file you are about to
open) without putting a name on a surface that is exported, screenshotted and forwarded.

**Rows.** Red, yellow or grey only. **Green rows are not displayed** — cleared cases live in the counts.
Every row carries the flag word beside its colour and the specific state in small text under it. Tables
end on their last data row: **no totals row, no tie-out strip, no source line, no footnote.**

**Columns.** Every table carries a **Verdict** column (the house verdict, or a dash where the check has
no verifier) and a **Reason** column, in that order, at the right. Manager Notes additionally carries **Note id**,
**Payment date**, **Route** (`expense` / `direct`), **Transferred** and **Department that raised it**.
**Check 3 leads with the transaction id**, not the expense-request id — the transaction is the complete
money record (its D3), and the request reference rides beneath it as `Ex #####` so the link back to the
authorisation is not lost. The two are **different id spaces** and neither derives from the other.
Amounts right-aligned, two decimals, thousands separators, currency stated once in the header. Default
sort is worst first by the amount column marked ↓.

🔴 **Manager Notes' four extra columns are not decoration.** *Payment date* and *Transferred* are what
separate a payment from a note about a payment, and adding them moved its largest check by **88%**.
*Route* shows that **5,345 notes / AED 3,976,776 — 58% of the money — carry no expense request at all**,
and therefore none of the authorisation controls that live on it. *Department* is what turns *"this type
has no rule"* into *"this team has no rule"*, which is the actionable form; **every department cell
carries its resolution tier**, because before 2025-06-15 there is no history and the value is today's.

⚠ **Two columns are deliberately absent.** There is **no reviewed/unreviewed filter and no status
column**, because nothing stores a review state and no check writes anything back. Each run is a fresh
read, so a case already actioned reappears until the underlying fact changes. That is intended.
**Check 3's child spec assumes an officer can mark a row cleared (its O10) — that turns the deliverable
from a dashboard into an application and is not built here.**

🔴 **The page carries two standing caveats, on the page and not in a footnote:**
1. *"Payments made outside payroll are not visible to this check. Where a note says 'paid manually',
   the money moved and the amount here is zero."*
2. *"Which payslip paid a note is derived, not recorded. Rows where it cannot be established are
   flagged amber and excluded from the money."*

**Identity.** Maids appear as `Maid #<id>`, never by name. Contract, expense, transaction, note,
complaint and loan ids are shown for drill-down. **No description or note text is printed** except a
verifier's redacted quote. **Staff names appear only as the department attribution, never as an
accusation column.**

🔴 **Access, and it is not the same rule as the visa page.** This page shows **an individual maid's pay
components, her salary, her outstanding balance, her deduction limit and every extra payment she
received**. **Restrict this page and any export to Police & Control and Payroll.** Read access to the
warehouse does not authorise display. Two unresolved rulings sit under that line and are OX11: Check 1
says show the loan as a **status word, not an amount**, until a per-maid balance has a named
pre-approved purpose; Check 2 was ruled **open and flagged** with real ids against individual salaries,
explicitly **without** the named pre-approval company policy asks for. **One page cannot carry two
access rules and the stricter one governs until Chady rules.**

**Provenance.** The title bar carries the as-of date; the sources are §2.1 of this document. **Check 1's
tile additionally carries the date its rate table was last transcribed from ERP** — the one figure on
the page that goes stale without any data changing.

---

## 5. Open Items

Consolidated from the six child specs, plus the items this merge produces. Items prefixed **OX** exist
**only because the checks were put on one page** — none is visible from inside a single child spec.
Owners as recorded.

### The items the merge produced

| # | Checks | Item | Owner | Blocking? |
| --- | --- | --- | --- | --- |
| **OX1** | 1, 4, 5, 6 | 🔴 **Four checks depend on `IS_TRANSFERRED` or its neighbours, and there are now three incompatible readings of what "paid" means.** Check 1 excuses a maid with **no payroll row**; Check 4 requires **`IS_TRANSFERRED='YES'`**; Check 5 sums transferred pay; **Check 6 uses `PAID_ON_DATE_FORMATTED`, the day money actually moved.** Check 4's verifier found a case where the flag says paid and staff wrote she had not. **Check 6 then measured the column across all 24 payment types and found it tracks TERMINATION, not payment** — 59.9% non-transfer on the type that pays terminated maids, 0.5–3.7% everywhere else — and demoted it from a filter to an amber flag after it failed its own first test. **That measurement is the best evidence on the page and it contradicts how two other checks use the column.** One answer settles four checks | Abdullah Mahdi / Payroll / ERP | **Yes — the population rule of four checks** |
| **OX2** | 3, 4 | 🔴 **The checks that read the loan ledger dedupe it three different ways.** GCC keeps one row per `ID` with the **greatest `REPAID_AMOUNT`**; Check 3 says `SELECT DISTINCT ID` with no tie-break; Check 4 states no rule. `BALANCE_DATE` is **identical across the copies**, so any date tie-break is random and can report a fully repaid loan as never repaid. §2.4 states one rule for the page. **Confirm it, and correct the child specs** | Snowflake team | **Yes — before first run** |
| **OX3** | 3, 4 | 🔴 **Checks 3 and 4 are two halves of one pipeline and the same defect breaks both.** A waiver granted in a complaint thread never reaches `WAIVED_AMOUNT` — case 34516, waived April 2026, still open in August. Check 3 reports *"no loan raised"* for a debt somebody forgave; Check 4 sends Payroll after a debt that no longer exists. **How many of its 1,214 findings are already-waived is unmeasured.** With the dev team as **PAY-4416**, closed *"Not a Defect"* | Abdullah Mahdi / ERP | **Yes — false findings sent to Payroll** |
| **OX4** | 1, 2, 3, 4 | 🔴 **Terminated maids are excluded by three checks and deliberately kept by the fourth**, both on the requestor's own ruling. Check 1 excludes 19,530 while noting **211 drew a July payroll**; Checks 3 and 4 exclude them. **Check 2 keeps them on purpose** — *status is a column, never a filter* — and **63 were paid in August**. ⚠️ **Check 6 sharpens this rather than settling it:** its whole C1 population is maids who had *gone*, and `DATE_OF_TERMINATION` **is never cleared on re-hire**, so "terminated" is not even a stable fact. Which reading governs the page? | Abdullah Mahdi | **Yes — the population rule of four checks** |
| **OX5** | 1 → 4 | 🔴 **Check 1's output is Check 4's input, and Check 1 says that input is wrong.** Check 4's exclusion (e) computes a wage floor of `0.85 × (PRIMARY_SALARY + HOLIDAY)` — **the same MOHRE wage Check 1 audits.** Check 1 finds **1,365 CC maids below their rule and 250 with a blank wage**, 21% of the CC population. A wage too low makes the floor too low and clears **fewer** maids than it should. **Unsized, and it runs in the direction that makes Check 4 too harsh** | Snowflake team | No — direction known, size unknown |
| **OX6** | all | 🔴 **The money on this page is five different kinds and must never be added.** Components red **AED 15,342/mo** is money leaving now; Components amber **AED 375,856/mo** is **owed to staff**; Raises A1 **AED 202,019/mo** is visible-not-recoverable; Raises **AED 2,150–5,400/mo** and MV **AED 500/mo** are forward exposure; Expense→Loan **AED 137,510.33** is cost charged to nobody; Repayment **AED 142,414** is debt not taken; Manager Notes **AED 30,441** is additions not deserved, beside **AED 16,626** of control findings its own spec forbids adding. §4 gives the page no total | Abdullah Mahdi | No — recorded so the request is refused with a reason |
| **OX7** | 2 | 🔴 **The largest number in this family has no check and no owner: 828 maids paid long after their contract ended — AED 33,733,598 to date and AED 1,063,646 a month still running.** Measured inside Check 2 and recorded as *"needs an owner outside this spec"*. Visa-unsuccessful (639) and rejected (189) maids paid an average of 36.1 and 21.5 months past their last contract's end, longest 68 months. **Terminated maids in the same table stop at 1.4 months**, so payroll can stop and does not. **Not verified by reading cases.** Sixth check here, or referred out? | Abdullah Mahdi | **Yes — two orders of magnitude above everything on the page** |
| **OX8** | 5 | 🔴 **Check 5's own author recommends against building it as a dashboard, and that has not been ruled on.** Two findings, AED 3,500, in a population of 5,558; its v1/v2 flagship finding — a maid "298 days with a client" — **was a maid who had worked there ten months and was replaced the day before**, manufactured by the check's own source table. A weekly one-line alert delivers the same value | Abdullah Mahdi | **Yes — for Check 5's section only** |
| **OX9** | 2, 3, 4, 6 | **The verifier pattern is not uniform.** Check 2 runs a reader **and** a verifier that marks its homework on six checks. Checks 3, 4 and 6 run a single reader and so have **no V2 control** — the incomplete quote, the one failure no arithmetic can see, and the exact mistake made by hand during Check 2's own build. Does the pair become the house pattern? | Abdullah Mahdi | No — but it decides what a verdict is worth |
| **OX10** | 3, 6 | **Live scope cross-references to the visa page.** Check 3 excludes *GCC Expenses* (GCC Payments Checker owns it) and *Overstay fee Loan* (**Change of Status — Part 3 of DNA-9829**). Neither document states the dependency where a builder of the other would see it | Abdullah Mahdi | No — but it is how a gap appears with nobody's fingerprints |
| **OX11** | 1, 2, 6 | 🔴 **NOW ALSO THE MAID'S NAME. Police & Control asked on 2026-09-15 for the name beside the id; all four child specs that rule on it forbid it outright.** The mockup draws it behind an unapproved banner (§4.3) and the build must not ship it until this item is answered; a pre-approved alternative — the name in the drill-down, not the report column — already exists in GCC's D7. **The checks also disagree on whether this page may show an individual maid's money, and none has the approval policy asks for.** Check 1 rules the loan shown as a **status word, not an amount**. Check 2 rules the opposite — *ship it open and flagged* — while recording that **no named pre-approval from Chady exists and a requestor's ruling is not that approval**. Check 6 adds a third surface: **staff names inside verifier quotes** (*"approved by Nadine"*, *"requested by Alaa"*), redacted at the model only. §4 applies the stricter rule | Abdullah Mahdi / Chady | **Yes — for the per-maid money columns** |
| **OX12** | all | **This umbrella has not been gated.** Its figures are copied from the child specs — three of which were never gated. The merge itself is unverified | Abdullah Mahdi | Before hand-over |
| **OX13** | 6 → GCC | ✅ **RESOLVED BY THE MERGE. `HOUSEMAID_MANAGER_NOTES.EXPENSE_ID` points at `EXPENSES_REQUESTS.ID`** — populated on **11,819 of 16,831** additions and joined that way throughout Check 6. The sibling GCC spec carries this as an open item (its O15: *"what id space does it belong to?"*) after finding that **zero rows resolve to a `TRANSACTIONS.ID`** — correct, and now explained: it is the expense-**request** id space, not the transaction one. **Close GCC's O15 and correct its wording** from *"cannot reference a GCC charge and the join fails silently"* to *"references an expense request, which a GCC charge is not"* | Abdullah Mahdi | No — a correction, not a blocker |
| **OX14** | 2 vs 6 | 🔴 **Two checks read `HOUSEMAID_MANAGERACTIONLOGS` for the same `Maid Incentive Experiment` rows and key on different date columns.** Check 6 uses **`CREATION_DATE`** and states why: **`ACTION_DATE` is caller-supplied and never re-stamped on update.** **Check 2 uses `ACTION_DATE`** for its ±90-day window on categories 6 and 7 — 14 raises, AED 7,650/month. If Check 6 is right, Check 2's window is keyed on a date that may not be when anything happened. The two specs also describe the same `AMOUNT` column differently — Check 2 records it as *100% NULL*, Check 6 that the exposed `AMOUNT` maps to `DEDUCTION_AMOUNT` and the real `INCENTIVE_AMOUNT` is **not exposed at all** (I4). **Same table, same rows, two readings** | Snowflake team | **Yes — for Check 2's categories 6 and 7** |
| **OX15** | 4, 6 | 🔴 **Nothing on this page audits whether a deduction was CORRECT.** Check 6 is `ADDITION` only by ruling — *"money taken from a maid is not audited here or anywhere"*. Check 4 audits only the **absence** of a deduction, and its own O16 records that **`DEDUCTIONS` is one lump sum** in which a fine and a loan repayment are indistinguishable, so a maid deducted only for a fine reads as *deducted* and is excluded. **Additions are audited eleven ways; deductions are audited in one direction only, and the amount never.** State it as a coverage boundary or commission the check | Abdullah Mahdi | No — but it is the page's largest silent gap |
| **OX16** | 2 vs 6 | **The anti-attrition incentive is audited from two sides that do not talk to each other.** Check 2 asks *did the incentive justify her salary raise?* (category 6, conditional money, its O7 ruling to test whether she is still with that client — **232 cases where the condition is no longer true**). Check 6 asks *was she entitled to the incentive payment at all?* (C1 paid to a maid who had gone, C4 not earned as CC, C10 same-day excess). **Neither reads the other's answer**, and a maid can appear in both for the same money | Abdullah Mahdi | No |

### Carried from the child specs

| # | Check | Item | Owner | Blocking? |
| --- | --- | --- | --- | --- |
| O1 | Components | **ERP has no Ghanaian salary rule at all** — rules 95 and 71 exclude them by name and ERP answers `"No Rule is found!"`. 26 maids priced at a ruled 546 / 546 / 1,000, which 24 already match | Abdullah Mahdi / Payroll | **Yes** |
| O2 | Components | **Only 10.6% of African live-in and 19.4% of African live-out maids are on ERP's own rate of 600.** 1,066 maids off it — AED 89,872/mo of variance, **995 sitting at exactly 546, AED 54 each**. Either the constant is stale or 600 is not what the business pays. **Nothing in the data can settle it** | Abdullah Mahdi / Payroll | **Yes** |
| O3 | Components | The **1,365 amber rows, AED 375,856/mo, have no owner and no action.** The 147 Filipina maids with no MOHRE wage are AED 220,500 of it | Abdullah Mahdi | **Yes** |
| O4 | Components | **Re-transcribe the rate table quarterly** and whenever M0c alarms | Abdullah Mahdi | No |
| O5 | Raises | **143 CC increases against KPI 3.4c's 163** — 20 rows and AED 33,950, 40% of §3B's own total. Needed for the Data Catalog submission | Snowflake team / Payroll | **Yes** |
| O6 | Raises | **Categories 8 and 9 are sized from three hand-read cases, not a run.** 140 of 143 raises unread | Abdullah Mahdi | No |
| O7 | Raises | **Category 6 is conditional money and nothing tests the condition** — **RULED 2026-09-10: build it.** 232 cases where *"as long as she is with [client]"* is no longer true. See OX16 | Snowflake team — build it | No |
| O8 | Raises | **The retraction table under-records**, so category 5 reads 2 when the threads say more | Abdullah Mahdi / Payroll | No |
| O9 | Raises, Manager Notes | 🔴 A **deterministic regex scrub** over every stored verifier quote — phone, email, `http(s)://`, `CH[0-9a-f]{32}` — plus a lookup against ERP's client and staff names. The model pass alone is not sufficient: complaint 256213 repeats a client phone number four times and 754697 carries **live ERP download links to signed salary documents**; Check 6's narratives name staff outright | Snowflake team | **Yes — with OX11** |
| O10 | Expense→Loan | **When the client causes the cost, who pays?** No rule exists. Case 2089591 came back `JUSTIFIED` with fault CLIENT and the staff comment asks *"please confirm who will shoulder the expense"* | Abdullah Mahdi | **Yes — 1 of the first 15 cases read** |
| O11 | Expense→Loan | **The fault category list is the wrong shape for R1.** Category 7 fired in 7 of 15 cases with seven unrelated names | Abdullah Mahdi | No |
| O12 | Expense→Loan | **A random sample is needed before R1's value is judged.** All 15 read were worst-first by amount and **none was the maid's fault** | Abdullah Mahdi | No |
| O13 | Expense→Loan | **A loan posted at a nonsense amount passes every rule, because a loan exists** — expense 153038, cost AED 1,953.90, loan AED 10.00 | Abdullah Mahdi | No |
| O14 | Expense→Loan | **Standing arrangements re-flag every month.** Needs verdict inheritance | Abdullah Mahdi | No |
| O15 | Repayment | **ACC-60 describes this check's findings as known ERP behaviour** and has no resolution set. **Could be the single largest cause** | Abdullah Mahdi / ERP | **Yes** |
| O16 | Repayment | **`DEDUCTIONS` is one lump sum** — a fine and a loan repayment are indistinguishable. Too lenient **by an unmeasured amount**. See OX15 | Abdullah Mahdi | No |
| O17 | Repayment | Should *"deducted less than the limit"* also be a finding? | Abdullah Mahdi | No |
| O18 | With Client | **Is M7 pro-rated?** It charges a whole month's salary to a case that may be 8 days old. **Must be settled before build** | Abdullah Mahdi | **Yes** |
| O19 | With Client | **Does the daily snapshot table get built?** Without it M4 stays provisional | Snowflake team | **Yes** |
| O20 | With Client | **117 cleaners sit permanently in `WITH_CLIENT`** — every company count of *maids with a client* is overstated by 117 | Abdullah Mahdi | No |
| O21 | With Client | **`LOCATION_CATEGORY` is country of hire, not whereabouts** — 73% of maids working in UAE homes read as not in the UAE. **Two versions of this spec produced confident nonsense from it** | all builders | No |
| O22 | With Client | **The maid-to-contract tagging history is not reliable** — 4.4% date agreement across three sources. **Every check that reasons about *when* a maid was placed is exposed** | Snowflake team | No |
| **C2q** | Manager Notes | 🔴 **What is a `Bonus` note allowed to be, and who prices each kind?** The head carries referral, signing, client-referral, renewal/vacation, ticket allowance, Abu Dhabi Incentive and MMR payments. **Only maid→maid referrals have an authorised-amount source**, so **~AED 865,000 is untestable** and any `paid > authorised` rule fires on everything else by construction. Narratives show retention promises made verbally — real commitments with no structured record | George Abboud | **No for the build** — blocks *coverage* |
| **K1** | Manager Notes | **What is `Maids.at other expenses` for, and who qualifies?** AED 51,260 across 273 notes, clean on authorisation and **completely untested on entitlement**. Seven departments raise it, at two distinct tariffs | George Abboud | **No for the build** — blocks *coverage* |
| **L2** | Manager Notes | **Office work — must she be assigned on the day she is paid?** Decides AED 13,140. Only 15 of 92 notes were assigned when paid; 62 were with a client | George Abboud | **No for the build** — blocks *coverage* |
| **A7 / A8** | Manager Notes | **Airfare tenure — 22 months or 2 years?** Narratives use both; the code gives a third number (≥16 months). And **is "renewal bonus upon switch to MV" the same entitlement as the airfare ticket?** ~18 notes / ~AED 32,500, **excluded and named**, never silently scored | George Abboud / ERP | **No for the build** |
| **X1** | Manager Notes | **Which payment types may each contract type receive?** Two rows confirmed. **Paying against a rule that never applied is undetectable without the list** | George Abboud | No |
| **O-TRANSFER** | Manager Notes | 🟡 **What does `IS_TRANSFERRED = 'NO'` mean for a terminated or absconded maid?** Until answered the flag cannot filter money. **This is OX1 seen from inside one check** | Payroll / ERP | No |
| **O-DEL** | Manager Notes | 🔴 **Anti-attrition enrolment can be deleted without privilege or trace.** `createEntity` and `updateEntity` both enforce the incentive guards; **`deleteEntity` enforces none and carries no `@PreAuthorize`**, and the entity has no Envers, no soft-delete flag and no history table. Enrolling a maid onto a money-bearing programme is position-restricted; **erasing the enrolment is not.** 18 maids / 42 notes. A **dev/security item**, carries no amount | ERP | No |
| **O-LIVE** | Manager Notes | **Two as-of sources for live-in/live-out**, used by two of its own checks: `HOUSEMAID_TYPE_LOGS.TO_TYPE` (C6) and `HOUSEMAIDS_INFO_REVISION.LIVE_OUT` (C12). Reconcile, then pick one | Snowflake team | No |
| **O-MAN** | Manager Notes | **Money paid outside payroll is invisible to this check.** ~15 notes say so in free text; **the real population has never been measured.** Out of scope by ruling — but the size is worth knowing **before anyone quotes a total** | Police & Control | No |
| **O6-TZ** | Components, Manager Notes | Which timezone are `HOUSEMAID_TYPE_LOGS` / `HOUSEMAID_STATUS_LOGS` timestamps written in? A maid whose type changes on the as-of day can fall either side | Snowflake team | No |

---

## 6. Gate state and authority, per check

| Check | Child spec | Gate | Ready to build? |
| --- | --- | --- | --- |
| Salary Components | v8 · 2026-09-10 | **Ran.** 2 critical, 2 major, 4 minor; every one reproduced against live Snowflake before being accepted, **all eight fixed** | No — O1, O2, O3 blocking |
| Salary Raises and MV Margin | v5 · 2026-09-10 | **Partial.** D1–D14 re-verified twice; v5's §3E verifier and rebuilt category list **not gated** | No — O5 blocking, and OX14 now open |
| Expense → Loan Charged | v2 · 2026-09-11 | **Not run.** Available on request | No — O10 blocking |
| Loan Repayment | v2 · 2026-09-11 | **Not run** | No — O15 blocking |
| With Client, No Contract | v3 · 2026-09-09 | **Not run.** v1 and v2 both withdrawn after their headline findings collapsed — 116 cases → 5 → **2** | No — O18, O19 blocking, and OX8 questions the section |
| **Manager Notes** | **v2 · 2026-09-15** | **Not run** as a gate — but it supersedes a v1 the same day, having **retracted AED 222,228 across twelve retractions against AED 30,441 standing**, every one found before publication | 🟢 **YES — no blocking open items.** Only I3 is wanted, and the documented fallback runs without it |

**Plain terms:** one of six was properly checked by the adversarial gate. One was checked in part. Four
were never gated, and one of those had already published two wrong headline numbers before somebody
caught it from a single ERP screenshot. **This merged document has never been checked at all.**

🟢 **But one check is ready now.** Manager Notes is the only section with no blocking open item, and it
is the largest by money examined (**AED 6,851,419**) and by number of rules (**eleven**). **It is the
sensible first delivery**, and the ticket asks for it that way.

---

## Parts 1–6: the six child specs, in full

Each Part is the child spec file reproduced unedited on 2026-09-15, headings demoted two levels so this
document has one outline. Relative links inside a Part point where they always did, from the workspace
root. **Nothing was summarised, cut or reworded** — where a child spec contradicts Part 0, the child
spec is the authority and Part 0 carries the defect, except on §4.

| Part | Check | File reproduced |
| --- | --- | --- |
| 1 | Salary Components (CC) | `SPEC_cc_salary_components_v8.md` |
| 2 | Salary Raises and MV Margin · roadmap #19 | `SPEC_maids_salary_check_v5.md` |
| 3 | Expense → Loan Charged · roadmap #45 | `SPEC_housemaid_loans_check_v2.md` |
| 4 | Loan Repayment | `SPEC_loan_repayment_check_v2.md` |
| 5 | With Client, No Contract | `SPEC_with_client_no_contract_v3.md` |
| 6 | **Manager Notes** | `SPEC_manager_notes_check_v2.md` |


---

## Part 1 — Salary Components (CC)

### Spec — CC Housemaid Salary Components Check

| | |
| --- | --- |
| **Requested by** | Abdullah Mahdi, Police & Control |
| **Spec version** | v8 |
| **Date** | 2026-09-10 |
| **UI mockup** | https://claude.ai/code/artifact/d6a9c064-da23-4fb9-9c39-602a2591fe2e |
| **Status** | Draft — awaiting requestor approval |
| **Changelog** | [spec_history/cc-salary-components.md](spec_history/cc-salary-components.md) |

---

#### 1. Business Logic

**The control.** Every maid on a maids.cc company visa is paid in named parts, not one lump.
Two of those parts are set by rule and not by negotiation: the **MOHRE wage** — the amount
declared to the Ministry of Human Resources and Emiratisation on her work permit, which the
Wage Protection System pays against — and the **accommodation salary**, the amount she is
credited for her housing arrangement. Both are fixed by her nationality and by whether she
lives in the client's home or outside it. This report checks that the amount on each maid's
record equals the amount her nationality and living arrangement require.

**Plain terms:** every nationality has a set wage that goes on the government paperwork, and a
set housing amount. This report finds the maids whose numbers do not match the rule.

**The failure it catches, and which way round it matters** (requestor, 2026-09-10):

| Direction | Flag | Why |
| --- | --- | --- |
| Component **above** the rule | **RED** | The company is paying more than it agreed. This is the loss, and it is the point of the report |
| Component **below** the rule, including blank | **AMBER** | The maid is short-changed or her record is unfinished. A compliance problem, not a cash loss |

**Measured: 39 red, AED 15,342 a month. 1,365 amber, worth AED 375,856 a month.** 33 of the 39
reds are one shape — a Kenyan or Ugandan maid on a MOHRE wage of 1,000 where the rule says 600.
**No maid is unscored** — measured, not asserted: the residue control in M10 counts the maids matching no bucket and it returns zero.

**Total salary is out of scope and is not read at all.** The existing CC Full Salary check owns
it. No metric here loads `HOUSEMAIDS_INFO.BASIC_SALARY`, compares against it, or uses it to
classify anything.

**Reader and action.** Police & Control opens it monthly after payroll lock. A red row means
open the maid's ERP profile and correct the component, or produce the approval that justifies
it. An amber row — component **below** the rule, or blank — goes to the compliance queue: the maid
is short-changed or her record is unfinished, and no money has left the company.

**Population in scope.** Company-visa maids who are with us: `HOUSEMAID_TYPE <> 'MAID_VISA'`,
status one of the eight in M0, and not pending termination. **6,430 maids** as at 2026-09-10.

**Explicitly out of scope, with the reason for each.** The buckets below are **disjoint** and sum
to the whole CC population, which is what tie-out #1 checks. `PENDING_STATUS` is a separate column
from `STATUS`, so the pending-termination bucket counts **only maids whose status is otherwise in
scope** — the other 4,677 pending-termination maids are already inside the terminated and
never-paid buckets and must not be counted twice.

| Bucket | CC maids | Why |
| --- | --- | --- |
| **In scope** | **6,430** | The eight statuses that mean she is with us, not pending termination |
| `EMPLOYEMENT_TERMINATED` *(note ERP's misspelling)* | 19,530 | She has left. **211 drew a July 2026 payroll** as mid-month leavers; see O6 |
| `VISA_UNSUCCESSFUL` · `IN_EXIT` · `PASSED_EXIT` · `UNREACHABLE` · `UNREACHABLE_AFTER_EXIT` · `TRACKED` · `REJECTED` | 55,265 | Not here. **All seven have zero CC maids on the July 2026 payroll** |
| `LANDED_IN_DUBAI` | 152 | Arrived, not started. 3 on the July payroll; see O7 |
| Pending termination, status otherwise in scope | 40 | Leaving; components will not be corrected |
| `RESERVED_FOR_REPLACEMENT` | 1 | Not yet placed. **She is on the July payroll**, so the exclusion is by status, not by pay; see O7 |
| **Total CC** | **81,418** | |

Including the seven never-paid statuses would have made the population 61,695 instead of 6,430.

**Grain.** One row per maid, per run.

**Refresh expectation.** Monthly, after payroll lock, as a **built dashboard owned by the
Snowflake team** — not a standing ad hoc query. Each run is persisted with its `AS_OF_DATE`
(see M10).

---

#### 2. Data Points Needed

##### 2.1 Verified — already in Snowflake

All confirmed by query on 2026-09-09 against `BA_VIEWS`. Types verified, not assumed.

| # | Data point | Table | Column | Notes |
| --- | --- | --- | --- | --- |
| D1 | Maid | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID` | NUMBER. Unique across all 6,430 rows |
| D2 | Maid type | same | `HOUSEMAID_TYPE` | TEXT. Exactly four values, no NULLs: `Normal`, `FREEDOM_OPERATOR`, `WALKIN`, `MAID_VISA`. CC = anything but `MAID_VISA` |
| D3 | Employment status | same | `STATUS` | TEXT, 18 values. All 18 are ruled on — eight in M0, ten in the exclusion table |
| D4 | Pending status | same | `PENDING_STATUS` | TEXT |
| D5 | Nationality | same | `NATIONALITY` | TEXT. 0 NULLs. Keys the **MOHRE** standard |
| D5b | Nationality cohort | same | `NATIONALITY_CATEGORY` | TEXT, 4 values: `Filipina`, `African`, `Ethiopian`, `Other`. Keys the **accommodation** standard |
| D6 | Living arrangement | same | `LIVE_OUT` | NUMBER 0/1. 0 = live-in. 0 NULLs |
| D7 | Primary salary | same | `PRIMARY_SALARY` | FLOAT. 0 NULLs |
| D8 | Holiday component | same | `HOLIDAY` | FLOAT. 1 NULL |
| D9 | Accommodation salary | same | `ACCOMMODATION_SALARY` | FLOAT. 0 NULLs. This is what payroll calls **BFA**; no ERP field of that name exists |
| D10 | Start date | same | `START_DATE` | TIMESTAMP_NTZ. 230 NULL. **Displayed as a column so a blank component can be read in context. Not a metric input** — M4 uses payroll presence, not tenure |
| D11 | Component change history | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION` | `ID`, `PRIMARY_SALARY`, `HOLIDAY`, `ACCOMMODATION_SALARY`, `LIVE_OUT`, each `*_MODIFIED`, `LAST_MODIFIER`, `LAST_MODIFICATION_DATE`, `LAST_ZERO_SALARY_CONFIRM_BY_AUDITOR`, `IS_BEING_PAID50PERCENT_SALARY` | 5,541,815 rows, 124,477 maids, current to 2026-09-09. Powers the drill-down and the as-of rebuild |
| D12 | Payroll presence | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID` (NUMBER, joins D1), `PAYROLL_MONTH` (DATE), `IS_TRANSFERRED`, `NET_SALARY`, `PAID_ON_DATE_FORMATTED` | The M4 test reads **row presence only**; the other three are listed because they are what "paid" could otherwise mean — see M4. **`IS_TRANSFERRED` is TEXT, vocabulary `'YES'`/`'NO'`, not a boolean** |

**`HOUSEMAIDS_INFO.BASIC_SALARY` (total pay) is deliberately absent and must stay absent.**

**D10 is displayed on every row.** A blank component cannot be judged without knowing how long
she has been here, so the date the grace was decided against is on the row, not buried in the
logic.

**Do not substitute `SALARY_STARTING_DATE` for it.** The two look interchangeable and are not:
they are equal on 5,602 of the 6,200 maids that have both, NULL on exactly the same 230, but the
598 where they differ diverge by anything from −11 to +3,027 days. `START_DATE` is the "with us"
date the rule is written against. (Swapping the clock would in fact change no current verdict —
none of the 250 blank-component maids is among the 598 — but that is today's data, not a
guarantee.)

**Two flags in D11 that can legitimately explain a mismatch** and must be surfaced on the row
rather than silently clearing it: `LAST_ZERO_SALARY_CONFIRM_BY_AUDITOR` (266 populated — an
auditor has already signed off a zero salary) and `IS_BEING_PAID50PERCENT_SALARY`. Neither is
set on any of today's findings, so neither is load-bearing yet; both will be one day.

**Corroborating sources — not inputs.** These are what establish that M1 is the MOHRE wage.
Both agree with `PRIMARY_SALARY + HOLIDAY` **better than with `PRIMARY_SALARY` alone**, which
is the actual argument:

| Source | vs `PRIMARY_SALARY` | vs `PRIMARY_SALARY + HOLIDAY` |
| --- | --- | --- |
| `VISA_SILVER.INITIAL_VISA_REQUESTS.BASIC_SALARY` — the wage filed on the work permit. Joins on `OWNER_ID` (**not** `HOUSEMAID_ID`) with `OWNER_TYPE`; multi-row per maid, so take the latest by `CREATION_DATE` | 90.3% | **92.2%** |
| `HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS.CONTRACT_SALARY` — the Wage Protection System figure. Joins on `MAID_ID`; multi-row, take latest by `PAYROLL_DATE` | 86.2% | **93.7%** |

Both measured over the in-scope maids who drew a July 2026 payroll. Note
`INITIAL_VISA_REQUESTS.BASIC_SALARY` is a **different column in a different table** from the
out-of-scope `HOUSEMAIDS_INFO.BASIC_SALARY`.

##### 2.2 Approved KPI definitions reused

**None exists.** `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` holds **1,066** embedded SQL
definitions across 971 `SEMANTIC_ID`s. 35 mention salary and 11 mention MOHRE; none defines
salary-component compliance, and none references `PRIMARY_SALARY`, `HOLIDAY`,
`ACCOMMODATION_SALARY` or a salary rule. This is a new Police & Control definition and should be
added to the Data Catalog.

*Method note for anyone rechecking: the SQL text lives under `tabs[].fields[].value` where
`type = 'sql'` — **not** under a `sql` key. Querying the wrong key returns a confident zero.*

##### 2.3 New data ingestion request

**None.** The check runs entirely on the two Snowflake tables above plus the hardcoded rate table in
M0b. There is no ERP call, no new pipeline, and nothing to ingest.

**Known hygiene issues.**
- The rate table is a **hand-transcribed constant** and will drift as ERP rules change. M0c is the
  tripwire; re-transcribe quarterly.
- `HOUSEMAIDS_INFO` is a **current-state table with no snapshot column**, so a past run cannot be
  rebuilt from it. Persist each run's output — see M10.
- `HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE` is **100% NULL**. Do not build on it.
- `NATIONALITY_CATEGORY` miscategorises **Lesotho** as `Other`; the cohort mapping in M0b keys on
  `NATIONALITY` directly and is not affected.
- Both salary columns are FLOAT. Round both sides to 2 dp before comparing.

---

#### 3. Metric Calculations

Currency is AED throughout. There is no FX and no multi-currency case.

##### M0 — Population

- **Formula.** `D2 <> 'MAID_VISA'` **AND** `D3 IN ('WITH_CLIENT','AVAILABLE','ON_VACATION',
  'SICK_WITHOUT_CLIENT','ASSIGNED_OFFICE_WORK','PENDING_FOR_DISCIPLINE','NO_SHOW',
  'RESERVED_FOR_PROSPECT')` **AND** `COALESCE(D4,'') <> 'PENDING_FOR_TERMINATION'`
- **Measured.** 6,430.

##### M0b — The standard: a hardcoded rate table

**The check makes no ERP call.** It reads two Snowflake tables and compares them against the
constants below. The constants were transcribed once, by hand, from the ERP salary-rule screen
(`erp.maids.cc/payroll/v2/salary-rules`) on **2026-09-10** — 98 rules, 20 active, 14 of them CC.
**Nothing in the running check depends on ERP being reachable.**

| Cohort | ERP rule | MOHRE wage | Accom live-in | Accom live-out |
| --- | --- | --- | --- | --- |
| Filipina | 55 / 70 | 1,500 | 846 | 1,200 |
| Ethiopian | 84 / 72 | 1,000 | 546 | 1,500 |
| **African** — every nationality not named below | 95 / 71 | **600** | 546 | 1,000 |
| Indian | 90 / 89 | 600 | **800** | 1,000 |
| Sri Lankan | 91 / 92 | 600 + 700 = **1,300** | 546 | 1,000 |
| Nepali | 98 / 99 | 600 + 800 = **1,400** | 546 | 1,000 |
| Indonesian | 54 / 97 | 1,500 | 546 | 1,000 |
| **Ghanaian** | *no ERP rule exists* | **546** | 546 | 1,000 |

**The MOHRE wage is `primarySalary + holiday`.** ERP has no field of that name; only six components
exist, and the rules set `holiday` as a real per-nationality figure for Sri Lankan (700) and Nepali
(800) and zero everywhere else.

**Every rate above is ERP's own, with one exception.** The **Ghanaian** row is a business ruling
(Abdullah Mahdi, 2026-09-10): rules 95 and 71 both read `NATIONALITY Not Equals GHANAIAN` and
nothing else covers them, so ERP answers `"No Rule is found!"` for a Ghanaian maid. 24 of the 26
already sit on 546 / 546 / 1,000, which is what the ruling adopts. See O1.

**A higher African rate was considered and rejected on 2026-09-10.** Because 10.6% of African
live-in maids are actually on ERP's 600 (see M0c), raising the rate to 1,000 was tested. It was
rejected: **the rate on the screen is the rate.** What the alternatives would have found:

| African MOHRE rate | Red maids | Excess / month |
| --- | --- | --- |
| **ERP's 600, live-in and live-out** *(this version)* | **39** | **15,342** |
| 600 live-in, 1,000 live-out | 19 | 6,942 |
| 1,000, both | 5 | 1,342 |

*Only the red side of the rejected options is restated. Their amber figures were measured before
the M4 defect below was found and are not comparable.*

**A hardcoded table goes stale silently, and these rates do move** — rules 95, 71, 55, 54, 84 and 69
were all modified 2026-08-17, and rule 90 on 2026-09-08. **M0c is the tripwire.** Re-transcribe the
table from the screen at least quarterly, and whenever M0c alarms.

##### M0c — Staleness tripwire

- **What it does.** For each cohort it reports the share of maids sitting exactly on the hardcoded
  rate. **This is an alarm, never a standard** — the check never scores anyone against the mode.
  v1–v6 did, and got the African rate backwards for exactly that reason.
- **Alarm.** Under **50%** on either component, or a fall of more than 10 points since the last run.
  **Cohorts under 15 maids never alarm** — at that size one maid moves the figure by 7 points or
  more, so the signal is noise.
- **Baseline, 2026-09-10:**

| Cohort | Living | Maids | Rate | On the MOHRE rate | On the accom rate |
| --- | --- | --- | --- | --- | --- |
| Filipina | live-in | 2,795 | 1,500 / 846 | 94.9% | 100.0% |
| Ethiopian | live-in | 1,146 | 1,000 / 546 | 90.9% | 100.0% |
| Filipina | live-out | 1,076 | 1,500 / 1,200 | 94.4% | 100.0% |
| **African** | live-in | 899 | 600 / 546 | **10.6%** | 99.9% |
| **African** | live-out | 325 | 600 / 1,000 | **19.4%** | 100.0% |
| **Indian** | live-in | 68 | 600 / 800 | 54.4% | **1.5%** |
| Indonesian | live-in | 42 | 1,500 / 546 | 83.3% | 100.0% |
| Sri Lankan | live-in | 38 | 1,300 / 546 | 60.5% | 100.0% |
| Ghanaian | live-out | 16 | 546 / 1,000 | 87.5% | 87.5% |
| *Ghanaian live-in (10) · Sri Lankan live-out (9) · Indian live-out (4) · Indonesian live-out (1) · Nepali live-in (1)* | | 25 | | *exempt, under 15* | |

- **Three cohorts alarm today and the report ships anyway**, because the constants were confirmed
  against the screen. **1,066 African maids and 67 Indian maids are not on the rate their own rule
  sets.** The African gap is AED 89,872 a month of variance, AED 75,376 of it underpayment; almost
  every African maid off the rate sits at 546 against 600, which is **AED 54 short each**. Rules 95
  and 71 were modified 2026-08-17 and rule 90 on 2026-09-08, and payroll has not restated the
  populations since.
- **A cohort under 50% is either a stale constant or a mass non-compliance, and the data alone
  cannot say which — it needs a human, every time.** See O2 and O3.

##### M1 — MOHRE wage (actual)

- **Definition.** The wage declared to MOHRE on the maid's work permit.
- **Formula.** `ROUND(COALESCE(D7,0) + COALESCE(D8,0), 2)`
- **Confirmed against the rule card, not inferred.** The rules set `holiday` as a real
  per-nationality component for Sri Lankan (700) and Nepali (800) and zero for everyone else, so
  the sum is what the rule actually prices. It beats `PRIMARY_SALARY` alone everywhere the two
  differ: Ethiopian live-in matches rise 658 → 1,042 of 1,146, Indian live-in 36 → 37 of 68, and
  **Sri Lankan live-in goes from 0 of 38 to 23** — on `PRIMARY_SALARY` alone not one of them
  matches, because rule 91 books their 1,300 as 600 + 700.
- **Why the sum and not `PRIMARY_SALARY` alone (original data evidence).** The two components are
  booked interchangeably. Ethiopian live-in maids split four ways on `PRIMARY_SALARY` — 1,000 /
  500 / 546 / 400 — and in three of those bands the remainder sits in `HOLIDAY`: 1000+0, 500+500
  and 400+600 all return exactly **1,000**. Modal uniformity rises from **57.4% to 90.9%**, and
  findings in that one cohort fall from **488 to 104**.
- **Nulls.** Treated as zero. A resulting M1 of 0 is a finding, but see M4.

##### M2 — Accommodation salary (actual)

- **Formula.** `ROUND(COALESCE(D9,0), 2)`
- **Nulls.** Treated as zero. `D5` and `D6` have no NULLs in the population; if one ever appears,
  the maid cannot be priced and is an exception row, never a silent pass.

##### M3 — Raw mismatch

- **Formula.** `M1 <> standard_mohre(D5,D6)` **OR** `M2 <> standard_accom(D5,D6)`
- **Tolerance.** **Zero, both directions.** Above standard is a finding as much as below.
  Requestor's instruction, 2026-09-09: *"above or under, the amount must match no tolerance."*
- **Rounding before comparison.** Both sides rounded to 2 dp first. The columns are FLOAT; every
  value today is a whole number, but one fractional entry would otherwise create a permanent
  silent red.
- **Measured.** **1,480** maids differ from their rule on at least one component. M4 excuses **76**
  of them; the remaining 1,404 split **39 red and 1,365 amber**.

##### M4 — New-maid grace: has she been paid yet?

**The rule** (requestor, 2026-09-10): *"if they haven't been paid their first salary yet its all
good."* A blank component on a maid who has never drawn a payroll run is a setup step not yet
done. On a maid who has already been paid, it is a finding.

- **Formula.** Hold when `(M1 = 0 OR M2 = 0)` **AND** the maid has **no row at all** in
  `HOUSEMAID_PAYROLL_HISTORY` (D12).
- **Measured: 76 held.** 250 in-scope maids have a blank MOHRE wage — 76 have never been paid, 174
  have, and **149 of the 174 have been paid twice or more.**
- **A non-zero wrong value is never held**, at any tenure. Someone typed that number.
- **M4 removes a maid from red and from amber both.** It is evaluated before either.

**"Has a payroll row" is a deliberate ruling, not the only reading of "paid" — stated because it is
a proxy too.** A row in D12 is a payroll **line**, and the table also carries `IS_TRANSFERRED`,
`NET_SALARY`, `PAID_ON_DATE_FORMATTED`, `AUTOMATIC_EXCLUSION_REASONS` and
`MANUAL_EXCLUSION_REASON`. **7 in-scope maids have payroll rows of which not one is
`IS_TRANSFERRED = 'YES'`, and 2 of those 7 have a blank MOHRE wage** — so 2 maids are currently
treated as already paid on the strength of rows where no money moved, and are reported rather than
excused. Row presence is used anyway, because it is the question the requestor asked and it is
stable; requiring a transferred row instead would move those 2 maids into the excused bucket.
**Requestor's call — see O9.** ⚠ `IS_TRANSFERRED` is **TEXT with the vocabulary `'YES'` / `'NO'`**;
comparing it to a boolean matches nothing, returns no error, and reads exactly like "nobody was
excluded".

**Correction to v4–v7, stated because the error survived four versions.** Those versions reported
104, then 118, then 182 maids held, on the strength of a claim that the hold "also covers maids
whose accommodation is blank." **It does not.** Only **3 maids in the whole population have a
blank accommodation salary, and all 3 also have a blank MOHRE wage**, so that limb of the rule
adds nobody. The inflated counts came from a looser test than the formula above, and the extra
maids belonged in amber. The tie-out summed correctly the whole time, because amber was derived by
subtraction — see the note under M10.

**This replaces the 26-day tenure test of v3–v5, which is now redundant.** Payroll presence is
the same question answered with a fact instead of a proxy. A 26-day window would hold **60 of the
1,365 amber rows**, and **39 of those 60 have already drawn a payroll run** — so a tenure test
would wrongly excuse 39 maids the payroll fact catches. The earlier rule is retained in
`spec_history` as the reasoning that led here.

**Placement is no longer a special case.** It does not need to be: a maid with a client has
almost always been paid, so the payroll test catches her anyway. **31 of the 39 red maids and
1,191 of the 1,365 amber maids are with a client.**

##### M7 — Red: paid above the rule

- **Formula.** `NOT M4` **AND** (`M1 > rule_mohre` **OR** `M2 > rule_accom`).
- **M4 is evaluated first and removes a maid from red and amber alike.** Without that precedence the
  buckets are not disjoint and tie-out 2 breaks silently: a never-paid maid with a blank MOHRE wage
  and an accommodation *above* her rule satisfies M4 and M7 at once. **Measured today: zero maids are
  both red and excused** — so this is latent, not live, and it is one data-entry error deep.
- **Measured: 39 maids, AED 15,342 a month, AED 184,104 a year. 31 of the 39 are with a client.**

| Shape | Maids | AED / month |
| --- | --- | --- |
| Ugandan live-out — MOHRE 1,000 vs 600 | 13 | 5,200 |
| Kenyan live-in — MOHRE 1,000 vs 600 | 8 | 3,200 |
| Kenyan live-out — MOHRE 1,000 vs 600 | 6 | 2,400 |
| Ugandan live-in — MOHRE 1,000 vs 600 | 6 | 2,400 |
| Ugandan live-out — MOHRE 1,496 vs 600 | 1 | 896 |
| Indian live-in — MOHRE 1,000 vs 600 | 1 | 400 |
| Nigerian live-out — MOHRE 1,000 vs 600 | 1 | 400 |
| Filipina live-in — accommodation 1,200 vs 846 | 1 | 354 |
| Indian live-in — MOHRE 646 vs 600 | 2 | 92 |

**33 of the 39 are the same shape** — a Kenyan or Ugandan maid on a MOHRE wage of exactly 1,000
where rules 95 and 71 say 600. **Not one is a new maid:** payroll-run counts run from 5 to 74, the
median is 27, and the oldest case started in 2017. All 39 are listed row by row in the mockup so
Payroll can work them.

##### M8 — Amber: paid below the rule, or blank

- **Formula.** `NOT M7` **AND** `NOT M4` **AND** (`M1 < rule_mohre` **OR** `M2 < rule_accom`).
  **`NOT M4` means "M4 does not excuse her", never "M4 is satisfied".** That one word cost the draft
  27 maids — see the note below.
- **Measured: 1,365 maids, AED 375,856 a month.** That is **21% of the population** and 24× the red
  figure in money. **1,191 of them (18.5% of the population) are with a client.**

**⚠ Amber is a positive test, not a leftover, and here is the proof it covers everyone.** An
earlier v8 draft wrote the third clause as *"and she has already drawn a payroll run"*, which reads
as a requirement rather than as the negation of M4. **27 maids satisfied none of the four buckets
under that wording** — a wrong but non-zero component, so M4 (blanks only) did not excuse them;
below the rule, so not red; and no payroll run, so the clause ejected them. **19 of the 27 are with
a client.** They are 16 Indian live-in on accommodation 546 against 800, 10 Kenyan live-in on a
MOHRE wage of 546 against 600, and 1 Indian on both. The gate caught it; the tie-outs had balanced
anyway, because amber was still absorbing the gap.

**The completeness control that makes this safe.** Measured on the whole population:
**zero maids are non-red, non-green and not below on at least one component.** A maid above on one
component is red whatever the other does, so every remaining maid is below on at least one — the
four buckets are exhaustive **by construction and by measurement**, and none of them has to be
computed as what is left over.
- **The largest shapes**, every one of 15 maids or more. Nine shapes, 1,266 maids, AED 333,130 —
  **89% of the amber total**:

| Cohort | Shortfall | Maids | AED / month |
| --- | --- | --- | --- |
| Filipina live-in | blank MOHRE vs 1,500 | 130 | 195,000 |
| Ethiopian live-in | MOHRE 546 vs 1,000 | 104 | 47,216 |
| Kenyan live-in | MOHRE 546 vs 600 | 642 | 34,668 |
| Filipina live-out | blank MOHRE vs 1,500 | 17 | 25,500 |
| Indian live-in | MOHRE 546 vs 600 **and** accommodation 546 vs 800 | 26 | 8,008 |
| Kenyan live-out | MOHRE 546 vs 600 | 146 | 7,884 |
| Ugandan live-in | MOHRE 546 vs 600 | 101 | 5,454 |
| Indian live-in | accommodation 546 vs 800 | 20 | 5,080 |
| Ugandan live-out | MOHRE 546 vs 600 | 80 | 4,320 |

**147 Filipina maids carry AED 220,500 of the AED 375,856** — they have no MOHRE wage recorded at
all, and every one of them has already been paid. That is the queue to work first. **995 African maids sit at exactly 546,
AED 54 short** of the 600 in rules 95 and 71 — AED 53,730 a month, the widest shape in the report by
headcount and among the smallest per maid. The four rows above hold 969 of them; the rest are in
cohorts too small to list. This is the shape O2 turns on.

##### M8b — Excess and shortfall

- **Excess (the loss).** `SUM(GREATEST(M1 − rule_mohre, 0) + GREATEST(M2 − rule_accom, 0))` over red
  rows. **AED 15,342 per month, AED 184,104 per year.**
- **Shortfall.** The same arithmetic the other way over amber rows. **AED 375,856 per month.**
  Reported beside the excess and **never added to it** — it is entitlement not yet paid to staff,
  not money lost by the company.
- **A further AED 102,992 a month sits on the 76 excused maids and is deliberately not counted**,
  here or anywhere. Their components are not set up yet, so the gap is a setup step, not a debt.
- **Rounding.** 2 dp at row level; sum the rows, never round the total. Both sides rounded to 2 dp
  before comparison, since the columns are FLOAT.

##### M9 — Component at fault

- **Formula.** `MOHRE wage` when only M1 breaches its rule; `Accommodation` when only M2 does;
  `Both` when both do.
- Uses only the two audited components. Total salary is never consulted.

##### M10 — As-of date and run persistence

`HOUSEMAIDS_INFO` is current-state with no snapshot column, so a run cannot otherwise be
reproduced: a corrected component would vanish from next month's run indistinguishably from a
maid who left. Every run stamps an `AS_OF_DATE` and **its output is persisted**. Where a past
month must be rebuilt, rebuild the population from D11.

**Tie-out rule.** Four identities must hold, and all four are displayed:

1. `all CC maids = in-scope + every excluded bucket`, the buckets being disjoint
   → 81,418 = 6,430 + 19,530 + 55,265 + 152 + 40 + 1
2. `population = compliant + red + amber + excused` → 6,430 = 4,950 + 39 + 1,365 + 76
3. `red by nationality` → 39 = Ugandan 20 + Kenyan 14 + Indian 3 + Nigerian 1 + Filipina 1
4. `mismatches = red + amber + excused` → 1,480 = 39 + 1,365 + 76

**A tie-out that balances is not proof it is right, and this spec has the scar twice.** v7 reported
182 excused and 1,417 amber where the truth is 76 and 1,365: identity 2 summed to 6,430 in both
versions, because amber had been derived by subtracting the other three from the population, so the
error moved 106 maids between two buckets and left no trace in the arithmetic. **The first v8 draft
repeated it one layer down** — amber was written as a positive formula but measured as an `ELSE`
branch, and 27 maids fell out of every bucket while both identities still balanced.

**So the rule is now two rules, and the second is the one that was missing.** Measure every addend
with its own positive predicate, **and** measure the residue — the count of maids matching no
bucket — and require it to be **zero**. It is zero today. A tie-out proves the addends agree with
each other; only the residue proves nobody was left out.

---

#### 4. Finalised UI Report

**Layout.** One screen: filter row → four KPI tiles → tie-out strip → exception table with a
variance-by-cohort bar chart beside it. Mockup:
https://claude.ai/code/artifact/d6a9c064-da23-4fb9-9c39-602a2591fe2e

**Columns.**

| Column | Source | Format | Default |
| --- | --- | --- | --- |
| Maid | D1 | ID, links to ERP profile | — |
| Nationality | D5 | text | group |
| Living | D6 | live-in / live-out | — |
| Start date | D10 | `YYYY-MM-DD`, `—` when absent | — |
| MOHRE wage actual / standard | M1 / M0b | AED #,##0 | — |
| Accommodation actual / standard | M2 / M0b | AED #,##0 | — |
| Excess / shortfall | M8b | AED #,##0 | **sort desc** |
| Component at fault | M9 | MOHRE wage / Accommodation / Both | — |
| Flag | M7 / M8 / M4 | pill + label | — |

**Filters.** Maid type (CC, locked), status (the eight, locked), pending termination (excluded,
locked), nationality (all), living (all), review state (unreviewed), **direction** (red / amber /
excused, red only by default).

**Drill-down.** Clicking a row opens her component history from **D11** — what each component
was, when it changed, and who changed it.

**Conditional formatting.** **Red — a component ABOVE the rule**, which is the loss.
**Amber — below the rule, blank included**, which is a compliance queue and not a loss.
Green — both match. There is no grey: every maid carries a verdict, and M10’s residue control is what
 proves it rather than assuming it. Colour is never the
only signal; every row carries the word as well.

**Access.** The report shows individual pay components for named maids and offers a CSV export.
**Restrict both to Police & Control and Payroll.** Read access to the warehouse does not
authorise display.

**Provenance line.** Displayed at the foot: the two source tables, the `AS_OF_DATE`, and the date
the M0b rate table was last transcribed from ERP's salary-rule screen.

---

#### 5. Worked Examples

**Amounts are real measured shapes and every maid id is masked**, including in the two single-case
examples — this document circulates and has no access control, while the report itself is
restricted to Police & Control and Payroll (section 4). The ids live in the report, where that
restriction actually bites. Rates are the M0b table.

##### A — compliant

Filipina, live-in. MOHRE wage 1,500 (primary 1,500 + holiday 0). Accommodation 846. Both equal the
rule. **Green.** 2,651 of the 2,795 Filipina live-in maids are in this state.

##### B — red, and the shape the report is built for

Ugandan, live-out. MOHRE wage 1,000 against rule 71's 600. Accommodation 1,000, correct.
Excess = **AED 400 a month**. **Red.** **13 maids, AED 5,200 a month** — the largest single red
shape, and one of four shapes that between them are 33 of the 39 reds.

##### C — red, the largest single case

Ugandan, live-out. MOHRE wage **1,496** against 600 — the only red not sitting on a round number,
which is what a typed value looks like. Excess = **AED 896 a month**. One maid, 11 payroll runs
since September 2025.

##### D — amber, and the biggest money in the report

Filipina, live-in. MOHRE wage blank. Accommodation 846, correct.
Shortfall = **AED 1,500 a month**. **Amber**, because blank is below the rule, not above it.
**130 maids, AED 195,000 a month**, and every one of them has already been paid.

##### E — amber, and the widest shape by headcount

Kenyan, live-in. MOHRE wage 546 against rule 95's 600. Accommodation 546, correct.
Shortfall = **AED 54 a month**. **Amber** — she is short-changed, the company has lost nothing.
**642 maids, AED 34,668 a month.** This is the shape O2 asks about: 54 dirhams each, 642 times.

##### F — excused, blank and never paid

Same shape as D, but she has no row at all in `HOUSEMAID_PAYROLL_HISTORY`. **Excused, not a
finding** — her components have not been set up yet. **76 maids, AED 102,992 a month that the
report deliberately does not count.**

##### G — amber on accommodation, not on the wage

Indian, live-in. MOHRE wage 600, correct. Accommodation 546 against a rule of 800.
Shortfall = **AED 254 a month**. **Amber.** **20 maids** — and **1 of the 68 Indian live-in maids**
is on the 800 that rule 90 set on 2026-09-08. See O3.

##### H — red on accommodation, the only one

Filipina, live-in. MOHRE wage 1,500, correct. Accommodation 1,200 against a rule of 846.
Excess = **AED 354 a month**. **Red.** One maid, with us since 2017 and carrying this accommodation
across **74 payroll runs** — the longest-standing case in the report. *When the accommodation was
first set wrong is not measured here; D11 holds the answer and the report's drill-down shows it.*

---

#### 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | **ERP has no Ghanaian salary rule at all** — rules 95 and 71 exclude them by name, so ERP answers `"No Rule is found!"`. The spec prices 26 Ghanaian maids at a ruled 546 / 546 / 1,000, which 24 of them already match, and that leaves a Ghanaian AED 54 below every other African maid. Confirm the ruling, or ask Payroll to add the rule | Abdullah Mahdi / Payroll | **Yes** |
| O2 | **Only 10.6% of African live-in and 19.4% of African live-out maids are on ERP's own rate of 600.** 1,066 African maids are off it — AED 89,872 a month of variance, AED 75,376 of it underpayment, and 995 of them are sitting at exactly 546, AED 54 each. Rules 95 and 71 were modified 2026-08-17 and nobody restated the population; the alternative reading is that 600 is not what the business actually pays. **Nothing in the data can settle it — a person must.** Raising the rate to 1,000 was tested on 2026-09-10 and rejected | Abdullah Mahdi / Payroll | **Yes** |
| O3 | **Indian live-in accommodation is 800 by rule 90 (modified 2026-09-08) and 1 of 68 maids has it.** 67 sit below, 46 of them on 546. And **3 of the 39 red cases are Indian**, from a 68-maid cohort — the highest exception density in the report | Payroll | No |
| O4 | **The 1,365 amber rows, worth AED 375,856 a month, have no owner and no action.** The 147 Filipina maids with no MOHRE wage at all are AED 220,500 of that and should be worked first. Decide who owns the queue and to what standard | Abdullah Mahdi | **Yes** |
| O5 | **Re-transcribe the M0b rate table quarterly**, and whenever M0c alarms on a cohort that was previously healthy. Six ERP rules changed on 2026-08-17 and one on 2026-09-08 | Abdullah Mahdi | No |
| O6 | **211 terminated maids drew a July 2026 payroll** as mid-month leavers and are excluded. Confirm | Abdullah Mahdi | No |
| O7 | `LANDED_IN_DUBAI` (152 maids, 3 on the July payroll) and `RESERVED_FOR_REPLACEMENT` (1) are excluded by status. **The single RESERVED_FOR_REPLACEMENT maid IS on the July payroll**, so "components not yet set" is not the reason for her exclusion — confirm the right one | Abdullah Mahdi | No |
| O9 | **"Paid" is defined as having any row in `HOUSEMAID_PAYROLL_HISTORY`, not a transferred one.** 7 in-scope maids have rows where nothing was transferred and 2 of those have a blank MOHRE wage, so 2 maids are reported rather than excused. Confirm row presence is what you meant, or switch M4 to `IS_TRANSFERRED = 'YES'` | Abdullah Mahdi / Payroll | No |
| O8 | The accommodation half cannot see a maid switched to live-out whose accommodation was never updated: `ACCOMMODATION_SALARY` and `LIVE_OUT` move together and the client contract agrees on all 5,367 matched maids. Ruled 2026-09-10: **accept the blind spot and state it** | Abdullah Mahdi | Closed |

---

*Every table, column and type in section 2.1 was confirmed by query against live Snowflake, and
every figure was measured on 2026-09-10 from a single read. **The check runs on Snowflake alone** —
two tables and the hardcoded rate table in M0b. No ERP call, nothing to ingest. **Every rate is
ERP's own except the Ghanaian row**, which exists because ERP has no Ghanaian rule; a higher
African rate was tested on 2026-09-10 and rejected, and the red counts it would have produced are
in M0b so the choice is auditable. **Three errors were found by re-measuring rather than by
reasoning:** v1–v6 derived each rate from the population and got the African rate backwards; v4–v7
held 106 too many maids in the excused bucket behind a tie-out that summed correctly; and the first
v8 draft left **27 maids, 19 of them with a client, in no bucket at all** while both identities
still balanced. M0c exists so the first cannot repeat quietly. The two rules under M10 — measure
every addend with its own predicate, **and** measure the residue and require it to be zero — exist
so the second and third cannot. **This version was audited by the `spec-auditor` gate on
2026-09-10:** it raised 2 critical, 2 major and 4 minor findings, every one was reproduced against
live Snowflake before being accepted, and all eight are fixed above.*


---

## Part 2 — Salary Raises and MV Margin · roadmap #19

### Spec — Maids Salary Check (CC and MV)

| | |
| --- | --- |
| **Requested by** | Abdullah Mahdi, Police & Control |
| **Spec version** | v5 |
| **Date** | 2026-09-10 |
| **Road-map** | #19, Payroll |
| **UI mockup** | https://claude.ai/code/artifact/a314b186-4e25-481b-9f80-35c4587404ce |
| **Status** | Draft — pending requestor approval |
| **Supersedes** | `SPEC_maids_salary_check_v4.md` |
| **Changelog** | `spec_history/cc-maids-salary-raise.md` |

**What changed in v5.** One thing, and it changes what the report says on a fifth of its rows.
**The raise categories now name the reason we gave the money, not the type of ticket the
conversation happened in** (section 3B). Eleven categories become **nine**, four of the old names
are retired because they were ticket types, four new reasons are added because staff write them
down and nothing was reading them, and **a reason somebody wrote down now outranks a data route.**
Everything else — the CC entitlement walk, the MV margin check, the rules, the metrics — is
unchanged from v4.

**Why it mattered.** v4's categories 6–10 were seeded from `COMPLAINT_TYPE`. The three most common
complaint types next to an August salary raise are `Maid related question` (104 of the 139 maids),
`Listener Session` (82) and `Intro Call` (62), which say nothing about why a salary moved.

---

#### 1. Business Logic

##### 1A · CC — was this raise authorised?

**The control.** A CC maid is a maids.cc employee. She starts on a salary, and it may only rise by a
route the company has defined. This report proves every dirham of every CC maid's salary traces to
one of them.

**The failure it catches.** Us overpaying: a salary rose with nothing authorising it, or a maid
received more renewal raises than she is entitled to in her working life.

##### 1B · MV — are we paying her more than her client pays us?

**The control.** An MV maid is the *client's* employee; we sponsor her visa and run her payroll. Two
separate numbers have to agree. **What we pay her** comes from her housemaid payroll profile —
`TOTAL_SALARY`, the same field the CC side uses. **What the client pays us for her** is built from
the **worker salary on his contract** plus his **Contract Payment Terms (CPT)**. The ERP is supposed
to keep those in step.

**The failure it catches.** A margin we are funding ourselves. If her payroll salary and the client's
worker salary disagree, something is wrong — **and if her salary is the higher of the two, every
payroll run pays out money no client is paying in.**

**Plain terms:** on the CC side the question is *"who approved this?"*. On the MV side it is *"who is
paying for this?"*. Same table, different question, so they are different rules with different
owners.

##### The complaint read decides the CC side; the arithmetic only sorts the queue

Measured on August 2026: of **143** CC salary increases across 139 maids, a data route or a written
reason accounts for **142**, leaving **1** with nothing — and the read explains that one too.
**136 of the 143 carry a complaint in the read window and 105 carry a manager note; only 7 have
neither.**

1. **An increase with no route is never a finding on the arithmetic alone.**
2. **Having a complaint clears everything and tells us nothing** — 95% of increases have one. Only
   what it *says* decides.
3. **And a route firing does not mean the route is the reason** — see 3B. On **20 of the 143** the
   data route and a written reason both fire, and **only the read can say which is right.** Of the 2
   read so far, one was neither: maid 68012 turned out to be category 8.
4. **Nor does a manager-action label.** Maid 68012 carries an incentive log **15 days** before her
   raise; the incentive is real and is for something else entirely. Only the thread separated them.

##### An AI agent must do the reading. This is the single most important requirement in the spec.

**It is the step that clears flags rather than raising them.** The sums can only say "nothing in the
data explains this raise". Almost always something does, and it is written in a complaint.

**A person cannot do it.** One month's pile: **1,633 complaint threads, 11,499 individual messages,
517 manager notes** across the flagged cases, 8 threads per case on average and 46 at worst. At
thirty seconds a message that is over a hundred hours a month, and the first thing a human under that
load does is stop reading past the first few threads — the one failure this check cannot survive.
Maid 3978 has 96 complaints all-time and **14 inside the read window**; her answer sits in the
eleventh-day one, not the first opened, so **all 14 had to be read** before it surfaced.

**The agent's output is a category, not an opinion** — see 3B. It never computes an entitlement, a
route or an amount; those are the warehouse's job, so an agent error can misjudge one case's evidence
and never move a total. Model `claude-sonnet-5`.

**The read is exhaustive over its window** and may never be filtered to complaints with "salary" in
them. One case in three has zero salary-word matches.

**Every verdict carries the quoted words it rests on and a link to the complaint** —
`https://erp.maids.cc/post-sale-services/open-todo/{complaint id}`. Every maid id links to
`https://erp.maids.cc/housemaid/details/{id}`. Both patterns confirmed live.

##### Who is in scope

**Everyone we paid within the month, both maid types.** August 2026: **5,907 CC** and **24,993 MV**.
CC means any `HOUSEMAID_TYPE` other than `MAID_VISA`; MV means `MAID_VISA`.

**Status is a column on the report, never a filter.** A filter leaves paid maids unexamined — 188
pending discipline, 87 no-show, 63 employment-terminated maids we still paid — and makes the check
gameable: move a maid into an unaudited status and her salary stops being checked. If we paid her, we
audit her.

**Out of scope.** Salary decreases on the CC side (money out only). The renewal document as proof of
a raise — it proves a renewal happened, nothing more. New-joiner salary setting: a first salary, or a
change inside 90 days of hire, is onboarding — **it counts toward what she is entitled to and is
never flagged.** Both halves matter; accepting a change but leaving it out of her entitlement would
leave her reading as overpaid by it forever.

**One row per maid per payroll month.** CC increases sharing a date and the same before-and-after
salary are shown as one case (M7).

**Refresh.** Monthly after payroll lock. Not scheduled in Snowflake; this spec is the handoff.

---

#### 2. Data Points Needed

##### 2.1 Verified — already in Snowflake

Confirmed by query, `BA_VIEWS`, role `MONEY_CONTROL_ROLE`. D1–D14 re-verified twice by the
`spec-auditor` gate; D15–D17 verified 2026-09-09.

| # | Data point | Table | Column | One row per | Verification |
| --- | --- | --- | --- | --- | --- |
| D1 | Maid master | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID`, `STATUS`, `HOUSEMAID_TYPE`, `NATIONALITY`, `NATIONALITY_ID`, `LIVE_OUT`, `NET_HIRED_DATE`, `EXCLUDED_FROM_PAYROLL` | maid | `LIVE_OUT` is NUMBER (0/1), not TEXT like `IS_LIVE_OUT` elsewhere |
| D2 | Salary actually paid | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH`, `TOTAL_SALARY` | **not reliably one per maid per month** — for 2026-08, **22 CC maids hold 66 rows, 15 of them with differing amounts**, and **7 MV maids hold 14 rows, 1 differing**. M1a's MAX applies on both sides | See M1a. **This is the field the ERP releases, for both maid types** |
| D3 | Every salary change, and who made it | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION` | `ID`, `REVISION`, `BASIC_SALARY`, `BASIC_SALARY_MODIFIED`, `LAST_MODIFICATION_DATE`, `LAST_MODIFIER` | revision | History 2018-03 → 2026-08 |
| D4 | Live-in / live-out switch | as D3 | `LIVE_OUT`, `LIVE_OUT_MODIFIED` | revision | **113 CC maids carry `LIVE_OUT_MODIFIED='01'` dated inside August across 144 revision rows; on 90 of them the value actually differs from the previous revision.** Use the 90 — the flag is set on rewrites that do not change the value |
| D5 | The salary ladder | `CORE_SILVER.PICKLISTS_ITEMS_TAGS` | `TAG_NAME` where `PICKLIST_NAME='maids_at_countries'`, `PICKLIST_ITEM_NAME='United Arab Emirates'` | tag | Exact: live-in Filipina 2,000 / 2,350 / 2,700; live-in other 1,150; live-out Filipina 3,200; live-out other 1,950; live-out renewal fields deliberately blank |
| D6 | Renewal raise per nationality | as D5, `PICKLIST_NAME='nationalities'` | `TAG_NAME` | tag | **Background only.** Filipina `renewal_raise:350` and `max_renewal_raise:400`; Ethiopian, Kenyan, Ugandan carry neither |
| D7 | Residency visa renewals | `VISA_SILVER.RENEW_VISA_REQUESTS` | `OWNER_ID`, `RVISA_ISSUANCE_DATE` | renewal request; 1.34 per maid | `OWNER_ID` matches D1 with zero misses. Issuance date missing on 3,756 of 20,516 (18.3%) |
| D8 | MaidVisa → CC switch | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID`, `FROM_TYPE`, `TO_TYPE`, `CHANGE_DATE` | type change | 2,109 real switches: `MV`→`CC Live In` 1,061, `MV`→`CC Live Out` 1,048 |
| D9 | Retention raise given | `HOUSEMAID_MANAGEMENT_SILVER.RETRACTION_CASES_TOOL_CALLS` | `MAID_ID`, `RAISE_GIVEN` (**TEXT**), `TOOL_CALL_DATE`, `RETRACTION_TYPE`, `RETRACTION_METHOD`, `RESIGNATION_REASON` | tool call | Real amounts 100–700. **Category 5's evidence.** `RETRACTION_TYPE` is `Resignation` (1,751) or `Non-Renewal` (355); `RETRACTION_METHOD='Raise'` is the only method carrying money — **117 of its 211 rows have an amount**, and no other method has any. `RESIGNATION_REASON`'s top value is `Salary Amount` (528). **The table under-records — see O16.** `RETRACTION_TYPE` also holds values outside the two named — `Salary Amount` (1 row, and it carries an amount), a stray `Language_Update(...)` and 2 blanks — so the column needs an **other** bucket rather than a two-value assumption. `RESIGNATION_REASON` is **context only**; no rule reads it |
| D10 | Resignation to-do | `HOUSEMAID_MANAGEMENT_SILVER.RESIGNATION_TO_DOS` | `HOUSEMAID_ID`, `CLOSED_DATE`, `RESIGNATION_CLOSED_TYPE` | to-do | **Background only.** Carries no amount |
| D11 | Complaint header | `CLIENT_MANAGEMENT_SILVER.COMPLAINTS` | `ID`, `HOUSEMAID_ID`, `COMPLAINT_TYPE`, `COMPLAINT_DESCRIPTION`, `CREATION_DATE` | complaint | `ID` builds the evidence link. **`COMPLAINT_TYPE` is context for the read only and never assigns a category** — v5 retired the four categories that were built from it |
| D12 | Complaint thread | `CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS` | `COMPLAINT_ID`, `TEXT`, `CREATION_DATE` | comment | Use **`TEXT`** (rendered), never `ORIGINAL_TEXT` (raw HTML) |
| D13 | Manager action notes | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS` | `HOUSEMAID_ID`, `ACTION_TYPE`, `NOTES`, `USER_WHO_CREATED_NOTE`, `ACTION_DATE` | action | The only maid-side source with note text, and **the only place categories 6 and 7 are recorded.** `ACTION_TYPE` values that name a salary reason: **`Maid Incentive Experiment`** (3,761 rows all-time; its `NOTES` reads *"as long as she is with <client name>"*), `Wants Higher Salary`, **`Cook`** (895) and **`Trainer`** (2,604) for a completed course, and `Hiring Decision: Accepting a CC maid` (3,899) which carries the starting salary as text. **Its `AMOUNT` column exists and is 100% NULL across every one of these action types — do not build O15 on it.** Two further training-shaped types are deliberately excluded from category 7, `Jad’s Focus Group Training` (1,142 — note the curly apostrophe U+2019; a straight `'` matches zero rows silently) and `TA - PH - Pending Training` (14); neither falls near an August raise, so the exclusion costs nothing this month |
| D14 | Staff user lookup | `CORE_SILVER.USERS_INFO` | `ID` resolves `D3.LAST_MODIFIER` | user | 3,842 users; resolves 22 of 22 August modifiers. Display-name column to be confirmed |
| **D15** | Contract master | `SALES_SILVER.CONTRACTS` | `ID`, `HOUSEMAID_ID`, `CLIENT_ID`, `CONTRACT_TYPE`, `CONTRACT_STATUS`, `START_OF_CONTRACT`, `END_OF_CONTRACT`, `MAID_NATIONALITY` | contract | Identifies **which contract** was in force. 24,967 of 24,993 MV maids paid in August match a contract (99.9%); 27,703 contract rows for those maids, so a maid can hold several — see M8. **Its `WORKER_SALARY` column is current-state and must NOT be used for the comparison — see D18 and the traps below** |
| **D16** | Contract Payment Terms (CPT) | `SALES_SILVER.CONTRACTS_PAYMENTS_TERMS` | `ID`, `CREATION_DATE`, `CONTRACT_ID`, `HOUSEMAID_ID`, `CLIENT_ID`, `CPT_TYPE`, `IS_ACTIVE`, `IS_PRO_RATED`, `CPT_NATIONALITY`, `CPT_CREATION_REASON`, `PAYMENT_TERM_CONFIG_ID`, `WEEKLY_AMOUNT`, `VISA_FEES`, `ADDITIONAL_DISCOUNT` | payment term | **Tells you WHEN the terms changed, not what the salary is.** It carries the fee structure — `PAYMENT_TERM_CONFIG_FORMS.NAME` reads like *"8.5k + 250/month - NO INSURANCE"* — and **no maid-salary column exists on it or on the config form** (O14). Its `CREATION_DATE` and `IS_ACTIVE` anchor the point in time, and they land exactly on the salary changes: new CPTs on 2026-09-01 and 2026-09-02 for the two contracts whose worker salary moved on those dates |
| **D17** | Worker salary as billed | `MONEY_COLLECTION_SILVER.PAYMENTS_LOGS` | `CONTRACT_ID`, `CREATION_DATE`, `WORKER_SALARY`, `WORKER_SALARY_VAT`, `WORKER_SALARY_WITHOUT_VAT`, `INCLUDE_WORKER_SALARY` | payment log line | What actually reached an invoice. **Not the comparison basis** — the requestor's ruling is to audit the agreed terms, not the execution; collection is CC Clients Monthly Payment's job. Use it to corroborate a finding before escalating |
| **D18** | **The worker salary as of the audited month** | `SALES_SILVER.CONTRACTS_HISTORY` | `CONTRACT_ID`, `CONTRACT_REVISION`, `MODIFICATION_DATE`, `WORKER_SALARY`, `WORKER_SALARY_MODIFIED` (**real BOOLEAN**), `LAST_MODIFIER`, `MODIFIER_NAME` | contract revision | **The MV side's comparison basis.** One row per change, with the date and the person who made it. **Coverage is complete once blanks are skipped: zero comparable maids are left without a figure. Without the NULL skip, 5 are — including the month's only finding (see M8).** Verified against four hand-checked cases |
| **D19** | **Pre-collected contracts** | `CLIENT_MANAGEMENT_SILVER.CONTRACTS_WITH_PRE_COLLECTED_SALARIES` | `CONTRACT_ID`, `HOUSEMAID_ID`, `PRE_COLLECTED_CONTRACT` (BOOLEAN), `PRE_COLLECTED_AMOUNT`, `ABSORBED`, `ABSORPTION_DATE` | contract | **Why M10 exists.** On a pre-collected contract payroll runs a month behind the money. **19,747 of the 22,451 MV contracts in force are pre-collected — 88%**, so the lag is the default case, not an exception. Not used to score anything; used to explain the held bucket to the reader |

##### 2.2 Approved KPI definitions

| Metric | Source | Reused? |
| --- | --- | --- |
| CC salary raises by reason | `HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_CC_MAID_SALARY_RAISES_BY_REASON` — Payroll KPI 3.4c, DNA-6364 | **Control total only.** One row per month × `MAID_TYPE` × reason. `RAISE_REASON` contains a literal `'Total salary raises'` row, so adding across reasons gives exactly twice the truth (**326 against 163 for 2026-08**). Filter `RAISE_REASON <> 'Total salary raises'`. **Its reasons map onto categories 1, 2, 3 and 5 and disagree with them by up to 3× (MV to CC 18 against 6). The requestor's ruling, 2026-09-10, is to register §3B as a NEW approved Police & Control definition in the Data Catalog rather than reuse 3.4c — see O18. Until that entry lands, 3.4c stays a control total only and the two must not be added together** |

No approved definition exists for the entitlement calculation, the exception rules, or anything on
the MV side. **These are new Police & Control definitions and should be added to the Data Catalog.**

Departures from KPI 3.4c: it dates a renewal raise from **request creation**; this check uses
**`RVISA_ISSUANCE_DATE`**, the visa actually issued. It joins renewals on `NEW_REQUEST_ID`; use
**`OWNER_ID`**, which matches with zero misses. Both keys repeat at ~1.34 rows per maid, so **test
routes with `EXISTS`, never a join** — a join multiplies any total by roughly a third.

##### 2.3 New data ingestion request

| # | Data point | Source | Native ERP table | Why | History |
| --- | --- | --- | --- | --- | --- |
| N1 | Delighter to-do completed tasks | ERP — Housemaid Management | `mmdb.delightertodos`, `mmdb.delightertodo_completedtasks` (`RAISE_OFFERING_FINAL_DECISION`, `CHECK_MAID_INSISTING_TO_RESIGN`) | The structured approval for a retention raise and the only place its approved amount sits beside its decision. KPI 3.4c already reads these; they are not in `BA_VIEWS` | From 2024-01-01 |
| N2 | Written salary-raise approvals in To-dos | ERP — To-dos | `UNVERIFIED — Ask the Code not run` | A second approval surface. Lower priority than in v1 — complaints already carry the authorisation | Full |

**Join keys.** All NUMBER, no conversion. `HOUSEMAIDS_INFO.ID` = `HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID`
= `HOUSEMAIDS_INFO_REVISION.ID` = `HOUSEMAID_TYPE_LOGS.HOUSEMAID_ID` = `COMPLAINTS.HOUSEMAID_ID`
= `HOUSEMAID_MANAGERACTIONLOGS.HOUSEMAID_ID` = `RETRACTION_CASES_TOOL_CALLS.MAID_ID`
= `RENEW_VISA_REQUESTS.OWNER_ID` = **`CONTRACTS.HOUSEMAID_ID`**. Inside the complaint pair,
`COMPLAINT_COMMENTS.COMPLAINT_ID` = `COMPLAINTS.ID` — the comments table has no maid id of its own.
`CONTRACTS_PAYMENTS_TERMS.CONTRACT_ID` = `CONTRACTS.ID`.
`HOUSEMAIDS_INFO_REVISION.LAST_MODIFIER` = `CORE_SILVER.USERS_INFO.ID`.

**Traps that fail silently.** Each was a real defect caught during the build.

- 🔴 **`IS_SALARY_VAT_APPLIED` does NOT mean the worker salary includes VAT.** It says whether VAT is
  added when billing the client. `CONTRACTS.WORKER_SALARY` is **already the maid-comparable,
  VAT-exclusive figure**, whatever the flag says. Proof: comparing raw gives **21,856 exact matches
  of 21,953 (99.6%)**; dividing by 1.05 first gives **zero** exact matches and would flag 21,932
  maids and AED 1,512,373 of pure fiction. The flag is true on 18,133 rows and false on 9,570, so
  trusting its name breaks two thirds of the comparison.
- 🔴 **Pick the contract in force *during* the audited month, not the maid's latest.** Taking the
  most recent contract by start date reported **36 maids overpaid by AED 22,140**; eleven of the
  twelve largest gaps were contracts starting in **September**, i.e. an August payroll compared
  against a contract that did not exist yet. Constrained properly: **5 mismatches, of which 1 survives the M10 gate** — the naive rule inflated the count 36-fold.
- 🔴 **`CONTRACTS.WORKER_SALARY` is current-state. Use `CONTRACTS_HISTORY` as of the month (D18).**
  This is the same clock error as the bullet above, hiding one column deeper, and it survived the
  first fix. Maid 70071 read as **AED 1,000/month over 23 months — AED 23,000** against the current
  field; her agreed worker salary was **3,000 for every one of those months**, matching her payroll
  exactly, and only moved to 2,000 on 2026-09-01. Maid 43677 read as AED 3,750 over 25 months and was
  likewise an exact match throughout. **Two of the four reds and five of the six ambers were pure
  artefact**, while a real six-year case (maid 17342) was hidden. See M8.
- **`BASIC_SALARY_MODIFIED` has three states: `'00'`, `'01'`, and NULL.** No empty string. Always
  test `= '01'`. `<> '00'` happens to return the right 180,855 rows only because `NULL <> '00'` is
  NULL, so **never wrap the column in `COALESCE` or use `IS DISTINCT FROM`** or 1.1 million NULL rows
  arrive as salary changes. `LIVE_OUT_MODIFIED` and `IS_TAG_DELETED` have the same shape.
- **Two vocabularies that look like one.** `HOUSEMAID_TYPE_LOGS.FROM_TYPE` holds `MV`, `CC Live In`,
  `CC Live Out`. `HOUSEMAIDS_INFO.HOUSEMAID_TYPE` holds `MAID_VISA`, `Normal`, `FREEDOM_OPERATOR`,
  `WALKIN`. **They share no values.** `FROM_TYPE='MAID_VISA'` matches zero rows, raises no error, and
  switches the MV→CC route off. `CONTRACTS.CONTRACT_TYPE` is a **third** vocabulary — `CC` / `MV`.
- **`BASIC_SALARY` on a revision row is the value *after* the change** — the newest revision matches
  current salary for 5,631 of 5,645 maids. But **the earliest revision is NULL for 87.5% of maids**,
  which is why M1b defines the starting salary the way it does.
- **`RAISE_GIVEN` is TEXT and three rows read `'no extra- renewal raise reminder'`** — a statement
  that *no* raise was given. Test `TRY_TO_NUMBER(RAISE_GIVEN) > 0`, never presence.
- **`EXCLUDED_FROM_PAYROLL` is TEXT `'00'`/`'01'`, 1,532 maids flagged** — carry it as a report
  column. `IS_DELETED` is true for **1 maid of 123,237**, so gating on it does nothing: keep it for
  form, never rely on it to remove anything.
- **Part-month pay.** `TOTAL_SALARY` is reduced for a partial month and the basis is **unknown** —
  1,962 against a 2,000 level is not a whole-day calculation on any month length. **1,677 of 5,907 CC
  maids (28.4%) are paid below their own current basic salary**, so any excess of theirs is hidden.
  CC coverage is **71.6%** and M6 puts that on the report.
- **415 CC maids (7.0%) have salary decreases** (497 events), and **84 have an increase and a decrease
  on the same day, 37 cancelling out exactly.** A same-day pair is a correction, not a raise.
- **Nationality history is recoverable** — no `NATIONALITY` column on the revision table but
  **`NATIONALITY_ID`, populated on 81,737 of 82,013 changed rows (99.7%)**.
- **`CONTRACTS` carries client contact columns** (hashed phone, WhatsApp, email address). They are
  never selected, never displayed, and never leave the warehouse.
- **Time zone.** Dates in D3/D4/D7/D8/D9/D11/D13/D15 are `TIMESTAMP_NTZ`; `PAYROLL_MONTH` is `DATE`.
  Assume **Asia/Dubai** and use `TO_DATE(...)`.
- **All amounts are AED.** D5 carries `SalaryCurrency:AED`; no conversion anywhere.

---

#### 3. Metric Calculations

##### M1a — Salary paid (both maid types)

`MAX(D2.TOTAL_SALARY)` for the maid and the audited `PAYROLL_MONTH`.

**Why MAX.** D2 is not reliably one row per maid per month, and the highest figure is the
conservative choice for an overpayment check. **Emit the maid as a data-quality row** so the duplicate
is seen rather than absorbed. `TOTAL_SALARY` NULL for 2 CC maids and zero for 7, and zero or NULL for
617 MV maids — all **data-quality rows, never Clear**; a NULL compared to anything is NULL, so
without this rule they pass every test silently with no salary known.

**Never `NET_SALARY`.** Net adds additions and subtracts deductions, so a one-off airfare reads as a
raise that never happened. **This holds on both sides** — additions and deductions exist on MV
payroll too and are not part of either comparison.

---

#### 3A · The CC rules — unchanged from v3

##### M1b — Salary she is entitled to

**Her salary history, day by day.** For each maid and each date take `BASIC_SALARY` from her
**highest `REVISION` that day** among rows where `BASIC_SALARY_MODIFIED='01'` and `BASIC_SALARY` is
above zero. Movement is the day-to-day change. This collapses same-day reversals before anything is
counted — **2,919 increases across her whole history** for the maids paid in August.

**Her starting salary** is her **earliest daily figure**; where a maid has none, fall back to her
group's base from D5 and **count the fallbacks in M6**. August needed the fallback **zero** times.

**Formula.** `entitled = starting salary + SUM(net day-to-day movement, both directions) − unauthorised`.
Since `starting salary + SUM(net movement)` is her current basic salary, `entitled = current basic
salary − unauthorised`, and **M2 is the unauthorised total itself**.

**Movement must carry its sign.** Adding up only increases inflates entitlement by **AED 272,933**
across 407 maids and makes M2 read zero for five of the eight red maids, printing "recover AED 0" on
every red row.

**Excused increases count toward entitlement.** New-joiner steps are excluded from *flagging* and
**added to entitlement**. Maid 44770's +500 landed 7 days after hire; gating it out leaves her
reading as AED 500/month overpaid forever.

**A missing hire date sends the case to the read; it does not fail the new-joiner test.**
`DATEDIFF(NULL,…) >= 90` is NULL, which is not true, so a careless test drops every increase for
those maids. **216 of 5,907 maids (3.7%)** have no hire date.

**The four arithmetic routes.** Test each with `EXISTS`.

| Route | Test | Window |
| --- | --- | --- |
| Renewal raise | D7 `RVISA_ISSUANCE_DATE` | **6 months before to 60 days after** |
| Live-out re-base | D4 `LIVE_OUT_MODIFIED='01'` | 45 days either side |
| MaidVisa→CC re-base | **24 continuous months as CC** — D8's latest `TO_TYPE LIKE 'CC%'` entry, with no `TO_TYPE='MV'` after it and before the raise | 24 months elapsed |
| Retention raise | D9 **`TRY_TO_NUMBER(RAISE_GIVEN)>0`** | **60 days before to 15 days after** — one window, shared with 3B category 5 |

**The renewal window looks forward as well as back.** Salary is re-based when a renewal is processed
and issuance follows days later — maid 56922's visa issued the day *after* her raise, maid 30464's two
days after. Five of August's 143 increases have an issuance only after the change.

**The retention route reads D9 alone.** An earlier draft also cleared a raise whenever a resignation
to-do closed nearby; that clause carries no amount and no reason and matched **41% of all increases**.

**The renewal cap sits inside entitlement.** At most **two renewal raises in a working life**, counted
by **distinct renewal** — the distinct `RVISA_ISSUANCE_DATE` a raise attaches to, taking the latest
qualifying one where several fall in the window. Counting raise *events* instead flags 35 maids where
renewal counting flags 8: maid 10907's two increases seven days apart attach to one renewal.

##### M2 — CC unauthorised exposure

**The step itself.** For an increase in the audited month that no route and no excuse explains, the
exposure is the size of that increase, per month.

**Scope ruling, 2026-09-10 by Abdullah Mahdi: the check looks only at salary increases made IN the
audited month.** There is no walk over her earlier history, no carrying forward, and no netting
against later cuts, because there is nothing to net across.

**What this replaced, and what it costs.** An earlier version of this metric walked a maid's whole
salary history to find raises from *previous* months that were never explained and are still in her
pay today — rule R3, **171 maids and AED 48,103 a month for August, 69× the size of the current
month's exposure.** That rule is **deleted**. The consequence, stated plainly so nobody discovers it
later: **an unexplained raise granted before this check starts running is never examined by anything.**
Closing that would take one catch-up run over the back catalogue; it has not been ordered and is not
part of this spec.

##### M3 — Above the standard for her group

`M1a − standard` from D5, floored at zero. **The condition "where nothing in her history is
unauthorised" was removed with R3 on 2026-09-10** — it existed only to keep a maid out of both
buckets, and there is no longer a second bucket. **The standard is the top of her ladder, not its
base** — live-in Filipina **2,700**, not 2,000. Using the
base gives 1,262 maids and AED 449,142 against the correct 557 and AED 176,301. Live-out Filipina
3,200; live-in other 1,150; live-out other 1,950. **Raises do not stack on a live-out level** — the
config leaves those fields blank deliberately.

##### The CC rules

| Rule | Flag | Test | Aug 2026 |
| --- | --- | --- | --- |
| **R1** | Red | Renewal raises beyond two, by distinct renewal. Arithmetic — no read needed | 8 maids, AED 2,150/mo |
| **R2** | Read | An increase in the audited month with no route and no excuse | 1 maid, AED 700/mo |
| **A1** | Amber | Paid above her group's standard | **657 maids, AED 202,019/mo** |
| **DQ** | Grey | Salary paid is NULL or zero — never Clear | 9 maids |

Precedence R1 → R2 → A1 → Clear, with DQ taken out first.

**A1 grew when R3 was deleted, and the reason matters.** A1 used to read *above her group's standard
**with nothing unauthorised surviving***, which was 557 maids — the qualifier existed only to stop
double-counting maids R3 had already flagged. With R3 gone the qualifier has nothing to point at, so
A1 is now simply **paid above the standard: 657 maids, AED 202,019 a month.** The 100 extra are maids
whose salary sits above the standard and whose history contains something unexplained — **which this
check no longer looks at.** They appear as amber, which is visible-not-recoverable, and nothing
investigates why they are high.

---

> **On the metric numbering.** The IDs run M1a, M1b, M2, M3, M6–M10; **M4 and M5 do not exist** and
> the gap is deliberate, not a missing section. Section order is 3A, 3B, 3D, 3C for the same reason —
> the read follows the CC rules it serves.

#### 3B · The raise category list — REBUILT in v5

**Every CC raise lands in exactly one category. A category names the reason we gave her the money.**
It never names the type of ticket the conversation happened in.

Nine categories. Five are assigned by the data. Three are assigned by the agent from what staff
actually wrote. The ninth is the agent naming a reason this list does not have yet.

| # | Category | Assigned by | Evidence it rests on | Aug 2026 |
| --- | --- | --- | --- | --- |
| 1 | **Renewal raise** | data | D7 r-visa issued **6 months before to 60 days after** | 64 · AED 26,650 |
| 2 | **Live-in to live-out** | data | D4 living-arrangement flag changed **within 45 days either way** | 41 · AED 38,850 |
| 3 | **MV to CC** | data | **24 continuous months as CC** since her latest switch into CC, unbroken — see below | **0 · AED 0** |
| 4 | **New joiner salary setting** | data | **0 to 89 days AFTER `NET_HIRED_DATE`** — one-sided, see below | 11 · AED 4,500 |
| 5 | **Retention — we paid her to stay** | data + read | D9 retraction case with an amount, **60 days before to 15 days after**. Carry its `RETRACTION_TYPE` — `Resignation` or `Non-Renewal` — as a column beside it | 2 · AED 1,250 |
| 6 | **Extra pay tied to one client** | **read** (D13 nominates) | D13 action `Maid Incentive Experiment` or `Wants Higher Salary` **within ±90 days**, **or** the thread says money was added because she is going to this family. **The log nominates; only the read assigns — see the trap below** | 14 candidates · AED 7,650 |
| 7 | **Training completed** | data | D13 action `Cook` or `Trainer` **within ±90 days** | 3 · AED 1,800 |
| 8 | **Correcting a salary that was wrong** | read | the thread asks payroll to amend or fix a salary already on file | 2 · AED 900 |
| 9 | **New reason — the agent names it** | read | must quote the words and cite the complaint id | see Example D |

Counts are the exclusive split under the precedence below and sum to **143, AED 84,150 — the whole
month**. **Seven raises reach the read with no data category at all, AED 3,250** — six more than
before, because O1's ruling tightened route 3.

**🔴 Route 3 was wrong and it was clearing raises nothing explains.** The rule the business has is
**a raise per completed 24 continuous months as CC**; the check was testing only *"did an MV→CC
switch ever happen on or before the raise"*. Measured on August: the loose test matched **23 raises
worth AED 9,650**, and **exactly one of them has 24 unbroken months as CC** — average tenure at the
raise date was **7.6 months**. Under the correct rule **category 3 is empty for August** and the
six raises it used to hold go to the read. **Requestor's ruling, 2026-09-10: 24 continuous months
as CC is the rule.**

**Plain terms:** the check was accepting "she switched from MaidVisa to CC at some point" as a reason
for a pay rise. The actual rule is that she earns one after two unbroken years as a CC maid. Almost
nobody who was being cleared had served them.

**The population is M1b's, and the filters are load-bearing**: the salary at her highest `REVISION`
that day, among rows where `BASIC_SALARY_MODIFIED='01'` and `BASIC_SALARY` is above zero. Changing them admits placeholder rows and
zero-to-first-salary events that are not raises: all three mistakes together inflate the month by
**40 increases and AED 43,900** — see O17 and the table in the tie-out.

**Categories 8 and 9 are sized from three cases actually read** (section 5), not from a full run.
Their true size is unknown until the agent's first pass — see O6.

##### Precedence — the stated reason beats the data route

Decide in this order, and stop at the first that holds:

1. **Category 4, new joiner.** A first salary is not a raise, so it is settled before any reason is
   considered. August raises carrying both a recent hire and a training or an incentive are
   new-joiner salary settings; treating them otherwise strips the excuse that keeps them from being
   flagged. **The window is one-sided — 0 to 89 days AFTER the hire date.** An unsigned
   `DATEDIFF(hire, raise) < 90` also matches raises dated *before* the hire date, which silently
   excuses them; on a wider population that mistake alone pulled in 39 pre-hire events.
2. **A reason somebody wrote down, in this order: 8 correcting a wrong salary, then 5 retention,
   then 6 extra pay tied to a client, then 7 training.** 8 leads for the same reason 4 does — it
   says *this is not a raise at all*. No August raise carries two of 5, 6 and 7, so the order costs
   nothing this month; it is stated because step 3's order is, and for the same reason.
3. **The data route, in this order: 1 renewal, then 2 live-in/live-out, then 3 MV to CC.** The order
   is stated because raises matching two routes are common and different orderings give different
   splits; without it two builders ship different numbers.
4. **Category 9** — nothing fits and the agent names it. A raise the read explains **not at all**
   carries **no category** and is the exception row the tie-out describes.

The route is printed beside the category, never instead of it.

**A missing hire date does not silently skip step 1.** `DATEDIFF` against a NULL `NET_HIRED_DATE` is
NULL, which is not true, so the case falls through to step 2 — and if a route then fires it is never
read. **2 of August's 143 raises have no hire date**; they go to the read regardless of what else
matched, as M1b already requires.

**One row per maid, but categories are assigned per raise.** **Four August maids hold two increases**
— 57440, 68446, 113652 and 20059 — which is why 139 maids carry 143 raises. The row shows the
category of the **larger step**, with every step and its category in the drill-down. The tie-out
counts raises; the exception table counts maids; both are stated so they cannot be mistaken for each
other.

Step 2 sitting above step 3 is the whole point of the rebuild. In August, **20 raises carry a
retention buy-back, an incentive or a completed training, and every one of the 20 also matches a
data route.** Under route-first precedence all twenty would have printed *renewal* or *live-out*,
categories 5–7 would be unreachable by construction, and **AED 10,900 a month would carry the wrong
reason.**

**Maid 66916** shows it plainly: 1,000 → 1,150, matching both the living-arrangement and the renewal
route, while the thread reads *"her live-in salary will be AED 1,150 plus the approved AED 200
monthly incentive"*. Two separate pots of money — the 150 step is the re-base, the 200 is
category 6 — and neither route can tell them apart.

##### 🪤 The action log NOMINATES a category. It never assigns one.

**Category 6's data test is a `Maid Incentive Experiment` row near the raise. That test is not
sufficient on its own, and the first case read proved it.** Maid 68012 carries one dated 6 August;
her raise is dated 21 August; and they have nothing to do with each other. Her thread shows a signed
agreement at AED 3,200 that payroll had entered as 3,000, disputed for three weeks and then amended
— **category 8**. The incentive in the log is real and is AED 200 for a car-lift refusal.

So the 14 in the table are **candidates, not assignments**: of the two read so far, one moved out.
**A build that assigns category 6 from D13 alone repeats the exact error this rebuild exists to
delete** — a label sitting near the money is not the reason for the money. The same caution applies
to category 5: D9 nominates, the thread decides.

Category 7 is left as a data assignment because a completed course is a fact about the maid rather
than a claim about this step, but **it too should be revisited after the first full run.**

**Plain terms:** the data can tell you something happened near the raise. Only a person's words tell
you why the raise was given. Where they disagree, believe the words.

**Which raises the agent reads.** Every raise with no data route, **plus every raise carrying
category 5–8 evidence even when a route also fires.** In August that is **20 raises** — the ones carrying category 5, 6 or 7 evidence after
step 1 — on top of R2, the month's single unexplained increase. **22 if the two new-joiner overlaps are sent as
well**, which they are not: step 1 settles them before the read is called.

##### Rules for the list

- **A category is never assigned without evidence.** 1–4 and 7 need the data test to pass; 5, 6 and
  8 need quoted words; 9 needs a proposed name and the quote behind it.
- **A category does not clear a finding on its own.** 1–4 clear by data. For 5–9 the officer still
  decides whether the reason authorises *this amount*; **an approved base is not a final salary** —
  read it as a starting point and build upward. That is the most error-prone line in this check.
- **Category 6 is conditional money.** The note reads *"as long as she is with <client>"*. It is
  supposed to stop when she leaves him, and this check does not yet test whether it did — see O15.
- **Category 8 is not a raise.** It is the system catching up on a salary that was already wrong.
  Counting it as new exposure overstates the finding, which is why it is its own category and not
  folded into anything.
- **Category 9 is the check learning.** New names are reviewed after each run and promoted into 5–8
  if they recur. The list is closed at scoring time and grows between runs. A name that keeps coming
  back is a route the business has that this spec has not written down yet.

##### What v5 retired, and why

Four v4 categories are gone: `Change Maid Salary / Salary raise upon renewal`, `Maid Salary & ATM`,
`Contract amendments` and `Missing Salary Inquiry`. All four were `COMPLAINT_TYPE` values — the name
of the inbox, not the reason. The most common complaint type sitting next to an August raise is
**`Maid related question`, on 104 of the 139 maids**, followed by `Listener Session` (82) and
`Intro Call` (62). None of them can distinguish a renewal from a retention buy-back — and maid
3978's raise sits under a complaint typed `Maid Salary & ATM` whose real reason, in the thread, is a
manager approving a raise for long service.

---

#### 3D · The read — verdicts, and the prompt to send

One agent call per case. Model **`claude-sonnet-5`, temperature 0**, and **the same prompt every
run** — a prompt that drifts between months makes two months of verdicts incomparable.

##### The six verdicts

| Verdict | Meaning | Report result |
| --- | --- | --- |
| `JUSTIFIED` | The text authorises this raise at this amount | Cleared, category recorded |
| `PLAUSIBLE` | The text explains the raise but not the amount | Cleared, flagged for the officer |
| `AMBIGUOUS` | Relevant text, no decidable authorisation | To the officer |
| `NOT_RELATED` | Read all of it; nothing addresses this raise | **Finding — but see below** |
| `UNRESOLVED` | Contradictory, or breaks off unresolved | **Finding — but see below** |
| `NO_TEXT` | No complaint and no note in the window | **Finding — but see below** |

**`NOT_READ` is a run state, not a verdict, and it is not in the prompt's enum above.** It is
assigned by the pipeline — model error, timeout, unparseable output, refusal, budget exhausted, a
`threads_read` short read that was rejected — and it is **counted and displayed apart from
`NOT_RELATED`**. Never collapse the two: a case nobody read must not look like a case that was read
and found wanting. A verifier that drops out quietly never defaults to clean, and the same rule
governs the §3E verifier, which returns verdicts from this list.

**Plain terms:** if the model fell over on a case, the report says nobody read it. It does not say
the case is fine.

**A raise a data route already cleared can never become a finding on the read.** v5 widened the read
to cover raises whose route already explains them — 20 of the 143 in August. If one comes back
`NOT_RELATED`, `UNRESOLVED` or `NO_TEXT`, that means the *nomination* failed, not that the raise is
unexplained: **it falls back to its matched data route** under precedence step 3 and stays cleared,
with the failed nomination recorded on the row. Only a raise with **no route at all** can become a
finding on these three verdicts. Without this, such a case lands in no rule — R2 requires
"no route" — and the CC tie-out cannot close.

**Plain terms:** if the data already explains the raise and the AI can't find a reason in the text,
that means the AI found nothing extra, not that the raise is suspicious. It stays explained.

##### What to assemble per case

**Every complaint in the window, header plus full thread, unfiltered** — 90 days before the raise to
30 days after — and every manager note in the same window. The assembler may order the list however
it likes; **it may not shorten it.**

```json
{
  "maid_id": 3978,
  "cohort": "Filipina, live-in",
  "tenure_days": 1686,
  "raise": { "date": "2024-04-05", "from": 2000, "to": 2700, "step": 700 },
  "routes_matched": [],
  "routes_ruled_out": [
    "no r-visa issued between 2023-10-05 and 2024-06-04",
    "no live-out flag change within 45 days",
    "no MaidVisa to CC switch on or before the raise",
    "no retention case with an amount within 60 days",
    "not within 90 days of hire (1686 days)"
  ],
  "complaints": [
    { "complaint_id": 254580, "type": "Maid Salary & ATM", "opened": "2024-03-25",
      "description": "…", "thread": [ { "at": "2024-03-26", "text": "…" } ] }
  ],
  "manager_notes": [ { "at": "2024-03-28", "action_type": "…", "notes": "…", "by": "…" } ]
}
```

##### The prompt — send verbatim

```
You are auditing one salary raise given to a maids.cc housemaid. Your only job is to
decide whether the text you are given authorises THIS raise, of THIS amount, and to name
the category it belongs to.

You are given: the maid's id and cohort, the raise (date, from, to, step), which arithmetic
routes matched and which were ruled out, every complaint in the window with its full
comment thread, and every manager note in the window.

DECIDE ONLY THIS: does the text authorise a raise of this size, for this maid, around this
date?

Never calculate an entitlement, a ceiling, a route or an amount. Those are computed
already and given to you. If you find yourself doing arithmetic to reach a verdict, stop
and return AMBIGUOUS.

RULES

1. Read everything you are given. Every complaint, every message in every thread, every
   note. Do not stop when you find something that looks like an answer, and do not skip a
   thread because its type looks unrelated.
2. A complaint's TYPE is a place to look, not an authorisation. "Maid Salary & ATM" next
   to a raise means read it, nothing more.
3. AN APPROVED BASE IS NOT A FINAL SALARY. If the text approves a base or a starting
   figure, treat it as a base and expect other authorised steps on top. If the text names
   a final amount, that amount includes the steps it covers. Reading an approved base as a
   final salary is the most common way this audit produces a false finding.
4. Quote the exact words your verdict rests on and give the complaint_id they came from. A
   verdict with no quote is not a verdict. If it came from a manager note, say so.
   REDACT the following inside the quote before you return it, and NOTHING ELSE:
     - a client name -> [client], a maid name -> [maid], a staff name -> [staff]
     - any phone number -> [phone]        - any email address -> [email]
     - any URL -> [link]                  - any conversation id (CH...) -> [conversation]
   Keep every other word exactly as written, INCLUDING typos and misspellings - "pelase"
   stays "pelase". You are redacting identifiers, not tidying prose.
   The quote is displayed on a shared report. A phone number is not a name, and the threads
   are full of both, along with live ERP download links to signed salary documents.
5. Assign exactly one category from the list below, or null. You may return 1, 2, 3 or 4
   ONLY to CONFIRM a route that is already listed in routes_matched — never to invent one
   that is not there. The same applies to 7: return it only if a training record is already
   in routes_matched. NEVER return 4 at all: a first salary is settled from the hire date
   before you are called, and your answer cannot change it. If nothing fits, use 9 and
   propose a short name in the company's own words: the words the staff used, not yours.
   If the text explains nothing, return null.
6. A CATEGORY NAMES THE REASON THE MONEY WAS GIVEN, never the type of ticket the
   conversation sits in. "Maid related question" is not a reason.
7. THE WRITTEN REASON BEATS THE DATA ROUTE. You are told which routes matched as context,
   not as the answer. If the text states a reason in 5 to 8, that is the category even
   when a route also matched — EXCEPT category 4, which is settled from the hire date before
   you are called and which you can never override. When the text states no reason of its own
   but confirms one of the matched routes, return that route's category. When it states
   nothing at all, return category null with the matching verdict.
8. Silence is not authorisation. If the text nowhere addresses this raise, that is
   NOT_RELATED, not AMBIGUOUS.
9. If there is no complaint and no note at all, return NO_TEXT.

CATEGORIES  (1 to 4 and 7 only to CONFIRM what the data already matched; 5, 6, 8, 9 freely;
             or null. 4 you may never return at all - see rule 5.)

1  Renewal raise                    confirm only
2  Live-in to live-out              confirm only
3  MV to CC                         confirm only
4  New joiner salary setting        NEVER return - settled before you are called
5  Retention - we paid her to stay
6  Extra pay tied to one client
7  Training completed
8  Correcting a salary that was wrong - the amount on file was wrong and payroll is
   fixing it, so this is not new money
9  New reason - you name it

VERDICTS

JUSTIFIED   the text authorises this raise at this amount
PLAUSIBLE   the text explains the raise but not the amount
AMBIGUOUS   relevant text, but no decidable authorisation
NOT_RELATED you read all of it and nothing addresses this raise
UNRESOLVED  the text is contradictory or breaks off unresolved
NO_TEXT     no complaint and no note in the window

Return only this JSON, nothing else:

{
  "verdict": "JUSTIFIED | PLAUSIBLE | AMBIGUOUS | NOT_RELATED | UNRESOLVED | NO_TEXT",
  "category_id": 1-9 or null,
  "category_name": "the category, your proposed name if 9, or null",
  "evidence": [
    { "complaint_id": 254580, "source": "thread | description | manager_note",
      "quote": "the exact words, with names, phone numbers, emails, URLs and conversation ids replaced by their [placeholder]" }
  ],
  "amount_authorised": 700,
  "reasoning": "one or two sentences, no more",
  "threads_read": 19
}

category_id is null, and MUST be null, for NOT_RELATED, NO_TEXT and UNRESOLVED - those
three verdicts mean nothing in the text explains this raise, so no category applies. Never
reach for 9 to avoid returning null; 9 is for a reason you FOUND and the list lacks a name
for, not for the absence of one.

amount_authorised: the figure the text actually authorises, or null if the text does not
name one. Do not infer it from the raise you were given.
threads_read: how many complaint threads you read. If this is lower than the number you
were given, your verdict is invalid.
```

##### Two mechanical guardrails

- **`threads_read` is checked against what was supplied**, and the number supplied is what the
  ±90/30 window holds — **for maid 3978 that is 14, not her 96 all-time**. Lower means **rejected
  and re-run**, never accepted as a verdict. A truncated read fails loudly instead of quietly
  clearing a case: her answer sits in the complaint opened eleven days before the raise, not the
  first one in the list, so all 14 had to be read before it surfaced.
- **The agent never sees or returns an entitlement.** Its whole output is a verdict, a category, the
  quoted words and the complaint id. So an agent error can misjudge one case's evidence and **can
  never move a total.**

**Category 9 goes to a review queue.** The verdict still applies immediately; the proposed name is
reviewed after the run and promoted into 5–8 if it recurs. A name that keeps coming back is a route
the business has that this spec has not written down yet.

---

#### 3E · The verifier — a second agent that checks the first — NEW in v5

**One agent reads the complaints and gives a verdict. A second agent checks that verdict against the
same evidence.** Nothing reaches the report on one model's word.

**Plain terms:** one AI reads the case and answers. A second AI marks the first one's homework.

##### Why it exists, stated plainly

The reader can be wrong in ways the arithmetic cannot see, and every one of these has already
happened on this check, by hand, during the build:

| What went wrong | The case |
| --- | --- |
| A quote was cut short, and the cut removed the sentence that argued against the verdict | Maid 68012 — the elided line said a *later* signed document showed AED 2,000 |
| A label near the money was read as the reason for the money | Maid 68012's incentive log, 15 days from a raise it has nothing to do with |
| The reason was real but the list had no name for it | Maid 3978 — a manager's long-service raise |

**These are not hypothetical failure modes borrowed from another check.** They are the three
mistakes made while writing this section's own worked examples.

##### It uses the same six verdicts. There is no second vocabulary.

The verifier returns a verdict from **the same list in 3D** — `JUSTIFIED`, `PLAUSIBLE`, `AMBIGUOUS`,
`NOT_RELATED`, `UNRESOLVED`, `NO_TEXT` — and the same category list from 3B. It does not get its own
labels, its own scale, or a confidence score.

**Why this matters:** the sister check (Travel Assist) invented three labels of its own, so the two
checks cannot be read side by side or counted together. One vocabulary across both was the
requestor's call, 2026-09-10.

##### The six checks it runs

Each one exists because it catches a mistake actually made here:

| # | Check | Fails when |
| --- | --- | --- |
| V1 | **Does the quote exist?** | The quoted words do not appear verbatim in the evidence bundle |
| V2 | **Is the quote complete?** | The source comment contains material the quote omits **that cuts against the verdict** |
| V3 | **Does the quote support THIS category?** | It proves a related record exists but not that it caused *this* step |
| V4 | **Does it authorise THIS amount?** | Verdict is `JUSTIFIED` but the text names no amount, or a different one |
| V5 | **Is it redacted?** | The quote still carries a name, phone number, email, URL or conversation id |
| V6 | **Was everything read?** | `threads_read` is below the number supplied |

**V2 is the one that earns the section.** A quote can be individually true and still mislead by
omission — that is exactly what happened on maid 68012, and no arithmetic check can see it.

##### How disagreement is handled

**The verifier never overwrites the reader.** When the two disagree the case goes to the officer with
both verdicts shown and the failed check named. It is never auto-resolved and a majority is never
taken — two models agreeing is not evidence, they share the same blind spots.

```
reader and verifier agree        -> the verdict stands, both recorded
they disagree                    -> OFFICER REVIEW, both verdicts and the failed check on the row
V1, V5 or V6 fails               -> REJECTED and re-run; never shown, never counted
```

**V1, V5 and V6 are mechanical, not judgement.** A quote that is not in the evidence, a name left in,
or a short read are build failures — the case is re-run, not escalated.

##### The rules it runs under

- **The verifier gets no ERP access.** It sees the same fixed evidence bundle the reader saw, and
  nothing else. An agent with live ERP access has unbounded call volume, and **this account was
  disabled once, in June 2026, for exactly that.**
- **It forms its own verdict before it is shown the reader's.** Shown the answer first, a model
  agrees with it — that is not a check, it is a rubber stamp.
- **Same model, `claude-sonnet-5`, temperature 0, and the same prompt every run.** An audit whose
  answers change between identical runs is not defensible.
- **It never sees an entitlement, a route total or a money figure.** Its whole output is a verdict, a
  category, the checks that failed and one line of reasoning, so a verifier error can misjudge one
  case and **never move a total.**
- **It is not the redaction gate.** V5 catches a leaked name, but it is a model checking a model —
  the deterministic scrub in O19 is still required and the verifier does not replace it.

##### What it publishes

**The disagreement rate is a report metric, not an internal detail.** If reader and verifier disagree
often, the prompt is wrong — not the cases. A rate that climbs between months is the earliest signal
this check has that its own reading has drifted.

| Counter | Meaning |
| --- | --- |
| Cases verified | Should equal cases read |
| **Agreement rate** | Reader and verifier reached the same verdict |
| Disagreements to officer review | Each one carries both verdicts and the failed check |
| V2 failures (incomplete quote) | The elision counter — watch this one |
| Rejected and re-run (V1 / V5 / V6) | Build health, not audit findings |

**No baseline exists yet** — the verifier has not run. Its first month's agreement rate is the
number to establish, and anything near 100% means it is rubber-stamping rather than checking.

---

#### 3C · The MV rules — NEW in v4

##### M8 — The client's worker salary for the audited month

Two steps, and both are point-in-time. Getting either wrong is the difference between a real finding
and a fabricated one.

**Step 1 — which contract.** From D15, the contract **in force during the audited month**:
`CONTRACT_TYPE='MV'`, `START_OF_CONTRACT <` the first day of the following month, and
`END_OF_CONTRACT` either NULL or on/after the first day of the audited month. Where a maid has more
than one, take the latest by `START_OF_CONTRACT`.

**Step 2 — what the worker salary was on that contract, then.** From D18, her contract's **latest
revision where `WORKER_SALARY_MODIFIED = TRUE` and `MODIFICATION_DATE` is before the first day of the
following month**, taking `WORKER_SALARY` from that row. Break ties on `CONTRACT_REVISION` descending.

```
worker_salary_as_of_month =
  the WORKER_SALARY on the last CONTRACTS_HISTORY revision for that contract
  where WORKER_SALARY_MODIFIED = TRUE
    and WORKER_SALARY IS NOT NULL          <-- skip blanks, see below
    and MODIFICATION_DATE < first day of next month
```

**🔴 `WORKER_SALARY IS NOT NULL` is load-bearing, and leaving it out is the most expensive single
omission available on this side.** A revision can carry `WORKER_SALARY_MODIFIED = TRUE` and a blank
salary. **Contract 1006804 — maid 17342, the spec's only MV finding — reads 1,000 on 2020-09-26 and
then blank on 2020-10-13.** Without the NULL skip a build takes the blank as her agreed salary,
cannot compare her, drops her into the grey bucket, and **reports zero MV findings for the month —
while the pre-gate mismatch count still looks right, because another maid silently fills her slot.**
Five contracts have this shape. **Requestor's ruling, 2026-09-10: a blank is a bookkeeping artefact,
not an agreed salary of zero — skip it and use the last real figure.**

**Plain terms:** if the newest entry is empty, look back to the last one that had a number in it.

**Never `CONTRACTS.WORKER_SALARY`.** That column holds **today's** value. Comparing it against a past
payroll month reads a later change back into an earlier month and manufactures findings that never
existed. Measured on August 2026:

| Basis (mismatches **before** the M10 persistence gate) | We-pay-more | Exposure | We-pay-less |
| --- | --- | --- | --- |
| `CONTRACTS.WORKER_SALARY` (current state) | 4 maids | AED 1,800 | 6 maids |
| **D18 as of the month (correct)** | **4 maids** | **AED 1,392** | **1 maid** |

The two sets barely overlap. Maid 70071 showed as **AED 1,000/month over 23 months — AED 23,000** on
the current field; her worker salary was in fact **3,000 throughout**, matching her payroll exactly,
and only dropped to 2,000 on 2026-09-01. Maid 43677 showed AED 150 over 25 months; hers was **1,150
throughout**, also an exact match. **Both were entirely artefacts of the wrong clock**, and five of
the six we-pay-less cases were too. Meanwhile the correct basis surfaced maid 17342, whom the stale
field had hidden.

**Compare raw.** Do not adjust for VAT — see the trap in 2.3.

**On the CPT.** The requestor's ruling is to audit the **agreed terms**, not the billed amount. The
CPT's own salary field is not in Snowflake (O14), so D18 is the agreed figure and D16 is the timing
evidence beside it. Where the two disagree, D16's `CREATION_DATE` is what to show the reader — on
both hand-checked cases the CPT was recreated on the same day the worker salary moved.

##### M9 — Salary mismatch

`M1a − M8`. Two decimals. **Tolerance AED 0.50 absolute, never a percentage.**

- `M9 > 0` — **we pay her more than the agreed worker salary.** Money out every payroll run.
- `M9 < 0` — we pay her less. Not our loss, but the two numbers disagree and one of them is wrong.

##### M10 — The persistence gate

**A mismatch is a finding only if it appears in the same direction in two consecutive payroll
months.** A mismatch seen for the first time is **HELD**, not flagged.

**Why: 88% of MV contracts are pre-collected** — 19,747 of the 22,451 with a contract in force — and
on a pre-collected contract payroll runs a month behind the money. So **every legitimate change to an
agreed salary produces a one-cycle mismatch**, and the check would raise a fresh false finding on
every renewal. In the requestor's own words, relayed from Anthony Kosseifi (MV, 2026-09-09):

> *"This client is a pre-collected client. This means that the salary we paid the maid is always one
> month back… This change happened on contract renewal."*

**Measured on August 2026, under the M8 null rule and the mid-month hold. Six mismatches; one
persists.**

**Two corrections to an earlier draft of this table, both found by the gate and confirmed live.**
It claimed the held cases "have no prior-month payroll row at all" — **124413 has one (AED 1,700 in
July) and 99039 has one (AED 1,330)**. What they lack is a July *agreed salary*, so July's comparison
is undefined rather than absent. And **maid 34661 was missing from the table entirely**: with a
client, ACTIVE contract, paid AED 1,452 against an agreed AED 1,000. Her agreed figure was set on
**31 August** and compared against a whole month's pay, which is the whole reason R9 exists.

| Maid | Direction | Gap | Why not a finding | Verdict |
| --- | --- | --- | --- | --- |
| 17342 | over | +500 | over in July too | **Finding — the only one** |
| 34661 | over | +452 | agreed salary set 31 Aug | Held (R9) |
| 138580 | over | +350 | no July agreed salary | Held (R7) |
| 124413 | over | +300 | agreed salary set 1 Aug | Held (R9) |
| 99039 | over | +242 | agreed salary set 28 Aug | Held (R9) |
| 137946 | under | −300 | no July row | Held |

**37 pre-collected contracts had their agreed salary change between July and August alone** — roughly
440 a year of transition noise this gate suppresses.

**No threshold, deliberately.** A "salary settled for 60+ days" version was measured and rejected: it
produced the same single finding, but the cut-off sat two days from flipping cases either way (one
held case at 55 days, one at 62). Persistence needs no constant, so there is no constant to argue
about or to go stale. Requestor's ruling, 2026-09-09.

**Two consequences to state plainly.** A brand-new contract cannot produce a finding in its first
month — that is intended, because in month one the lag is indistinguishable from a leak. And a
mismatch that appears and disappears is never reported, which is correct: it was a transition, and
nothing was lost.

**The mirror case.** When an agreed salary rises at renewal, the lagging payroll makes us look like we
are *underpaying* — a false `M9 < 0`. The gate catches both directions, which is why it is defined on
direction rather than on sign.

##### The MV rules

| Rule | Flag | Test | Aug 2026 |
| --- | --- | --- | --- |
| **R4** | Red | `M9 > 0` **and it persisted from the prior month** (M10) | **1 maid, AED 500/mo** |
| **R5** | Amber | `M9 < 0` **and it persisted from the prior month** (M10) | **0 maids** |
| **R7** | Held | A mismatch in either direction seen for the first time — a pre-collected transition until the next month proves otherwise | **2 maids** |
| **R9** | Held | **The agreed salary changed inside the audited month**, so a full month's pay is being compared against a figure that was only agreed part-way through it | **3 maids** |
| **R6** | Grey | **She is WITH A CLIENT, we paid her, and no contract covers the month.** Her last contract lapsed and nothing replaced it | **60 maids, AED 75,350/mo** |
| **R8** | Held | With a client, last contract lapsed, **but a new contract starts after the month** — a renewal in flight, not a leak. Max gap 14 days | **148 maids** |
| **OOS** | — | Paid, no contract in force, and **not with a client** — terminated, visa unsuccessful, rejected, in exit, no-show. **Out of scope by the requestor's ruling, 2026-09-10** | **1,786 maids, AED 2,621,695/mo** |
| **DQ** | Grey | Paid nothing, or a NULL salary — a data-quality row, never Clear | **617 maids** |

**22,369 of 22,374 comparable maids agree to the dirham — 99.98%.** The ERP keeps the two numbers in
lockstep, so this rule's value is the five that drift plus the tenth of the population it cannot see.

**R6 is the biggest number on the MV side and it is not a finding — it is the check's blind spot.**
**R6 is scoped to maids who are with a client.** 60 maids were paid in August while marked
`WITH_CLIENT` with no contract covering the month — she is in a client's home, we are paying her, and
nothing is billing him. Average lapse **59 days**, longest **810 days**.

**MV coverage is 89.6% of everyone paid, and 96.4% of the maids in scope** — both go on the report.
The gap between the two figures is the 1,786 out-of-scope maids; showing only the higher number would
hide them.

**A cancelled contract we still paid against is its own signal.** Three of August's five mismatches
sit on a `CANCELLED` contract. Carry `CONTRACT_STATUS` as a column — and see O13.

**Tie-out rule.** CC: `DQ + R1 + R2 + A1 + Clear = distinct CC maids paid` — for 2026-08,
**DQ 9 + R1 8 + R2 7 + A1 657 + Clear 5,226 = 5,907 ✓ variance 0** — **this identity is PRE-READ**.
CC unauthorised money pre-read: **2,150 + 3,250 = AED 5,400/month**, being R1's renewal-cap excess
plus the seven unexplained August increases that route 3 no longer clears.

**Where a maid sits in both R1 and A1, precedence gives her to R1**, so A1's published count is 657
less any overlap; Clear absorbs the remainder and the identity holds either way. The build states the
overlap on its first run.

**A1 is not recoverable money and is never added to the finding total.** It is a visibility layer —
657 maids paid above their group's standard, AED 202,019 a month — and mixing it into exposure would
overstate the check by 70×.

**Post-read the numbers move, and a build must publish both identities.** Maid 17250 is category 8
and clears, so:

```
post-read   DQ 9 + R1 8 + R2 ? + A1 657 + Clear ? = 5,907   variance 0
post-read   CC unauthorised = 2,150 + (whatever survives the read)
```

**Only one of the seven has been read.** Maid 17250 turned out to be payroll correcting a salary that
was wrong — category 8, exposure zero. **The other six have not been read**, so the post-read CC
figure is not yet known and the spec does not state one. On the single case that has been read the
read removed the exposure entirely, so **2,150 is the floor and 5,400 the ceiling.**

MV: `R4 + R5 + R7 + R9 + matched + R6 + R8 + OOS + DQ = distinct MV maids paid`, with precedence
DQ → OOS → R8 → R6 → R9 → R4 → R5 → R7 → matched so no maid is counted twice — for 2026-08,
**1 + 0 + 2 + 3 + 22,376 + 60 + 148 + 1,786 + 617 = 24,993 ✓ variance 0.**

**The old M8-null bucket is gone because the null rule dissolved it** — all five contracts now resolve
to their last real agreed figure, and none is left uncomparable.

**A second identity for the gate.** Mismatches found before the gate must equal findings plus held:
**6 = 1 + 5** (R7 2 + R9 3). A build reporting more than one MV finding for August has not applied
M10, and a build reporting five mismatches instead of six has dropped maid 34661.

Every CC raise must also carry exactly one category from 3B; **a raise with no category is itself an
exception row.** For 2026-08 the split is `64 + 41 + 6 + 11 + 2 + 14 + 3 + 2 = 143`, and the money
ties out the same way: `26,650 + 38,850 + 2,550 + 4,500 + 1,250 + 7,650 + 1,800 + 900 = AED 84,150`
— **variance zero on both**. Before the read, one raise (maid 17250) carries no data category; the
read puts it in 8, so post-read every raise carries one.

**Two rejection tests on this identity.** A build whose categories 5, 6 and 7 come back empty has
applied route-first precedence — those three are reachable only because the written reason wins. A
build reporting more than 143 increases, or a total above AED 84,150, has changed M1b's population
rule. **No single change is the culprit — measured separately, on the 5,907-maid population:**

| What was changed | Increases | AED |
| --- | --- | --- |
| **M1b as written** | **143** | **84,150** |
| Drop `BASIC_SALARY > 0` only | 144 | 86,150 |
| Drop `BASIC_SALARY_MODIFIED='01'` only | 143 | 83,850 (**lower**) |
| `MAX` per day instead of highest `REVISION` | 144 | 85,350 |
| All three together | 183 | 128,050 |

**No single change causes the inflation — it takes all three.** A build that is out by one or two has
made one of the first three mistakes; a build that is out by forty has made all of them.

##### M6 — Report integrity counters

On the tie-out line, not buried. **Each is a group whose verdict is weaker than the rest.**

| Counter | Aug 2026 |
| --- | --- |
| **CC coverage** — maids whose excess this check can see | **71.6%** |
| **MV coverage** — maids with a contract to compare against | **89.6%** of all paid · **96.4%** of those in scope |
| CC paid below their own basic salary, excess hidden | 1,677 |
| MV with a client and no contract in force (R6) | **60** |
| MV held — replacement contract starts after the month (R8) | **148** |
| MV out of scope — paid, no contract, not with a client | **1,786** |
| MV agreed salary blank on the latest revision — resolved by M8's null rule | **5** |
| MV held — agreed salary changed inside the month (R9) | **3** |
| Starting-salary fallbacks used | 0 |
| No hire date — read, not excused | 216 |
| Duplicate payroll rows — CC | **22 maids / 66 rows / 15 with differing amounts** |
| Duplicate payroll rows — MV | **7 maids / 14 rows / 1 differing** — M1a's MAX applies on both sides |
| Salary paid NULL or zero | 2 and 7 CC · 617 MV |
| Live-out flag changed inside the month | **90** (113 maids carry the flag; on 23 the value did not move) |
| Raises landing in category 9 | to be counted on the first agent run |
| **Raises where the written reason overruled the data route** | **20 of 143 — AED 10,900/month** |
| **Category 6 candidates confirmed by the read** | 1 of 2 read moved out — see the trap in 3B |
| **Reader/verifier agreement rate** (3E) | no baseline — the verifier has not run |
| **Disagreements sent to officer review** | no baseline |
| **V2 failures — quote incomplete** | no baseline; the elision counter |
| Verdicts rejected and re-run (V1 / V5 / V6) | no baseline; build health, not findings |

##### M7 — Same-day group (CC)

CC increases sharing a date and the same before-and-after salary are **one case**. Eight maids moved
1,750 → 2,000 on 2026-08-31. Shown separately, one event becomes eight rows and eight identical reads.

---

#### 4. Finalised UI Report

**Mockup:** https://claude.ai/code/artifact/a314b186-4e25-481b-9f80-35c4587404ce

**The report is deliberately short. Build only what is listed here.** It was cut back twice at the
requestor's instruction — the earlier drafts carried the check's reasoning on the page, and a
dashboard is worked, not read. **Anything explaining *why* a rule exists belongs in this spec, not on
the screen.**

**Layout, top to bottom.** Five KPI tiles → the nine reasons and their counts → the CC exception
table → the MV exception table → one tie-out line → one sources line. **No chart, no rule cards, no
worked-example panels, no verifier panel.** Each of those was on a draft and each was removed.

**KPI tiles — five, and no more.** Raises audited this month (143, AED 84,150) · CC unauthorised this
month (R1 + R2) · CC above the standard (A1) · MV we pay more than the client (R4) · **coverage, CC
and MV**. **The headline is deliberately small now** — AED 2,150 a month recoverable on the CC side,
because the check looks only at the audited month. A tile carrying the old back-catalogue figure
would promise money this scope cannot find.
Coverage stays because 71.6% and 89.5% mean a share of both populations cannot be judged, and a
report that hides that is worse than one that admits it.

**The nine reasons.** One compact table: number · reason · assigned by (data / data + AI / AI) ·
raises · AED per month. This is the subject of the check, so it stays on the page. **One sentence
above it** carries the precedence — the text beats the data route, new joiner is settled first — and
the August consequence: 20 raises, AED 10,900 a month.

**Columns — CC.** Flag · Maid (linked) · Group · Rule · Reason · **What the read found** (the
verdict's own quoted words plus a complaint link, in one cell) · Paid · Entitled · At risk/month.
*Dropped from the draft: Status, Tenure, Granted by, and the salary-history ladder — all available in
the drill-down, none needed to decide whether to open a case.*

**Columns — MV.** Flag · Maid (linked) · Contract (linked) · Contract status · Agreed set on · We pay
her (M1a) · Client agreed (M8) · **Gap (M9)** · Note. Default sort: gap descending, we-pay-more
first. *Dropped: Nationality and CPT type.*

**Rule codes get a one-line legend under the table, not a card each.** `R1 R2 A1 M7` on the CC
side, and the MV rules explained in the one sentence above that table.

**Tie-out — one line, four identities.** CC buckets = 5,907 · MV buckets = 24,993 · the nine reasons
= 143 raises and AED 84,150 · coverage. The integrity counters in M6 move to the export and the
drill-down; they are build health, not case work.

**Links.** Maid `https://erp.maids.cc/housemaid/details/{id}` · complaint
`https://erp.maids.cc/post-sale-services/open-todo/{id}`. Both confirmed live. Every read verdict
links **the** complaint its quoted words came from, not the maid's complaint list.

**Filters.** Payroll month (default last locked) · Maid type (default CC) · Flag · Reason · Status
(default **all** — a column, not a gate) · Reviewed (default unreviewed only). **Export CSV** of
row-level detail, because P&C works cases one at a time.

**Drill-down carries everything the page dropped.** CC: her whole salary history — every daily
figure, step, route, reason and granting user — beside the complete complaint and note timeline the
read consumed, **and both agents' verdicts with the verifier's failed checks named**. MV: the
contract, its CPT rows, and the payment log lines that billed the client.

**Conditional formatting.** The rule drives the row's coloured edge; every flag carries a text label
and an icon so the row survives printing and colour-vision deficiency.

**Personal data.** No maid names, contact details, bank or WPS data. No client names, phone numbers
or email addresses — `CONTRACTS` carries them and they are never selected. Maid id, contract id,
group, status and amounts only. **Staff names are in scope** on the CC side, because the action on a
red row is to identify who granted the raise. That asymmetry is deliberate.

**The evidence quotes are the live risk here, not the columns.** Manager notes and complaint threads
are full of names and more: complaint 256213 — inside maid 3978's own evidence packet — repeats a
client phone number four times, and complaint 754697 repeats a maid's number five times **and carries
live `erpbackendpro.maids.cc/public/download/...` links to her signed salary documents**. **Every
quote is redacted before it is stored — names, phone numbers, emails, URLs and conversation ids — and
the display shows the redacted text only** (3D rule 4). A build that renders the raw quote breaches
this section. O19 is the deterministic second gate this still needs.

---

#### 5. Worked Examples

Real cases, measured live for payroll month 2026-08.

##### Example A — CC, new joiners, and why the 90-day rule carries the check (excused, category 4)

Nine maids, every one hired 14 to 47 days before the change: 136180 (14 days), 138615
(19), 135552 (21), 138064 (24), 138906 (25), 135706 (26), 136076 (42), 136337 (46) all moved
1,750 → 2,000 on 2026-08-31; 135553 (47 days) moved 2,500 → 3,000 on 2026-08-03. **Category 4, New
joiner salary setting.** The step counts toward entitlement and is never flagged. The first eight are
one M7 group. The rule carries **11 of the month's 143 increases, AED 4,500**.

**And it is why category 4 is decided first.** Two of these nine — **136337 and 138064** — also
carry a `Cook` training log in the window. Let the written reason win here and they become category
7, which strips the new-joiner excuse and turns onboarding salaries into flaggable raises. A first
salary is not a raise, whatever else happened that month.

##### Example B — CC, the read is mandatory, and it deleted the finding (category 8)

Maid 17250, hired 2019-12-09 (2,436 days), 2,000 → 2,700 on 2026-08-10, step +700. She is **the
month's only raise with no category from the data at all** — no renewal in the window, no live-out
flip, no retention case — and on the arithmetic she is the whole of R2 at AED 700/month.

**She is not a raise.** Her ladder reads 1,500 → 2,350 (2023-10-05) → **2,700 (2025-10-08)** →
2,000 (2026-06-22) → **2,700 (2026-08-10)**. A same-day live-out-then-live-in flip on 22 June
dropped her to 2,000 by mistake; August restored the figure she had held for ten months. The thread
says so outright:

> *"Salary has been updated to 2700 again. On June 22nd she switched to live out and then to live in
> again on the same day. That's what caused the salary issue. You can request the difference"*
> — complaint **752695**, 2026-08-10

A second thread computes the shortfall — *"Correct salary: AED 2493.25. Amount to be added:
632.25"* (complaint **760771**). **Verdict `JUSTIFIED`, category 8, exposure AED 0. R2 for August is
empty.**

**This is the strongest argument for the read in the spec.** The arithmetic was right that nothing
explained the step, and wrong about what that meant.

##### Example C — CC, the case that nearly wasn't (clear, category 1)

Maid 56922, hired 2024-09-04 (723 days), 1,000 → 1,500 on 2026-08-28. **Not one of her three
complaints mentions salary**, so a word-filtered read returns nothing. She is nonetheless **not** a
finding: her renewal visa issued **2026-08-29, one day after** the change. **Category 1, Renewal
raise.** Under a backward-only window she was the spec's flagship unexplained case. Maid 30464
is the same story two days apart.

##### Example C2 — CC, where the route AND the action log were both wrong (category 8)

Maid 68012, Filipina, 3,000 → 3,200 on 2026-08-21. A renewal **route matches** in her window — but a
Filipina renewal raise is **AED 350** and this step is **200**. Her manager log carries
`Maid Incentive Experiment` dated 2026-08-06, note *"as long as she is with [client]"*, which
**nominates category 6**, and under the precedence a nomination outranks a route, so without the read
she would print as 6.

**Both are wrong, and only the thread shows it.** She signed at AED 3,200 on a June live-out switch
and payroll held 3,000; she disputed it for three weeks with the signed document attached:

> *"I have checked this, @[staff]. That is why I am clarifying and have uploaded her PJA showing AED
> 3,200 signed. **She has several PJAs uploaded with different amounts. For your reference, the
> latest PJA was signed on July 31, and it reflects AED 2,000 salary.** We need to double-check and
> be 100% certain before asking @Payroll to amend her salary. FYI, we are reviewing everything
> thoroughly before proceeding with the transfer."* → *"@[staff] Please amend maids salary to AED
> 3200 as per [staff] update below."* → *"Salary has been updated"*
> — complaint **754697**, 2026-08-20 to 08-21. **The amend instruction lands 39 seconds after the
> "be 100% certain" comment.**

**Quote the whole comment, including the sentence in bold.** A draft of this spec elided it and
reached the same verdict without showing the reader that the documents disagree. The elision is the
defect, not the verdict.

**Verdict `JUSTIFIED`, category 8** — the requestor's ruling, 2026-09-10. A named manager gave an
explicit instruction at a named amount and payroll executed it; that is an authorisation of this
raise at this amount, which is exactly what `JUSTIFIED` means. The conflicting July PJA is a
document-hygiene problem on her file, and it belongs on the row as visible evidence rather than as a
reason to withhold a verdict.

**What this case teaches the agent.** Contradictory evidence does not automatically mean
`UNRESOLVED`. `UNRESOLVED` is for a thread that contradicts itself *and never resolves*; this one
resolves, in a named instruction, on a dated line. The rule the agent needs is: **read to the end of
the thread before scoring the contradiction**, and quote the contradiction even when the verdict
survives it.

The incentive in her log is real — AED 200 for a car-lift refusal — and simply is not the money in
this step. **This case is why category 6 is nominated by D13 and assigned only by the read.**

##### Example D — retired with R3, 2026-09-10

**This example demonstrated rule R3, and R3 was deleted** when the requestor scoped the check to
salary increases made in the audited month. It is kept as one paragraph because of what it shows
about the cost of that scope.

Maid 3978, live-in Filipina, paid 2,755 against a 2,700 standard. History: 1,800 · +200 (2021-09-19)
· **+700 (2024-04-05)** · +350 (2025-04-25). The +700 sits 8.3 months from her nearest renewal, no
live-out flip, no retention case — and the read found the reason nothing in the data could:
*"she has a good record with us, she has been with us since 2017, I discussed the raise with
[staff]"*, complaint **254580**. A manager's discretionary long-service raise, category 9.

**Under the current scope that raise is invisible.** It was granted in April 2024, so no monthly run
will ever examine it. She now appears only as one of A1's 657 amber rows, above her standard with no
explanation attached. She was one of **171 such maids, AED 48,103 a month between them.** M2 records
the one-time catch-up run that would close this; it has not been ordered.

##### Example E — CC, the renewal cap counted correctly (R1)

Maid 10907: +650 on 2024-06-20, +150 on 2024-06-27, +350 on 2026-06-06, against issued renewals
2020-07-16, 2022-06-21, 2024-06-20 and 2026-06-06. Counting **events** gives three raises and flags
her red; counting **distinct renewals carrying a raise** gives two, because the +650 and the +150 a
week later attach to the same 2024-06-20 renewal. **She is not a finding.** M2 = 0. Note the +650
against a configured `renewal_raise:350` — a 300 overshoot this spec does not explain, see O5.

##### Example F — MV, the only finding (R4)

| Input | Value |
| --- | --- |
| Maid | 17342, Filipina |
| Contract | 1006804, **ACTIVE**, pre-collected |
| We pay her (M1a) | 1,500 |
| Agreed worker salary (M8) | 1,000, set **2020-09-26** |
| **Gap (M9)** | **+500** |
| Prior month (M10) | **also over — persists** |

Her agreed worker salary has not been touched since **September 2020** and payroll pays her 500 above
it. Two things had to be right to see her: the comparison has to be point-in-time, or the stale
contract field hides her; and the gap has to persist, or she is indistinguishable from four
transitions. **Flag: Red (R4).** The whole of R4 for August.

##### Example F2 — MV, the four held (R7)

138580 (+350), 124413 (+300), 99039 (+242) and 137946 (−300). **Every one has no prior-month payroll
row**, so each is a first-month mismatch on a pre-collected contract and each is **held, not flagged**.

Independently, the complaint read had already explained three of them — 138580 terminated on a
cancelled contract, 124413 known and chased, 99039 cancelled. **The arithmetic gate and the evidence
read agree on which cases to drop**, which is the strongest signal available that the gate is set
right.

##### Example G — MV, the trap this rule exists to avoid

| Input | Value |
| --- | --- |
| Maid | 70071, Kenyan, contract 1051156 |
| `CONTRACTS.WORKER_SALARY` **today** | 2,000 |
| Agreed worker salary **as of August** (D18) | **3,000**, set 2024-09-03 |
| We paid her in August | 3,000 |
| **Verdict** | **No finding. Gap AED 0.** |

Read against the current field she is the single largest MV case in the report: AED 1,000 a month for
23 months, **AED 23,000**. Read as of the month she matches to the dirham, because her worker salary
was 3,000 for the whole period and only changed to **2,000 on 2026-09-01** — a change `CONTRACTS_HISTORY`
attributes by name and date, and which a new CPT on the same day corroborates.

**She becomes a September finding, not an August one.** Maid 43677 is the same shape: 1,150 agreed and
1,150 paid for 25 months, changed to 1,000 on 2026-09-02. This example is in the spec because it is
the most expensive mistake available on the MV side and it is invisible without the history table.

##### Example H — MV, the blind spot (R6)

**60 maids** were paid in August while marked `WITH_CLIENT` with no contract covering the month. She
is in a client's home, we are paying her AED 1,256 a month on average, and no contract is billing
him for it. Average lapse **59 days**; the longest has run **810 days**. **AED 75,350 a month.**

A further **148** are the same shape with a replacement contract already starting after the month —
a renewal in flight, held rather than flagged, on the same logic as R7. And **617** were paid nothing
or a NULL amount. Nothing can be compared for any of these, so they are **grey, and counted**, never
silently dropped. R6 alone
is 400 times the size of the money R4 finds. **The blind spot is the story on the MV side, not the
four reds.**

##### Example I — CC, edge case, part-month

A maid paid AED 1,962 against a 2,000 entitlement. Paid is below entitled, so **no finding** — but the
proration basis is unknown, so her excess if any is hidden. One of the 1,677 in M6's coverage counter.

---

#### 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | **CLOSED 2026-09-10 — the rule is 24 continuous months as CC (Abdullah Mahdi).** Built and measured. From `HOUSEMAID_TYPE_LOGS`, take her latest `TO_TYPE LIKE 'CC%'` entry on or before the raise, require no `TO_TYPE='MV'` after it, and require 24 months elapsed. **The loose test it replaces matched 23 August raises worth AED 9,650; exactly one passes the real rule**, average tenure 7.6 months. Category 3 is empty for August and six raises moved to the read | Closed | No |
| O2 | **ANSWERED and SCOPED, 2026-09-10.** The blind spot was never a missing salary field — it was maids with **no contract at all**. Measured: 1,994 MV maids were paid in August with no contract in force, AED 2,697,045 that month. By status: visa unsuccessful 639 · terminated 829 · rejected 189 · with a client 208 · discipline, exit and no-show 94. **The requestor's ruling: only the WITH-A-CLIENT cases are this check's business** — she is in a client's home and nothing is billing him. That is R6, now **60 maids at AED 75,350/mo**, plus 148 held under R8. The other 1,786 become the OOS bucket: counted on the tie-out, never scored | Closed | No |
| **O20** | **Referred out, not audited here — 828 maids paid long after their contract ended.** Measured while answering O2 and recorded because it is money, not because this check covers it. Maids marked **visa unsuccessful (639)** and **rejected (189)** have been paid for an average of **36.1** and **21.5 months** past their last contract's end, longest **68 months**; 715 of the 828 for six months or more. **AED 33,733,598 to date and AED 1,063,646 a month still running.** The control that makes it a finding rather than a policy: **terminated maids in the same table stop at 1.4 months**, so payroll can stop and does not for these two statuses. Zero of the 828 hold any other contract in force, and only 35 carry `EXCLUDED_FROM_PAYROLL`. **Not verified by reading cases** — pure warehouse arithmetic, and `TOTAL_SALARY` is what payroll releases, not a traced bank transfer. Needs an owner outside this spec | Abdullah Mahdi | No |
| O14 | **The CPT's own salary field is not in Snowflake.** The requestor's ruling is to audit the agreed terms, and staff refer to *"the CPT with the salary 1,150"*, so the figure exists in the ERP — but `CONTRACTS_PAYMENTS_TERMS` carries only `WEEKLY_AMOUNT`, `VISA_FEES` and `ADDITIONAL_DISCOUNT`, and `PAYMENT_TERM_CONFIG_FORMS` is metadata with no amounts. D18 is used as the agreed figure instead and agrees with the CPT's timing on every hand-checked case. **Ingesting the CPT salary would let the rule read the agreement directly rather than inferring it from the contract's revision history** | Snowflake team + ERP team | No |
| O3 | **143 CC increases against KPI 3.4c's 163 for 2026-08** (3.4c excluding its `'Total salary raises'` row; the same figure is its own total). 3.4c applies a `fill_information_completed` gate inside its model SQL that is not exposed in `BA_VIEWS`, and its fifth reason **"Other" carries 29 of the 163** with no counterpart among the four routes. v5's categories 5–9 exist precisely to give "Other" a name; **the first agent run is the test of whether they do.** **The gap is 20 rows and AED 33,950** — 163 / AED 118,100 against 143 / AED 84,150, which is 40% of §3B's total, so reconciling row counts alone will not close it. Needed for the O18 catalogue submission | Snowflake team + Payroll | **Yes** |
| O4 | ~~Does the CPT change the MV comparison?~~ **Resolved 2026-09-09.** The CPT carries the fee structure, not the salary — its config names read *"8.5k + 250/month"*. The comparison is on D18, the agreed worker salary as of the month, which matches payroll on 22,369 of 22,374 maids (99.98%). What remains is O14, ingesting the CPT's salary field so the rule reads the agreement directly | Closed | No |
| O5 | Filipina carries `max_renewal_raise:400` alongside `renewal_raise:350`, and real renewal raises exceed both — maid 10907's +650, maid 11964's +625. An absolute cap was ruled out of scope because it collides with the live-out re-base, where 2,000 → 3,200 is a 1,200 step by design | Abdullah Mahdi | No |
| O6 | **Categories 8 and 9 are sized from three cases, not a run.** The data assigns 142 of August's 143 increases; 8 and 9 are assigned only by the read. Three cases have been read by hand (section 5) and produced **two category 8 and one category 9**, which is why both now carry figures — but 140 raises have not been read. The counts in 3B for categories 8 and 9, and the confirmed share of category 6's 14 candidates, are all **provisional until the first agent run** | Abdullah Mahdi | No |
| **O15** | **Category 6 is conditional money and nothing tests the condition.** The `Maid Incentive Experiment` note reads *"as long as she is with <client name>"* — **14 August raises, AED 7,650/month** after the read moved 68012 out (15 · AED 7,850 before it), and 3,761 rows all-time. The check names the category but never asks whether she is still with that client or whether the incentive stopped when she left. **That test is where the money in this category actually is.** **RULED 2026-09-10 (Abdullah Mahdi): build it.** It does NOT need the client's name parsed out of the note text — compare **the contract she was on at the incentive date against the contract she is on now**, both from `SALES_SILVER.CONTRACTS`. Measured across the 818 maids carrying an incentive action in the window: **456 had a contract at the time, 214 now have no contract at all, and 18 are with a different client** — 232 cases where *"as long as she is with [client]"* is no longer true while the money may still be running | Snowflake team — build it | No |
| **O16** | **The retraction table under-records, so category 5 reads as 2 when the threads say more.** `RETRACTION_CASES_TOOL_CALLS` tags only 2 of August's 143 increases, yet complaint threads on the same population carry explicit buy-backs — *"Retracted the maid by giving her 200 AED incentive so her next salary will be 2200 AED"*, *"agreed with a salary raise of 350 AED"*. Either the retraction tool is not being used for these or it is not writing `RAISE_GIVEN`. **This is a control weakness in its own right, not a defect in this spec** — the read still catches the cases — but category 5's count cannot be trusted as a measure of retention spend until it is resolved | Abdullah Mahdi + Payroll | No |
| **O17** | **RESOLVED — the population rule is M1b's, and both of its filters are load-bearing.** An earlier v5 draft measured section 3B with `MAX(BASIC_SALARY)` per day and neither filter, reported **184** increases / AED 129,000, and recorded that v4's 143 "could not be reproduced". That was wrong: **M1b as written reproduces 143 / AED 84,150 exactly**, and that population is the one that makes R2 = 1 raise at AED 700 and Example B the same case. Kept here as a build warning, because both filters fail silently: dropping `BASIC_SALARY > 0` admits **37 zero-to-first-salary placeholder events worth AED 42,550** that are not raises, and taking `MAX` per day instead of the value at the highest `REVISION` picks up superseded rows. Together they inflated the month by 41 increases and AED 44,850 | Closed | No |
| O7 | The part-month proration basis is unknown, so 1,677 CC maids' excesses are hidden and CC coverage is 71.6% | Snowflake team | No |
| O8 | The Ethiopian live-in standard is the config's **1,150**, replacing an earlier ruling of 1,500 — the largest driver of the amber layer. **589** Kenyan live-in maids sit *below* the same 1,150, which is why 1,150 is a group standard and never a per-maid entitlement | Abdullah Mahdi | No |
| O9 | Nationality as of the change date should be built from `NATIONALITY_ID` (99.7% populated). Needs a nationality-id lookup confirmed | Snowflake team | No |
| O10 | D14's display-name column in `CORE_SILVER.USERS_INFO` needs confirming. The id join is verified at 22 of 22 | Snowflake team | No |
| O11 | D5's config is a single `TAG_NAME` **string** shaped `maidsAtSalaryConfig:{…}` — no VARIANT column, so the prefix must be stripped before `TRY_PARSE_JSON`. The same item carries loose tags (`filipinoSalary:2000`, `africanSalary:1000`) one of which disagrees with the config. **The config tag wins** | Snowflake team | No |
| O12 | **Judgement call.** The worked examples print an individual maid's salary history against her ERP id, and the MV ones print a client's contracted worker salary. Section 4 restricts the report to ids and amounts with no names or contact details, which is right for a payroll audit tool — but this spec circulates further than the dashboard does. **RULED 2026-09-10 by Abdullah Mahdi: ship it open and flagged.** The report and the worked examples keep real maid ids against individual salaries, because the action on a red row is to open that maid's file. **No named pre-approval has been obtained, and company policy asks for one from Chady for a named purpose — a ruling by the requestor is not that approval.** This is a knowingly accepted risk, recorded here so whoever receives the spec sees it rather than discovers it | Abdullah Mahdi | No — accepted |
| O13 | **RULED 2026-09-10 (Abdullah Mahdi): paying payroll on a cancelled contract is a finding UNLESS a payment was received for that month.** Measured for August: all three cancelled-contract cases — **138580, 99039 and 137946 — have zero payment-log rows for the month**, so all three are findings, not noise. By contrast the maids with billing activity (17342 one row, 34661 two, 124413 three hundred and sixty-three) are already handled by the gap comparison. **⚠ One honest gap in this measurement: `PAYMENTS_LOGS` records what reached an invoice, i.e. what was BILLED, not what was RECEIVED.** Confirming receipt needs the transactions side and has not been done, so the rule is implemented on billing until someone wires the receipt test | Abdullah Mahdi | No |
| **O18** | **An approved KPI already publishes this breakdown, and 3B rebuilds it by hand.** `BI_PAYROLL_CC_MAID_SALARY_RAISES_BY_REASON` (KPI 3.4c, DNA-6364) is an approved definition whose reasons map one-to-one onto categories **1, 2, 3 and 5**, and org policy is to reuse an approved definition's exact logic rather than reconstruct it. Its 2026-08 CC figures are Renewal 35 · Live-in to live-out 80 · MV to CC 18 · Resignation 1 · Other 29, against 3B's 64 / 41 / 6 / 2 — divergences of up to 2×, unreconciled. **RULED 2026-09-10 by Abdullah Mahdi: register §3B as a NEW approved Police & Control definition in the Data Catalog.** 3.4c is not reused, because its `fill_information_completed` gate lives inside model SQL that `BA_VIEWS` does not expose, which would make part of the split unauditable from here. Until the catalogue entry lands, **3.4c is a control total only and the two are never added together**. The gap that remains to be explained in the catalogue submission is **20 rows and AED 33,950** — 3.4c's 163 / AED 118,100 against §3B's 143 / AED 84,150, i.e. 40% of §3B's own total | Snowflake team (submit) | No |
| **O19** | **The evidence quotes are where personal data reaches the report.** 3D orders the agent to quote verbatim and §4 forbids client names; manager notes carry them outright. v5 makes the agent redact **names, phone numbers, email addresses, URLs and conversation ids** before the quote is stored (3D rule 4) — the list is wider than names because the threads carry more than names: complaint 256213 repeats a client phone number four times and complaint 754697 carries live ERP download links to signed salary documents. **The residual risk is that the redaction is performed by the same model whose output it constrains** — a miss is invisible until someone reads the report. **A deterministic regex scrub over the stored quote — phone shapes, email shapes, `http(s)://`, `CH[0-9a-f]{32}` — plus a lookup against the client and staff names already in the ERP, is the second gate and should be built.** The model pass alone is not sufficient for a shared report | Snowflake team | No |


---

## Part 3 — Expense → Loan Charged · roadmap #45

### Spec — Housemaid Loans Check

| | |
| --- | --- |
| **Requested by** | Abdullah Mahdi, Police & Control |
| **Spec version** | v2 — first version built through the P&C spec pipeline |
| **Date** | 2026-09-10 |
| **UI mockup** | https://claude.ai/code/artifact/de31f021-fd1f-4009-bcac-1615b2795b43 |
| **Status** | Draft — nine points approved by the requestor 2026-09-10; `spec-auditor` gate NOT run |
| **Roadmap** | #45, Payroll |

---

#### 1. Business Logic

**The control.** Money maids.cc spends on a housemaid must end up charged to whoever caused
the cost. Where the cost is hers, a loan must appear on her balance for it. Where the cost is
ours, no loan should appear. This report proves or disproves that, in both directions.

**The failure it catches.** Three of them, each its own rule:

| Rule | The failure | Measured, 1 Jan – 10 Sep 2026 |
| --- | --- | --- |
| **R1** | An expense in a code where loaning is the normal practice, with no loan set **and none on her ledger** | **564 cases · AED 137,510.33** |
| **R2** | A loan amount typed on the expense, with no matching loan on her ledger | **11 cases · AED 4,694.24** |
| **R3** | She was charged for a cost the company caused — a refund, not a collection | needs the read in M6; not countable yet |

**R1's figure fell from 693 cases / AED 165,323.33 on 2026-09-10**, when a live agent run found the
rule was flagging expenses whose loan was already on the ledger. **129 of the 693 (18.6%), worth
AED 27,813**, carry a matching loan — same maid, same loan type, same exact amount, within 45 days —
while the expense record's own loan field sits empty. The ledger clause is now part of R1.

**Reader and action.** A P&C officer, monthly. A red row means collect the amount from her
balance, or refund it to her. No row is actioned until fault is decided by the read in M6.

**Population in scope.** Housemaids — CC (`Normal`), MV (`MAID_VISA`) and freedom operators —
with a paid expense in one of the nine codes in 2.4, plus every EID replacement transaction.

**Explicitly out of scope.**

- **Terminated maids.** Requestor's ruling. Removes 3 R2 cases and AED 586 from the totals.
- **Part-time cleaners** — six `LVC-*` / `PTC-*` codes, a different population.
- **Two codes another check already scores:** GCC Expenses → *GCC Payments Checker*; Overstay
  fee Loan → *Change of Status*.
- **Codes where not loaning is the norm:** Salary Additions (339 of 1,159 loaned = 29%).
- **Office staff and client-visa EID.**
- **Exit loans and ILOE insurance** exclude themselves — 1,947 exit loans and 5,784 insurance
  loans exist on the ledger with **zero** matching maid expense, so they cannot collide.

**Grain.** One row per **expense item**. A maid with two skipped expenses is two rows.

**Refresh expectation.** Monthly, after payroll lock. The dashboard takes a **month parameter**,
earliest selectable **January 2026**. Ad hoc only — no scheduled unattended run.

---

#### 2. Data Points Needed

##### 2.1 Verified — already in Snowflake

Every name below came from a query result. Nothing here is inferred.

| # | Data point | Database.Schema.Table | Column | Grain | Verification |
| --- | --- | --- | --- | --- | --- |
| D1 | Expense request, amount, status, maid link | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `AMOUNT`, `REQUEST_STATUS`, `RELATED_TO_TYPE`, `RELATED_TO_ID`, `CREATION_DATE` | one row per expense request | 38,563 paid maid rows in period |
| D2 | Loan amount typed on the expense | `…EXPENSES_REQUESTS` | `LOAN_AMOUNT` | same | non-zero on 6,431 of 38,563 |
| D3 | Expense transaction — the complete money record | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | `ID`, `TRANSACTION_DATE`, `EXPENSE`, `EXPENSE_ID`, `TRANSACTION_AMOUNT`, `HOUSEMAID_ID`, `SUPPLIER_NAME` | one row per transaction | 132,594 maid rows, AED 50,402,218.79 |
| D4 | Expense code settings | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | `ID`, `EXPENSE_TYPE`, `CODE`, `LOAN_TYPE`, `ALLOW_TO_ADD_LOAN`, `STATUS` | one row per code | 1,880 rows, 1,103 enabled |
| D5 | The maid loan ledger | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | `ID`, `HOUSEMAID_ID`, `TYPE`, `BALANCE_DATE`, `AMOUNT`, `REMAINING_AMOUNT`, `REPAID_AMOUNT`, `WAIVED_AMOUNT`, `STATUS` | one row per loan | 1,087 distinct loans in Sept 1–10 alone |
| D6 | Maid type and termination status | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID`, `HOUSEMAID_TYPE`, `STATUS` | one row per maid | joins cleanly on `D1.RELATED_TO_ID` and `D3.HOUSEMAID_ID` |
| D7 | Complaint header for the read | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS` | **`ID`**, `HOUSEMAID_ID`, `COMPLAINT_TYPE`, `COMPLAINT_DESCRIPTION`, `CREATION_DATE` | one row per complaint | 719 complaints across the 80 EID cases |
| D8 | Complaint thread for the read | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS` | **`ID`**, `COMPLAINT_ID`, `TEXT`, `CREATION_DATE` | one row per message | 4,782 messages across those 719 |

`D7.ID` and `D8.ID` are listed because the verifier must return a `source_id` with every quote.

##### 2.2 Approved KPI definitions reused

**None exists.** `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` was searched and holds no
definition for any metric here. **These are new Police & Control definitions and should be
added to the Data Catalog.**

##### 2.3 New data ingestion request

**None.** Every data point is already in Snowflake. No Ask the Code lookup was needed and no
ERP ingestion is required. One thing is genuinely missing from every system, and no ingestion
can fix it: **who caused a cost is nowhere recorded as a field.** That absence is why R3 needs
an AI read at all, and it is open item O5.

**Join keys.** `D1.RELATED_TO_ID` → `D6.ID` (NUMBER, clean). `D3.HOUSEMAID_ID` → `D6.ID`
(NUMBER, clean). `D3.EXPENSE_ID` → **`D4.ID`, not a request id** — 170 of the 171 codes on maid
transactions this year match `D4` on both id and name. `D8.COMPLAINT_ID` → `D7.ID`.

**There is no key joining an expense to a loan.** `D5` carries no expense or transaction
reference. R2 therefore matches on *maid + loan type + exact amount*, and that limitation is
stated on every run.

**Known data hygiene issues.**

- **`D5` returns some loans twice** — dedupe on `ID` before any count or sum. 1,090 raw rows for
  1,087 loans in a ten-day window.
- **Two EID transactions at AED 454.62 carry no `HOUSEMAID_ID`.** They cannot be scored; they
  report as `NOT_READ`, never as clean.
- **Negative amounts exist:** one renewal at **−AED 382.10** (2026-07-01) and three cleaner
  Careem-ride expenses summing to **−AED 9**. Presumed reversals — O7.
- **`D4.ALLOW_TO_ADD_LOAN` must not be used to define scope.** It marks 43 of 1,103 enabled
  codes, includes part-time cleaners, and **excludes EID entirely** — where 112 loans were
  demonstrably created this period. Using it deletes real findings. See 2.4 for the real rule.
- **Read `D8.TEXT`, never `ORIGINAL_TEXT`** (raw HTML) and never `D7.GPT_SUMMARY` (blank on most
  rows).

##### 2.4 The scope rule for R1 — read from behaviour, not from a list

A code is in scope when the company's own practice already treats loaning as normal, so the
exception is the finding. **The 67% cut-off is an analyst's line, not a business rule** — nobody
at maids.cc has written one.

| Expense code | Paid | Loaned | Rate | Skipped | AED skipped |
| --- | --- | --- | --- | --- | --- |
| Live-out Transportation Assistance | 987 | 787 | 80% | 200 | 50,216.98 |
| Maids.at other expenses | 2,766 | 2,472 | 89% | 294 | 33,868.92 |
| Medical Expenses | 416 | 344 | 83% | 72 | 32,225.25 |
| Ticket for CC maid to be added as Outstanding Balance | 39 | 25 | 64% | 14 | 25,175.56 |
| PCR Test & medical assistance Loan | 305 | 240 | 79% | 65 | 15,373.64 |
| Accommodation Relocation | 410 | 400 | 98% | 10 | 5,830.00 |
| Passport Assistance Loan | 4 | 2 | 50% | 2 | 1,500.00 |
| WPS Compliance Loan | 67 | 64 | 96% | 3 | 880.00 |
| Sim card Loan | 578 | 545 | 94% | 33 | 252.98 |
| **Total** | **5,572** | **4,879** | **88%** | **693** | **165,323.33** |

*Terminated maids already excluded. Rates differ slightly from the all-maid figures because of
that exclusion; two codes fall below 67% once terminated maids are removed and are kept because
the requestor approved the code list, not the threshold.*

**Both pre-existing scope lists failed measurement and neither may be used.** Afif K's
*Loan – Expense Codes* sheet (last changed 2025-12-20) names eleven codes: four match `D4`, six
are set `ALLOW_TO_ADD_LOAN = false`, one does not exist under that name. And `D4`'s own marker
fails as described in 2.3.

**Medical stays in scope.** The Wellcare check (#8) covers one supplier: across 725 medical
transactions worth AED 109,242.03, **Wellcare is 1 transaction at AED 82.50 — 0.08%.** Thirty-six
other suppliers hold the rest. Exclude the Wellcare supplier by name so the two checks cannot
double-count that line; keep everything else.

---

#### 3. Metric Calculations

##### 🔴 How a loan is actually created — read from the ERP source, not inferred

**Verified against the code 2026-09-11 via Ask the Code.** There are **two** mechanisms, not three.

**Mechanism 1 — a human types the amount, and it posts when the expense is PAID.**
`ManagerNoteService.processExpenseRequestTodo()` inserts the `EmployeeLoan` row via
`employeeLoanRepository.save()` (lines 181–193). It fires on the expense todo reaching status
**`PAID`** — not creation, not approval — through `ExpenseRequestTodoBusinessRule` (lines 65–76),
**as a queued background task**.

The amount comes from `ExpenseRequestTodo.loanAmount`: a nullable `Double` with getter and setter
only (lines 40–41, 129–134). **The code does not default it, and does not calculate it from the
expense amount or from any configuration** — it must be supplied when the todo is saved. So:

- **"The loan equals the cost"** is not a rule, it is staff typing the same number. It holds on
  2,655 of 2,657 Maids.at · 601 of 602 sim cards · 506 of 508 relocations · 339 of 339 salary
  additions · 283 of 283 PCR.
- **The round AED 300 / AED 350 on Live-out Transportation** — 473 of its 891 loans — are **typed by
  staff too. No configured rate exists for them.** What looked like a standard-rate mechanism is
  habit, and the 53 partial loans (AED 7,604 absorbed) are 53 individual decisions.

**Mechanism 2 — a parameter-driven rule, independent of any expense. EID only.**
`RepeatEidDeductionBusinessRule` (lines 72–80) reads the system parameter
**`PARAMETER_PAY_REPEAT_EID_DEDUCTION_AMOUNT`** (constant at `PayrollManagementModule.java:434`,
value held in the **`_PARAMETERS`** table as `CODE` / `_VALUE`) and creates a `REPEAT_EID` loan.
It is triggered by a `MaidService` of type `APPLY_FOR_NEW_EMIRATES_ID` — **not by the visa expense**,
which is why only 3 EID expense requests exist in the period and why §3A reads the EID leg from
`TRANSACTIONS` instead.

**Plain terms:** for everything except the ID card, a person types how much she owes and the system
just saves it. For the ID card the system looks up one number in a settings table and charges that,
whatever the card actually cost.

##### Three things this settles

1. **There is no amount threshold anywhere.** The only guard in the code is
   `loanAmount != null && loanAmount > 0.0`. My band analysis reached the same conclusion from the
   data; the source confirms it. Nobody has written a "we absorb anything under X" rule.
2. **Zero-amount expenses cannot carry a loan — that is the code's own rule**, not a filter I
   invented. R1's `AMOUNT > 0` matches it exactly.
3. **The 1–3 day posting lag is a queued background task on the PAID transition.** Four Live-out
   cases measured on 2026-09-11 had loans posted 1–3 days after their expense. That is the mechanism,
   not a coincidence — and it is why the newest expenses are not yet decidable.

**And it settles what R1 actually means.** A missing loan is **nobody having typed a number**, not a
system failure. That is precisely why 8 of the 15 cases the agent read came back as deliberate
company decisions: R1 detects an absent human action, and an absent action is usually a choice.

**Near-flat loan types**, by how few distinct amounts they use in the period: `REPEAT_EID` 1
(475) · `UNEMPLOYMENT_INSURANCE_PLAN` 2 (123/126, 5,796 loans) · `UNEMPLOYMENT_INSURANCE_FINES` 3 ·
`GCC_LOAN` 3 (218–220) · `SMARTPHONE` 4 (265–395) · `SIM_CARD` 5 (5–100).

##### No code has an amount threshold — one has a gradient

**Nothing goes 0% below a figure and 100% above it.** The closest is *PCR Test & medical assistance
Loan*, 354 paid expenses with zeros excluded: **29% loaned under AED 50 (14 expenses) · 49% at
50–99 (35) · 80% at 100–199 (54) · 78% at 200–499 (114) · 96% at 500–999 (114) · 91% at 1,000+ (23)**.
The step sits between AED 99 and AED 100. **This is a measured tendency in one code's data, not a
written rule** — do not build a threshold gate on it without asking Accounting first.

The reverse also exists: *Salary Additions*, 1,159 paid, runs 19% under AED 50 and **17% at AED
1,000+**, peaking at 36% in the middle. Bigger additions are less likely to be charged back, which
is further reason it stays out of scope (O9).

---

Period assignment uses **transaction date** — the day the money moved (requestor's ruling).
Currency AED throughout, no FX. Rounding 2 dp at row level, never on totals. Reporting month is
a parameter, earliest January 2026.

##### R1 — Expense with no loan set

- **Business definition.** A paid expense on a housemaid, in one of the nine codes in 2.4, where
  no loan amount was recorded on the expense **and no matching loan exists on her ledger**.
- **Formula.** Flag where `D1.REQUEST_STATUS = 'PAID'` and `D1.RELATED_TO_TYPE = 'MAID'` and
  `COALESCE(D2.LOAN_AMOUNT, 0) = 0` **and `NOT EXISTS` a row in `D5` with
  `HOUSEMAID_ID = D1.RELATED_TO_ID` and `TYPE = D4.LOAN_TYPE` and
  `ROUND(AMOUNT,2) = ROUND(D1.AMOUNT,2)` and `BALANCE_DATE` within ±45 days of the expense date.**
- **🔴 The ledger clause is not optional and was added after a live run caught its absence.**
  Without it R1 flags an expense as uncharged whenever the loan was booked against a different
  expense record for the same money — **129 of 693 cases, AED 27,813**. Worked case: expense 164592,
  maid 59829, AED 800 Accommodation Relocation dated 2026-08-14 with an empty loan field, while
  ledger loan 80240 holds `ACCOMMODATION_RELOCATION` AED 800.00 dated 2026-08-10. The agent found
  it in the thread — *"the original AED 800 is already listed as her outstanding balance"* — before
  the data confirmed it.
- **Inputs.** D1, D2, D4, D6.
- **Filters.** Code in the 2.4 list · `D6.STATUS <> 'EMPLOYEMENT_TERMINATED'` · supplier not
  Wellcare on the medical codes · **`D1.AMOUNT > 0`**.
- **🔴 Exclude zero-amount expenses.** There are **90 paid expenses of AED 0.00**, all on
  *Maids.at other expenses* (90 of its 2,981), and **not one zero-amount expense anywhere in the
  period carries a loan.** You cannot recover nothing, so they are not findings. Leaving them in
  also fabricates a fake threshold: with the zeros included, Maids.at reads *1 of 98 loaned below
  AED 50* and looks like a policy cut-off; with them removed it is 1 of 8 and there is no pattern
  at all.
- **Nulls.** A null `LOAN_AMOUNT` is treated as zero, i.e. as a finding. A null `RELATED_TO_ID`
  cannot be scored → `NOT_READ`.
- **No settling hold.** The requestor ruled that every unposted expense flags immediately, with
  no grace period. **Consequence, stated plainly: the newest few days will contain false
  positives** — three Live-out Transportation cases appeared mid-session on 8 and 10 September
  whose loans had not yet been posted. The officer absorbs them.
- **Flags.** Red — no loan set. Grey where the maid has no complaint text in the window, which
  is itself a finding and is never hidden.

##### R2 — Loan typed on the expense, never posted

- **Business definition.** A loan amount was recorded on the expense and no loan of that type
  for that amount exists on the maid's ledger.
- **Formula.** For each expense where `COALESCE(D2.LOAN_AMOUNT,0) <> 0`, flag where
  `NOT EXISTS` a row in `D5` with `HOUSEMAID_ID = D1.RELATED_TO_ID` **and**
  `TYPE = D4.LOAN_TYPE` **and** `ROUND(AMOUNT,2) = ROUND(D2.LOAN_AMOUNT,2)`.
- **Matching window.** `D5.BALANCE_DATE` within **±45 days** of the expense date.
  **It must reach both ways, and the direction differs by code.** On the EID leg the loan is raised
  *before* the expense in **34 of 34** cases, so a forward-only window finds nothing there. On
  *Live-out Transportation* the loan posts **1–3 days after** the expense — four cases measured on
  2026-09-11 whose expenses were dated 08 and 10 September — so a backward-only window misses those.
- **🔴 The newest expenses are not yet decidable, and the requestor ruled they still flag.** Four of
  the twelve R2 cases on 2026-09-10 had their loans posted by the next morning and were never
  findings. Under the no-hold ruling the report carries roughly **four self-clearing findings a day**
  on these codes. The officer absorbs them; the cost is stated here so it is not a surprise.
- **A loan of the right type at a different amount is a finding** (requestor's ruling). That
  covers **4 of the 12 cases and AED 2,930.44 — 62% of R2's money.** The alternative rulings
  were "clear it" (8 cases, AED 1,835.30) and "to the officer"; the requestor chose finding.
- **Dedupe.** `SELECT DISTINCT ID` from `D5` first, or the double-returned rows inflate matches.

##### R3 — Charged for a cost the company caused

- **Business definition.** A loan exists on her balance for a cost the text shows was caused by
  the company, a courier, or a data-entry error. The finding is a **refund**.
- **Formula.** Route every case with a loan to M6. Flag where M6 returns `JUSTIFIED` with a
  company-fault category (4, 5 or 6).
- **Not countable until M6 runs.** No estimate is given here.

##### M1 — Amount at risk

- **Formula.** `SUM(D1.AMOUNT)` over R1 rows + `SUM(D2.LOAN_AMOUNT)` over R2 rows +
  `454.62 × count` of uncharged EID replacements.
- **August 2026: AED 28,125.56.** Full period 1 Jan – 10 Sep 2026: AED 206,913.65.
- **Division by zero.** Not applicable; a zero-amount expense is reported at 0.00, never hidden.

##### M2 — Exception count · M3 — Exception rate · M4 — Awaiting the read · M5 — Cleared

- **M2** = R1 + R2 + uncharged EID rows. **August: 146.**
- **M3** = M2 ÷ items audited. **August: 146 ÷ 1,162 = 12.6%.** The denominator is displayed as
  its own figure — a rate without it cannot be told apart from a coverage change.
- **M4** = rows with no M6 verdict. **August: 146 — all of them.**
- **M5** = rows an officer marked cleared. **August: 0.**

##### M6 — The fault read

Specified in full in section 3A below.

##### Tie-out rule

**Count and money must both reconcile, per code per month** (requestor's ruling). Any gap is
displayed as its own exception row rather than disappearing.

```
expense items audited      = items with a loan set  + R1 exceptions
items with a loan set      = items matched in D5    + R2 exceptions
EID replacements audited   = charged                + uncharged
M2                         = R1 + R2 + uncharged EID
```

**August 2026, and it ties exactly:** 1,144 = 1,009 + 135 · 1,009 = 1,007 + 2 · 18 = 9 + 9 ·
146 = 135 + 2 + 9. Variance AED 0.00.

---

#### 3A. M6 — The fault read

One agent call per case. Model **`claude-sonnet-5`, temperature 0**, and **the same prompt every
run** — a prompt that drifts between months makes two months of verdicts incomparable.

##### Measured size of the read — not estimated

On the 80 EID replacement cases: **100% have at least one complaint** in the window. **719
complaints, 4,782 messages, 6.7 messages per complaint, about 60 messages per case.** 78 of 80
have text naming the card.

**Do not filter by complaint type.** Only **28 of 80** cases have a complaint typed *EID and
fingerprinting issues*; a type filter loses 52 of 80. Every complaint in the window goes to the
model, full thread, unfiltered.

**The honest ceiling: only 23 of 80 cases (29%) contain any word about losing, damaging,
breaking or missing the card.** Expect the majority to return `AMBIGUOUS` or `NO_TEXT`. This is
O5, recorded before the build rather than discovered after it.

##### The six verdicts — the house set, never changed

| Verdict | Means | This check's flag |
| --- | --- | --- |
| `JUSTIFIED` | The text says decidably who caused the cost | Collect, refund, or clear |
| `PLAUSIBLE` | Explains the cost but not who caused it | Stays red, to the officer |
| `AMBIGUOUS` | Relevant text, nothing decidable | Stays red, to the officer |
| `NOT_RELATED` | Read in full; nothing addresses this cost | Stays red, to the officer |
| `UNRESOLVED` | Contradicts itself, or breaks off | Stays red, to the officer |
| `NO_TEXT` | No complaint in the window at all | Stays red, to the officer |

**Only `JUSTIFIED` moves money.** `NOT_READ` is a **run state, not a verdict** — model error,
timeout, unparseable output, missing maid id — and is **counted separately from `NOT_RELATED`**
so the report can never say a case was read when nobody read it.

##### Measured on a live run, 2026-09-10 — 15 cases of August's 117

Fourteen agent calls plus one deterministic `NO_TEXT`, sampled **worst-first by amount**.

| Verdict | Cases |
| --- | --- |
| `JUSTIFIED` | 8 |
| `PLAUSIBLE` | 3 |
| `NO_TEXT` | 2 |
| `AMBIGUOUS` | 1 |
| `NOT_RELATED` | 1 |
| `UNRESOLVED` · `NOT_READ` | 0 · 0 |

**Fault among the 8 `JUSTIFIED`: company 6 · client 1 · nobody 1 · maid 0.** Not one case in
fifteen was the maid's fault, and **AED 0.00 was confirmed collectable**. 270 threads read.

**That result cannot be generalised and must not be quoted as if it could.** The sample was drawn
worst-first by amount — the population most likely to carry a written approval. A manager records
an AED 883 decision; nobody documents a skipped AED 40 sim card. **A random sample is required
before anyone concludes R1 is mostly noise.**

`NOT_READ` came back zero because every agent asserted its row count. One hit the partition-0 trap
live — 165 rows against a stated 189 — caught it, re-pulled the three missing threads and read all
26. The guard works.

**Two of the fourteen wrapped prose around the JSON** the contract says to return alone. The build
must extract the JSON block or reject and re-run; it may not assume a bare object.

##### Categories — this check's own list

**🔴 The list below is EID-shaped and does not fit R1. Measured: category 7 was used in 7 of 15
cases, with seven unrelated names** — *client unreachable, card returned to GDRFA · cash assistance
to retract the maid · Du bill · insurance said covered then declined · incentive to cover her taxi
fare · monthly carlift incentive · one-time transport allowance after the client declined*. **And
category 4 was misfiled once**, on a case where a driver refused a route and nothing was lost,
because the prompt pushes toward a named category before the open slot.

**Two changes required before a full run:** a **separate category list per leg** — the one below
for EID, and a new one for general expenses built from those seven real names — and **category 4
must require an actual loss**. See O11.

```
1  Maid lost the card or the item
2  Maid damaged or broke it
3  The client or their household kept it or lost it
4  We lost it - office, courier or Zajel
5  Wrong data on the card, so it was reissued
6  It never arrived
7  New reason - you name it
```

`category_id` **must be null** for `NOT_RELATED`, `NO_TEXT` and `UNRESOLVED`. Categories 1–2 →
collect. Categories 4–6 → refund if she was charged. **Category 3 cannot be scored** — no rule
exists for a client-caused loss (O4); those cases route to the officer.

##### What to assemble per case

Every complaint on that maid from **60 days before the expense to 30 days after**, header plus
full thread. The assembler may order the list however it likes; **it may not shorten it.**

```json
{
  "housemaid_id": 113065,
  "maid_type": "CC",
  "cost": { "expense_id": 170990, "date": "2026-09-04", "amount": 625.00,
            "code": "Accommodation Relocation", "rule": "R2" },
  "loan_on_ledger": { "type": "ACCOMMODATION_RELOCATION", "amount": 800.00,
                      "date": "2026-08-21", "status": "NOT_YET_PAID" },
  "complaints": [
    { "complaint_id": 254580, "type": "EID and fingerprinting issues",
      "opened": "2026-08-28", "description": "…",
      "thread": [ { "comment_id": 99812, "at": "2026-08-29", "text": "…" } ] }
  ]
}
```

##### The prompt — send verbatim

```
You are auditing one cost that maids.cc paid on behalf of a housemaid. Your only job is to
decide WHO CAUSED that cost, and to name the reason.

You are given: the maid's id and type, the cost with its date, amount and expense code, any
loan already recorded against her for it, and every complaint on her in the window from 60
days before the cost to 30 days after, each with its full comment thread.

DECIDE ONLY THIS: does the text say who caused this cost?

Never calculate an amount, a fee or a balance. The cost and any existing loan are given to
you. If you find yourself doing arithmetic to reach a verdict, stop and return AMBIGUOUS.

RULES

1. Read everything you are given. Every complaint, every message in every thread. Do not
   stop when you find something that looks like an answer, and do not skip a thread because
   its type looks unrelated. The answer is usually in a thread typed as something else:
   only 28 of 80 measured cases had a complaint typed for the subject at all.
2. A complaint's TYPE is a place to look, not an answer.
3. FAULT IS NOT THE SAME AS INCONVENIENCE. A maid reporting that a card is missing is not an
   admission that she lost it. Someone writing that a replacement was requested is not a
   statement of who caused it. Assign category 1 or 2 only when the text says she lost or
   damaged it, or she says so herself.
4. Quote the exact words your verdict rests on and give the id they came from - the
   complaint_id, or the comment_id if it came from a message. A verdict with no quote and no
   id is not a verdict.
   REDACT the following inside the quote before you return it, and NOTHING ELSE:
     - a client name -> [client], a maid name -> [maid], a staff name -> [staff]
     - any phone number -> [phone]        - any email address -> [email]
     - any URL -> [link]                  - any conversation id (CH...) -> [conversation]
   Keep every other word exactly as written, INCLUDING typos and misspellings - "lossed"
   stays "lossed". You are redacting identifiers, not tidying prose.
   The quote is displayed on a shared report, and these threads carry phone numbers and live
   document links as well as names.
5. Assign exactly one category from the list below, or null. If nothing fits, use 7 and
   propose a short name in the company's own words: the words the staff used, not yours. If
   the text explains nothing, return null.
6. A CATEGORY NAMES WHO CAUSED THE COST, never the type of ticket the conversation sits in.
   "Maid related question" is not a cause.
7. WE ARE A CANDIDATE TOO. A cost caused by the office, by a courier, or by Zajel is category
   4, and it is the answer this audit is most likely to miss because nobody writes it down as
   a mistake. Read for it deliberately.
8. Silence is not fault. If the text nowhere says who caused it, that is NOT_RELATED, not
   AMBIGUOUS. If there is no complaint at all, that is NO_TEXT. Never infer fault from the
   fact that the company paid.
9. If the text says one thing and a later message contradicts it, return UNRESOLVED. Do not
   pick the later one because it is later.

CATEGORIES

1  Maid lost the card or the item
2  Maid damaged or broke it
3  The client or their household kept it or lost it
4  We lost it - office, courier or Zajel
5  Wrong data on the card, so it was reissued
6  It never arrived
7  New reason - you name it

VERDICTS

JUSTIFIED   the text says decidably who caused the cost
PLAUSIBLE   the text explains the cost but not who caused it
AMBIGUOUS   relevant text, but nothing decidable in it
NOT_RELATED you read all of it and nothing addresses this cost
UNRESOLVED  the text is contradictory or breaks off unresolved
NO_TEXT     no complaint in the window

Return only this JSON, nothing else:

{
  "verdict": "JUSTIFIED | PLAUSIBLE | AMBIGUOUS | NOT_RELATED | UNRESOLVED | NO_TEXT",
  "category_id": "1-7 or null",
  "category_name": "the category, your proposed name if 7, or null",
  "at_fault": "MAID | CLIENT | COMPANY | NOBODY | null",
  "evidence": [
    { "source_table": "complaint_comment | complaint_description",
      "source_id": 254580,
      "quote": "the exact words, with names, phone numbers, emails, URLs and conversation ids replaced by their [placeholder]" }
  ],
  "reasoning": "one or two sentences, no more",
  "threads_read": 9
}

category_id is null, and MUST be null, for NOT_RELATED, NO_TEXT and UNRESOLVED - those three
mean nothing in the text explains this cost, so no category applies. Never reach for 7 to
avoid returning null; 7 is for a reason you FOUND and the list lacks a name for, not for the
absence of one.
at_fault must agree with category_id: 1 or 2 -> MAID, 3 -> CLIENT, 4, 5 or 6 -> COMPANY,
null -> null. A disagreement between the two invalidates your answer.
threads_read: how many complaint threads you read. If this is lower than the number you were
given, your verdict is invalid.
```

##### Four guardrails

1. **A verdict with no quote and no `source_id` is not a verdict** — the case stays red.
2. **Redaction happens at the model**, before the quote leaves it. The report never re-fetches
   raw text for display.
3. **`threads_read` is checked against what was supplied.** Lower means **rejected and re-run**,
   never accepted. Median supplied on the measured cases is 9.
4. **Pin the verdict to the text it read.** Store `(case id, hash of the exact comment set
   read)` and re-read only when that set changes, or a case moves flag with no data change.

**The agent never sees or returns an amount.** Its whole output is a verdict, a category, a
fault and a quote — so an agent error can misjudge one case and can never move a total.

**Category 7 goes to a review queue.** The verdict applies immediately; the proposed name is
promoted into 1–6 if it recurs.

---

#### 4. Finalised UI Report

**Mockup:** https://claude.ai/code/artifact/de31f021-fd1f-4009-bcac-1615b2795b43 — worked on
real August 2026 data.

**Layout.** Filter row → KPI strip (M1–M5) → tie-out line → exception table → one chart →
verdict legend → provenance. KPI strip and the top of the table visible without scrolling.

**Columns.**

| Column | Source | Format | Notes |
| --- | --- | --- | --- |
| Rule | R1 / R2 / R3 / EID | text | Every row names the rule it broke, in the rule's own words |
| Expense / txn id | D1.ID or D3.ID | integer | Links to the ERP record |
| Maid | D1.RELATED_TO_ID | integer | **Id only. Never a name** |
| Type | D6.HOUSEMAID_TYPE | CC / MV / FO | |
| Expense code | D4.EXPENSE_TYPE | text | |
| AED at risk | M1 | `#,##0.00`, right-aligned | Currency in the header, not per cell |
| Paid on | D3.TRANSACTION_DATE | `YYYY-MM-DD` | |
| Threads | count of D7 in window | integer | 0 means the read will return `NO_TEXT` |
| Verdict | M6 | `NOT_READ` until the read runs | **On the row, not the drill-down** |
| Flag | derived | label + icon | Never colour alone |
| Status | officer | New / Under review / Cleared / Escalated | **Write-back undecided — O10** |

**Default sort.** AED at risk, descending. Not by date.

**Filters and defaults.** Month = last complete month · Rule = all · Maid type = CC and MV ·
Status = Unreviewed.

**Drill-down.** Opens the expense, the maid's ledger rows for that loan type, and the redacted
quote M6 returned with its `source_id`.

**Conditional formatting.** The flag column drives the row stripe. Red = money on the wrong
side. Amber = EID replacement charged to nobody. Grey = no text to read, itself a finding,
never hidden. Green = charged and matched.

**The one chart.** Amount at risk by expense code, single hue, horizontal bars, direct labels.
Its bars sum exactly to M1. Palette validated for light and dark; every flag carries a text
label.

**Provenance line.** Displayed on the report: as-of date, month, and every source table.

**Export.** CSV of the row-level detail. P&C works cases one at a time.

---

#### 5. Worked Examples

##### Example A — exception, R1, the common shape

| Input | Value |
| --- | --- |
| Expense id | 164134 |
| Maid | 99494, CC, `WITH_CLIENT` |
| Code | PCR Test & medical assistance Loan (79% of these are loaned) |
| Amount | AED 883.00 |
| Paid | 2026-08-12 |
| `LOAN_AMOUNT` on the expense | null |
| Complaint threads in window | 18 |

**Output row:** R1 · 164134 · 99494 · CC · PCR Test & medical assistance · **883.00** ·
2026-08-12 · 18 threads · `NOT_READ` · red *no loan set*.
**Flag:** Red. Nothing was charged to anyone for a cost in a code that is loaned 79% of the
time. Not collectable until M6 confirms fault.

##### Example B — exception, R2, the amount-mismatch ruling

| Input | Value |
| --- | --- |
| Expense id | 170990 |
| Maid | 113065, CC, `PENDING_FOR_DISCIPLINE` |
| Code | Accommodation Relocation |
| Expense amount | AED 625.00 |
| `LOAN_AMOUNT` typed on the expense | 625.00 |
| Loans on her ledger, type `ACCOMMODATION_RELOCATION`, ±45 days | one, **AED 800.00**, 2026-08-21, `NOT_YET_PAID` |

**Arithmetic:** exact-amount match on 625.00 → none found. A loan of the right type exists at
800.00, which is **not** this expense — it predates it by two weeks and differs by AED 175.
**Output flag:** Red, *loan never posted*. This is the ruling in action: 4 of 12 R2 cases have
this shape and hold AED 2,930.44.

##### Example C — clean case, and the stated exemption

| Input | Value |
| --- | --- |
| Transaction id | 2089588 |
| Maid | 104509, MV, `WITH_CLIENT` |
| Code | NEW - MV Housemaids - EID Replacement (Lost/Damaged) |
| Cost | AED 454.62 |
| Paid | 2026-08-24 |
| Loan, type `REPEAT_EID` | AED 475.00, raised 2026-08-09 |

**Arithmetic:** 475.00 − 454.62 = **AED 20.38 charged above cost.** The loan predates the
payment by 15 days, which is the normal order — 34 of 34.
**Output flag:** **Green — charged.** The AED 20.38 gap is a **stated exemption by requestor
ruling, not a finding and not an open question.** It is identical on all 112 EID loans this
year. Do not "fix" it into a finding.

##### Example D — edge case, the grey row

| Input | Value |
| --- | --- |
| Expense id | 167696 |
| Maid | 97219, MV, `WITH_CLIENT` |
| Code | PCR Test & medical assistance Loan |
| Amount | AED 500.00 |
| Paid | 2026-08-27 |
| Complaint threads in window | **0** |

**Output flag:** **Grey — no text to read.** M6 returns `NO_TEXT`; the row stays red for the
officer and is **never hidden and never cleared**. This is the shape 29%-explicit-fault
predicts will be common.

---

#### 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | Scope was ruled **narrow residue**, with EID and Medical kept by explicit exception. Codes touched by the ticket checks (#2, #3, #4) were not tested for overlap — *Ticket for CC maid to be added as Outstanding Balance*, AED 25,175.56, may belong to one of them. | Abdullah Mahdi / Malaz | No |
| O2 | **Is an EID renewal the maid's debt or ours?** 4,410 renewal transactions in the period, AED 1,574,533.41, audited by nobody. Two of the requestor's own November 2025 findings were renewals marked "Not Added / Waived". | Accounting | No |
| O4 | **When the client causes the cost, who pays?** No rule exists. **This became live on 2026-09-10:** case 2089591 came back `JUSTIFIED` with fault CLIENT — Zajel could not reach the client, the card went back to GDRFA — and the staff comment itself asks *"please confirm who will shoulder the expense"*. The business does not know either. Until it is ruled, every client-fault case routes to the officer and stays there. | Abdullah Mahdi | **Yes — 1 of the first 15 cases read** |
| O11 | **The fault category list is the wrong shape for R1.** Category 7 fired in 7 of 15 cases with seven unrelated names, and category 4 was misfiled once on a case with no loss. Needs a per-leg list, with the general-expense list built from those seven real names, and category 4 gated on an actual loss. | Abdullah Mahdi | No |
| O12 | **Standing arrangements re-flag every month.** Case 165310 is a monthly carlift subsidy promised *"as long as you are with this client"*, so R1 raises it again every month and the officer works it twelve times a year. Needs verdict inheritance: once confirmed for a maid and code, later months carry it forward. | Abdullah Mahdi | No |
| O15 | **`ExpenseRequestTodo` carries a `percentageDeductedFromEmployee` field that the loan code never reads.** Confirmed in source 2026-09-11: the loan is built only from `loanAmount`, and nothing defaults or calculates it from that percentage. If staff are setting a percentage expecting a partial charge to follow, it does nothing — a candidate explanation for the 53 partial Live-out loans and for loans typed at odd fractions of the cost. Worth asking whoever fills that screen. | Abdullah Mahdi | No |
| O16 | **The EID deduction parameter's seeded default is AED 372, the live value is AED 475, and the card costs AED 454.62 — three different figures.** `PARAMETER_PAY_REPEAT_EID_DEDUCTION_AMOUNT` lives in `_PARAMETERS`, so 475 was set deliberately by someone. The exemption stands (see §5 Example C); this records where the number lives so it can be checked against the card price when the price next changes. | Accounting | No |
| O14 | **A loan posted at a nonsense amount passes every rule here, because a loan exists.** Expense 153038, *Ticket for CC maid*, cost **AED 1,953.90**, loan recorded as **AED 10.00** — AED 1,943.90 absorbed, where every other loan on that code recovers 98–100%. That is a keystroke, not a decision. Needs a fourth rule: flag a loan that is a tiny fraction of its cost on a cost-recovery code. | Abdullah Mahdi | No |
| O13 | **A random sample is needed before R1's value is judged.** All 15 cases read were drawn worst-first by amount and none was the maid's fault. That is the population most likely to have a documented approval, so the result is biased by construction and cannot answer whether the small-amount tail hides real oversights. | Abdullah Mahdi | No |
| O5 | **Only 23 of 80 cases state fault in words (29%).** Accept that floor, or add a required reason field to the expense request so fault is captured at the point of spending? | Abdullah Mahdi | No |
| O6 | Two EID transactions at AED 454.62 carry **no `HOUSEMAID_ID`**. Cause unknown; they report `NOT_READ`. | Snowflake team | No |
| O7 | One renewal transaction is **−AED 382.10** and three cleaner Careem expenses total **−AED 9**. Presumed reversals — confirm they are not cases this check should read. | Snowflake team | No |
| O8 | **CC maids are charged for an EID replacement 65% of the time, MV maids 26%** — same card, same fee, 74 cases. Either an unwritten rule or an inconsistency. | Abdullah Mahdi | No |
| O9 | **Is Salary Additions in or out?** 820 of 1,159 carry no loan, AED 371,561.14 — the largest number in the data. Excluded here only because 29% loaned is too low to call not-loaning an error. | Accounting | No |
| O10 | **Write-back.** The status column assumes an officer can mark a row reviewed or cleared. That turns the deliverable from a dashboard into an application and the Snowflake team must know before they build. Not yet answered. | Abdullah Mahdi | **Yes — for the build, not the spec** |

**Deliberately NOT an open item:** the AED 475 loan against an AED 454.62 card. Ruled an
exemption by the requestor on 2026-09-10, recorded in section 5 Example C so a later reader
cannot reopen it by accident.

**The `spec-auditor` gate has not been run on this spec.** It is available on request.


---

## Part 4 — Loan Repayment

### Loan Repayment Check — v2

**Owner:** Abdullah Mahdi, Police & Control
**Status:** draft — the `spec-auditor` gate has **not** been run
**Source:** Snowflake only. No spreadsheet, no ERP API call.
**Measured:** March and August 2026, live read 10 September 2026
**Replaces:** v1 (payroll workbook) and the CC-only rule in `checks/CC_Loan_Repayment_Check.md`
**Report UI:** https://claude.ai/code/artifact/66a5cb1f-a27e-42f6-b215-d7ad3f39315f

---

#### 1 · What this checks

A housemaid who owes maids.cc money — visa costs, a cash advance, a phone, a flight — repays it
out of her monthly salary. This check finds the months where she owed money, we paid her, a
deduction was allowed, and **nothing was taken**.

**Who reads it:** Police & Control, monthly, after payroll is locked. A red row goes to Payroll to
take the deduction next month or say why it was skipped.

**Grain:** one row per maid per payroll month.

**In scope:** **every maid we actually paid that month** — both CC and MV, live-in and live-out,
every loan type. **Out of scope:** maids on the payroll run who were not paid, and maids who have
left (they carry balances but payroll can no longer reach them — see O2).

#### 2 · The rule

A month is a **finding** when all four are true:

1. **We paid her that month.** `IS_TRANSFERRED = 'YES'` on her payroll row.
2. **She still owed money at month end** on a loan that is **in scope** — see the two excluded
   types below.
3. **Nothing was deducted.** `DEDUCTIONS = 0`.
4. **A deduction was allowed** — her nationality deduction limit is above zero.

##### Two loan types are out of scope

**Exit loan** and **unemployment insurance plan** do not count as debts this check chases
(Abdullah Mahdi's ruling, 2026-09-10). Everything else does.

**Why it matters this much:** those two are the largest and the most widely held item in the
ledger. Excluding them takes August from **2,526 findings to 1,307**, and the collectable amount
from AED 436,634 to **AED 174,370**. The exit loan alone carried AED 755,831 of undeducted
balance; the unemployment insurance plan was held by 2,410 maids, more than any other type, and
**1,038 findings were maids who owed nothing else at all** — an insurance premium of roughly
AED 65, being audited as an unpaid loan.

**Plain terms:** the two biggest things in the ledger are not the things this check is for. Take
them out and what is left is genuine debt — tickets, cash advances, relocation, phones, medical
assistance.

Sibling types `UNEMPLOYMENT_INSURANCE_PREMIUM` and `UNEMPLOYMENT_INSURANCE_FINES` are **kept**,
because the ruling named the plan. Dropping those two as well would give 1,232 findings and
AED 155,498 — a further 75 cases. Flagged as O6.

Three exclusions clear a case before it becomes a finding:

| | Exclusion | Test |
|---|---|---|
| a | Her pay was no more than her accommodation salary — there was nothing above the low rate to take from | `TOTAL_SALARY` ≤ `ACCOMMODATION_SALARY` |
| d | She joined that month and worked under 20 days | `SALARY_STARTING_DATE` in the month **and** days from that date to month end < 20 |
| **e** | **Deducting anything would push her below the legal wage floor** | `TOTAL_SALARY` < `0.85 × (PRIMARY_SALARY + HOLIDAY)`, or that floor cannot be computed because primary salary is blank |
| **f** | **Her replacement salary started inside the payroll month** — the ERP takes no deduction at all in that month | `REPLACEMENT_SALARY_START_DATE` on or after the first day of the month, **or** `START_DATE` on or after it, **or** `START_DATE` is null |

**Plain terms:** if she only earned the low accommodation rate, or had only just joined, or her
pay is already at the legal minimum, taking nothing is correct. Otherwise somebody forgot, and
the money is still owed.

**Exposure per finding** = the smallest of her deduction limit, what she still owes, and **what
can be taken without breaching the wage floor** (`TOTAL_SALARY − 0.85 × (PRIMARY_SALARY +
HOLIDAY)`).

##### Exclusion (e) — the Minimum WPS Requirement, and why it is smaller than it looks

**Jira PAY-4257 / PAY-4309, "Salary Deduction Restriction", released August–September 2026.**
Payroll now refuses to take a deduction that would drop a maid's net pay below
`0.85 × (MOHRE salary + holiday)`, prorated by working days. Where her salary is already below
that floor, **no loan repayment is created at all** — a correct zero, not a missed deduction.
The change also extended the floor to **MV maids, who never had one** (their accommodation
salary is zero, so the old floor never protected them and the cap was always taken).

**It was proposed as the explanation for the whole spike and the measurement rejected that.**
Applied to August it clears **43 of 1,307** cases — 38 whose salary sits below the floor and 5
with no primary salary to compute one from. A further 77 keep a reduced expected deduction rather
than none, so they stay findings with a smaller exposure. **That is 3% of the population, not the
cause of anything.** The count still runs 241 in June → 812 in July → 1,307 in August, and the
floor accounts for 4, 11 and 43 of those respectively.

**Proration is not implemented.** The Jira rule prorates the floor by working days; this check
uses the unprorated monthly figure, which is *more* generous to the maid and therefore clears
slightly fewer cases. Exclusion (d) already removes most part-month maids. Flagged as O11.

##### Why v1 had four exclusions and this has three

v1 read the payroll spreadsheet, which splits a maid's month into six day-groups. Its exclusion
**(b)** — *"all her pay was at the accommodation rate"* — tested day-group 1 only, and a live-out
maid's full pay is never in group 1. It therefore excused every live-out maid automatically. That
was the defect v1 existed to fix, and on Snowflake **it cannot recur: there are no day-groups
here.** `TOTAL_SALARY` is her whole month's pay whether she lives in or out, so exclusion (a)
tests the real thing and (b) has nothing left to do. It is not dropped for convenience — it is the
same test, done once, correctly.

Exclusion **(c)** of v1 — *"she already reached her deduction limit"* — is deleted for a different
reason: it can never fire. Rule 3 already requires that nothing was deducted, so a maid who hit
her limit is not a candidate in the first place.

#### 3 · Data points

Every one is in Snowflake. **No ingestion request. Nothing is missing.**

| Data point | Verdict | Source |
|---|---|---|
| Did we pay her, and how much | **EXISTS** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` — `IS_TRANSFERRED`, `TOTAL_SALARY`, `DEDUCTIONS`, `PAYROLL_MONTH`. 1,298,625 rows, 57,222 maids, 2020-07 to 2026-09 |
| What she owes, per loan item | **EXISTS** | `…HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` — `AMOUNT`, `REPAID_AMOUNT`, `WAIVED_AMOUNT`, `STATUS`, `BALANCE_DATE`, `TYPE`. 81,579 rows, 43,537 maids, 2016-09 to 2026-09 |
| Her accommodation salary | **EXISTS** | `…HOUSEMAIDS_INFO.ACCOMMODATION_SALARY` |
| Her deduction limit | **EXISTS** | `…HOUSEMAIDS_INFO.DEDUCTION_CAP` — populated on 100% of rows |
| Maid type CC / MV | **EXISTS** | `…HOUSEMAIDS_INFO.HOUSEMAID_TYPE` — `MAID_VISA` is MV, everything else is CC |
| When her salary started | **EXISTS** | `…HOUSEMAIDS_INFO.SALARY_STARTING_DATE` — no nulls among candidates |

**`IS_TRANSFERRED = 'YES'` is the "we paid her" flag.** Checked across all 25 status/transfer
combinations in March 2026: every `YES` row carries a `PAID_ON_DATE` and every `NO` row does not,
with no exceptions. March: **27,046 maids paid**, against 26,189 rows in the payroll workbook — so
about **857 paid maids the spreadsheet version never sees**.

Deduction limits, read from `DEDUCTION_CAP`: **Filipina 500 · African 250 · Ethiopian 150 · other
200 or 350.** The limit does **not** vary by maid type.

**What counts as still owed:** any ledger row dated on or before month end whose `STATUS` is not
`PAID`, valued at `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`, summed per maid, kept when above zero.
**All 34 loan types count** — exit loans, tickets, cash advances, phones, medical assistance,
relocation, manager decisions, everything (Abdullah Mahdi's ruling, 2026-09-10).

**Do not use `REMAINING_AMOUNT`.** It is present and never null on all 81,579 rows and it is
**zero on every one of them.** The balance must be derived by the subtraction above.

#### 4 · Metrics

| ID | Metric | Formula |
|---|---|---|
| M1 | Paid maids carrying a loan | rule 1 AND rule 2 |
| M2 | Nothing deducted | M1 AND `DEDUCTIONS` = 0 |
| M3 | **Findings** | M2 surviving exclusions (a) and (d), with a deduction limit above zero |
| M4 | Outstanding on findings | sum of open balance over M3 |
| M5 | **Collectable this month** | sum of `LEAST(DEDUCTION_CAP, open balance)` over M3 |

Amounts in AED, whole dirhams. Nulls read as zero.

#### 5 · Measured result

**August 2026** — the most recent complete month, in-scope loan types only:

| | Candidates | (d) new joiner | (e) wage floor | (f) replacement salary | **Findings** | **Owed** | **Collectable** |
|---|---|---|---|---|---|---|---|
| CC | 490 | 31 | 38 | 14 | **407** | AED 92,884 | AED 61,783 |
| MV | 849 | 0 | 5 | 37 | **807** | AED 122,506 | AED 80,631 |
| **Total** | **1,339** | **31** | **43** | **51** | **1,214** | **AED 215,390** | **AED 142,414** |

Ties out: 31 + 43 + 51 + 1,214 = 1,339, variance 0. Exclusions are applied in order (d) → (e) →
(f), so each column counts only cases no earlier exclusion already cleared.

Collectable is capped by the wage floor as well as the deduction limit, which is why it is lower
than a straight `limit × findings` reading.

**Read the median before acting on the count.** Measured on the 1,307-row population of an earlier
run: median owed **AED 100** for CC and **AED 62** for MV. The totals are carried by a small number
of large balances, not by 1,214 substantial debts. A recovery drive aimed at the whole list would
spend more than it collects; the money is in the tail.

**These figures move between reads.** Re-querying the same month a day later returned CC 458 /
MV 849 where an earlier run gave 457 / 850, and the approved KPI's CC Total Loans read
14,000,349 against 13,992,719 earlier the same day. `HOUSEMAID_TYPE` is current state, maids
switch between CC and MV, and the warehouse refreshes. **Quote a figure with the date it was
read, never as a standing fact.**

The full funnel: **4,802** paid maids carrying a loan → **2,819** with nothing deducted →
239 cleared by (a) → **1,219** owed only an exit loan or insurance plan, out of scope → **1,339**
candidates → 31 (d) → 43 (e) → 51 (f) → **1,214 findings**.

**MV is the larger half — 807 of 1,214.** The check this replaces never looked at MV at all.

**March 2026**, same rules: 249 findings before the loan-type exclusion. Reported here only to
show the method reproduces on another month — see §6 for why the two months must not be compared.

#### 5A · Why the findings exist — one small rule was missing, the rest are real

Asked directly on 2026-09-11: is there a business rule this check is missing? **Six candidates were
tested against live data and all six were rejected.** Two were backwards.

| Candidate | Result |
|---|---|
| ACC-60, the sticky zero default repayment | `DEFAUL_MONTHLY_REPAYMENT` = 0 on 96.0% of the not-deducted **and 99.3% of the deducted** — no discrimination |
| A late-in-month loan cut-off | The ignored loans are the **oldest**: median 77 days vs 47 for the deducted |
| The Minimum WPS wage floor (PAY-4257) | Real, but 43 of 1,307 cases |
| A stated payroll exclusion reason | Blank on all 2,532 paid maids holding a loan |
| Maid status | Does not separate the groups |
| `MONTHLY_LOAN` not configured | Contributing — 49% missed when set, 66.5% when zero — but not causal |

**Then the ERP source itself was asked** (`ask_erp_code`, payroll module). It named
`Z_DeductionCapTransaction` and listed **eight** conditions that produce a zero repayment. One was
a rule this check did not have — **exclusion (f)**, the replacement-salary-start-date guard, now
added. It is worth **51 of 1,265 findings, 4.0%**. A null start date, also in the guard, fires
**zero** times.

**🔴 The decisive number: 1,214 of the 1,265 August findings satisfy none of the code's eight
conditions.** The ERP's own logic says they should have been deducted.

**And the decisive evidence from the data: 533 maids were deducted in July and not in August while
still owing. 487 held the identical payroll status in both months and 457 also had no salary
drop.** Nothing about them changed, so nothing can explain the difference. AED 101,645 missed in
August from that cohort alone.

Of the 1,287 maids carrying a loan in all of June, July and August, only **20.7% were deducted in
all three** and 16.4% in none — but **63% were deducted once or twice**. A rule that exempted maids
gives all-or-nothing; a mass in the middle is a process that misses.

**Plain terms:** the same maid, unchanged, is charged one month and not the next. This is not a
rule nobody told us about — it is the deduction simply not running reliably.

##### 🔴 And a separate bug: nine payroll columns are empty

Across four payroll files and roughly 102,000 rows, these are zero on **every row**:
`Amount Deducted From This Salary` · `Total Deductions This Month` · `This Month Forgiveness` ·
`Addition to balance deduction limit` · `Start Date Deduction` · `Complaint Deduction` ·
`Manager Deduction` · `Failed Interview Deductions` · `Replacement Deductions`.
`Loan Repayment` and `Remaining Loan Balance` populate normally in the same rows.

**This is why v1's exclusion (c) never fired.** It read `Amount Deducted From This Salary` — a dead
column — and its silence was read as *"nobody reaches the deduction limit"* rather than *"the
column is empty."* It also hides ACC-645's deduction-priority rule and makes forgiveness invisible.

Full measurement: [audit_intel/loan_repayment/why_maids_are_not_repaying_2026-09-11.md](audit_intel/loan_repayment/why_maids_are_not_repaying_2026-09-11.md).

#### 6 · 🔴 Run it on the current month only. Do not trend it, do not backfill it.

The loan ledger records **how much** of a loan has been repaid but **not when**. Today's repayment
total is subtracted from a months-old loan, so a loan that was open in March and settled in June
looks, from today, as though it was never open. Older months therefore lose maids from the
population, and they lose the *repaying* maids first — the ones who finished.

Measured over twelve months, maids paid while carrying a loan and the share with nothing deducted:

| | Sep-25 | Oct | Nov | Dec | Jan-26 | Feb | Mar | Apr | May | Jun | Jul | Aug |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Carrying a loan | 551 | 448 | 467 | 607 | 797 | 1,135 | 1,124 | 1,159 | 1,427 | 2,635 | 3,750 | 4,802 |
| Nothing deducted | 67.7% | 55.6% | 57.0% | 56.8% | 51.3% | 42.9% | 27.8% | 26.6% | 29.9% | 17.1% | 45.9% | 58.7% |

The population climbs 551 → 4,802 monotonically, which is the erasure above. The rate is
U-shaped, which is that erasure hitting the numerator and denominator at different speeds. Neither
line is a trend in behaviour.

**Plain terms:** every past month looks better than it was, and how much better depends only on how
long ago it was. Comparing months with this data answers nothing. Run the latest closed month, act
on it, move on.

##### A second cause was proposed for the July–August jump, and tested away

The deduction-restriction release (PAY-4257 / PAY-4309) landed in exactly the window where the
rate goes 17.1% in June → 45.9% in July → 58.7% in August, and it does the same thing to the
numbers — it stops deductions. It looked like the better explanation and **the measurement did not
support it.** Applied month by month, the new wage floor accounts for **4 cases in June, 11 in
July and 43 in August**, against jumps of hundreds. The ledger's missing repayment dates remain
the explanation; the release is a real but small second effect, now handled as exclusion (e).

**Why this is in the spec and not deleted:** the wrong hypothesis is worth a paragraph because it
is the obvious one, it will be proposed again by the next person who reads the Jira ticket, and
the answer is a measurement rather than an argument.

#### 7 · Report layout

One row per finding. Columns: month · maid type · live-in / live-out · nationality · status ·
salary start date · outstanding balance · deduction limit · **collectable** · loan types held.

Filters: maid type, live-in/live-out, nationality, loan type. Totals row carries M3, M4, M5.
Drill-down: her payroll row for the month, and her open loan ledger items.

Red on every row — a finding is a finding. No amber tier; the two exclusions absorb the grey cases.

#### 8 · The AI verifier

Before a finding reaches Payroll it is read by an AI verifier, which reads the maid's **real
staff-written complaint comments** — never a summary field — and returns one verdict.

**The six verdicts, fixed and identical in every check in this workspace:**
`JUSTIFIED` · `PLAUSIBLE` · `AMBIGUOUS` · `NOT_RELATED` · `UNRESOLVED` · `NO_TEXT`.
`NOT_READ` is a **run state, not a verdict** — a model error, timeout or exhausted budget stays
red and is counted apart, so *read and unexplained* is never confused with *never read*.

**Categories**, set only for JUSTIFIED, PLAUSIBLE and AMBIGUOUS and **null** for the other three:
1 salary hold · 2 loan waived or cancelled · 3 leaving or terminated · 4 payroll correction in
progress · 5 client or contract dispute · 6 recently joined or returned · **7 replacement or
contract change mid-month** · **8 loan disputed by the maid**.

Categories 7 and 8 were added 2026-09-11. Seven exists because the ERP's own
`replacementSalaryStartDate` guard proved real — a case the rules missed will usually read as a
replacement in the text before it shows up in a field.

**Evidence source:** `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS` joined to `COMPLAINT_COMMENTS`
on `COMPLAINT_ID`, reading column **`TEXT`** (rendered) — never `ORIGINAL_TEXT` (raw HTML). Names,
phone numbers, emails, URLs and ids are redacted **at the model**, before the verdict leaves it.
Every verdict carries a verbatim quote and its `threads_read` count.

##### The prompt

One verifier per case — never batch several into one call, or an angry thread primes the next.

```
You are an audit verifier for the maids.cc Loan Repayment Check. Judge ONE case.

THE CASE ({month})
- HOUSEMAID_ID = {maid_id}
- {maid_type}, {live_in_or_out}, {nationality}, status {status}, salary start {salary_start}
- Still owed AED {owed} across: {loan_types}
- Nationality deduction limit AED {cap}
- We PAID her that month and deducted AED 0

ALREADY RULED OUT BY THE CHECK — do not offer these as explanations:
  (a) her pay was at or below her accommodation salary
  (d) she joined that month with under 20 days
  (e) deducting would breach the wage floor, 0.85 x (MOHRE salary + holiday)
  (f) her start date or replacement-salary start date falls inside the month
Exit loans and unemployment insurance plans are out of scope and are not part of the balance above.

THE QUESTION: does anything staff actually wrote explain why NO loan deduction was taken?

EVIDENCE — read the real comment text, never a summary field:
  SELECT c.ID, c.STATUS, c.CREATION_DATE, cc.CREATION_DATE, cc.TEXT
  FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
  JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS cc ON cc.COMPLAINT_ID = c.ID
  WHERE c.HOUSEMAID_ID = {maid_id} AND cc.CREATION_DATE >= '{month_minus_4}'
  ORDER BY cc.CREATION_DATE;
Use TEXT, never ORIGINAL_TEXT. If it returns nothing, widen to all dates before concluding
there is no text. If resultSetMetaData.numRows exceeds the rows you received, page — a partial
read that looks complete is the one failure this check cannot tolerate.

VERDICTS — exactly one. This list is fixed and identical in every check in this workspace:
  JUSTIFIED    the text plainly explains why no deduction was taken
  PLAUSIBLE    the text points at a likely reason but does not state it
  AMBIGUOUS    text touches the loan or her salary but could be read either way
  NOT_RELATED  text exists but has nothing to do with her loan or salary
  UNRESOLVED   related text exists and still does not explain the missing deduction
  NO_TEXT      no staff-written comment exists at all

CATEGORY — set category_id ONLY for JUSTIFIED, PLAUSIBLE or AMBIGUOUS. It MUST be null for
NOT_RELATED, NO_TEXT and UNRESOLVED.
  1 salary hold · 2 loan waived or cancelled · 3 leaving or terminated
  4 payroll correction in progress · 5 client or contract dispute
  6 recently joined or returned · 7 replacement or contract change mid-month
  8 loan disputed by the maid

REDACTION — redact inside your own output before returning it. Every person name, phone number,
email, URL and complaint id inside a quote becomes [name] / [phone] / [email] / [url] / [id].
Amounts and dates stay.

RULES
- Read the actual text. A label, a status or a complaint category is a pointer, not an explanation.
- A waiver written in a thread counts as JUSTIFIED even when the ledger still shows the loan open:
  that gap is a known data defect, not a reason to disbelieve the text.
- Absence of evidence is NO_TEXT or UNRESOLVED. Never invent a reason.
- If you cannot complete the read, return run_state "NOT_READ" and say why. NOT_READ is a run
  state, not a verdict.

Write the result to disk first, then return this JSON and nothing else:
{"maid_id":…,"verdict":"…","category_id":null,"threads_read":…,"complaints_seen":…,
 "quote":"…","reasoning":"2 sentences max","run_state":"OK"}
```

**`run_state` is mandatory and must be validated on receipt** — 5 of the first 10 runs omitted it,
and a missing run state is indistinguishable from a successful one.

##### What it found

Ten cases — the largest in-scope balances in August 2026, one verifier each. **741 staff comments
read in total**, between 7 and 230 per case. Zero `NOT_READ`.

| Verdict | Cases | Meaning |
|---|---|---|
| JUSTIFIED | 1 | The text explains the missing deduction |
| PLAUSIBLE | 1 | Points at a reason without stating it |
| UNRESOLVED | 4 | Related text exists and explains nothing |
| NOT_RELATED | 4 | Text exists, none of it about her loan or salary |
| AMBIGUOUS · NO_TEXT · NOT_READ | 0 | — |

**Eight of ten stand as genuinely unexplained.** In no case did anyone write down why the
deduction was skipped. Redaction held: zero raw phone numbers, emails or URLs across all ten.

##### The two that did not stand, and what each one broke

**🔴 JUSTIFIED — and it exposes a hole in the ledger.** Case 34516, AED 5,117 on a flight ticket.
58 comments read. Staff wrote: *"We will waive the remaining OB and please inform the client that
the 1000 AED that was removed from her salary will be refunded"*, after a supervisor ruled the
ticket be booked *"without adding it to her outstanding balance."*
**The loan was waived in April 2026 and the ledger still shows it open in August.** `WAIVED_AMOUNT`
did not capture a waiver a supervisor granted in a complaint thread. This check would have sent
Payroll after a debt that no longer exists. See O7 — this is a data gap, not a reading error.

**🔴 PLAUSIBLE — and it contradicts the population flag.** Case 137541, AED 6,269, salary start
06 Aug. 100 comments read. Staff wrote on 21 August: *"the maid did not receive any salary yet
from the company… This is going to be receive by the maid on September 1."*
Her August payroll row says `IS_TRANSFERRED = 'YES'`. **Payroll says we paid her; staff say she had
not been paid.** Either the flag means *authorised* rather than *paid*, or the comment refers to
something else. See O8 — it is the flag the whole population rests on.

**Plain terms:** the verifier read 741 real comments and cleared only one case out of ten. But the
two it did not leave standing each found a defect worth more than the case itself — one in the
loan ledger, one in the field this check uses to decide who is even in scope.

#### 9 · Open items

| | Question | Why it matters |
|---|---|---|
| O1 | Should a maid be deducted in her **joining month** at all? Exclusion (d) currently allows it once she has worked 20 days. | Sets the size of the new-joiner cohort |
| O2 | Terminated maids still carrying balances — own check, or here? 5,479 currently carry one and payroll can no longer reach them. | Scope |
| O3 | Should *"deducted less than the limit"* also be a finding, not just *"deducted nothing"*? | Widens M3 |
| O4 | `DEDUCTIONS` is one lump sum — a fine and a loan repayment are indistinguishable in it. A maid deducted only for a fine reads as "deducted" and is excluded. | Makes the check too lenient by an unmeasured amount |
| O5 | The payroll workbook reports far fewer maids owing money than the ledger does — of 110 CC findings tested in March, its `Remaining Loan Balance` read zero on 96. Ruled 2026-09-10 that **any loan counts**, so the ledger governs; the workbook's narrower figure is unexplained. | Explains the size difference against the sheet |
| O6 | `UNEMPLOYMENT_INSURANCE_PREMIUM` and `_FINES` are kept because the ruling named only the **plan**. Dropping them too gives 1,232 findings and AED 155,498. | 75 cases |
| **O7** | **A waiver granted in a complaint thread does not reach `WAIVED_AMOUNT`.** Confirmed on case 34516: waived April 2026, still open in the ledger in August. How many of the 1,264 are already-waived debts is **unmeasured**. Related and already open with the dev team: **PAY-4416**, loans recorded in accounting not appearing on maids' balances, closed *"Not a Defect"* on the theory that a scheduled job only runs every couple of days. | **False findings sent to Payroll** |
| **O8** | **`IS_TRANSFERRED = 'YES'` may mean authorised rather than paid.** On case 137541 the flag says paid in August while staff wrote on 21 Aug that she had received no salary and would be paid 1 September. | **The population rule of the whole check** |
| O9 | The verifier contract must make `run_state` **mandatory and validated** — 5 of the 10 runs omitted the field. A missing run state is indistinguishable from a successful one. | Verifier integrity |
| O10 | Netting direction must be stated: per-maid netting gives 2,526 findings, per-loan-type netting gives 2,530. Four maids hold a loan item with a negative (overpaid) balance. | 4 cases |
| O11 | Exclusion (e) uses the **unprorated** wage floor; the Jira rule prorates it by working days. This check is therefore slightly more generous to the maid and clears marginally fewer cases. | Small, direction known |
| O12 | **ACC-60 describes this check's findings as a known ERP behaviour** and has no resolution set. Is it still live? | Could be the single largest cause |

##### What the ERP already does about this — prior art in Jira

Read before proposing a fix; three of these are the mechanism, not a coincidence.

| Ticket | What it says | Why it matters here |
|---|---|---|
| **ACC-60** · Done, no resolution | When a loan is fully repaid the default repayment drops to 0 and **stays** 0, so *"if a future loan is added the repayments are not added due to default repayment persisting at 0"* | Describes these findings exactly. A maid who cleared an old loan and took a new one gets **no deduction set at all** |
| **ACC-645** · Done | The limit covers **all** deduction types and other deductions **outrank** loan repayment: *"if an ethiopian maid has 300 AED deduction + 200 loan repayment we should deduct her 300 deduction + 50 loan repayment"* | Confirms O4 — a fine eating the limit is a correct reason for little or no loan repayment |
| **PAY-4257 / PAY-4309** · Done | The Minimum WPS Requirement wage floor, extended to MV maids for the first time | Exclusion (e). Measured at 3% of cases, not the main cause |
| **PAY-4416** · Closed *Not a Defect* | Loans recorded in accounting not showing on maids' balances; theory is a scheduled job running every couple of days | Same family as O7's waiver gap, already with the dev team |
| **DNA-9134** · Done | The Loan Deductions dashboard showed 12.4M in its table against 22.4M in its donut | A display bug, **not** a data error — re-checked 2026-09-11: the model holds only CC and MV rows and they sum to 22,989,081 exactly |

Measurement detail, queries, funnel counts and the ten verdict files:
`audit_intel/loan_repayment/` and `audit_intel/loan_repayment/verdicts/`.


---

## Part 5 — With Client, No Contract

### With Client, No Contract — audit spec v3

**Requested by:** Abdullah Mahdi, Police & Control
**For:** the Snowflake team
**Report mockup:** https://claude.ai/code/artifact/cb8cd4a3-67dc-4b7f-9d21-8ac720ff0344
**Changelog:** [spec_history/with-client-no-contract.md](spec_history/with-client-no-contract.md)
**Data as of:** 2026-09-09 19:38 GST

> **Read this before anything else.** v1 reported 116 red cases and AED 120,274. v2 reported 5
> and AED 5,970. **Correctly computed, this check finds 2 cases, both 10 days old, AED 3,500.**
> Every reduction was a defect, listed in the changelog. And the headline finding of both earlier
> versions — a maid "with a client" for 298 days — was a maid who had been working at that client
> for ten months and was replaced the day before. Abdullah Mahdi caught it from one ERP screenshot.
>
> **My recommendation is not to build this as a dashboard.** Section 6 says why, and names three
> findings from the same work that are worth more than the check is.

---

#### 1. What this check is for

A CC maid working at a client has two records that must agree: her profile status says
`WITH_CLIENT`, and a live client contract names her as its maid. When the first is true and the
second is not, either she is at a client nobody is billing, or she is not at a client and her
status is wrong — and those need opposite fixes.

**Who reads it:** Maid Management. **Action:** find out which of the two it is; tag the contract,
or correct the status and redeploy her.

**Today: 2 cases**, both 10 days in the state, both from `RESERVED_FOR_PROSPECT`, both drew
transferred August pay — AED 3,500 between them.

---

#### 2. Population and the red condition

| | |
| --- | --- |
| **One row per** | maid |
| **In scope** | Status `WITH_CLIENT`, maid type `Normal` / `FREEDOM_OPERATOR` / `WALKIN`, no live cleaner tag |
| **Out of scope** | Cleaners (below) · `MAID_VISA` maids (§6) |
| **Red** | No active contract names her, **and** more than 7 days in that state |
| **Watch** | Same, 7 days or fewer. Shown, not a finding |

**Today's funnel, one snapshot:** 5,558 in scope → 5,513 tagged → **45 untagged** → 2 red, 43
watch. The median untagged maid has been untagged **1 day**. This is a well-controlled process
with a very short tail.

**Cleaners are excluded, and here is the real reason.** Of 117 maids with a live `cleaner` or
`cleaner-weekly` tag and status `WITH_CLIENT`, **117 are untagged** — every one — against 45 of
5,558 non-cleaners. They are not placed on client contracts, and payroll holds them out
deliberately: `HOUSEMAID_PAYROLL_HISTORY.MANUAL_EXCLUSION_REASON` carries the text
*"Cleaners will be paid out of ERP based on Eliana confirmation"* on 354 rows. Including them
makes 96% of the report noise that refills monthly. **Read the tag from
`HOUSEMAID_TAGS_LOGS.IS_ACTIVE`, never from the flattened `HOUSEMAIDS_INFO.TAGS` string**, which
also matches `was_cleaner` — a former cleaner back on normal work.

**Why those three maid types are "CC".** There is no `CC` value in `HOUSEMAID_TYPE`. Established
from data: active CC contracts carry only those three types, active MV contracts only
`MAID_VISA`, no crossover. (`BI_REPLACEMENTS_REFUSALS_LOGS.HOUSEMAID_TYPE` does hold the
company's own `CC Live In` / `CC Live Out` / `MV` labels if a live-in split is ever needed.)

---

#### 3. 🔴 How to measure "more than 7 days" — read this section twice

**The tagging history in Snowflake cannot answer this question today.** Three sources record when
a maid was tagged to a contract, and they disagree:

| Source | Live CC contracts | Names the right maid | Matches `CONTRACTS.TAG_DATE` | No open row |
| --- | --- | --- | --- | --- |
| `CLIENT_MANAGEMENT_SILVER.REPLACEMENTS` | 5,545 | 5,300 (96%) | 246 (**4.4%**) | 235 |
| `CLIENT_MANAGEMENT_SILVER.CLIENT_REPLACEMENTS` | 5,534 | 3,839 (69%) | 245 (**4.4%**) | 1,692 |

Neither agrees with the contract's own tag date more than about one time in twenty, and they
disagree with each other on which maid holds 31% of live contracts. On the case that mattered
most, `REPLACEMENTS` recorded a ten-month placement as lasting **two seconds** while
`CLIENT_REPLACEMENTS` had it right; at population scale `REPLACEMENTS` is the more reliable of
the two on maid identity. There is no source here that is right about both.

**So do not reconstruct the duration from history. Snapshot the present instead.**

**M4 — the required build.** Write one row per maid per day to a snapshot table: the maid, and
whether the condition (`status = WITH_CLIENT` **and** no active contract) held that day. Both
inputs are current-state fields that *are* reliable. `M4 = the number of consecutive daily
snapshots, ending today, in which the condition held.` Red at more than 7.

This is what *"been this way for more than 7 days"* actually means, it is immune to every defect
below, and it needs no history table to be correct — only time.

**Until the snapshot table has 8 days of history**, M4 has to be reconstructed, and the
reconstruction is **provisional and known-imperfect**: `GREATEST(last untag, the day she was set
to WITH_CLIENT)`, taking the untag from `CLIENT_REPLACEMENTS.OLD_HOUSEMAID_UNTAGING_DATE`. Its
four known error modes, all measured:

1. **Wrong untag dates** — the defect above. 2 of the 45 untagged maids have untag dates that
   disagree between the two ledgers, and that was enough to produce a 298-day phantom.
2. **A brief re-tag resets it.** A one-day tag counts as a placement ending, so the clock restarts.
   Requiring a tag to have lasted over 7 days fixes one case and misses eleven.
3. **A status bounce resets it.** All 45 untagged maids last entered `WITH_CLIENT` from some other
   status, and 44 of the 45 within 24 hours of leaving it. Each bounce restarts the clock, so a
   maid unplaced for months can read 0 days.
4. **`HOUSEMAIDS_INFO.STATUS` lags `HOUSEMAID_STATUS_LOGS`.** The log showed one maid moving to
   `SICK_WITHOUT_CLIENT` at 19:01 while the profile still read `WITH_CLIENT` at 19:15. The
   population comes from one and the cause from the other; they can disagree.

**Any red case produced by the reconstruction must be checked against the contract before it is
acted on.** A maid tagged to a contract inside the window cannot be a red case — that single gate
would have killed the 298-day phantom.

---

#### 4. Data points

Every object and column read live and returned data. Every join key is `NUMBER` to `NUMBER`.

| # | What it gives | Object | Columns (type) |
| --- | --- | --- | --- |
| D1 | Status and type — **current state, reliable** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID` num · `STATUS` txt · `HOUSEMAID_TYPE` txt |
| D2 | Which maid a contract names — **current state, reliable** | `BA_VIEWS.SALES_SILVER.CONTRACTS` | `ID` num · `HOUSEMAID_ID` num · `CONTRACT_STATUS` txt · `CONTRACT_TYPE` txt · `TAG_DATE` ts |
| D3 | Cleaner tag state | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TAGS_LOGS` | `HOUSEMAID_ID` num · `TAG_NAME` txt · `IS_ACTIVE` bool |
| D4 | Where she came from | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID` num · `TO_STATUS` txt · `FROM_STATUS` txt · `CHANGE_DATE` ts |
| D5 | Whether money left | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID` num · `PAYROLL_MONTH` date · `NET_SALARY` flt · **`IS_TRANSFERRED` txt** · `MANUAL_EXCLUSION_REASON` txt |
| D6 | Untag dates — **provisional only, see §3** | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_REPLACEMENTS` | `CONTRACT_ID` num · `OLD_HOUSEMAID_ID` num · `NEW_HOUSEMAID_ID` num · `OLD_HOUSEMAID_UNTAGING_DATE` ts |
| D7 | The daily snapshot — **to be created** | new table | maid id · snapshot date · condition held (bool) |

**No approved KPI covers the maid side.** The client-side mirror has one:
`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER`, semantic id
`client-management-dashboard__family-management-families-without-a-maid`, reading
`BI_CLIENTS_WITHOUT_MAIDS` with `CATEGORY IN ('LIVE_IN','LIVE_OUT')`, `IS_FROZEN = FALSE` and
`DATEDIFF('day', MAID_UNTAGGED_DATE, CURRENT_DATE()) >= 4`. It answers the client-side question
(190 families today), not this one, so it is not the definition to reuse here. Noted only so
nobody is surprised that the two halves of the same broken link carry different allowances: the
client side allows 3 days, the maid side allows 7. **The maid-side allowance is 7 days — settled
by Abdullah Mahdi, not open.**

##### Traps, each one measured

1. **The literal is `WITH_CLIENT`** — underscored, upper case.
2. **`IS_TRANSFERRED` is TEXT `'YES'`/`'NO'`.** `= TRUE` returns zero rows and no error. A payroll
   row can exist with a non-zero `NET_SALARY` and never have been transferred — 44 of 51 in v1's
   population, which overstated the money eightfold. `IS_DELETED` is also TEXT (one row holds
   `'01'`, none in scope); `CONTRACTS.IS_FROZEN` is BOOLEAN.
3. **🔴 `HOUSEMAIDS_INFO.LOCATION_CATEGORY` is not where she is.** Its values are `INSIDE_UAE`,
   `OUTSIDE_UAE`, `PHILIPPINES`, blank — and **73% of maids provably working in UAE homes are
   marked as not in the UAE** (3,047 + 976 of 5,513). It is country of hire. v1 and v2 used it as
   an "out of country" flag on three named maids; it fires at the population base rate and
   discriminates nothing. **Do not build any flag on it.** No field in these sources establishes
   whether a `WITH_CLIENT` maid is in the country; none of the 45 carries a visa cancellation, a
   termination date or a missing landing date.
4. **`STATUS_CHANGE_REASON` is not why she entered `WITH_CLIENT`** — it is her most recent status
   change reason, agreeing with the actual transition in 44 of 164 cases. Take the cause from D4.
5. **41 of the 47 untagged maids have more than one transition into `WITH_CLIENT`; one has 38.**
   Any metric reading D4 must state which row it picks. This spec picks the latest by
   `CHANGE_DATE`, and M4 and M8 both use that one rule.
6. **D5 is not one row per maid per month** — 8 maids carry duplicate August rows. Deduplicate.
7. **A frozen contract is still `CONTRACT_STATUS = 'ACTIVE'`** (173 of 5,834), so freezing creates
   no false positive here. The approved client-side definition does exclude frozen; the divergence
   is deliberate.
8. **The untagged layer churns faster than the threshold it is measured against.** M3 read 47, 52
   then 45 within twenty minutes; red read 5, 4, 3, then 2. Two of v2's five worked examples left
   the population within an hour of its own timestamp. Derive M1, M2 and M3 from **one query**,
   stamp every run to the minute, and treat M5 as a moment, not a month.

Checked, no filter needed: `CONTRACTS.FAKE` (0 on active CC), `IS_DELETED`, `DATE_OF_TERMINATION`
(1 of 45). One maid holds two active contracts; M2 uses existence so she cannot double-count. M2
does not filter `CONTRACT_TYPE='CC'` — checked, no CC maid sits on an active MV contract.

---

#### 5. Metrics

AED, whole dirhams, totals rounded not rows. Day counts are whole days; `CURRENT_DATE()` follows
the session `TIMEZONE` parameter, which must be stated on the build because a `> 7` boundary turns
on one day.

| ID | Metric | Formula | Null / edge handling |
| --- | --- | --- | --- |
| **M1** | Population | Count D1 where `STATUS='WITH_CLIENT'` and `HOUSEMAID_TYPE IN ('Normal','FREEDOM_OPERATOR','WALKIN')` and no D3 row with `IS_ACTIVE` and `TAG_NAME IN ('cleaner','cleaner-weekly')` | Absent from D3 = not a cleaner |
| **M2** | Correctly tagged | M1 maids who are `HOUSEMAID_ID` on ≥1 D2 row with `CONTRACT_STATUS='ACTIVE'` | Existence, not count |
| **M3** | Untagged | M1 − M2, same snapshot | — |
| **M4** | Days in state | Consecutive daily D7 snapshots, ending today, where the condition held. **Interim:** see §3 | Interim result is provisional; gate every red case against D2 |
| **M5** | Red | Count M3 where M4 **> 7** | 7 days is Watch, not red |
| **M6** | Cases by cause | Count M3 grouped by `D4.FROM_STATUS` on the latest `TO_STATUS='WITH_CLIENT'` row | No log row is its own bucket |
| **M7** | Transferred exposure | `SUM(NET_SALARY)` over M5 maids, **deduplicated to one row per maid**, where `IS_TRANSFERRED='YES'`, for `PAYROLL_MONTH = DATE_TRUNC('month', as_of) - 1 month` | No row, `'NO'`, or zero net → 0 not null. If the prior month's rows have not landed, show a dash and say so — `MAX(PAYROLL_MONTH)` is already the current open month |
| **M8** | Median days | `MEDIAN(M4)` over M5, whole days, `.5` up | Dash if M5 is empty |

**Flags.** Red — over 7 days. Watch — 7 or fewer. Grey — clock unavailable, shown as a data gap,
never hidden. Never colour alone: label and glyph on every flag.

**Tie-out, one snapshot:** `M1 = M2 + M3` and `M3 = M5 + Watch`. At 19:38: 5,558 = 5,513 + 45,
and 45 = 2 + 43. A failing identity is published as its own row.

---

#### 6. Worked examples, and what this check is worth

**Both of today's red cases.** Maid `111839` (Normal) and maid `37350` (Freedom Operator), each
10 days in the state, each entered `WITH_CLIENT` from `RESERVED_FOR_PROSPECT`, each drew
transferred August pay — AED 3,500 between them. Both are ordinary reserve-then-stall cases: a
maid held for a prospective client whose contract was never tagged.

**The case that was not a case.** Maid `91278` was published by v1 and v2 as 298 days in the
state — the finding that justified the whole check. She was tagged to contract `1046822` on
2025-11-15 and untagged on **2026-09-08**, having worked there ten months, and was replaced by
maid `137857`. Her salary started 2025-11-21 and she was paid and transferred every month from
November to August. `REPLACEMENTS` recorded that placement as two seconds long. Her real M4 is
**1 day**. The check's own source table manufactured its flagship finding.

**Why I recommend against building this as a dashboard.** 2 findings, both 10 days old, in a
population of 5,558, where the median untagged maid is re-tagged within a day. The process
works. A weekly one-line alert — *"these maids have been WITH_CLIENT with no contract for over a
week"* — delivers the same value. **Abdullah Mahdi's call, not mine**, and if he wants the
dashboard the spec above builds it.

**Three findings from this work that are worth more than the check:**

1. **117 cleaners sit permanently in `WITH_CLIENT`** — every company count of "maids with a
   client" is overstated by 117, and 5 of them drew AED 11,165 of transferred August pay while
   parked with no contract.
2. **`LOCATION_CATEGORY` is country of hire, not whereabouts** (trap 3). Any check that reads it
   as location will produce confident nonsense. Two versions of this spec did.
3. **The maid-to-contract tagging history is not reliable** (§3) — 4.4% date agreement across
   three sources. Every check that reasons about *when* a maid was placed is exposed, including
   ones already built.

**Settled — do not reopen**

- **The allowance is 7 days.** A maid may be `WITH_CLIENT` with no contract for up to 7 days. Past
  that she is a finding. Ruled by Abdullah Mahdi, 2026-09-09. The client-side dashboard's 4-day
  figure is a different question about a different population and does not govern here.

**Open items for Abdullah Mahdi**

1. **Is M7 pro-rated?** It charges a whole month's salary to a case that may be 8 days old. Fine
   as an exposure ceiling — say so, or pro-rate it. Must be settled before build.
2. **Who owns the 117 parked cleaners and the AED 11,165?** Not this check.
3. **MV is unaudited:** 129 `MAID_VISA` maids are `WITH_CLIENT` with no active contract, before
   any cleaner or clock correction.
4. **Does the daily snapshot table (D7) get built?** Without it, M4 stays provisional and every
   red case needs a manual contract check.


---

## Part 6 — Manager Notes

### Spec — Manager Notes Overpayment Check

| | |
| --- | --- |
| **Requested by** | Police & Control |
| **Spec version** | v2 |
| **Date** | 2026-09-15 |
| **Supersedes** | `SPEC_manager_notes_check_v1.md` (same day — v1's C1, C3 and C4 carried rules that later measurement disproved) and `SPEC_manager_notes_audit_v1/v2/v3.md` / `_DEV.md`, which are investigation documents, not build specs |
| **Status** | 🟢 **Ready to build — no blocking open items.** Two rule decisions and one coverage boundary closed the three that remained; one measurement (O-C2) is queued before *publication*, not before build |
| **Evidence** | `OVERPAYMENT-LEDGER.md` · `queries/FINDINGS-RUN.sql` · `queries/absconded-payment-date.sql` · `queries/anti-attrition-abscondment-cases.sql` · `runs/2026-09-12month-audit-run.md` |

---

#### 1. Business Logic

**What a manager note is.** A line added to a housemaid's payslip outside her salary — an allowance,
a bonus, a reimbursement, a correction. Some are typed by a person; most are written by ERP itself.
**24 payment types, AED 6.85m in a rolling twelve months.**

**The control.** Every addition should be traceable to a rule that entitles that maid to that amount
on that day. There is no single gate: each payment type has its own rule, some in code, some in
config, some only in somebody's head.

**Plain terms:** we pay a maid something extra; this checks that she was owed it.

**The failure it catches.** Four shapes, and the spec names them because they need different actions:

| Archetype | Meaning |
| --- | --- |
| **not deserved** | She did not meet the condition the payment exists for |
| **off-rule** | A stated rule was broken — the money may still have been owed |
| **paid twice** | The same entitlement paid more than once |
| **control violated** | The authorisation path was bypassed; money may be correct |

**What this check does NOT judge**, each settled by the requestor rather than assumed:

| Excluded | Ruling |
| --- | --- |
| **Deductions** | Out. `NOTE_TYPE = 'ADDITION'` only. Money taken *from* a maid is not audited here or anywhere |
| **Zero-amount notes** | Out. `AMOUNT > 0` is mandatory in **every** check — see §2.5 hygiene 1, which is why |
| **Money paid outside payroll** | Out of scope. ~15 notes say "paid manually" and were then zeroed. **Every total in this check has that hole in it**, and the page must say so |
| **Who may edit a note's amount or date** | Out — "we don't care about that cycle" |
| **Whether zeroing is the sanctioned cancellation** | Out |
| **ERP re-generating an already-paid addition** | Not ours. Hand the two evidence notes to payroll |
| **Self-approval** | Out of scope, ruled 2026-09-09 after three rounds of correct method on an excluded number |
| **The ERP's proration arithmetic** | 🔴 **Out, ruled 2026-09-15.** A maid who leaves mid-month **keeps the prorated part she worked**. The ERP already does this correctly and it is not to be questioned. Only the part paid for days after she left is a finding |
| **Whether a `NO_SHOW` maid should be on a retention scheme at all** | 🔴 **Closed 2026-09-15, not raised.** `Housemaid.rejectedStatuses` deliberately omits every `NO_SHOW*` value, so paying them is config, not a defect — and 63 of the 108 such notes went to maids **back at work on the day payroll ran** |
| **n8n-sent and notifier templates** | Never in scope |

**Reader and action.** Police & Control opens the dashboard and picks a window. A red row is one
note: open it, decide whether the money was owed, recover or excuse it.

**Grain. One row per NOTE**, not per maid. Every note is its own payment event with its own rule and
its own date, and a maid may hold notes on several types. *(This differs from the GCC checks, which
are per-maid because recovery is held per maid. Here there is nothing to allocate.)*

**Population in scope.** `NOTE_TYPE = 'ADDITION'`, `AMOUNT > 0`, inside the window the user picks.
In the twelve months to 2026-09-15: **16,831 notes, AED 6,851,419** across 24 types.

🔴 **What the build covers, stated so the gap cannot be mistaken for a clean result.** The eleven
checks score **AED 30,441 of red across the AED 6,851,419 examined**. Three payment types carry money
that **no check tests at all**, because no rule exists yet to test against — not because they passed:

| Type | AED | Why untested | Owner |
| --- | ---: | --- | --- |
| `Maids.at other expenses` | 51,260 | No entitlement rule exists. Seven departments raise it, at two distinct tariffs | George Abboud (K1) |
| Office work | 13,140 | Unknown whether she must be assigned on the day she is paid | George Abboud (L2) |
| Airfare — "renewal bonus on switch to MV" | ~32,500 | May be a different entitlement booked under the airfare head. **Excluded and named**, never scored against the airfare rule | George Abboud (A8) |
| `Bonus`, the non-referral part | **~865,000 of 876,316** | 🔴 **`Bonus` is a heterogeneous head.** At least seven purposes sit under it: referral (maid→maid), signing, **referral of a *client***, renewal/vacation bonus on MV switch, **ticket/flight allowance**, **Abu Dhabi Incentive**, MMR cases. **C2 can only ever test the first two** — `HOUSEMAID_REFERRALS` is maid→maid via `REFERRED_MAID_ID`, so for every other purpose the authorised amount is **0 by construction** and any `paid > authorised` rule fires on all of them. No entitlement source exists for client referrals or retention promises | George Abboud (new — C2q) |

**These do not block the build.** They are a coverage boundary, and the page must show them as
**grey — "no rule exists to test this"** — never as green. A type with no rule is not a clean type.

**Refresh expectation.** 🔴 **Live. There is no fixed window** — the dashboard reads current data in
whatever window the user selects. §3's *Check design* rule exists entirely because of this.

---

#### 2. Data Points Needed

##### 2.1 Verified — already in Snowflake

| # | Data point | Table | Columns | Verification |
| --- | --- | --- | --- | --- |
| D1 | **The addition** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID`, `HOUSEMAID_ID`, `EXPENSE_ID`, `NOTE_TYPE`, `REASON`, `NOTE_REASON`, `AMOUNT`, `NOTE_DATE`, `REQUESTED_BY`, `APPROVED_BY`, `MANAGER` | 16,831 additions / AED 6,851,419 in 12 months. `REASON` is the payment type |
| D2 | The authorising expense request | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `REQUEST_STATUS`, `AMOUNT`, `CURRENCY_NAME`, `REQUESTED_BY`, `APPROVED_BY`, `BENEFICIARY_NAME`, `EXPENSE_PAYMENT_ID`, `CREATION_DATE`, `REFUNDED`, `REFUND_DATE` | Joins on `D1.EXPENSE_ID`. **11,819 of 16,831 notes carry one. 5,345 carry none** |
| D3 | Expense head configuration | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | `EXPENSE_TYPE`, `CODE`, `APPROVAL_METHOD`, `LIMIT_FOR_APPROVAL`, `APPROVE_HOLDER`, `REQUIRE_INVOICE`, `ALLOW_TO_ADD_LOAN` | **Not unique on `EXPENSE_TYPE`** — deduplicate or every downstream sum inflates |
| D4 | **Contract type, as of** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID`, `TO_TYPE`, `FROM_TYPE`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | `TO_TYPE` ∈ {`MV`, `CC Live In`, `CC Live Out`}. 🔴 **`MV`, never `MAID_VISA`** — a `LIKE '%MAID_VISA%'` matched nothing and silently suppressed a real signal. Closed intervals — containment, no window function |
| D5 | **Status, as of** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID`, `TO_STATUS`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | Same shape as D4. Carries the `NO_SHOW_*` family |
| D6 | Maid master record | `…HOUSEMAIDS_INFO` | `ID`, `NAME`, `NATIONALITY`, `START_DATE`, `DATE_OF_TERMINATION`, `PRIMARY_SALARY`, `BASIC_SALARY`, `ACCOMMODATION_SALARY` | 🔴 **Current state only.** `DATE_OF_TERMINATION` is **not cleared on re-hire** — it killed a whole finding once |
| D7 | Point-in-time maid attributes | `…HOUSEMAIDS_INFO_REVISION` | `ID`, `LIVE_OUT`, `START_DATE`, `REPLACEMENT_SALARY_START_DATE`, `LAST_MODIFICATION_DATE` | Envers. **No `NEXT_CHANGE_DATE`** — needs "latest revision at or before the note" |
| D8 | Referral entitlement | `…HOUSEMAID_REFERRALS` | `HOUSEMAID_ID`, `REFERRED_MAID_ID`, `AMOUNT`, `IS_CANCELLED`, `IS_REQUESTED_BONUS`, `BONUS_REQUEST_DATE` | `HOUSEMAID_ID` is the **referrer**. The authorised amount |
| D9 | Referral bonuses paid | `…MAIDS_REFERRALS_BONUSES` | `REFERRED_HOUSEMAID_ID`, `BONUS_AMOUNT`, `PAYROLL_NOTE_DATE` | 🔴 **Built from the same `payrollmanagernotes` source** — circular as a price source. Paid amount only |
| D10 | Anti-attrition enrolment | `…HOUSEMAID_MANAGERACTIONLOGS` | `HOUSEMAID_ID`, `ACTION_TYPE`, `CREATION_DATE`, `ACTION_DATE` | `ACTION_TYPE ILIKE '%Incentive%Experiment%'`. **Use `CREATION_DATE`, not `ACTION_DATE`** — the latter is caller-supplied and never re-stamped on update. ⚠️ `INCENTIVE_AMOUNT` is **not exposed**; this view's `AMOUNT` maps to `DEDUCTION_AMOUNT` (I4) |
| D11 | Staff identity | `BA_VIEWS.CORE_SILVER.USERS_INFO` | `ID`, `NAME`, `EMAIL`, `IS_ACTIVE` | Name→email bridge. `IS_ACTIVE` is **numeric**, encoding unverified |
| D12 | Staff department | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF` | `EMAIL`, `DEPARTMENT`, `JOB_TITLE`, `MANAGER_EMAIL` | 767 rows. **No name and no id — email only**, so D11 is mandatory |
| D13 | Department history | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES` | `EMPLOYEE_NAME`, `EMPLOYEE_EMAIL`, `DEPARTMENT_NAME`, `PREVIOUS_/NEW_DEPARTMENT_NAME`, `CHANGED_AT`, `IS_DEPARTMENT_CHANGE` | **Joins by NAME** — `EMPLOYEE_EMAIL` is null on thousands of rows. History starts **2025-06-15** |
| **D14** | 🔴 **The payslip — NEW in v2, and mandatory** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH`, `ADDITIONS`, `PAID_ON_DATE_FORMATTED`, `IS_TRANSFERRED`, `STATUS` | From `mmdb.housemaidpayrolllogs`, one row per maid × payroll month. **`PAID_ON_DATE_FORMATTED` is the day money actually moved**; `IS_TRANSFERRED` says whether it moved at all. Without this the check cannot tell a payment from a note about a payment |

##### 2.2 Approved KPI definitions reused

**One.** The undeducted-loan KPI in `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (CC 80.2% /
MV 95.2%) is used **only** to contradict a wrong reading of a loan field; it defines none of the money
here. Every metric in §3 is a **new Police & Control definition** and should be added to the Data
Catalog.

##### 2.3 New data ingestion request

| # | Column | Table | Why |
| --- | --- | --- | --- |
| I1 | `CREATOR` (`BIGINT` → `USERS.ID`) | `payrollmanagernotes` | **There is no author column for a manager note anywhere in the warehouse.** `MANAGER` maps to `EMPLOYEE_MANAGER_ID`, unmapped in the JPA entity and 100% null. `REQUESTED_BY` is the **expense record's** requester carried through the join, not the note's author |
| I2 | `FROM_MANAGER_ID` | `payrollmanagernotes` | The owning-manager picklist. Airfare hardcodes `managers/jad`; five of six other automated paths set nothing |
| **I3** | 🔴 **`PAID_ON_PAYROLL_MONTH` and `PAID`** | `payrollmanagernotes` | **The highest-value ask in this spec — it has now bitten three separate findings.** Nothing in the warehouse says which payroll month a note pays for. `anti_attrition_incentive` **is** one of the must-be-paid reasons, so the ERP writes these columns; they are simply not ingested. Without them the payslip must be guessed by month (§2.5 hygiene 13), and the documented fallback needs the payroll lock window — whose column `LAST_PAYROLL_LOCK_DATE` has **no non-null values** |
| **I4** | `INCENTIVE_AMOUNT` | `maidmanageractionlogs` | The maid's enrolled anti-attrition tier. Not exposed, so C1 and C10 must **proxy** it as the largest whole-entitlement note (100–500) she received across the window — NULL where she was never paid a whole month, which is **42 of 110 notes / AED 2,566** on C1's population alone |

🔴 **I1 alone is not sufficient, and the request must say so.** `creator` comes from `BaseEntity` and
is set from the authenticated user, so it is **null inside background tasks and scheduled jobs** —
which is exactly where most of this money is written. The fix is two-part: ingest the column **and**
have dev set an author on the automated paths. **`RafflePerformerJob` already does this**, stamping
`erp_user` when creator would be null — so the ask is "do what the raffle job does", not a design.

##### 2.4 Join keys

| From | To | Key | Note |
| --- | --- | --- | --- |
| D1 `EXPENSE_ID` | D2 `ID` | NUMBER = NUMBER | Present on 11,819 of 16,831 |
| D1 `HOUSEMAID_ID` + the as-of day | D4 / D5 | interval containment | `day >= CHANGE_DATE::DATE AND (NEXT_CHANGE_DATE IS NULL OR day < NEXT_CHANGE_DATE::DATE)`. **Half-open. `BETWEEN` double-counts the change day** |
| D1 `HOUSEMAID_ID` + the as-of day | D7 | latest ≤ day | Envers has **no closing edge**; `QUALIFY ROW_NUMBER() … ORDER BY changed_on DESC = 1` |
| **D1 `HOUSEMAID_ID` + payroll month** | **D14** | `HOUSEMAID_ID` + `PAYROLL_MONTH` | **Many notes to one payslip row** — never join before the note-level tests finish or the grain fans. Month resolution: §2.5 hygiene 13 |
| D1 `REQUESTED_BY` (name) | D11 `NAME` → D12 `EMAIL` | name → email → department | Two hops. Normalise case **and internal whitespace** — `"Georgina  Wakim"` carries a double space |
| D1 `REQUESTED_BY` (name) | D13 `EMPLOYEE_NAME` | name | For department **as of the note date** |

**As-of and timezone.** `CHANGE_DATE`, `NEXT_CHANGE_DATE` and `CHANGED_AT` are `TIMESTAMP_NTZ`; a
maid whose type changes on the as-of day can fall either side of a UTC-versus-Gulf shift.
**Unresolved — O6.**

##### 2.5 Known data hygiene issues — each one measured

1. 🔴 **Zero-amount notes are the single most dangerous artefact in this data, and they have already
   produced one retracted finding of AED 49,500.** A note at amount 0 is how the business **cancels**
   an addition — the narratives say "postponed", "RBs confirmed NOT to release", "Duplicated", "paid
   manually". A test that treats *the existence* of a prior note as evidence of a prior **payment**
   pairs a real payment against a cancellation and calls it a duplicate. **`AMOUNT > 0` is mandatory
   in every check.** The general rule: *a check may use another note's **amount**; it may never use
   another note's **existence** unless that note has `AMOUNT > 0`.*
2. **`MANAGER` is dead** — `FIXED(38,0)`, no non-null values, because `EMPLOYEE_MANAGER_ID` is
   unmapped in the current JPA entity. Never join on it.
3. **`REQUESTED_BY` and `APPROVED_BY` are TEXT names, not ids**, and arrive **from the expense side**.
   They are `''` not NULL on absence — `IS NOT NULL` clears a note nobody approved. Use
   `NULLIF(TRIM(x),'')`.
4. **43% of approvals that exist carry a bare first name.** A first name resolves to a person only
   when unique among staff; otherwise BLOCKED, never guessed.
5. **`NOTE_DATE` carries a time, and what that time means varies by producer.** Airfare is 100%
   exactly midnight because the code writes a **date**; MV Prorated Salary spans 09:00–21:00 because
   it writes a **timestamp**. 🔴 **The hour is therefore not a mechanism detector** — a conclusion
   reached the wrong way once already. And `NOTE_DATE = LAST_DAY(NOTE_DATE)` is **false for every
   row**; cast to `::DATE` before any date equality.
6. **Batch run days are observed, never assumed.** The anti-attrition batch ran **2026-09-01** — the
   largest in the series, 918 notes — so August's notes carry September dates. Any "last calendar day
   of the month" rule misfiles all of them.
7. **`EXPENSES_CONFIGURATION.LIMIT_FOR_APPROVAL` is a threshold above which approval is required, not
   a ceiling.** Read as a ceiling it turned 217 compliant notes into an AED 20,532 finding.
8. **`EXPENSE_REQUEST_TASK_NAME` is a workflow state, not a category.** Reading it as a category
   produced a "no defects across 944 notes" clearance that meant nothing.
9. **`HOUSEMAIDS_INFO.DATE_OF_TERMINATION` is not cleared on re-hire.** A returning maid reads as
   "terminated 558 days ago" forever. It voided a AED 3,000 raffle finding.
10. **`PURPOSE_ID` does not exist in the warehouse.** It appears in this project's own ingestion wish
    list and was once cited as if it were schema.
11. **Expense-linked notes fan out.** `EXPENSES_CONFIGURATION` is not unique on `EXPENSE_TYPE`;
    deduplicate with `QUALIFY ROW_NUMBER() … ORDER BY CODE = 1`.
12. **Two as-of sources exist for live-in/live-out and they are not interchangeable.** The relocation
    check uses `HOUSEMAID_TYPE_LOGS.TO_TYPE`; the transport check uses
    `HOUSEMAIDS_INFO_REVISION.LIVE_OUT`. **Unreconciled — O-LIVE.**
13. 🔴 **NEW — resolving which payslip paid a note, without I3.** Branch 1 (`PAID_ON_PAYROLL_MONTH`)
    is unavailable; the documented branch 2 needs a lock window that does not exist. So the payslip is
    found on `DATE_TRUNC('month', NOTE_DATE)`, and where that row has no paid date, the **prior**
    month is tried. **That fallback must only ever point forward** — `PAID_ON_DATE_FORMATTED >=
    NOTE_DATE`. Without the guard it returns payslips that paid *before* the note existed; it produced
    **five negative note-to-payment intervals** on C1's population. A note with no resolvable payslip
    is **AMBER, "payment date cannot be established"** — never assumed paid.
14. 🔴 **NEW — `HOUSEMAID_PAYROLL_HISTORY.STATUS` disagrees with D5 on many rows**, showing
    `WITH_CLIENT` where the status log says `NO_SHOW_LEFT_CLIENT_HOME`. It is a snapshot of unknown
    timing. **Read status from D5, never from the payslip.**
15. 🔴 **NEW — MV conversions cluster hard at month end, and that is not the base rate.** Month-end
    switching is **10.6%** of all CC→MV changes (1,349 of 12,741). Any check that reads type as of a
    date shortly *after* a month boundary will over-fire on maids converting in the ordinary course.
    C4 fired at **90%** month-end before it was corrected.
16. 🔴 **NEW — `IS_TRANSFERRED` is not a payment test.** Non-transfer rates by type: `MV Prorated
    Salary` **59.9%**, Bonus 3.7%, Maids.at 2.8%, Medical 2.3%, relocation 1.4%, Forgive Deduction 1.4%,
    prorated 1.1%, airfare 0.8%, anti-attrition 0.5%, and **0.0% on seven types**. The outlier is the
    terminated-maid type, so the column tracks **termination**, not non-payment. Reading it as "the
    money never left" would have removed AED 506,309 that was almost certainly settled.

---

#### 3. Metric Calculations

##### 🔴 Check design — what a live, user-chosen window forces

The dashboard reads current data in whatever window the user picks. **Any rule expressed as an
aggregate over that window silently changes answer as the window moves.** Three binding consequences:

1. **Lookbacks ignore the display window.** "No second airfare within 5 months" looks 5 months back
   from **the note**, even when the user is viewing one month. A check that sees only the displayed
   rows reports a clean month that is not clean.
2. **Anything expressed as a share of the window is not a check.** Requester concentration, producer
   share, "% of notes" — investigative tools, not dashboard rules.
3. **Base rates and chance baselines cannot live in the UI.** They are how a *finding* is validated
   before it becomes a check — the 10.6% month-end rate retracted AED 5,100 — but a rate computed
   over the displayed window is not a rate.

**The testable surface is therefore: one addition, `AMOUNT > 0`, given a verdict on its own terms,
with whatever lookback its own rule needs.**

##### 🔴 Which instant a check reads — the v2 correction

**v1 defined one as-of instant and applied it everywhere. That was wrong, and it cost 88% of the
largest check.** A note is written at month end; payroll pays one to three days later. Those are
different days and the maid's state can differ on them.

| Instant | Definition |
| --- | --- |
| **`AS_OF(note)`** | State at `NOTE_DATE::DATE`, by interval containment (D4/D5) or latest-revision (D7). **Never today's value.** |
| **`AS_OF_PAYMENT(note)`** | State at `D14.PAID_ON_DATE_FORMATTED` for the payslip that paid the note (§2.5 hygiene 13). |
| **`ENTITLEMENT_DAY(note)`** | The day the rule's entitlement arose — the renewal, the enrolment, the first day of the pay period. Type- and rule-specific. |

🔴 **The choice is decided by the rule, never by convenience:**

- a rule about **entitlement** ("was she owed this?") reads `ENTITLEMENT_DAY`;
- a rule about **whether money should have left** reads `AS_OF_PAYMENT`;
- 🟡 **`D14.IS_TRANSFERRED` is an AMBER FLAG, not a filter — demoted 2026-09-15 after it failed its
  own first test.** It was briefly specified as a hard population filter above all eleven checks. The
  sweep across all 24 payment types shows **`MV Prorated Salary` at 59.9% not transferred** (471 notes,
  AED 506,309) against **0.5–3.7% everywhere else** — and that type pays **terminated** maids, whose
  payslips do not transfer through normal payroll and who the ledger already clears as entitled. So
  `IS_TRANSFERRED = 'NO'` **does not reliably mean the money did not move**; for terminated and
  absconded maids it may mean settled outside the normal transfer — which is exactly C1's population.
  Until **O-TRANSFER** establishes what it means for a terminated maid, a non-transferred note is
  flagged amber and named, never silently removed from the money;
- `AS_OF(note)` is the fallback only where the note date *is* the governed event.

**What getting this wrong cost.** C1 read status at the note date and had no transfer test. Of its 110
notes: **63 (AED 7,844) went to maids who were back at work on the day payroll ran**, and **13 (AED
1,097) sat on payslips that never transferred**. The check read **13,257**; it is **1,613**.

##### Shared definitions

**`ROUTE`** — `expense` if `D1.EXPENSE_ID` resolves to a D2 row, else `direct`. **5,345 notes / AED
3,976,776 — 58% of the money — are `direct`**: no expense request, and therefore none of the
authorisation controls that live on it (approval threshold, invoice, requester, approver).
⚠️ `route` is **not** a control test: on the anti-attrition population **100% of notes on both sides
of every cut were approved**, because the note only comes into existence once its expense todo is
`confirmed`. Approval there is the creation mechanism, not evidence a human authorised anything.

**`SCORED`** — a note is scored only where its rule's mechanism existed. Checks with an era gate name
their own date; a gate is **observed from the data**, never hardcoded as policy.

##### The checks

Each is one note, one verdict. Figures are as of **2026-09-15**; every one is a snapshot of a rolling
window and is date-stamped for that reason. **Live total: AED 30,441 across 11 checks.**

| # | Check | Archetype | Rule | AED | Notes |
| --- | --- | --- | --- | ---: | ---: |
| **C2** | Bonus over the referral entitlement | not deserved | 🔴 **INNER join to maids holding a referral entitlement**, then maid-level `SUM(bonus) > SUM(D8.AMOUNT where not cancelled and requested)`. **Absence of a referral record is NOT an entitlement of zero** — scoring it that way returns 40 maids / ~AED 58,000, because `REASON = 'Bonus'` carries seven purposes and D8 prices two | **11,500** | 16 maids |
| **C5** | Airfare to an MV maid | off-rule | **no CC interval anywhere in the 24-month entitlement window.** The window is the renewal cadence, not Guard 1's 5-month duplicate window — see §6 O-AF | **4,500** | 3 |
| **C6** | Accommodation Relocation to a live-in maid | not deserved | `AS_OF` type = `CC Live In` | **3,900** | 5 |
| **C7** | Prorated salary outside the eligibility window | not deserved | salary start not within 0–40 days before the note | **2,976** | 25 |
| **C8** | Forgive Deduction — 15+ days in one month | off-rule | maid-month with ≥15 notes | **2,492** | 55 |
| **C1** | Anti-attrition to a maid who had gone | not deserved | `AS_OF_PAYMENT` status ∈ {`NO_SHOW`, `NO_SHOW_WENT_OUT_DID_NOT_RETURN`, `NO_SHOW_LEFT_CLIENT_HOME`, `NO_SHOW_FOR_TERMINATION`, `EMPLOYEMENT_TERMINATED`} **AND** absent ≥ 10 days at payment, **net of the days she had earned**. ⚠️ The AED 1,613 was measured additionally requiring `D14.IS_TRANSFERRED = 'YES'`; since that column tracks **termination**, not non-payment (hygiene 16), the figure may be **understated** by the 13 notes / AED 1,097 it set aside — pending **O-TRANSFER**. The safe direction | **1,613** | 3 maids |
| **C9** | Note exceeds its approved request | off-rule | `AED` and `AMOUNT > req_amount + 0.01` | **1,304** | 4 |
| **C10** | Anti-attrition same-day excess | paid twice | same-day total > entitlement, **entitlement proxied as the largest whole-entitlement note (100–500) across the year** (I4) | **838** | 17 groups |
| **C11** | Airfare above its nationality tier | off-rule | `AMOUNT > MODE(AMOUNT)` for that nationality | **500** | 1 |
| **C4** | Anti-attrition she had not earned as CC | off-rule | **She was not CC throughout the pay period the note pays for**: `AS_OF` type = `MV` at the first day of that period, **OR** a full whole-entitlement amount (100–500) paid for a period she was CC for only part of. One rule, both notes — maid 104507 (MV at period start) and maid 38994 (CC 12 of 31 days, paid a full month) | **426** | 2 |
| **C12** | Live-out transport to a live-in maid | not deserved | head `Live-out Transportation Assistance` **and** `D7.LIVE_OUT = 0` as-of | **392** | 3 |
| | **TOTAL** | | | **30,441** | **11 checks** |

##### Retired checks — do not implement

| # | Check | Why it is not a check |
| --- | --- | --- |
| ~~**C3**~~ | ~~Anti-attrition paid before enrolment existed~~ | ⚪ **Unfalsifiable, retired 2026-09-15 (was AED 9,019 / 42 notes).** The job selects on `EXISTS` against the enrolment row, so a maid **cannot** be paid without one; a note predating her earliest surviving row means the original was **deleted**. `deleteEntity` is an unguarded hard delete with no `@Audited`, no soft-delete flag and no history write, so *"never enrolled"* and *"enrolled, unenrolled, re-enrolled"* are **identical in data**. The 42 notes survive as the **control finding** below, not as money |

##### Era gates

| Check | Gate | Why |
| --- | --- | --- |
| C1, C4, C10 | anti-attrition enrolment records begin with the scheme | Before it, absence of enrolment is a missing mechanism |
| C5, C11 | airfare rule is code-verified from `AddScheduledAnnualVacationService` | CC-only, no airfare within 5 months, ≥16 months since the last ticket |
| **All** | **department attribution: 2025-06-15** | `OFFICE_STAFF_CHANGES` carries no department change before it. Older notes resolve to *today's* department, which must be labelled as such |

##### Control findings — a rule broken where the money may still be owed. **NEVER added to the money.**

| Finding | AED |
| --- | ---: |
| Bonus paid before the bonus was requested | 9,500 |
| A deprecated, config-disabled bonus path is still paying | 7,126 |
| 🔴 **Anti-attrition enrolment can be deleted without privilege or trace** | *no amount* |
| **Subtotal** | **16,626** |

🔴 **The delete-guard gap.** On `/maidNote`, `createEntity` (:116) and `updateEntity` (:147) both
enforce the incentive type check, `validateIncentiveExperimentPositionAccess` and
`validateIncentiveAmount`. **`deleteEntity` (:164-166) enforces none of them and carries no
`@PreAuthorize`.** So enrolling a maid onto a money-bearing programme is position-restricted, changing
her amount is position-restricted, and **erasing the enrolment entirely is not** — and the entity has
no Envers, no soft-delete flag and no history table, so the deletion leaves nothing behind. **18 maids
/ 42 notes** are the population where this demonstrably happened. Carries no amount: the money was
probably owed. This is a dev item, not a management question.

##### V1 — The AI verifier

Every note reaching a red verdict is **read before it is reported**. The verifier does no arithmetic;
it decides whether the written record explains the payment.

| Verdict | Means, for this check |
| --- | --- |
| `JUSTIFIED` | The text authorises this payment, decidably |
| `PLAUSIBLE` | The text explains the case but does not authorise the amount |
| `AMBIGUOUS` | Relevant text, nothing decidable |
| `NOT_RELATED` | Read in full; nothing addresses this payment |
| `UNRESOLVED` | Contradicts itself or breaks off |
| `NO_TEXT` | No note text and no complaint in the window |

**Categories** — `category_id` is null and must be null for `NOT_RELATED`, `NO_TEXT`, `UNRESOLVED`.

| # | Category |
| --- | --- |
| 1 | **An exception was approved and written down** — a named person authorised it |
| 2 | **The entitlement date was moved by request** — postponed or released early |
| 3 | A dispute or complaint was settled by this payment |
| 4 | The payment is a top-up to an earlier one, not a second entitlement |
| 5 | Paid outside payroll and the note is a record, not a payment |
| 6 | New reason — you name it |

**What a verdict does to a case.**

| Verdict | Effect |
| --- | --- |
| `JUSTIFIED`, category 1 or 3 | **Green.** Authorised, or settled a dispute |
| `JUSTIFIED`, category 4 | **Green**, and links to the earlier note |
| `JUSTIFIED`, category 2 | **Amber.** The date was moved by a person with no structured record — the payment may be owed, the control was not followed |
| `JUSTIFIED`, category 5 | **Grey, removed from the money.** The note records a payment made elsewhere |
| `PLAUSIBLE`, `AMBIGUOUS` | **Amber**, routed for a human read |
| `NOT_RELATED`, `UNRESOLVED`, `NO_TEXT`, `NOT_READ` | **Stays red** |

🔴 **`HOUSEMAID_MANAGER_NOTES.NOTE_REASON` is the primary evidence and it is unusually rich here.**
Unlike the GCC checks, where coverage was thin, **airfare narratives routinely carry the whole
decision**: *"Postponed till she completes 22 months"*, *"Approved by Medhat to release earlier
todo/657202"*, *"RBs confirmed NOT to release the renewal bonus"*. The verifier reads:

1. **`D1.NOTE_REASON`** for the note being scored — the primary source.
2. `COMPLAINT_COMMENTS.TEXT` on the maid's complaints, ±90 days. **Never `GPT_SUMMARY`, never
   `ORIGINAL_TEXT`.**

**The quote is redacted at the model, not at the report.** Narratives name staff (*"approved by
Nadine"*, *"requested by Alaa"*) and carry todo and complaint ids. Names, phone numbers, emails, URLs
and ids are replaced with `[placeholder]` before the quote leaves the verifier.

**Two mechanical guardrails.** `threads_read` lower than what was supplied is **rejected and re-run**.
A read that did not happen is stamped **`NOT_READ`** — a run state, not a seventh verdict — **stays
red and is counted separately from `NOT_RELATED`.**

##### Tie-out rules

**1 — the money.** Money-lost total = the sum of the eleven checks as **distinct note sets**. **No
figure here is a sum of tests**; C2 and the control row "paid before the bonus was requested" overlap
by 9 notes / AED 6,500 across 8 of C2's 16 maids, and sit in different tables for that reason.

**2 — the population.** Every addition is accounted for:

| Step | Notes | AED |
| --- | ---: | ---: |
| Additions, `AMOUNT > 0`, in window | 16,831 | 6,851,419 |
| of which `route = expense` | 11,486 | 2,874,643 |
| of which `route = direct` | **5,345** | **3,976,776** |

**3 — no check counts a subset of another.** 🔴 **This identity is not decorative.** A "selection-lag"
row of AED 3,050 sat on the ledger for a week before it was found to be a **subset of C4** — the run
report had said so in writing at the time. Every check must state the note set it claims, and no two
may intersect within the money table.

**4 — 🔴 NEW: a retracted check keeps its number and stays visible at zero.** C3 is retired, not
deleted. A silently removed row is indistinguishable from a dropped one, and that is exactly how the
old AED 103,100 headline drifted.

---

#### 4. Finalised UI Report

**Layout:** four KPI tiles (money lost · notes red · red rate · money examined) → the four tie-out
lines → spend by month with the red share overlaid → **where the money goes missing**, by check →
by payment type → by **department that raised it** → the cases table.

**Columns.** Flag · Note id · Note date · **Payment date** · Payment type · Maid id · Amount · Check
that fired · Route (`expense` / `direct`) · **Transferred (yes/no)** · Department as of the note ·
**What the note says (the V1 verdict, quote on hover)**. Amounts right-aligned, 2 dp. **Default sort:
amount descending.**

🔴 **Payment date and Transferred are not decoration.** They are the two columns that separate a
payment from a note about a payment, and adding them moved the largest check by 88%. A row where the
payment date could not be established is **amber with the words "payment date cannot be established"**,
never silently treated as paid.

**By department — required, not optional.** Seven departments raise Maids.at alone. The department
column is what turns "this type has no rule" into "this team has no rule", which is the actionable
form. **Every department cell carries its resolution tier** — read from the log, or assumed from
today's directory — because before 2025-06-15 there is no history and the value is today's.

**Filters.** Window (user-chosen, default last 12 months) · payment type · check · route · department
· transferred. **There is no reviewed/unreviewed filter and there will not be one** — nothing stores a
review state and the check writes nothing back. Each run is a fresh read.

**Flags.** Red = a check fired with nothing written that explains it. Amber = explained but not
authorised, an entitlement date moved by request, or a payment date that cannot be established. Grey =
paid outside payroll, or no mechanism existed. Green = no check fired. **Every flag carries its word,
never colour alone.**

**Drill-down.** The note's full narrative; its expense request with status and approver if any; the
maid's type and status timeline **around both the note date and the payment date**; other notes to the
same maid within 5 months **with their amounts**, so a duplicate is visible and a cancellation is not
mistaken for one.

**Provenance line.** All fourteen source tables and the as-of timestamp, on the page.

**Export.** CSV of row-level detail. **The maid's name is in no column and no export.** Staff names
appear only as the department attribution, never as an accusation column.

🔴 **The page must carry two standing caveats:**
1. *"Payments made outside payroll are not visible to this check. Where a note says 'paid manually',
   the money moved and the amount here is zero."*
2. *"Which payslip paid a note is derived, not recorded. Rows where it cannot be established are
   flagged amber and excluded from the money."*

---

#### 5. Worked Examples

##### A — clean, no action
An anti-attrition note of AED 200. `AS_OF_PAYMENT` status is `WITH_CLIENT`, type is `CC Live In`, an
enrolment record exists dated before the note, the payslip transferred, and the amount matches her
enrolled tier. No check fires → **Green.**

##### B — the exception this check exists for
An anti-attrition note of AED 200 to maid 73378. She absconded 2025-09-24; the payslip paid on
2025-11-03, **40 days later**, and transferred. She was enrolled 2025-10-07 — *thirteen days after she
had already gone*. C1 fires → **Red.** She received AED 600 across three months this way. **The whole
check is three maids and AED 1,613**, and that is the honest size of it.

##### C — the instant is the whole answer *(replaces v1's example C)*
An anti-attrition note to a maid whose status on the **note date** is
`NO_SHOW_WENT_OUT_DID_NOT_RETURN`. On that reading, **110 notes / AED 13,257** fire. Read as of the
day payroll actually paid, she is `WITH_CLIENT` — she was back at work within three days. **63 of the
110 notes are this case.** A `NO_SHOW` flag at month end that reads `WITH_CLIENT` by the 3rd is a
transient operational state, not abscondment. → **Green, no money.**

##### D — the cancellation that looks like a duplicate
A maid has an airfare note at AED 0 on 2026-05-02 with narrative *"…/ postponed, didn't accumulate 22
months under CC"*, and a real AED 2,000 airfare note on 2026-06-14. A check that pairs on **existence**
calls the second a duplicate inside the 5-month guard. **It is not: the first is a cancellation and no
money moved.** This exact shape produced **26 false pairs worth AED 46,000**, since retracted. `AMOUNT
> 0` removes it structurally.

##### E — the verifier changes the flag, not the arithmetic
An airfare note of AED 2,000 fires C5 — she was MV in the entitlement window. V1 reads the narrative
and finds *"CC converted to MV, approved by switch to MV team to pay the maid renewal airfare ticket,
todo;559648"*. **The amount does not move.** The flag does: red → **green**, verdict `JUSTIFIED`,
category 1, with the note quoted and its id on the row.

##### F — explained but not authorised
An airfare note whose narrative reads *"…/ DM requested to release now before completing 22 months
under CC"*. The payment was decided by a person, but **no structured field records the override, no
approver column exists, and `AuditorAction` does not fire on ordinary edits**. Verdict `JUSTIFIED`,
**category 2 → Amber.** The money is probably owed; the control was not followed, and that is a
different report to a different owner.

##### G — out of scope, counted and visible
An airfare note at AED 0 whose narrative reads *"…/ 2000 dhs paid manually"*. The maid was paid AED
2,000 outside payroll. **This check scores it as zero and always will.** It appears grey on the page
with the standing caveat, because silent exclusion is how a hole becomes a lie.

##### H — the arrears month that is not a violation *(new in v2)*
An anti-attrition note of AED 400 to a maid whose `AS_OF` type is `MV`, against a CC-only rule. She
switched to MV on **2026-03-31 — the last day of the month** — and the note is dated 2026-04-18, a
full whole-month amount for a month she spent **entirely as CC**. C4 does not fire: it reads type at
the first day of the pay period, and on 1 March she was CC. **18 of C4's original 20 notes were this
case, AED 5,100.** The month-end pattern is real, not a base rate: **10.6%** of CC→MV switches happen
on the last day of a month, against **90%** in that population.

---

#### 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| **B3** | ✅ **CLOSED ON EVERY LIMB 2026-09-15** — (a) MV switch within 2 days is fine; (b) the ERP's proration is correct and not to be questioned; (c) the long-MV population is one note / AED 126; (d) `CREATION_DATE` is trustworthy and maid 73378 was genuinely enrolled 13 days after absconding; (e) the `NO_SHOW` policy question closed and **not raised with management**; (f) C3 unfalsifiable and retired; (g) row 4 retracted on a base-rate test. **Nothing from anti-attrition goes to management** | — | **Closed** |
| **O-AF** | ✅ **CLOSED 2026-09-15** — the rival airfare figure of AED 6,000 was a **5-month** lookback (Guard 1's duplicate window) against C5's **24-month** entitlement window. Run together: RED(24m) ⊆ RED(5m), 3 of 19. Disjoint sets, different questions; the 5m test reintroduces the confound C5 exists to defeat. **C5 stands at 4,500**; the 16 notes / AED 30,000 in the gap are the conservative floor's known cost and stay candidates | Audit | **Closed** |
| **O-INSTANT** | ✅ **RESOLVED BY INSPECTION 2026-09-15 — not a blocker.** Each check was read against its own rule to decide its instant: C1 money-leaving → `AS_OF_PAYMENT`; C4 entitlement accruing over a period → pay-period start; **C6 and C12** (was she live-in when the allowance was granted) and **C7** (salary start vs note) are entitlement tests where **the note date IS the governed event** — correct as written; **C11 uses no instant at all**, being a pure amount-vs-tier comparison. C2, C5, C8, C9, C10 were already keyed to their own events. **The one dimension that applies to every check is the transfer filter, now hoisted above all eleven** (§3) | Audit | **No** |
| **O-C4** | ✅ **RESOLVED BY RULE 2026-09-15 — not a blocker.** The 426 does not split across two checks; it needed one rule that covers both notes, and now has one: *she was not CC throughout the period the note pays for*. Maid 104507 was MV at the period's start; maid 38994 was CC for 12 of 31 days and paid a **full** whole-entitlement month. No orphaned note, no check invented for a single row | Audit | **No** |
| **O-TRANSFER** | 🟡 **What does `IS_TRANSFERRED = 'NO'` mean for a terminated or absconded maid?** The sweep shows the column tracks termination, not non-payment — `MV Prorated Salary` runs at 59.9% against 0.5-3.7% elsewhere. Until this is answered the flag cannot filter money. **C1 is unaffected in its core** (its eight surviving notes are all `YES`) but may be **understated** by the 13 notes / AED 1,097 it set aside — the safe direction | Payroll / ERP | **No** |
| **O-C2** | ✅ **CLOSED 2026-09-15 — C2 re-derived independently and confirmed at AED 11,500 / 16 maids.** The first attempt was a mis-scoped rule that returned 40 maids / ~AED 58,000 because it treated *absence* of a referral record as an entitlement of zero; `REASON = 'Bonus'` carries seven purposes and `HOUSEMAID_REFERRALS` prices two. Scoped by an **INNER join to maids holding an entitlement**, it reproduces the ledger to the dirham — seven over by 1,000, nine by 500. **Transfer exposure zero**, so O-TRANSFER cannot move it. ⚠️ Two corrections: the old basis line *"every one paid exactly double"* is **wrong** (12 of 16 at 2.0x, three at 3.0x, one at 1.5x), and the control-row overlap is **8 of 16 maids / AED 6,000** — half this check's money tells a second story about the same people | Audit | **Closed** |
| **C2q** | 🔴 **NEW — what is a `Bonus` note allowed to be, and who prices each kind?** The head carries referral, signing, client-referral, renewal/vacation, ticket allowance, Abu Dhabi Incentive and MMR payments. **Only maid→maid referrals have an authorised-amount source.** Narratives show retention promises made verbally (*"maid was promised AED 1000 if she finds a new employer"*, *"promised by RBs"*, *"approved by the sup"*) — real commitments with no structured record. **AED ~865,000 is untestable until each kind has a price** | George Abboud | **No for the build** — blocks *coverage* of the bonus head || **K1** | **What is `Maids.at other expenses` for, and who qualifies?** AED 51,260, 273 notes, clean on authorisation and **completely untested on entitlement because no rule exists to test against**. Seven departments raise it. Two distinct tariffs sit under it — PRO Services at ~AED 90 a note, Delighters L1 at ~AED 423 | George Abboud | **No for the build** — blocks *coverage* of Maids.at, not delivery |
| **L2** | **Office work — must she be assigned on the day she is paid?** Decides AED 13,140. Only 15 of 92 notes were assigned when paid; 62 were with a client | George Abboud | **No for the build** — blocks *coverage* of office work |
| **C5q** | **What are the rejection reasons for a bonus request?** The target set is bonuses that met a rejection condition and were paid anyway | George Abboud | No |
| **X1** | **Which payment types may each contract type receive?** CC live-in, CC live-out, MV, Freedom Operator, Walk-in. Two rows confirmed (airfare CC-only, relocation CC-live-out). **Paying against a rule that never applied is undetectable without the list** | George Abboud | No |
| **A7** | **Airfare tenure — 22 months or 2 years?** The narratives use both, interchangeably, in the same week. The code gives a third number: ≥16 months since the last ticket. Three thresholds, one rule | George Abboud / ERP | **No for the build** — C5 and C11 ship on the code-verified thresholds |
| **A8** | **Is "renewal bonus upon the switch to MV" the same entitlement as the airfare ticket?** ~18 notes / ~AED 32,500 booked under the airfare head with that narrative. If different, every airfare rule tested against them tests the wrong thing | George Abboud | **No for the build** — the ~18 notes are excluded and named, not silently scored |
| **O-DEL** | 🔴 **The delete-guard gap** (§3 control findings). `deleteEntity` enforces none of the incentive guards and leaves no trace. A **dev/security item**, free-standing — it depends on no ruling and no other finding. ⚠️ Residual: whether `magnamedia-core` applies framework-level Envers to `MaidManagerActionLog` is not readable from the housemaid-management repo. If it does, the deletions are recoverable and this downgrades | ERP | No |
| **O-MV** | **782 notes carry a string the code says is written to a payroll log and a to-do, not to a manager note.** Either something copies it across or there is another writer. `AccountantToDoService.createAccountantTodoForTerminatedProratedMVMaids` | ERP | No |
| **O-LIVE** | **Two as-of sources for live-in/live-out**, used by two different checks: `HOUSEMAID_TYPE_LOGS.TO_TYPE` (C6) and `HOUSEMAIDS_INFO_REVISION.LIVE_OUT` (C12). Reconcile, then pick one | Snowflake team | No |
| **O6** | Which timezone are `HOUSEMAID_TYPE_LOGS` / `HOUSEMAID_STATUS_LOGS` timestamps written in? A maid whose type changes on the as-of day can fall either side | Snowflake team | No |
| **I1–I4** | **The ingestion request in §2.3.** I3 (`PAID_ON_PAYROLL_MONTH`) is the highest-value one — it has now bitten three separate findings. Without I1 there is no author column and 58% of the money is unattributable to a person; `RafflePerformerJob` already shows the pattern | Data team / ERP | **I3 yes** |
| **O-MAN** | **Money paid outside payroll is invisible to this check.** ~15 notes say so in free text; the real population has never been measured. Out of scope by ruling — **but the size is worth knowing before anyone quotes a total** | Police & Control | No |
| **O-ERP** | **ERP re-generates additions it has already paid.** Two notes record it on the secondary payroll run; both were caught and zeroed by a person. Not ours — hand it to payroll | Payroll | No |

---

#### Appendix — what this spec supersedes, and what changed

`SPEC_manager_notes_audit_v1/v2/v3.md` are investigation documents — 1,600+ lines each, written while
the data was still being learned. They are kept for their evidence and are **not build specs**.

##### v1 → v2, same day

| v1 | v2 |
| --- | --- |
| **12 checks, AED 56,204** | **11 checks, AED 30,441.** C1 re-scoped (−11,644), C3 retired (−9,019), C4 retracted (−5,100) |
| One as-of instant, `NOTE_DATE`, for everything | **Three instants**, and a rule for choosing: entitlement / payment / note. Getting it wrong cost C1 88% |
| No payslip table | **D14 mandatory.** `PAID_ON_DATE_FORMATTED` gives the day money moved. ⚠️ `IS_TRANSFERRED` looked like the second half of that and is **not** — it tracks termination, so it is an amber flag, never a filter (hygiene 16, O-TRANSFER) |
| C3 a live check at AED 9,019 | **Retired — unfalsifiable.** Converted into the delete-guard control finding |
| C4 keyed on "more than 2 days before the note" | **Keyed on the pay period.** The 2-day line was arbitrary; 18 of 20 were month-end conversions paid in arrears |
| Airfare carried at 4,500 with a rival 6,000 unreconciled | **Reconciled and closed.** Different windows, disjoint sets — not rival estimates |

##### Method rules this audit paid to learn

1. **A test's window must come from the rule it tests.** Five months was Guard 1's *duplicate* window, used to test the CC *gate*.
2. **A discriminator that cannot discriminate is not a test.** Expense head, approval rate and the 5-month lookback each returned a predictable answer — two of them predictable from evidence already written down.
3. **Resolve as of the event the rule governs**, not the date on the row. This moved C1, C4 and the airfare reconciliation.
4. **Validate a pattern against its base rate before retracting or asserting on it.** 10.6% vs 90% retracted AED 5,100; had the base rate been 85%, the pattern would have meant nothing.
5. **A retracted row keeps its number and stays visible at zero.**
6. **No figure is a sum of tests.** Four separate near-misses, one of them 58%.
7. **Absence is not zero.** Scoring "no entitlement record" as "entitlement of 0" turned C2 from 16 maids / AED 11,500 into 40 maids / ~AED 58,000. Scope with an INNER join to the population that has the thing being compared.
8. **Never generalise a filter from one check's population.** `IS_TRANSFERRED` was hoisted above all eleven checks on C1's evidence and overturned by the next query, which showed it tracks termination. One population is not a base rate.
9. **Put a column in every query whose only job is to contradict you.** `entitlement_basis` caught a mis-scoped rule before it became a finding; `paid_over_authorised_ratio` killed the ledger's "exactly double" claim. Both cost nothing.

##### Over the audit's life

**AED 222,228 has been withdrawn across twelve retractions, against AED 30,441 standing — more than
seven dirhams retracted for every dirham that survived.** That ratio is the strongest evidence the
method works: every one of those retractions was found by this audit, before publication, not after.
