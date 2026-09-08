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
