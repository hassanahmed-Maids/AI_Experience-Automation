# Feedback Questioning Loop — Question Banks

The loop exists because P&C reports fail on definitions, not on SQL. Work these banks until
answers stop generating new questions. Ask in small batches (3–5 at a time), get answers,
then re-ask the exit gate.

## How to run it

1. Pick the questions from the banks below that this report actually needs. Do not read the
   whole bank at the user.
2. Ask them in batches with your own recommended answer attached, so the user can confirm
   rather than compose. Example: *"For a contract cancelled mid-month I'd pro-rate by
   calendar days — confirm, or do you use 30-day months?"*
3. Get explicit approval per point. Record each answer in the spec as it is settled.
4. **Exit gate:** ask whether the new answers or newly discovered tables raise further
   questions. If yes, run another pass and say which pass you are on. If no, declare the
   loop closed and move to the UI.

Two passes is normal. One pass usually means the data discovery hasn't been absorbed.

## Bank 1 — Scope and population

- Which legal entity / entities, and does the report cross them?
- Which branches, and does an inactive branch still appear historically?
- What date range on first build, and rolling window thereafter?
- Which date drives period assignment: transaction date, posting date, approval date, or
  value date? These differ and change every number.
- Are test, demo, fake, or internal-staff records present in the source, and how are they
  identified so they can be excluded?
- Cancelled, refunded, reversed, and voided records — in or out? Shown as negatives or
  netted?
- Soft-deleted rows: does the source keep them, and must the audit see them?

## Bank 2 — Money mechanics

- Reporting currency, and which FX rate and as-of date for conversions?
- Gross or net of VAT? Is VAT recoverable in this context?
- Amounts inclusive or exclusive of fees, penalties, discounts?
- Where a discount or waiver exists, does the audit compare against list price or the
  approved discounted price?
- Rounding: at row level or on totals? To how many decimals?
- Partial payments and instalments: does one row become many, or does the report show a
  balance?
- Accruals vs cash: is the report auditing what was earned or what moved?

## Bank 3 — The control itself

- What is the *authorised* value being compared against, and where does the authority
  come from — a contract, a price list, an approval record, a policy document?
- Who is allowed to approve an exception, and does the report need to show that approval?
- What tolerance is acceptable before something is a finding? Absolute amount, percentage,
  or both?
- Should a repeat offender surface differently from a one-off?
- Is a missing record itself a finding? (A charge that should exist and does not is
  invisible to a report built only on rows that exist — this needs an expected-population
  source.)
- What is the tie-out identity that proves the report is complete?

## Bank 4 — Grain and duplication

- One row per what, exactly?
- Can the same entity legitimately appear twice in a period? (Second contract, re-hire,
  replacement maid, re-issued invoice.)
- If deduplicating, which row wins — earliest, latest, highest amount, approved one?
- Does an aggregate change its ranking after deduplication? Check before reporting a "top
  cause" or "biggest variance".

## Bank 5 — Edge cases to actively probe

Raise these unprompted; users rarely volunteer them.

- Mid-period start and mid-period end (pro-ration basis: calendar days, 30-day month,
  working days?).
- Replacement / swap where one obligation transfers to another entity.
- Retroactive corrections posted after a closed period — restate history or show in the
  current period?
- Backdated records created after the fact.
- Multi-currency contracts, or a currency changing mid-contract.
- Zero-amount and negative-amount records.
- Records with a null on a field the metric divides by.
- Entities that exist in one source and not the other (the join misses them — these must
  become exception rows, not silently dropped rows).
- Timezone: are timestamps UTC or Gulf time, and does that move a transaction across a
  month boundary?

## Bank 6 — Output and workflow

- Does an auditor need to mark a row as reviewed / cleared, or is this read-only? (A
  write-back requirement changes the spec substantially — flag it early.)
- Does the report need a comparison to prior period, or absolute values only?
- Row-level CSV export needed? Almost always yes for P&C.
- Who else sees this, and does that change what may be displayed?
- Any figure that must match an existing dashboard exactly — and if so, must that
  dashboard's approved definition be reused verbatim?

## Anti-patterns

- Accepting "all of them" as a scope answer. Push for the exclusion list.
- Accepting a metric name without a formula.
- Accepting one example. One example cannot reveal a grain problem.
- Designing around a feasibility worry. Snowflake can do fuzzy matching, AI-generated
  fields, and cross-database joins — state the requirement.
- Letting a discovered column name change the business definition. The business definition
  is the requirement; the column is an implementation detail. If they conflict, surface the
  conflict rather than quietly adopting the column's semantics.
