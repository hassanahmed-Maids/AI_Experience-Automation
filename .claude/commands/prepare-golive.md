---
description: Run ONE gated go-live-prep stage for a cluster (System 2). Manual validation happens between stages.
argument-hint: <target> <cluster> <stage>  # stage = dev-task | data-structure | api-spec | final-check
---

Run go-live-prep stage **$ARGUMENTS**. This system is **gated** — run one stage, Moe validates the output, then Moe invokes the next stage. Never chain stages automatically.

Parse args as `<target> <cluster> <stage>`. Outputs live in `work/<target>/<cluster>/golive/` (create it if missing). Requires System 1 to have produced `cio-design.md` + `flow-spec.md` for the cluster — if missing, say so and stop.

Dispatch by stage (each via the Agent tool):

- **dev-task** → `golive-dev-task-writer` → `dev-validation-task.md`. Then tell Moe: review, hand to devs; the gate is devs confirming the flow works.
- **data-structure** → `golive-data-structure-designer` → `data-structure.md`. **The ONLY data stage** (the old `data-task` stage is merged in). Consumes System 1's `attribute-map.md` (the finalized data-attribute prep), **verifies** every sync-add attribute / relationship / deletion condition against the ERP code (low-code, `scripts/ask-code.sh`) + `mmdb`, and produces a **code-accurate spec** of the exact additions to the CIO sync/group queries + the deletion queries. Then tell Moe: validate it, then hand this spec to a **separate query-editing session** to implement in the queries. (No Jira/data-team task step.)
- **api-spec** → `golive-api-spec-writer` → `api-specs.md`. Use when the design needs encapsulating APIs (attribute gaps marked "intake: API-call journey attribute"). Grounds each API in code, gates on persisted-vs-transient (transient → recommend a CIO event, not an API). Then: Moe pastes each prompt into his API-creating ask-the-code.
- **final-check** → `golive-final-checker` → `final-check.md`. Requires Moe to supply the built CIO campaign in the invocation (Whimsical board URL or pasted description) — if absent, ask for it. **When a CustomerIO MCP is provided (PENDING — not yet available), the checker inspects the built campaign directly in CIO instead of a pasted description.**

After the stage: print the output path, the key findings/asks, and the explicit next gate. Log any judgment calls in `docs/decisions.md`.
