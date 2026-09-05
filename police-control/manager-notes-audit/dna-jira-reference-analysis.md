# How DNA requests get written, routed and delivered — and what it means for this one

Read of the DNA (Data & Analytics) Jira project on 2026-09-05: ~170 dashboard/audit/payroll
tickets scanned, 8 read in full with their comment threads, plus the two tickets that already
touch the exact tables this audit reads.

---

## 1. The shape of the machine

**Every ticket is read by an intake bot before a human touches it.** The DNA Bot grades the
ticket against a named playbook, attaches a *filled* version of that playbook as an `.md`
attachment, and posts the fill as a comment. Observed templates:

| Playbook | Used for |
|---|---|
| `AE — Template — New Snowflake Model` | new silver/gold modelling |
| `AE — Template — Bug Fix / Data Quality` | a broken model |
| `BI — Template — New Dashboard / Large Scope` | a new dashboard or a big change |
| `BI — Template — Fix Bug` | a broken chart |
| `DE — Template — New Pipeline` | getting data in |
| `DE — Template — Access` | grants |

**The bot fills these fields**, so a ticket that answers them in its own words gets graded
"Ready" and routed the same day; one that doesn't gets `[MISSING → manager: …]` notes and an
assumption stated on your behalf:

`TaskCategory` · `TargetSchemaOrDomain` · `ModelName` · `Layer` · `Grain` · `BusinessGoal` ·
`Consumer` · `SourceData` · `HistoricalBackfill` · `ColumnSet` · `DomainOnboarding` ·
`BusinessOwner` · `AcceptanceCriteria` · `Dependencies` · `OutOfScope` · `References`
— then an *Extra information* block: **Data · Code · Checks run · Known constraints**.

**Issue type matters and almost everyone gets it wrong.** Ticket after ticket carries the
bot's line *"It was filed as 'New Request' but it is a 'Analytic Engineer Task' — I recommend
re-typing it."* The types that exist:

| Type | Meaning |
|---|---|
| **Analytic Engineer Task** | "Snowflake data model creation (silver/gold layers) for end-user consumption" |
| **BI Visualization Task** | the dashboard itself |
| **Data Engineering Task** | pipelines, ingestion |
| **SnowFlake Access Request** | grants |
| **Alert Requests**, **Anomaly Detection**, **AI/LLM Engineer Task** | other pillars |

**Combo tickets are split, and the model always blocks the dashboard.** A request needing both
model and dashboard becomes `[Split from DNA-XXXX] Analytic Engineering: …` and
`[Split from DNA-XXXX] BI: …`, with the bot's doctrine stated explicitly on DNA-8967:
*"SQL/model work always blocks the visual build."* The BI child sits On-Hold until the AE
parent merges.

**Routing and ownership.** AE → Belal Alsayed · BI → Eddy Elrahi · DE → Walid Al Kassar.
`BusinessOwner` defaults to the reporter. Two repos: `data-team/medallion-dbt-snowflake` (models)
and `data-team/datahouse-ui` (dashboard). Work lands as a branch named for the ticket, then a
merge request, then a human approval comment.

**Workflow states:** To Do → Pending BA → Pending Approval → Ongoing → Under Review →
Pending Deployment → Done. "Done" here means merged, not necessarily visible.

---

## 2. What a request that gets built actually looks like

The strongest model in the project is **DNA-9454** — Police & Control's applicant ticketing
audit, filed by Abdullah Mahdi, graded "Ready" by the bot within eight minutes. Its section
order, which is worth copying wholesale:

1. **### What we need** — one paragraph, then a blockquote containing the *narrow* ask.
   Its framing is the reason it passed intake cleanly: *"Everything it reads is already in
   `BA_VIEWS` and verified. No new object, grant, warehouse or pipeline is requested. So the
   ask is narrow: model the eleven metrics below from the seven objects we already read.
   The business logic is attached in full — you do not need to reverse-engineer it."*
2. **The metrics, by name, with fixed ids** — and the reason they are fixed:
   *"Every card, tab and column carries its metric id. Two id systems on one page is how a
   reader ends up comparing figures that were never comparable."*
3. **### What it reads** — a `D1…Dn` table, one row per object, each stating what it gives.
4. **The joins — what exists and what does not**, with measured coverage percentages.
5. **A trap section** — theirs is *"read the stamped field, not the config"*, with the cost of
   getting it wrong quantified: *"about 239,000 gaps worth AED 240M, every one of them a config
   edit rather than a finding."*
6. **### Three data asks, none of them blocking** — `N` refs with a "what it unlocks" column.
7. **### One thing that needs a decision, not engineering** — the human calls, named.
8. **### On sensitivity — so it does not stall at intake.** Pre-empts the objection.
9. **### Attached** — a table of the `.md` attachments, marked *"Start here."*
10. **### Not a duplicate** — every adjacent ticket checked by key, with its status and why it
    does not overlap. The project has real duplicate anxiety; DNA-9454 even names a competing
    spec in Drive and says *"It must not also be built."*
11. **### Done when** — acceptance criteria as bullets, at the grain the model must support.

Three practical rules that fall out of the threads:

- **Attach `.md` files in-ticket.** The convention is `DNA_ATTACHMENT_source_tables.md`,
  `DNA_ATTACHMENT_verification_queries.md`, `SPEC_<name>_v5.md`.
- 🔴 **A Claude artifact link is not readable by the intake bot.** On DNA-9454 the bot recorded
  the mockup as *"[UNVERIFIED — link not readable by the bot] (not a Google Drive/Docs/Sheets
  URL); the ticket description's own restatement of card/tab/metric-id structure is treated as
  the working spec instead."* The layout must be restated in the description, or put in Drive.
- **Show the query behind every measured number.** `DNA_ATTACHMENT_verification_queries.md` is
  described as *"every measured figure in the spec with the query that produced it and the
  result it returned. Aggregate only. Controls first, with an instruction to stop if they do
  not reproduce."*

DNA-9464's escalation is the counter-example, and the lesson is sharp. Belal rejected an
otherwise-correct plan because *"the acceptance criteria only state that the counts should
increase 'materially', without specifying an expected target. This makes it difficult to
validate the implementation, as almost any increase could technically pass."* **Vague
acceptance criteria get a plan bounced even when the fix is right.**

---

## 3. What the tickets tell us about our own tables

This is the part that changes our spec.

### DNA-9464 — the defect we found independently is real, and is fixed

We flagged `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` as joining
`EXPENSES_REQUESTS.RELATED_TO_ID` to a **note id** when the column holds a **housemaid id**.
Mohammad Sharani filed exactly that on 2026-09-03 with the same ID-range evidence, and Hadi
AlMumayez fixed it: `epm.related_to_id_text = to_varchar(n.housemaid_id)`.

**Measured impact, on production:** the old join matched **1 of 8,632** addition notes in a
six-month window; the corrected join matches **7,878**. Status: Pending Deployment.

Two consequences for us. The model is being repaired, so *"do not source from it"* becomes
*"do not source from it until DNA-9464 deploys"*. And our own heuristic already keys on
`RELATED_TO_ID = note.HOUSEMAID_ID` — the same key the fix adopts. That is now a
production-validated route rather than our inference.

### The multiple-candidate problem is real, at scale, and already bit someone

Our M4 blocks a note when several expense requests match, on the argument that taking the first
manufactures the answer. DNA-9464's thread is that argument playing out in production:

> *"the upstream step keeps only the maid's most recent expense request, so an addition inherits
> that request's payment method rather than its own. **7,020 of 7,878 matched notes belong to
> maids with multiple requests, and 3,473 of those (1,352 maids) used both Cash and WPS** — so
> those rows may sit on the wrong side of the split."*

**89% of matched notes belong to a maid with more than one candidate request.** Our confidence
floor and the multiple-candidate block are not conservatism; without them the report is wrong
for the overwhelming majority of rows.

The fix Hadi shipped is also the answer to how the link should be made: *"Each addition now
takes the payment method from its own expense request, **using the reference already recorded on
the note**"* — confirming a usable per-note reference exists, which is our N4.

### "Direct adjustment" answers N16 for two payment types

From the same thread:

> *"Additions booked straight onto the salary with no payment behind them — **mainly Airfare
> Ticket and Office Work Addition** — now appear as a third method, Direct adjustment, per your
> call. **565 of them across the last six months.**"*

This is a direct answer to N16 (*which payment types always carry an expense record*): **airfare
and office-work additions legitimately have none.** Had we built T4 without that, every
flight-home payment would have been red-flagged "no basis" — a fabricated finding on the single
largest group in the audit.

### Volumetrics corroborated

~8,632 addition notes in a six-month window ≈ **1,439/month**, against the ~1,300/month the
business case states. The population is the right order of magnitude, independently.

### A dashboard section already exists here

There is a **Payroll Dashboard** on Maids Insights (route `housemaid-payroll`) with a section
*"Additions to the maid's salaries"*, including *"Additions as Loans by Category"* and
*"Categories by Additions added as Loans"*, plus an "Additions by Category" section tracked
separately. So our request must state where it sits relative to that, or intake will ask.

### Related tickets to cite in "Not a duplicate"

| Key | What | Status | Relationship |
|---|---|---|---|
| **DNA-9464** | join-key fix on the additions GOLD model | Pending Deployment | our X1; we build on the corrected key |
| **DNA-9465** | the additions-as-loans charts were querying the wrong table | Pending Deployment | same dashboard section, different defect |
| **DNA-9437** | warehouse USAGE for `PAYROLL_AND_MONEY_CONTROL_ROLE` | To Do | already filed; why our figures are catalog-derived |
| **DNA-9446** / **DNA-9449** | payroll audit — ingest the two archived monthly files | To Do | sibling P&C payroll check, different population |
| **DNA-9454** / **DNA-9455** | applicant ticketing audit, eleven P&C metrics | To Do / On-Hold | sibling P&C audit, different population; the format model |
| **DNA-7074** | the "most recent expense request" filter | Done | the upstream cause of the payment-method mis-attribution |
| **DNA-9133** | anomaly detection on Additions by Category | Ongoing | same measure, different purpose |

---

## 4. What we should change before filing

1. **File it as two tickets, or expect the bot to split it.** An *Analytic Engineer Task* for
   the note-level model and the group rules, and a *BI Visualization Task* for the dashboard,
   the second blocked on the first.
2. **Restate the layout in the description.** The artifact link will be marked UNVERIFIED.
3. **Attach the specs as in-ticket `.md`**, with a source-tables doc marked "Start here".
4. **Give every metric a fixed id and name**, as DNA-9454 does — ours already carries M1–M14.
5. **Make "Done when" numeric.** Not "the match rate is published" but "M13 computes per payment
   type and the 80% floor is applied per type"; not "assertions pass" but "G2 returns
   `COUNT(*) = COUNT(DISTINCT ID)` with zero difference". DNA-9464 shows a plan bounced for
   exactly this.
6. **Add the "Not a duplicate" table** above, and say plainly that this does not replace the
   existing Payroll Dashboard additions section.
7. **Answer the sensitivity question up front** — we already do, and DNA-9454 shows it is the
   right instinct: *"so it does not stall at intake."*
8. **Correct N16 now** using the Direct-adjustment finding, before someone builds T4 against it.
