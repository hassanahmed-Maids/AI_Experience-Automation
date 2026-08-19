# Question 2 — is `currentPayment` partly derived from what the client PAID?

Asked 2026-08-18/19 as a follow-up in ask-the-code session 44251, because answer 1 said
`currentPayment` is computed at request time with a two-tier fallback whose FIRST tier is
"the latest actual payment row for the current month". If that is right, the audit's
expectation can be derived from the very payment it is auditing, which would clear a
short-paying contract silently. That outranks the performance question this session started
on.

---
Follow-up in this same session, and this one matters more to me than the bulk question.

You said `currentPayment` is computed with a two-tier fallback: FIRST the latest actual
payment row for the current month via `paymentRepository.findCurrentMonthPaymentsInfo(...)`
filtered to `monthly_payment`, and only if there are no payment rows does it fall back to
`CalculateDiscountsWithVatService.getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, now)`.

I am using `currentPayment.amountValue` from get-client-details as the EXPECTED monthly
amount in an audit that compares it against what the client actually paid. If tier one is
what you describe, that comparison can be circular - the expectation would be the payment.
Please settle it from the code, with class + line citations:

1. Quote `findCurrentMonthPaymentsInfo` in full (the query and its parameters). Exactly what
   window does "current month" mean - the calendar month of `now`, the contract's own
   billing month, or something else? Does it filter on payment STATUS (RECEIVED vs PDC vs
   DELETED vs BOUNCED), and on type = monthly_payment only?

2. `payments.get(0)[1]` - what is the ORDER BY, so which row wins when a month has several
   monthly payment rows (a split payment, or a payment plus a refund)? Is it the latest by
   date, the highest id, or unordered?

3. So, concretely: if a contract's CPT monthly amount is 4,715 and the client paid only
   2,100 this month as a single monthly_payment row, does `currentPayment.amountValue`
   return 4,715 or 2,100? If it returns 2,100, say so plainly - I need to know, because my
   audit would then compare 2,100 against 2,100 and clear a contract that is 2,615 short.

4. `getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, LocalDate)` takes a DATE. Is that the
   correct way to obtain the AGREED monthly amount for an arbitrary PAST month - say
   2026-07-01 - independent of any payment rows? What keys does the returned map carry, and
   is the "amount" VAT-inclusive and discount-adjusted? Does it handle a contract whose rate
   changed mid-window (does it pick the CPT/term in force at that date)?

5. Is that time-parameterised computation exposed over HTTP anywhere for a single contract -
   "what was owed on contract X in July" - or is `/contract/getContractDetailsCM3720` (which
   always uses `new LocalDate()`) the only exposure? If there is no endpoint, name the
   service method and say whether a thin controller over it would be a Java change.

6. Same question for the bulk path you found: the `'monthlyPayment'` alias in
   `ContractRepository` lines 3849 / 3940 was described as "last confirmed monthly DD amount,
   else CPT AMOUNT - DISCOUNT". Is that also payment-derived first? I need a source of the
   AGREED amount that is never contaminated by what was actually collected.

Ground every claim in code. If a behaviour depends on a module you cannot see, say which.
