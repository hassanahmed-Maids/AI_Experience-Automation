# Audit run — 12 months to 2026-09-08

**17,480 notes · AED 7,167,961 · logic only · adjudicated by the AI Agent**

A backlog sweep, not a monthly audit. Duplicate detection still groups **per month** — grouping by
(maid, type) across a year would have flagged nearly all 9,167 anti-attrition notes, since that
payment recurs monthly by design.

| Class | Notes | % | AED | % |
|---|---:|---:|---:|---:|
| No runnable rule failed | 14,245 | 81.5% | 6,406,221 | **89.4%** |
| BLOCKED — duplicate rule needs an entitlement window | 1,647 | 9.4% | 152,161 | 2.1% |
| Duplicate candidate (same month) | 790 | 4.5% | 200,134 | 2.8% |
| Zero amount | 500 | 2.9% | 0 | 0% |
| BLOCKED — dated beyond the audit period | 228 | 1.3% | 392,000 | 5.5% |
| **RED — enrolled after payment** | **53** | 0.3% | **11,419** | 0.2% |
| **RED — no enrolment record** | **9** | 0.1% | **2,126** | 0.0% |
| **RED — no payment type recorded** | **8** | 0.0% | **3,900** | 0.1% |

---

## 🔴 The new check finds six times more than the old one

**B1b — an enrolment dated *after* the payment it justifies — returns 53 notes, AED 11,419.**
**B1 — no enrolment record at all — returns 9.**

v2 had B1 and not B1b. It tested that a justifying record existed *ever*, and by that test all 53 of
these pass. **The check that did not exist finds 5.9× more than the check that did**, and it needed
one predicate: `enrolled_on <= note_day`.

August surfaced exactly one of these (note 184233). Twelve months surfaces 53. **This is the
strongest argument in the file for running the audit over a year before trusting a month.**

B1's 9 notes in 9,167 (0.1%) confirm the earlier reading: the enrolment record almost always exists.
Its value is the hard RED when it fires, never the 99.9% it clears.

---

## 🔴 500 zero-amount notes, across 14 payment types

Not an airfare quirk. **MOHRE requirement additions is 44% zero — 36 of 82.** `Maids.at other
expenses` is 20%. Salary Dispute 9.6%, Airfare 7.4%, Bonus 5.8%.

MOHRE was never examined before this run; it entered the population only when the type census
replaced the assumed list. **A payment type where nearly half the notes are worth nothing has either
a broken process or a note that means something other than a payment** — and note 185724 already
showed the second is possible, carrying a real AED 1,419 marked *"paid manually"*.

At AED 0 they cost nothing and distort everything: they inflate note counts, deflate average amounts,
and sit inside the denominator of every rate in this report.

---

## ⚠️ A discrepancy in our own numbers, stated rather than smoothed

This run returns **516 anti-attrition duplicate candidates**. `anti-attrition-cases.sql` reports
**167** such cases over the same period.

The likely explanation is grain: **516 is notes, 167 is groups** — at roughly three notes per group
the two reconcile. But *likely* is not *checked*, and two figures for one thing in one audit is
exactly what a reader will notice first. **Reconcile before either number is published.**

Either way it is a review list, not a verdict: without `CONTRACT_ID` a genuine two-contract month is
indistinguishable from a double payment.

---

## The future-dated population, correctly ring-fenced

**228 notes, AED 392,000 — 225 of them airfare.** Dated beyond today, so they cannot be matched to a
payslip that has not happened. They are **BLOCKED, not dropped**: an earlier draft of this audit would
have rejected them as a feed defect and deleted 5.5% of the money, most of it in the largest type by
value. The forward-decay curve says these are real bookings carrying travel dates.

---

## 🔴 What the run does not claim

**89.4% of the money — AED 6.4m — passed every rule that can currently run, which is not a pass.**
T4, T5, T7 and most group rules are blocked on the expense grant and the reference lists. Over twelve
months the audit examined **roughly a tenth of the money**, the same proportion as in August.

The year did what a month could not: it gave the anti-attrition checks a population large enough to
prove themselves, turned zero-amount notes from an August anomaly into a 14-type pattern, and put 53
hard REDs on the board where August had one.
