# The overpayment ledger

**What the audit exists to find: money that left without justification.**
Underpayment findings are byproducts and live in remediation lists, not here.

**Confirmed 2026-09-08 — AED 94,687 against AED 7,197,642 examined.**

| Finding | AED | Archetype | Basis |
|---|---:|---|---|
| Airfare duplicates via the unguarded manual route | **49,500** | paid twice | 29 notes inside the 5-month guard, on a path that never calls it |
| Bonus paid before the bonus was requested | **15,000** | off-rule | 20 notes, 19 maids |
| 🔴 **Bonus over the referral entitlement** | **10,500** | not deserved | 15 maids paid AED 20,000 against 9,500 entitled — **validated by 466 maids matching to the penny** |
| Anti-attrition paid before any enrolment existed | **9,019** | not deserved | 42 notes, measured on `CREATION_DATE` |
| Selection-lag payments to already-ineligible maids | 3,050 | off-rule | 11 notes; corroborates the code's select-once flaw |
| Airfare — the automatic guard itself failed | 3,000 | paid twice | 7 notes, automatic → automatic |
| Anti-attrition to MV maids against a CC-only rule | 2,476 | off-rule | 11 notes, resolved point-in-time |
| Note exceeds its approved expense request | 1,304 | off-rule | 4 notes of 11,819 linked |
| Anti-attrition same-day excess over entitlement | 838 | paid twice | 17 groups |

## Candidates — real populations, not yet verdicts

| Population | AED | What would settle it |
|---|---:|---|
| Bonus with a referral but no bonus request | 70,895 | Whether `IS_REQUESTED_BONUS` is reliably set |
| Bonus with no referral at all | 251,721 | `PURPOSE_ID` — separates referral from signing bonus |
| Raffle Prize | 180,000 | The five raffle tables (N12) — **48 winners every month for 12 months** |
| MV Prorated + Prorated salary | 886,905 | Effective-dated salary history (N10) |

## What has been cleared, on evidence

- **AED 2.8m of expense-backed money** — 11,819 notes against their requests: AED 1,304 of disagreement (O1).
- **Cash airfare plus a company ticket** — 361 maids hold both; none within 180 days (A5).
- **Notes on cancelled/rejected expense requests** — zero, against 2,083 such requests (V9).

## The strategic finding

**The overpayment risk is not where the approval gate is.** O1 cleared the gated half almost
completely. **AED 4,359,589 — 60.6% — has no expense request at all**, so no approval, no amount to
check against: raffle, prorated, forgive-deduction, 95% of airfare, 71% of bonus. Every confirmed
finding above except O1's own AED 1,304 comes from that population.
