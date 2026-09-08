# The overpayment ledger

**What the audit exists to find: money that left without justification.**
Underpayment findings are byproducts and live in remediation lists, not here.

**Confirmed 2026-09-08 — ~AED 224,000 of money lost, against AED 7,197,642 examined (3.1%).**

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

### Control violated — a rule broken, the money may still be owed

| | AED | Basis |
|---|---:|---|
| Bonus paid before the bonus was requested | 9,500 | 12 notes, de-duplicated from O6's 20 |

## Candidates — real populations, not yet verdicts

| Population | AED | What would settle it |
|---|---:|---|
| Bonus with a referral but no bonus request | 70,895 | Whether `IS_REQUESTED_BONUS` is reliably set |
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
