---
description: Ingest a target's template export and cluster it into business-logic groups (Mode A entry point — runs cluster-analyzer)
argument-hint: <target> [path-to-export | "paste"]
---

Cluster the templates for **$ARGUMENTS** into migration groups. This is the entry point for "here are all the templates for a target — figure out the clusters."

1. **Locate the export.** If a file path was given, use it. If Moe pasted templates inline, save them to `raw/<target>-<YYYY-MM-DD>.<ext>` first. Otherwise look in `raw/` for the newest file matching the target and confirm with Moe which one.
2. **Launch the `cluster-analyzer` agent** (playbook `.claude/agents/cluster-analyzer.md`) on that export, telling it the target (stated by Moe). It parses the export, forms hypothesis clusters, and verifies each via `scripts/ask-code.sh`.
3. Output: `work/<target>/clusters.md` (per-cluster: name, purpose, templates, trigger diversity, confidence) + `work/<target>/manual-review.md` (n8n / not-in-code / notifiers / out-of-scope).

Operating notes: cluster-analyzer is long-running (many ask-code round-trips). Run its API waves in the foreground (blocking, ≤3 parallel) and don't stop until `clusters.md` is complete. If the run is interrupted, it resumes from the files already written.

After it finishes: report the cluster list (name + one-line purpose + confidence), the manual-review count, and any scope judgment calls for Moe. Remind him the next step is `/migrate-cluster <target> <cluster-name>` per group.
