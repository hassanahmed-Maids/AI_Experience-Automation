I have everything needed. Let me compile the answer.

## Payroll Manager Notes — "Bonus" (`bonus`): Referral & Signing Bonus

### 1. Picklist `HousemaidPurposesForBonusAdditionalDescription` — enumeration

The picklist items are **runtime database records**, not seeded in code, so the complete row-by-row list (all codes + names) is not enumerable from the source — it lives in the picklist tables. The codes **referenced by name in code** across all modules are:

- `referral_bonus` — "Referral Bonus" (used for both Maid A referral and Maid B signing bonus notes)
- `resignation_retraction` — resignation‑retraction bonus (staff retention)

Only these two codes from this list appear anywhere in the codebase. All other items (and their exact display names) exist only in the picklist DB and are loaded dynamically by the front ends (`payroll-angular`, `acc-angular` via `getPicklist({code:'HousemaidPurposesForBonusAdditionalDescription'})`). **I can confirm the two codes the code depends on, but I can't produce the full code+name inventory from source alone — that requires the picklist table.**

Note: `signing_bonus` also exists but belongs to a **different** picklist, `MaidNoteType` (used by the recruitment applicant "signing bonus" action log), not to `HousemaidPurposesForBonusAdditionalDescription`.

### 2. What creates referral vs signing bonus notes

Every path sets the same `AdditionReasons` = `bonus` and purpose `HousemaidPurposesForBonusAdditionalDescription` = `referral_bonus`. They are distinguished only by which maid the note is attached to and the free‑text reason.

**Referral bonus (Maid A)** — three creators:
- **Scheduled job path (primary):** `ReferralBonusesManagerJob` (`referral_bonuses_manager_job`) → `processReferralBonuses()` → `addReferralBonus()` → `HousemaidReferralService.createPayrollManagerNoteDeduction(...)`. Reason text: `"<B> was referred by <A>"`. Sets `referredMaidId`.
- **Recruitment path:** `MaidsAtCandidateWAService.createPayrollManagerNoteDeduction()` (via `processMaidWithCompany`). Reason: `"Bonus after referring <name> who joined the company"`.
- **Final settlement:** `PayrollHousemaidFinalSettlementController` references the same `referral_bonus` purpose.

**Signing bonus (Maid B / referred maid):** created by the **same** `ReferralBonusesManagerJob → addReferralBonus()`, which calls `createPayrollManagerNoteDeduction()` a second time against the **referred** maid with reason `"Signing bonus for being referred by <A>"` and `referredMaidId = null`. So on the picklist, referral and signing bonus share `referral_bonus`; separation is purely by target maid + reason text (this is the `PURPOSE_ID` grouping the front end keys on).

**Indirect expense‑code path (the one string‑search misses):** other modules post an **expense request** to accounting; on confirmation, `ManagerNoteService.processExpenseRequestTodo()` builds the `PayrollManagerNote` and copies `Expense.getSalaryAdditionType()` into `additionReason` and copies `purposeAdditionalDescription` into `purpose`. Concretely, `DelighterService.addExpenseRequestForHousemaid()` posts to `/accounting/expenseRequestTodo/create` with `purposeAdditionalDescription = resignation_retraction`, and accounting's `ExpenseRequestTodoService.validateMaidPaymentPurposeAdditionalDescription()` enforces that the `EXPENSE_BONUS_CODE` expense requires a purpose from `HousemaidPurposesForBonusAdditionalDescription`. This is how a bonus note appears in payroll with no "bonus" string ever written in the payroll module.

### 3. Where the amounts (1000 / 500 / 1200 / 1500 / 2000 / 250) come from

Amounts are **not** hardcoded per note — they come from the rule engine `ReferralBonusRuleService.getReferralBonusAmounts()`, which queries `ReferralBonusRule` rows by (MaidA type, MaidB type, MaidA nationality, MaidB nationality) ordered by `priority`, returning `[maidAValue, maidBValue]`.

The **default seeded rules** (`initializeDefaultRules`, Filipina‑based) produce:
- **1000 / 0** — CC→CC and MV→CC, both Filipina (priorities 1–2)
- **500 / 500** — MV→MV Filipina→ANY, MV→MV ANY→ANY, CC→MV ANY→ANY (priorities 3, 6, 7)
- **0 / 0** — all other CC/MV combinations (priorities 4, 5, 8, 9)

Plus `addTARules()` adds:
- **1200 / 0** — CC→TA and MV→TA (ANY→ANY)

So **1000, 500, 1200** are the seeded defaults; **1500 / 2000 / 250** are **not** in the seeded rules or any code constant — they come from additional `ReferralBonusRule` rows created at runtime via the rule CRUD (`createRule`/`updateRule`). The recruitment/legacy path instead uses nationality tags: `YayaAppService.getReferralBonus()` reads the nationality's `referral_bonus` tag value, falling back to the `referral_default_bonus` parameter. So amounts are parameter/rule‑driven, not literals in the note‑creation code.

### 4. Is the "30 days with client" enforced? Is the note date postponed?

**Enforced — yes**, in `ReferralBonusesManagerJob.isEligibleForBonus()`:
- CC referred maid: eligible only if `referral.getDaysWithClient() > 30`
- MV referred maid: eligible only if visa medical status = `"Passed"`

`getDaysWithClient()` (on `HousemaidReferral`) computes cumulative days in `WITH_CLIENT` status from the housemaid's revision history. A parallel implementation exists in recruitment: `MaidsAtCandidateWAService.calculatePassedDaysWithClient(maid, 30)` returning `passedTheRequiredDaysWithClient = sum > 30`.

**Automatic date postponement — no such mechanism exists in code.** There is no field or logic that moves a note's `noteDate` forward when 30 days aren't met. When ineligible, the job simply **does not create the note** (and if the referring maid is in a rejected status, it sets `referral.setCancelled(true)`). The job re‑runs on schedule over `findFirstReferralForEachReferredMaid()`, and `RequestedBonus` stays `false` until eligibility passes — so the note is only ever created **once the 30 days are satisfied**, with `noteDate = new Date()` at creation time. The production observation of the "date moving forward" is an **emergent effect of this deferred‑creation loop** (the note materializes later, dated on its actual creation day), not an explicit postpone/reschedule field. There is no code that edits an existing note's date instead of cancelling it.

### 5. Full set of validation/rejection conditions for a referral bonus

Applied across the referral lifecycle:

**At referral creation** (`HousemaidReferralService.addHousemaidReferral`):
1. Phone normalized to digits; must match `[\d\s+-]*` on edit.
2. Duplicate number by **same** maid → rejected ("Duplicate number by the same maid").
3. Duplicate number by **different** maid → rejected.
4. Referred number already a registered Housemaid → rejected ("Referred maid already has a housemaid profile").
5. Referred number already an applicant, and older than the `allowed_adding_referral_after_maids_at_profile_creatoin_in_hours` window → rejected.
6. On edit, if `RequestedBonus` already true → "Bonus Requested" (locked).

**At bonus processing** (`ReferralBonusesManagerJob`):
7. Referring maid (Maid A) in a rejected status → referral **cancelled**, no bonus. Rejected statuses: `EMPLOYEMENT_TERMINATED`, `WAITING_TO_FILE_ABSCONDING`, `VISA_UNSUCCESSFUL`, `REJECTED`, `UNREACHABLE`, `UNREACHABLE_AFTER_EXIT`, `PASSED_EXIT`.
8. Duplicate referred‑maid detection (same maid referred by 2+ maids) → duplicate email raised, bonus **not** processed (technical‑error email to Referrals recipients).
9. Eligibility gate: CC needs `daysWithClient > 30`; MV needs medical `Passed` (else skipped, retried next run).
10. Amount gate: rule engine must return `maidABonus > 0` or `maidBBonus > 0`; if both 0, **no note created, no message sent**.
11. Per‑maid gate: Maid A note only if `maidABonus > 0`; Maid B (signing) note only if `maidBBonus > 0`. `createPayrollManagerNoteDeduction` additionally skips when `amount == 0`.

The free‑text rejection reasons observed in production ("didn't complete 30 days", "referred herself", "no proof", "old maid under CC") are **reviewer‑entered strings**, not enforced by code — the automated code only enforces items 1–11 above; everything else is manual reviewer judgment written into the note's free text.