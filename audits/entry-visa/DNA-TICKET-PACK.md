# DNA ticket pack — Entry Visa Audit

> **Updated 2026-09-13 (v2).** Four things changed materially since v1 and each moves a number or a
> decision:
> 1. 🔴 **A new finding, F12, is now the largest in the audit** — **AED 1,141,936** of refundable
>    cancellations never claimed, at a **7.7%** claim rate, ≈**602k/yr** and ongoing. It displaces
>    F1's AED 71,229 as Ticket 1's headline.
> 2. 🔴 **F0c is refuted, so the AED 3,454,994 "decision for the Visa team" is gone.** It was never a
>    policy question. The cancellation workflow has a first-class refund step and refunds are
>    observed on that leg in volume. That decision item is **answered and removed**, and the 3.45m is
>    **restated** into three buckets rather than flipped.
> 3. 🔴 **The rejection signal needs a THIRD source.** Coverage rises **55.0% → 85.7%** by adding
>    `Check Entry Visa Immigration Approval` with `ITERATION > 1`. Every rejection-keyed figure in v1
>    was built on a two-source union and under-detects.
> 4. **A second alert is added (Ticket 4)** for the overstay fine buried inside the change-of-status
>    fee — **AED 970,081/yr**, invisible in the ledger, with **40 cases carrying 39% of the cost**.
>
> *Recurring data processes belong with DNA, not with ad hoc Snowflake — which is why every scheduled
> element in this pack is a DNA-built alert rather than a standing query.*

Four tickets. **File pre-split with the blocks link set** — DNA's doctrine is that SQL/model work
always blocks the visual build. Set the issue type yourself on creation; Jira automation re-types new
tickets to "New Request" and the intake bot then corrects it.

| # | Type | Summary | Blocks / blocked by |
|---|---|---|---|
| 1 | `Alert Requests` | Money Lost — Entry Visa Refund Not Claimed | **independent — file first** |
| 2 | `Analytic Engineer Task` | Entry Visa Audit — model the money-out metrics in silver/gold | blocks #3 |
| 3 | `BI Visualization Task` | Entry Visa Audit dashboard | blocked by #2 |
| 4 | `Alert Requests` | Overstay Fine Ageing — change-of-status cases running long | **independent** |
| — | `SnowFlake Access Request` | USAGE on a warehouse for `PAYROLL_AND_MONEY_CONTROL_ROLE` | **escalate separately** |

**Why #1 goes first.** It needs no new model and mirrors DNA-9566, which shipped. The findings are
live and one is getting worse, so an alert delivers value while the model is built.

**Why #4 is separate rather than folded in.** Different fee, different owner, different clock. The
entry-visa refund window is closed or open — monthly is right. An overstay fine **grows at AED 50 a
day**, so its alert has to be weekly or it is reporting history.

🚧 **File the access request separately and first.** `PAYROLL_AND_MONEY_CONTROL_ROLE` holds SELECT on
the views but **USAGE on no warehouse at all** (`SHOW GRANTS` returns zero warehouse grants), so no
agent or analyst on that role can verify a single figure in this pack without a human running the SQL
by hand. Access requests gate everyone else's verification and should never queue behind a model
ticket. One line: `GRANT USAGE ON WAREHOUSE MONEY_CONTROL_WH TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;`

**Deliberate divergence from DNA-9566:** that alert outputs maid name and nationality. This one
outputs **ids only**. Entry-visa findings attach to staff actions as well as maids — F9 localises to
a single operator — so a name-free output is the safer default and avoids naming anyone in a report
framed around error. Ids are sufficient for the Visa team to look a case up.

---
---

# TICKET 1 — `Alert Requests`

**Summary:** `Money Lost — Entry Visa Refund Not Claimed`
**Priority:** suggest Urgent for the refund families; DNA-9566 shipped at Not Urgent and the queue is
the real constraint — see the note at the end of this pack.

## 1. Alert Name

**Money Lost — Entry Visa Refund Not Claimed**

## 2. What this alert does

When we apply for a maid's entry visa the government keeps a flat **AED 283** and returns the rest if
the application does not complete. The refund is a service we must **apply for** — GDRFA's "Fees and
Guarantee Refund Service" — not an automatic reversal. This alert lists entry-visa fees we paid,
where the visa was never used and **no refund was ever recorded on either the visa request or its
cancellation request**, priced at what the government would have returned.

🔴 **The largest population is cancellations, not rejections.** Where a request that paid for an entry
visa is **cancelled before the visa is consumed**, the fee is reclaimable — and we know it is
reclaimable because **245 such claims were successfully made**. In the same window **2,950 were not**:

> **AED 1,141,936 recoverable · 2,950 of 3,195 cancellations · claim rate 7.7% · ≈ AED 602,000/yr**

**Nineteen in twenty refundable cancellations are never claimed.** This is not a policy question and
does not need one answered: the claims are observed in the same population, same leg, same period.

It also flags four adjacent errors on the same ledger: refunds claimed at the **wrong band**, refunds
received that **exceed what we paid**, charges booked at a **refund value** (a refund entered as a
cost, which doubles the damage), and charges attached to **no case and no person**.

## 3. Action to be Taken

* **Cancellation refund never claimed** *(the big one — 2,950 cases)* — file the claim with GDRFA.
  **Claims cluster on the expensive visa and get skipped on the cheap one**: claimed cancellations
  average **AED 850** of charge, unclaimed **AED 669**. The AED 372.50 inside-country visa is the one
  nobody bothers to reclaim, and that is the operational lever — not a per-case chase.
* **Refund never claimed (rejection channel)** — file the claim with GDRFA if still possible; if it is
  not, record why, so the case stops recurring in the report.
* **Short refund** (claimed at the small band's value against a large-band charge, AED 650 out each
  time) — re-claim the difference.
* **Over-refund** (we received AED 367 more than we paid) — **treat as a liability**, confirm with
  GDRFA before spending it.
* **Charge booked at a refund value** — correct the ledger entry, and **review with that operator's
  manager**: every case traces to one user account and the rate rose ~6× between 2025 and 2026.
* **Charge with no request** — accounting to identify and reattach or write off.

## 4. Source and filters (exact)

| Purpose | Table | Filter |
|---|---|---|
| Entry-visa charges | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')`, `REQUEST_TYPE='NewRequest'`, `STATUS='Added'` |
| Refunds | same | `PURPOSE='REFUND_FOR_ENTRY_VISA'`, `STATUS='Added'`, **either leg** |
| New↔Cancel bridge | `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` | `NEW_REQUEST_ID` — the stored FK |
| Rejection, dated | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | `ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1` **and** value `= 'Rejected'` |
| Rejection, current | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | `ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'` |
| **Rejection, third source** | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS` | `TASK_NAME='Check Entry Visa Immigration Approval'` **and `ITERATION > 1`** — a request sent back into the step |
| Consumption test (F12 guard G7) | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | `RVISA_ISSUANCE_DATE IS NULL` = entry visa never consumed |
| Cancellation date | `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` | `CREATION_DATE`, and `>= '2024-10-19'` for F12 (guard G8) |

🔴 **Nine traps. Each returns a plausible wrong answer rather than an error, and eight were hit during
this spec's own development.**

1. **`ENTRY_VSIA` is a misspelling and it is the live enum value.** `ENTRY_VISA` returns zero rows
   and reads like a scoping decision. 57,396 rows sit behind the typo.
2. **Do not add `IS_DELETED = '0'`.** The column's own profiled comment says it holds `'0'`; it does
   not. The predicate matched **0 of 625,941 rows** and silently emptied an entire query battery.
3. **`*_MODIFIED` is `NUMBER(18,5)` and never NULL.** `IS NOT NULL` is a no-op that reads
   carried-forward state rows as change events. Filter `= 1`. Its own comment claims VARCHAR and is
   wrong — trust `SHOW COLUMNS`.
4. 🔴 **Cancel-leg ids are a different namespace and the ranges overlap.**
   `VISAREQUESTEXPENSES.VISA_REQUEST_ID` on a `CancelRequest` row is a **cancel-request** id
   (2,161–94,464). Joining it to an initial request matches silently and wrongly. **Bridge through
   `CANCEL_VISA_REQUESTS.NEW_REQUEST_ID`.** This mis-join inflated a finding from 17 to 26 before it
   was caught.
5. 🔴 **Read rejection from THREE sources, not two.** History 672 requests, live column 508, union
   868 — and **that union still only explains 55.0% of refunds**. Adding
   `Check Entry Visa Immigration Approval` with **`ITERATION > 1`** (a request sent back into the
   step) takes coverage to **85.7%**, and it has no history floor: it reaches back to **2019-04-03**
   against the approval field's **2025-09-05**. A two-source union under-detects rejection, which
   inflates every duplicate finding that uses rejection as a justifying event.
   Live-only cases remain *rejected but undated* — testable for refund existence, **not** for timing.
6. **`AMOUNT` is `FLOAT`** (max 19,711,606,003,430). Cast to `NUMBER(18,2)` before grouping, banding
   or summing.
7. 🔴 **A refund only counts as a cancellation claim if it POSTDATES the cancellation.** Entry visas
   are routinely refunded **mid-journey** during the rejection cycle, months before an unrelated
   end-of-contract cancellation. Counting any refund on the request credits those as claims:
   **377 of 441 apparent claims were not claims**, understating the finding by **17%** and
   overstating the claim rate by nearly 3×.
8. 🔴 **Key on the expense, never the workflow task.** `Refund Entry Visa Application` exists on both
   legs but is the **minority path** — 441 refunds booked without it against 216 with it. A
   task-keyed measure undercounts refunds by roughly two thirds.
9. 🔴 **`RVISA_ISSUANCE_DATE IS NOT NULL` does not mean "this charge's visa was consumed".** It is the
   request's *final* outcome, and a request survives a mid-journey refund and continues. Use it only
   as the F12 guard (unconsumed ⇒ claimable); never read a populated value as proof the specific fee
   was used. Adjudicated on 178 cases: 169 had the residence visa issued **after** the refund.

## 5. Trigger / Schedule

**Monthly**, after month close. **Not daily** — a refund arrives within 7 days or not at all (547 of
556 measured), so daily re-listing produces noise, not urgency.

**Four hard floors. Before each, absence of a finding is absence of *recording*, and rows must be
excluded rather than shown clean.**

| From | Why |
|---|---|
| **2019-04-02** | Workflow step history begins. 100% of 2017 and 2018 charges have none |
| **2024-02-06** | First refund row in existence. No refund-recovery test can run before it |
| **2025-09-05** | Dated rejections begin **in the approval field**. The task signal (trap 5) reaches back to 2019-04-03 and should be preferred wherever timing is not required |
| **2024-10-19** | `Refund Entry Visa Application` first appears on the cancellation workflow. `EV-F12` is BLOCKED, never RED, before this — guard **G8** |
| **2026-06-10** | Missing-expense detector's first row |

## 6. Query

Full runnable SQL is attached as `DNA_ATTACHMENT_alert_query.sql`, built from
`ENTRY-VISA-DISCOVERY.sql` R1c (unclaimed), R1b (band variance), R5 (refund-value charges) and Q0
(orphans), unioned to one output with a `FINDING_TYPE` column. It is not inlined here because the
five CTEs exceed a readable description; the attachment is marked *Start here*.

## 7. Output Columns

| Column | What it is |
|---|---|
| `FINDING_TYPE` | **`CANCELLATION_REFUND_NOT_CLAIMED`** · `REFUND_NEVER_CLAIMED` · `SHORT_REFUND` · `OVER_REFUND` · `CHARGE_AT_REFUND_VALUE` · `CHARGE_WITH_NO_REQUEST` |
| `CANCELLED_AT` | Cancellation date. Blank outside the F12 population |
| `VISA_CONSUMED` | G7 — `RVISA_ISSUANCE_DATE IS NOT NULL`. A true value makes the row `NOT_APPLICABLE`, never RED |
| `VISA_REQUEST_ID` | Initial visa request. Blank on orphan charges |
| `OWNER_ID` / `OWNER_TYPE` | The person, and whether housemaid or office staff. **No names** |
| `CONTRACT_TYPE` | `CC` / `MV`, trimmed |
| `CHARGE_DATE`, `CHARGE_AED` | What we paid, and when |
| `REFUND_AED` | What came back, blank where nothing did |
| `EXPECTED_REFUND_AED` | `charge − 283.00 − surcharge` |
| `VARIANCE_AED` | Recoverable (negative) or liability (positive) |
| `REJECTION_SOURCE` | `dated_history` · `live_column_undated` · `none` — decides whether timing is testable |
| `DAYS_SINCE_REJECTION` | Blank when the rejection is undated |

## 8. Report body

The report lists entry-visa fees the company paid where the money should have come back and did not.
For each case it shows the visa request, the person's id, what we paid, what the government would
have returned, and whether anyone ever opened a refund claim.

Most cases are simple: the application was rejected, nobody filed for the refund, and the window has
closed. A smaller group is stranger — the refund was claimed at the wrong amount, or more money came
back than we ever paid, which may have to be returned.

What to do: file the claims that can still be filed, and for the rest record why not, so they stop
appearing. The wrong-amount cases need one operator's work reviewed rather than case-by-case fixes.

## 9. Recipients

**To be confirmed by the requester before filing.** Suggested, following DNA-9566's pattern: monthly
on the 1st at 7 PM Dubai time → the Visa/Policing owner and the P&C lead. No daily or weekly cadence,
for the reason in §5.

---
---

# TICKET 2 — `Analytic Engineer Task`

**Summary:** `Entry Visa Audit — model the money-out metrics in silver/gold`
**Blocks:** Ticket 3. **BusinessOwner:** reporter.

## What we need

The entry-visa fee is company money out: **AED 51,144,713 across 61,965 posted charges since 2017**,
of which **AED 12,321,981 sits in the last twelve months**. The business logic is fully specified and
every figure below is measured, not estimated.

> Everything this reads is already in `BA_VIEWS` and verified. **No new object, grant, warehouse or
> pipeline is requested.** The ask is narrow: model the eleven metrics below from objects we already
> read. The business logic is attached — you do not need to reverse-engineer it.

## The metrics, by fixed id

Every card and column must carry these ids. Two id systems on one page is how a reader ends up
comparing figures that were never comparable.

| id | Metric | Measured today |
|---|---|---|
| **`EV-F12`** | **Refundable cancellations never claimed** *(largest finding)* | **AED 1,141,936** over 2,950 cancellations · claim rate **7.7%** |
| `EV-M1` | Recoverable — unclaimed refunds, rejection channel | **≥ AED 71,229** over 164 charges |
| `EV-M2` | Gross exposure on red rows | AED 117,517 (M1's population) |
| `EV-M3` | Avoidable waste — duplicate charges per maid | **AED 496,440** over 598 pairs (**upper bound**) |
| `EV-M4` | Recovery rate — refunds received ÷ due | computable from the tariff |
| `EV-M5` | Claim ageing — days rejection → refund | 547 of 556 within 7 days |
| `EV-M6` | Unit price vs the measured mode | 1,022.50 / 372.50 |
| `EV-F1` | Rejected, refund never recovered | 868-request union |
| `EV-F4` | Duplicate entry-visa charges for the same maid | **598 pairs, AED 496,440** — 522 on one request, 76 across requests |
| `EV-F10` | Approved then cancelled | ⚠️ **RETIRED — superseded by `EV-F12`.** See below |
| `EV-F11` | Short / over refunds | 19 + 21 confirmed, 8 candidates |
| `EV-COV` | Coverage — examined vs each priced exclusion | 23.4% of all-time lines examined |

**Grain:** one row per entry-visa charge line. `EV-F4` and `EV-F11` are pair-grain and collapse to
charge grain by severity **before** any total. `EV-F12` is **cancellation grain** and does not
collapse to charge grain at all — do not sum it into a charge-grain total.

🔴 **`EV-F4` is an UPPER BOUND, and the model must label it so.** Its justifying-event set reads
rejections from the history only, so it misses ~22.6% of rejections and pushes some genuinely
justified re-charges into the duplicate verdict. Rebuilding it on the three-source union (trap 5) is
the fix; until then the figure is a ceiling, not a point estimate.

**Layer:** silver model + gold aggregate, matching DNA-9454's pattern for the applicant-ticketing
audit.

## What it reads

| id | Object | Used for |
|---|---|---|
| D1 | `VISA_SILVER.VISAREQUESTEXPENSES` | charges, refunds, payment evidence, CC/MV, owner type |
| D2 | `VISA_SILVER.INITIAL_VISA_REQUESTS` | issuance, expiry, approval state, request status |
| D3 | `VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | dated rejections, dated expiry per attempt |
| D4 | `VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS` | step visits, refund-step timing, `ITERATION` |
| D5 | `VISA_SILVER.CANCEL_VISA_REQUESTS` | **the New↔Cancel bridge**, `NEW_REQUEST_ID` |
| D6 | `VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS` | cancel-side refund step |
| D7 | `VISA_SILVER.LOST_VISA_EXPENSES` | reconciliation target only — **not a population** |
| D8 | `VISA_SILVER.MISSING_EXPENSES` | step done, no expense booked |
| D9 | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | arrival / outcome |
| D10 | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | nationality, for the coverage slice only |

## Joins that exist, and the one that does not

| Join | Status |
|---|---|
| charge → initial request, on `VISA_REQUEST_ID = REQUEST_ID` | ✅ **must be qualified by `REQUEST_TYPE`** — ids are per-leg |
| initial request → cancellation, via `CANCEL_VISA_REQUESTS.NEW_REQUEST_ID` | ✅ exact FK. **The only safe cross-leg route** |
| charge → person, `OWNER_ID = HOUSEMAIDS_INFO.ID` | ✅ **only when `OWNER_TYPE='HOUSEMAID'`**. Office staff live elsewhere and will mis-join |
| office staff → arrival status | ❌ **does not exist.** 570 charges, AED 459,442 — `NOT_APPLICABLE`, priced, never counted clean |

## The trap section

All six traps from Ticket 1 §4 apply and are restated in `DNA_ATTACHMENT_source_tables.md`. The two
that cost the most during development:

- **`IS_DELETED = '0'` matched 0 of 625,941 rows** and silently emptied fifteen queries. Cost: a full
  build cycle.
- **The cancel-leg id overlap inflated a finding from 17 to 26** — a 53% overstatement that looked
  entirely plausible.

## Data asks — non-blocking

| Ask | Unlocks |
|---|---|
| Inside/outside UAE at application time (`new_request.location_id` → `picklist_item.name`; office staff `location_enum`) | `EV-M6`'s band split. **Computed at runtime, never stored** — there is no flag to copy |
| `refunded_status` from the ERP | The claim-vs-ledger contradiction test |
| `PARAM_ENTRY_VISA_EXPENSE_AMOUNT_THRESHOLD` value history | Separating dating artefacts from real band mismatches |

## What needs a decision, not engineering

1. ✅ **ANSWERED — no longer a decision.** v1 asked the Visa team whether approved-then-cancelled
   money is recoverable, with AED 3,454,994 turning on it, on the strength of a 12-case sample where
   nobody got anything back. **Measured on 3,195 cases, 245 claims were paid.** The money is
   recoverable, the route exists, and it is simply not being used. The 3.45m is **restated, not
   flipped**:

   | bucket | AED | status |
   | --- | ---: | --- |
   | Never consumed, route available, unclaimed | **1,141,936** | **RECOVERABLE — this is `EV-F12`** |
   | Never consumed, before the route existed (pre-2024-10-19) | 1,502,701 | historical loss, **not** claimable |
   | Consumed — the visa was used | 18,425,782 | correctly cost |

   *Nothing goes to the Visa team here. What they get is a worklist.*
2. **Office staff in or out?** 570 charges, AED 459,442, untestable for arrival.
3. **How far back?** The floors below make anything earlier look clean because nothing was written
   down.
4. 🆕 **Is the pre-2024-10-19 AED 1,502,701 worth one approach to GDRFA?** Guard G8 treats it as
   BLOCKED because the claim route did not exist and a 2018 claim will not be entertained. That is an
   assumption, not a verified rule. One question to GDRFA settles whether ~1.5m is dead. → Visa team.

## Sensitivity

**No personal or financial personal data is surfaced.** Output is ids, counts, amounts and verdicts.
Names are blocklisted from every surface, including `VISAREQUESTEXPENSES.DESCRIPTION`, which
concatenates a **passport number** for housemaid rows. Payment cards appear as *"a named Visa-team
card"* plus last four digits, never a cardholder. Salary columns on `INITIAL_VISA_REQUESTS` are never
selected.

## Attached

| File | |
|---|---|
| `DNA_ATTACHMENT_source_tables.md` | **Start here** — objects, columns, types, traps |
| `DNA_ATTACHMENT_verification_queries.md` | Every measured figure with the query that produced it. Aggregate only, positive controls first |
| `SPEC_entry_visa_money_out_v1.md` | The full spec — business case, families, verdict model |

## Not a duplicate

| Key | Status | Why it does not overlap |
|---|---|---|
| DNA-9566 | Done | GCC fee, client billing, money **in**. This is a government fee, money **out**. Shape borrowed deliberately |
| DNA-9454 | Ongoing | Applicant ticketing audit. Same layer and pattern, different subject |
| VPMGOV-1670 | In Speccing | R-Visa audit — a later visa stage, its own fee and clock |
| VPMGOV-1394 | In Speccing | Adds a description to the silent `VISA_UNSUCCESSFUL` transition. **Related — link it**: it is the fix for this audit's F3 root cause, not a duplicate of the audit |
| MC-1947 | In Development | Rejects negative amounts on expense screens. Adjacent to the refund-sign handling; does not detect unclaimed refunds |
| MC-1933 / VPMGOV-1575 | Done | Generalised the Qashio reference to `REFERENCE_NUMBER`. This audit **depends on** that change |

🔴 **No existing ticket covers unclaimed entry-visa refunds.** Established by searching the subject
*and* this spec's table names across 100 issues in 15 projects, not by assuming.

## Done when

Numeric, so a wrong build is visible:

1. `COUNT(*) − COUNT(DISTINCT charge_id) = 0` on the charge-grain model.
2. Entry-visa charge lines total **62,468 ± today's new rows**; posted (`Added`) lines **61,965**;
   all-time value **AED 51,144,713**. The ledger is live — state the as-of.
3. `PURPOSE` distribution reproduces **`ENTRY_VSIA` 57,396** and **`ENTRY_VISA_LESS_THAN_1000` 5,070**.
   Any zero here means the misspelling trap was hit.
4. The rejection union returns **868 requests: 672 dated, 508 live, 312 in both**. A result of 672 or
   508 means only one source was read. **Then the three-source test**: classifying all 1,457 refunds
   by rejection signal must return **801 approval-field · 414 immigration re-entry · 33 fix-step ·
   209 no signal**. A no-signal count near 656 means the `ITERATION > 1` source was omitted and every
   rejection-keyed figure is wrong.
5. `EV-M1` returns **164 charges, gross AED 117,517, recoverable AED 71,229** for the rejection
   channel, ± movement since 2026-09-13.
6. The tariff holds: **≥ 1,100 refunds at exactly `charge − 283.00 − surcharge`**, variance summing
   to **0**. Anything else means the pairing or the cast is wrong.
7. `EV-F4` at **maid grain** returns **1,900 charge pairs**, adjudicating to **911 justified by a
   refund/rejection/refund-step · 391 justified by a new journey · 76 duplicate across requests ·
   522 duplicate on one request** = **598 duplicates, AED 496,440**. Two controls must both hold:
   excess charges over maids (**61,424 − 59,524 = 1,900**) must equal the adjudicated pair count
   exactly — any remainder is unclassified and a build defect; and the two justifying verdicts must
   separate on timing, **median 8.0 days** for the refund cycle against **214.0 days** for a new
   journey. If those medians converge, the justifying rule is not working.
7b. 🔴 **`EV-F12` returns AED 1,141,936 over 2,950 cancellations**, from a population of **3,195**
   (245 claimed). Four ways to get this wrong, all measured:
   * counting refunds that **predate the cancellation** as claims returns 2,538 / AED 974,448 — a
     **17% under-count** (trap 7);
   * keying on the **workflow task** instead of the expense undercounts claims by ~two thirds (trap 8);
   * dropping guard **G7** (consumed ⇒ NOT_APPLICABLE) returns **~AED 20m** — wrong by twentyfold,
     because 33,133 ordinary end-of-contract cancellations leak in;
   * dropping guard **G8** (pre-2024-10-19 ⇒ BLOCKED) adds AED 1,502,701 of unclaimable history.
   The claim rate must come out at **7.7% by count / 10.8% by value**, and claimed cancellations must
   average **AED 850** of charge against **AED 669** unclaimed.
8. Verdict exhaustiveness: charges in scope **= GREEN + RED + CANDIDATE + NOT_APPLICABLE + VOID +
   BLOCKED + REPORTED**, in both count and AED. Any charge in none of these is a build defect.
9. Coverage reproduces: **2017 = 617 charges / AED 350,467 BLOCKED**; Pakistani cohort **411 / AED
   418,717**; office staff **570 / AED 459,442**; void-on-amount **0**.

---
---

# TICKET 3 — `BI Visualization Task`

**Summary:** `Entry Visa Audit dashboard`
**Blocked by:** Ticket 2.

## Layout — restated here because a Claude artifact link is not readable by the intake bot

The mockup is at `https://claude.ai/code/artifact/c5b9ecd3-e4eb-4c99-9292-ebf0f53c429c` and the bot
will log it `[UNVERIFIED — link not readable]`. The layout in full:

**Header KPI strip, four tiles**, each labelled with its metric id: **Unclaimed cancellation refunds
`EV-F12`** (the headline — AED 1,141,936, with the 7.7% claim rate as its subtitle) · Recoverable
`EV-M1` · Avoidable waste `EV-M3` · Claims open past 7 days. **A blocked metric renders as a
blocked tile with its reason — never as zero and never omitted.**

**Control-findings block** beneath the strip, for the findings that carry **no row verdict**: the fee
has no authorised amount; nobody owns the refund and nothing chases it; and the overstay fine is
billed inside another fee with no line of its own (Ticket 4). ⚠️ *v1 listed "cancelled-after-approval
has no route to a refund" here — that is refuted, the route exists, and it must not appear.*

**Coverage bar** — one horizontal stacked bar, examined vs each excluded slice, **priced in AED**,
with a legend naming each slice and its reason. This is the element that stops the report reading as
"all clean", and it must not be collapsed into a percentage.

**Exception table**, one row per charge: request id · person id · population · charge date · amount ·
family · verdict · variance · days open · owner action · *"what would settle it"* on every candidate
· *"what is missing"* on every blocked row.

**Conditional formatting across seven verdict states.** `VOID`, `BLOCKED` and `NOT_APPLICABLE` are
each visually distinct from `GREEN` — never grey-as-good.

**Drill-down** opens the charge's timeline: application → rejection events, marked *dated* or
*undated* → refund step open/close → refund lines with status → expiry → outcome.

**Provenance line**, displayed: sources and as-of timestamp. ⚠️ The ledger is live — the entry-visa
line count moved between two runs an hour apart — so every tie-out is as-of and two figures from
different runs do not reconcile by construction.

**Export**: CSV at row grain. Ids, counts, amounts, verdicts. Nothing from the name blocklist.

## Done when

1. Every tile and column carries its `EV-` id.
2. All seven verdict states render distinctly; a blocked metric shows blocked, not 0.
3. The coverage bar sums to **100% of charges in scope** and every slice carries an AED figure.
4. Filtering to any one family and summing its variance reproduces Ticket 2's acceptance figures.

---
---

# TICKET 4 — `Alert Requests`

**Summary:** `Overstay Fine Ageing — change-of-status cases running long`
**Independent.** Needs no model and no new object. **Priority: this one has a clock.**

## 1. Alert Name

**Overstay Fine Ageing — change-of-status cases running long**

## 2. What this alert does

When a maid already inside the UAE switches to our sponsorship, we pay a **change-of-status** fee. If
she has overstayed her previous visa, the government adds **AED 50 per day** — and that fine is
**billed inside the change-of-status fee itself**. It has **no line of its own anywhere in the
ledger**, so nobody can see it, and nobody is watching a case run.

Decomposed arithmetically and confirmed on 9,696 lines (**99.93% fit the tariff model**):

> **AED 970,081 a year of overstay fine, on 1,180 maids, invisible in the accounts.**

🔴 **And it is concentrated, which is what makes it actionable:**

| implied overstay | cases | fine AED | share |
| --- | ---: | ---: | ---: |
| 0 days | 8,506 | 0 | — |
| 1–7 days | 704 | 110,671 | 11.4% |
| 8–30 days | 345 | 262,399 | 27.1% |
| 31–90 days | 94 | 220,960 | 22.8% |
| 91–180 days | 25 | 153,450 | 15.8% |
| **181+ days** | **15** | **222,600** | **23.0%** |

**40 cases carry 39% of the cost. 134 carry 61%.** The 15 longest average **≈297 days** — nearly ten
months. That is not a filing delay; it is a case nobody is watching. **Forty cases a year is a
caseload one person can review by name.**

## 3. Action to be Taken

* **Case open past 30 days** — escalate to close it. Every further day costs AED 50.
* **Case past 90 days** — name an owner and a decision date. These are where the money is.
* **On settlement, record who bears the fine.** Today the company recovers **3.2%** of recorded
  overstay fines (49 of 1,546). Whether the rest is correctly the company's to bear is unanswered —
  and unanswerable from the ledger, because the fine has no line.

## 4. Source and filters (exact)

| Purpose | Table | Filter |
| --- | --- | --- |
| Change-of-status fee | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE='CHANGE_OF_STATUS'`, `REQUEST_TYPE='NewRequest'`, `STATUS='Added'` |
| Fine recovered | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | `FINES_PAID_TO_US` |
| Fine paid (cross-check) | same | `OVERSTAY_FEE` |

🔴 **The tariff, and it is the whole alert.** One fee on three payment channels, then AED 50/day:

| base | what it is | + per overstay day |
| ---: | --- | ---: |
| **572.50** | the fee | +50.00 |
| 575.65 | 572.50 **+ 3.15** flat channel surcharge | +50.00 |
| 590.54 | 572.50 **× 1.0315** proportional surcharge | +51.575 |

`implied_days = (amount − base) ÷ step`. **This settles three figures that circulated as rival
tariffs (572.50 / 575.65 / 590.54) — they are the same fee.** The same two surcharges appear on the
entry visa (1,022.50 → 1,025.65 / 1,054.71), consistent to the fils.

**Three traps:**

1. 🔴 **A duplicate test must match on the BASE, not the total.** Two different amounts can both be
   correct for the same maid because the overstay differs.
2. **`OVERSTAY_FINE` and `OVERSTAY_FEE` are different things.** `OVERSTAY_FEE` tracks what was paid
   (agreeing with the decomposed amount to **0.00%** and **0.05%** on two categories); `OVERSTAY_FINE`
   is ~3× larger and is what was **assessed** — on 364 requests it carries a fine matched to no
   payment at all. ⚠️ Whether the two are written independently is **unverified** (the ERP may compute
   one from the other), so do not present their agreement as corroboration.
3. 🔴 **Do not report a "reduced by challenge" figure.** `BEFORE`/`AFTER` challenge columns are
   populated on only 209 of 916 fined requests, and only 50 have an `AFTER` value. Differencing them
   scores a **missing record as a total win** — it produced AED 1,798,075 of fictional savings during
   development. Report challenge **coverage** (22.8%) instead.

## 5. Trigger / Schedule

**Weekly.** Not monthly — the fine accrues at AED 50/day, so a monthly alert reports history. A case
caught at day 30 instead of day 297 saves ~AED 13,350.

## 6. Output Columns

`VISA_REQUEST_ID` · `OWNER_ID` / `OWNER_TYPE` (**no names**) · `CONTRACT_TYPE` · `CHARGE_DATE` ·
`AMOUNT_AED` · `SCHEDULE` (which of the three channels) · `BASE_AED` · **`IMPLIED_OVERSTAY_DAYS`** ·
`EMBEDDED_FINE_AED` · `FINES_PAID_TO_US` · `DAYS_OPEN`.

## 7. Done when

1. The tariff model classifies **≥ 99.9%** of change-of-status lines (measured 9,689 of 9,696). A
   materially larger unexplained bucket means a channel or a step has changed — investigate, do not
   widen the tolerance.
2. Embedded fine totals **AED 970,081** over the rolling 12 months across 1,183 lines / 1,180 maids.
3. The day distribution **decays monotonically** — 87.7% at 0 days, then 7.3 / 3.6 / 1.0 / 0.3 / 0.2%.
   A flat or tail-heavy distribution means the arithmetic matcher is producing false positives and
   the fine total is not trustworthy.
4. Recovery reproduces **49 of 1,546 fined requests (3.2%)**.

## 8. Recipients

**To be confirmed by the requester before filing.** Weekly, to the Visa/Policing owner and the P&C
lead. The 91+ day cases should additionally go to a named owner — 40 a year does not need a
distribution list.

---
---

## One thing no ticket craft can fix

Check the DNA queue before assuming a well-written ticket moves. On a previous read, every ticket
from one department sat at lowest priority, filed the same day, none moved — all graded Ready, none
blocked on information. **A better-written ticket does not fix a priority problem.** DNA-9566, the
closest precedent, shipped at `Not Urgent`.

If the refund families matter on a clock — and the F9 error rate rose roughly six-fold between 2025
and 2026 — that is a conversation with the pillar manager, not a fifth ticket into the same queue.

🔴 **v2 gives that conversation a number it did not have.** `EV-F12` is **AED 1,141,936 already lost
and running at ~602k a year**, on a route that demonstrably works and is used 7.7% of the time. That
is not a reporting gap; it is money leaving monthly while the ticket sits. Lead with it.
