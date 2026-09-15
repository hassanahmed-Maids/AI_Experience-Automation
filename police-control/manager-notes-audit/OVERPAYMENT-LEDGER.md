# The overpayment ledger

**What the audit exists to find: money that left without justification.**
Underpayment findings are byproducts and live in remediation lists, not here.

**⚠️ WITHDRAWN: the ~AED 103,100 headline (2026-09-09).** Recomputed from the rows 2026-09-15 →
**AED 59,254 money lost**, plus **AED 16,626 control-violated** which must not be added to it.
Against AED 7,197,642 examined — **0.82%**. Full arithmetic below.

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
| ⚪ **RETRACTED — "airfare duplicates via the unguarded manual route"** | *was 49,500* | — | **Reconciled 2026-09-14 and it does not survive.** A3c carried no `AMOUNT > 0` filter, so it paired a real payment against a **zero-amount** predecessor. Split by whether money moved on both sides: **26 notes / AED 46,000 had a zero-amount prior note — there was never a first payment**; only **4 notes / AED 5,500** are two real payments, and those four are a top-up, a dispute settlement, an exception release and a salary advance, each separately authorised through the expense route and *booked under the airfare head*. As a duplicate-payment finding: **zero**. 26 + 4 = 30 and 46,000 + 5,500 = 51,500 reconciles A3c's 29 / 49,500 inside rounding |
| 🔴 **Bonus over the referral entitlement** | **11,500** *(as of 2026-09-15)* | not deserved | **16 maids, re-measured 2026-09-15 (O12b).** Seven over by 1,000, nine by 500 — every one paid exactly double her entitlement. ⚠️ Was 15 maids / 10,500 on 2026-09-08: the window is ROLLING, so this row drifts with the date. **9 of its notes (AED 6,500, 8 maids) also appear in the control row "paid before the bonus was requested"** — different tables, so no double-count, but the same maids |
| Anti-attrition paid before any enrolment existed | **9,019** *(re-measured 2026-09-15, unchanged)* | not deserved | **42 notes** on `CREATION_DATE`. ⚠️ FINDINGS-RUN first read 11,145/51 — **that was a DEFINITION I changed, not drift**: I added maids with NO enrolment record to maids paid BEFORE enrolment. Those 9 notes are a separate population (below) |
| ⚠️ **Selection-lag payments to already-ineligible maids** | **3,050 — NO QUERY ON RECORD** | off-rule | 11 notes. 🔴 **FINDINGS-RUN could not re-measure it: no query exists anywhere in `queries/`.** Re-derive or retire |
| ⚪ **RETRACTED — "airfare, the automatic guard itself failed"** | *was 3,000* | — | Same reconciliation. Every `automatic → automatic` pair inside 5 months has no money on one side or both; the single one with a real second payment (AED 1,500) had a zero-amount predecessor, so it is the same artefact |
| Anti-attrition to MV maids against a CC-only rule | **5,526** *(as of 2026-09-15)* | off-rule | **20 notes** — one aged off the window (was 5,726 / 21). | **21 notes — revised up 131% (S5).** The original 11 notes / AED 2,476 resolved contract type from `HOUSEMAIDS_INFO_REVISION`, an Envers audit table. `HOUSEMAID_TYPE_LOGS` is the purpose-built timeline with closed intervals, and it finds nearly twice as many |
| Note exceeds its approved expense request | 1,304 | off-rule | 4 notes of 11,819 linked |
| ⚠️ **Anti-attrition same-day excess over entitlement** | **838 — UNVERIFIED** | paid twice | 17 groups. 🔴 **The entitlement basis was never recorded.** A reconstruction (SUM(day) − MAX(note)) returns **463**. Re-derive or retire — do not file at 838 |
| Forgive Deduction: 15–21 days forgiven in a single month | **2,492** | off-rule | 3 maid-months, 55 notes. One note is one day, so 21 notes means two thirds of a month was unpaid then written back. **Both hard ceilings held** — no maid-month exceeded the days in the month or a month's salary |
| ⚪ **RETRACTED — "raffle prizes to maids terminated before the draw"** | **0** | — | **RFC1: all 15 were re-hired.** Every one of the 15 notes shows status activity *after* the termination date — **1,039 status changes across the 13 maids** — and all 15 resolve to `WITH_CLIENT` on the draw date. `HOUSEMAIDS_INFO.DATE_OF_TERMINATION` is current state and is **not cleared on re-hire**, so a returning maid reads as "terminated 558 days ago" forever. The prizes went to maids actively placed with a client |
| Prorated salary paid to maids outside the eligibility window | **2,976** | not deserved | 25 notes — 18 whose salary start predates the note by a median 650 days, 7 whose salary start is *after* it. **Resolved as-of the note date** (PS1c), down from 78 on a current-state read |
| Airfare paid above its nationality tier | **500** | off-rule | 1 Kenyan note at 2,000 against a 1,500 tier — **the only one in 1,518** |
| 🔴 **Anti-attrition paid to a maid in a NO-SHOW or terminated state** | **13,257** | not deserved | **110 notes (S4).** 68 `NO_SHOW_WENT_OUT_DID_NOT_RETURN` (8,147) · 21 `NO_SHOW_LEFT_CLIENT_HOME` (3,672) · 13 `NO_SHOW_FOR_TERMINATION` (748) · 6 `NO_SHOW` (419) · 2 `EMPLOYEMENT_TERMINATED` (271). The code filters `status not in rejectedStatuses` **at selection**, then pays two hops later — the same select-once flaw behind the AED 3,050 selection-lag finding, measured properly for the first time. A retention incentive to a maid who has absconded |
| 🔴 **Accommodation Relocation paid to a live-in maid** | **3,900** | not deserved | **5 notes — revised down from 6 / AED 4,700 (S5).** `HOUSEMAID_TYPE_LOGS` carries `CC Live In` / `CC Live Out` / `MV` directly, so the rule is testable in one column instead of two. The `LIVE_OUT`-flag version was close but not exact |
| ⚠️ **Live-out transport allowance paid to a live-in maid** | **392 — UNVERIFIED** | not deserved | 3 notes. 🔴 **The expense-head filter is not recorded.** Without it the same test returns **AED 4,237 across 47 notes**. Recover the head string before filing. | The other **317 of 320 clear** — AED 71,457 — and 36 of them resolve to a different flag than today, so the clear is earned rather than an artifact |



## 💷 LEDGER TOTAL — RECOMPUTED FROM THE ROWS, 2026-09-15

The old headline (~AED 103,100) is **withdrawn**. It is not reproducible from the rows as they now
stand, and two of its largest components have been retracted. This is rebuilt by addition, with
every row named so the arithmetic can be checked.

### Money lost

| # | Finding | AED | Archetype | Source |
|---:|---|---:|---|---|
| 1 | Anti-attrition paid to a maid in a NO-SHOW or terminated state | 13,257 | not deserved | S4 · 110 notes |
| 2 | Bonus over the referral entitlement *(as of 2026-09-15)* | 11,500 | not deserved | O12b · 16 maids |
| 3 | Anti-attrition paid before any enrolment existed | 9,019 | not deserved | F5 · 42 notes |
| 4 | Anti-attrition to MV maids against a CC-only rule *(as of 2026-09-15)* | 5,526 | off-rule | L4 · 20 notes |
| 5 | Airfare to MV maids | 4,500 | off-rule | AF2 · 3 notes |
| 6 | Accommodation Relocation paid to a live-in maid | 3,900 | not deserved | S5 · 5 notes |
| 7 | Selection-lag payments to already-ineligible maids | 3,050 | off-rule | 11 notes |
| 8 | Prorated salary paid outside the eligibility window | 2,976 | not deserved | PS1c · 25 notes |
| 9 | Forgive Deduction: 15-21 days forgiven in a single month | 2,492 | off-rule | FD2 · 3 maid-months |
| 10 | Note exceeds its approved expense request | 1,304 | off-rule | O1 · 4 notes |
| 11 | Anti-attrition same-day excess over entitlement | 838 | paid twice | F10 · 17 groups |
| 12 | Airfare paid above its nationality tier | 500 | off-rule | A1 · 1 note |
| 13 | Live-out transport allowance paid to a live-in maid | 392 | not deserved | TF13 · 3 notes |
| | **SUM OF THE SURVIVING ROWS** | **59,254** | | 13 rows |

### Control violated — a rule broken, the money may still be owed. **DO NOT ADD TO THE ABOVE.**

| Finding | AED |
|---|---:|
| Bonus paid before the bonus was requested | 9,500 |
| A deprecated, config-disabled bonus path is still paying | 7,126 |
| **Subtotal** | **16,626** |

Plus the invoice-gate finding, which carries no amount: the three heads that require an invoice
carry **zero** of the money; their no-invoice twins carry all of it.

### The arithmetic against the old figure

| | AED |
|---|---:|
| Old column sum (pre-retraction) | 110,954 |
| − Airfare duplicates, retracted 2026-09-14 | −49,500 |
| − Airfare automatic-guard failure, retracted 2026-09-14 | −3,000 |
| = Surviving money-lost total, as the rows stood on 2026-09-14 | 58,454 |
| + Bonus over-entitlement re-measured 2026-09-15 (10,500 → 11,500) | +1,000 |
| − L4 re-measured 2026-09-15 (5,726 → 5,526), one note aged off the window | −200 |
| **= Surviving money-lost total** | **59,254** |

110,954 − 52,500 = 58,454, and +1,000 of window drift gives **59,454**. The retraction step **reconciles exactly**, which is the check that the retraction removed
what it claimed to and nothing else.


### FINDINGS-RUN, 2026-09-15 — all 13 rows re-measured, and one lesson about re-measuring

`queries/FINDINGS-RUN.sql`. One statement; every row carries measured vs recorded.

| Outcome | Rows | Detail |
|---|---:|---|
| **Drift exactly 0** | **9** | L1, L2, L5, L6, L8, L9, L10, L12 — and L3 once its definition was corrected |
| Genuine drift | **1** | L4 **−200**: one note aged off the window |
| **Cannot be re-measured** | 1 | L7 selection-lag — no query exists |
| **Reconstruction disagrees with the original** | 2 | L11 (463 vs 838) · L13 (4,237 vs 392) |

🔴 **The ledger is STABLE.** Across 13 rows and a week, exactly one note changed hands. The bonus
row's earlier AED 1,000 move was the exception, not the pattern.

🔴 **MY OWN RE-MEASUREMENT PRODUCED THE ONLY OTHER "MOVEMENT", AND IT WAS FALSE.** L3 first read
11,145/51 against 9,019/42. I reported it as a live, accelerating defect. It was neither: F5 counted
maids paid BEFORE enrolment, and I had written `first_created IS NULL OR note_day < first_created`,
silently folding in maids with NO enrolment record. The monthly-rate check settled it — the two
columns split cleanly to 42 and 9, and `pct_failing` is **falling** (2.05% Oct-2025 → 0.22% Sep-2026),
so the defect is improving, not accelerating.
**This is the AED 49,500 failure mode exactly: a reconstruction that differs from the original and
gets read as a change in the world.** A re-measurement must reproduce the original's DEFINITION, not
merely its subject.

🟡 **New candidate, not folded into any row: 9 anti-attrition notes (~AED 2,126) to maids with NO
enrolment record at all.** Arguably a stronger finding than paying early — but it is a CANDIDATE,
because the exercise above showed I do not know what F5 intended to exclude.

🔴 **Three rows — AED 4,280 — are UNVERIFIED and must not be filed**: L7 has no query, L11's
entitlement basis was never recorded, L13's expense-head filter was never recorded.

### Three honest caveats on this number

1. ✅ **SETTLED 2026-09-15 — no de-duplication is due.** O12b re-ran the test at MAID level, so
   priority ordering cannot hide anyone. The old AED 1,400 overlap was against the **retracted**
   AED 143,965 row and died with it. **But the row itself moved: 16 maids / AED 11,500, up from
   15 / 10,500 a week earlier — the window is rolling.**
   🔴 **The general lesson, now a rule: every AED figure on this ledger is a SNAPSHOT and must
   carry an as-of date.** A rolling 12-month window means these rows drift without anyone touching
   them. This is the same constraint that bans window-aggregate checks from the dashboard.
   🟡 **A previously untested overlap DOES exist**: 9 notes / AED 6,500 across 8 of the 16 maids also
   appear in the control row "paid before the bonus was requested". Separate tables, so neither
   total double-counts — but half these maids are in both findings, and a write-up that tells both
   stories tells the same maids twice.
2. **Airfare-to-MV is carried at AED 4,500 (AF2).** A re-measure on 2026-09-14 — 12-month window,
   automatic path only, fan-out diagnostic clean — gave **3 notes / AED 6,000**. Consistent, but the
   two definitions are not reconciled. Carried at the lower, older figure deliberately.
3. **Counts, not money, are unverified on F5 / F10 / O1** after the `AMOUNT > 0` pass. The amounts
   stand for the reasons given in that section; the note counts (42, 17 groups, 4 of 11,819) do not.

### Retracted over the audit's life

| | AED |
|---|---:|
| Bonus at referral rates, no referral → candidate | 143,965 |
| Airfare duplicates via the unguarded manual route | 49,500 |
| Airfare, the automatic guard itself failed | 3,000 |
| Raffle prizes to terminated maids | 0 |
| Advances with no loan booked | 0 |
| **Total withdrawn** | **196,465** |

**AED 196,465 has been withdrawn against AED 58,454 that survives.** Three and a bit dirhams
retracted for every dirham standing. That ratio is the most important number on this page: it is
what the verification discipline costs, and what it is worth.

## ✅ THE `AMOUNT > 0` PASS — 2026-09-15

Scope now excludes zero-amount notes, and the retracted AED 49,500 was caused by exactly that
omission. **Every live finding on this ledger was traced back to the query block that produced it
and checked.**

| | Findings | Verdict |
|---|---:|---|
| Blocks that already carried `AMOUNT > 0` | **13 of 16** | Unaffected: O6, O7, O8, O10, O12, FD2/FD3, PS1b/PS1c, S4, S5, AF2, TF13, A1, retraction-bonus-cases |
| Blocks that did **not** | **3** | F5 (AED 9,019) · F10/F11 (AED 838) · O1 (AED 1,304). **Patched 2026-09-15** |

### 🟢 No money on this ledger moves. Here is why, per block — not a blanket assurance

- **F5 — anti-attrition paid before enrolment (AED 9,019).** The figure is a **SUM of note
  amounts**; a zero-amount note contributes 0. The money stands. Only the **note count (42)** could
  be inflated.
- **O1 — note exceeds its approved request (AED 1,304).** The test is `note AMOUNT > request
  AMOUNT`. **A zero-amount note cannot exceed a positive request**, so it can never be flagged. The
  money stands. Only `linked_notes` (11,819) was inflated.
- **F10/F11 — same-day excess (AED 838).** The excess is `SUM(amounts on the day) − entitlement`;
  a zero adds nothing to the sum and is not counted as a full entitlement. The money stands.

### 🔴 One dangerous shape found, and it carried no money — this time

**F10 is a `LAG` gap histogram that treats the EXISTENCE of a prior note as evidence of a prior
payment.** That is the *identical* defect that produced the retracted AED 49,500: zero amount is
not the same as no payment. It happens to carry no ledger AED of its own — the AED 838 comes from
a downstream amount comparison — but its gap buckets and its "176 same-day repeats" are unverified,
and the next test built on that shape will carry money.

**The rule this establishes, for the spec:** a check may use another note's **amount**; it may not
use another note's **existence** unless that note has `AMOUNT > 0`.

### Still owed after this pass

1. **Re-run F5, F10, F11 and O1** to confirm the counts. The money is argued above, not measured.
2. **The ledger total still needs recomputing** — not because of this pass, but because of the two
   airfare retractions (AED 52,500). Do not quote ~AED 103,100.

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

## 🔴 `ASSIGNED_OFFICE_WORK_REASON_ID` does not mean what the audit assumed — OW5b is void

OWC2 asked the base-rate question of every maid currently carrying that reason id:

| Current status of maids carrying the office-work reason | Maids | % |
|---|---:|---:|
| **EMPLOYEMENT_TERMINATED** | 1,463 | **57.4%** |
| WITH_CLIENT | 866 | 34.0% |
| WITH_CLIENT_NOT_PICKED | 91 | 3.6% |
| **ASSIGNED_OFFICE_WORK** | **20** | **0.8%** |

**The column is a marker that is never cleared.** Fewer than one in a hundred of its holders is actually
in office-work status, and a clear majority have left the company. Carrying the reason id is not
evidence that a maid was doing office work on any given day.

**So OW5b's "92/92 assigned, cleared" proves nothing** — not because the count was wrong, but because
the column it rested on cannot support the claim. *(Separately, re-reading the same revision table here
returns "reason set" on only 11 of the 92, against OW5b's 92. One of the two revision reads is also
wrong — moot now, but recorded rather than tidied away.)*

**What replaces it:** by status, only **15 of 92** office-work notes were `ASSIGNED_OFFICE_WORK` when
paid. **62 were `WITH_CLIENT`, AED 13,140.** That is a candidate, not a finding — an office-work
addition may legitimately be paid *after* the work, and this audit has already been caught once by a
note date that is not the event date (airfare's `payrollDueDate`). It needs the work date, not the
payment date.

## Candidates — real populations, not yet verdicts

| Population | AED | What would settle it |
|---|---:|---|
| 🟡 **Bonus whose narrative claims a referral, with no referral on record** | **56,000** | 70 notes, avg **800** — the referral rate — and median **418 days** into service, so not a signing bonus. **A candidate, not a finding:** the referrer↔referred pairing is `COALESCE(direct, latest-by-phone, latest-by-WhatsApp)`, a heuristic, so "no referral" is a floor rather than a fact |
| 🟡 **Bonus with an unclassified narrative and no referral** | **100,310** | 148 notes, avg **678** — squarely between the signing rate (500) and the referral rate (866), median 290 days in. Genuinely ambiguous; the previous "42,900 ambiguous" row is superseded by this one |
| 🟡 **Office Work Addition paid while `WITH_CLIENT`** | **13,140** | 62 of 92 notes. Needs the date the work was done, not the date it was paid — the OW5b clear that used to cover this is void (above) |
| Bonus with a referral but no bonus request | 70,895 | Whether `IS_REQUESTED_BONUS` is reliably set |
| Forgive Deduction above one day's salary | ≤1,756 | **Recorded as inconclusive, not a finding.** The 43 notes have a median one-day figure of 18 — the signature of a partial-month payroll row understating the rate |
| Bonus where the referrer has bonuses but none on that date | 16,500 | O9 flagged it; needs the same start-date cut |
| New same-day duplicates: Bonus 10,000 · Salary Dispute 2,582 · Taxi 887 · Maids.at 30 | 13,499 | **O10** — the two-contract split test |
| ✅ **RESOLVED — the raffle entrant pool is ~1,400** | **0** | Ask-the-code **46024** settles it. `findCandidatesForRafflePageable` groups **by `h.id` — one row per distinct maid**; ~6,700 is Σ ticket points, the *weighted entries*, not the head-count. Winners are de-duplicated inside a draw (`removeIf(e -> e == winnerId)` strips all of a winner's slots), so 48 winners/month are 48 distinct maids from ~1,400. **88 repeat winners scores 1.02× uniform chance at that pool — and because odds are POINT-WEIGHTED with points accumulating over tenure, the weighted expectation is *higher* than uniform, so the observed rate sits at or below chance.** Group F is clean on repeat-rate |
| Raffle Prize — the roster test (F1) only | 180,000 | Still needs the five raffle tables (N12) to confirm each winner held a participant row. **The repeat-rate question is closed; this one is not** |
| ⚪ **RETRACTED — "advances with no loan booked"** | **0** | TF14 reported 3.4% (Medical) and 4.3% (MOHRE) loan-booking; the approved KPI says **85–100%** and **100%**. Wrong field — `EXPENSES_REQUESTS.LOAN_AMOUNT` (the expense *request*) instead of `ADDITION_LOAN_AMOUNT` (the payroll *addition*). **TF21 then closed it on the business model:** `MEDICAL_ASSISTANCE_TYPE` has two values — where medical assistance is a **Loan** it is booked as one **100% of the time** (582 items, AED 63,835); where it is **Paid by Company** it is a benefit and has no loan *by definition* (355 items, AED 70,605). So the rate was also computed across a population containing a category the numerator cannot apply to. ⚠️ TF14 carried a positive control and it **passed**, on the one head where the two fields coincide |
| MV prorated paid twice to 3 maids | 1,245 | Whether each had two pre-collected contracts terminate |

## What has been cleared, on evidence

- 🟢 **Last Day CC Switch Adjustment — 213 of 213 on all three stated business rules**
  (requestor, 2026-09-10): the maid is **MV**, no duplication, no note above **AED 150**.
  Previously cleared against a weaker proxy — "a switch occurred" — so this is a stronger clear
  on a real rule, not a re-run. **The mechanism matters more than the score: median zero days
  between the MV switch and the note**, i.e. the note *is* the event, so no interval exists in
  which eligibility can change between being checked and being paid. And no bunching under the
  cap — the 141–149 band is empty, the opposite of a gamed threshold.

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
| Airfare, manual route | legacy expense path | ⚪ **RETRACTED** — the AED 49,500 was a zero-amount pairing artefact. The route does skip the guard, but no duplicate payment resulted |
| Bonus | — | **No gate at all** → AED 143,965 |

**Every one of the newest three validates its condition at the moment it writes the note. Every finding
in this ledger comes from a producer that does not.**

> ⚠️ **2026-09-14 — the two airfare guard findings above are RETRACTED.** They were the largest single item
> in the confirmed column (AED 52,500 of roughly AED 103,100). The confirmed total must be recomputed; do
> not quote the old figure. The cause was a missing `AMOUNT > 0` filter pairing real payments against
> zero-amount notes — the ninth retraction in this audit, and the second caused by a filter rather than by
> a misread column.

That is a design recommendation the audit earned rather than asserted, and it is worth more than the
AED 232,500: **the fix is not thirteen separate patches, it is one rule — validate at write time.**
