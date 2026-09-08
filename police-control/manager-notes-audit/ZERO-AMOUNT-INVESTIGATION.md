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
