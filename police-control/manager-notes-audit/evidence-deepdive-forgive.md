All three note types are created **inside the payroll module itself** by scheduled/payroll-generation logic — none of them actually flows through `processExpenseRequestTodo` (that path only copies whatever `salaryAdditionType` a manual expense request carries; it never hard-codes these three reasons). Here is the full trace.

## `forgive_deduction` — "Forgive Deduction" (LIVE)

- **What creates it**: `HousemaidUnpaidDayService.takeAction(...)`. This fires when an unpaid attendance day is *forgiven* (a `HousemaidUnpaidDay` gets `forgiven = true`). It is invoked by the unpaid-day forgiveness flow, not by a requester — which is why production shows **100% no requester** (`creator` is never set on the note) and the midnight cluster comes from the batch attendance/forgiveness jobs.
- **Triggering condition**: A note is created **only if the payroll for that unpaid day's month is already closed** — i.e. the month's `HousemaidPayrollLog` exists and is either `transferred` or in status `FINAL`. If the month is still open, the forgiveness just re-groups the attendance day (no note). So notes are the "we already paid you short, here's the catch-up" case.
- **Exact formula** (rounded to whole AED, `Math.round(amount)`):
  - It picks a per-day salary rate and divides by the number of days in the payroll month: `amount = dailyRate / daysInMonth`.
  - **Full-day forgiveness** (`forgivenessType` code contains `"full"`) uses the *working* rate: `liveOut ? gr5Salary : gr1Salary` from the month's `HousemaidPayrollMonthlyGroup`; fallback = `HousemaidPayrollLog.basicSalary` (or the maid's `basicSalary`).
  - **Otherwise** (accommodation forgiveness) uses the *accommodation* rate: `liveOut ? gr6Salary : gr2Salary`; fallback = `accommodationSalary`.
  - `purpose` is set to "maid was with client" vs "maid was in accommodation" accordingly.
- **Capped?** No explicit cap — the amount is inherently bounded because it is a single day's prorated salary.
- One special linkage: on payslips, a `forgive_deduction` note can point back to the original deduction via `additionPayrollManagerNoteDeductionSource` (used only for display/date and cleaned up on delete in `ManagerNoteService.deletePayrollManagerNote`).

## `cover_deduction_limit` — "Cover Deduction Limit" (DEAD since 2022-11-30)

- **What created it**: `NegativeSalariesService.negativeSalariesBean(...)`, called from the **legacy** payroll generator (`HousemaidPayrollController.getTestPayrollHousemaids` / the old `generateHousemaidPayrollBean` reflection path over `salarycalculation.housemaid`). It ran only inside the payroll-jobs date window (`PARAMETER_PAYROLL_JOBS_START`/`_END`) — a scheduled monthly job — hence **100% midnight / no requester**.
- **Triggering condition**: For a maid whose `startingDate` is before the payroll month, if `totalDeduction` exceeds that maid's nationality deduction limit, the excess is "postponed" by generating both a `PayrollManagerNote` (ADDITION, reason `cover_deduction_limit`, note "Automatic Addition to Cover Deduction Limit") **and** a matching `EmployeeLoan` of type `COVER_DEDUCTION_LIMIT` for the same amount.
- **Exact formula**: `tempBalance = totalDeduction − applicableDeductionLimit`, then rounded to 2 decimals. The applicable limit is chosen by nationality/segment in priority order:
  1. African (`african_deduction_limit` tag) → `africansDeductionLimit`
  2. Maids.at with loan balance → `maidsAtDeductionLimit`
  3. Filipino → `filipinoesDeductionLimit`
  4. Ethiopian → `ethiopiansDeductionLimit`
  5. else → `deductionLimit`
  
  (all from `PayrollManagementModule` parameters). If deduction ≤ limit, nothing is created.
- **Capped?** It *is* the cap mechanism. The note amount = the portion above the limit; the loan books it as debt so it's collected later. On re-runs the job first deletes that month's existing `cover_deduction_limit`/`cover_negative_salary` notes and loans, then recomputes (idempotent).
- The `AdditionToBalanceDeductionLimitTransaction` (v2/v2New) and the V2 initializer's `getCapAddition` only **read/sum** existing `cover_deduction_limit` notes into `additionToBalanceDeductionLimit`; they never create them.

## `cover_negative_salary` — "Cover Negative Salary"

- **What creates it**: same `negativeSalariesBean(...)`, in its second branch, after regenerating the bean.
- **Triggering condition**: if the resulting `bean.getTotalBalance() < 0` (net salary would be negative).
- **Exact formula**: `amount = |bean.getTotalBalance()|`. Creates a `PayrollManagerNote` ADDITION with reason `cover_negative_salary` ("Automatic Addition to Cover Negative Salary.") plus a matching `EmployeeLoan` of type `COVER_NEGATIVE_SALARY` for the same amount.
- **Capped?** No cap — it zeroes out whatever the negative balance is. Same legacy scheduled path, so it shares the midnight/no-requester signature and died at the same cutover.

## Why `cover_deduction_limit` stopped in Nov 2022 — it was replaced

It stopped because the payroll engine was migrated off the legacy generator to **V2** (`HousemaidPayrollPaymentServiceV2` + `HousemaidPayrollInitializer` + the `version2New` / `version2NewSecondPhase` transaction chain). **V2 never calls `negativeSalariesBean`**, so the note+loan "cover" pattern is no longer produced. The `2022-11-30` last-note date is that cutover.

**Current deduction-limit mechanism (V2):** `Z_DeductionCapTransaction` (phase-two salary transaction), backed by `PayrollGenerationHelperService.getDefaultCap(...)`:

1. Nationality cap resolved by `getDefaultCap` (now includes **Sri Lankan** in addition to African/Filipino/Ethiopian/default).
2. **Rule #1** — this month's deduction is capped at `min(outstanding loan balance, nationality cap)`.
3. **Rule #2 (WPS floor)** — net salary after deduction must stay ≥ the *Minimum WPS Requirement* = `0.85 × (MOHRE salary + holiday)`, prorated by working days. If total salary is already below that floor, `cap = 0`; otherwise the cap is trimmed to `totalSalary − minimumWpsRequirement`.
4. The capped amount is taken as a **`Repayment`** ("Net Salary Calculation", type `CASH_ADVANCED`) against the loan, rather than as an addition note + loan.
5. The deferred remainder is now carried as **`UnpaidDeduction` / `UnpaidDeductionRepayment`** records (see the `UnpaidDeductionTransaction`, `UnpaidDeductionRepaymentTransaction`, `RemainingUnpaidDeductionTransaction`, and the initializer's unpaid-deduction sums), and month-end balances are snapshotted in `HousemaidBalancesHistory`.

So the old "create a cover_deduction_limit addition + loan" model was replaced by a "cap the repayment against the loan, enforce an 0.85×MOHRE WPS floor, and defer the rest as unpaid deductions" model — which is why both `cover_deduction_limit` and (in practice) the auto `cover_negative_salary` notes went dead at the V2 switchover.