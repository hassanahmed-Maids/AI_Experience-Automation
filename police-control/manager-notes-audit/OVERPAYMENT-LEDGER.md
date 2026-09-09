# The overpayment ledger

**What the audit exists to find: money that left without justification.**
Underpayment findings are byproducts and live in remediation lists, not here.

**Confirmed 2026-09-09 — ~AED 106,100, after BN3 retracted the largest row in the table.**
Against AED 7,197,642 examined.

✅ **De-duplicated.** O12 resolved every bonus note to one verdict: the two bonus findings overlap by
**3 notes across 2 maids**, so about AED 1,400 of the total is double-counted. Recorded, not chased.
Three times this session a headline would have been overstated by summing overlapping tests — O6/O7
by 58%, O8/O10, and this one — so **no figure here is a sum of tests; each is a distinct note set.**

🔴 **Two categories, and they must not be added together.** *Money lost* is money that should not
have left. *Control violated* is a rule broken where the money may still have been owed — a real
finding, but not a recovery. Reporting them as one number overstates the loss.

| Finding | AED | Archetype | Basis |
|---|---:|---|---|
| ⚪ **RETRACTED to candidate — "bonus at referral rates, no referral, over a year in"** | *was 143,965* | — | BN3 classified the population from the narrative the code actually writes, and it does not hold together. The claim rested on *median 765 days into service* and *avg 878*. The unclassified-no-referral group is **148 notes, AED 100,310, avg 678, median 290 days** — under a year, and priced between the signing rate (500) and the referral rate (866). It is not one population and it is not characterised as the row said. Replaced by the two rows below |
| Airfare duplicates via the unguarded manual route | **49,500** | paid twice | 29 notes inside the 5-month guard, on a path that never calls it |
| 🔴 **Bonus over the referral entitlement** | **10,500** | not deserved | 15 maids paid AED 20,000 against 9,500 entitled — **validated by 466 maids matching to the penny** |
| Anti-attrition paid before any enrolment existed | **9,019** | not deserved | 42 notes, measured on `CREATION_DATE` |
| Selection-lag payments to already-ineligible maids | 3,050 | off-rule | 11 notes; corroborates the code's select-once flaw |
| Airfare — the automatic guard itself failed | 3,000 | paid twice | 7 notes, automatic → automatic |
| Anti-attrition to MV maids against a CC-only rule | **5,726** | off-rule | **21 notes — revised up 131% (S5).** The original 11 notes / AED 2,476 resolved contract type from `HOUSEMAIDS_INFO_REVISION`, an Envers audit table. `HOUSEMAID_TYPE_LOGS` is the purpose-built timeline with closed intervals, and it finds nearly twice as many |
| Note exceeds its approved expense request | 1,304 | off-rule | 4 notes of 11,819 linked |
| Anti-attrition same-day excess over entitlement | 838 | paid twice | 17 groups |
| Forgive Deduction: 15–21 days forgiven in a single month | **2,492** | off-rule | 3 maid-months, 55 notes. One note is one day, so 21 notes means two thirds of a month was unpaid then written back. **Both hard ceilings held** — no maid-month exceeded the days in the month or a month's salary |
| Raffle prizes to maids terminated before the draw | **3,000** | not deserved | 15 wins, 13 maids, **median 558 days** after they left |
| Prorated salary paid to maids outside the eligibility window | **2,976** | not deserved | 25 notes — 18 whose salary start predates the note by a median 650 days, 7 whose salary start is *after* it. **Resolved as-of the note date** (PS1c), down from 78 on a current-state read |
| Airfare paid above its nationality tier | **500** | off-rule | 1 Kenyan note at 2,000 against a 1,500 tier — **the only one in 1,518** |
| 🔴 **Anti-attrition paid to a maid in a NO-SHOW or terminated state** | **13,257** | not deserved | **110 notes (S4).** 68 `NO_SHOW_WENT_OUT_DID_NOT_RETURN` (8,147) · 21 `NO_SHOW_LEFT_CLIENT_HOME` (3,672) · 13 `NO_SHOW_FOR_TERMINATION` (748) · 6 `NO_SHOW` (419) · 2 `EMPLOYEMENT_TERMINATED` (271). The code filters `status not in rejectedStatuses` **at selection**, then pays two hops later — the same select-once flaw behind the AED 3,050 selection-lag finding, measured properly for the first time. A retention incentive to a maid who has absconded |
| 🔴 **Accommodation Relocation paid to a live-in maid** | **3,900** | not deserved | **5 notes — revised down from 6 / AED 4,700 (S5).** `HOUSEMAID_TYPE_LOGS` carries `CC Live In` / `CC Live Out` / `MV` directly, so the rule is testable in one column instead of two. The `LIVE_OUT`-flag version was close but not exact |
| Live-out transport allowance paid to a live-in maid | 392 | not deserved | 3 notes. The other **317 of 320 clear** — AED 71,457 — and 36 of them resolve to a different flag than today, so the clear is earned rather than an artifact |

### Control violated — a rule broken, the money may still be owed

| | AED | Basis |
|---|---:|---|
| Bonus paid before the bonus was requested | 9,500 | 12 notes, de-duplicated from O6's 20 |
| 🔴 **A deprecated, config-disabled bonus path is still paying** | 7,126 | **10 notes of retracting-resignation bonus in 12 months.** Ask 46023: the enum is `@Deprecated`, `RetractingResignationJob` filters `retractMethod = RAISE` only, the UI option is commented out, and config head `RRB-01` is **Disabled** — yet `DelighterToDoController.retractResignation` still has a live `case ONE_TIME_BONUS`. Four independent shut-offs and the money still moves. Control, not loss — the payments may be owed |

### Control violated — the invoice gate is routed around

**Exactly three expense heads set `REQUIRE_INVOICE = TRUE`:** `FT 26` Medical assistance for
housemaids, `FT 229` Taxi rides – maids, `FT 281` Taxi rides for applicants. **All three carry zero
of the 944 tail-five notes.** Every dirham of the AED 219,143 flows through a head whose twin
requires no invoice — Medical through `PT 100` (PCR Test & medical assistance **Loan**), taxi through
`LOTA` and `TR 200`. The finding is not that invoices are missing. It is that the heads demanding one
are unused while their no-invoice twins carry 100% of the money. No recovery attaches to this; it is
a control that exists on paper and is not on the path the money takes.

## ⚪ Airfare to MV maids — AED 137,500 candidate, resolved to AED 4,500. A 97% collapse.

S5's point read found 76 notes / AED 137,500 typed MV at the note date. **AF2 settles it at three
notes.**

| Verdict (24-month entitlement window) | Notes | AED |
|---|---:|---:|
| GREEN — CC throughout | 1,102 | 1,975,500 |
| AMBER — CC *and* MV both appear | 197 | 355,000 |
| 🔴 **RED — MV for the whole window** | **3** | **4,500** |

The candidate was **97% confound.** Airfare notes are dated `payrollDueDate`, so a maid who was CC at
renewal and MV by the payroll cycle reads as MV. The self-diagnostic caught it before publication —
only 1 of the 76 resolved to a *past* interval, which is the signature of a point read pretending to
be an as-of one. **Had AED 137,500 gone into the confirmed table it would have been the largest error
of the audit.**

🔴 **The AMBER 197 notes / AED 355,000 are permanently unresolvable from the warehouse.** AF1 shows
`HOUSEMAID_MANAGER_NOTES` carries **exactly one timestamp — `NOTE_DATE`** — and no
`ScheduledAnnualVacation` table exists in Snowflake at all. So there is no way to date the entitlement,
only the payment. Separating those 197 needs an ingestion, not a query.

## 🔴 A coverage hole nothing in the audit was looking for: future-dated notes are invisible

AF3, measured for the first time:

| | Notes | AED | Range |
|---|---:|---:|---|
| past or today | 4,295 | 7,401,300 | 2020-06-30 → 2026-09-09 |
| **FUTURE-dated** | **216** | **385,000** | 2026-09-10 → **2028-06-02** |

216 airfare notes averaging **204 days ahead**, one running to June 2028. **Every test in this audit
filters `NOTE_DATE <= CURRENT_DATE()`, so all AED 385,000 of it has been excluded from everything** —
not failed, not passed, never examined. And the exclusion is generic: any future-dated note of any type
is invisible to every query written so far.

## 🟢 Two populations that look damning and are not — recorded so nobody re-finds them

- **MV Prorated Salary: AED 393,000 to maids in NO_SHOW, PENDING_FOR_TERMINATION or
  EMPLOYEMENT_TERMINATED** — 189 + 155 + 21 notes. **This is the type working correctly.** MV prorated
  salary *is* the exit settlement; being on the way out is the trigger, not a violation.
- **Accommodation Relocation: 54 of 66 notes, AED 42,900 — 83% of the type — paid while `SURPLUS`.**
  Also correct. A maid in surplus is between placements, which is *why* she is being relocated.

Both would read as findings to anyone sorting the S4 output by money. Neither is one.

## ⚠️ Two conflicts between sources, to resolve before either verdict stands

- **Office Work Addition.** S4 says only **15 of 92 notes** were `ASSIGNED_OFFICE_WORK` when paid; 62
  were `WITH_CLIENT`. But OW5b cleared **92/92** on `ASSIGNED_OFFICE_WORK_REASON_ID` read as-of from
  the revision table. Two sources, opposite answers. The status log is purpose-built and wins on
  priors — but this needs settling, not assuming.
- **Raffle Prize.** S4 finds only **2 notes / AED 400** paid in a no-show state. The ledger carries
  *"raffle prizes to maids terminated before the draw — AED 3,000, 15 wins, median 558 days."* That
  came from a different source. One of the two is wrong.

## Bonus, decomposed from the narrative (BN3) — the classification the code actually writes

Ask 46023 said the signing path stamps `noteReasone = "Singing Bonus"` and the retraction path passes
*"one-time retracting resignation bonus"*. `NOTE_REASON` is on the view, so the three kinds separate
without the missing `PURPOSE_ID`. **1,131 notes / AED 849,316, fully partitioned:**

| Kind | Referral on record | Notes | AED | Avg | Median days into service |
|---|---|---:|---:|---:|---:|
| referral | ✅ | 627 | 538,850 | 859 | 474 |
| 🟡 **referral** | ❌ | **70** | **56,000** | **800** | 418 |
| signing / joining | ❌ | 180 | 88,785 | 493 | **−4** |
| signing / joining | ✅ | 45 | 24,595 | 547 | **−8** |
| 🟡 unclassified | ❌ | 148 | 100,310 | 678 | 290 |
| unclassified | ✅ | 51 | 33,650 | 660 | 677 |
| 🔴 **retracting resignation** | ❌ | **9** | **6,626** | 736 | 729 |
| 🔴 **retracting resignation** | ✅ | **1** | **500** | 500 | 130 |

**The classification validates itself.** Referral notes price at **859/800** against the scheme's 866.
Signing notes price at **493/547** against 500, and their median tenure is **negative** — paid four to
eight days *before* the recorded start date, which is what a joining bonus should look like. That also
clears the E10 worry about `START_DATE`: on this population the anchor behaves correctly.

⚠️ `MANAGER` is **NULL on every bonus note** (`distinct_managers = 0` in all eight rows). The
producer-id idea dies here — another column present in the schema and empty in practice.

## Candidates — real populations, not yet verdicts

| Population | AED | What would settle it |
|---|---:|---|
| 🟡 **Bonus whose narrative claims a referral, with no referral on record** | **56,000** | 70 notes, avg **800** — the referral rate — and median **418 days** into service, so not a signing bonus. **A candidate, not a finding:** the referrer↔referred pairing is `COALESCE(direct, latest-by-phone, latest-by-WhatsApp)`, a heuristic, so "no referral" is a floor rather than a fact |
| 🟡 **Bonus with an unclassified narrative and no referral** | **100,310** | 148 notes, avg **678** — squarely between the signing rate (500) and the referral rate (866), median 290 days in. Genuinely ambiguous; the previous "42,900 ambiguous" row is superseded by this one |
| Bonus with a referral but no bonus request | 70,895 | Whether `IS_REQUESTED_BONUS` is reliably set |
| Forgive Deduction above one day's salary | ≤1,756 | **Recorded as inconclusive, not a finding.** The 43 notes have a median one-day figure of 18 — the signature of a partial-month payroll row understating the rate |
| Bonus where the referrer has bonuses but none on that date | 16,500 | O9 flagged it; needs the same start-date cut |
| New same-day duplicates: Bonus 10,000 · Salary Dispute 2,582 · Taxi 887 · Maids.at 30 | 13,499 | **O10** — the two-contract split test |
| ✅ **RESOLVED — the raffle entrant pool is ~1,400** | **0** | Ask-the-code **46024** settles it. `findCandidatesForRafflePageable` groups **by `h.id` — one row per distinct maid**; ~6,700 is Σ ticket points, the *weighted entries*, not the head-count. Winners are de-duplicated inside a draw (`removeIf(e -> e == winnerId)` strips all of a winner's slots), so 48 winners/month are 48 distinct maids from ~1,400. **88 repeat winners scores 1.02× uniform chance at that pool — and because odds are POINT-WEIGHTED with points accumulating over tenure, the weighted expectation is *higher* than uniform, so the observed rate sits at or below chance.** Group F is clean on repeat-rate |
| Raffle Prize — the roster test (F1) only | 180,000 | Still needs the five raffle tables (N12) to confirm each winner held a participant row. **The repeat-rate question is closed; this one is not** |
| ⚪ **RETRACTED — "advances with no loan booked"** | **0** | TF14 reported 3.4% (Medical) and 4.3% (MOHRE) loan-booking; the approved KPI says **85–100%** and **100%**. Wrong field — `EXPENSES_REQUESTS.LOAN_AMOUNT` (the expense *request*) instead of `ADDITION_LOAN_AMOUNT` (the payroll *addition*). **TF21 then closed it on the business model:** `MEDICAL_ASSISTANCE_TYPE` has two values — where medical assistance is a **Loan** it is booked as one **100% of the time** (582 items, AED 63,835); where it is **Paid by Company** it is a benefit and has no loan *by definition* (355 items, AED 70,605). So the rate was also computed across a population containing a category the numerator cannot apply to. ⚠️ TF14 carried a positive control and it **passed**, on the one head where the two fields coincide |
| MV prorated paid twice to 3 maids | 1,245 | Whether each had two pre-collected contracts terminate |

## What has been cleared, on evidence

- **AED 2.8m of expense-backed money** — 11,819 notes against their requests: AED 1,304 of disagreement (O1).
- **Cash airfare plus a company ticket** — 361 maids hold both; none within 180 days (A5).
- **Notes on cancelled/rejected expense requests** — zero, against 2,083 such requests (V9).
- 🟢 **The approval gate, across AED 2.8m — 100% compliant (TF15).** On all eleven head/type
  combinations, **zero** requests were unapproved where the head requires approval, and **zero**
  exceeded an `APPROVAL_REQUIRED_ON_LIMIT` threshold without one. **This retracts my own concern
  from an earlier round** — I had flagged "Maids.at: 217 of 273 notes with no approver, 40% of the
  type, a gate being skipped." Maids.at is `APPROVAL_REQUIRED_ON_LIMIT` with a limit of 200, and
  below it an unapproved request is *correct*. Reading a note's `APPROVED_BY` without the head's
  approval method invented an AED 20,532 finding out of a clean control.
- 🟢 **Taxi self-approval — zero breaches.** All 120 self-approved taxi notes were approved by the
  head's **designated approver**. The single identity holding 100% of them, which looked exactly
  like the anti-attrition batch job, was the person config appoints to approve that head.
- 🟢 **AED 71,457 of live-out transport (TF13)** — 317 of 320 notes went to a maid who was live-out
  that day, resolved as-of.
- 🟢 **The tail five, on the authorisation spine (TF1).** Taxi, Accommodation Relocation, Maids.at,
  Medical and MOHRE — **944 notes, AED 219,143, every single one linked to a PAID expense request.**
  Zero with no request, zero on a rejected or cancelled one, zero refunded after the note was
  written. Only one violation survives the whole tail: the 6 live-in relocations above.
- 🟢 **AED 1,585,600 of "self-approved" anti-attrition — NOT a finding, and this is the point.**
  8,095 notes where requester equals approver looks like the largest control failure in the audit.
  Concentration says otherwise: **three identities in total, one holding 94.9%.** That is a batch job
  writing itself into both fields, exactly as `REQUESTED_BY` once named a run rather than a route.
  Published on its face it would have been the session's largest retraction.
- 🟢 **AED 385,984 of Salary Dispute — on its approval trail, not on complaints.** 1,073 of 1,084
  notes carry an exact FK to an expense request and every one is PAID; O1 found AED 1,213 of
  disagreement across 3 notes. The complaint test was run and scored **1.08× chance** — no power,
  because 83.8% would hit by coincidence. **The approval gate is the entitlement evidence, and it is
  stronger than any complaint proxy.**
- 🟢 **AED 13,616 of Last Day CC Switch Adjustment — the entire type, and the cleanest in the
  audit.** 213 of 213 notes dated month-end as the rule requires, and 213 of 213 matched to a CC→MV
  switch **on the note date itself** (LD1, LD3).
- 🟢 **AED 29,684 of Office Work Addition — the entire type.** All 92 notes went to maids holding an
  office-work assignment within the two months before payment (OW5b), and no note exceeds a typical
  month's pay (OW2b).
- 🟢 **AED 32,462 of Forgive Deduction** — 672 of 1,027 notes land within one day of the salary
  that applied in their own payroll month, which is exactly what one note = one day predicts.
  Both hard ceilings hold: no maid-month has more notes than days, none exceeds a month's pay (FD1b, FD2).
- 🟢 **AED 95,550 of Prorated salary** — 593 of 619 notes land a median **three days** from the
  maid's salary start, exactly the window the rule describes (PS1c).
- 🟢 **AED 788,069 of MV Prorated Salary** — against the code's own rule that a terminated maid
  gets no note: **zero violations in 770 notes**. 763 of 766 maids were paid exactly once. This was
  the largest body of money in the audit that no test had ever touched (MV1, MV2).
- 🟢 **AED 642,580 of bonus** — 571 notes matched to a referral-bonus record, plus 296 signing
  bonuses paid a median **six days** after the maid's own start (O9, O11).
- 🟢 **AED 2.59m of ungated airfare, on the amount axis** — 1,518 notes across 15 nationalities, **one**
  above tier, AED 500. Tiers are strikingly consistent: 12 of 15 nationalities have exactly one
  distinct amount (A1).

## The recovery gap — reported upward, not discovered here

**The manager-notes question "was this advance ever taken back" resolves into an existing approved
metric, and the answer is mostly no.** From `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS`,
August 2026:

| | Loan book | Deductible in August | Deducted | **Undeducted** |
|---|---:|---:|---:|---:|
| CC | 13,997,075 | 1,786,065 | 353,972 | **1,432,093 — 80.2%** |
| MV | 8,992,006 | 2,582,608 | 123,453 | **2,459,154 — 95.2%** |

Stable across six months: CC 72–80% undeducted, MV 90–95%. **Open loan book AED 22.99m**, and of the
AED 4.37m recoverable in August, AED 3.89m was not recovered.

✅ **Definitions verified against the catalog, not assumed.** `INSIGHTS_DASHBOARD_CONTAINER` entry
`hm-payroll-deducted-vs-undeducted` states the undeducted share is measured against **Total Loans to Be
Deducted, not Total Loans** — which is the denominator used above. `hm-payroll-additions-as-loans-by-category`
confirms `ADDITION_LOAN_AMOUNT` as the sanctioned field, and `ohmm-medical-medical-loans` describes its
source in words as "broken down by **loans and paid by company**", confirming the two-mode split
independently of TF21.

⚠️ **The metric is days old.** Every housemaid-payroll entry in the catalog was created or updated on
**2026-09-08**, at version 1–3. So the recovery gap is newly instrumented: the business can see it, but
only just, and it has probably not been acted on yet. *(Also: the approved queries read
`GOLD.HOUSEMAID_MANAGEMENT.*` where this audit read `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.*`.)*

🟡 **This is not the audit's discovery.** It is a sanctioned dashboard metric the business can
already see. What the audit adds is the join: TF19 shows advances **are** booked as loans at 85–100%,
TF20 shows those loans are then **not** recovered. **The booking control works; the recovery control
does not.** Everything in the tail-five exercise is smaller than this by two orders of magnitude.

## The strategic finding

**The overpayment risk is not where the approval gate is.** O1 cleared the gated half almost
completely. **AED 4,359,589 — 60.6% — has no expense request at all**, so no approval, no amount to
check against: raffle, prorated, forgive-deduction, 95% of airfare, 71% of bonus. Every confirmed
finding above except O1's own AED 1,304 comes from that population.


---

## Bonus — closed 2026-09-08

**AED 849,316 across 1,131 notes, every one resolved to a verdict.**

| | Notes | AED | |
|---|---:|---:|---|
| Referral bonus, matched to a payment record | 569 | 494,700 | 🟢 |
| Signing bonus, median **6 days** after her own start | 298 | 148,251 | 🟢 |
| **No referral, over a year into service** | **164** | **143,965** | 🔴 |
| No referral, 6–12 months in | 72 | 42,900 | ⚠️ |
| Over the referral entitlement | 25 | 17,500 *(excess 10,500)* | 🔴 |
| No usable start date | 3 | 2,000 | BLOCKED |

**75.7% cleared on evidence.** That is what makes the 17% credible — the entitlement model was
validated by 466 maids matching to the penny and 298 signing bonuses landing a median six days after
their own start dates, before it was used to convict anything.

**The one benign reading of the 164 is a third, undocumented bonus type.** The spec knows referral and
signing (N5). If a third exists, this finding becomes a documentation gap; if it does not, AED 143,965
was paid at referral rates to maids who referred nobody.


---

## Group D — closed 2026-09-08. AED 886,905, and 99.7% of it clears.

| | AED | |
|---|---:|---|
| MV Prorated Salary — zero violations of the terminated-maid rule in 770 notes | 788,069 | 🟢 |
| Prorated salary — 593 notes a median three days from salary start | 95,550 | 🟢 |
| Prorated salary — outside the eligibility window | 2,976 | 🔴 |
| MV prorated paid twice to 3 maids | 1,245 | ⚠️ candidate |
| Prorated salary — started before the 27th | 310 | ⚠️ |

**This was the largest body of money in the audit that no test had ever touched, and it is the
cleanest type examined.** The reason is visible in the code and worth putting to whoever owns these
jobs: **`mv_prorated_salary` is the only major producer that checks its eligibility condition at the
moment it writes the note.** Anti-attrition checks at selection and pays two async hops later;
airfare's manual route skips its duplicate guard entirely; bonus has no gate at all. The one job that
validates at write time has zero violations in 770 payments.

⛔ **The amount test (PS3) was not pursued.** Group D is 99.7% cleared and the residue is AED 2,976;
the test would need the CC salary-group breakdown from ask-the-code to mean anything. **Recorded as a
decision.**


---

## The observation the whole audit converges on

**The newer the producer, the cleaner the money — and the mechanism is visible in the code.**

| Producer | Age | Result |
|---|---|---|
| Last Day CC Switch Adjustment | first notes 2026-06-30 | **213/213 correct. Zero findings** |
| MV Prorated Salary | recent | **770 notes, zero eligibility violations** |
| Office Work Addition | — | **92/92 assigned. Zero findings** |
| Anti-attrition | older | Checks eligibility at **selection**, pays two async hops later → AED 14,545 |
| Airfare, manual route | legacy expense path | **Skips its duplicate guard entirely** → AED 49,500 |
| Bonus | — | **No gate at all** → AED 143,965 |

**Every one of the newest three validates its condition at the moment it writes the note. Every finding
in this ledger comes from a producer that does not.**

That is a design recommendation the audit earned rather than asserted, and it is worth more than the
AED 232,500: **the fix is not thirteen separate patches, it is one rule — validate at write time.**
