# Complaints as the corroboration layer — design

**Date:** 2026-09-08 · **Evidence:** ERP interrogations 45948 + 45949 (all modules), warehouse
metadata, and queries 1b / 2 / 3 / 5 / 5b / 6 over live data.

The audit currently judges a payment against *records* — an expense, an enrolment, a draw. It does
not look at what anyone **said**. Complaints hold that, and for several payment types they are the
only place the justification exists at all.

---

## 1. The linkage reality: there is no foreign key

**Confirmed across every module.** `PayrollManagerNote`, `ExpenseRequestTodo`, `EmployeeLoan` and
`Expense` carry **no complaint column**. `processExpenseRequestTodo` copies
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
query 3 shows very high coverage for that type. *(Query 3 has since come back and inverted this —
see §3b: coverage is so high that presence proves nothing at all.)*

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
(`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS.NOTES`). An AI Agent can read it and
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
is the natural first batch for the AI Agent.

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

## 3e. Query 6 returned 32k rows, and that is the fourth confirmation

The work queue as first written joined note × complaint and returned **32,247 rows for a 3-month,
2-type window**. That is not a data problem. Query 3 measured 10.32 complaints per note for
anti-attrition and 13.29 for salary dispute; ~2,570 notes in the window fan out to ~32k pairs, which
is the density arriving exactly as predicted — now confirmed on a 3-month window as well as a
12-month one.

**A `LIMIT` would have been the wrong fix.** Truncating the join cuts a maid's complaint list
mid-way and hands the AI Agent a queue whose missing evidence is invisible to it — the AI Agent would
return "no corroborating complaint" for notes whose corroboration was simply below the cut. The
export shape was the defect: §3d's rule needs three numbers per note (type-match, timing,
per-maid specificity), and all three are aggregates. They collapse to **one row per note** if
scored inside the warehouse instead of exported and scored outside.

So query 6 is now three:

| | Returns | Carries personal text | Purpose |
|---|---|---|---|
| **6a** | ~8 rows | no | the band distribution — sets the thresholds, and says whether a queue is worth building |
| **6b** | ≤300 rows | no | the ranked queue: ids, dates, amounts, scores. One row per note, fan-out collapsed by `QUALIFY` picking the single best-matching complaint (expected type first, then nearest in time) |
| **6c** | 1 note | **yes** | the detail fetch, by `note_id`. The only query in the pack that returns free text |

The four bands are §3d made executable:

| Band | Meaning |
|---|---|
| `1_CORROBORATED_coupled` | expected complaint type, within 15 days — a real link |
| `2_TYPE_MATCH_but_window_noise` | right type, ~30+ days — the 90-day window talking to itself |
| `3_NO_TYPE_MATCH` | complaints present, none of the expected type — corroborates nothing |
| `4_NO_COMPLAINT_AT_ALL` | the small high-value queue of §3b |

**§4's map is now data, not prose** — a `VALUES` CTE keyed on `COMPLAINT_TYPE_ID`, carrying the
two types in scope and extensible to the other twelve by adding rows. Anti-attrition excludes 257
`MV Retention` in the CTE itself, so the CC-only rule cannot be forgotten at query time.

**Prediction, to be checked against 6a:** anti-attrition should land overwhelmingly in bands 2–4.
Query 2 put its expected-type share at 13% and its coupling at 30.8 days — the window's midpoint —
so band 1 should be near-empty. If it is not, query 2's reading is wrong and §3c needs revisiting.
Salary dispute, at 34% share and 11.4 days, should show a real band 1. **6a is a falsification test
for the whole design, not just a queue-sizing exercise.**

## 3f. 🔴 6a came back: salary dispute confirms, anti-attrition does not clear chance

3-month window, 2,793 anti-attrition notes (AED 621,322) and 337 salary-dispute notes (AED 120,196).

| Payment type | 1 coupled | 2 window noise | 3 no type match | 4 no complaint |
|---|---:|---:|---:|---:|
| Anti-attrition Incentive | 336 · **12%** · AED 63,959 | 497 · 18% · AED 100,722 | **1,484 · 53% · AED 339,084** | 476 · 17% · AED 117,557 |
| Salary Dispute | **161 · 48%** · AED 57,709 | 17 · 5% · AED 4,993 | 150 · 45% · AED 53,342 | 9 · 3% · AED 4,152 |

**Salary dispute passes, and by more than query 2 predicted.** 53% of notes carry an expected
complaint type, and **90% of those are coupled within 15 days**. Query 2 forecast 34% share at 11.4
days; the wider type map (9 ids, not one) lifts the share, and the coupling is as tight as claimed.
The check works on this type. Band 1 is a real GREEN and band 3 is a real question.

### The band-1 percentage is not the test — the chance rate is

12% coupled looks weak for anti-attrition but weak is not the finding. **The window itself
manufactures band-1 hits.** A note's window spans signed day −14 to +90, 105 days; band 1 is the 30
days from −14 to +15, so **any single complaint lands in band 1 with p = 0.286 by geometry alone.**
A note with *k* expected-type complaints therefore hits band 1 by chance at 1 − (1 − 0.286)^k.

| | Notes with a type match | Band 1 among them | *k* | Chance rate | Observed ÷ chance |
|---|---:|---:|---:|---:|---:|
| Salary Dispute | 178 | **90.4%** | ~2.9 *(est)* | 61.8% | 1.46× *(est)* |
| Anti-attrition | 833 | 40.3% | ~1.8 *(est)* | 45.5% | 0.89× *(est)* |

*(Estimated from cohort averages. **Superseded by the measured figures in §3g** — both k values
were too high, which understated salary dispute badly. The direction held; the magnitudes did not.)*

🔴 **Anti-attrition's coupled band does not clear chance — it is not weak corroboration, it is no
corroboration.** Even where a resignation-family complaint exists, its timing relative to the payment
is indistinguishable from a complaint drawn at random from the window. This is the month-end batch of
§3c seen at note grain: the payment date carries no information about when the maid said anything.
*(§3g measures it exactly: **1.00×**.)*

Salary dispute is the contrast that proves the instrument works. **The same query, the same window,
the same geometry — one type clears chance decisively and the other does not.** *(§3g: **2.33×**.)*

*(k here is derived from band-1+2 specificity × query 3's density, and it was too high for both
types — see §3g for the measured values and the corrected lifts.)*

### The 53% nobody predicted

**1,484 anti-attrition notes — 53%, AED 339,084 in one quarter — carry complaints but not one from
the resignation family.** These maids are not silent: anti-attrition averages 10.3 complaints per
note. They are talking to the company constantly, about something else entirely, while being paid to
be retained. That is a sharper artefact than band 4's silence, and it is four times the volume.

**70% of anti-attrition notes have no expected-type complaint at all** (bands 3+4), and the remaining
30% show no timing signal. **No subset of this payment shows conversational corroboration above
chance.** Combined with §3's four methods, that closes the question: the enrolment `notes` free-text
box is not the *weakest* justification for AED 1.83m a year, it is the **only** one.

### Two observations the query threw off

**The run-rate is up ~36%.** AED 621,322 in three months annualises to ~AED 2.49m against the AED
1.83m recorded for the trailing twelve. Either anti-attrition is growing fast or the quarter is
unrepresentative. Not a finding — but an outstanding ask's governance question is about more money than §3 says.

**Band 4 is inflated at the recent edge.** Notes from the last 14 days have not yet lived through
their own +14-day forward window, so their complaint counts are truncated and they fall into bands 3
and 4 artificially. Anti-attrition band 4 reads 17% here against §3b's 13% over 12 months, and this
is the likely cause. **Any queue built from band 4 must exclude notes newer than 14 days**, or it
will open cases whose evidence simply has not arrived.

## 3g. Measured: anti-attrition is at 1.00× chance, salary dispute at 2.33×

6a-iii computes the chance rate per note instead of from cohort averages.

| Payment type | Notes type-matched | avg *k* | Observed band 1 | Chance | **Lift** |
|---|---:|---:|---:|---:|---:|
| Salary Dispute | 178 | 1.62 | 90.4% | 38.8% | **2.33×** |
| Anti-attrition Incentive | 833 | 1.72 | 40.3% | 40.2% | **1.00×** |

🔴 **Anti-attrition lands on 1.00.** Not "weak", not "below chance" — *exactly* the rate a complaint
drawn at random from the window would produce. 40.3% observed against 40.2% expected across 833
notes. A designed null could not land closer.

**Salary dispute is 2.33×, not the 1.46× estimated** — the estimate was wrong because it put *k* at
2.9 when the measured value is 1.62. Correcting *k* lowers the chance rate to 38.8% and the true lift
is far stronger than §3f claimed.

**The controlled comparison is now exact.** Both types carry effectively the same number of
expected-type complaints per note — 1.62 and 1.72 — so they face nearly identical chance rates
(38.8% and 40.2%). **The only thing that differs is *when* the complaints sit relative to the
payment.** Volume, density and vocabulary are held constant by the data itself; timing alone
separates a corroborated payment from an uncorroborated one.

### The arrival histogram, per-day so the bins are comparable

Edge bin `-15` spans 14 days and `90` spans 1, so raw percentages mislead. Normalised, against each
type's own far field (30–89 days out, where nothing causal should remain):

| Days before note | Anti-attrition | vs far field | Salary Dispute | vs far field |
|---|---:|---:|---:|---:|
| −14.−2 *(after the note)* | 16.4/day | 1.49× | 3.7/day | 6.4× |
| **0.14** | 16.1/day | **1.46×** | **11.6/day** | **19.9×** |
| 15.29 | **19.3/day** | **1.75×** | 1.8/day | 3.1× |
| 30.44 | 9.7/day | 0.88× | 1.1/day | 1.9× |
| 45.59 | 11.9/day | 1.08× | 0.3/day | 0.6× |
| 60.74 | 11.2/day | 1.02× | 0.7/day | 1.3× |
| 75.89 | 11.2/day | 1.02× | 0.1/day | 0.2× |

**Salary dispute is the textbook shape:** a 19.9× spike in the fortnight before the payment, decaying
monotonically to nothing. The complaint drives the payment, visibly, at day scale.

**Anti-attrition has no spike at all.** It has a broad, mild plateau — ~1.5× across the whole −14.+29
range — and then flat. **Its peak bin is 15–29 days, not 0–14.** A causal driver does not peak
*further* from the event than the bin next to it; a monthly cycle brushing against a monthly batch
does exactly that. This is §3c's 30.8-day mean seen in profile.

### Why a 1.5× plateau still scores 1.00× at note level

These two results are consistent, and the reason matters for the design. The mild near-window
enrichment sits on **chatty maids** — those with several expected-type complaints — where one more
nearby complaint does not change whether the *nearest* one falls in band 1, because it already
would. So the enrichment is a density effect, not a coupling effect, and it vanishes the moment the
question becomes per-note rather than per-complaint.

**This is precisely the failure §3d's per-maid normalisation rule was written to catch**, now
demonstrated on real data rather than argued. A per-complaint view would have reported anti-attrition
as 1.5× "enriched near the payment" and been wrong.

### Settled

Five independent methods — no FK *(code)*, 1 reference in 9,167 *(query 5)*, 13% type-share at 1.8×
*(query 2)*, 1.00× chance-adjusted coupling *(6a-iii)*, no proximity spike *(6a-ii)* — agree.
**Anti-attrition enrolment is not conversation-driven. The free-text `notes` box on the enrolment
record is the only justification that exists**, and the corroboration layer cannot supply a second
one. That closes the design question; what remains., which is governance, not data.

The complaint check ships for salary dispute (and the §4 types that behave like it) and is **N_A for
anti-attrition** — not AMBER, not "absent evidence". Testing it there would score noise.

## 3h. The band-3 queue, and two defects the run exposed

**Sizing, with the §3f 14-day exclusion applied:**

| Payment type | Band 3 notes | AED | Avg complaints present | No enrolment record |
|---|---:|---:|---:|---:|
| Anti-attrition Incentive | 1,001 | 228,115 | 8.5 | **1** |
| Salary Dispute | 141 | 49,865 | 14.1 | *n/a* |

🔴 **The B1 enrolment check is essentially clean: 1 note out of 1,001.** The enrolment record almost
always exists. That sharpens §3 rather than softening it — the failure is not that anti-attrition
payments bypass the enrolment step, it is that **the step records its reason in a free-text box and
nothing validates it**. A control that always fires is not evidence that the thing it guards is
sound. Job 1 (read the `notes` box) is therefore the whole of the anti-attrition check, not a
supplement to a structural test.

*(The enrolment lookup is unbounded in time and the `ACTION_TYPE ILIKE '%Incentive%Experiment%'`
picklist name is still unconfirmed, so "has an enrolment record" is a weak pass. `ENROLLED_AFTER_PAYMENT`
is now checked too — an enrolment dated after the payment it justifies would be a hard RED.)*

**§3f's edge artifact was bigger than estimated.** Band 3 for anti-attrition falls from 1,484 to
1,001 once notes newer than 14 days are excluded — a **33% drop from removing ~15% of notes**, so
recent notes were roughly twice as likely to land in band 3. The truncated-forward-window warning was
right and under-stated; the exclusion is mandatory, not hygiene.

### Defect 1 — an unwindowed second join *(mine)*

The queue's final SELECT joined `COMPLAINTS` a second time on `HOUSEMAID_ID` alone, with no date
predicate, so the complaint-type list showed each maid's **entire history** while the counts beside it
were windowed. The symptom was visible in the output: notes reading `complaints_any = 1` alongside six
listed complaint types, and band-3 rows displaying `Maid Wants To Resign` — a type that by definition
cannot be in that note's window. A reviewer would have read a two-year-old complaint as context for
this month's payment.

Fixed by moving the `LISTAGG` into the CTE that already holds the windowed join, so the list and the
counts cannot drift apart. **General rule: a display column and the count that qualifies it must come
from the same join, or they will disagree and the display will win the reader.**

### Defect 2 — a query delivered as fragments to assemble

The queue was handed over as *"paste the block above, then swap the final SELECT"*. What came back
contained Airfare Ticket, MV Prorated Salary, Raffle Prize and Bonus — payment types the `n` CTE
excludes. The scope filter did not survive the assembly step, and because the output still looked
plausible, nothing announced the loss.

Hard rule 8 already says every query goes to Moe as a complete copy-paste block. **The rule now
extends to fragments: no "reuse the CTEs from above".** A query whose correctness depends on the
reader stitching two blocks together has moved the scope filter into the handover, which is the one
place neither the code nor the review can see it. 6b is now self-contained and carries a
`-- <<< do not drop` marker on the filter.

## 3i. What the corrected band-3 queue actually surfaced

The re-run is clean — every row is one of the two payment types, and no note lists more complaint
types than its own windowed count. Four observations, in descending order of value.

### 🔴 `ENROLLED_AFTER_PAYMENT` fired on its first run

**Note 184233, maid 97470, 2026-07-17, AED 900** — the enrolment record post-dates the payment it is
supposed to justify. One case in the top 300, and the check that caught it did not exist two hours
ago: the unbounded enrolment lookup treated "has an enrolment record ever" as a pass, so this read as
`enrolled` before. **It is a hard RED on code**, not a heuristic — the job cannot pay against an
enrolment that had not yet happened.

Generalises: `EXISTS`-style controls need a temporal predicate. "Has a justifying record" and "had a
justifying record *at the time*" are different tests, and only the second one is a control.

### 🔴 Two payments to one maid inside one calendar month, and one of them off-batch

**Maid 132742** appears three times: **2026-06-11 (AED 300), 2026-06-30 (AED 300)** and 2026-07-31
(AED 300). Two payments in June. This is the B6 once-per-contract-per-month guard, which
`anti-attrition-cases.sql` flagged as unresolvable without `CONTRACT_ID` — 167 such cases in
twelve months. But this one carries a second signal the review list did not have: **the June 11 note
is off-batch**, so it did not come from the month-end job at all. A hand-added payment landing in the
same month as the batch payment is a much stronger candidate than either signal alone.

### The month-end batch is visible at row level

Anti-attrition note dates in the queue are almost entirely **2026-06-30** and **2026-07-31**. The
exceptions — 2026-06-11, 07-04, 07-06, 08-02, 08-07, 08-12 — are the hand-added notes that bypassed
`MaidIncentiveExperimentJob` entirely (156 in twelve months, AED 37,576). **This is §3c's month-end
batch confirmed at the individual note, not inferred from an average**, and it is why the 30.8-day
complaint coupling was mechanical. The off-batch subset is small, human-entered, and unguarded by the
job's own checks — the highest-value slice of the anti-attrition queue.

### 🔴 Anti-attrition amounts carry two different mechanisms

Most amounts are tier-like: 300, 350, 400, 500. But the queue also contains non-round values that are
**exact daily fractions of a round monthly figure, divided by the actual length of that month**:

| Amount | × days | Monthly figure |
|---:|---|---:|
| 373.33 | × 30 | 11,200 |
| 361.29 | × 31 | **11,200** |
| 338.33 | × 30 | 10,150 |
| 322.58 | × 31 | 10,000 |

**373.33 and 361.29 are the same 11,200 divided by June's 30 days and July's 31.** That is not a
tier and not a coincidence — it is a day-based computation. **6d sizes it.**

## 3j. 🔴 Correction: the amounts are prorated, NOT a second payment type

6d came back and **retracts my salary-scale reading of §3i.** The arithmetic was right; the
interpretation was not.

| Shape | Notes | % | AED | % | Median implied | Maids |
|---|---:|---:|---:|---:|---:|---:|
| 1_TIER_round | 6,144 | 67.0% | 1,515,100 | 82.8% | 6,200 | 1,455 |
| 2_DAY_PRORATED | 2,725 | 29.7% | 274,379 | 15.0% | **2,400** | 1,784 |
| 3_UNEXPLAINED | 298 | 3.3% | 40,256 | 2.2% | 3,437 | 281 |

**The buckets reconcile exactly: 9,167 notes and AED 1,829,735** — the known population and the known
AED 1.83m, to the note and to the dirham. The classification is exhaustive and loses nothing.

**Where I went wrong.** `implied_monthly = AMOUNT × days_in_month` only recovers a *monthly* figure if
the note represents one day. If a note is instead `tier × days_enrolled ÷ days_in_month` — ordinary
proration — the same arithmetic recovers `tier × days_enrolled`, which is not a monthly anything. The
median of 2,400 is a 200–400 tier over 6–12 days, squarely **incentive-scale**. It is not the
10,000–11,200 salary-scale figure I inferred from two hand-picked rows, and the tier bucket's own
median implies a ~200 tier, well below the 300–500 range I assumed from the queue sample.

**So there is one mechanism with proration, not two mechanisms sharing a reason.** §3i's
"day of salary filed under the anti-attrition reason" is withdrawn, and with it the claim that the
type must be split before B4/B5 can be written. Two rows are an anecdote; 9,167 are the distribution.

### What survives, and it is still a spec change

**30% of anti-attrition notes are prorated (AED 274,379).** B4/B5 therefore cannot be written as
`AMOUNT = tier` — it must be `AMOUNT = tier × days_enrolled ÷ days_in_month`, which needs the
enrolment and exit dates, not just `INCENTIVE_AMOUNT`. an outstanding ask as scoped would not have been enough to
write the check, and that gap was invisible while the type looked like a flat tier table.

### Two things 6d surfaced that nobody was looking for

🔴 **`MIN_AMT = 0` in the tier bucket. Anti-attrition notes worth AED 0 exist.** A payment record for
nothing is either a data defect or a cancelled payment left standing in the ledger, and either way it
inflates every note count in this audit — including the 9,167 denominator all the lift figures rest
on. Cheap to size, and it should be sized before anything else here is quoted.

**Tiers run to 900, not 500.** My 300–500 reading came from the visible slice of a 300-row queue. The
real ceiling is nearly double, so any allowed-amount list built from the sample would have flagged
legitimate payments.

**The 298 unexplained notes (AED 40,256) are the genuinely anomalous set** — they fit neither a
multiple of 50 nor any day-fraction of one. Small enough to review by hand, and now the only part of
the anti-attrition amount space with no explanation at all.

## 3k. 🔴 The "unexplained" amounts are prorated over 31 — and only the hand-added ones are

6e part B lists the 20 commonest amounts 6d could not classify. **Every one of them is an exact
`/31` fraction of a round figure, and none of them is a `/30` fraction — in notes that sit in
30-day months.**

| Amount | × 31 | × 30 |
|---:|---:|---:|
| 25.81 | **800** | 774.30 |
| 19.35 | **600** | 580.50 |
| 64.52 | **2,000** | 1,935.60 |
| 32.26 | **1,000** | 967.80 |
| 12.90 | **400** | 387.00 |
| 261.29 | **8,100** | 7,838.70 |

20 of 20 resolve over 31; 0 of 20 over 30.

**So my 6d classifier was wrong, not the data.** It divided by `DAY(LAST_DAY(NOTE_DATE))` — the
note's own month — on the assumption that proration follows the calendar. These notes prorate over a
**fixed 31 regardless of the month they fall in**, so every one landed in `3_UNEXPLAINED` by
construction. The true prorated share is therefore higher than 6d's 29.7%, and `3_UNEXPLAINED` is
mostly not unexplained at all. *(§3j's headline — one mechanism, not two — is unaffected: these are
still prorated incentives, not a second payment type.)*

### The part that is a finding: two proration rules, split by who created the note

**`ON_BATCH_DATE = 0` for all 20.** Every amount in the unexplained tail was created off the
month-end batch date — hand-added, bypassing `MaidIncentiveExperimentJob`. Meanwhile the prorated
amounts seen *on* batch dates divide by the calendar: note 183010, **373.33 on 2026-06-30**, is
11,200/**30** — June's actual length.

| Origin | Divisor | Example |
|---|---|---|
| Month-end batch (the job) | the month's real length | 373.33 = 11,200/30 on a June note |
| Hand-added, off-batch | **fixed 31** | 25.81 = 800/31 in a 30-day month |

**One payment type, two proration rules, and which one applies depends on whether a human or the job
created the record.** In a 30-day month the hand rule yields ~3.2% less per day than the job's. That
is small per note and systematic across 298+ notes, and — more importantly — it means **there is no
single correct recompute for B4/B5**. A check written against either rule reports the other as a
finding.

This also converges with a number already in the file: the unexplained bucket is 298 notes / AED
40,256, against `anti-attrition-cases.sql`'s hand-added population of 156 notes / AED 37,576. Close
enough on money to suggest substantially the same set, reached from two unrelated directions —
**amount shape and note date independently identify the hand-added payments.**

🔴 **The audit question is not the 3.2%.** It is that a hand-entered payment is being computed by a
rule the job does not use, on a payment type whose enrolment justification is already a free-text box
(§3). The arithmetic discrepancy is the visible edge of an unguarded manual path.

**6f settles the split across all 9,167 notes** rather than 20, restricted to 30-day months where the
two divisors actually differ.

## 3l. 🔴 Retraction: `NOTE_DATE = LAST_DAY(NOTE_DATE)` never matches, so §3k's origin claim is void

6f returned **no `on_batch` rows at all** — every one of the 3,728 anti-attrition notes in 30-day
months classified as `off_batch`. That is impossible on its face: the band-3 queue is full of notes
dated **2026-06-30**, June has 30 days, so those are month-end notes and belong in this population.

**`NOTE_DATE` carries a time component.** `LAST_DAY` returns a DATE at midnight, so
`NOTE_DATE = LAST_DAY(NOTE_DATE)` compares `2026-06-30 08:15:00` against `2026-06-30 00:00:00` and is
false for every row. The predicate could not return true, and a filter that can never fire returns
a clean, plausible, entirely meaningless split.

**§3k's central claim is therefore withdrawn.** "Only hand-added notes prorate over 31" was read off
`ON_BATCH_DATE = 0` in 6e part B — the same broken comparison. It never showed that those 20 amounts
were hand-added; it showed that the comparison was false, which it always is. The convergence I drew
with `anti-attrition-cases.sql`'s 156 hand-added notes goes with it: two numbers of similar size,
one of which was measuring nothing.

This is trap #2 in the plugin's own catalogue — **an assertion that cannot fail** — arriving as a
*classifier* rather than as a test, where nothing looks wrong because the output is well-formed.
**Checked the blast radius: the other files are clean.** `anti-attrition-cases.sql` and
`live-types-deep-profile.sql` both cast `NOTE_DATE::DATE` before comparing, and the former defines
batch days *empirically* — `GROUP BY NOTE_DATE::DATE HAVING COUNT(*) > 100` — rather than assuming
month-end at all. That is the better idiom and it is what 6g adopts: the job's run days are a fact in
the data, not something to infer from the calendar. **The 156-note hand-added figure stands.**

### What actually survives, and it is still the interesting half

The shape distribution does not depend on the origin split, so it stands:

| Shape | Notes | AED | % |
|---|---:|---:|---:|
| 1_flat_tier | 2,563 | 636,900 | 68.8% |
| 3_over_month_length | 896 | 90,562 | 24.0% |
| 2_over_31 | 250 | 28,431 | 6.7% |
| 4_still_unexplained | 15 | 3,153 | 0.4% |
| 0_zero | 4 | 0 | 0.1% |

**In 30-day months, both divisors are in live use: 896 notes prorate over the calendar month and 250
over a fixed 31.** One payment type, two proration rules — that part of §3k is confirmed on 3,728
notes and does not rest on the broken predicate. What is *unproven* is the attribution: whether the
divisor tracks batch-vs-manual origin, or something else entirely. 6g re-tests it with a working
comparison.

**And the classifier now explains 99.5%** — 15 notes and AED 3,153 fit no rule at all, down from the
298 that made §3i call this a second mechanism. The amount space of anti-attrition is essentially
solved: a tier table, two proration divisors, and a 15-note tail.

### The zeros, sized: immaterial

**14 zero-amount notes out of 9,167 — 0.15%, AED 0 total, across 12 maids**, spanning 2025-11-06 to
2026-09-01. Plus 131 notes under AED 10 (1.4%).

I flagged these as needing sizing *before* any rate in this document could be quoted, on the grounds
that they inflate the 9,167 denominator. **That was overcautious and I was wrong about the risk:** at
0.15% they move no figure here — the 1.00× chance rate, the 87% coverage, the band percentages all
stand unchanged. They remain a small data-quality item worth a line in the spec (a payment record for
nothing is either a defect or a cancelled payment left standing), not a blocker on anything.

## 3m. 6g settles it: the divisors are both the job's — the manual path fails differently

| Origin | Notes | flat tier | /31 | /month length | **fits no rule** |
|---|---:|---:|---:|---:|---:|
| on_batch | 3,677 | 2,538 | **247** | **890** | **0 — 0.0%** |
| off_batch | 51 | 25 | 3 | 6 | **15 — 29%** |

**§3k is dead, properly this time.** Both divisors appear *inside the batch* — 247 notes over 31 and
890 over the month length, all job-created. The divisor was never manual-vs-job. The likely
explanation is that it tracks **the length of the period being paid for, not the month the note lands
in**: a job running at month end in arrears will divide a May period by 31 while writing a June note.
My classifier used the note's month as the reference and mislabelled the difference twice.

### The finding, arrived at properly

**The job's amounts always resolve: 0 of 3,677 fit no rule. Hand-added amounts often don't: 15 of 51,
29%.** That is the manual-path signal §3k reached for and got wrong — not a different divisor, but
**no derivable rule at all**. A human types a number; the job computes one. 29% versus 0.0% across
3,728 notes is about as clean as a contrast gets in this data.

### Three things the batch-day list gave away for free

**The empirical definition reproduces the known figure exactly.** 9,011 notes on the 12 batch days,
9,167 total, leaves **156 off-batch — the identical count `anti-attrition-cases.sql` reached by a
different route.** Two independent methods, the same number to the note.

🔴 **August's batch ran on 2026-09-01, not 2026-08-31.** So even the *corrected* `LAST_DAY` comparison
would have misfiled all 918 notes of the largest batch in the series. The empirical definition was
not tidier — it was necessary. **Any check anywhere in this audit that assumes the job runs on the
last calendar day is wrong for at least one month in twelve.**

**The programme is growing fast: 409 notes on the first batch, 918 on the last — +124% in a year**,
rising every single month without exception. §3i's "run-rate up ~36%" was measured on money and
understated it. Whatever an outstanding ask decides about governance, it decides it for a payment type that has
doubled in twelve months.

## 3n. 🔴 The check: 0 of 9,011 job payments fail it, 35 of 156 hand-added ones do

| Origin | Notes | Amount fits no derivable rule | AED |
|---|---:|---:|---:|
| Created by the job | **9,011** | **0 — 0.0%** | 0 |
| Hand-added | 156 | **35 — 22.4%** | **8,675** of 37,576 |

**The control group is perfect.** Across 9,011 machine-created payments spanning twelve monthly
batches, **not one** amount fails a rule set of *multiple of 50, or a /28 /29 /30 /31 fraction of
one*. That zero is what makes the 22.4% mean anything: the test is not merely generous in principle,
it is demonstrably satisfiable by every payment the system computes for itself. The rule set is
complete.

**And it reconciles twice.** 9,011 + 156 = 9,167, the known population. The hand-added total of
**AED 37,576 matches `anti-attrition-cases.sql` exactly** — a figure reached months earlier by a
different route, on a different definition of "off batch", now confirmed by observed batch days.

### Why this is the best check in the anti-attrition file

Everything else here needs a judgement. The complaint test is N_A (§3g). The enrolment test passes
almost always (§3h). The recompute check cannot be written yet. **This one needs no judgement
at all**: the payment system defines correct behaviour by exhibiting it 9,011 times, and 35 payments
do something it never does.

It is small money — AED 8,675 — and that is not the point. **A control that the automated path
satisfies 100% of the time and the manual path violates 22% of the time is a finding about the
control, not about the amount.** It says the manual path is unguarded, on the payment type whose
enrolment justification is already a free-text box (§3) and whose volume has doubled in a year (§3m).

### The scope note that matters

35 notes is a hand-reviewable queue, and each one carries `requester` / `approver`, so
**segregation-of-duties composes with it**: a hand-typed unexplainable amount requested and approved
by the same person is the strongest single combination available anywhere in this dataset. That
intersection is the first thing to read off 6h part B.

## 3o. 🔴 Reading the 35: the check detects HAND-TYPED, not WRONG. an outstanding ask withdrawn.

The list is 33 whole integers plus two one-decimal values. **The job writes two-decimal computed
values; a person types whole dirhams.** A test with a 0.2 tolerance on `amount × d` therefore flags
rounded entry by construction — which is exactly and only what it did.

**Can the amounts be reconciled if whole-dirham rounding is allowed?** Rounding by up to 0.5 moves
`amount × 31` by up to 15.5, so widen the tolerance to `0.5 × d` and **34 of 35 fit**. Which sounds
like an exoneration and is not:

| Divisor | Share of arbitrary amounts the widened test accepts |
|---|---:|
| /28 | 56% |
| /29 | 58% |
| /30 | 60% |
| /31 | 62% |
| **any of the four** | **97.2%** |

**The widened test's chance pass rate is 97.2%. The observed rate is 97.1%.** It accepts almost any
number, so it is worth nothing in either direction — the same trap §3g caught on the complaint
window, arriving here in the exculpatory direction. I cannot conclude from it that the 35 amounts are
correct, and I will not.

### What is actually established

**The strict test separates machine precision from human precision. It does not test correctness.**
0 of 9,011 job notes fail because the job emits exact two-decimal values; 35 hand-added notes fail
because a person rounded. Whether any of those 35 is the *right* amount cannot be decided from the
amount alone — it needs the tier and the days, which.

**So an outstanding ask is withdrawn.** Shipped as a spec check it would report 35 payments as findings on the
evidence that a human typed them, which the note date already says more directly and without the
arithmetic. It fails the plugin's own check #1: a signal that cannot distinguish a defect from a
data-entry convention is not a finding.

### The two real findings in the list, neither of which is about amounts

🔴 **A single approver.** 34 of the 35 hand-added payments carry the same approver; one carries a
different one. Whatever the batch job does automatically, the entire manual path for this payment
type funnels through one person's approval. On a payment type whose justification is a free-text box
(§3), that is the control question — and it was visible only because the queue happened to carry the
column.

🔴 **The approver name is stored in two forms — a short form and a full name — and S1 compares them
as strings.** One row here self-approves and is caught only because both sides happen to use the
identical full form. **Any self-approval recorded with mismatched name forms passes S1 silently.**
That is a live defect in a check already written into `phase1-verification.sql`, and it under-reports
in the safe-looking direction. S1 needs an identity key, or normalisation, before its output means
anything.

*(One amount, AED 801, fits no divisor even with rounding allowed — the only arithmetic outlier in
the set. Since 2.8% of arbitrary amounts fail by chance, one in 35 is exactly expected. Not evidence
of anything on its own.)*

## 3p. S1's diagnostic: 58% of additions were never approved by anyone

1c, across all 44,169 addition notes:

| | Notes | Share |
|---|---:|---:|
| **No approver recorded** | **25,855** | **58.5%** |
| No requester recorded | 24,618 | 55.7% |
| Have an approver | 18,314 | 41.5% |
| — of those, approver is a bare first name | **7,804** | **42.6% of approvals** |

171 distinct requesters, 65 distinct approvers, 24 of those a bare first name. Approval concentrates
about 2.6× relative to raising.

🔴 **The headline is not the name forms — it is that most additions carry no approver at all.**
Machine-generated types have a null approver by design and belong outside S1's scope, so the honest
figure is the per-type breakdown S1 proper returns, not this 58.5%. But 58.5% is large enough that
**the segregation question is secondary to an approval-existence question** nobody has asked yet: a
payment nobody approved cannot fail a segregation test, and the old S1 counted it under
`raised_never_approved` while the headline metric stayed self-approval.

**43% of the approvals that do exist carry a bare first name.** That is the scale of the identity
problem §3o found in one 35-row sample, confirmed across the whole table.

### 🔴 My first fix over-corrected, and that is its own trap

The rewrite blocked *every* single-token approver — all 7,804. That is wrong in the opposite
direction to the bug it fixed. **If the bare name does not match the requester's first name, they are
different people under every reading of it**: "Manale" approving a request raised by "Gurmu Ejeta" is
segregated whichever Manale it is. Ambiguity only bites where the names *do* match.

Blocking 43% of approvals would have buried the real findings under a wall of unresolvable rows and
inflated the same denominator the original bug deflated. **Over-blocking is not the safe direction.**
It is the same defect — a verdict that does not reflect what the evidence supports — wearing the
opposite sign, and it is more insidious because it feels conservative.

The narrowed rule blocks in exactly one place: the approver's name matches the requester's, *and*
several staff share that first name, so it cannot be called either way. Everything else resolves.

## 3q. 🔴 an outstanding ask's premise was wrong — and S1 found something far bigger

**`R_self_approved_name_form` returns 0 notes. On every payment type.**

The whole basis of an outstanding ask was that self-approvals were slipping through as mismatched name forms
("manale" approving "manale hamasny"). They are not. The one self-approval in §3o's 35-row sample
used the identical full form on both sides, and the bare short form only ever appears approving
*other* people's requests — which is correctly segregated. **I generalised a mechanism from a single
row and it was not there.** The old `LOWER(a) = LOWER(b)` was not under-reporting this way, and its
self-approval count was not the floor I claimed.

What the rewrite did buy is the verdict algebra, and that immediately showed the real problem is not
segregation at all:

| Verdict | Notes | % | AED |
|---|---:|---:|---:|
| **B_neither_recorded** | **7,147** | **45.3%** | **2,864,088** |
| G_segregated | 6,309 | 39.9% | 2,504,847 |
| R_self_approved_exact | 1,170 | 7.4% | 244,730 |
| R_raised_never_approved | 1,165 | 7.4% | 129,990 |
| B_same_first_name_unresolvable | 2 | 0.0% | 750 |
| *R_self_approved_name_form* | *0* | — | — |

🔴 **AED 2.86m of human-type additions carry neither a requester nor an approver.** 45% of the notes
in S1's scope have no attribution whatsoever. That is larger than every other finding in this file
combined, and it is not a segregation problem — **you cannot ask whether the same person did both
when the record names nobody at all.**

**Self-approval is also bigger than S1's own header claimed.** That header advertises "the AED 8,800
salary dispute". The actual output is **1,170 notes and AED 244,730**, twenty-eight times that in
money. The check was working; nobody had read its total.

**Two types are extreme:** Medical Assistance is **47% self-approved** (70 of 149) and VIP Bonus
**39%** (54 of 138). Small money, but as rates those are governance questions on their own.

### Two caveats that must travel with these numbers

**S1 has no date filter.** It spans the whole table, while every other figure in this document is a
12-month window. The AED totals here are not comparable with anything in §3 — and a dashboard mixing
them would be wrong. Medical Assistance reads 149 notes here against §3b's 23 in twelve months, which
is the same effect.

**The "human types" list is an assumption, not a measurement.** `Bonus` is partly machine-generated —
the retraction half runs through `DelighterService.handleRetractDelighterWithOneTimeBonus` — so its
58% `B_neither_recorded` may be null attribution *by design* rather than a finding. The same doubt
applies to Salary Dispute's 4,211 unattributed notes: a payment type can be human in the spec and
still have an automated path in production.

**§3m already built the tool to settle this.** Batch days are observable — a day the job ran is a day
with a pile of notes on it. Applying that per payment type separates machine-created from
human-created empirically, instead of trusting a hardcoded list. **Until that runs, `B_neither_recorded`
is a mixture of "nobody recorded who did this" and "no human was involved", and only the first is a
finding.**

## 3r. 🔴 The AED 2.86m is 79% historical — and the missing date filter was the whole story

1d, same definition as S1 but windowed to 12 months:

| | Notes | AED |
|---|---:|---:|
| Unattributed, all time (S1) | 7,147 | 2,864,088 |
| **Unattributed, last 12 months (1d)** | **862** | **613,759** |
| | **88% older** | **79% older** |

**Eight of the ten payment types have ZERO unattributed notes in the last twelve months.** Taxi
Reimbursement, Medical Assistance, VIP Bonus, Accommodation Relocation, MOHRE, Maids.at, Passport and
Lost Luggage all carry a requester or an approver on every recent note. Only Bonus (850) and Salary
Dispute (12) still produce any.

🔴 **Salary Dispute — which I called the audit's biggest open question one section ago — is 12 notes
and AED 3,484 in twelve months**, against 4,211 notes and AED 1.29m all-time. It collapses entirely.
**Attribution was fixed at some point, and S1 has been reporting a legacy backlog as a live control
failure.**

**The missing date filter was not a comparability nit.** I logged an outstanding ask as a tidiness item — "these
must not appear on one dashboard". It was inflating the headline number **4.7×** and pointing the
audit at a problem that has largely stopped. A metric with no time window does not merely mislead on
scale; it misidentifies which findings are still happening, which is the only thing that determines
whether anyone can act on them.

### The one live block, and the test cannot settle it

Bonus is the only type still generating unattributed notes at volume — 850 in twelve months,
AED 610,275, 71% of the type.

| Bonus | Active days | Busiest day | Top-12 days | Notes/active day |
|---|---:|---:|---:|---:|
| attributed *(known human)* | 115 | 7% | 46% | 3.1 |
| unattributed | 272 | 3% | **25%** | 3.1 |

**The unattributed notes are LESS concentrated than the human ones**, spread over 272 days. That
rules out a monthly batch job decisively.

**But it does not prove they are human.** §4 records that the retraction bonus runs through
`DelighterService.handleRetractDelighterWithOneTimeBonus → addExpenseRequestForHousemaid →
ManagerNoteService.processExpenseRequestTodo` — an **event-driven** path that fires whenever a
resignation is retracted, on any day of the year. Event-driven automation spreads exactly like human
work. **My discriminator separates batch from not-batch; it cannot separate event-driven automation
from a person**, and Bonus is precisely the type where that distinction matters, because §4 already
says it has two halves with different origins.

So 1d's verdict for Bonus is **BLOCKED, not GREEN** — and that is the honest reading, not a
disappointing one. Resolving it needs the expense-request link (`EXPENSES_REQUESTS`, D4) or the
un-ingested `DELIGHTER_TODO`, not another concentration statistic.

## 3s. an outstanding ask clears the anti-attrition check; an outstanding ask shows Bonus is BREAKING, not legacy

### 🟢 an outstanding ask — the enrolment box is usable, and the largest payment type has a check after all

`ACTION_TYPE = 'Maid Incentive Experiment'` confirmed (3,755 records, 2,982 maids, since
2024-03-23). Over 12 months, 2,806 enrolment records:

| | |
|---|---:|
| Filled | **100%** — zero empty |
| Distinct values | 2,693 of 2,806 = **96%** |
| Share on the single commonest value | **1%** |
| Median length | 43 chars |
| ≥ 60 chars | 568 (20%) |
| ≤ 10 chars | 43 (1.5%) |

**This is the good outcome and it was not the likely one.** A required free-text field usually
degenerates into boilerplate — 96% distinct and 1% on the commonest value says people are actually
writing something different each time. **Job 1 is viable, so anti-attrition has a working check**
after the complaint test came back N_A, the enrolment-exists test came back 99.9% clean, and the
recompute stayed blocked.

Calibrate expectations: a 43-character median is one short sentence, not a justification. The AI Agent
can categorise a stated reason; it cannot verify one. And 43 records are under 10 characters — a
small junk tail to exclude, not to interpret.

### 🔴 an outstanding ask — I was wrong that "attribution got fixed". It got fixed for two types and broke for Bonus

| Bonus era | Unattributed |
|---|---:|
| 2023-09. 2024-04 | 9 / 412 = **2.2%** |
| 2024-05. 2025-03 | 159 / 649 = **24.5%** |
| 2025-04. 2026-03 | 982 / 1,150 = **85.4%** |
| 2026-04. 2026-09 | 239 / 496 = **48.2%** |

**Bonus attribution did not decay from a legacy state — it broke.** It ran at 2% for the first eight
months, began failing around 2024-05, escalated to a 98% peak in 2025-10, and still runs at 48%.
**This is an active, worsening control failure, not a backlog**, and §3r called it historical because
a 12-month window cannot see a change that happened 28 months ago. *(A time window fixes one error
and hides another; the trend is what separates them.)*

**Taxi Reimbursement: 0 unattributed in all 36 months.** A perfect control, and proof the field can be
populated reliably — which makes Bonus's 48% a choice somewhere in the code, not a platform limit.

🔴 **Salary Dispute's story is a single bulk event.** 542 unattributed across 36 months, of which
**424 fall in 2025-05 alone** (70% of that month, AED 50,381) — in a month carrying 610 notes against
a 100–200 norm. That is a migration or a mass correction run, not day-to-day behaviour. The
remaining ~3,669 of S1's 4,211 predate 2023-09 entirely. So Salary Dispute is: clean now, one
anomalous month to explain, and an old backlog to scope out.

🔴 **A manager note is dated 2026-10 — the future.** One Bonus note falls in a month that has not
happened. Trivial in money, but a future-dated payment record breaks any period-based check that
assumes notes are historical, and nothing in the audit currently rejects it.

## 3t. 🔴 The active-type census: 25 types, not 18 — and it retracts my future-date rule

Enumerating every `REASON` with activity in the last twelve months, rather than trusting either the
live/dead triage or the segregation check's hardcoded list:

**25 types are active · 17,566 notes · AED 7,179,262.** The payment-types page listed 18.

### 🔴 The retraction: "reject future-dated notes" would delete the largest money type

I recommended it twice — as, and as acceptance criterion 19 on the AE ticket. **It is wrong.**

**`Airfare Ticket` spans 34 active months inside a 12-month window, with its last note dated
2028-06-02 — 21 months in the future.** And airfare is **AED 2,733,500, 38.1% of all addition
money: the largest type by money in the entire audit**, ahead of anti-attrition's 25.5%.

A rule that rejects notes dated after the audit month deletes most of it. **That is trap #3 exactly
— a scope filter that removes the evidence the report exists to examine** — and I wrote it into a
ticket as an acceptance criterion, from a sample of one stray `Bonus` note.

The business reading is almost certainly that an airfare note carries the **travel date**, not the
payment date, which is a legitimate pattern and a real problem for M0: a note dated 2028-06 would be
assigned to June 2028's payslip and never appear in any month an auditor works. **The correct rule is
per payment type, and it is a question for payroll, not a filter to write:** for airfare, does the
payslip that pays it correspond to `NOTE_DATE`, or to something else entirely?

### 🔴 Eight notes have no payment type at all

`(none)` — **8 notes, AED 3,900, dated 2026-08-27 to 2026-09-04.** These are live **T2 REDs** (*no
payment type recorded* → F4) sitting in the current month, found by a census query rather than by a
check. They are the first confirmed findings this audit has produced against live data.

### A new payment type appeared last month, and it is the safety property's first live test

**`Abu Dhabi Incentive` — 18 notes, AED 0, every one dated 2026-08-31.** A type that did not exist
before, carrying no money, created in a single batch. Under the spec's safety property an unmapped
type yields an empty check plan and lands **AMBER with a named reason, never a silent green**. This
is the first chance to confirm that holds in production rather than on paper — and the AED 0 makes
it a setup or test batch, which is itself worth a question.

### Corrections to figures already published

| Claim | Corrected |
|---|---|
| "18 active payment types" | **25** |
| "anti-attrition is 59% of notes" | **52.2%** (the denominator was short by 7 types) |
| "AED 6.76m across 12 months" | **AED 7,179,262** — the 6.76m was the 14 live types only |
| "anti-attrition is the largest type" | **by count, yes. By money it is second** — airfare is 38.1% |

Five more types are trivial but real: `Sim card` (3 notes, AED 5), `Transportation Fare
Reimbursement` (2), `MV Extra Salary` (1), `Cash Assistance for Cleaner's other facilities` (1),
`Flight ticket` (1). ⚠️ **`Flight ticket` and `Airfare Ticket` are separate picklist entries.** Two
names for what may be one business event is the N5 routing hazard arriving in the data.

## 3u. 🔴 Map corrections found by reading the cases, 2026-08 run

Three complaint types appeared in band 3 while plainly belonging to the payment they sat under. They
are added to §4's map. **Band 3 was overstated by them, and every band-3 figure published before this
correction is too high.**

| Complaint type | Added to | Why |
|---|---|---|
| `Switch Maid To Live-in` | Accommodation Relocation | The map carried only *Switch Maid To Live-out*. A maid moving **into** accommodation is as much a relocation as one moving out — the omission was a direction, not a decision |
| `Renewal/Resignation Salary Raise` | Salary Dispute | A dispute about a salary raise is a salary dispute |
| `Request bank details & Refund` | Salary Dispute | A refund request is a money dispute by another name |

**Resolve them to ids before use.** The map joins on `COMPLAINT_TYPE_ID`, never the resolved name —
N5's routing hazard applies here exactly as it does to payment types, and a renamed complaint type
would silently drop out of the map.

### 🔴 What was deliberately NOT added

**Four of the seven band-3 Accommodation Relocation cases carry resignation-family complaints**
(`Maid Wants To Resign`, `Maid does not want to work with client`) rather than accommodation ones.
The obvious move is to add those types and watch band 3 shrink. **That would be wrong.**

It would make the map confirm a hypothesis the AI Agent invented — *that relocation is used as a
retention lever* — and the band-3 count would fall for a reason nobody in the business has stated. A
corroboration map that grows every time a case fails it stops being a test. **It stays an open
question for payroll: is moving a maid a retention action?** If the answer is yes, the types go in and
the finding dissolves honestly. If no, these seven are real.

**The general rule this establishes:** add a complaint type to the map when it is *semantically the
same event* under another label, never when adding it would explain away a finding.

## 4. The corroboration map — expected complaint types per payment

Built from the real taxonomy (query 1b, 18-month volumes) and the code's type codes.

| Payment type | Expected complaint types (id · name · volume) | Strength |
|---|---|---|
| **Anti-attrition Incentive** | 24 `Maid Wants To Resign` (5,058) · 154 same name (48) · 137 `Maid doesn't want to work with the client anymore` (3,023) · 38 `Maid does not want to work with client` (2,368) · 88 `Maid does not want to renew with the company` (129) · 426 `Maid Doesn't Want To Renew` (104) · 284 `Refusal to Work (RTW)` (1,586). **Exclude 257 `MV Retention`** | supporting only — the enrolment `notes` is the primary evidence |
| **Bonus** — retraction half | 24 `Maid Wants To Resign` **via `DelighterToDo.rbComplaint`** | **hard FK** |
| **Bonus** — referral half | none. Referrals are never complaints *(code-verified)* | N_A — do not test |
| **Salary Dispute** | 193 `Missing Salary Inquiry` (3,423) · 320 `Salary release request` (3,174) · 322 `Salary Calculation Issue` (363) · 321 `Maid's last salary with the company` (146) · 330 `Loan Waivers & Deduction Corrections` (93) · 77 `Money Disputes` (2,423) · 323 `Manager note Addition not released` (9) · 156/420 overstay fines (220) · **`Renewal/Resignation Salary Raise` and `Request bank details & Refund` (added 2026-09-08, ids to resolve)** | strong — 13% carry an explicit reference |
| **MV Prorated Salary** | **337 `Last MV Salary Disputes` (151)** · 321 `Maid's last salary with the company` (146) | precise — a near-exact semantic match |
| **Taxi Reimbursement** | 238 `Taxi canceled` (9,490) · **243 `Live-out transportation issues` (842)** · 303 `Housemaid Arrival & Transportation Check-Ins` (12,214). Code: the `transportation` **tag** on `ComplaintType` is the single source of truth | strong |
| **Accommodation Relocation** | 397 `Satwa Relocation` (25) · 162 `Complaint About Accommodation` (2,119) · 348 `Live-out Maid Staying in Accommodation` (94) · 280 `Switch Maid To Live-out` (432) · **`Switch Maid To Live-in` (added 2026-09-08, id to resolve)** | strong — and the only check on the unenforced CC live-out rule |
| **Medical Assistance** | 57 `Maid is sick or injured` (20,467) · 270 `Follow up for medical appointment` (1,611) · 493 `Maid Health Issue`. Codes: `Work_Injury_Sickness__c`, `Maid_s_Repeat_Medical__c` | strong |
| **Airfare Ticket** | **336 `Airfare & Vacation Compensation` (35)** · 103 `Vacation Policy` (624) · 177 `Travel assist` (1,018) | weak — it is renewal-driven, not complaint-driven |
| **Maids.at other expenses** | 339 `Maid cash advance` (2,892) · 119 `Maid related question` (90,625) | weak — too generic to test |
| **Raffle · Prorated salary · Forgive Deduction · Office Work · Last Day CC Switch** | none expected — all machine-generated from payroll state | **N_A — never test** |

**The N_A row matters as much as the others.** Requiring a complaint behind a machine-generated
payment would produce thousands of false findings on day one.

## 5. What the AI Agent should actually do

Three jobs, in descending order of value:

**Job 1 — judge the enrolment reason (anti-attrition).** Read `HOUSEMAID_MANAGERACTIONLOGS.NOTES`
and return: does this state a retention reason? Which category (client conflict / salary / homesick /
family / workload / competing offer / none stated)? **Because no categorised field exists, the AI Agent
*creates* the category** — and that categorisation is itself a deliverable the business does not have
today.

**Job 2 — verify the arithmetic reviewers wrote down (salary dispute).** Per note 174632, reviewers
often write the full itemised calculation into the free text. The AI Agent parses it, re-adds it, and
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
to decide which complaints are worth opening — and have the AI Agent read `COMPLAINT_COMMENTS.TEXT`
(already HTML-stripped, `ITERATION`-ordered) plus `COMPLAINT_DESCRIPTION` for anything that becomes a
finding.

There is already an AI-assigned category: `ComplaintService.extractGptComplaintInfo` parses a
structured block (`Last update / Complaint type / Complaint reason / …`) back out of the summary into
a `To-do: <TYPE> – <REASON>` label, configured by `PARAM_GPT_COMPLAINT_EXTRACTION_CONFIG`. Same
caution applies — useful as a prior, not as evidence.

**Not in the warehouse:** WhatsApp transcripts and call recordings live externally, referenced by
`ComplaintExtraDetails.chatId` / `callId` and `ExpertZiwoRecord`. The richest conversation is out of
reach today.

### The privacy boundary, which is a design constraint not a footnote

Complaint text carries personal circumstances — health, family, disputes — about named individuals.
**The AI Agent reads it; the audit never republishes it.** The AI Agent returns a verdict, a category and a
complaint id. Findings cite the id. No free text reaches an export, a dashboard or an inbox.
