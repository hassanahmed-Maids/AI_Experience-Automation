# Audit run — August 2026

**Run 2026-09-08 · adjudicated by the AI Agent · 899 notes · AED 426,376**

First live pass of the spec against real data. The population is August 2026 by note date, excluding
office-work additions and refunds. Nothing returns GREEN by design: T4, T5 and T7 are blocked on the
expense grant and the three reference lists, so a note that survives every runnable test is
**AMBER — "no runnable test failed, blocked tests outstanding"**, not cleared.

---

## 🔴 The month is not representative, and that has to be said first

**Anti-attrition contributes 18 notes.** It normally contributes ~760 a month and is 52% of the
population by count. Its August batch ran on **2026-09-01**, outside a calendar-August window, so it
will appear in September's run instead. **Every rate below is computed without the largest payment
type in the audit.** Do not read August's mix as typical, and do not compare it to a September run
that will carry two anti-attrition batches unless that is stated on the page.

---

## What the run found

| Class | Notes | % | AED | % of money |
|---|---:|---:|---:|---:|
| Nobody recorded | 351 | 39.0% | 291,071 | **68.3%** |
| No runnable test failed | 186 | 20.7% | 93,792 | 22.0% |
| Duplicate candidate | 154 | 17.1% | 22,203 | 5.2% |
| Zero amount | 120 | 13.3% | 0 | 0% |
| Raised, never approved | 58 | 6.5% | 5,315 | 1.2% |
| **Self-approved** | **26** | 2.9% | **12,745** | 3.0% |
| **No payment type recorded** | **4** | 0.4% | **1,250** | 0.3% |

**Actionable red is AED 13,995 across 30 notes.** The rest is either blocked, by design, or an
artifact of my own checks — separated below, because presenting 899 amber rows as an audit result
would be worse than presenting none.

---

## 🔴 Finding 1 — half of August's airfare notes are worth nothing

**78 of 163 Airfare Ticket notes are AED 0 — 48%.**

A flight-home payment of zero dirhams is not a payment. Three readings, and the data cannot yet
separate them: placeholder rows created ahead of a booking, cancelled bookings left standing, or a
feed defect. Whichever it is, it has two consequences that are not hypothetical:

- **It inflates the note count of the largest money type by roughly half.** Any count-based rate in
  this audit that includes airfare is distorted by it — including the ones in this report.
- **Cross-check against the twelve-month profile: 123 zero-amount airfare notes in a year, and 78 of
  them in August alone.** Either August is exceptional or the pattern is accelerating sharply. That
  is a dated, checkable claim and it should be checked before anything is built on airfare volume.

**The largest single anomaly in the month, and it is not in the red column.**

---

## 🔴 Finding 2 — self-approval, and salary dispute is the concentration

**26 notes, AED 12,745.** The cleanest finding class here: no interpretation needed, the same person
requested and approved.

| Type | Self-approved | of that type |
|---|---:|---:|
| **Salary Dispute** | **14** | **23%** |
| Maids.at other expenses | 5 | 7% |
| Accommodation Relocation | 3 | 4% |
| Airfare Ticket | 3 | 2% |
| Taxi Reimbursement | 1 | 1% |

**Nearly a quarter of August's salary disputes were approved by the person who raised them** — on the
one payment type with no written rule at all, where the amount is a human judgement. That combination
is the finding: unruled *and* unreviewed.

---

## 🔴 Finding 3 — four payments with no payment type

**4 notes, AED 1,250.** No rule can apply to a note that does not say what kind of payment it is, and
nobody can state what the money was for. A hard RED requiring no judgement.

---

## ⚠️ My duplicate check is wrong, and most of its 154 hits are my fault

`Forgive Deduction` returns **91% duplicate candidates**; `Prorated salary` returns **70%**.

Those are not duplicates. The rule I ran — *same maid, same payment type, same month* — flags
legitimate behaviour on both: a maid can have several separate days forgiven, and prorated salary can
carry more than one legitimate entry in a month. **121 of the 154 are this artifact.**

**The real duplicate queue is 33 notes**, in the types where one payment per month is the expectation:
Taxi 15, Salary Dispute 6, Maids.at 5, Medical 4, Airfare 3.

**The fix is in the spec already and I did not apply it:** duplicate detection needs an *entitlement
window per payment type*, not a calendar month. Until that exists, this check must return **BLOCKED
for `Forgive Deduction` and `Prorated salary`**, never a candidate list. Reporting 84 forgive-deduction
"duplicates" to an auditor would burn the report's credibility in its first month.

---

## ⚠️ 68% of the money is "nobody recorded" and most of it is not a finding

| Type | No attribution | Reading |
|---|---:|---|
| MV Prorated Salary | 101 notes, AED 111,512 — **100%** | Machine-generated. Null attribution by design |
| Last Day CC Switch | 66 notes — **100%** | Machine-generated |
| Raffle Prize | 48 notes, AED 15,000 | Drawn by a job |
| Bonus | 39 notes, AED 28,500 — 66% | The known broken control — real, and worsening |
| **Airfare Ticket** | **74 notes, AED 129,500 — 45%** | **Unresolved. The largest money bucket in the month** |

Airfare is the one to settle. It shows 45% with no name *and* 48% at zero — so it is plainly two
populations sharing one payment type, and neither is currently identified. Until the split is
measured, AED 129,500 sits in the largest bucket of the month with no reading attached to it.

---

## The auditor's queue, in order

1. **4 notes** — no payment type recorded. Hard RED, AED 1,250.
2. **14 notes** — self-approved salary disputes, AED 3,295. Unruled and unreviewed.
3. **12 notes** — self-approved elsewhere, AED 9,450.
4. **78 notes** — zero-amount airfare. Not a red; the largest anomaly and the most likely to be a
   systemic defect.
5. **33 notes** — genuine duplicate candidates, after excluding the two types my rule mishandles.

**Everything else is blocked, machine-generated, or an artifact.** Stating which is which is the
report's actual output this month — a list of 899 amber rows would not have been.
