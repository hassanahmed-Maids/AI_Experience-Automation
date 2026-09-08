# Filing pack — Manager Notes Audit

Everything that has to reach somebody else before this audit can run. Grouped by **who receives
it**, so each conversation is one list.

Compiled 2026-09-07, revised 2026-09-08. The per-item registers this pack used to carry — the
outstanding asks, the ERP questions and the payroll decisions — have been removed from the specs, so
what remains here is only the handful of things that need a person to act rather than a team to
answer.

---

## Do these three first

They unblock more than everything else combined, and none of them is engineering work.

| # | What | To | Unblocks |
| --- | --- | --- | --- |
| 1 | **Two Snowflake grants** — a warehouse, and SELECT on the expense view | Data platform | Every query. Nothing has ever run |
| 2 | **Escalate DNA-9437** | Belal Alsayed | Two SQL statements, zero activity since 3 Sep, gates three of Ticket 1's acceptance criteria |
| 3 | **Priority conversation, not a ticket** | Belal Alsayed (AE), Walid Al Kassar (DE) | Five P&C tickets sit at *Not Urgent* with no movement. A sixth queues behind them |

---

## 1 · Data platform — access

**Two grants, not one.** Verified 2026-09-07: `SHOW WAREHOUSES` returns **zero rows** for
`PAYROLL_AND_MONEY_CONTROL_ROLE`; `SHOW GRANTS TO ROLE` returns 668 grants — 426 view SELECTs,
USAGE on 5 databases and 40 schemas, and **no warehouse**.

```sql
-- an outstanding ask · without this no query runs at all
GRANT USAGE  ON WAREHOUSE <name>
  TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;

-- an outstanding ask · without this a warehouse still leaves 7 payment types unauditable
GRANT SELECT ON VIEW BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS
  TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;
```

The second is the one people miss. The schema already has USAGE, but the only view SELECT-able in it
is `TRANSACTIONS` — so the whole CORR archetype (reimbursements, salary corrections, the expense
match rate) stays blocked on permissions rather than on data.

**Also worth saying in the same message:** P&C having no warehouse is why this spec ships with
catalogue metadata as evidence instead of rows. It is a standing condition, not a one-off.

---

## 2 · DNA — Jira

### The two tickets

| File | Type | Notes |
| --- | --- | --- |
| `TICKET-1-AE-manager-notes-audit.md` | **`Analytic Engineer Task`** | File first |
| `TICKET-2-BI-manager-notes-audit-dashboard.md` | **`BI Visualization Task`** | File second, with Ticket 1's key in the blocker link |

Attachments, all on Ticket 1:

- `DNA_ATTACHMENT_source_tables.md` — **the one that matters.** Ticket 1 references §11 (payroll's
  business rules) and §12 (the nine check archetypes) in several places
- `SPEC_manager_notes_audit_DEV.md`
- `SPEC_manager_notes_audit_v2.md` — for the record

Everything below the `---` in each ticket file is the description. The block above it is issue type
and routing — set those as fields, don't paste them.

### Three mechanics that save a round trip

**Set the issue type yourself.** Jira automation re-types new tickets to "New Request" on creation —
it happened twice to DNA-9454 within a second of filing. Setting it correctly up front gets the right
playbook applied first time.

**Link them.** Ticket 1 **blocks** Ticket 2.

**The bot cannot read a Claude artifact link.** On DNA-9454 it recorded *"[UNVERIFIED — link not
readable by the bot]"* and fell back to the description. That is why Ticket 2 restates the whole
layout in prose rather than relying on the mockup link.

### Escalate DNA-9437 separately, and first

Two SQL statements. Zero activity since it was created on 2026-09-03. It gates *Done when* 1, 2 and 8
on Ticket 1 — the grain check, the population size and the note-type check — so without it neither
side can evidence those criteria.

### Decide before filing

- **Write-back (Q6).** Ticket 2's status column is a write, which makes the dashboard a small
  application. In or out for the first release? Left blank, the intake bot will answer it with an
  assumption on your behalf.
- **Where the page lives.** Ticket 2 says it is deliberately *not* a section on the existing Payroll
  Dashboard and asks BI to name the placement. If you already know, say it and delete the question.

---

## 3 · Data team — ingestion and two defect reports

| # | Ask | Blocks |
| --- | --- | --- |
| **O3b / N12** | **The five raffle tables** — `RaffleDrawParticipant` (`draw`, `housemaid`, `isWinner`, `winOn`, `prize`, `points`), `RaffleDraw` (`drawDate`, `status`), `RaffleDrawPrizeGrand` (`worth`, `isGrand`), plus `RaffleTicketLog` and `RaffleDrawLog`. ERP module `magnamedia-housemaid-management`, package `com.magnamedia.entity.raffledraw`. **Zero** objects matching `%RAFFLE%`, `%PRIZE%` or `%DRAW%` exist account-wide. Newly found 2026-09-08 — this single ingestion takes `raffle_prize` from unverifiable to fully checked, with no business decision needed | **all of group F** — the only thing blocking it |
| **an outstanding ask / N13** | **One column: expose `INCENTIVE_AMOUNT` on `HOUSEMAID_MANAGERACTIONLOGS`** (ideally `INCENTIVE_REQUEST_DATE` and `CONTRACT_ID` too). The view is already granted and already has `ACTION_TYPE`/`HOUSEMAID_ID`/`ACTION_DATE`; its `AMOUNT` maps to `DEDUCTION_AMOUNT`, not the incentive amount. **The cheapest ask on this page** — it turns AED 1.8m/year of payments from unverifiable into recomputable | group B tests B4 and B5 |
| **an outstanding ask / N17** | **Contract-type timeline per maid** — every CC/MV interval with dates. `HOUSEMAIDS_INFO_REVISION` has exactly the right columns (`OLD_HOUSEMAID_TYPE`, `HOUSEMAID_TYPE`, `SWITCH_HOUSEMAID_TYPE_DATE`) and **all of them are empty**. Two working routes exist: `mmdb.housemaids_revisions` (the VISA models already read it for `FIRST_HOUSEMAID_TYPE`), or the `to_type` column behind `BI_HOUSEMAID_STATUS_LOGS` | the ELIG archetype — 9 payment types |
| **an outstanding ask / N19** | **`live_out` flag, effective-dated.** `HOUSEMAID_TYPE` does not carry it; the gold layer derives `CC Live In / CC Live Out / MV` from a separate flag | Accommodation Relocation, Live-out Transportation Assistance |
| **an outstanding ask / N18** | **A row-level loan source.** No raw or silver loans table exists — only three aggregated gold views | the PAIR archetype — 5 payment types |
| **an outstanding ask / N10** | **Effective-dated salary history.** Candidate: the `mmdb` revision tables | the RECOMP archetype — 8 payment types |
| **an outstanding ask** | **Read the addition-reason picklist**, and `HousemaidPurposesForBonusAdditionalDescription`. The payment-type list is incomplete and the warehouse's own category profile is truncated — this is what closes it | knowing what we are auditing |
| **N4 / R5** | **Expose `EXPENSE_ID` downstream.** It is used inside `HOUSEMAID_MANAGER_NOTES`' own join but never selected | the CORR archetype, alongside the grant above |

**Two defects to report independently of this audit.** Neither is ours to fix and both affect
other consumers:

- **X1** — `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a
  **manager-note id** while that column is documented as a **housemaid id**. Ranges overlap, so a
  wrong reading matches rows and raises no error. (DNA-9464 fixed this instance: 1 of 8,632 matched
  before, 7,878 after.)
- **X2** — `HOUSEMAID_MANAGER_NOTES` may emit more rows than there are notes, and its `MANAGER`
  column is entirely NULL because `EMPLOYEE_MANAGER_ID` is unmapped in the JPA entity.
