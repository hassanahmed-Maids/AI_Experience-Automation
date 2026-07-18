# Harness — how to wire the master → subagent fan-out (Claude Code)

The SKILL.md is the per-cluster *brain*; a skill can't spawn subagents by itself.
This folder is the thin orchestration that drives the skill N times.

## Install — into the DEPARTMENT repo (not an empty repo)

The build+verify harness leans on the department's existing infrastructure, so install
it into the **repo that runs System 1/2/3** — the one containing `CLAUDE.md`, `docs/`,
`scripts/ask-code.sh`, `scripts/sf_query.py`, and `.env`. Installing into a bare repo
(only `.claude/`) will fail the master's preflight, because the Critic can't ground
without those scripts.

```
# from the department repo root
cp harness/build-cluster.command.md  .claude/commands/build-cluster.md
cp harness/agents/*.md                .claude/agents/
```

> **Do NOT add a `tools:` line to the agent files.** In Claude Code a subagent that
> declares `tools:` is restricted to that list and **loses the Whimsical + Customer.io
> MCP connectors** — the critic then can't `fetch` the board and the builder can't touch
> CIO. The shipped agents omit `tools:` on purpose so they inherit the main thread's full
> toolset (Bash + Read/Write/Grep/Glob + both MCP connectors). If you want least-privilege,
> you must explicitly list the MCP tools, not drop them.

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
