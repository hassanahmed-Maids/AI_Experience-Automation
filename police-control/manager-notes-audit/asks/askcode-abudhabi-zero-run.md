# Ask-the-code · Why did every Abu Dhabi incentive in the 2026-08-31 run compute to zero?

**Modules:** `erp/magnamedia-housemaid-management,erp/magnamedia-accounting`
**Asked:** 2026-09-08 · **Session:** 46016 (answer verbatim in `evidence-abudhabi-conv46016.md`)
**Drives:** verdict V1 in `ZERO-AMOUNT-VERDICTS.md` — 18 notes, 100% zero, one run, ≥15 maids unpaid

## Why we are asking

`Abu Dhabi Incentive` has produced **18 notes in twelve months, all on 2026-08-31, all AED 0** — the
entire payment type. The selection query requires a **non-zero** offer, so the amount cannot be zero
because nobody was owed anything. Z5 confirms the money did not land under another reason.

**The leading hypothesis is integer division.** The anti-attrition job casts:
`(daysBetween / (double) totalMonthDaysTillNow)`. The Abu Dhabi variant is recorded as
`offered * (eligibleDays / totalDaysInMonth)` with **no cast**, and `abuDhabiIncentiveOffered` is an
`Integer`. If both operands are integral, the quotient is 0 for every maid eligible for less than a
whole month — and on a programme's first run, that is all of them.

## The question (verbatim, as submitted)

> Context: `AbuDhabiMaidIncentiveExpenseJob` calls `MaidIncentiveService.processAbuDhabiIncentives()`
> in magnamedia-housemaid-management. It selects via
> `HousemaidExtraFieldsRepository.findEligibleForAbuDhabiIncentive(...)`, which requires
> `abuDhabiIncentiveType IS NOT NULL AND <> 'NO_AD_INCENTIVE'`, `abuDhabiIncentiveOffered` non-null and
> non-zero, and `lastAbuDhabiIncentiveProcessedDate IS NULL OR < firstDayOfMonth`. Around
> `MaidIncentiveService` L298-299 the amount is computed as
> `abuDhabiIncentiveOffered * (eligibleDays / totalDaysInMonth)`.
>
> In production, this payment type produced 18 notes in the last twelve months, every one on
> 2026-08-31, and **every one with amount 0**. Please answer each of the following from the code, and
> mark anything that is DB configuration or runtime data rather than source as unverified rather than
> inferring it:
>
> 1. **Show the exact amount calculation, with declared types.** Give the declared type of
>    `abuDhabiIncentiveOffered`, of `eligibleDays`, of `totalDaysInMonth`, and of the expression's
>    result. **Is the division integral?** If `eligibleDays` and `totalDaysInMonth` are both `int` /
>    `Integer`, `eligibleDays / totalDaysInMonth` evaluates to 0 for every maid eligible for fewer than
>    a whole month, and to 1 only when they are equal. Confirm or deny that, quoting the line. Compare
>    it with `MaidIncentiveExperimentJob.calculateProportionalAmount`, which casts
>    `(daysBetween / (double) totalMonthDaysTillNow)` — does the Abu Dhabi path have an equivalent cast
>    anywhere, including inside a helper or a `BigDecimal`/`Math` call?
> 2. **How is `eligibleDays` derived**, and what makes it smaller than `totalDaysInMonth`? Name the
>    date fields it reads (tag date, contract start, relocation date, `lastAbuDhabiIncentiveProcessedDate`,
>    anything else) and whether a maid first enrolled part-way through a month is eligible only from
>    her enrolment date. Can `eligibleDays` be 0, and under what condition?
> 3. **Is a zero amount guarded anywhere?** Does the job skip creating the expense request when the
>    computed amount is 0, or does it post a zero-amount `ExpenseRequestTodo` regardless? Show the
>    branch. If there is no guard, a failed calculation becomes a note rather than an error, which is
>    exactly what we observe.
> 4. **Does the run consume the maid's eligibility even when it pays nothing?** Is
>    `lastAbuDhabiIncentiveProcessedDate` (or any equivalent marker) written when the amount is 0? If
>    it is, say whether the `IS NULL OR < firstDayOfMonth` filter still re-selects that maid the
>    following month, or whether she is now permanently skipped. **This decides whether the 18 will
>    self-correct on the next run or stay unpaid.**
> 5. **Rounding elsewhere in the path.** After the calculation, does anything round, truncate or cast
>    the amount again — in `createMaidIncentiveExpenseRequest`, in the accounting
>    `ExpenseRequestTodo`, or in payroll's `ManagerNoteService.processExpenseRequestTodo`? A correct
>    computation truncated later would present identically.
> 6. **When did this job first run?** Is `AbuDhabiMaidIncentiveExpenseJob` registered with a trigger in
>    source or seeded as a DB `JobInstance`? We see no notes of this type before 2026-08-31, which
>    suggests a newly enabled programme whose first run paid nobody — confirm what the code can say and
>    mark the schedule unverified if it is DB config.
> 7. **What expense code does the Abu Dhabi path use?** It loads
>    `ABU_DHABI_MAID_INCENTIVE_CONFIGS_PARAM` while the experiment job loads
>    `MAID_INCENTIVE_CONFIGS_PARAM`. Name the field the expense code is read from in each, so we can
>    tell whether both resolve to `AAI - 01` or to different codes.
>
> For each answer give file paths and line numbers.

## Why each answer matters

| Answer | Consequence |
|---|---|
| Integer division confirmed (Q1) | **A one-line fix**, and it explains 100% of the run. It would also mean any partial-month Abu Dhabi maid has always been paid nothing |
| No zero-amount guard (Q3) | A failed calculation is recorded as a payment of nothing instead of raising an error — **the reason nobody noticed for eight days** |
| Eligibility consumed (Q4) | 🔴 **Decides whether the 18 self-correct on 2026-09-30 or stay unpaid indefinitely.** This is the most time-sensitive answer in the set |
| Rounding downstream (Q5) | Moves the defect out of this job and into a path shared by every payment type |

**We cannot size the underpayment from the warehouse:** `HousemaidExtraFields` is not ingested, so
`abuDhabiIncentiveOffered` is unreadable. Q1 and Q2 are the only route to the amount owed.

---

# Answered · session 46016 · 2026-09-08 — the hypothesis is denied and the finding inverts

## 🔴 My integer-division theory is wrong

The real line is `Math.round(offered * ((double) eligibleDays / totalDaysInMonth) * 100.0) / 100.0`
(`MaidIncentiveService` L296-300). **The cast is present**, on the numerator rather than the
denominator. `10 / 31` evaluates to `0.322`, not `0`. The earlier evidence file recorded the formula
without the cast, and I built a hypothesis on that transcription rather than on the code.

Also denied: **`PIT_STOP` is not prorated at all** — it takes the full offered amount
(`calculatedAmount = (double) offered`). Proration runs only for `RELOCATION` and `AD_CANCELLED`.

## 🔴 The answer that matters: this job **cannot** produce a zero-amount note

```
if (calculatedAmount == null || calculatedAmount <= 0) {
    result.put("skipped", true);
    result.put("message", "Calculated amount is zero — no request created");
    return result;
}
```

`MaidIncentiveService` L305-308. **When the amount is zero the job returns before
`createMaidIncentiveExpenseRequest` is ever called.** No zero-amount `ExpenseRequestTodo` is posted.

And L319-325: `updateProcessedDate` runs **only inside the `created` branch**, so a maid who computes
zero keeps her marker null and is **re-selected next month**. She is never permanently skipped.

**So the 18 notes did not come from `AbuDhabiMaidIncentiveExpenseJob`.** The one producer we knew
about is the one producer that provably cannot have made them.

## What this does to verdict V1

| Claim | Status |
|---|---|
| 18 notes, 100% zero, one day, whole payment type | ✅ stands — measured |
| The Abu Dhabi job is broken | ❌ **withdrawn** — the job refuses to post zero |
| A one-line integer-division fix | ❌ **withdrawn** — the cast is present |
| The eligibility is consumed, so they stay unpaid | ❌ **withdrawn** — the marker is written only on success |
| **≥15 maids are owed money and did not get it** | ⚠️ **unsupported.** It assumed these notes represent owed incentives. If they are markers or manual entries, nobody may be owed anything |

**The finding is now the gap itself: 18 notes exist under a payment type whose only documented producer
cannot create them.** That is a smaller human story and a larger control story — an undocumented path
is writing notes under an incentive's expense code.

## 🔴 A deduction the answer enables for free

Both config parameters **default to expense code `AAI - 01` in source**. If the live Abu Dhabi
parameter still held that default, its notes would carry `anti_attrition_incentive` — because the
addition reason comes from `Expense.salaryAdditionType`, not from the producer. **A distinct
`Abu Dhabi Incentive` reason exists in the data, so the live parameter must carry a different expense
code.** That settles, from data plus source, the question F3 was blocked on: **the Abu Dhabi job does
not land under `anti_attrition_incentive`**, and it was never an explanation for the 42.

## ⚠️ One line of the answer is my error, not a code fact

The answer reports that `ManagerNoteService.processExpenseRequestTodo` *"does not exist in either
repository in scope"*. **It exists — I did not pass the payroll module in the alias list.** Conversation
45934 quotes it directly from `magnamedia-payroll-management`. **A negative result from a scoped search
is not a negative result**, and I nearly recorded one as a finding. Trap 24.

## Next

**Z7** — who created the 18? The notes view carries `REQUESTED_BY`. If it is a human-shaped requester
rather than a batch account, the answer is manual entry under the incentive's expense code.
