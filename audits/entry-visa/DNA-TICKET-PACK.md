# DNA ticket pack — Entry Visa Audit

Three tickets. **File pre-split with the blocks link set** — DNA's doctrine is that SQL/model work
always blocks the visual build. Set the issue type yourself on creation; Jira automation re-types new
tickets to "New Request" and the intake bot then corrects it.

| # | Type | Summary | Blocks / blocked by |
|---|---|---|---|
| 1 | `Alert Requests` | Money Lost — Entry Visa Refund Not Claimed | **independent — file first** |
| 2 | `Analytic Engineer Task` | Entry Visa Audit — model the money-out metrics in silver/gold | blocks #3 |
| 3 | `BI Visualization Task` | Entry Visa Audit dashboard | blocked by #2 |

**Why #1 goes first.** It needs no new model and mirrors DNA-9566, which shipped. The findings are
live and one is getting worse, so an alert delivers value while the model is built.

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
the application is rejected. The refund is a service we must **apply for** — GDRFA's "Fees and
Guarantee Refund Service" — not an automatic reversal. This alert lists entry-visa fees we paid,
where the application did not succeed and **no refund was ever recorded on either the visa request or
its cancellation request**, priced at what the government would have returned.

It also flags four adjacent errors on the same ledger: refunds claimed at the **wrong band**, refunds
received that **exceed what we paid**, charges booked at a **refund value** (a refund entered as a
cost, which doubles the damage), and charges attached to **no case and no person**.

## 3. Action to be Taken

* **Refund never claimed** — file the claim with GDRFA if still possible; if it is not, record why,
  so the case stops recurring in the report.
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

🔴 **Six traps. Each one returns a plausible wrong answer rather than an error, and five were hit
during this spec's own development.**

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
5. **Read rejection from BOTH sources and union them.** The history holds 672 requests, the live
   column 508, the union **868**. History alone misses 22.6%; the live column alone misses 41.5%.
   Live-only cases are *rejected but undated* — testable for refund existence, **not** for timing.
6. **`AMOUNT` is `FLOAT`** (max 19,711,606,003,430). Cast to `NUMBER(18,2)` before grouping, banding
   or summing.

## 5. Trigger / Schedule

**Monthly**, after month close. **Not daily** — a refund arrives within 7 days or not at all (547 of
556 measured), so daily re-listing produces noise, not urgency.

**Four hard floors. Before each, absence of a finding is absence of *recording*, and rows must be
excluded rather than shown clean.**

| From | Why |
|---|---|
| **2019-04-02** | Workflow step history begins. 100% of 2017 and 2018 charges have none |
| **2024-02-06** | First refund row in existence. No refund-recovery test can run before it |
| **2025-09-05** | Dated rejections begin. Nothing recorded 2019-04 → 2025-09 |
| **2026-06-10** | Missing-expense detector's first row |

## 6. Query

Full runnable SQL is attached as `DNA_ATTACHMENT_alert_query.sql`, built from
`ENTRY-VISA-DISCOVERY.sql` R1c (unclaimed), R1b (band variance), R5 (refund-value charges) and Q0
(orphans), unioned to one output with a `FINDING_TYPE` column. It is not inlined here because the
five CTEs exceed a readable description; the attachment is marked *Start here*.

## 7. Output Columns

| Column | What it is |
|---|---|
| `FINDING_TYPE` | `REFUND_NEVER_CLAIMED` · `SHORT_REFUND` · `OVER_REFUND` · `CHARGE_AT_REFUND_VALUE` · `CHARGE_WITH_NO_REQUEST` |
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
| `EV-M1` | Recoverable — unclaimed refunds, rejection channel | **≥ AED 71,229** over 164 charges |
| `EV-M2` | Gross exposure on red rows | AED 117,517 (M1's population) |
| `EV-M3` | Avoidable waste — duplicates, two price points, avoidable expiry | AED 497,104 candidate pool |
| `EV-M4` | Recovery rate — refunds received ÷ due | computable from the tariff |
| `EV-M5` | Claim ageing — days rejection → refund | 547 of 556 within 7 days |
| `EV-M6` | Unit price vs the measured mode | 1,022.50 / 372.50 |
| `EV-F1` | Rejected, refund never recovered | 868-request union |
| `EV-F4` | More charges than applications, no refund | **270 requests, AED 497,104** |
| `EV-F10` | Approved then cancelled | 5,747 requests, AED 3,454,994, **unadjudicated** |
| `EV-F11` | Short / over refunds | 19 + 21 confirmed, 8 candidates |
| `EV-COV` | Coverage — examined vs each priced exclusion | 23.4% of all-time lines examined |

**Grain:** one row per entry-visa charge line. `EV-F4` and `EV-F11` are pair-grain and collapse to
charge grain by severity **before** any total.

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

1. **Is approved-then-cancelled money recoverable at all?** AED 3,454,994 turns on it. Evidence is
   ambiguous: 12 people worked the cancellation-side refund step and **all 12 got nothing back**, but
   the code permits closing that step without recording a claim. → Visa team.
2. **Office staff in or out?** 570 charges, AED 459,442, untestable for arrival.
3. **How far back?** The four floors above make anything earlier look clean because nothing was
   written down.

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
   508 means only one source was read.
5. `EV-M1` returns **164 charges, gross AED 117,517, recoverable AED 71,229** for the rejection
   channel, ± movement since 2026-09-13.
6. The tariff holds: **≥ 1,100 refunds at exactly `charge − 283.00 − surcharge`**, variance summing
   to **0**. Anything else means the pairing or the cast is wrong.
7. `EV-F4` returns **270 requests / AED 497,104**, counting visits across `Apply for entry Visa`
   **plus** `Fix the problem of entry visa` **plus** `Pending to fix issues of Entry Visa`, with
   `visits ≥ 1` enforced. Two ways to get this wrong, both measured: counting the **apply step alone**
   returns 413 / AED 757,548, a **35% over-count** from fix-workflow re-applications; dropping the
   `visits ≥ 1` guard returns ~4,980 / AED 3.1m as the pre-2019 no-step-history block leaks in.
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

**Header KPI strip, four tiles**, each labelled with its metric id: Recoverable `EV-M1` · Gross
exposure `EV-M2` · Avoidable waste `EV-M3` · Claims open past 7 days. **A blocked metric renders as a
blocked tile with its reason — never as zero and never omitted.**

**Control-findings block** beneath the strip, for the two findings that carry **no row verdict**: the
fee has no authorised amount, and cancelled-after-approval cases have no route to a refund step.

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

## One thing no ticket craft can fix

Check the DNA queue before assuming a well-written ticket moves. On a previous read, every ticket
from one department sat at lowest priority, filed the same day, none moved — all graded Ready, none
blocked on information. **A better-written ticket does not fix a priority problem.** DNA-9566, the
closest precedent, shipped at `Not Urgent`.

If the refund families matter on a clock — and the F9 error rate rose roughly six-fold between 2025
and 2026 — that is a conversation with the pillar manager, not a fifth ticket into the same queue.
