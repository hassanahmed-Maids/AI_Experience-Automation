# Ticket 1 of 2 — Analytic Engineering

**Issue type:** `Analytic Engineer Task` *(file it as this, not "New Request")*
**Project:** DNA · **Routing:** Analytics Engineering — Belal Alsayed
**Summary:** `Manager notes audit — model the ten Police & Control metrics at note grain in silver/gold`

---

### What we need

Police & Control audits every dirham managers add to housemaid payslips — **1,300–1,400 additions a
month, about AED 0.5m**, some AED 6.3m a year. Each one is supposed to be justified by the rule
governing that payment type. Nothing checks that today.

Everything it reads is already in `BA_VIEWS`, plus nine columns that exist on the ERP source table
but are not projected into the curated note view. So the ask is narrow:

> **Model the ten metrics below at note grain in silver/gold.** Sources are listed here, and the
> business logic is attached in full — you do not need to reverse-engineer it.

### The ten metrics, by name

Fixed names — they are what P&C reads in handovers, so anything built or labelled uses them exactly,
with the metric id.

| Id | Name | Id | Name |
| --- | --- | --- | --- |
| M1 | `Cases in Scope` | M10 | `Coverage` |
| M2 | `Money in Scope` | M11 | `Amount at Risk` |
| M7 | `Findings` | M12 | `Duplicate Groups` |
| M8 | `Unverifiable` | M13 | `Expense Match Rate` |
| M9 | `Cleared` | M14 | `Completeness Exceptions` |

M0 and M3–M6 in the spec are the engine — audit-month resolution, the test battery, the expense
match, the verdict algebra, the group rules. They produce the one verdict column the ten aggregate.

### Grain

**One row per manager note.** A maid with four additions in a month is four rows. Exception: **M14
is one row per maid × payroll month.**

### What it reads

| # | Object | Gives |
| --- | --- | --- |
| D1 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | the note |
| D2 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | payslip month + `MANAGER_ADDITIONS` — the tie-out anchor |
| D3 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | contract type, nationality, service dates |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | the authorising expense request |
| D5 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | tickets purchased — flight-home duplicate test |
| D6 | `…MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | the referral event |
| D7 | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | the payment-type picklist |

Plus, from **`mmdb_transformed.payrollmanagernotes`** — all present in the ERP source; how they reach
the warehouse is your call: `APPLIED`, `NOT_FINAL`, `PAID`, `PAID_ON_PAYROLL_MONTH`, `IS_REFUND`,
`EXPENSE_ID`, `ADDITION_REASON_ID`, `PURPOSE_ID`, `CREATOR`. Also `PARAMETERS.CODE`/`VALUE` for the
airfare limits and the lock window on `MONTHLYPAYMENTRULES`.

**Column inventories, types, profiled ranges and the model SQL: attached source-tables doc.**

### Verification note

Table, column, type and enum claims come from the Snowflake catalog and the ERP source code. **None
has been confirmed against rows** — an access limitation on our side meant no row-level query could
run (**DNA-9437**). What exists is known; where exactly it lands and how populated it is, is not.
*Done when* 1, 2 and 8 close that out.

### Two things that will silently produce wrong numbers

**`PAID = true` is not "was paid".** For most routine additions the ERP writes neither `PAID` nor
`PAID_ON_PAYROLL_MONTH`. **Scoping the population on it drops the majority of notes and the month
reports clean.** The audit month resolves in three branches instead — source-tables doc §5.

**There is no key from a note to the expense payment.** The match is a heuristic on
`RELATED_TO_ID = note.HOUSEMAID_ID` — the key DNA-9464 adopted, so it is production-validated — and
it must never resolve to the first candidate: **7,020 of 7,878 matched notes (89%) belong to maids
holding more than one expense request** (DNA-9464). Multiple candidates → unverifiable, not matched.
Full route and blind spots: source-tables doc §5.

### Three data asks, none of them blocking

**N10** effective-dated salary history · **N11** referral and signing scheme prices, effective-dated ·
**N12** raffle winners per draw. Each leaves one group rule returning BLOCKED and its notes amber.
Detail and where to start looking: source-tables doc §9. **Amber is a result this report publishes,
not a failure of it** — it is the honest statement that no rule exists to test against.

### Two things that need a decision, not engineering

**The loyalty payment has no rule anywhere in the company** — `anti_attrition_incentive`'s only
reference in the ERP is a payment-routing list. It is the largest single category of unverifiable
money. Either a rule gets written, or the report says so every month.

**Three reference mappings do not exist** — payment type → allowed expense heads, contract type →
allowed payment types, and which types always carry an expense record. Business rules, not data;
until they exist those tests return BLOCKED. ⚠️ **Two entries of the third are settled:** airfare
and office-work additions are booked straight onto salary with no payment behind them
(*"Direct adjustment"*, 565 in six months — DNA-9464). Without that, every flight-home payment is
red-flagged "no basis".

### On sensitivity — so it does not stall at intake

**No new read access is requested; nothing here widens what any role can already see.** No name,
phone, contact detail, EID, passport or address is displayed — maids and approvers appear as
internal ids, and since `EXPENSES_REQUESTS.APPROVED_BY` stores a *name*, the model must expose an id
alongside it. For the four prorated-salary types the note amount **is** a salary figure: the model
carries it, the dashboard bands it, so display is a config flag not a schema change.
`HOUSEMAIDS_INFO` is read for non-salary columns only.

### Attached

| File | What it is |
| --- | --- |
| **`DNA_ATTACHMENT_source_tables.md`** | **Start here.** Data points with types and profiled ranges, the two link routes, the ERP rules, all 24 payment-type codes, a fifteen-row trap table, the six outstanding checks |
| **`SPEC_manager_notes_audit_DEV.md`** | The full logic — population, audit-month resolution, test battery, verdict algebra, group rules, metrics, run guards |
| **`SPEC_manager_notes_audit_v2.md`** | Long-form, reasoning behind every rule. Not needed to start |

### Not a duplicate

| Key | Status | Relationship |
| --- | --- | --- |
| **DNA-9464** | Pending Deployment | We use its corrected join key. That report *categorises* additions; this **audits** them |
| **DNA-9465** | Pending Deployment | Same dashboard section, unrelated defect |
| **DNA-9133** | Ongoing | Same measure — detects a spike, does not test a rule |
| **DNA-9446 / 9449** | To Do | Sibling P&C check — whole-payroll arithmetic, not per-note justification |
| **DNA-9454 / 9455** | To Do / On-Hold | Sibling P&C audit — recruitment flights, different population |
| **DNA-7074** | Done | Cause of the mis-attribution DNA-9464 hit; this model must not inherit it |
| **DNA-9437** | To Do | Why these figures are catalog-derived rather than measured |

**This does not replace the existing Payroll Dashboard "Additions to the maid's salaries" section.**
That reports what was added, by category. This audits whether each addition was justified.

### Done when

1. **Grain holds.** `COUNT(*) − COUNT(DISTINCT ID) = 0` on the note-level model — **zero**, not
   "materially fewer".
2. **Population is the right size.** **1,300–1,500 addition notes per complete month** — DNA-9464
   measured 8,632 across six months on the same source. Under 800 means the audit-month rule or the
   applied/refund predicates are wrong.
3. **One verdict column.** Each note carries exactly one `AUDIT_VERDICT ∈ {RED, AMBER, GREEN}`, plus
   `VERDICT_LABEL`, `FAILURE_TYPE`|null, `BLOCKING_REASON`|null, `DUPLICATE_GROUP_ID`,
   `IS_RISK_REPRESENTATIVE`, `TEST_TRACE`. **No consumer re-derives eligibility.**
4. **The three verdicts account for every note.** `M7 + M8 + M9 = M1` exactly; amounts sum to `M2`
   to the cent.
5. **No green skipped a test.** Zero rows where `AUDIT_VERDICT = 'GREEN'` and `TEST_TRACE` holds a
   `BLOCKED` or unrun applicable test.
6. **Amber always carries its reason.** `COUNT(AMBER) = COUNT(non-null BLOCKING_REASON)`, and the
   reason buckets sum to M8 in count and money.
7. **The auditor's own flags are not used.** Zero occurrences of `CONFIRMED_AMOUNT_BY_AUDITOR` or
   `CONFIRMED_REPEATED_BY_AUDITOR` in any filter or test — display columns only. The ERP's detection
   queries `CONFIRMED_* = false`, so a confirmed but still over-limit payment leaves its list while
   staying over the limit. That population is why this report exists.
8. **Note-type integrity.** `COUNT(*)` where `NOTE_TYPE IN ('EXTRA_SHIFT','BONUS','SALARY_RAISE',
   'REDUCTION')` in the audit window is **0**.
9. **The payslip reconciles.** Per maid × audit month, all that payslip's `ADDITION` notes sum to
   `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS`, **both sides unfiltered**, exclusions reconciled as named
   lines. Residual surfaces as M14, never absorbed.
10. **M13 is per payment type per month**, not one aggregate, with the 80% floor applied per type.
11. **History reaches back to 2024-01-01.**
