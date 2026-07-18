---
description: Build + verify CIO campaigns from Whimsical links (master fan-out)
---

# /build-cluster — master orchestrator

Read `SKILL.md` (cio-campaign-migration) first. You are the **master**, not a builder.

## Input
- A **target** (e.g. MV-Clients) and a **list of Whimsical board links**, one per
  cluster. If the user gives one link, run one sub-pipeline.

## Do
1. For each link, start a per-cluster sub-pipeline. Cap concurrency (≈3) to keep
   ask-code / Snowflake load sane; hold waves back when needed.
2. Pass each link **verbatim** to its `design-critic`. Never search/browse for a board.
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
