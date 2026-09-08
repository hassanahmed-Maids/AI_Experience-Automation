# Zero-amount notes — the AI Agent's verdict register

**Agent run 2026-09-08.** Population: **510 zero-amount ADDITION notes, 15 payment types, 12 months.**
Method and evidence: `ZERO-AMOUNT-INVESTIGATION.md`. Queries: `queries/zero-amount-investigation.sql`.

## How the Agent is allowed to work here

`NOTE_REASON` is free text about named people. **The Agent reads it; the audit never republishes it.**
So the read is done on **normalised shapes** (Z6) — digits replaced by `#`, whitespace collapsed,
one-off phrasings suppressed — which collapses templated notes to one line each and strips the figures
out of the export before it is ever seen. **No verdict below quotes a note, and none ever will.**

**Verdict algebra** (spec §7, unchanged): `RED ⟸ any applicable test RED` · `AMBER ⟸ any BLOCKED` ·
`GREEN ⟺ every applicable test ran and returned GREEN`. **A verdict the Agent cannot reach is BLOCKED,
never GREEN.**

---

## V1 · 🔴 RED — **REVISED 2026-09-08 (conv. 46016).** 18 notes exist that the only documented producer cannot create

**18 notes · 100% zero · one day (2026-08-31) · AED 0**

Every note this payment type produced in twelve months is worth nothing, from a single run.
`AbuDhabiMaidIncentiveExpenseJob` computes `abuDhabiIncentiveOffered × eligibleDays ÷ totalDaysInMonth`
*(code-verified, conv. 46015)*; an entire run at zero means the offered amount, the eligible-day count,
or the write-back failed. **Z5 rules out the money landing elsewhere:** across August–September those
18 maids carry five other notes between them (4 anti-attrition AED 794; 1 accommodation relocation
AED 800), so **at least 15 of the 18 received nothing at all.**

### 🔴 The code answer inverted this. Four of my five claims are withdrawn.

| Claim | Status after conv. 46016 |
|---|---|
| 18 notes, 100% zero, one day, the whole payment type | ✅ **stands** — measured |
| The Abu Dhabi job is broken | ❌ withdrawn |
| A one-line integer-division fix | ❌ withdrawn — the `(double)` cast is present |
| Eligibility is consumed, so they stay unpaid | ❌ withdrawn — the marker is written only on success, so a maid who computes zero is **re-selected next month** |
| **≥15 maids are owed money and did not receive it** | ⚠️ **unsupported** |

**`MaidIncentiveService` L305-308 returns early when the amount is zero** — *"Calculated amount is
zero — no request created"* — **before** `createMaidIncentiveExpenseRequest` is reached. **The job
cannot post a zero-amount request.** So the one producer we knew about is the one producer that
provably did not make these 18 notes.

**The unpaid-maids claim went with it.** It assumed the notes represent owed incentives. If they are
markers or manual entries, nobody may be owed anything — and I stated it as the finding's human cost
before I had established the notes were payments at all.

**Verdict: RED — but for the gap, not for the job.** *Eighteen notes exist under a payment type whose
only documented producer cannot create them.* A smaller human story and a larger control story: an
undocumented path is writing notes under an incentive's expense code. **Z7 asks who.**

**What still holds:** the run-level test. A per-note verdict structurally cannot see *"100% of this
type is zero"*, and that remains true whatever produced them.

### 🟢 One question closed for free

Both config parameters **default to expense code `AAI - 01` in source**. Had the live Abu Dhabi
parameter kept that default, its notes would carry `anti_attrition_incentive` — the reason comes from
`Expense.salaryAdditionType`, not from the producer. **A distinct `Abu Dhabi Incentive` reason exists
in the data, so the live parameter carries a different code.** That settles what F3 was blocked on:
**the Abu Dhabi job never was an explanation for the 42 anti-attrition cases.**

---

## V2 · 🔴 RED (provisional, pending Z6) — 90 notes indicate payment outside payroll

**90 notes · 11 payment types · 79 maids · 84 carry a figure · 2025-09-08 → 2026-09-04**

Standalone zeros whose text matches manual/cash/already-paid language. Running the entire year, so not
an incident. **If it holds, money moved outside the system of record and a zero-amount note is the only
trace it left — invisible to this audit and to payroll controls alike.** Note 185724 (a real AED 1,419
marked *"paid manually"*) is a specimen, not an outlier.

**Verdict: RED, provisional.** The Agent issues it provisionally and not finally because a keyword
match is an **indicator, not proof** — a note saying *"manual"* is a candidate for off-payroll payment,
not evidence of one. **Z6 converts it or withdraws it.**

---

## V3 · 🟢 **RESOLVED by Z6 for the bulk** — was: 289 notes unread

**289 notes · 13 payment types · 272 maids · 132 carry a figure**

They match none of the keyword classes. **The Agent will not guess at them and will not report the 39%
it did classify as though it covered the whole.** More regexes would only move notes between buckets
the Agent invented.

**Z6 answered most of it. 🟢 81 notes — 16% of the whole zero-amount alarm — are
system-generated markers reading *"auto added by the system when the housemaid passes upload the
e-residency step"*, with variants recording that the bonus is postponed or explicitly not payable.
Zero is the correct amount. They are not defects and should never have been in a findings population.**
A further 18 are a `Forgive Deduction` cluster belonging to **two or three maids**, and 2 are empty.

**What remains: 369 notes, each a unique hand-written phrasing, one per maid.** They do not collapse,
which is the answer rather than a gap — **no classifier was ever going to work on them.**

**Verdict: the population is resolved; the residue is closed unread, deliberately.** See V7.

---

## V4 · 🟠 AMBER — cancelled, adjustment, never-filled

**93 notes:** 43 cancelled or superseded · 28 adjustments · 22 raised and never filled · 2 with no text.
Real housekeeping defects with no money attached — a request left in place rather than withdrawn, or a
workflow that never closes. **Verdict: AMBER, as the spec already had them.** The 22 never-filled are
the only sub-class worth a process fix: a request that is raised and never completed has no owner.

---

## V5 · 🟢 GREEN (closed) — MOHRE requirement additions

**36 notes · 43.9% zero · window 2025-11-05 → 2026-01-10, then nothing for eight months.**

**This audit led with the 44%.** It is a closed incident, and quoting the rate without the window made
something finished read as ongoing. **Verdict: GREEN — closed, no action.** Recorded as **trap 23**:
*every rate in a finding carries its first and last date.*

---

## What the register says overall

| | Notes | Verdict |
|---|---:|---|
| Abu Dhabi notes | 18 | 🔴 RED — an undocumented producer |
| Paid outside payroll | 90 | 🔴 RED, provisional |
| **Unread** | **289** | ⚠️ **BLOCKED** |
| Housekeeping | 93 | 🟠 AMBER |
| MOHRE | 36 | 🟢 GREEN, closed |
| *(non-standalone zeros)* | 36 | 🟠 AMBER — beside a paid note |

**One verdict is final, one is provisional, and the largest group has no verdict at all.** That is the
honest state of this investigation, and the Agent reports it that way rather than leading with the 90.


---

## V6 · 🔴 RED — identity-document data in the manager-note free-text field

One note shape carries a maid's **full name, passport number, an internal ERP URL and a payment
instruction**, in a description column read by every downstream consumer of this table — this audit
included. **The value is not reproduced here and will not be.**

This has nothing to do with zero amounts; the investigation simply walked into it. `NOTE_REASON` is
unstructured and unmasked, and it is holding identity-document data.

**Verdict: RED — raised as a data-protection matter in its own right, not folded into a money finding.**
It needs an owner outside this audit. **Scope is unknown and deliberately not measured here:** counting
how many notes contain passport numbers would mean scanning the whole free-text corpus for
identity documents, which is the thing being reported.

---

## V7 · ⛔ CLOSED UNREAD — the 369 hand-written notes

369 unique phrasings, one per maid, carrying **AED 0**.

Reading them means reading 369 free-text descriptions about 369 named people — the highest-exposure act
available in this investigation — to refine a population with no money in it. **The Agent declines.**

**The control finding does not depend on the wording.** *Ninety zero-amount notes across eleven payment
types and seventy-nine maids indicate payment happened outside payroll* is actionable as it stands, and
its fix is a process fix. Reading eighty-three more descriptions would not change it.

**Verdict: CLOSED UNREAD, by proportionality.** Recorded as a decision, not an omission: more reading
here buys precision on AED 0 and spends the audit's licence to read personal data. **If the process
owner disputes V2, the read can be reopened for those 90 notes specifically — and only those.**

---

## Register, final

| | Notes | Verdict |
|---|---:|---|
| Abu Dhabi notes | 18 | 🔴 **RED — an undocumented producer**, not a broken job |
| Paid outside payroll | 90 | 🔴 **RED — provisional, and actionable as it stands** |
| PII in free text | — | 🔴 **RED — new, needs an owner outside this audit** |
| 🟢 System-generated markers | **81** | 🟢 **N_A — correct by design, never a finding** |
| Forgiveness cluster | 18 | 🟠 AMBER — two to three maids, not a pattern |
| Housekeeping | 93 | 🟠 AMBER |
| MOHRE | 36 | 🟢 GREEN — closed incident |
| Hand-written residue | 369 | ⛔ CLOSED UNREAD — proportionality |

**The 510-note alarm resolves to two real findings, one new one the investigation was not looking for,
and a large correct-by-design population that should never have been counted.**


---

# Revision 2 · 2026-09-08 (conv. 46017, payroll in scope) — the mechanism, and a bigger finding

## V8 · 🔴 RED — nothing validates the amount on the addition path

**Twenty code paths create a `PayrollManagerNote`. Two refuse a zero.**
`AbstractPayrollManagerNote.amount` is a nullable `Double` with **no bean validation, no
`@PrePersist`/`@PreUpdate`, and no DB `NOT NULL` or `> 0` constraint.**
`processExpenseRequestTodo` copies `expenseRequestTodo.getAmount()` verbatim; the generic
`PUT /ManagerNotes` persists whatever the client sends; `POST /ManagerNotes/bulkcreate` posts a
client-supplied list unchecked.

🔴 **The asymmetry is inside a single file.** `ExpenseRequestTodoBusinessRule` guards the **loan**
branch with `loanAmount > 0.0` and applies **no equivalent guard to the addition amount**. Someone knew
the check was needed and wrote it on one branch.

**Verdict: RED.** This is the mechanism behind the whole 510-note population — not a cause, a *licence*.
**Fix: one guard, on the addition branch, matching the one already on the loan branch.**

## V9 · 🔴 RED (raised as a question, mechanism named) — a cancelled expense does not void its note

**A `PayrollManagerNote` is never voided when its `ExpenseRequestTodo` is cancelled, rejected or
reversed.** No listener exists for those transitions, and **the note holds no foreign key back to the
request**, so nothing *can* link back to void it. Once created, the note outlives the request that
justified it.

For a zero note this is harmless. **For a non-zero note it is not — the note is what payroll pays
from.** ⚠️ **Whether accounting permits a cancel after `PAID`/confirmed is not established** (marked
unverified in the answer), so this is a question with a named mechanism, not a confirmed loss.

**Verdict: RED, pending one confirmation.** **It is the largest thing found today and it has nothing
to do with zero amounts** — the zero-amount investigation walked into it, exactly as it walked into V6.

## V10 · 🟢 The born-zero question is answerable — `PayrollManagerNote` is `@Audited`

Hibernate Envers retains **every revision, including an amount before it was edited to zero**. That
splits all 510 into born-zero and zeroed-later, which no query so far could.

⚠️ **And it is the only trail that would.** `AuditorAction` rows are written only when
`logActionRequired` is true **and** the acting user holds position `payroll_auditor` — and
`logActionRequired` is set only by `customDelete`. **Background, service and generic-`PUT` edits
produce no `AuditorAction` at all.** The visible audit trail misses precisely the paths most likely to
have written these notes.

**Verdict: BLOCKED — Z8 answered, and the answer is no.** Only two manager-note objects exist
account-wide, `CLIENT_MANAGER_NOTES` and `HOUSEMAID_MANAGER_NOTES`, both views. **No Envers audit
table is ingested**, so born-zero versus zeroed-later cannot be settled from the warehouse. It joins
the raffle tables and `HousemaidExtraFields` as a named ingestion ask — **and it is the most valuable
of the three, because it makes note history auditable at all rather than unblocking one check.**

## What zero notes actually do in payroll

Excluded from payslip lines and must-be-paid selection (both filter `amount > 0.0`), so they move no
money. But the regular-additions query has **no** amount filter, and the mark-as-paid loop touches
notes irrespective of amount — **a zero note can be flagged paid and linked to a
`PayrollAccountantTodo`.** Cosmetically present, financially inert.

---

# V1 · FINAL · 🔴 RED — the Abu Dhabi programme was relabelled and stopped paying in the same run

**Z9 settles it.** One requester, five consecutive month-end runs, the same cohort of 18–20 maids:

| Run | Payment type | Notes | AED | Zeros | Per maid |
|---|---|---:|---:|---:|---:|
| 2026-04-30 | Bonus | 20 | 4,750 | 0 | 237.50 |
| 2026-05-31 | Bonus | 20 | 4,750 | 0 | 237.50 |
| 2026-06-30 | Bonus | 19 | 4,550 | 0 | 239.47 |
| 2026-07-31 | Bonus | 18 | 4,200 | 0 | 233.33 |
| **2026-08-31** | **Abu Dhabi Incentive** | **18** | **0** | **18** | **0.00** |

**The payment type changed and the amount collapsed to zero in the same run.** April–July totals
AED 18,250, reconciling exactly with Z7's figure for this requester.

## 🔴 The withdrawn claim is restored, on different evidence

This morning I said *"at least 15 maids are owed money and did not receive it"*, then **withdrew it as
unsupported** when the code showed the job cannot post a zero. **The withdrawal was correct — the
evidence I had did not support it.** Z9 supports it, by a route I had not used: **the four preceding
runs prove the entitlement.** These maids were paid ~AED 236 each, every month, for four months, and
then nothing.

**Size: roughly AED 4,200–4,300, 18 maids, one month.** Small money, a real service failure, and
**September's run (2026-09-30) has not happened yet** — unfixed, it recurs.

## 🔴 Two further consequences

**1. "New programme" was wrong.** I said this was a newly-enabled incentive whose first run paid
nobody. **It has been running since at least April under the `Bonus` label.** What is new is the
*label*, not the programme.

**2. The `Bonus` payment type is contaminated.** ~77 notes across four months carry `Bonus` but are
Abu Dhabi incentives. Every `Bonus` figure in this audit — its 5.8% zero rate, its rules, its
population — includes them. **A relabelling mid-year silently re-partitions the census**, and nothing
in the audit design would have caught it.

## The mechanism remains open, and does not block the fix

The addition reason comes from `Expense.salaryAdditionType`, so a **configuration change on or before
2026-08-31 moved this batch onto a different expense** — and the amount broke in the same run. Whether
the new expense zeroes the amount, or the job sent zero, or the note was written by another path
(V8: twenty creation paths, two guards) is **DB configuration and not answerable from source**.

**It does not need to be answered to act.** The owner of that config change knows what they changed.
**Verdict: RED — final, sized, and with 18 people at the end of it.**
