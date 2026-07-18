---
description: Build + verify CIO campaigns from Whimsical links (master fan-out)
---

# /build-cluster — master orchestrator

Read `SKILL.md` (cio-campaign-migration) first. You are the **master**, not a builder.

## Input
- A **target** (e.g. MV-Clients) and either:
  - a **list of Whimsical board links** (one per cluster — the normal path), or
  - **no link but named templates** (`--templates A,B,C`) → **board-less mode**: the
    design-critic derives the flow from ERP code (`references/derive-from-code.md`).
  If a link is given, use it; never mix (a link always wins over `--templates`).

## Preflight (before you fan out — STOP if any fails)

The "grounded, not assumed" rule means a run that can't ground must **halt and report**,
never guess. Before dispatching, confirm the environment can actually do the work:

1. **Right repo.** `CLAUDE.md`, `docs/`, and `scripts/ask-code.sh` + `scripts/sf_query.py`
   + `.env` are present. If only `.claude/` exists, this is the wrong repo — the
   build+verify harness must live in the **department repo** (the one running System
   1/2/3). Stop and tell the human.
2. **Connectors reachable.** Read-test Whimsical (`fetch` a known board) and Customer.io
   (`cio_prime`, auth to test workspace 216662).
3. **Subagents inherit the connectors.** The `agents/*.md` must NOT carry a restrictive
   `tools:` line — that strips MCP access and a dispatched critic/builder/verifier can't
   reach Whimsical/Customer.io. If they do, fix them (omit `tools:` to inherit all)
   before dispatching.

If a check fails, report exactly what's missing and stop — do not dispatch subagents
doomed to fail, and do not substitute an ungrounded critique.

## Do
1. For each link, start a per-cluster sub-pipeline. Cap concurrency (≈3) to keep
   ask-code / Snowflake load sane; hold waves back when needed.
2. Pass each link **verbatim** to its `design-critic`. Never search/browse for a board.
   In **board-less mode** (no link, `--templates` given) tell the critic to derive from
   code — and confirm ask-the-code is reachable in preflight, since it's the only source
   of truth without a board.
3. Chain the stages as each lands via completion notifications:
   `design-critic` → **STOP for the human gate** (present defects + corrected spec) →
   on approval, `builder` → `verifier` (blind) → **STOP for the human publish gate**.
4. **Independently spot-check** each stage's output (re-fetch a built campaign, re-read
   a fixture result) — treat "agent says done" as a claim to check, per Governance.
5. On a stage failure, route back to the right stage (verifier FAIL → builder for a
   build bug, or design-critic for a spec/design bug) with the exact findings.
6. Resume dead agents (spend-limit / connection stalls) from their transcripts — near-
   finished ones write their output rather than redo work.
7. Keep `work/<target>/build-status.md` current:
   `cluster → critiqued / gate-passed / built / verified / ready-to-publish`.

## Don't
- Don't build or verify yourself — dispatch.
- Don't cross the human gates autonomously.
- Don't let a builder verify its own build (spawn a separate blind verifier).
