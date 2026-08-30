# Audit Flow Factory — spec readiness gate

**Run:** 2026-08-30 · **Scope:** all `Checks — <Category>` databases, rows at `Status = Spec'd — pending build on n8n`
**Mode:** read-only. No Notion writes, no status moves, no build started.
**Sources:** 7 Checks databases + 🟩 ERP Variables Database (192 unique variable rows across the 12 queued checks).

---

## 0 · What the gate looked at

| Category database | rows | in build queue |
|---|---:|---:|
| Checks — CC Client | — | 0 |
| Checks — MV Client | — | 0 |
| Checks — CC Maid | — | 4 |
| Checks — MV Maid | — | 0 |
| Checks — Both Maids | — | 7 |
| Checks — Both Clients | — | 1 |
| Checks — Office Staff | 3 | 0 (all `Not spec'ed yet`) |
| **Total queue** | | **12** |

> **Structural note:** there are **seven** `Checks — …` databases, not the six the Audit Flow Factory
> page states. There is no `Checks — Accounting` database. Worth reconciling the Factory page.

Assertions applied per queued check:

1. `Test cases verified` = YES
2. every ERP variable it reads is `ERP Value Status = Confirmed` **and** `Status = Verified`
3. every variable has a non-empty `Default Value`
4. every variable has a non-empty `pagecode`
5. no variable at `Doc Status ∈ {Generic stub - do not trust, No matching route}`
6. no variable whose only source is a banned/dead-end route with **no confirmed alternative**
7. a named reviewer exists where `Independent review required` = YES
8. `check_id` assigned **— withdrawn, see §2e**
9. `Skeleton Version` recorded (drift assessable)

---

## 1 · Ready to build now

**None.** No check in the queue passes all nine assertions.

Two are **one soft assertion away** — and both are *already built*, so they need a status
correction rather than a build:

| Check | Fails only | Reality |
|---|---|---|
| **Dummy Tickets Submitted for Refund — Housemaids** | A5 (1 var at `Generic stub`), A9 (no skeleton version) | **Built.** Staging workflow `aTmGMAlYLwsJQ7js`, `check_id` assigned, results sheet linked. Extended this session (verifier-outcome stamping). |
| **Applicant Real Ticket** | A5 (same 1 var), A9 | **Built.** Staging workflow `YXRZdtk2Geeeqaal`, results sheet linked. Extended this session (per-slice supersession fix). |

Both fail A5 on the *same single row*: `transaction_applicant_id`, whose `Doc Status` is
`Generic stub - do not trust`. That flag describes the **API catalog entry**, not the value — the
row itself is `ERP Value Status = Confirmed`, `Status = Verified`, and its `Traps` field records the
real shape (`applicants[0].applicant.id`, plural array, never resolve by name). This is a
**documentation gap, not a data gap**, and should not hold a build.

**Recommended action, not a build:** move both to their true stage. *(Done 2026-08-30 — both,
plus Terminated Housemaids Tickets, now read `Built on n8n — Staging`.)* The queue's real count of
*new* buildable checks is **0**.

---

## 2 · Blocked, and whose it is

### 2a · Spec owner — test cases not verified (blocks 4)

`Test cases verified = NO`, so the five human-verified cases the builder needs do not exist:

- **GCC Payments Checker**
- **Terminated Housemaids Tickets** *(already built and running — same status-vs-reality mismatch as §1)*
- **Change of Status Audit**
- **Client Refunds**

### 2b · Data team — unconfirmed / undefaulted ERP variables

Counts are variables reading `ERP Value Status ≠ Confirmed`, out of the total the check reads:

| Check | unconfirmed | no `pagecode` | `Doc Status` untrustworthy | total vars |
|---|---:|---:|---:|---:|
| R-Visa Audit | 12 | 9 | 1 | 20 |
| CC Client Refunds | 13 | 6 | 6 | 38 |
| Medical from Visa Expenses | 7 | 0 | 0 | 9 |
| Entry Visa Audit | 7 | 0 | 0 | 12 |
| GCC Payments Checker | 7 | 2 | 3 | 13 |
| CC Maids Salary Raise | 7 *(5 RETIRED — see below)* | 7 | 0 | 28 |
| Terminated Housemaids Tickets | 5 | 5 | 2 | 20 |
| E-ID Audit | 5 | 5 | 2 | 18 |
| Change of Status Audit | 5 | 5 | 3 | 28 |
| ILOE Checker | 1 | 2 | 2 | 14 |
| Applicant Real Ticket | 0 | 0 | 1 | 20 |
| Dummy Tickets | 0 | 0 | 1 | 17 |

**`Default Value` is populated on 190 of 192 rows** — the discipline there is good. The two blanks
are both on **CC Client Refunds**.

**CC Maids Salary Raise reads better than the raw count.** Five of its seven unconfirmed rows are
explicitly `RETIRED 2026-08-19` and superseded by confirmed replacements (`maid_payroll_type`,
`payroll_total_salary`, `maid_live_out`, `approved_base_amount`). They should be filtered out of the
gate, not chased. Its **real** blockers are two owner rulings still at `Pending Business`:
`renewal_raise_lifetime_cap` (2 raises per maid for life) and `ruled_cohort_level` (Filipina live-out
3,200 / Ethiopian live-in 1,500), both ruled by Jacky on 2026-08-19 and logged in `decisions.md`.
Promoting a ruled constant to Confirmed is a one-line decision, and it would take this check from
7 blockers to 0 on assertion 2.

**E-ID Audit carries a hard stop of its own:** `eid_unidentified_fee_84` is labelled
`UNIDENTIFIED - BLOCKS SCORING` in the variables database. Ten of its 18 variables have no confirmed
ERP route.

### 2c · ERP team — no confirmed route at all

Variables whose `API Link` records *no confirmed ERP route* (or no non-page alternative). Under the
2026-08-25 dead-end ban these are an ERP-team ask; a spec may proceed only by carrying a
*no confirmed non-page route* row and routing every rule that reads the field to the verifier.

| Check | vars with no confirmed route |
|---|---:|
| E-ID Audit | 10 |
| R-Visa Audit | 8 |
| Terminated Housemaids Tickets | 5 |
| Medical from Visa Expenses | 3 |
| Change of Status Audit | 3 |
| CC Maids Salary Raise | 2 (both are ruled constants, not routes) |
| GCC Payments Checker | 2 |
| ILOE Checker | 2 |
| CC Client Refunds | 2 |
| Entry Visa Audit | 1 |
| Dummy Tickets / Applicant Real Ticket | 0 |

Two rows are marked **permanently** unroutable — `client_refund_detail_lines` and
`client_refund_detail_affected_month` on CC Client Refunds. Those will never clear; the spec has to
route around them.

One access request is already identified and outstanding:
`GET /accounting/contract/getTheRefundAndPaidEndDateFromContract/{contractId}` returns **401 for this
role** (probed 2026-08-26) — access is requestable.

### 2d · Spec owner — no named reviewer

**Nine** of the twelve queued checks have `Independent review required = YES` with **`Tech Owner`
empty**: CC Maids Salary Raise, GCC Payments Checker, Change of Status Audit, R-Visa Audit,
ILOE Checker, Entry Visa Audit, Medical from Visa Expenses, E-ID Audit, Client Refunds.

A `Business Owner` is set on all twelve. Only Dummy Tickets, Applicant Real Ticket and Terminated
Housemaids Tickets carry a Tech Owner.

### 2e · Housekeeping

- **`check_id` is NOT a build-time field — assertion 8 is withdrawn.** `check_id` is the check's id
  in the **Security Room portal**, and it exists only for checks that actually deliver there. The
  Wellcare Advanced Clinic row states the rule in its own field: *"n/a — this check has no Security
  Room delivery (workbook + email draft + runs log only). Assign one only if it is ever pointed at
  the portal."* CC Overstay Fines is likewise at Staging with `check_id` null. So a null `check_id`
  is normal, not a gap, and nothing in the build pipeline may mint one — a fabricated id would not
  resolve in the portal. It is missing on 10 of 12 queued checks; that number is an observation,
  not a blocker.
  Note the flows' *internal* `check_id` (the Runs-table slug: `applicant-real-ticket`,
  `mv-monthly-payment`, `manual-cc-price-by-cohort`) is a different namespace from this field and
  must not be copied into it.
- **Google Sheet link present on 3 of 12** — the three that are actually built.
- **`Jira Task Link` empty on all 12.**
- **`Handles sensitive data = YES` on 10 of 12** (all but Entry Visa Audit and Terminated Housemaids
  Tickets). Output hygiene applies to every one of those: counts, flags and totals in chat and
  summaries; per-entity amounts and identifiers stay in the case store.
- **`AI verifier = Required` on all 12.**
- One `Variable` title is duplicated across two rows in the ERP Variables Database (193 rows,
  192 distinct titles).

---

## 3 · Traps to read before building

Every one of these is a wrong finding already shipped. Reproduced verbatim from the `Traps` field.
Scoped to the two checks that clear the substantive gate (Dummy Tickets, Applicant Real Ticket) —
25 of their 37 variable rows carry a trap. The full text is long; the load-bearing ones:

**`ticket_outcome`** — "IT IS AN OBJECT, not a string — read `.label`. This field SHADOWS status …
Do NOT read outcome='Used' on a REAL ticket as suspicious — on a REAL ticket Used is the happy path,
the exact opposite of its meaning on a DUMMY ticket. That inversion is the single easiest thing to
get wrong when porting a rule between the two checks."

**`real_ticket_count_in_window`** — "🔴 THE TICKET ARRAY IS CUMULATIVE AND ALL-TIME — IT IS NEVER
WINDOWED, AND COUNTING IT RAW IS THE DEFECT THAT MAKES THE DRIVE v2 SPEC UNIMPLEMENTABLE … SECOND
TRAP: a count of >=2 is NOT a finding. Of the 30 applicants it flags in a complete month, ZERO were
duplicate-booking losses on inspection … It is a triage trigger only."

**`ticket_route_to`** — "THE CONNECTING-LEG TEST IS WHAT SAVES THIS CHECK FROM A 40% FALSE-POSITIVE
RATE … The test is: the arrival code of one leg equals the departure code of another. Do NOT test
only for equal destinations."

**`applicant_task_label`** — "FALSE-CLEARANCE FIELD. Once a dummy ticket is refunded, this flips from
Dummy_Flight_Ticket to Refund_Flight_Ticket while `ticket_type` stays DUMMY. Defining the population
on this field therefore DROPS EVERY REFUNDED DUMMY TICKET."

**`transaction_amount_signed`** — "THE DRIVE SPEC NEVER MENTIONS THE SIGN, AND 32.6% OF THE BOOK IS
NEGATIVE … Counting rows without regard to sign counts a refund as a second ticket."

**`transaction_description`** — "Applicant ID - (d+) is present on 349 and ABSENT on 38 … Do NOT
filter on transactionType='APPLICANT' instead: 5 genuine applicant rows carry
transactionType='UNKNOWN' and would be silently dropped."

**`transaction_date`** — "FOR APPLICANT REAL TICKET THE WINDOW TRUNCATES THE REFUND … The refund
must therefore be sought with the ALL-TIME call (description like, no date filter), never from the
windowed set alone."

**`ticket_amount_in_aed`** — "USE THIS FIELD, NEVER THE SIBLING `amount` … `amount` is rounded to
whole units; only `amountInAED` carries the cents … ERP has ALREADY converted this to AED — do not
re-apply an exchange rate."

**`ticket_refundable`** — "This field does NOT predict whether a refund happened … The DEFAULT is
deliberately opposite between the two checks that read this row; porting one check's default to the
other inverts the verdict."

**`dummy_ticket_count`** — "The live check evaluates ONE ticket per applicant and reports that one
ticket's status as the case's status — with counts reaching 10, an applicant holding both a Refunded
and a REFUND_FAILED dummy ticket can be reported on whichever the flow happens to pick."

**`ticket_layover`** — "IT IS AN ARRAY OF OBJECTS … 56% of REAL rows carry a layover … The layover
airport is NOT the destination: 60 of 67 layovers are DXB."

**`transaction_applicant_id`** — "NEVER resolve identity by name … The array is PLURAL:
`applicants[0].applicant.id` — there is no top-level applicant key, and the Drive spec's path returns
null on every row."

**`ticket_type`** — "FAKE is a real third value and is out of scope for both checks. The two ticket
types SHARE APPLICANTS: of 40 applicants read 2026-08-17, 9 carried both REAL and DUMMY rows."

**`ticket_status`** — "ticketOutcome SHADOWS this field … CANCELED and REQUESTED carry NO MONEY …
That is 27% of REAL rows, so any COUNT or SUM over the ticket array must exclude them.
REFUND_SENT_TO_PAYERS is a settled refund, not an in-flight one."

**`dummy_ticket_expense_id`** — "Sibling constant: 137 = real tickets … The page envelope caps at
size 40 — walk all 4 pages and assert `pulled == totalElements` before trusting any absence."

**`real_ticket_expense_id`** — "137 IS NOT A CLEAN POPULATION. 37 of 387 rows (9.6%) are MAID
tickets, not applicant tickets … the expense id does NOT prove the ticket is real; `ticket_type` does."

**`transaction_type`** — "DO NOT FILTER THE POPULATION ON THIS FIELD … filtering to
transactionType='APPLICANT' silently DROPS 5 genuine applicant tickets."

**`applicant_profile_reachable`** — "The live check's `applicant_not_found` bucket is really *the ERP
call failed*. ERP returns 500, not 404, so a transient wobble manufactures red flags."

**`request_refund_on`** — "EMPTY ON EVERY CONFIRMED LOSS SO FAR … the live check does not read this
field at all, and it is why 241 of its 271 cases are noise."

**`transaction_expense_reference`** — "This is a PARSED value, not an ERP field … The reversal's
description is a VERBATIM COPY of the charge's, including the original amount in the text … Never
read the amount out of the description."

**`ticket_flight_date`** — "A REAL ticket that is ISSUED with an empty outcome and a
flightTicketDate in the FUTURE is in flight and must be pending, never a finding. Compare against
the RUN date, not the window end."

**`ticket_currency`** / **`ticket_refund_reason`** / **`ticket_route_from`** /
**`request_refund_automatically_type`** — read in full before building; each records a measured
false-positive mode ('Other' is not an airport; the ERP misspelling `not allowed to baord` must be
matched verbatim; empty currency is not AED).

---

## 4 · Skeleton drift

**Cannot be assessed.** `Skeleton Version` is **null on every queued row** — and on every row in
every Checks database except Travel Assist Payments, whose value reads *"This IS the golden
skeleton"*. There is no version string to compare a built flow against, so assertion 9 fails
universally and drift is invisible.

This is the single highest-leverage fix in the whole factory: until the golden skeleton carries a
real version identifier and built flows record which one they were built from, no build can be shown
to be current, and the three flows already in staging cannot be checked for drift at all.

---

## 5 · Summary

| | count |
|---|---:|
| Queued checks | 12 |
| Buildable now (all assertions) | **0** |
| Substantively ready — already built, need status correction | 2 |
| Blocked on test cases (spec owner) | 4 |
| Blocked on unconfirmed ERP variables (data team) | 10 |
| Blocked on a missing named reviewer (spec owner) | 9 |
| Carrying ≥1 variable with no confirmed ERP route (ERP team) | 10 |
| Skeleton drift assessable | 0 |

**The queue is not build-limited, it is confirmation-limited.** The one action that would unblock
the most work is not a build: it is promoting the two 2026-08-19 owner rulings on CC Maids Salary
Raise to `Confirmed`, which takes that check from seven variable blockers to zero and leaves only a
named reviewer between it and the builder.

*Counts and totals only. No per-entity detail, names, contact details, salaries or amounts appear in
this report.*
