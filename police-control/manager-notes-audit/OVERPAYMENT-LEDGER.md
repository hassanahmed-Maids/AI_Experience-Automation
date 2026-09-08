# The overpayment ledger

**What the audit exists to find: money that left without justification.**
Underpayment findings are byproducts and live in remediation lists, not here.

**Confirmed 2026-09-08 — ~AED 228,700 of money lost, against AED 7,197,642 examined (3.2%).**

✅ **De-duplicated.** O12 resolved every bonus note to one verdict: the two bonus findings overlap by
**3 notes across 2 maids**, so about AED 1,400 of the total is double-counted. Recorded, not chased.
Three times this session a headline would have been overstated by summing overlapping tests — O6/O7
by 58%, O8/O10, and this one — so **no figure here is a sum of tests; each is a distinct note set.**

🔴 **Two categories, and they must not be added together.** *Money lost* is money that should not
have left. *Control violated* is a rule broken where the money may still have been owed — a real
finding, but not a recovery. Reporting them as one number overstates the loss.

| Finding | AED | Archetype | Basis |
|---|---:|---|---|
| 🔴 **Bonus paid at referral rates, no referral, over a year into service** | **143,965** | not deserved | 164 notes, 142 maids, **de-duplicated (O12)**. Four converging signals: no referral, no bonus record, median 765 days into service, and an average of 878 matching the referral rate (866) rather than the signing rate (500) |
| Airfare duplicates via the unguarded manual route | **49,500** | paid twice | 29 notes inside the 5-month guard, on a path that never calls it |
| 🔴 **Bonus over the referral entitlement** | **10,500** | not deserved | 15 maids paid AED 20,000 against 9,500 entitled — **validated by 466 maids matching to the penny** |
| Anti-attrition paid before any enrolment existed | **9,019** | not deserved | 42 notes, measured on `CREATION_DATE` |
| Selection-lag payments to already-ineligible maids | 3,050 | off-rule | 11 notes; corroborates the code's select-once flaw |
| Airfare — the automatic guard itself failed | 3,000 | paid twice | 7 notes, automatic → automatic |
| Anti-attrition to MV maids against a CC-only rule | 2,476 | off-rule | 11 notes, resolved point-in-time |
| Note exceeds its approved expense request | 1,304 | off-rule | 4 notes of 11,819 linked |
| Anti-attrition same-day excess over entitlement | 838 | paid twice | 17 groups |
| Forgive Deduction: 15–21 days forgiven in a single month | **2,492** | off-rule | 3 maid-months, 55 notes. One note is one day, so 21 notes means two thirds of a month was unpaid then written back. **Both hard ceilings held** — no maid-month exceeded the days in the month or a month's salary |
| Raffle prizes to maids terminated before the draw | **3,000** | not deserved | 15 wins, 13 maids, **median 558 days** after they left |
| Prorated salary paid to maids outside the eligibility window | **2,976** | not deserved | 25 notes — 18 whose salary start predates the note by a median 650 days, 7 whose salary start is *after* it. **Resolved as-of the note date** (PS1c), down from 78 on a current-state read |
| Airfare paid above its nationality tier | **500** | off-rule | 1 Kenyan note at 2,000 against a 1,500 tier — **the only one in 1,518** |
| 🔴 **Accommodation Relocation paid to a live-in maid** | **4,700** | not deserved | 6 notes, 6 maids. The rule is CC live-out only; TF6 cleared the CC half, TF7 broke on this one. **Resolved as-of the note date — and the as-of read is the whole finding:** 5 of 66 notes carry a different `LIVE_OUT` than today, so a current-state read would have flagged 5 notes of which 2 were wrong, while missing 3 of the 6 real ones |

### Control violated — a rule broken, the money may still be owed

| | AED | Basis |
|---|---:|---|
| Bonus paid before the bonus was requested | 9,500 | 12 notes, de-duplicated from O6's 20 |

## Candidates — real populations, not yet verdicts

| Population | AED | What would settle it |
|---|---:|---|
| Bonus with a referral but no bonus request | 70,895 | Whether `IS_REQUESTED_BONUS` is reliably set |
| Forgive Deduction above one day's salary | ≤1,756 | **Recorded as inconclusive, not a finding.** The 43 notes have a median one-day figure of 18 — the signature of a partial-month payroll row understating the rate |
| Bonus, 6–12 months into service, no referral | 42,900 | Between the signing profile (avg 500) and the referral one (866) at avg 596 — genuinely ambiguous |
| Bonus where the referrer has bonuses but none on that date | 16,500 | O9 flagged it; needs the same start-date cut |
| New same-day duplicates: Bonus 10,000 · Salary Dispute 2,582 · Taxi 887 · Maids.at 30 | 13,499 | **O10** — the two-contract split test |
| ⚠️ **Raffle: is the entrant list ~1,400 or ~6,700?** | 180,000 *(the whole type)* | **One number, not an ingestion.** 88 repeat winners is **1.02× chance** for a pool of 1,400 and **4.09×** for 6,738. R3 shows MAID_VISA wins at 0.29× its share and three nationalities never win, so the real pool is far smaller than the paid population. **If the draw enters ~1,400 maids, group F is clean.** *(An earlier version of this row called the draw non-uniform on the 6,738 figure — retracted.)* |
| Raffle Prize | 180,000 | The five raffle tables (N12) — **48 winners every month for 12 months** |
| MV prorated paid twice to 3 maids | 1,245 | Whether each had two pre-collected contracts terminate |

## What has been cleared, on evidence

- **AED 2.8m of expense-backed money** — 11,819 notes against their requests: AED 1,304 of disagreement (O1).
- **Cash airfare plus a company ticket** — 361 maids hold both; none within 180 days (A5).
- **Notes on cancelled/rejected expense requests** — zero, against 2,083 such requests (V9).
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
