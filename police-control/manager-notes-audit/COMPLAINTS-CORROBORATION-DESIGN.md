# Complaints as the corroboration layer — design

**Date:** 2026-09-08 · **Evidence:** ERP interrogations 45948 + 45949 (all modules), warehouse
metadata, and queries 1b / 5 / 5b over live data.

The audit currently judges a payment against *records* — an expense, an enrolment, a draw. It does
not look at what anyone **said**. Complaints hold that, and for several payment types they are the
only place the justification exists at all.

---

## 1. The linkage reality: there is no foreign key

**Confirmed across every module.** `PayrollManagerNote`, `ExpenseRequestTodo`, `EmployeeLoan` and
`Expense` carry **no complaint column**. `processExpenseRequestTodo()` copies
`Expense.salaryAdditionType` and `purposeAdditionalDescription` — never a complaint reference. The
`ExpenseRelatedToType` enum is `MAID, APPLICANT, OFFICE_STAFF, TEAM, COMPANY, NOT_DETERMINED` —
**there is no `COMPLAINT` value.**

Three exceptions, and only three:

| Path | Reaches a complaint | Covers |
|---|---|---|
| `PayrollManagerNote → MaidManagerWorkOrder → Replacement → Complaint` | **real FK** | replacement-driven **deductions** only — out of scope for additions |
| `DelighterToDo.rbComplaint` (column `RB_COMPLAINT_ID`) | **real FK** | the resignation-retraction bonus — see §3 |
| `comp;NNNNNN` / `open-complaint/NNNNNN` in the note free text | text reference | a handful of notes — see §2 |

**So corroboration is a heuristic join: `HOUSEMAID_ID` + a date window + semantic match on the
complaint type.** That is workable, but it means a missing complaint can only ever be an AMBER unless
query 3 shows very high coverage for that type. Query 3 is still outstanding and is the gate on this
whole design.

## 2. How far the text references reach

| Payment type | Notes | `comp;` | `open-complaint/` | mentions "complaint" |
|---|---:|---:|---:|---:|
| Salary Dispute | 1,084 | 6 | **108** | **143** |
| Taxi Reimbursement | 498 | 0 | 23 | 27 |
| Airfare Ticket | 1,647 | 9 | 9 | 18 |
| Bonus | 1,205 | 1 | 9 | 13 |
| MOHRE requirement additions | 82 | 1 | 3 | 13 |
| **Anti-attrition Incentive** | **9,167** | **0** | **1** | **1** |
| Raffle · Prorated · MV Prorated · Forgive · Office Work · Medical · Last-Day CC · Accommodation | — | **0** | **0** | **0** |

**Where a `comp;` reference exists it is perfect: 18 of 18 resolved to a real complaint, and all 18 to
the same maid.** 100% precision, near-zero recall. So use it as a **validation anchor** for the
heuristic join — measure the heuristic's accuracy on the 18 notes where truth is known — never as the
join itself.

Salary Dispute is the type most linked to a conversation (13% of notes mention one), which fits: a
dispute *starts* as a complaint. Everything machine-generated references nothing, as expected.

## 3. 🔴 The finding: two retention mechanisms, and only one is evidenced

This is the direct answer to *"an anti-attrition example should have entries in complaints stating the
maid wants to leave and the reason."*

### The resignation-retraction bonus — fully evidenced, end to end

```
Complaint (primaryType = Maid_Wants_To_Resign__c)
   └── DelighterToDo.rbComplaint  ← REAL FK
         taskName = CHECK_MAID_INSISTING_TO_RESIGN
         resignationReason  ← A CATEGORISED PICKLIST  (yaya_dont_work_to_work_anymore_reasons)
         maidResignationReason  ← free-text fallback
   └── Complaint.initialDescription = "Resignation case - {reason name}"
         │
         └── POST /delighterToDo/retractResignation/{id}?retractMethod=ONE_TIME_BONUS
               └── DelighterService.handleRetractDelighterWithOneTimeBonus
                     └── addExpenseRequestForHousemaid(purposeAdditionalDescription = resignation_retraction)
                           └── ManagerNoteService.processExpenseRequestTodo → the `bonus` note
```

**The categorised leave reason you asked for already exists** — `DelighterToDo.resignationReason`, a
picklist. Every retraction bonus is traceable to a complaint, a todo, and a categorised reason.

### The anti-attrition incentive — AED 1.83m a year, evidenced by a free-text box

*(code-verified, conversation 45949.)* `MaidManagerActionLog` — the enrolment record — has:

- **no Complaint FK**
- **`workOrder` never set**, so even the indirect `MaidManagerWorkOrder → Complaint` path is empty
- `client` and `contract` auto-filled from the maid's active contract, **not from any complaint**
- **one required free-text field, `notes`** — creation throws if it is null

That is the entire justification. And the data agrees: **1 of 9,167 notes mentions a complaint.**

**So the company operates two retention payments. The smaller one is fully documented with a
categorised reason and an auditable chain. The larger one — 27% of live addition money — records why
in a text box, and links to nothing.** That asymmetry is a finding in its own right, and it is a
governance question, not a data gap: the mechanism to do this properly already exists next door.

**What makes it checkable anyway:** `MAIDMANAGERACTIONLOG.NOTES` **is** exposed in the warehouse
(`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS.NOTES`). An agent can read it and
judge whether it states a retention reason — and separately look for a `Maid Wants To Resign` /
`MV Retention` complaint on that maid as supporting evidence.

⚠️ **`MV Retention` (type 257, 4,054 complaints) must not be used for anti-attrition.** Anti-attrition
is CC-only (`housemaidType <> MAID_VISA`). An MV-retention complaint behind a CC incentive is a
contradiction, not a corroboration.

## 3b. 🔴 Query 3 came back and it inverts the design: presence proves nothing

Coverage is **94–100% for eleven of the fourteen live types**, with **4 to 26 complaints per note** in
the window. This is a very chatty system — 735,293 complaints, and the largest types are
`Maid related question` (90,625), `Document required` (23,722), `Maid is sick or injured` (20,467).

**So "does this maid have a complaint?" is almost always yes, and answers nothing.** A presence test
would return GREEN on everything and catch nobody. Any check built on it would be theatre.

### The raffle is a free control group

Raffle winners are drawn **at random, weighted only by tickets** — nothing about a maid's situation
influences whether she wins. Her complaint density is therefore the **background rate for a random
maid**: 3.58 complaints per note, 62% coverage. Everything else can be read as a lift against it.

| Payment type | Cover | Complaints/note | Lift vs random | Reading |
|---|---:|---:|---:|---|
| Accommodation Relocation | 100% | 26.27 | **7.3×** | strong association |
| Taxi Reimbursement | 99% | 20.14 | **5.6×** | strong |
| Forgive Deduction | 100% | 19.39 | **5.4×** | strong |
| Salary Dispute | 98% | 13.29 | **3.7×** | strong |
| Last Day CC Switch Adjustment | 100% | 11.29 | **3.2×** | strong |
| Anti-attrition Incentive | 87% | 10.32 | 2.9× | moderate |
| Airfare Ticket | 94% | 8.35 | 2.3× | moderate |
| Prorated salary | 96% | 7.28 | 2.0× | moderate |
| Maids.at other expenses | 99% | 7.14 | 2.0× | weak |
| Office Work Addition | 94% | 5.98 | 1.7× | weak |
| MV Prorated Salary | 98% | 5.55 | 1.6× | weak |
| **Medical Assistance** | **74%** | 4.33 | **1.2×** | **at background** |
| **Bonus** | **67%** | 4.18 | **1.2×** | **at background** |
| *Raffle Prize (the null)* | *62%* | *3.58* | *1.0×* | *— by construction* |

The lift column validates the corroboration map independently of the code: the types the ERP says are
conversation-driven sit at 3–7×, and the types it says are machine-generated sit at 1–2×. **Two
independent methods agreeing is the strongest evidence this design has.**

### Two results that were not predicted

🔴 **Medical Assistance sits at background — 1.2× and only 74% covered.** A medical payment on a maid
with no more sickness complaints than a random maid is the opposite of what the flow implies
(`MedicalAssistantJob` creates these off medical/EID steps). Either the payment is being raised
without the medical episode being ticketed, or the window is wrong. **23 notes, AED 5,857, worth
opening.** Small money, but it is the cleanest anomaly on this table.

**Bonus at 1.2× / 67% is expected and is a validation, not a finding.** *(code-verified: referrals are
never complaints.)* The referral half legitimately has no conversation. The retraction half should —
and it has a hard FK, so it should be tested through `DelighterToDo.rbComplaint`, not through this
window.

### What the check becomes

**Not** "is there a complaint" — **"is there a complaint of the *right type*, and is that more than
this maid's background chatter?"** Three consequences:

1. **The presence test is deleted.** It can never be a RED, on any type.
2. **Query 2 (co-occurrence) is now the critical missing query** — it gives the observed
   complaint-type distribution per payment, which is what a type-match test needs.
3. **Every type-match test needs a per-maid baseline**, not just a global one: a maid with 40 open
   complaints will match any type by chance. Score `complaints of the expected type ÷ complaints of
   any type` in the window, and compare that ratio to the same ratio across all maids.

**One residual use for presence:** the 87% coverage on anti-attrition still leaves **1,192 notes and
AED 270,427 where the maid had *no complaint of any kind* in a 104-day window** — while being paid to
be retained. That is not proof of anything, but it is a well-defined, small, high-value queue, and it
is the natural first batch for the agent.

## 3c. Query 2 settles it: the check is TYPE-MATCH plus TIMING, never presence

Two discriminators, and the second one is decisive.

### Discriminator 1 — lift over the raffle null

Share of a payment type's notes matching a complaint type, divided by the same share for raffle
winners. `*` marks types outside the raffle top-12, so those lifts are **conservative floors**.

| Payment type | Complaint type | Share | Lift | Days before |
|---|---|---:|---:|---:|
| Accommodation Relocation | Switch Maid To Live-out `*` | 77% | **22.3×** | 2.8 |
| Taxi Reimbursement | Housemaid Arrival & Transportation Check-Ins `*` | 76% | **21.8×** | 26.1 |
| Accommodation Relocation | Maid cash advance `*` | 69% | **20.0×** | 7.6 |
| Last Day CC Switch | Client wants to convert to the Visa Only Package `*` | 58% | **16.8×** | 12.5 |
| Office Work Addition | Document required `*` | 51% | **14.7×** | 21.7 |
| Forgive Deduction | Missing Salary Inquiry `*` | 41% | **11.9×** | 6.5 |
| Accommodation Relocation | **Maid Wants To Resign** | 79% | **10.3×** | 5.0 |
| MV Prorated Salary | **Maid's termination** `*` | 36% | **10.2×** | **0.1** |
| Salary Dispute | Missing Salary Inquiry `*` | 34% | **9.7×** | 11.4 |
| Maids.at other expenses | Overseas Employment Certificate `*` | 30% | 8.6× | 29.0 |
| MV Prorated Salary | MV Retention `*` | 23% | 6.5× | 8.9 |
| **Medical Assistance** | **Maid is sick or injured** | **51%** | **6.4×** | 20.9 |
| Airfare Ticket | Follow up for medical appointment | 51% | 5.2× | 13.4 |
| Airfare Ticket | Visa renewal `*` | 12% | 3.5× | 29.2 |
| **Anti-attrition Incentive** | **Maid Wants To Resign** | **13%** | **1.8×** | **30.8** |

### Discriminator 2 — temporal coupling, which is the real test

A 90-day lookback with **no** causal link averages ~30–45 days: the window's own midpoint. A complaint
that actually **drove** a payment sits within days of it.

| Days before the note | Payment · complaint |
|---:|---|
| **−1.4** | Accommodation Relocation · Housemaid Arrival & Transportation Check-Ins |
| **0.1** | MV Prorated Salary · Maid's termination |
| 0.9 | MV Prorated Salary · Unreachable Maid |
| 1.2 | MV Prorated Salary · Salary release request |
| 2.8 | Accommodation Relocation · Switch Maid To Live-out |
| 5.0 | Accommodation Relocation · Maid Wants To Resign |
| 6.5 | Forgive Deduction · Missing Salary Inquiry |
| 11.4 | Salary Dispute · Missing Salary Inquiry |
| 12.5 | Last Day CC Switch · Client wants to convert to the Visa Only Package |
| 13.4 | Airfare Ticket · Follow up for medical appointment |

🔴 **Anti-attrition is 30.8, 31.6 and 31.4 days — identical across every complaint type.** That is the
window's midpoint, which is exactly what a **month-end batch meeting a uniformly-arriving complaint
stream** produces. **Its complaint association is mechanical, not causal.** The 2.9× density lift from
query 3 was an artifact of the same thing.

So the retention payment with AED 1.83m a year behind it has:
- no FK to a complaint *(code)*
- 1 note in 9,167 referencing one *(query 5)*
- only **13% carrying a resignation complaint at all**, at **1.8× a random maid** *(query 2)*
- and **no temporal coupling whatsoever** *(query 2)*

Four independent methods, one conclusion. **Anti-attrition enrolment is not conversation-driven, and
the only justification that exists is the free-text `notes` box on the enrolment record.**

### 🔴 Correction: Medical Assistance was misread

I called it *"at background — no relationship"* from query 3's density (1.2×, 74% coverage). Query 2
shows the opposite: **51% carry `Maid is sick or injured`, a 6.4× lift.** Low overall density with
high type-specificity is the *ideal* corroboration profile — a quiet maid with exactly the right
complaint. **Density measures noise; type-match measures signal.** The 23 notes with no complaint at
all remain worth opening, but the type as a whole is well-corroborated.

### What the data revealed that nobody asked

**`Maids.at other expenses` is OWWA/OEC paperwork.** Overseas Employment Certificate 30%, Maid OWWA
Registration 30%, Client OWWA Registration 27% — Philippine overseas-worker documentation fees. The
spec has never said what this payment is for. Now it does.

**`Last Day CC Switch Adjustment` validates the code exactly.** 58% carry *Client wants to convert to
the Visa Only Package* and 40% *Eligible client to switch* — precisely the CC→MaidVisa switch the code
says triggers it. Two methods, same answer.

## 3d. The rule, stated

**A complaint is never structurally linked to a note, and presence proves nothing. The test is:**

> **Is there a complaint of an expected type for this payment, opened within days of it — more than
> this maid's own background chatter would produce by chance?**

- **Type-match is mandatory.** A generic `Maid related question` (90,625 complaints) corroborates
  nothing.
- **Timing is the strongest single signal.** Under ~15 days is a real link; ~30+ is the window
  talking to itself.
- **Normalise per maid.** A maid with 40 open complaints matches any type by chance — score
  *expected-type ÷ all types in the window*, then compare that ratio across maids.
- **Never RED on absence** except where lift and coupling are both strong (Accommodation Relocation,
  MV Prorated Salary, Last Day CC Switch, Medical Assistance, Taxi, Forgive Deduction, Salary
  Dispute). Everywhere else absence is AMBER at most, and for the machine-generated types it is N_A.

## 4. The corroboration map — expected complaint types per payment

Built from the real taxonomy (query 1b, 18-month volumes) and the code's type codes.

| Payment type | Expected complaint types (id · name · volume) | Strength |
|---|---|---|
| **Anti-attrition Incentive** | 24 `Maid Wants To Resign` (5,058) · 154 same name (48) · 137 `Maid doesn't want to work with the client anymore` (3,023) · 38 `Maid does not want to work with client` (2,368) · 88 `Maid does not want to renew with the company` (129) · 426 `Maid Doesn't Want To Renew` (104) · 284 `Refusal to Work (RTW)` (1,586). **Exclude 257 `MV Retention`** | supporting only — the enrolment `notes` is the primary evidence |
| **Bonus** — retraction half | 24 `Maid Wants To Resign` **via `DelighterToDo.rbComplaint`** | **hard FK** |
| **Bonus** — referral half | none. Referrals are never complaints *(code-verified)* | N_A — do not test |
| **Salary Dispute** | 193 `Missing Salary Inquiry` (3,423) · 320 `Salary release request` (3,174) · 322 `Salary Calculation Issue` (363) · 321 `Maid's last salary with the company` (146) · 330 `Loan Waivers & Deduction Corrections` (93) · 77 `Money Disputes` (2,423) · 323 `Manager note Addition not released` (9) · 156/420 overstay fines (220) | strong — 13% carry an explicit reference |
| **MV Prorated Salary** | **337 `Last MV Salary Disputes` (151)** · 321 `Maid's last salary with the company` (146) | precise — a near-exact semantic match |
| **Taxi Reimbursement** | 238 `Taxi canceled` (9,490) · **243 `Live-out transportation issues` (842)** · 303 `Housemaid Arrival & Transportation Check-Ins` (12,214). Code: the `transportation` **tag** on `ComplaintType` is the single source of truth | strong |
| **Accommodation Relocation** | 397 `Satwa Relocation` (25) · 162 `Complaint About Accommodation` (2,119) · 348 `Live-out Maid Staying in Accommodation` (94) · 280 `Switch Maid To Live-out` (432) | strong — and the only check on the unenforced CC live-out rule |
| **Medical Assistance** | 57 `Maid is sick or injured` (20,467) · 270 `Follow up for medical appointment` (1,611) · 493 `Maid Health Issue`. Codes: `Work_Injury_Sickness__c`, `Maid_s_Repeat_Medical__c` | strong |
| **Airfare Ticket** | **336 `Airfare & Vacation Compensation` (35)** · 103 `Vacation Policy` (624) · 177 `Travel assist` (1,018) | weak — it is renewal-driven, not complaint-driven |
| **Maids.at other expenses** | 339 `Maid cash advance` (2,892) · 119 `Maid related question` (90,625) | weak — too generic to test |
| **Raffle · Prorated salary · Forgive Deduction · Office Work · Last Day CC Switch** | none expected — all machine-generated from payroll state | **N_A — never test** |

**The N_A row matters as much as the others.** Requiring a complaint behind a machine-generated
payment would produce thousands of false findings on day one.

## 5. What the AI agent should actually do

Three jobs, in descending order of value:

**Job 1 — judge the enrolment reason (anti-attrition).** Read `HOUSEMAID_MANAGERACTIONLOGS.NOTES`
and return: does this state a retention reason? Which category (client conflict / salary / homesick /
family / workload / competing offer / none stated)? **Because no categorised field exists, the agent
*creates* the category** — and that categorisation is itself a deliverable the business does not have
today.

**Job 2 — verify the arithmetic reviewers wrote down (salary dispute).** Per note 174632, reviewers
often write the full itemised calculation into the free text. The agent parses it, re-adds it, and
confirms the total. Where no working is shown, report *"reviewer did not show their work"* — a
category the business can act on.

**Job 3 — corroborate against the conversation.** Given a note and the complaints on that maid in the
window, decide whether any of them supports this payment, and return a verdict plus the complaint id
it relied on. **Never a bare yes/no — always the evidence.**

### What to feed it, and what not to

`Complaint.summary` is GPT-written by `ComplaintsSummaryService.updateSummaryAndRecentSummaryComplaints`,
model **`gpt-4.1-nano` at temperature 0.9, topP 0.5** (a `gpt-4` variant also exists).

🔴 **Do not build a verdict on that summary.** Temperature 0.9 is high for summarisation, and an audit
finding that traces back to a creative-sampled paraphrase is not defensible. Use it to **triage** —
to decide which complaints are worth opening — and have the agent read `COMPLAINT_COMMENTS.TEXT`
(already HTML-stripped, `ITERATION`-ordered) plus `COMPLAINT_DESCRIPTION` for anything that becomes a
finding.

There is already an AI-assigned category: `ComplaintService.extractGptComplaintInfo()` parses a
structured block (`Last update / Complaint type / Complaint reason / …`) back out of the summary into
a `To-do: <TYPE> – <REASON>` label, configured by `PARAM_GPT_COMPLAINT_EXTRACTION_CONFIG`. Same
caution applies — useful as a prior, not as evidence.

**Not in the warehouse:** WhatsApp transcripts and call recordings live externally, referenced by
`ComplaintExtraDetails.chatId` / `callId` and `ExpertZiwoRecord`. The richest conversation is out of
reach today.

### The privacy boundary, which is a design constraint not a footnote

Complaint text carries personal circumstances — health, family, disputes — about named individuals.
**The agent reads it; the audit never republishes it.** The agent returns a verdict, a category and a
complaint id. Findings cite the id. No free text reaches an export, a dashboard or an inbox.

## 6. What is blocked

| # | Ask | Unblocks |
|---|---|---|
| **O33** | **Run query 3 (coverage).** Nothing here can be graded RED until we know what share of each type has any complaint at all | the entire design |
| **O34** | Ingest **`DELIGHTER_TODO`** — `rbComplaint`, `taskName`, **`resignationReason`** (the categorised leave reason), `maidResignationReason` | the retraction-bonus chain, end to end |
| **O35** | Expose the `ComplaintType` **`tags`** join (`COMPLAINT_TYPES_TAGS`) — the code says the `transportation` tag, not the type name, is the single source of truth | taxi corroboration done the way the ERP does it |
| **O36** | Confirm `HOUSEMAID_MANAGERACTIONLOGS.NOTES` is populated and readable at volume | anti-attrition Job 1 |
| **O37** | **Governance:** should `anti_attrition_incentive` enrolment require a linked complaint and a categorised reason, as `resignation_retraction` already does? Not a data question | 27% of live addition money |
