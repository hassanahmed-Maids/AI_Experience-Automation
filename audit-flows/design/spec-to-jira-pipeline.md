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
C. build         → Build-the-n8n-Flow prompt / erp-audit-flow-builder  [autonomous, phases 1–7]
D. self-test     → the spec's five real cases, run against the flow    [autonomous]
   ⟨gate: sign-off — a human reads the result before it leaves staging⟩
E. jira draft    → deployment ticket from the company n8n template     [autonomous, DRAFT only]
   ⟨gate: human posts⟩
F. write back    → Jira Task Link + Status 3 → 5, add a Flow Versions row
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
4. **`deploy-task-writer` agent** + `/draft-deploy <name>` → the Jira body (E).
5. **`/close-build <name>`** → write-back after approval (F).

Steps 2 and 5 are new; 3 and 4 are wrappers around prompts that already exist. Start at 1 and 2 —
they need no ERP token, so they are testable today.
