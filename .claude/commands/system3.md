---
description: Run a System 3 (shadow-mode go-live parity) step for a cluster. Gated — Moe fixes CIO between reconcile runs. Needs the (pending) CustomerIO connector.
argument-hint: <target> <cluster> <step>  # step = validate | reconcile
---

Run System 3 step **$ARGUMENTS**. Read `docs/system3.md` first — it holds the method + the accuracy definition. This system is **gated + looped**: `validate` gates entry to shadow mode; `reconcile` is re-run after each CIO fix until every template clears ~80% and the cluster is cutover-ready (CIO on, ERP off).

Parse args as `<target> <cluster> <step>`. Requires System 1 + System 2 to have run for the cluster (`cio-design.md`, `flow-spec.md`, `golive/data-structure.md`) and the campaign to be **built in CIO**. Outputs live in `work/<target>/<cluster>/system3/`.

Dispatch by step (via the Agent tool):

- **validate** → `golive-final-checker` (the connector-upgraded final-check IS System 3's entry gate) → `golive/final-check.md`. Feed it the built campaign: a CustomerIO connector (preferred, direct inspection — PENDING) or a Whimsical board URL / pasted description. Confirms the built campaign + that every event/API/data-attribute is live and accurate vs the low-code. Then tell Moe: GO here ⇒ put the cluster into shadow mode (journeys run, sends suppressed; ERP keeps sending).
- **reconcile** → `system3-reconciler` → `system3/reconciliation-<date>.md`. Compares CIO would-sends (connector) vs ERP actual sends (Snowflake) vs DB ground truth; scores per-template CIO correctness; lists CIO-bugs + fixes and a separate ERP-mistake log. **Needs the CustomerIO connector** for the CIO would-send set — if it isn't available, say the CIO→ERP direction is blocked and produce only what Snowflake + DB allow. Then tell Moe: fix the listed CIO bugs, then re-run `reconcile`; at ~80% per template the cluster is cutover-ready.

After the step: print the output path, the per-template accuracy / verdict (reconcile) or GO/NO-GO (validate), the key CIO-fix asks, and the next action in the loop. Log judgment calls in `docs/decisions.md`.

**Connector pending (2026-07-08):** designed against an assumed connector (per-person journey/send-node membership + clientId/phone/template/timestamp; live campaign read). When Moe confirms the connector's real capabilities, enhance `system3-reconciler` + `golive-final-checker` to its API.
