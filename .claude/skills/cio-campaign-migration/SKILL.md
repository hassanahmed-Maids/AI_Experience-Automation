---
name: cio-campaign-migration
description: >-
  Build and verify a Customer.io campaign/journey from a finished Whimsical
  "Legacy vs CIO" board, then prove it behaves correctly with seeded fixtures,
  Snowflake, and DB ground truth before a human publishes it. Use this skill
  whenever the work involves turning a Whimsical board (a LEGACY — ERP side plus
  a CIO — DESIGN side) into a Customer.io campaign, critiquing/QA'ing a drawn CIO
  design, or verifying/tracing an existing Customer.io journey against Snowflake
  or ERP data — even when the user doesn't say "migration". Trigger on phrasing
  like "build this in customer.io", "build cluster N", "rebuild this automation",
  "the whimsical board/link for cluster N", "critique this flow", "trace the
  journey", "confirm it fires correctly", "check the trigger population", "does
  CIO match the ERP", "verify sends against Snowflake", "MV nudge", "overstay
  fine", "postponed", or a whimsical.com link paired with Customer.io. This is
  the AI Experience & Automation team's core build+verify workflow.
---

# Customer.io Campaign Migration — build + verify from a Whimsical spec

## What this skill is

Our department (AI Experience & Automation) migrates ERP broadcast automations
into Customer.io (CIO). Upstream, **System 1** (a separate multi-agent pipeline)
reads the ERP code and draws a combined Whimsical board — a `LEGACY — ERP` half
and a `CIO — DESIGN` half — plus a validated `cio-design.md`. System 1 does **not**
build in CIO. Downstream, **System 3** runs the built journey in shadow mode and
reconciles it to cutover.

**This skill is the build+verify layer between them.** Per cluster it:

1. **Interprets & critiques** the drawn CIO design into an unambiguous, *code-checked*
   build spec (`references/design-critique.md` + `references/reading-whimsical.md`) — or,
   when **no board exists**, derives the flow from ERP code as a fallback
   (`references/derive-from-code.md`).
2. **Builds** it in the CIO **test env**, as draft, following our conventions and
   the ERP-send webhook primitive (`references/building-cio.md`).
3. **Verifies** it behaves as specified — seeded-fixture tracing first, then shadow
   reconciliation — and hands a human a publish-ready record (`references/tdd-fixtures.md`
   + `references/verifying.md`).

The department docs (`CLAUDE.md` + `docs/*.md`, loaded as project knowledge) are
the constitution; this skill is the procedure that applies them to a build. When
they conflict, the docs win — and fixing the doc is part of the job (see Governance).

## Locked operating decisions (do not re-litigate)

- **Runs in Claude Code.** Real subagents (the master → per-cluster fan-out), a
  shell for `scripts/ask-code.sh` and `scripts/sf_query.py`, a filesystem for
  on-disk state, and the CIO + Whimsical MCP connectors.
- **Build in the CIO test env only** (workspace `216662`). A human publishes to
  prod. This skill never publishes and never flips a send live.
- **The canonical board is the exact Whimsical link the human hands you.** Fetch it
  by ID. **Never** title-search or folder-browse for it — the workspace has
  multiple draft copies of every journey (`Customer IO - MV Clients` and
  `MV Client Messages V2` are old drafts to ignore). See `references/reading-whimsical.md`.
  **Board-less exception:** if **no** board is provided and templates are named instead
  (`--templates A,B,C`), derive the flow from ERP code (`references/derive-from-code.md`)
  — this is a lower-assurance fallback that stands in for System 1; prefer a board whenever
  one exists.
- **Naming (required):** `CIO - <MV|CC> - <Clients|Housemaids> - Cluster <N> - <Journey> (<Owner>)`.
  Example: `CIO - MV - Clients - Cluster 13 - Ansari Salary Statement Delivery (Abdullah)`.
  The two other in-workspace schemes are legacy — do not create new campaigns with them.
- **A "send" is a webhook call to the ERP, not a native CIO/WhatsApp message.**
  Channel is passthrough — the ERP resolves the number and sends. The exact call
  is frozen in `references/erp-send-webhook.md`.
- **The data model drifts and the test env is not its mirror.** Read object-type
  ids, synced attributes, events, and segments **live** each run; treat the sync
  queries + object `sent_attributes` + prod as data-model truth, never the test
  env's polluted attribute/event lists. See `references/cio-platform.md`.

## Non-negotiable principles

- **Grounded, not assumed.** The drawn CIO flow may be wrong — do not trust it on
  faith. Every trigger population, attribute value, recipient resolution, and send
  claim is backed by `ask-code`, Snowflake, `mmdb`, or a fixture trace. The ERP
  code (`scripts/ask-code.sh`) is the only source of truth for send logic.
- **Independent verification.** The agent that declares a build correct must not be
  the agent that built it (our boards self-reported "clean" while overlapping —
  twice). The Verifier re-derives expected behaviour from the board + a fresh
  data-model snapshot **without** reading the Builder's transcript.
- **Surface uncertainty.** Carry every `Open Uncertainty` / "confirm at go-live" /
  `GAP` / `TBD_` from the board and the ERP-send body into the record and resolve
  it before hand-off. New gaps get added, never buried.
- **Never "done" until verified.** Built ≠ done. Done = fixtures pass, Layer-A QA
  passes, open uncertainties closed, migration record complete, and it's sitting in
  draft for the human to publish.

## The pipeline (master → per-cluster subagents)

The **master** takes the human's list of Whimsical links (one per cluster), caps
concurrency (ask-code / Snowflake load), and fans out one sub-pipeline per link,
passing the link **verbatim**. Each sub-pipeline runs four roles; the harness
wiring is in `harness/` (install into the **department repo's** `.claude/`, not a bare
repo — the roles need `scripts/` + `docs/` to ground). **Subagents must inherit the
Whimsical + Customer.io connectors** — the shipped agent files omit a `tools:` line on
purpose; adding one strips MCP access and the critic/builder can't reach the board or
CIO. The master runs a preflight (right repo? connectors reachable? agents un-restricted?)
and stops rather than dispatch a run that can't ground. Split by *independence*, not task
decomposition:

```
per cluster (one Whimsical link in):
  1. Design Critic   → interprets the board + re-checks the risky parts vs ask-code/
                       Snowflake → corrected build-spec.md + design-defect list
     ── HUMAN GATE ── you approve any design corrections before anything is built
  2. Builder (TDD)   → derives acceptance criteria from the spec FIRST, then builds
                       the campaign(s) in test env 216662 as draft, idempotently
  3. Verifier(blind) → re-derives expected behaviour independently; seeds fixtures,
                       traces them, checks renders/exits/population → verification report
     ── HUMAN GATE ── you publish to prod; System 3 shadow-reconciles downstream
```

Each stage reads the relevant reference when it enters that stage — don't hold all
of it at once.

## Frozen references vs live-pulled data

- **Frozen (stable, in this skill):** CIO trigger/flow/delay mechanics and the
  build-breaking gotchas (`references/cio-platform.md`); the ERP-send webhook call
  (`references/erp-send-webhook.md` + `assets/erp-send-template.json`).
- **Live-pulled each run (drifts):** object-type ids + synced object/relationship
  attributes, `event_names`, `segments` — snapshot them once per run to disk so the
  Critic, Builder, and Verifier share one ground truth (`references/cio-platform.md`
  § Live data-model snapshot).

## Output — the migration record (per cluster)

Keep a running record; it doubles as the publish artifact and the on-disk state a
fresh session resumes from:

```
# <CIO - MV - Clients - Cluster N - Journey (Owner)> — migration record
## Build spec              (Phase 1, code-checked)
## Design defects          (System-1 bugs found → feed back to System 1)
## Acceptance criteria     (per-branch: input values → expected send/exit)
## CIO build notes         (campaign/action/template IDs created in test env)
## Verification            (fixtures traced, counts, renders, Layer-A/B, pass/fail)
## Open uncertainties      (each: open / resolved + how)
## Publish decision        (ready-for-publish / blocked-by-X)
```

Also keep a one-line **status ledger** per target (`work/<target>/build-status.md`):
`cluster → critiqued / gate-passed / built / verified / ready-to-publish`. A fresh
session reads it to see the whole target at a glance.

## Definition of done (hand-off checklist)

- [ ] Every send exists as an ERP-send webhook with the correct `templateName`,
      `entityType`, and a fully-mapped `parameters` block — **no `TBD_`, no
      unresolved `{{ }}`, no blank param** (proven by a fixture render).
- [ ] Trigger/entry reproduces the ERP population (Snowflake count ≈ CIO entry;
      deltas explained).
- [ ] Every wait offset matches the spec (mind the clock-anchor fidelity note).
- [ ] Every exit (proceed / cancel / expiry / global) is wired and observed to fire.
- [ ] Fixtures for every branch land where the acceptance criteria say.
- [ ] All sends are `sending_state: "draft"` (never `automatic` in test — a live
      webhook fires the real ERP).
- [ ] Every `Open Uncertainty` / `TBD_` resolved or explicitly accepted by the owner.
- [ ] Migration record + status ledger updated and linked to the board.

## Governance (keep the skill from rotting)

- **Every Design-Critic finding is a System-1 defect.** Log it structured; it should
  improve System 1 over time and shrink what this gate must catch.
- **A correction isn't done until it's written into the file that caused it** —
  wrong CIO mechanics → `references/cio-platform.md`; wrong send shape →
  `references/erp-send-webhook.md`; wrong build step → `references/building-cio.md`;
  wrong domain understanding → the department `docs/`. Log judgment calls in
  `docs/decisions.md`.
- **Regression smoke test:** Cluster 1 (Postponed MV) is built and known-good.
  After any change to this skill, re-run it against Cluster 1 and confirm it
  reproduces the known-good build. That's how "perfect once, iterate later" stays true.

## Tooling quick reference

- **Whimsical:** `Whimsical:fetch(id, detail, scope, grep_text, image)` to read the
  board; `edit` IS available here (add/update/delete/find_replace + `auto_layout`) —
  the old "edit unavailable, one-shot create only" note is stale.
- **Customer.io:** `cio_prime` first, then `cio_schema` before any write; `cio_read_api`
  (GET) / `cio_write_api` (POST/PUT/PATCH, `--dry-run` first) / `cio_delete_api`;
  `cio_skills_read fly-api/<file>` for platform workflows. Would-sends via
  `deliveries?drafts=true`.
- **ERP low-code (source of truth for send logic):** `scripts/ask-code.sh` — never
  assume local ERP access; ask the code. Guide: `docs/code-llm-api.md`.
- **Snowflake (real sends):** `python3 scripts/sf_query.py "<SQL>" [rows]`.
- **mmdb:** read-only MySQL for DB ground truth / attribute shape.
