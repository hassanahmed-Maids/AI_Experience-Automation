# What is missing to have done a full audit

**Written 2026-09-08**, after two live runs (August, then twelve months) and eight ask-the-code
conversations. This is the honest distance between what has been checked and what the spec describes.

**Headline: over twelve months the audit examined roughly a tenth of the money.** 17,480 notes,
AED 7,167,961. The rest passed *no* test — it passed the tests that could run, which is not the same
thing and must never be reported as one.

---

## A. Access — three things, none of them a business decision

| | Ask | Blocks | Status |
|---|---|---|---|
| **A1** | 🔴 **A warehouse grant + `EXPENSES_REQUESTS`** | **T4, T5, T7, group G, M13** — the note↔expense match, i.e. *"is there an authorised expense behind this payment and does the amount agree"* | `SHOW WAREHOUSES` returns zero rows for the role. **This single grant is ~90% of the uncovered money** |
| **A2** | The five raffle tables (N12/O3b) | **All of group F** | Zero objects matching `%RAFFLE%`/`%PRIZE%`/`%DRAW%` exist account-wide |
| **A3** | `HousemaidExtraFields` | The Abu Dhabi route; `abuDhabiIncentiveOffered` | Not ingested — confirmed 2026-09-08 |
| **A4** 🔴 **new** | **`PayrollManagerNote` revision history (Hibernate Envers)** | **Every point-in-time question about a note** | The entity is `@Audited`, so the history *exists*; only two manager-note objects are in the warehouse, both current-state views. **See §E4 — this is now the most valuable ingestion of the four** |
| **A5** | `INCENTIVE_AMOUNT` on `HOUSEMAID_MANAGERACTIONLOGS` | B4, B5, and every entitlement test on anti-attrition | One column. **Priced 2026-09-08: 52 same-day groups that cannot be adjudicated at all, plus a floor caveat on every over-entitlement test** |

## B. Reference lists — business answers nobody has given yet

N14 and N16 are answered from code. Outstanding: **N10** (effective-dated salary history), **N11**
(bonus scheme prices, partly resolved), **N15** (contract type → allowed payment types, first rows
only), **N17** (contract-type timeline — blocks group A), **N18** (row-level loans — blocks group L),
**N19** (`live_out` flag), **N20** (referrer↔referred link), **N22** (concurrent contracts → one
incentive or two).

**Without these, groups A, C, D, E and L cannot run at all** — that is airfare, both bonuses, every
prorated type, salary disputes and the live-out family.

## C. Tests that have never been run once

| Test | What it does | Why not |
|---|---|---|
| **T4** | Authorised expense record behind the note, amounts agree | A1 |
| **T5** | The expense is of an allowed head for that payment type | A1 |
| **T7** | *(spec)* | A1 |
| **Groups A, C, D, E, F, L** | Airfare, referral, signing, prorated ×5, salary dispute, raffle, live-out | B + A2 |
| **G2, G10** | Grain holds; no legacy note types present | **Never run — and these are guards on the audit's own correctness**, not on the data |
| **M2, M10, M11** | Money in scope, coverage, amount at risk | Never produced |

**Group B is the only group that has run end to end**, and only after five corrections.

## D. Deliverables that do not exist yet

1. **A per-note `TEST_TRACE`** — the spec requires every applicable test evaluated and recorded, no
   early exit. **Nothing has produced one.** Every finding so far came from a bespoke query.
2. **The UI report** (§4) — never built. `payment-types.html` is stale: 18 types, pre-census figures.
3. **TICKET-2 (the BI dashboard)** — never updated with trend-series or chance-rate acceptance criteria.
4. **A repeatable run.** Both audits were hand-driven, one query at a time, with the analyst pasting
   results. **There is no artefact anybody else could run.**

---

## E. 🔴 Structural gaps the live runs exposed — these change the spec, not just the backlog

### E1. The audit had no population-level tests, only per-note ones

`Abu Dhabi Incentive` was **18 notes, 100% zero, one run**. Each note was individually AMBER —
correctly. **No per-note verdict can see "every note of this type in this run is zero."** The same
blindness hides a run that fires twice, a type that stops appearing, and a type whose amounts all
change together. Folded in as **M3c**.

### E2. A payment type can be silently re-partitioned mid-year

The same batch posted under `Bonus` from April to July and under `Abu Dhabi Incentive` on 31 August.
**~77 notes sit in the wrong type**, and every `Bonus` figure in this audit includes them. Nothing in
the design would have caught it. Folded in as **M3c's census-drift guard**.

### E3. Provenance columns cannot be trusted, and three were trusted

- `ACTION_DATE` — user-editable, never re-stamped on update; the paying code reads `creationDate`.
- `USER_WHO_LAST_MODIFIED` — populated on **100%** of rows including the 96.7% never edited.
- `REQUESTED_BY` — identifies a **run**, not a route; the configured requester changed twice in a year.

Each was used as evidence before it was checked. Folded in as **§2 hygiene: provenance is untrusted
until the writing code says otherwise.**

### E4. 🔴 There is no usable history for a manager note

`PayrollManagerNote` is `@Audited`, but no revision table is in the warehouse — and `AuditorAction`
covers only `payroll_auditor` users acting through `customDelete`, so **background, service and
generic-`PUT` edits leave no trace at all.** The audit therefore **cannot tell a note that was born
wrong from one that was changed later** — for any note, not just zeros. That is A4, and it is worth
more than the other three ingestions combined because it converts every future question of this shape.

### E5. The amount field is structurally untrusted

Twenty paths create a note; two refuse a zero. No bean validation, no lifecycle hook, no DB
constraint — and `ExpenseRequestTodoBusinessRule` guards the loan branch with `> 0.0` while leaving
the addition branch open. **`AMOUNT` is not a validated field and the spec must stop treating it as
one.**

### E6. A note outlives the expense request that justified it

No listener for cancel/reject/reverse, and **no foreign key from the note back to the request**. Even
once A1 lands, **T4 can only ever match a note to a request's current state** — it cannot see that the
request was later withdrawn. **The biggest test in the audit has a hole in it that the grant will not
fix.**

### E7. Window tests need a chance baseline; monthly windows need the batch cycle

A 105-day window with a 30-day band gives p = 0.286 — one corroboration test scored 1.00× chance and
read as "40% corroborated". And a calendar-month duplicate rule on a job whose run day crosses the
month boundary **inflated the count by roughly 2×** (516 → 259). Both already folded in; **the second
applies to every monthly entitlement type, not just anti-attrition.**

### E8. Free text is the only record of things, and the audit may not read it freely

The `NOTE_REASON` field carries amounts, cancellation reasons, manual-payment notes — **and at least
one passport number**. It is simultaneously the richest evidence in the table and the thing the audit
is least permitted to use. Folded in as the **proportionality rule**: shapes before rows, counts
before text, and a documented refusal when the exposure exceeds the finding.

---

## The honest one-paragraph answer

**A full audit needs one grant, four ingestions, eight business answers, and a runnable artefact.**
What it needs *first* is neither: it is the two structural repairs above — **population-level tests**
and **note history** — because without them the audit cannot see a whole class of defect no matter how
many grants it gets, and cannot tell whether anything it looks at is what was originally written.


---

# 🔴 REVISION, 2026-09-08 — the grant landed, and it reframes the ledger

**A1 is no longer the answer to "what is missing".** The expense grant arrived, the join proved exact,
and the result inverted the headline this ledger opened with.

## T4's domain is two fifths of the money, not ninety percent

`EXPENSE_ID → EXPENSES_REQUESTS.ID` matches **11,819 of 11,819 (100.0%)**. But only 11,819 of 17,576
ADDITION notes carry one. **AED 4,359,589 of AED 7,197,642 — 60.6% — has no expense request behind it
at all.**

And the split is **structural, not random**. Whole payment types are all-or-nothing:

| Never expense-backed | Notes | AED |
|---|---:|---:|
| MV Prorated Salary | 770 | 788,069 |
| Raffle Prize | 576 | 180,000 |
| Prorated salary | 619 | 98,836 |
| Forgive Deduction | 1,060 | 53,325 |
| Last Day CC Switch Adjustment | 213 | 13,616 |
| Office Work Addition | 96 | 29,684 |
| **Airfare Ticket — 95%** | 1,565 of 1,655 | **2,588,000** |
| **Bonus — 71%** | 844 of 1,205 | 605,275 |

| Always expense-backed | Notes | Linked & PAID |
|---|---:|---:|
| Anti-attrition Incentive | 9,167 | 9,165 |
| Salary Dispute | 1,084 | 1,073 |
| Taxi Reimbursement | 503 | 503 |
| Maids.at other expenses, Medical, MOHRE, Accommodation Relocation | all | all |

**This maps exactly onto the twenty creation paths from conv. 46017.** `ProRatedSalariesService`,
`AsyncService`, `PayrollGroupService`, `NegativeSalariesService`, `syncSigningBonus` and
`MigrationController /housemaidScheduledAnnualVacations` all write notes **directly in payroll**,
computing the amount from salary maths — they never touch accounting.

## What that means for the audit

🔴 **T4 — "is there an authorised expense behind this payment" — is not the audit's central test. It
is one of two, and it governs the smaller half.** For 60.6% of the money the question is not *was an
expense approved* but *was the computation right*: salary history, contract dates, raffle
participation, day counts.

The ledger opened by saying one grant was ~90% of the uncovered money. **That was wrong.** The grant
unlocks 39.4%, exactly and verifiably. The rest was never blocked by access — it needs the group
rules, and those need the business answers, most of which Block D just resolved.

**M4's confidence floor is unnecessary where the FK exists** — no fuzzy matching, no first-match
hazard, no tolerance. It is still needed nowhere else, because unlinked notes have nothing to match.

## 🟢 V9 has no instances

**Zero notes across twelve months are attached to a REJECTED, DISMISSED or CANCELED request** — for
every payment type. 2,083 such requests exist, and none of them produced a surviving note.

**The mechanism conv. 46017 described is real and the exposure is nil in this window.** V9 drops from
RED-pending-confirmation to a **design observation**: nothing *would* stop it, and nothing has needed
to. Worth a guard, not a ticket.


## 🟢 N23 is a smaller ask than this ledger said

`HOUSEMAIDS_INFO_REVISION` turns out to be **a Hibernate Envers revision table already in the
warehouse** — `ID` + `REVISION` + a `*_MODIFIED` flag per column, 397 columns of it. So the ingestion
pattern for Envers history **already exists here and is already maintained**.

**N23 is therefore not "please build revision ingestion". It is "please do for `PayrollManagerNote`
what is already done for `HousemaidInfo`."** That is a materially cheaper ask than the one written
above, and it is the difference between the audit being able to tell a note that was born wrong from
one changed later, and not.

It also hands group A its missing piece: **the as-of-payment type join (E5b) is N17**, the
contract-type timeline. Group A was blocked on a business answer that turns out to be a revision table
nobody had looked in.


## 🟢 N17 is resolved and proven, and it corrected a finding by 97%

The as-of-payment join (E5b) ran clean: **zero notes fell into BLOCKED**, so
`HOUSEMAIDS_INFO_REVISION` covers the whole audit window.

**It also demonstrated why the join matters.** Read against current state, anti-attrition showed
**941 notes / AED 172,967** contradicting the code-verified CC-only rule. Read as of the payment date,
it is **22 notes / AED 5,526** — 915 of the 941 were maids who switched type *after* being paid.

**That is a 97% overstatement, and it would have been the audit's largest published finding.** The
same hazard applies to every changeable attribute the group rules depend on: salary, status,
live-out, contract type. Recorded as a dev-spec trap.

**Group A is unblocked.** N17 was filed as a business ask waiting for someone to define a
contract-type timeline; it is a revision table that was already in the warehouse, and the join is now
written and proven.
