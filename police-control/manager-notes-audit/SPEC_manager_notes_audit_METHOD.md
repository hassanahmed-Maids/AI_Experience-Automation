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
| **P1a** | **Has this column appeared in a schema result, or a query that ran, IN THIS SESSION?** If not, it does not go in a delivered query. | Three guessed columns in one file, two of them already retracted earlier the same day |
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

### E1b · An open ingestion ask read as a settled schema — while writing this document 🔴🔴🔴

The sharpest example in the file, because it happened *after* Part 1 was written, in a query whose
own header asserted the rule it was breaking.

`BN1`/`BN2` were built on `HOUSEMAID_MANAGER_NOTES.PURPOSE_ID`. **The column does not exist.**

The header I wrote read: *"P1 DISCIPLINE: PURPOSE_ID is not a guess. `full-audit-block-a-discovery.sql`
already selects it."* That file's line 16 actually reads:

> *A3. The raw payroll manager-notes table — carries N1–N6 (… `PURPOSE_ID` …). **If this is now
> visible, six outstanding ingestion asks collapse at once.***

It is a list of columns on the **raw ERP table**, written as an **ingestion ask** — a wish list,
checking whether the table had become visible. It was never a schema for the warehouse view, and it
never claimed to be. I read my own open request as settled evidence, then wrote *"not a guess"* on top
of it.

**Two distinct failures, and the second is worse than the first.** Assuming a column exists is P1.
Asserting in writing that the assumption had been verified, with a citation that says the opposite, is
how a wrong claim survives review — mine and anybody else's.

**Consequence, and it is not small.** Ask-the-code 46023 established that `purpose` is the *only* thing
separating referral, signing and retracting-resignation bonuses — signing sets no purpose at all, and
the classification is picklist-controlled. So **AED 274,260 of bonus candidates are blocked on an
ingestion, not on a better query**, and every amount-and-tenure proxy the audit built for them is a
workaround for a missing column rather than a test of anything.

> **Rule.** A citation must be re-read at the moment it is cited, not recalled. And a document
> describing a *wanted* column and a document describing an *existing* one look identical three weeks
> later — so ingestion asks must be written in a form that cannot be mistaken for a schema.

---

### E1c · The same wrong column, guessed twice, after being retracted once

`MAIDS_REFERRALS_JOINERS_INFO.REFERRING_MAID_ID` does not exist. It was tried, it failed, and the
correction was written down — `HOUSEMAID_REFERRALS_ENRICHED` carries `REFERRING_MAID_ID`;
`HOUSEMAID_REFERRALS` carries `HOUSEMAID_ID` for the referrer. Both routes were already proven by
queries that ran.

**It was then reused from memory in BN3**, in the same file as E1b, one query later.

Three guessed columns in one file — `PURPOSE_ID`, `START_DATE` as a stable anchor, and this — of which
two had already been corrected earlier the same day. The pattern is not carelessness about schemas; it
is **recall standing in for lookup**, and recall is confidently wrong in exactly the cases where a
column *sounds* like it should exist.

> **Rule (P1a).** A column goes into a delivered query only if it appeared in a schema result, or in a
> query that demonstrably ran, **in this session**. Not in a spec, not in an ingestion ask, not in
> memory. The lookup costs one small query; the alternative costs the reader's trust in every column
> name in the file.

Corollary applied here: the dead version of O3 is left **broken and labelled** rather than quietly
patched, so the correction stays legible to whoever reads the file next.

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

### E10b · The self-diagnostic caught a 97% confound before publication 🟢

The counterpart to E10, and the one time in this audit the guard fired *before* a number went out.

**Point read (S5):** airfare notes whose contract type resolves to MV at the note date — **76 notes,
AED 137,500**, against a code-and-business-confirmed CC-only rule. A clean, large finding.

**The diagnostic column said no.** Only **1 of the 76** resolved to a *past* type interval; 75 sat in
the maid's still-open one. That is the signature of a point read wearing an as-of costume — and the
cause was specific: an airfare note is dated `payrollDueDate`, so a maid who was CC at renewal and MV
by the payroll cycle reads as MV.

**The conservative re-ask:** was she CC at *any* point in the 24-month entitlement window? A maid MV
across that whole span could not have been entitled at any date inside it.

| | Notes | AED |
|---|---:|---:|
| CC throughout | 1,102 | 1,975,500 |
| CC *and* MV both in window | 197 | 355,000 |
| **MV the whole window** | **3** | **4,500** |

| | |
|---|---|
| Would have been published | **AED 137,500** |
| Truth | **AED 4,500 — 97% confound** |

> **Rule.** When the exact anchor is unavailable, ask a **weaker question you can answer exactly**
> rather than an exact question you must approximate. A test that can only under-count is publishable;
> one that might over-count is not. And put the diagnostic in the same result — this one cost one
> column and saved the largest error in the audit.

---

### E10c · A filter that protects every query can hide a population from all of them

Every test in this audit carries `AND NOTE_DATE <= CURRENT_DATE()` — sensible, and it prevents
future-dated rows polluting a period measure.

**Measured for the first time (AF3): 216 airfare notes, AED 385,000, dated up to 2028-06-02.**

They were never failed and never passed. **They were never examined**, by anything, and nothing in the
coverage ledger knew it. The filter is per-query and correct; the *gap* is systemic and invisible
precisely because every query applies the same guard.

> **Rule.** Any filter repeated across every test defines a population nobody is looking at. Count what
> each standing exclusion removes, once, and put the number in the coverage ledger.

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

### E13b · Sweep the knowledge base you already wrote

`docs/snowflake.md` line 44 lists `HOUSEMAID_STATUS_LOGS`, `HOUSEMAID_TYPE_LOGS` and
`FACT_MAID_TERMINATIONS` among the verified maid tables. The DEV spec names
`BI_HOUSEMAID_STATUS_LOGS.to_type` as a working route for **N17**, the contract-type timeline that
has blocked group A — airfare, **AED 2.3m** — since the spec was written.

**The audit used none of them.** Every as-of join was built on `HOUSEMAIDS_INFO_REVISION`, an Envers
audit table, while a purpose-built status log sat in the knowledge base. It took the requestor
mentioning it in passing.

E13's rule was "sweep the gold layer before hand-building a metric." This is its twin and it is worse,
because the sweep had already been done and written down. A knowledge base that is not re-read is a
knowledge base that does not exist.

> **Rule.** Before building any point-in-time join, re-read `docs/snowflake.md` for a purpose-built
> log. An Envers revision table is the fallback, not the first choice — it records *that a row
> changed*, where a status log records *what the status became*.

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

## Part 2c — The earlier rounds, compressed

Part 2's examples are all from the final week. These are from before it. They cost as much and are
easier to forget, because each was fixed once and never recurred.

### C1 · No figure is a sum of tests 🔴

Three headlines would have been overstated by adding overlapping tests together:
**O6/O7 by 58%**, O8/O10, and the two bonus findings, which O12 showed overlap by **3 notes across 2
maids** — about AED 1,400 double-counted.

Two tests that both find "bonus overpayment" are usually two *measurements of one population*, not two
populations. **De-duplicate to one verdict per note before any total is written**, and state in the
ledger that each row is a distinct note set — otherwise the reader will add them, correctly following
the arithmetic and wrongly following the meaning.

### C2 · A chance baseline belongs per note, not on the mean 🔴

The window probability `1−(1−p)^k` must be summed **per note**, using each note's own `k`. Averaging
`k` first and applying the formula once is Jensen's inequality in miniature and it biases the baseline.

Its twin: **a chance baseline on the wrong denominator.** A 105-day window with a 30-day band gives
p = 0.286 — one corroboration test scored **1.00× chance** and had been read as *"40% corroborated"*.

### C3 · Monthly rules need the batch cycle, not the calendar 🔴

A duplicate rule keyed on calendar month, applied to a job whose run day crosses the month boundary,
**inflated a count roughly 2× (516 → 259)**. August's anti-attrition run landed on 2026-09-01.

The same fact in reverse produced a near-miss: a `DATE_TRUNC` rollup showed **18 notes in August
against ~930 either side** and looked like a missing AED 200k batch. The 12 batches are 28–32 days
apart with none missing. **Check the cadence before reporting a gap.**

### C4 · A scoped code question that finds nothing is evidence about the SCOPE 🔴🔴

Two spec claims were written as *"X does not exist in the ERP"* on the strength of an interrogation
scoped to `erp/magnamedia-payroll-management`. Both were wrong and both cost a rewrite:

- The **raffle** subsystem lives in `magnamedia-housemaid-management` — `RafflePerformerJob`, five
  tables, weighted draw. The spec had said the prize was hand-entered with no draw record.
- The **anti-attrition** rule lives there too and reaches payroll *indirectly*: no code anywhere calls
  `setAdditionReason("anti_attrition_incentive")` — the string is accounting DB config — which is
  precisely why a payroll-scoped string search found nothing and the spec concluded there was no rule.

> **Rule.** Never record *"X does not exist"* from a scoped question. Re-ask across all modules, or
> write the finding as *"not in module Y"*.

### C5 · Structure in the data is evidence that a rule exists 🟢

The counterpart to C4, and the thing that forced the re-ask. 9,167 anti-attrition notes showed a
**~918-note batch on the last day of every month**, a **median of AED 200 in all twelve batches**, and
about a third of amounts equal to a standard amount × days ÷ days-in-month. Data that regular cannot
come from discretion. Re-interrogated across all modules, **99.5% of the 9,167 fit the recovered
formula exactly.**

> **Rule.** When the data says a rule exists and the code search says it does not, the search is wrong
> until proven otherwise.

### C6 · A formula copied into a document loses part of itself

The Abu Dhabi integer-division hypothesis rested on a formula transcribed into an evidence file
**without its `(double)` cast**. The source was right; the copy was wrong; the finding was built on the
copy. **Quote source, or re-read it — never paraphrase arithmetic.**

### C7 · A per-maid maximum is not an entitlement

O10 used each maid's largest single payment as a proxy for what she was owed. That is sound where the
entitlement is a per-maid constant (anti-attrition, roughly bonus) and **weak where amounts genuinely
vary** — a maid can legitimately take two taxis in a day. Those rows were reported as *screening
signals*, not findings, and they must stay that way.

### C8 · Prefer counting to measuring; record the stop as a decision

Where a per-note quantum is unknown, **count the notes rather than price them**. And when a test is
not worth its cost — 369 hand-written zero notes, PS3, the FD amount test — **write the stop down as a
decision with its reason.** An omission that is not recorded reads later as an oversight, and the next
person pays to rediscover it.

### C9 · The richest evidence is the least usable

`NOTE_REASON` carries amounts, cancellation reasons and at least one passport number. It is
simultaneously the best record of *why* a payment happened and the thing the audit is least permitted
to use. **Shapes before rows, counts before text, and a documented refusal when the exposure exceeds
the finding.** BN3 is the pattern: match on the narrative, return only the derived class and its
totals, report the residual as a count.

---

## Part 2b — The one finding that outlives every number above

Fourteen worked examples, and they are not fourteen independent mistakes. **Six of them are the same
mistake**, and together they are the most useful thing this audit produced:

> **The ERP's maid record carries state that is never reconciled backwards. Every finding built on a
> current-state column moved when a log replaced it** — airfare 137,500 → 4,500 · bonus 143,965 →
> candidates · raffle 3,000 → 0 · relocation 4,700 → 3,900 · anti-attrition 2,476 → 5,726 · office
> work, a clear → void. Four shrank, one grew, one inverted.

That is worth more than any single overpayment, because it is **actionable outside this audit**:
anything in the company reading `HOUSEMAIDS_INFO` to describe a past date is wrong in the same way, and
the fix — read `HOUSEMAID_STATUS_LOGS` / `HOUSEMAID_TYPE_LOGS`, which are interval tables — is one join
pattern.

**The two modes need different defences.** *Stale on change* (`DATE_OF_TERMINATION` not cleared on
re-hire; `HOUSEMAID_TYPE`, `LIVE_OUT` overwritten) **mis-dates**, and a log fixes it. *Never cleared*
(`ASSIGNED_OFFICE_WORK_REASON_ID`: 57.4% of holders terminated, 0.8% in office-work status)
**mis-means**, and no log fixes it — only a base rate exposes it.

The full statement, with the rule and the diagnostic, is §5b of `SPEC_manager_notes_audit_DEV.md`,
§1b of `SPEC_manager_notes_audit_v3.md`, and E9 of `AUDIT-COVERAGE-LEDGER.md`.

---

## Part 3 — The patterns, ready to paste

Six shapes. Every one is lifted from a query that ran, and each is annotated with what it caught.
Full files in `queries/`; `AUDIT-RUN.sql` is the whole cross-cutting battery as one statement.

### P-1 · The as-of read, with its diagnostic

The status and type logs are **interval tables** — `CHANGE_DATE` *and* `NEXT_CHANGE_DATE` — so this is
plain containment. No window function, no approximation.

```sql
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
       ON t.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND n.note_day >= t.CHANGE_DATE::DATE
      AND (t.NEXT_CHANGE_DATE IS NULL OR n.note_day < t.NEXT_CHANGE_DATE::DATE)
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY t.CHANGE_DATE DESC) = 1
```

**Always with this column beside the result:**

```sql
COUNT_IF(t.NEXT_CHANGE_DATE IS NOT NULL) AS resolved_to_a_PAST_interval
```

*Caught:* airfare MV read 76 notes / AED 137,500 with **1 of 76** resolving to a past interval — the
signature of a point read in costume. The real figure was **AED 4,500**.

### P-2 · The chance baseline, summed per note

```sql
ROUND(SUM(1 - POWER(1 - 38.0/211, k_window)), 1)                     AS chance_expected,
ROUND(COUNT_IF(in_band > 0) / NULLIF(SUM(1 - POWER(1 - 38.0/211, k_window)), 0), 2) AS TIMES_CHANCE
```

Per note, with each note's own `k`. Averaging `k` first and applying the formula once biases the
baseline (Jensen).

*Caught:* Salary Dispute corroboration read **90.8%** and scored **1.08× chance**. Both framings of the
raw number — "90.8% corroborated" and "9.2% uncorroborated, AED 31,200" — were wrong.

### P-3 · One verdict per note, before any total

```sql
QUALIFY ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY severity_rank) = 1
```

*Caught:* O6/O7 would have overstated by **58%**; O12 found the two bonus findings overlap by 3 notes.

### P-4 · The base-rate guard on a flag

Before treating any marker as evidence, ask what its holders actually look like:

```sql
WITH holders AS (
    SELECT ID AS maid_id FROM ...HOUSEMAIDS_INFO
    WHERE ASSIGNED_OFFICE_WORK_REASON_ID IS NOT NULL
), now_status AS (
    SELECT HOUSEMAID_ID, TO_STATUS FROM ...HOUSEMAID_STATUS_LOGS
    WHERE NEXT_CHANGE_DATE IS NULL
)
SELECT n.TO_STATUS, COUNT(*), ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),1) AS pct
FROM holders h LEFT JOIN now_status n ON n.HOUSEMAID_ID = h.maid_id
GROUP BY 1 ORDER BY 2 DESC;
```

*Caught:* **57.4%** of office-work-reason holders are `EMPLOYEMENT_TERMINATED` and **0.8%** are in
office-work status. The flag is a never-cleared marker; a clear built on it was void.

### P-5 · A positive control inside an absence test

Carry a population **known to show the presence**. If it comes back empty too, the test is **void, not
negative**.

*Caught:* the loan-recovery test found nothing — and its control (65 relocation notes that *do* book a
loan) also found nothing, proving deduction notes are the wrong table. Without it, "AED 30,220 never
recovered" would have been published. ⚠️ **Use two controls chosen to differ:** a single control
*passed* on the loan-field test, on the one head where the two fields coincide, and bought a full round
of false confidence in a measure wrong everywhere else by an order of magnitude.

### P-6 · What the standing filter hides

Every test carries `NOTE_DATE <= CURRENT_DATE()`. Price that exclusion once, per type:

```sql
SELECT CASE WHEN NOTE_DATE > CURRENT_DATE() THEN 'FUTURE-dated'
            WHEN NOTE_DATE < DATEADD('month',-12,CURRENT_DATE()) THEN 'older than the window'
            ELSE 'inside the window' END AS dating,
       COUNT(*), ROUND(SUM(AMOUNT)), MIN(NOTE_DATE)::DATE, MAX(NOTE_DATE)::DATE
FROM ...HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE='ADDITION' AND REASON = :type AND AMOUNT > 0
GROUP BY 1;
```

*Caught:* **216 airfare notes / AED 385,000** dated to 2028, excluded from every test in the audit and
absent from the coverage ledger. And **70% of all bonus money ever paid** — AED 1,992,552 — sits older
than the window.

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
| **E10b airfare MV** | **137,500** | **4,500 — 97% confound** |

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
