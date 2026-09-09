# Manager Notes Audit — the method, and the mistakes that produced it

**Rev 2026-09-09** · companion to `SPEC_manager_notes_audit_v3.md` (what to test) and
`SPEC_manager_notes_audit_DEV.md` (how to build it). **This document is why.**

The other specs carry a trap table: one-line rules, accurate and forgettable. They are forgettable
because a rule stated abstractly reads as obvious — *of course* you would check what a column means.
Every rule below was written **after** the mistake, by someone who thought it was obvious too.

So this document states each rule with the query that got it wrong, what that query returned, what it
would have been published as, and what the right query returned instead. **The gap between those two
numbers is the argument.**

---

## Part 1 — The pre-flight

Before writing any measurement, answer these. Every worked example below is a case where one of them
went unasked.

| # | Question | The failure it prevents |
|---|---|---|
| **P0** | **Is this even in scope?** Read the spec's exclusions before writing the query. | Three rounds spent perfecting a number the spec excludes |
| **P1** | **What does this column actually contain?** Profile it before joining on it. | A name that reads like a taxonomy holding a workflow state |
| **P2** | **Is this flag a permission or an obligation?** *May* and *must* look identical in a boolean. | Reporting grants as unrecovered debt |
| **P3** | **Is this number a threshold, a ceiling, or a target?** Read it with the column that governs it. | Turning compliant payments into a finding |
| **P4** | **Does an approved KPI already exist for this?** Sweep the gold layer and the catalog FIRST. | Reconstructing a sanctioned metric, badly |
| **P5** | **Is this a changing value?** If so, resolve it AS OF the event date, never as current state. | Reporting a different set, not a smaller one |
| **P6** | **What is the chance rate?** Compute it before any ratio, per note, not on the mean. | Publishing coincidence as corroboration |
| **P7** | **Can my numerator even apply to every row in my denominator?** | A rate mixing two payment models |
| **P8** | **If this test finds nothing, will I be able to tell "clean" from "broken"?** Carry a positive control. | Zero matches reading as compliance |
| **P9** | **Is this a producer signature rather than behaviour?** Check identity concentration. | A batch job published as misconduct |

**The meta-rule underneath all nine:** *every* retraction in this audit had the same shape — **a
measurement built on a field, flag, rate or population whose meaning was assumed rather than
established.** Not one was a SQL error. The SQL was always correct; it correctly measured the wrong
thing.

---

## Part 2 — The worked examples

Each is real. The numbers are the ones the queries actually returned.

### E1 · A column named for a task holds a STATE, not a taxonomy

**Goal:** close the open business ask — *which expense categories are legitimate behind each payment
type?* — by enumerating what is actually used.

```sql
-- WRONG
SELECT n.REASON, x.EXPENSE_REQUEST_TASK_NAME AS expense_category, COUNT(*), SUM(n.AMOUNT)
FROM ...HOUSEMAID_MANAGER_NOTES n
JOIN ...EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
GROUP BY 1,2;
```

**Returned:** `PAYMENT_OBJECT_CREATED` — for **100% of rows, every payment type.**

`EXPENSE_REQUEST_TASK_NAME` records where the request *got to*, not what it was *for*. The category
lives on `EXPENSES_CONFIGURATION.CATEGORY` / `TOP_PARENT_CATEGORY`.

**Would have been published as:** nothing — this one failed loudly. The damage was to its sibling, E2.

> **Rule.** Profile a column before joining on it. Same family as an earlier trap in this audit:
> `EXPENSE_ID` is one id per note, not a category — grouping by it returned a 364 KB result.

---

### E2 · Zero join matches is NO evidence, not clean evidence 🔴

The routing test — *does the expense head the money came from agree with the payslip heading?* — joined
on that same task-name column.

**Returned:** `(no head matched)` for **944 of 944 notes.** Every RED count was zero.

**Would have been published as:** *"Routing: no defects across all five payment types."*

It found nothing because it could not find anything. **A test whose finding is an absence must report
its match rate beside it, or it cannot be scored at all.**

> **Rule.** Every absence test reports its denominator and its match rate in the same result.

---

### E3 · A threshold read as a ceiling 🔴

**Observed:** Maids.at — **217 of 273 notes (79%) had no approver**, AED 20,532.

Written up as *"a gate that exists and is being skipped."*

**Then `APPROVAL_METHOD` was read.** Maids.at is `APPROVAL_REQUIRED_ON_LIMIT` with
`LIMIT_FOR_APPROVAL = 200`. The limit is the threshold **above which** approval is needed. **Below it,
an unapproved request is correct.**

```sql
-- RIGHT — the limit is meaningless without the method that governs it
COUNT_IF(APPROVAL_METHOD = 'APPROVAL_REQUIRED'          AND apr IS NULL)  AS required_but_unapproved,
COUNT_IF(APPROVAL_METHOD = 'APPROVAL_REQUIRED_ON_LIMIT'
         AND req_amount > LIMIT_FOR_APPROVAL AND apr IS NULL)             AS over_limit_unapproved
```

**Result: 0 and 0** — on all eleven head/type combinations, across AED 2.8m.

| | |
|---|---|
| Would have been published | AED 20,532, "40% of the type" |
| Truth | **The approval gate is 100% compliant** |

---

### E4 · A batch job published as misconduct 🔴🔴 — the largest near-miss

**Observed:** requester = approver on **8,095 anti-attrition notes, AED 1,585,600** — 88.4%, against a
2–4% norm for human expense paths.

The single largest control finding in the audit, sitting right there.

**The discriminator is concentration, not rate:**

```sql
SELECT payment_type,
       COUNT(DISTINCT requester)                          AS identities,
       MAX(notes_by_this_person)                          AS biggest_one,
       100.0 * MAX(notes_by_this_person) / SUM(notes_by_this_person) AS pct_held_by_one
FROM per_person GROUP BY 1;
```

**Returned: 3 identities, one holding 94.9% of 8,095 notes.** A batch job stamps itself into both
fields because no human is in the loop.

| | |
|---|---|
| Would have been published | **AED 1,585,600** of self-approval |
| Truth | **AED 0.** A producer signature |

This is the second time this exact shape appeared: `REQUESTED_BY` had already been found to name a
**run**, not a route, in an earlier retraction of AED 307,459.

---

### E5 · A signature ported from a different producer

Midnight timestamps had identified the automatic airfare path. Reused here as a machine test.

**Guard column included in the same query** — the midnight rate across *all* addition types.

**Returned:** all types **18.1%** (so the column does carry real time, and the test is not void) — but
the *known* batch job sat at **0.0%**.

Midnight was a valid signature for one producer and worthless for another.

> **Rule.** Establish a signature per producer. Never port one. And when a signal might be structurally
> dead, put its baseline in the same result — a guard column costs nothing and settles it in one run.

---

### E6 · The self-approver who was the designated approver — and a finding that was never ours 🔴🔴

**Observed:** Taxi — 120 self-approvals, **one identity, 100% of them.** Shape identical to E4's job.
Medical — 41 self-approvals, 2 identities. Combined **AED 27,203**.

`EXPENSES_CONFIGURATION.APPROVE_HOLDER` names who is *supposed* to approve that head.

```sql
COUNT_IF(req IS NOT NULL AND apr = req AND holder = req)                        AS self_BY_DESIGN,
COUNT_IF(req IS NOT NULL AND apr = req AND (holder IS NULL OR holder <> req))   AS self_NOT_holder
```

| | Self-approvals | By design | Real breach |
|---|---:|---:|---:|
| Taxi | 120 | **120** | **0** |
| Medical | 41 | 25 | 16 (AED 3,995) |

| | |
|---|---|
| Would have been published | AED 27,203 |
| After checking `APPROVE_HOLDER` | AED 3,995 — an **85% overstatement** |
| **Actual value to the audit** | **Zero. Self-approval is out of scope.** |

🔴 **The deeper failure is the one the method fixed nothing about.** `SPEC_..._DEV.md` states plainly:
*"Segregation of duties, self-approval and attribution are out of scope — this audit tests whether each
payment follows the rule for its payment type."* Confirmed by the requestor, 2026-09-09.

Three rounds went into refining a number the spec had already excluded. Every methodological step was
correct — base rate, concentration, designated approver — and the whole exercise was still waste,
because **no amount of rigour makes an out-of-scope finding reportable.**

> **Rule (P0, before all others).** Check the scope boundary before measuring, not before publishing.
> A finding's *quality* is decided by method; its *admissibility* is decided by the spec, and only one
> of those can be fixed after the fact.

---

### E7 · A permission flag read as an obligation 🔴

`ALLOW_TO_ADD_LOAN` means the head **may** carry a loan. The query counted "no loan row exists" and
named the column `aed_never_recoverable`.

**On heads where the flag is FALSE, "no loan booked" is 100% of rows** — because no loan may be booked.

**Returned, unfiltered:** anti-attrition AED 1,829,536 · Bonus 225,791 · Airfare 137,500 · Abu Dhabi
18,250 — **AED 2.2m of grants presented as unrecovered debt.**

> **Rule.** Filter by the flag before aggregating. And **name the output column after what it proves,
> not what it counts** — the name, not the logic, is what gets published.

---

### E8 · The wrong field entirely, and the control that passed by luck 🔴🔴🔴

**The deepest failure in the audit.** Loan-booking rate measured from
`EXPENSES_REQUESTS.LOAN_AMOUNT` — the loan on the expense **request**.

**Returned:** Medical **3.4%** booked, MOHRE **4.3%**. A clean finding on AED 30,220, on two heads
named *"Loan"* outright.

**It carried a positive control** — Accommodation Relocation, which books loans reliably.

**The control PASSED: 98.5% measured, against 94.8–100% in the approved KPI.**

That pass bought a full round of confidence. Then the sanctioned metric was read:

| Head | Hand-built | Approved `LOAN_PERCENTAGE_OF_ADDITIONS` |
|---|---:|---|
| Accommodation Relocation | 98.5% | 94.8–100% ✅ *agrees* |
| Medical / PCR Loan | **3.4%** | **85–100%** |
| MOHRE / WPS Compliance | **4.3%** | **100% every month** |
| Maids.at | 28% | 82–98% |
| Live-out Transport | 38% | 55–96% |

The sanctioned field is `ADDITION_LOAN_AMOUNT` — the loan on the payroll **addition**. The request-side
column is largely empty. **The control agreed on the one head where the two fields happen to coincide.**

> **Rule.** A positive control validates the plumbing, not the field choice. **One control that fails to
> fire is not evidence.** Use two, on populations chosen to differ.

---

### E9 · A rate across a population the numerator cannot apply to

Even corrected, "% of medical advances booked as loans" was the wrong question.

**`MEDICAL_ASSISTANCE_TYPE` has two values:**

| Mode | Items | AED | Booked as loan |
|---|---:|---:|---|
| **Loan** | 582 | 63,835 | **100.0%** |
| **Paid by Company** | 355 | 70,605 | *none — by definition* |

38% of medical money is a company-paid **benefit**. It can never show a loan. A single blended rate is
not low compliance; it is two payment models averaged together.

> **Rule.** Split by mode before computing any rate. Ask whether a zero is *structurally* the only
> possible value.

---

### E10 · A point read on a changing value reports a DIFFERENT set, not a smaller one 🔴

Rule: Accommodation Relocation is **CC live-out only**. `LIVE_OUT` changes over a maid's life.

```sql
-- RIGHT — resolve the flag as of the note date
LEFT JOIN rev r ON r.maid_id = p.HOUSEMAID_ID AND r.changed_on <= p.note_day
QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.changed_on DESC) = 1
```

66 notes. **5 resolve to a different `LIVE_OUT` than the maid carries today** — 3 REDs and 2 GREENs.

| | Flagged | Wrong | Real ones missed |
|---|---:|---:|---:|
| Current-state read | 5 | **2** | **3 of 6** |
| As-of read | 6 | 0 | 0 |

**It does not under-report. It reports a different set.** Half the true findings invisible, 40% of the
flags false — on one column.

The same correction rewrote three findings earlier in the audit: MV eligibility 941 → 22 (−97%),
prorated 74 → 25, office work 66 → 0.

---

### E11 · A near-ubiquitous corroborator cannot corroborate

**Test:** does a Salary Dispute payment have a complaint behind it? Window −30/+7 days.

**Returned:** 890 of 980 notes — **90.8% corroborated.**

Then the chance rate, summed **per note** (`1−(1−p)^k`, never on the mean — Jensen):

**Expected by chance alone: 821.5, or 83.8%. `TIMES_CHANCE = 1.08`.**

Both framings would have misled:

- *"90.8% corroborated"* → reads as validation. It is noise.
- *"9.2% uncorroborated, AED 31,200 at risk"* → reads as a finding. Chance predicts **16.2%**
  uncorroborated. The observed rate is *better* than chance.

> **Rule.** Measure the base rate before building the test. **If chance exceeds ~70%, abandon the test
> rather than tune it** — a maid with a salary dispute always has a complaint history, so any 37-day
> window catches one.

---

### E12 · A void test and a negative test look identical

**Test:** were un-loaned advances ever recovered? Looked for later DEDUCTION notes.

**The positive control — 65 relocation notes that DO book a loan — showed `aed_deducted_total = 0` too.**

If the known-good population shows no recovery either, deduction notes are **not the recovery
mechanism**. The test scores nothing.

| | |
|---|---|
| Without the control | "AED 30,220 never recovered" — a finding built on the wrong table |
| With it | **VOID.** Report as unmeasured |

---

### E13 · Sweep the gold layer before hand-building a metric

Two rounds of hand-built work reconstructed metrics that already existed, approved:

- `BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` → `LOAN_PERCENTAGE_OF_ADDITIONS`
- `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` → recovery
- `BI_MEDICAL_LOANS` → described in the catalog as *"broken down by loans and paid by company"* — E9's
  answer, in words, before E9 was discovered

**A reconstruction of an approved KPI is not the KPI.** Read the view; its own logic is the sanctioned
definition. And read `CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` — definitions live in `SEMANTIC_ID` +
`TOOLTIP_INFO` (a VARIANT), not flat columns. It settled a denominator that could easily have gone
wrong: *"Center is Total Loans to Be Deducted (not Total Loans)."*

---

### E14 · Verify the tool succeeded, not just that it exited

Two ask-the-code questions were submitted. Both printed through `| tail -80`, which **discards the
script's `exit 1`** and reports the pipeline's success.

**Reported as "token works". The token was expired and both questions had failed.**

Later the same day, the reverse: the poll loop died with `curl (35)` **after** the questions had
submitted — the answers existed server-side and the caller had thrown away the session ids.

> **Rule.** A pipeline's exit code is the last command's. Check the payload, not the status. And when
> a submit-then-poll tool can lose its own work, give it a re-attach path — `scripts/ask-code-poll.sh`
> exists because of this.

---

## Part 3 — The scoreboard

What these fourteen would have cost, had each been published on its face:

| Example | Would have claimed | Truth |
|---|---:|---:|
| E4 batch job as misconduct | 1,585,600 | **0** |
| E7 permission flag as obligation | 2,200,000 | **0** |
| E8 wrong loan field | 30,220 | **0** |
| E6 self-approval | 27,203 | **0 — out of scope entirely** |
| E3 threshold as ceiling | 20,532 | **0** |
| E11 corroboration | 31,200 | **0** — at chance |
| E12 void recovery test | 30,220 | unmeasured |
| E2 routing | *"no defects"* | untested |
| E10 point read | 5 flags, 2 false | 6, all real |

**Confirmed findings after all of it: ~AED 229,100 against AED 7,197,642 examined.** The withdrawn
claims outweigh the confirmed ones by roughly **sixteen to one.**

That ratio is the point of this document. An audit that publishes its first read is not a fast audit —
it is a wrong one, and every wrong number spends the credibility the true ones need.

---

## Part 4 — What still has no method

Stated so the silence is not mistaken for coverage.

- **Deductions.** `NOTE_TYPE = 'ADDITION'` appears in 151 query blocks. Money taken *from* a maid has
  never been examined. It is the mirror of the brief and lands on the person least able to contest it.
- **Note history.** `PayrollManagerNote` is `@Audited`, but no revision table is in the warehouse. The
  audit **cannot tell a note that was born wrong from one changed later.** The as-of technique of E10
  works on maids and not on notes.
- **Before 2025-09.** Every entitlement verdict covers twelve months of roughly four years — and the
  audit's own strategic finding (*the newer the producer, the cleaner the money*) predicts the
  unexamined years are worse.
