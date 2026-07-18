# Harness — how to wire the master → subagent fan-out (Claude Code)

The SKILL.md is the per-cluster *brain*; a skill can't spawn subagents by itself.
This folder is the thin orchestration that drives the skill N times. Install it:

- `harness/build-cluster.command.md`  → `.claude/commands/build-cluster.md`
  (invoke as `/build-cluster`)
- `harness/agents/*.md`                → `.claude/agents/`

All state is on disk (`work/<target>/<cluster>/…` + `work/<target>/build-status.md`),
so a fresh session resumes by reading it — no hand-off prompt needed. This mirrors
the existing System 1/2/3 harness.

## Flow

1. You give the master a **list of Whimsical links** (one per cluster) + the target.
2. The master fans out one sub-pipeline per link (capped concurrency for ask-code /
   Snowflake load), passing each link **verbatim**.
3. Per cluster the sub-pipeline runs: **design-critic** → *(your gate)* → **builder** →
   **verifier** *(blind)* → *(your publish)*. The master independently spot-checks
   outputs, resumes dead agents from their transcripts, and updates the status ledger.

## The two human gates

- After **design-critic**: you approve design corrections before any build.
- After **verifier**: you publish to prod (this system never publishes).
