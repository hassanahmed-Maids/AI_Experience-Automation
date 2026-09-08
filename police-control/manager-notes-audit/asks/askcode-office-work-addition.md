# Ask-the-code · How is `Office Work Addition` earned and computed?

**Modules:** `erp/magnamedia-payroll-management,erp/magnamedia-housemaid-management`
**Asked:** 2026-09-08 · **Session:** _(filled in on run)_
**Drives:** the last untested payment type above AED 10,000 — 96 notes, AED 29,684 / 12 months

## Why we are asking

Every payment type that produced a finding today did so because the code supplied a testable rule
first — airfare's 5-month duplicate guard, MV prorated's terminated-maid exclusion, forgive
deduction's one-note-one-day quantum. Office Work Addition has none in the repo. All that is known is
one line from conversation 46017: created by `PayrollGroupService` around L704-714, `Math.round(amount)`
seeded from 0, and it can be 0 when no days were worked. Without the rule, any test would be fishing.

## The question (verbatim, as submitted)

> `PayrollGroupService` creates a `PayrollManagerNote` with the addition reason that surfaces as
> "Office Work Addition" (around PayrollGroupService.java:704-714, amount built up from 0 and
> `Math.round`ed). In production it is 96 notes and AED 29,684 over twelve months, going mostly to
> `Normal` maids with some MAID_VISA and FREEDOM_OPERATOR, at amounts clustering around 100-210 with
> occasional outliers near 1,161. Please answer from the code, marking anything that is DB
> configuration or runtime data as unverified rather than inferring it:
>
> 1. **What event or state causes this note to exist?** Show the method and the branch. Is it driven
>    by a housemaid being assigned to office work (there is an `assignedOfficeWorkReason` field on the
>    housemaid), by attendance/day-grouping, or by something else? What makes a maid eligible at all?
> 2. **The exact amount formula, with the fields it reads.** Is it days-worked x a daily rate, and if
>    so which rate — basic, accommodation, a payroll group (gr1/gr2/gr5/gr6), or a parameter? Is
>    there a per-note or per-month cap? What makes it come out as 0?
> 3. **What is the natural quantum?** Is one note one day, one month, or one assignment period? We
>    have learned that a count-based test survives a bad salary model where an amount-based one does
>    not, so knowing whether a note represents a day or a period decides how this type is audited.
> 4. **Can a maid receive more than one in the same payroll month, and is that intended?**
> 5. **Is there a guard against paying a maid who is not assigned to office work**, or who is
>    terminated? If so, is it evaluated when the note is written or earlier (we found that
>    anti-attrition checks eligibility at selection and pays two async hops later)?
> 6. **Which fields would let an auditor verify a given note from the warehouse** — the assignment
>    record, the day count, the rate — and where do they live?
>
> Give file paths and line numbers.
