# Machine-written manager notes — the 58% with no author

**Measured 2026-09-14.** Window: rolling 12 months, `NOTE_TYPE='ADDITION'`, `AMOUNT > 0`.

## The headline

**AED 3,976,775.54 across 5,345 notes — 58% of all manager-note money — is written with no
human identity at all.** It is the `(no requester recorded)` producer: 14.64 notes/day across
10 payment types and 3,887 maids. Nothing else in the data comes close; the busiest real
person (Jed Torres, Delighter Coach) runs at 3.25/day.

## What the warehouse can and cannot say

| Field | Result on the 5,345 machine notes |
|---|---|
| `REQUESTED_BY` | NULL on all — this is the defining filter |
| `APPROVED_BY` | **0 notes carry an approver** |
| `EXPENSE_ID` | **0 of 5,345 link to an expense request** |
| `MANAGER` | dead column (`EMPLOYEE_MANAGER_ID` unmapped in the JPA entity) |

🔴 **The warehouse route is exhausted.** There is no field in `BA_VIEWS` recording which
system wrote a note.

### Two consequences

1. **These additions bypass the entire expense-authorisation pathway.** The AED 200 approval
   gate, invoice upload, named requester, named approver — all live on `EXPENSES_REQUESTS`.
   These notes never touch it. The controls are not failing on this money; they were never
   in the path.
2. **`raised_by_profile` cannot apply here.** That heuristic (queries/maids-at-sample.sql)
   keys off `APPROVAL_METHOD` on the expense head. No head, no signal. The **rate** signature
   (14.64 notes/day) is the only thing that identifies the machine set.

## The fix, now priced

`payrollmanagernotes.CREATOR` (`BIGINT` → `USERS.ID`) exists in the ERP and is **not** in the
warehouse view. It is N6 in `SPEC_manager_notes_audit_v2.md` and sits in the DNA ingestion
ticket as a nice-to-have.

**It is not a nice-to-have. Ingesting `CREATOR` makes AED 3.98m — 58% of manager-note money —
attributable for the first time.** Jobs run under a system user, so it should resolve the
machine set as well; that last clause is an EXPECTATION until the column is actually seen.

## 🔴 CORRECTION (same day): "no author recorded" is NOT the same as "written by a bot"

The first pass classified these by RUN-DAY COUNT alone and called all ten "jobs". The HOUR
fingerprint breaks that. Three distinct signatures, two of them anchored to a known case:

| Fingerprint | Types | Reading |
|---|---|---|
| **One hour, midnight, all 7 days** | Airfare (100% exactly midnight), Raffle Prize (100%), Prorated salary (100%), Salary Dispute (87.5%) | A true **scheduled job**. 2,423 notes, AED 2.47m |
| **All 24 hours, ~0% midnight** | Bonus (20 distinct hours), Forgive Deduction (19) | **Event-driven service** — fires when its trigger fires |
| **Business hours only, never Sunday** | **MV Prorated Salary** (9–21, six days, 226 run days), Last Day CC Switch (7–22, Fri/Mon/Tue only) | **A HUMAN IS ACTING** and requestedBy is simply not recorded |

**Both fingerprints are anchored, not guessed:**
- *Positive control on row 2:* **Forgive Deduction is code-confirmed automatic** (the
  `cover_deduction_limit` / `cover_negative_salary` additions) and it shows the all-hours
  spread. So that signature genuinely means automatic-but-event-triggered, not human.
- *Positive control on row 1:* Airfare's single-midnight-hour matches the airfare **producer
  signature** (midnight timestamps) independently identified earlier in this audit.

### The standout

**MV Prorated Salary — AED 803,257 across 782 notes, 226 days a year, 9am to 9pm, never on a
Sunday, with no author recorded.** That is not a bot. Something a PERSON does is writing
AED 803k onto payslips without stamping who did it. This is now the highest-value open
question in the machine-written set, ahead of Airfare by mechanism if not by amount.

### Anomaly RESOLVED

Last Day CC Switch's "213 notes over 3 run days" is **not** a job that fired three times: the
notes spread over 16 hours of the day on Fri/Mon/Tue. It is a **human bulk-entry session**.
That also removes the tension with the earlier `median_days_to_switch = 0` measurement.

## Schedule fingerprint — the raw evidence

| Payment type | Notes | AED | Run days | /day | % month-edge | Reads as |
|---|---:|---:|---:|---:|---:|---|
| Airfare Ticket | 1,220 | 2,189,000 | 313 | 3.9 | 19.8 | Scheduled job, midnight, 100% |
| MV Prorated Salary | 782 | 803,256.89 | 226 | 3.5 | 15.9 | 🔴 **Human hours** (9–21, never Sunday) |
| Bonus | 801 | 609,775 | 264 | 3.0 | 20.3 | Event-driven service (20 hours) |
| Raffle Prize | 576 | 180,000 | 12 | 48.0 | 0.0 | Monthly, off-cycle draw |
| Prorated salary | 619 | 98,836 | 11 | 56.3 | 100.0 | Monthly payroll batch |
| Forgive Deduction | 1,038 | 53,680 | 91 | 11.4 | 38.6 | Payroll-adjacent, > monthly |
| Office Work Addition | 93 | 30,828 | 72 | 1.3 | 14.0 | Sporadic |
| Last Day CC Switch | 213 | 13,616 | 3 | 71.0 | 100.0 | Human bulk entry (16 hours, Fri/Mon/Tue) |
| Salary Dispute (machine) | 7 | 2,483.65 | 3 | 2.3 | 100.0 | Rare, month-edge |
| MV Extra Salary | 1 | 300 | 1 | 1.0 | 100.0 | Once |

### Why there are TWO prorated-salary heads — a specific hypothesis

They are not duplicates. `Prorated salary` is a **monthly payroll batch** (11 runs, 100%
month-edge); `MV Prorated Salary` is **event-driven** (226 runs, 15.9% month-edge). Different
mechanisms, therefore different owners. AED 902,092.89 between them. Confirm against code.

### ⚠️ Anomaly as first recorded (now resolved above — kept for the method)

**Last Day CC Switch Adjustment: 213 notes across only 3 run days** (71 per run). A monthly
job would show ~12. Either it fired three times in a year or the switch events themselves
batch. This sits awkwardly beside the earlier measurement that `median_days_to_switch = 0`
(the note IS the event, which implies a continuous trickle). Flagged, not smoothed over.

## Already known from code (do not re-ask)

- **Forgive Deduction** — the automatic `cover_deduction_limit` / `cover_negative_salary`
  additions, each paired with an `EmployeeLoan` in the same transaction.
- **Raffle Prize** — `RaffleService` / `GenerateRaffleTicketLogsJob` (staffmgmt).
- **Last Day CC Switch** — the note is the event; 213/213 passed all three stated rules.

## Open — needs ask-the-code (CLAUDE.md rule 1), in money order

1. Which job writes the **Airfare Ticket** additions? (AED 2,189,000)
2. Which writes the machine **Bonus** additions — is it the same `DelighterService` path as
   the retraction bonus? (AED 604,775)
3. **MV Prorated Salary vs Prorated salary** — confirm the two-mechanism hypothesis above.
   (AED 902,092.89)

Submitted 2026-09-14, ask-the-code session **46380**, pinned to
`erp/magnamedia-housemaid-management, erp/magnamedia-payroll-management,
erp/magnamedia-accounting`. Question order revised after the hour fingerprint: **MV Prorated
Salary first** (is it user-triggered, and why is `requestedBy` null on that path?), then
Airfare, then Bonus.

⚠️ Alias trap: `erp/magnamedia-payroll` does not exist and fails the whole multi-repo clone
(`require_all_modules_to_exit is enabled: all 3 repositories must succeed, but only 2
succeeded`). The alias is **`erp/magnamedia-payroll-management`** — see `docs/code-llm-api.md`.

Token goes in `.env` only — never into a prompt, a doc, or a commit.
