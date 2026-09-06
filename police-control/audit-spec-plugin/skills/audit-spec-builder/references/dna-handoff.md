# Handing a spec to DNA

The spec is not the end of the pipeline. It becomes one or two tickets in the **DNA (Data &
Analytics)** Jira project, and DNA has a house shape. Everything here was read out of that project.

---

## The machine

**An intake bot reads every ticket before a human does.** It grades the ticket against a named
playbook, attaches a *filled* copy as an `.md`, posts the fill as a comment, recommends an issue
type, routes to a pillar manager, and writes `[MISSING → manager: …]` for anything unanswered —
stating an assumption on your behalf. Playbooks seen: `AE — New Snowflake Model`,
`AE — Bug Fix / Data Quality`, `AE — Business Logic Change`, `BI — New Dashboard / Large Scope`,
`BI — Add Element`, `BI — UI / Copy / Design`, `BI — Fix Bug`, `DE — New Pipeline`, `DE — Access`.

**Answer the playbook's fields in your own words and it grades Ready the same day.** The fields:
`TaskCategory` · `TargetSchemaOrDomain` · `ModelName` · `Layer` · `Grain` · `BusinessGoal` ·
`Consumer` · `SourceData` · `HistoricalBackfill` · `ColumnSet` · `DomainOnboarding` ·
`BusinessOwner` · `AcceptanceCriteria` · `Dependencies` · `OutOfScope` · `References`.

## Issue types — set them yourself

Jira automation re-types new tickets to " New Request" on creation. Nearly every ticket carries the
bot's correction. Set it up front:

| Type | For |
|---|---|
| `Analytic Engineer Task` | Snowflake model creation, silver/gold |
| `BI Visualization Task` | the dashboard |
| `Data Engineering Task` | ingestion, pipelines |
| `SnowFlake Access Request` | grants |

## The model always blocks the dashboard

A request needing both is split into `[Split from DNA-X] Analytic Engineering: …` and
`[Split from DNA-X] BI: …`, doctrine stated outright: *"SQL/model work always blocks the visual
build."* File them pre-split with the blocks link set.

Routing: AE → the analytics-engineering manager · BI → the BI manager · DE → the data-engineering
manager. `BusinessOwner` defaults to the reporter.

## Ticket shape that grades Ready

1. **What we need** — a paragraph, then the *narrow* ask in a blockquote. The framing that works:
   *"Everything it reads is already in `BA_VIEWS` and verified. No new object, grant, warehouse or
   pipeline is requested. So the ask is narrow: model the N metrics below from the objects we
   already read. The business logic is attached — you do not need to reverse-engineer it."*
2. **The metrics, by fixed name and id** — because every card and column carries the id, and
   *"two id systems on one page is how a reader ends up comparing figures that were never
   comparable."*
3. **What it reads** — a `D1…Dn` table, one row per object.
4. **The joins that exist and the ones that do not**, with measured coverage.
5. **A trap section** — the thing that silently produces wrong numbers, with the cost quantified.
6. **Data asks, marked non-blocking**, with a "what it unlocks" column.
7. **What needs a decision, not engineering.**
8. **Sensitivity — "so it does not stall at intake."**
9. **Attached** — a table of `.md` attachments, one marked *"Start here."*
10. **Not a duplicate** — every adjacent ticket by key, with status and why it does not overlap.
11. **Done when** — acceptance criteria.

## Four rules with teeth

**Acceptance criteria must be numeric.** A correct fix was bounced because the criteria said counts
should rise *"materially"* without a target: *"almost any increase could technically pass."* Write
`COUNT(*) − COUNT(DISTINCT ID) = 0`, not "the grain holds". Give an expected magnitude with the
measurement it came from, so a wrong build is visible.

**A Claude artifact link is not readable by the intake bot.** It is logged
`[UNVERIFIED — link not readable by the bot] (not a Google Drive/Docs/Sheets URL)` and the bot falls
back to the description. **Restate the layout in the description**, or put the mockup in Drive.

**Attach the detail as in-ticket `.md`.** Convention: `DNA_ATTACHMENT_source_tables.md` (marked
"Start here"), `DNA_ATTACHMENT_verification_queries.md` (every measured figure with the query that
produced it, aggregate only, controls first), and the spec itself.

**Search the project before speccing.** A defect independently found while writing one spec had
already been filed *and fixed* by the data team, with production measurements that corrected two
rules in that spec. Search the tables you intend to read, not just the subject.

## Length

Median description on recently-resolved tickets is **785 characters**; 16% exceed 3,000 and 2%
exceed 8,000. Long tickets do ship — one reached Done at 15,730 characters and another, with 13
headings, 10 tables and explicit acceptance criteria, went to a merged MR at 6,999. **Length is not
the risk; being long *and* shapeless is.** Push detail into attachments and keep the description
structured.

## The thing no ticket craft can fix

Check the queue before assuming a good ticket will move. On one read, every ticket from one
department sat at the lowest priority, all filed the same day, none moved — all graded *Ready*, all
assigned, one parented into a live epic. Nothing was blocked on information. **A better-written
ticket does not change a priority problem**; say so plainly rather than writing a fifth ticket into
the same queue, and escalate any access request separately, since those gate everyone else's
verification.
