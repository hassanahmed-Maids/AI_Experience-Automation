I now have all the source-level facts. Let me compile the answer.

## Abu Dhabi Maid Incentive — Code Review

**Important correction up front:** the query cites the amount calculation as `abuDhabiIncentiveOffered * (eligibleDays / totalDaysInMonth)` at L298-299 with an *integral* division. The actual source does **not** match that. The real code casts to `double` and rounds. So the "integral division produces 0" hypothesis is **denied by the source**. Details below.

---

### 1. Exact amount calculation and declared types

The calculation:

```296:300:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/service/MaidIncentiveService.java
            } else {
                calculatedAmount = Math.round(
                        offered * ((double) eligibleDays / totalDaysInMonth) * 100.0) / 100.0;
            }
```

Declared types:
- `abuDhabiIncentiveOffered` — `Integer` (entity field `HousemaidExtraFields.java:46`, getter returns `Integer` at L169-171). It is unboxed into a local `int offered` at `MaidIncentiveService.java:271`.
- `eligibleDays` — `int` (`MaidIncentiveService.java:283`; the helpers `calculateRelocationDays`/`calculateAdCancelledDays` return `int`).
- `totalDaysInMonth` — `int` (field at `MaidIncentiveService.java:73`).
- Expression result / `calculatedAmount` — `Double` (declared at `MaidIncentiveService.java:276`).

**Is the division integral? — DENIED.** The expression is `(double) eligibleDays / totalDaysInMonth`. The explicit `(double)` cast on `eligibleDays` promotes the division to floating point, so `10 / 31` evaluates to `0.322…`, not `0`. This is the equivalent of the experiment job's cast, just placed on the numerator instead of the denominator.

Compare with the experiment job, which casts the denominator:

```336:339:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/scheduledjob/MaidIncentiveExperimentJob.java
        int daysBetween = DateUtil.daysBetweenDates(startDate, endDate) + 1;
        int totalMonthDaysTillNow = DateUtil.daysBetweenDates(firstDayOfMonth, currentDate) + 1;
        return (daysBetween / (double) totalMonthDaysTillNow) * noteAmount;
```

Both are mathematically equivalent proration; the Abu Dhabi path **does** have an equivalent cast. So integral truncation is not the source of the zeros.

Note: for `PIT_STOP` (the default configured type — see item 7) there is no proration at all — the full offered amount is used: `calculatedAmount = (double) offered;` (`MaidIncentiveService.java:278`). Proration only runs for `RELOCATION` and `AD_CANCELLED`.

---

### 2. How `eligibleDays` is derived; can it be 0?

`eligibleDays` is only computed for the non-`PIT_STOP` branch (`MaidIncentiveService.java:283-293`), via one of two helpers:

- **`calculateAdCancelledDays`** (`MaidIncentiveService.java:512-536`): sums, over each Abu-Dhabi contract range in the month, `daysBetweenDates(clampedStart, clampedEnd) + 1`. Returns `0` if `adRanges` is empty.
- **`calculateRelocationDays`** (`MaidIncentiveService.java:539-606`): counts overlap between RELOCATION periods and AD ranges, capped at `totalDaysInMonth`. Returns `0` if `adRanges` is empty or on exception.

Both rest on `getAbuDhabiContractRanges` (`MaidIncentiveService.java:390-452`), which reads these date fields:
- **Tag date** of the active contract via `findTagDateForActiveContract` → `Contract.lastModificationDate` on the housemaid-change revision (L400, L455-464).
- **Un-tag date** via `calculateUnTagDate` → next housemaid-change revision's `lastModificationDate`, else `Contract.dateOfTermination` if cancelled (L468-483).
- **`firstDayOfMonth` / `endDayOfMonth` / `currentDate`** — the month clamp bounds (`initialize`, L166-170).
- For RELOCATION, also the `HousemaidExtraFields.abuDhabiIncentiveType` revision history (`lastModificationDate`, L548-552).

There is **no read of a "relocation date" or contract-start field**, and **no read of `lastAbuDhabiIncentiveProcessedDate`** in the day calculation — that field is used only by the eligibility query and the write-back.

**Part-way enrolment:** yes, a maid tagged mid-month is counted only from her tag date forward. `addClamped` (L487-491) and `countOverlappingDays` (L494-509) clamp every period to `[firstDayOfMonth, endDayOfMonth]`, and ranges start at the tag date. So her `eligibleDays` is less than `totalDaysInMonth`, producing a fractional multiplier < 1.

**Can `eligibleDays` be 0?** Yes — whenever `adRanges` is empty (no Abu-Dhabi-tagged contract history that overlaps the month), or, for RELOCATION, when no relocation period overlaps an AD range, or on any caught exception in either helper (they log a warning and `return 0`). This is the realistic trigger for a zero amount, not integer division.

---

### 3. Is a zero amount guarded?

**Yes — the job explicitly skips creating the expense request when the amount is ≤ 0.** Two guards:

```294:308:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/service/MaidIncentiveService.java
            result.put("eligibleDays", eligibleDays);
            if (eligibleDays <= 0) {
                calculatedAmount = 0d;
            } else {
                calculatedAmount = Math.round(
                        offered * ((double) eligibleDays / totalDaysInMonth) * 100.0) / 100.0;
            }
        }
        result.put("calculatedAmount", calculatedAmount);

        // ===== Create the expense request =====
        if (calculatedAmount == null || calculatedAmount <= 0) {
            result.put("skipped", true);
            result.put("message", "Calculated amount is zero — no request created");
            return result;
        }
```

When the amount is 0, the method returns early with `skipped=true` and message *"Calculated amount is zero — no request created"* — it does **not** call `createMaidIncentiveExpenseRequest`, so **no zero-amount `ExpenseRequestTodo` is posted by this job.**

This matters for your observation: **the 18 zero-amount notes cannot have been created by the Abu Dhabi job's `createMaidIncentiveExpenseRequest` path**, because that path is unreachable when the amount is 0. Any zero-amount `ExpenseRequestTodo`/note you see with these characteristics must originate elsewhere (a different creator, manual entry, or a different job). *Unverified:* which producer actually created the 18 notes is runtime/DB data, not determinable from this source.

---

### 4. Does the run consume eligibility when it pays nothing?

**No.** `lastAbuDhabiIncentiveProcessedDate` is written only inside the `created` branch, after a successful expense request:

```319:325:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/service/MaidIncentiveService.java
        result.put("expenseRequestCreated", created);
        if (created) {
            updateProcessedDate(extraFields);
            result.put("message", "Expense request created");
        } else {
            result.put("message", "Failed to create expense request");
        }
```

`updateProcessedDate` sets the date and saves (`MaidIncentiveService.java:608-617`). Because a zero amount returns early at L305 (item 3) — before this block — **the marker is not written when nothing is paid.**

Consequence for the eligibility query: the filter is `lastAbuDhabiIncentiveProcessedDate IS NULL OR < firstDayOfMonth` (`HousemaidExtraFieldsRepository.java:61-62`). A maid who computed 0 keeps her marker `NULL` (or last month's date), so **she is re-selected next month**. She is *not* permanently skipped by this job. If the underlying data (AD contract ranges) later makes `eligibleDays > 0`, she will self-correct.

**Caveat:** this holds *only if* the zero notes came from this Abu Dhabi job. As noted in item 3, this job's guard makes that impossible. If the 18 came from another producer that *does* write its own marker, that behavior is out of this file's scope — *unverified*.

---

### 5. Rounding/truncation elsewhere in the path

No further truncation to integer anywhere:

- **In `MaidIncentiveService`**: the amount is rounded to 2 decimals with `Math.round(x * 100.0) / 100.0` at the calculation (L298-299) and again in `createMaidIncentiveExpenseRequest` when building the payload: `payload.put("amount", Math.round(amount * 100.0) / 100.0);` (`MaidIncentiveService.java:356`). This is 2-decimal rounding, not integer truncation — it cannot turn a positive proration into 0 unless the value was already < 0.005.
- **Accounting `ExpenseRequestTodo`**: `amount` is a `Double` (`ExpenseRequestTodo.java:90`, setter L780-781). The creator endpoint deserializes the payload straight into the entity and calls `createExpenseRequestTodo` (`ExpenseRequestTodoController.java:156-186`). `setAmountsTrigger()` (`ExpenseRequestTodo.java:1548-1560`) only copies `amount` into `amountInLocalCurrency`/`amountToPay` — **no rounding or cast**.
- **Payroll `ManagerNoteService.processExpenseRequestTodo`**: **this method/class does not exist** in either repository in scope. There is no such payroll rounding step in the code available here.

So a "correct computation truncated later" is not supported by the source — there is no integer cast downstream.

---

### 6. When did this job first run?

The job is **registered in source** but **not scheduled in source**:

```498:501:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/module/SetupCustomJobDefinitions.java
                new JobDefinition("Abu Dhabi Maid Incentive Expense Job",
                        "abu_dhabi_maid_incentive_expense_job",
                        AbuDhabiMaidIncentiveExpenseJob.class,
                        null),
```

The 4th `JobDefinition` argument (the trigger/cron) is `null` — as it is for essentially every job in this file. `AbuDhabiMaidIncentiveExpenseJob` itself has no `@Scheduled`/cron annotation; it just implements `MagnamediaJob.run` and delegates to the service. **The actual schedule/cron and the first-run date live in the DB `JobInstance` configuration — that is runtime/DB config, not source, and is therefore unverified.** The code cannot tell you when it first ran or that it ran on 2026-08-31.

(`JobDefinition` itself is defined in `magnamedia-core`, which is outside the workspace boundary, so its constructor semantics cannot be inspected here — but the consistent `null` 4th arg confirms no source-defined trigger.)

---

### 7. Expense code source in each path

Both jobs read the expense code from a JSON config parameter's `expenseCode` key, but from **different parameters**:

- **Abu Dhabi path** — reads `ABU_DHABI_MAID_INCENTIVE_CONFIGS_PARAM`, key `expenseCode`:
  ```202:202:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/service/MaidIncentiveService.java
          expenseCode = config.get("expenseCode") != null ? config.get("expenseCode").toString() : null;
  ```
- **Experiment path** — reads `MAID_INCENTIVE_CONFIGS_PARAM`, key `expenseCode` (`MaidIncentiveExperimentJob.java:80-82`).

The **default seeded values** in source set both to the same code `AAI - 01`:
- `ABU_DHABI_MAID_INCENTIVE_CONFIGS_PARAM` default: `{"expenseCode":"AAI - 01",...}` (`SetupCustomParameters.java:1926-1931`).
- `MAID_INCENTIVE_CONFIGS_PARAM` default: `{...,"expenseCode":"AAI - 01",...}` (`SetupCustomParameters.java:1468-1473`).

So per the source defaults, both resolve to `AAI - 01`. **However, the live parameter values are DB config and can be edited independently — the actual production codes are unverified.**

---

### Bottom line

The most likely source-level explanation the code supports is **item 2/4**: for `RELOCATION`/`AD_CANCELLED` maids whose AD contract history yields no in-month ranges (or an exception), `eligibleDays` is 0, so the amount is 0. But item 3 shows this job **refuses to post a 0-amount request** and item 4 shows it **does not consume eligibility** in that case — so those maids are simply re-tried next month and are not the source of persistent zero-amount notes. The integer-division theory in the prompt (item 1) is **contradicted by the `(double)` cast** in the actual code. That strongly implies the 18 zero-amount notes on 2026-08-31 were produced by a **different code path or process**, not by `AbuDhabiMaidIncentiveExpenseJob` as written here — but pinning that down requires the DB records, which are unverified from source.
