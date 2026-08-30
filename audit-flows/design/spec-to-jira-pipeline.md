# Spec → build → Jira: an agent pipeline for the Audit Flow Factory

**The short answer: most of this already exists, and the missing piece is not the builder —
it is a readiness gate in front of it.** The Factory already defines the queue, the template,
the skeleton, the variables databases and the delivery stages. What is absent is anything that
checks a spec is *actually buildable* before a build starts, and anything that closes the loop
back onto the tracker afterwards.

## What already exists (so we do not rebuild it)

| Piece | Where | What it gives the pipeline |
|---|---|---|
| **Six `Checks — <Category>` databases** | one per category page, 39 rows | The work queue, and the place results are written back |
| **`Status`, six ordered stages** | on every check row | Stage 3 *Spec'd — pending build on n8n* **is the build queue**; stage 5 *On Jira pending production* is the exit |
| **`Jira Task Link`** | on all six databases | Stage 5 already has a home for the ticket |
| **New Check — Template**, questions 0–12 | Factory page | A fixed, machine-checkable spec shape |
| **Build the n8n Flow — Prompt** + **Skeleton Contract** | Factory page | The builder. Claude *clones* the golden skeleton and generates only variable nodes |
| **ERP Variables Database** | workspace-wide | Every field a check reads, with `Category`, `Check`, `Default Value` |
| **ERP APIs — Response Shapes** | workspace-wide | What each endpoint returns |
| **Flow Versions** (`Skeleton Version`) | workspace-wide | Which live flows still carry a plumbing bug after a skeleton fix |
| **`audit-daily-report` skill** | `~/Desktop/audit-daily-report/` | Already reads all six databases and counts stages — the inventory half is built |

## The pipeline

```
A. inventory     → read 6 Checks DBs, list everything at Status 3      [autonomous, cheap]
B. READINESS     → per spec: is it actually buildable? → buildable | blocked+reasons
                                                                       [autonomous — THE NEW PIECE]
   ⟨gate: ERP token, once per session⟩
   ⟨gate: approval to run against production ERP⟩
C. build         → Build-the-n8n-Flow prompt / erp-audit-flow-builder  [autonomous, phases 1–8]
                    → Tech Owner = Hassan at START; Status → 4 Staging at END
D. END-TO-END RUN → scoped run → results workbook, tab for this run    [autonomous]
E. ACCEPTANCE     → the spec's five verified cases must appear with the
                    verdicts the spec predicts, + the run's own guards  [autonomous, PASS/FAIL]
   ── hand the workbook URL to the spec owner ──
   ⟨GATE: spec owner validates the results⟩
F. jira draft    → deployment ticket from the company n8n template     [autonomous, DRAFT only]
   ⟨gate: human posts⟩
G. write back    → on the operator's word: Jira Task Link + Status 4 → 5,
                    add a Flow Versions row          (see Status and ownership protocol)
```

### B is the piece worth building first

Today a check sits at *Spec'd — pending build* because a person judged it ready. This session is
the argument against trusting that:

- **D15** — the defect report said "include the live-out cohort and its two card prices". Both
  were already there; the scorer produced live-out cohorts and Stage 1 aborts unless the card
  carries five. Two days of stated work that did not exist.
- **The route ban** — thirteen paginated ERP routes were banned on 25 Aug for specs *and* flows.
  No spec had been swept. Every flow on disk broke it, and three depend on a route with **no
  alternative** — an ERP-team dependency nobody had surfaced.
- **The Cases table** — CC Price's case store is last-write-wins, so a run's per-case evidence
  does not survive the next run. Nothing in the spec says so.

All three are machine-checkable *before* a build. The readiness agent asserts, per spec:

1. **Questions 0–12 all answered** — the template numbering is fixed, so this is mechanical.
2. **Question 9 present and human-verified** — five real cases. The Factory's own callout:
   *"a flow validated against invented data is worse than an unvalidated one, because it looks
   tested."* No cases → not buildable, full stop.
3. **Every ERP field it reads exists in ERP Variables Database** with `Category`, `Check` and
   `Default Value` filled — step 3 of the Factory's own four steps, currently unenforced.
4. **Every API it names appears in ERP APIs — Response Shapes** *and* **is not on the dead-end
   route ban list**. A spec naming a Section A route (no alternative) is blocked at the gate with
   the ERP-team ask named, rather than discovered mid-build.
5. **Question 8 names a reviewer** — the maker/checker the skill's third human gate needs.
6. **Skeleton drift** — if a flow already exists, compare its `Skeleton Version` to current and
   report the gap.

Output: one row per queued check, `buildable` or `blocked` with the failing assertion. That
alone converts "39 rows and a hope" into a real queue.

## D + E — the end-to-end run and what makes it pass

### Scope the run. Do not sweep the population to prove a flow works.

A full-population run is not a test, it is a load event. MV Monthly is ~23,000 contracts × 2
ERP reads; a sweep of that shape took the whole `clientmgmt` module to nginx 503 on
2026-08-19, and the flows still carry pacing and circuit breakers written in response. The
end-to-end run is therefore **the five spec cases plus a bounded sample**, and a full run
happens only when someone asks for one.

### The acceptance test is the five cases, mechanically

Question 9 requires five real cases *verified in the ERP by a human first*, and the Factory is
blunt about why: *"a flow validated against invented data is worse than an unvalidated one,
because it looks tested."* Today that is a rule people follow. Stage E makes it a gate:

**Each of the five cases must appear in the results workbook, with the verdict the spec
predicts.** Missing, or present and disagreeing → FAIL, and the check does not advance. No
override that isn't written down.

Alongside that, assert the run's own guards actually fired — these are the failures this
session found in already-"finished" flows:

- population reconciled (declared == collected), no circuit-breaker trip;
- the run row persisted and reads back;
- the verdict counts reconcile to cases written, or any shortfall is **declared** rather than
  left for a reader to find by subtraction;
- no case ships with an unanswered verifier;
- the flow calls no route on the dead-end ban list.

### The results workbook

One workbook per check, **a tab per run** — not a new spreadsheet per run. Two reasons:

1. **Permissions.** There is no Drive tool in this pipeline; n8n's Sheets node writes rows, it
   does not grant access. A per-run spreadsheet would need a sharing step nobody can automate
   here. A single workbook per check, shared once with the audit team and that check's owner,
   removes the problem and gives the owner one stable link.
2. **This session's lesson.** CC Price's case store turned out to be last-write-wins — a later
   run silently re-stamped an earlier run's rows, so its per-case evidence no longer exists.
   A workbook that overwrites would show the spec owner *a different run than the one they
   were asked to validate*. The run's tab must be immutable once written.

Question 8 already sets the privacy boundary and it is exactly right for this: salaries, IBANs
and contact details **never leave the workbook**. So per-entity detail lives in the workbook and
nowhere else — the Jira ticket, the chat summary and the Notion row carry counts, flags and
totals only. Sending the owner a *link* is the design, not a convenience.

### Closing the gate mechanically

The validation currently has nowhere to live: `Status` jumps from 4 *Built on n8n — Staging* to
5 *On Jira pending production* with no evidence in between. Add three fields to all six
`Checks — <Category>` databases — precedented, since `Jira Task Link` was added to all six at
once for exactly this reason:

| Field | Why |
|---|---|
| `Results Workbook` (URL) | what the owner was sent |
| `Results Validated By` (person) | who validated — should match question 8's reviewer |
| `Results Validated On` (date) | when, so a stale validation against an older build is visible |

**Stage F refuses to draft a Jira ticket unless all three are set**, and refuses if
`Results Validated On` predates the build. That makes the gate a property of the pipeline
rather than a convention people remember.

## Status and ownership protocol (standing rule — Hassan, 2026-08-30)

The Factory's `Status` is a seven-stage ladder. Three of its transitions belong to the pipeline,
and they happen at fixed moments — not at whoever-remembers time:

| Moment | Field | Value |
|---|---|---|
| **Build starts** (stage C begins) | `Tech Owner` | **Hassan Ahmed** (`29ad872b-594c-8199-9944-00028180ebfc`) |
| **Build finishes** (flow exists in staging) | `Status` | `Built on n8n — Staging` |
| | `n8n Staging Link` · `Flow Version` · `n8n Version` | filled in the same write |
| | `check_id` | **never minted** — Security Room portal id, see below |
| **Operator says the Jira prod-deployment task exists** | `Status` | `On Jira pending production` |
| | `Jira Task Link` | the ticket URL the operator gives |

Three properties of this rule that matter:

- **The Tech Owner is assigned at build start, not at build end.** A half-built flow with no owner
  is how the three flows in staging today ended up sitting at *Spec'd — pending build* while
  running. Ownership is what makes an in-flight build visible.
- **`Built on n8n — Staging` is written by the pipeline, the moment the build lands.** It is a
  statement of fact about where the code is, not a claim that it is correct — stages D and E
  (the scoped run and the five-case acceptance test) still have to pass, and the results-validation
  fields still gate stage F.
- **`On Jira pending production` is never inferred.** The pipeline does not create the Jira ticket
  and does not decide when one exists. The operator says so and supplies the link; only then does
  the status move. This is the same posture as *Jira: draft, do not post* below — the ticket is a
  human act, and the status follows the human, not the other way round.

**`check_id` is not the pipeline's to assign.** It is the check's id in the Security Room portal
and exists only for checks that deliver there — the Wellcare row records the rule verbatim:
*"n/a — this check has no Security Room delivery … Assign one only if it is ever pointed at the
portal."* A minted id would not resolve. It is also a different namespace from the `check_id` slug
the flows stamp into their own Runs tables (`applicant-real-ticket`, `mv-monthly-payment`); never
copy one into the other.

`Live on Production` and `Retired` are outside the pipeline entirely.

**`/audit-queue` still writes nothing.** The gate reports; the build command writes. Keeping the
read-only stage genuinely read-only is what lets it be run at any time against every row without
a second thought.

## Where it cannot be autonomous, and why not to force it

The builder skill names its own ceiling, and the Factory adds a fourth:

1. **The ERP token** — one paste per session. Nothing in the flow can mint it.
2. **Genuinely undecidable business rules** — where the spec is silent, guessing is the failure
   mode these checks exist to avoid.
3. **Sign-off before production, publishing or scheduling.** The skill is explicit: *"Build
   completion is not approval."*
4. **The five test cases must be human-verified in the ERP first.**

So the honest shape is **autonomous between gates**, not unattended end to end — the same
posture as System 2 in `CLAUDE.md`, which already runs gated stages and has held up.

The evidence from this session is blunt: fourteen flow changes were built, unit-tested and
re-read, and **not one was executed against real data** because no token existed. A pipeline
that builds without running produces confident, untested flows at a rate no human can review.
Stage D is what stops that, and it is the stage that needs the token.

## Jira: draft, do not post

`createJiraIssue` is available, but creating a ticket is outward-facing and hard to retract. The
existing precedent in this repo is the right one: System 2's `golive-dev-task-writer` produces
polished markdown that a human posts. Recommend the same here — generate the ticket body from
the company n8n deployment template, show it, and only on approval create the issue, write
`Jira Task Link` back, move `Status` to 5, and add the `Flow Versions` row.

Auto-posting is a one-line change later if the drafts prove reliable. Starting there is not.

## Scheduling

A daily Notion poll is fine and already precedented by the 07:00 daily report. **No recurring
Snowflake** — org policy routes recurring data processes to the ERP team, and the builder skill
repeats it: *"never set up recurring or scheduled data pulls as part of a build."* Any warehouse
validation in stage D stays ad hoc.

## One defect to fix before automating on top of it

The `erp-audit-flow-builder` skill says, in bold, **"Read `references/erp-and-n8n-traps.md`
before Phase 1"** — and that file does not exist. The synced skill directory contains only
`SKILL.md`. Every run today silently skips its own trap list, and every item in it was reportedly
learned the hard way. Automating a builder whose first instruction is a dead link multiplies
whatever that file was meant to prevent.

The skill also lives in synced personal scope, not in a repo — so it is not versioned with the
work and cannot be reviewed in a PR. Moving it (with its references) into `.claude/skills/` here
would fix both.

## What to build, in order

1. **Fix the missing `references/` file** and move the skill into the repo.
2. **`readiness-auditor` agent** + `/audit-queue` command → the inventory and the gate (A + B).
   Read-only, no token, immediately useful on all 39 rows.
3. **`/build-check <name>`** → wraps the existing Build-the-n8n-Flow prompt (C + D).
4. **`results-validator` agent** + `/validate-run <name>` → stage D + E: the scoped run, the
   workbook tab, the five-case acceptance test, and the URL to hand the owner.
5. **Add the three validation fields** to all six Checks databases.
6. **`deploy-task-writer` agent** + `/draft-deploy <name>` → the Jira body (F), refusing unless
   the three fields are set and the validation post-dates the build.
7. **`/close-build <name>`** → write-back after approval (G).

Steps 2, 4, 5 and 7 are new; 3 and 6 wrap prompts that already exist. Start at 1 and 2 — they
need no ERP token, so they are testable today. Step 5 is a five-minute Notion change and
unblocks 4 and 6.
