---
description: Run the full migration pipeline for one cluster of templates (interrogate → diagram → attribute-map → snowflake-validate → translate → validate)
argument-hint: <target> <cluster-name> [--from <stage>] [--templates A,B,C]
---

Run the migration pipeline for cluster **$ARGUMENTS**.

**Two entry modes:**
- **From clusters.md (normal):** `<cluster-name>` must exist in `work/<target>/clusters.md` (produced by `/cluster`). 
- **Ad-hoc list (Mode B — "I already know these templates are one cluster"):** if `--templates A,B,C` is given, first create `work/<target>/<cluster-name>/` and write a `clusters.md` stub entry for it (mark it **ad-hoc, grouping asserted by Moe, not export-clustered**), then run the pipeline. This is the entry point for pasting a known cluster with no prior export.

Stages (each via the Agent tool, sequentially — outputs are file handoffs under `work/<target>/<cluster>/`):

1. **code-interrogator** → `flow-spec.md`. Requires the cluster to exist in `work/<target>/clusters.md` OR a `--templates` list (see Mode B above). If neither, tell Moe to run `/cluster <target>` first (or pass `--templates`), and stop.
2. **flow-diagrammer** → legacy Whimsical board (`boards.md`).
3. **attribute-mapper** → `attribute-map.md`. Grounds every attribute the flow needs in its DB source (table.column) and decides the CIO intake (synced attribute / sync-query addition / API / event). Feeds the translator (and later the go-live api-spec-writer / data-structure-designer).
4. **snowflake-validator** → `snowflake-validation.md`. Checks the drawn theory against REAL send data (Snowflake): pulls actual recipients of each template and verifies they met the drawn conditions (precision). On a **hard/systematic mismatch it loops back to `code-interrogator`** with a failure prompt (re-run stages 1→4); otherwise passes (data notes flagged to Moe).
5. **customerio-translator** → `cio-design.md` + CIO Whimsical board. Consumes `attribute-map.md` — uses the decided intakes; the CIO board annotates each attribute's source.
6. **validator** → `validation-report.md`.

Rules:
- Each stage reads its input file fresh; pass the file paths in the agent prompt, plus target and cluster name. Don't paste file contents between stages.
- If `--from <stage>` was given, skip earlier stages (their outputs must already exist).
- On validator **FAIL**: report the blockers to Moe with the findings table. Do NOT auto-loop more than once: one repair pass (re-run the implicated stage with the findings attached), then re-validate; if it fails again, stop and escalate to Moe.
- After PASS (or PASS WITH NOTES): print a summary — cluster, templates covered, both board URLs, new attributes/events needed (the intake list), accepted deltas awaiting Moe's sign-off, and anything sent to manual-review.
- Log any new judgment calls in `docs/decisions.md`.
