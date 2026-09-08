# Ticket 1 of 2 — Analytic Engineering

**Issue type:** `Analytic Engineer Task` *(file it as this, not "New Request")*
**Project:** DNA · **Routing:** Analytics Engineering — Belal Alsayed
**Summary:** `Manager notes audit — model the ten Police & Control metrics at note grain in silver/gold`
**Revised 2026-09-08** — spec v3. Row-level results now exist for part of this (see *Verification note*),
and they changed the logic in eight places. Everything below reflects that.

---

### What we need

Police & Control audits every dirham managers add to housemaid payslips — **1,300–1,400 additions a
month, about AED 0.5m**, some AED 6.3m a year. Each one is supposed to be justified by the rule
governing that payment type. Nothing checks that today.

Everything it reads is already in `BA_VIEWS`, plus nine columns that exist on the ERP source table
but are not projected into the curated note view. So the ask is narrow:

> **Model the ten metrics below at note grain in silver/gold.** Sources are listed here, and the
> business logic is attached in full — you do not need to reverse-engineer it.

**And it is smaller than it looks.** The logic covers ~25 payment types, but they are checked by only
**nine reusable mechanisms**. Build the nine, drive them from a config table, and a new payment type
becomes a row rather than new code — which matters, because the payment-type list is known to be
incomplete. **Phase 1 below ships without waiting on anyone.**

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

M0 and M3–M6 in the spec are the engine — audit-month resolution, the checks, the verdict algebra.
They produce the one verdict column the ten aggregate.

### How to build it — nine checks, not twenty-five rules

Each returns `RED(type)` · `GREEN` · `BLOCKED(reason)` · `N_A`. **Definitions, the per-type check
plan, the two-pass algorithm and what each is blocked on: attachment §12.**

**CEIL** ceiling · **ELIG** eligibility as of the note date · **CORR** corroborating record ·
**RECOMP** recompute from a rate and a period · **PAIR** counter-entry present and equal ·
**ROSTER** membership of a list · **UNIQ** not already paid · **RECON** set sums to a known figure ·
**UNRULED** nothing to test against.

🔴 **UNIQ and RECON are set-level** — they need the note's siblings and their verdicts attach to a
group (a duplicate group, a referral event, a maid × month), so they run in a **second pass**. The
other seven are decidable from one row.

🔴 **The safety property.** An unmapped payment type yields an **empty check plan**, and an empty set
cannot satisfy *"every applicable check ran and returned GREEN"*. New payment types therefore arrive
as **amber with a named reason**, never as silent greens. Please preserve this — no default branch.

### Phase 1 ships without waiting on anyone

**UNIQ, RECON and the airfare CEIL need nothing that is not already granted.** That is duplicate
detection, the payslip tie-out, the referral-event tie-out and the airfare cap — real findings on
current sources, the day the warehouse grant lands. **We would rather have that in production than
wait for the whole thing.**

Phase 2 is CORR, ELIG, PAIR and RECOMP, each gated on one data ask below. Phase 3 is ROSTER and
UNRULED, which no engineering unblocks.

### Grain

**One row per manager note.** A maid with four additions in a month is four rows. Exception: **M14
is one row per maid × payroll month.**

### What it reads

| # | Object | Gives |
| --- | --- | --- |
| D1 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | the note |
| D2 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | payslip month + `MANAGER_ADDITIONS` — the tie-out anchor |
| D3 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | contract type, nationality, service dates |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | the authorising expense request — 🔴 **not currently granted**, see below |
| D5 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | tickets purchased — flight-home duplicate test |
| D6 | `…MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | the referral event |
| D7 | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | the payment-type picklist |

Plus nine columns from **`mmdb_transformed.payrollmanagernotes`**, all present in the ERP source —
how they reach the warehouse is your call: `APPLIED`, `NOT_FINAL`, `PAID`, `PAID_ON_PAYROLL_MONTH`,
`IS_REFUND`, `EXPENSE_ID`, `ADDITION_REASON_ID`, `PURPOSE_ID`, `CREATOR`. Also `PARAMETERS.CODE`/
`VALUE` for the airfare limits, and the payroll lock window — 🔴 **not in Snowflake by any route**,
so it has to come from the ERP.

🔴 **Two blockers, both in attachment §11.** `EXPENSES_REQUESTS` is **not granted** to
`PAYROLL_AND_MONEY_CONTROL_ROLE`, so a warehouse grant alone still leaves the CORR archetype — seven
payment types — blocked. And **do not code a fixed list of payment types**: the warehouse carries
live addition categories absent from the attachment's list, and that profile is truncated.

**Column inventories, types, profiled ranges and the model SQL: attached source-tables doc.**

### Verification note — 🔴 **changed 2026-09-08, read this before pricing the work**

The earlier version of this ticket said *no claim here has been confirmed against rows*. **That is no
longer true for part of it.** Fourteen row-level queries have since run against `BA_VIEWS`, and the
results **changed the logic in eight places and withdrew two claims** the spec previously made
confidently. The facts below are now measured, not inferred:

| Measured | Value |
| --- | --- |
| `anti_attrition_incentive` volume | **9,167 notes / 12 months, AED 1,829,735** — ~59% of the audited population by count, 29% by money |
| Its amount space | 67% flat tier · 30% prorated · **0.4% unexplained**; buckets reconcile to the note and the dirham |
| Enrolment reason box (`HOUSEMAID_MANAGERACTIONLOGS.NOTES`) | **100% filled, 96% distinct values, median 43 chars** — the group B check is viable |
| Segregation of duties, 10 human types | **1,170 self-approved (AED 244,730)** · **7,147 with neither name (AED 2,864,088)** all-time, **862 (AED 613,759)** in 12 months |
| Attribution over time | `Bonus` **2.2% → 85.4% → 48.2%** unattributed; `Taxi Reimbursement` **0% across 36 months** |
| Batch behaviour | The monthly job's run days are **observable**; August's ran on **2026-09-01**, not 08-31 |

**Still unverified:** everything not in that table — most of §2's column-level claims, freshness, and
the `EXPENSES_REQUESTS` join, which remains ungranted. *Done when* 1, 2 and 8 still close those out.

⚠️ **The access limitation (DNA-9437) is not resolved** — these ran on a separate ad-hoc route, one
query at a time, and are not a substitute for the grant. The point is that where numbers exist below,
they are real.

### Two things that will silently produce wrong numbers

**`PAID = true` is not "was paid".** For most routine additions the ERP writes neither `PAID` nor
`PAID_ON_PAYROLL_MONTH`. **Scoping the population on it drops the majority of notes and the month
reports clean.** The audit month resolves in three branches instead — source-tables doc §5.

**🔴 `NOTE_DATE` carries a time, so cast before any date equality.**
`NOTE_DATE = LAST_DAY(NOTE_DATE)` compares a timestamp against midnight and is **false for every
row** — it returns a clean, plausible, entirely meaningless result. A batch-vs-manual split written
this way put **3,728 of 3,728 notes on one side** and looked correct. Always `NOTE_DATE::DATE`.

**🔴 A job's run days are observed, never assumed.** The anti-attrition batch ran on **2026-09-01**,
not the last day of August — 918 notes, the largest run in the series. Any rule that identifies
machine-created notes by "the last calendar day of the month" misfiles all of them. Derive run days
from the data (`GROUP BY NOTE_DATE::DATE HAVING COUNT(*) > n`), which reproduced the known
hand-added population **to the note**.

**🔴 Machine-created notes have no requester or approver, by design.** A rule that reds an addition
for carrying neither name will fire on them: of 862 such notes in twelve months, **850 are `Bonus`**,
whose retraction half is written by `DelighterService`. Determine origin **per payment type from the
data** — a type's attributed notes are a control group for its unattributed ones — and return
BLOCKED where origin is unresolved. Never RED off a hardcoded "human types" list.

**There is no key from a note to the expense payment.** The match is a heuristic on
`RELATED_TO_ID = note.HOUSEMAID_ID` — the key DNA-9464 adopted, so it is production-validated — and
it must never resolve to the first candidate: **7,020 of 7,878 matched notes (89%) belong to maids
holding more than one expense request** (DNA-9464). Multiple candidates → unverifiable, not matched.
Full route and blind spots: source-tables doc §5.

### Data asks, none of them blocking

**N10** salary history · **N12** raffle winners · **N17** contract-type timeline · **N18** row-level
loans · **N19** the `live_out` flag. Each gates one archetype and no more — attachment §12 maps them.
Routes: attachment §9 and §11. **Amber is a result this report publishes, not a failure of it.**

### Two things that need a decision, not engineering

**~~The loyalty payment has no rule anywhere in the company~~ — 🔴 superseded 2026-09-08.** It has
one, and this is the biggest single change in the revision. `anti_attrition_incentive` is **59% of
the audited population by count**, and it now carries **eight tests, six of them Phase 1** (spec v3,
group B). Four candidate checks were tried and closed off by data — the complaint corroboration
scores **1.00× chance, i.e. zero signal**; the enrolment-exists test passes 1,000 times in 1,001;
`AMOUNT = tier` cannot be written because 30% of notes are prorated over two divisors. What replaced
them: **an enrolment must pre-date the payment it justifies** (found a case on its first run), and
**an agent reads the enrolment reason box** — which is 100% filled and 96% distinct, so it carries
real content. What remains for the business is narrower and sharper: *should enrolment require a
categorised reason, as the sibling retraction bonus already does?*

**Three reference mappings do not exist** — payment type → allowed expense heads, contract type →
allowed payment types, and which types always carry an expense record. Business rules, not data;
until they exist those tests return BLOCKED. 🔴 **The referral scheme has since been supplied by
payroll** — attachment §11 — and it changes the grain: referral bonus is judged per **referral
event**, not per note. `HOUSEMAID_REFERRALS.AMOUNT` is the authorised amount to compare paid
against. ⚠️ **Two entries of the third are settled:** airfare
and office-work additions are booked straight onto salary with no payment behind them
(*"Direct adjustment"*, 565 in six months — DNA-9464). Without that, every flight-home payment is
red-flagged "no basis".

### On sensitivity — so it does not stall at intake

**Nothing here widens what any role can already see.** No name, phone, contact detail, EID, passport
or address is displayed — maids and approvers appear as internal ids, and since
`EXPENSES_REQUESTS.APPROVED_BY` stores a *name*, the model must expose an id alongside it. Same for
`HOUSEMAID_REFERRALS`, which carries the referred maid's name and phone. For the prorated-salary
types the note amount **is** a salary figure: the model carries it, the dashboard bands it.
`HOUSEMAIDS_INFO` is read for non-salary columns only.

### Attached

| File | What it is |
| --- | --- |
| **`DNA_ATTACHMENT_source_tables.md`** | **Start here.** Data points with types and profiled ranges, the two link routes, the ERP rules, the payment-type codes, an eighteen-row trap table, the outstanding checks — and **§11, the business rules from payroll**, which override the code in two places |
| **`SPEC_manager_notes_audit_DEV.md`** | The full logic — population, audit-month resolution, test battery, verdict algebra, group rules, metrics, run guards |
| **`SPEC_manager_notes_audit_v3.md`** | Long-form, reasoning behind every rule, and the eight places live data changed it. Not needed to start. Browsable version: `spec-reader-v3.html` |
| `SPEC_manager_notes_audit_v2.md` | The previous version, kept for diffing. **Do not build from it** — its S1 numbers are wrong by two orders of magnitude |

### Not a duplicate

| Key | Status | Relationship |
| --- | --- | --- |
| **DNA-9464** | Pending Deployment | We use its corrected join key. That report *categorises* additions; this **audits** them |
| **DNA-9465** | Pending Deployment | Same dashboard section, unrelated defect |
| **DNA-9133** | Ongoing | Same measure — detects a spike, does not test a rule |
| **DNA-9446 / 9449** | To Do | Sibling P&C check — whole-payroll arithmetic, not per-note justification |
| **DNA-9454 / 9455** | To Do / On-Hold | Sibling P&C audit — recruitment flights, different population |

**This does not replace the existing Payroll Dashboard "Additions to the maid's salaries" section.**
That reports what was added, by category. This audits whether each addition was justified.

### Done when

1. **Grain holds.** `COUNT(*) − COUNT(DISTINCT ID) = 0` on the note-level model — **zero**, not
   "materially fewer".
2. **Population is the right size.** **1,300–1,500 addition notes per complete month** (DNA-9464
   measured 8,632 across six months on the same source). Under 800 means the audit-month rule or the
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
   `CONFIRMED_REPEATED_BY_AUDITOR` in any filter or test — display only. Why: attachment §7.
8. **Note-type integrity.** `COUNT(*)` where `NOTE_TYPE IN ('EXTRA_SHIFT','BONUS','SALARY_RAISE',
   'REDUCTION')` in the audit window is **0**.
9. **The payslip reconciles.** Per maid × audit month, all that payslip's `ADDITION` notes sum to
   `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS`, **both sides unfiltered**, exclusions as named lines.
   Residual surfaces as M14, never absorbed.
10. **M13 is per payment type per month**, not one aggregate, with the 80% floor applied per type.
11. **Referral bonus is judged per referral event**, not per note: the payments for one event sum to
    a single figure, and an amount outside the scheme blocks rather than reds.
12. **Loan-paired types tie out.** For the loan-paired categories, `addition_amount = loan_amount`;
    every deviation is a row in the output, not a rounding note.
13. **History reaches back to 2024-01-01.**
14. 🔴 **Every metric is windowed.** No metric spans the whole table while its neighbours are monthly.
    The segregation check in particular: un-windowed it reports **AED 2.86m**, of which **79% predates
    twelve months** — a mostly-closed historical backlog rendered as this month's work. Windowed, the
    same check reports AED 613,759.
15. 🔴 **No date equality against an uncast `NOTE_DATE`.** Zero occurrences of `NOTE_DATE =` where the
    right side is a `DATE`; every such comparison casts `NOTE_DATE::DATE` first.
16. 🔴 **Machine origin is measured, not listed.** No test reds a note for missing attribution unless
    that payment type is *measurably* human-created from its own note-date distribution. A hardcoded
    "human types" list appearing in a verdict path fails this criterion.
17. 🔴 **Every window-based test publishes its chance rate** beside its observed rate, computed per
    subject from that subject's own record count — not from a cohort average, which is a Jensen trap
    (estimating rather than measuring it produced 1.46× against a true 2.33× in a real case). A test
    whose observed rate does not clear its chance rate is reported as **N_A**, not as a weak signal.
18. 🔴 **Control-failure metrics carry a 24-month series**, not a single month's count. A point count
    renders a control that broke (`Bonus`, 2.2% → 85.4% → 48.2%), a backlog being worked off
    (`Salary Dispute`, 4,211 all-time → 12 in twelve months) and one that holds (`Taxi`, 0% across 36
    months) as the same number — and only the first needs an owner this week.
19. **Future-dated notes are rejected as a feed defect**, not carried as unverifiable cases. At least
    one exists today.
