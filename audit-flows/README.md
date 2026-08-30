# ERP audit flows — patch kit and change records

**This is not the CustomerIO migration pipeline.** Everything else in this repo serves the
ERP → CustomerIO template migration described in `CLAUDE.md`. This directory belongs to a
different system: the **maids.cc audit checks built as n8n flows** (the
`erp-audit-flow-builder` skill). It lives here because the audit-check sources have no repo
of their own that this workspace can reach.

Judgment calls here are logged in `audit-flows/decisions.md`, **not** in `docs/decisions.md`
— that file is the migration log and mixing the two would make both harder to trust.

## Two systems share `.claude/`

`.claude/agents/` and `.claude/commands/` are the only place Claude Code loads agents and commands
from, so the Audit Flow Factory pipeline lives alongside the CustomerIO migration's fifteen agents.
They are separate systems and must not be confused:

| | CustomerIO migration | Audit Flow Factory |
|---|---|---|
| Governed by | `CLAUDE.md` | this directory + the Notion **Audit Flow Factory** page |
| Decisions log | `docs/decisions.md` | `audit-flows/decisions.md` |
| Agents | `cluster-analyzer`, `code-interrogator`, `flow-diagrammer`, … | `audit-spec-readiness` |
| Commands | `/cluster`, `/migrate-cluster`, `/prepare-golive`, `/system3` | `/audit-queue` |
| Skill | `.claude/skills/cio-campaign-migration/` | `.claude/skills/erp-audit-flow-builder/` |

Audit-flow agents and commands are named so they read as such. If you add one, keep that.

## The builder skill now lives here

`.claude/skills/erp-audit-flow-builder/` was moved in from personal synced scope on 2026-08-29 so
it is versioned with the work and reviewable in a PR.

Its `references/erp-and-n8n-traps.md` — which `SKILL.md` has always told you to read **before
Phase 1** — did not exist. The skill shipped with only `SKILL.md`, so every run silently skipped its
own trap list. It has been reconstructed from evidence that can be cited: incidents recorded in the
live flows' own comments, the dead-end routes document, the ERP Variables Database's own field
warnings, and defects found repairing the five flows on 2026-08-26/27. **Every entry names its
evidence; add new ones the same way, or not at all.**

## What is here

| Path | What it is |
|---|---|
| `patchkit/` | Four scripts that apply defect fixes to the **offline scorer sources**, which are in a repo this workspace cannot reach. Each asserts its anchors, syntax-checks, and writes `<file>.patched` — or writes nothing and exits 1. |
| `patch-notes/` | The full reasoning and acceptance criteria behind the D14 and D2 patches. |
| `records/` | Evidence for changes **already applied live** in n8n on 2026-08-27. |
| `tests/test-rules.mjs` | Standalone unit tests for the MV Stage 2 `Apply Scope & Gap Rules` node. Run: `node audit-flows/tests/test-rules.mjs <path-to-node-body.js>` |

## Status of the 2026-08-26 defect report

| Defect | Where it stands |
|---|---|
| D1, D3, D7, D10, D12, D16, D17 | Applied in n8n and verified by re-read |
| D5, D6 | Applied in n8n 2026-08-27 as a wrapper node; parity confirmed passing by Hassan |
| **D14, D2, D13** | **NOT applied.** They land in the parity-guarded scorer core, which is not editable from n8n. `patchkit/` is how they get applied — see its README, and read the D2 warning before running it. |

## The D2 warning, repeated here because it matters

The first version of the D2 patch would have shipped **85 new false reds** — it summed every
non-DELETED ledger row, double-counting a bounced instalment and its replacement. The shipped
version excludes replaced dead rows. If you find a `scheduledForMonth` without that exclusion,
it is the bad draft. Details in `patchkit/README.md`.

## What has NOT been run from here

The 140-test offline suite, the Terminated HM 79 assertions, and `test-node-parity.js` all
live in the unreachable scorer repo. `records/parity-suite-status.md` sets out exactly what
was substituted and what remains yours to run.
