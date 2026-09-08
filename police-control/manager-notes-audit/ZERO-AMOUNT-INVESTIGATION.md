# Zero-amount manager notes — investigation design

**Opened 2026-09-08.** 500 notes across 14 payment types carry `AMOUNT = 0`. The spec routes them to
**AMBER via T3** *("zero-amount addition")* and stops there. That is the right verdict for a note and
the wrong answer for a population: at AED 0 they cost nothing individually and distort everything
collectively — they inflate note counts, deflate averages, and sit inside the denominator of every
rate in the report.

## What is already established

| | |
|---|---|
| Scale | **500 notes, 14 payment types** (12-month run) |
| Worst rate | **MOHRE requirement additions: 44% zero — 36 of 82** |
| Others | `Maids.at other expenses` 20% · Salary Dispute 9.6% · Airfare 7.4% · Bonus 5.8% |
| 🔴 A zero is not always "nothing happened" | **Note 185724 carries a real AED 1,419 in its free text, marked *"paid manually"*.** So a zero-amount note can record money that moved outside the amount field |
| Airfare's zeros are a **spike, not a rate** | 78 of 163 airfare notes were zero in **August 2026 alone** across 9 distinct days. Every other month in the year runs 0–8. That is a window, not a process |

## The three hypotheses, and what separates them

1. **Data defect** — the amount was lost on the way in. Predicts: clustered in time, clustered by
   producer, no amount recoverable anywhere, and a matching non-zero expense request behind it.
2. **Semantic marker** — the note is being used to record something that is not a payment (a
   correction, an acknowledgement, a "paid manually" annotation). Predicts: steady rate, amount
   present in the free text, and often a companion non-zero note on the same maid and day.
3. **Process breakage** — the note is raised before the amount is known and never revisited.
   Predicts: steady rate, no amount anywhere, concentrated in a few payment types with a
   raise-then-fill workflow.

**They are separable without reading a single note.** The August airfare spike already looks like (1);
note 185724 already proves (2) happens at least once. The question is the mix.

## 🔴 The rule this investigation must not break

`NOTE_REASON` is free text about a named person. **The AI Agent reads it; the audit never republishes
it.** Every query below returns **counts and sums only** — never a text sample, never a row list. Where
a query tests whether text *contains* an amount, that is an **indicator, not a value**: digits in prose
can be dates, contract numbers or MOHRE references, and any figure derived from them is labelled
unverified and never added to a money total. *(This is the same antipattern as
`correctIncentiveHistoricalData` setting `incentiveAmount` from prose — measuring it is legitimate,
trusting it is not.)*

## The tests

- **Z1 — census.** Every payment type with a zero, its rate, how many distinct days the zeros fall on,
  the window, and how many carry a number in their text. Distinguishes a rate from a spike per type.
- **Z2 — time shape.** Zeros by month across all types, with how many types are affected each month.
  A single bad month across many types is one incident; a steady band is a process.
- **Z3 — companion notes.** Does a zero sit beside a non-zero note for the same maid on the same day?
  That is the signature of hypothesis 2 — the zero is an annotation, not a payment.

Run in that order. Z1 says which types to care about, Z2 says whether it is an incident, Z3 says
whether the zeros are payments at all.

---

# Z1–Z3 results, 2026-09-08

**510 zero-amount notes across 15 payment types**, not 500 across 14 — the earlier figure came from
the assumed type list and is superseded.

## 🔴 Z3 first, because it eliminates a hypothesis

| Shape | Maid-days | Zero notes | AED paid those days |
|---|---:|---:|---:|
| **Zeros ALONE — nothing else paid that maid that day** | **453** | **474** | **0** |
| Zero beside a paid note of the same type | 25 | 36 | 15,870 |

**93% of zero notes stand alone.** Hypothesis 2 in its simple form — *the zero is an annotation
attached to a real payment* — is **dead for the bulk**. These are not companion rows. They are
standalone events on days when the maid was paid nothing at all.

## 🔴 And they are not empty rows either

**508 of 510 carry free text** (only 2 are blank, both anti-attrition). **319 of 510 — 62.5% — carry a
number in that text.** Three types are near-total: `Forgive Deduction` **32 of 32**, `Abu Dhabi
Incentive` **18 of 18**, `Maids.at other expenses` **65 of 69**.

So the dominant shape is: **a note was raised, someone wrote a description containing a figure, and
nothing was paid.** Note 185724 — a real AED 1,419 marked *"paid manually"* — is not an outlier any
more; it is a specimen of the largest group.

## 🔴 Abu Dhabi Incentive is 100% zero, on one day

| | |
|---|---|
| Notes | **18 of 18 — the entire payment type** |
| Zero | **18 (100%)** |
| Days | **1 — 2026-08-31** |
| With a number in the text | **18 (100%)** |

**Every note this payment type has ever produced in twelve months is worth nothing**, from a single
run. This is `AbuDhabiMaidIncentiveExpenseJob`, whose amount is
`abuDhabiIncentiveOffered × eligibleDays ÷ totalDaysInMonth` *(code-verified, conversation 46015)*.
A whole run returning zero means the offered amount, the eligible days, or the write-back is broken.
**This is the cleanest defect in the investigation and needs no further data to file.**

## The other types split three ways

| Type | Zeros | % | Days | Window | Shape |
|---|---:|---:|---:|---|---|
| Airfare Ticket | 129 | 7.8 | 51 | 2025-09-08 → 2028-03-11 | baseline **plus** the August spike |
| Salary Dispute | 104 | 9.6 | 61 | full year | **steady process** |
| Bonus | 70 | 5.8 | 50 | full year | steady process |
| `Maids.at other expenses` | 69 | 20.2 | 40 | 2026-01-14 → 2026-09-02 | steady, high rate, 94% carry a figure |
| **MOHRE requirement additions** | 36 | **43.9** | 14 | **2025-11-05 → 2026-01-10** | 🟢 **a closed incident** |
| Forgive Deduction | 32 | 3.0 | 8 | 2026-01-03 → 2026-08-06 | few days, **100%** carry a figure |
| Abu Dhabi Incentive | 18 | **100** | **1** | 2026-08-31 | 🔴 **one broken run** |

**MOHRE's 44% is the number this report led with, and it is the least urgent of them.** Its window
closed on 2026-01-10 — eight months ago, nothing since. **A rate quoted without its window reads as
ongoing when it is over.** That is trap 23.

## Z2 — a persistent floor with one spike on top

Zeros run **0.8%–3.5% every month** and hit **13.3% in August 2026** (120 of 902 notes, 8 types,
23 days). The August spike is not one bad day: 96 of the 120 are airfare (78) and Abu Dhabi (18), and
the remaining 24 are spread across six other types on many days.

**So there are two phenomena, and the spec's single AMBER verdict covers both:** a steady ~2–3% floor
across many types, and an August event. Neither is a lost-amount data defect in the way hypothesis 1
predicted — that would not leave 62.5% of the notes carrying a figure in prose.

## What is left to decide

The 474 standalone zeros are one of:
- **money that moved outside payroll** (the "paid manually" reading — invisible to this audit *and* to
  payroll controls, and the most serious possibility);
- **cancelled or superseded requests** left in place rather than deleted;
- **raised-and-never-filled** requests, a workflow that never closes.

**Z4 separates them by keyword class, counts only.** That is the last query this needs.

---

# Z4–Z5 results — and the honest limit of this method

## Z4 — the 474 standalone zeros, classified

| Class | Notes | Types | Maids | Carry a figure | Window |
|---|---:|---:|---:|---:|---|
| ⚠️ **6 — none of the above** | **289** | 13 | 272 | 132 | 2025-09-24 → 2028-03-11 |
| 🔴 **1 — money moved elsewhere** | **90** | 11 | 79 | **84** | 2025-09-08 → 2026-09-04 |
| 2 — cancelled or superseded | 43 | 9 | 38 | 35 | full year |
| 4 — an adjustment | 28 | 3 | 25 | 26 | 2025-10-04 → 2026-07-27 |
| 3 — raised, never filled | 22 | 5 | 22 | 12 | 2025-09-13 → 2027-01-24 |
| 5 — no text at all | 2 | 1 | 1 | 0 | Jan 2026 |

🔴 **90 notes across 11 payment types and 79 maids carry language indicating the payment happened
outside payroll, and 84 of the 90 carry a figure.** It runs the whole year — this is not an incident.
**If it holds, money is moving outside the system of record, invisible to this audit and to payroll
controls alike, and a zero-amount note is the only trace left behind.**

⚠️ **The classifier explains 39% of the population and no more.** 289 notes — **61%** — match nothing,
across 13 payment types and 272 maids, 132 of them carrying a figure. **This investigation cannot
conclude on the majority of its own population.** Saying so is part of the result; another round of
regexes would only move notes between buckets I invented.

**The next step is not SQL.** It is the **AI Agent reading a sample of the free text** — the Agent
reads it, the audit never republishes it. That is what the Agent exists for, and it is the only thing
that can classify 289 notes written by people rather than by a schema.

## Z5 — the Abu Dhabi run paid nobody, and nothing else paid them either

Across August–September 2026, the 18 maids carry only **five** other notes between them:

| Other payment type | Notes | Maids of the 18 | AED |
|---|---:|---:|---:|
| Anti-attrition Incentive | 4 | 2 | 794 |
| Accommodation Relocation | 1 | 1 | 800 |

**At least 15 of the 18 received nothing at all.** The money did not land under another reason — it
did not land. This is a defect **and** an unpaid entitlement, and it is the one finding here that can
be filed today with no further data.
