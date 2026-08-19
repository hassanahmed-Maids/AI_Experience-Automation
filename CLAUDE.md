> ## ⛔ RETIRED — CustomerIO and Whimsical are no longer used (2026-08-19)
>
> **The team does not use CustomerIO or Whimsical any more. Do not use them, do not read
> their conventions docs, and do not run the Systems 1–3 pipeline described below.** That
> includes the CIO/Whimsical MCP servers, the `cio-*` and `whimsical` tooling, and every
> agent in `.claude/agents/` whose job is drawing boards or translating campaigns
> (cluster-analyzer, flow-diagrammer, customerio-translator, attribute-mapper,
> design-critic, builder, verifier, the `golive-*` set, system3-reconciler).
>
> **What this repo is used for now:** building maids.cc **audit checks as n8n flows** from
> Notion specs — see the `erp-audit-flow-builder` skill. Work lives under `audit/<check>/`.
> The n8n project is **`Adeeb`**. Probe the ERP with `curl`; ask **LCP** (ask-the-code) any
> question about an ERP API or where a value comes from.
>
> Still current from the material below: **hard rules 1 and 2** (the ERP code is the only
> source of truth, reached through `scripts/ask-code.sh` — see `docs/code-llm-api.md`; and
> secrets live in `.env` only), plus `docs/glossary.md` for the business domain (CC/MV,
> targets, contract model) and `docs/snowflake.md` for the warehouse.
>
> Everything from here down is kept for history only.

---

# ERP → CustomerIO template migration system  *(retired — see the banner above)*

Multi-agent pipeline that migrates ~500 ERP broadcast templates (WhatsApp/SMS) into CustomerIO campaign *designs*. We do NOT build in CustomerIO — we produce copy-paste-ready Whimsical boards plus validated flow-specs. The deeper goal: make each client/housemaid journey understandable to a business analyst with zero prior context (see `docs/judgment.md`).

## Hard rules

1. **The ERP code is the ONLY source of truth** for how templates are sent. It is API-only — never assume local code access. Use `scripts/ask-code.sh` (guide: `docs/code-llm-api.md`). The JourneyAI export's `Triggers (JSON)` column is ~50% accurate — hint only.
2. **Secrets live in `.env` only.** Never paste tokens/passwords into prompts, agent files, or docs.
3. Templates sent from n8n or not found in ERP code → **dismiss to `work/<target>/manual-review.md`**. Never interrogate or translate them. Anything "notifiers"-related is out of scope entirely.
4. Templates are static text + fill-in `@params@`. Ignore expression params, WABA SIDs, `live_person_template`.
5. Channel is passthrough (mostly WhatsApp, sometimes SMS) — never a design axis.
6. Migration proceeds **target by target** (CC-Clients, MV-Clients, CC-Housemaids, MV-Housemaids), and within a target **cluster by cluster**. Each export = one target, stated by Moe.
7. We never use CustomerIO "Broadcasts" — campaigns only.

## Knowledge base (read before acting; these are living documents)

| File | What it governs |
|---|---|
| `docs/glossary.md` | Business domain: CC/MV, targets, contract model |
| `docs/judgment.md` | The design philosophy — audience test, obscurity rule |
| `docs/code-llm-api.md` | Ask-the-code API usage, modules, verified behavior |
| `docs/customerio-conventions.md` | CIO data model, trigger preference, patterns, checklist |
| `docs/erp-events.md` | Events ERP already sends to CIO |
| `docs/snowflake.md` | Snowflake analytics warehouse: access, verified schema, the recipient→entity join |
| `docs/whimsical-standards.md` | How flows are drawn |
| `docs/decisions.md` | Append-only log of judgment calls (date + why) |

External canonical sources (read fresh, do not copy): CIO architecture doc + sync queries at `/Users/moe/Desktop/Clients & Housemaids Query/` (see customerio-conventions.md for exact paths).

## Pipeline & file handoffs

```
raw/<export>.xlsx ── cluster-analyzer ──▶ work/<target>/clusters.md
for each cluster:
  code-interrogator ──▶ work/<target>/<cluster>/flow-spec.md      (validated, zero-corrections loop)
  flow-diagrammer   ──▶ Whimsical legacy-flow board (+ boards.md)
  attribute-mapper  ──▶ work/<target>/<cluster>/attribute-map.md  (each attr → DB table.column + CIO intake: synced/sync-add/API/event)
  snowflake-validator ──▶ work/<target>/<cluster>/snowflake-validation.md  (real recipients vs drawn conditions; hard mismatch → loop back to interrogator)
  customerio-translator ──▶ work/<target>/<cluster>/cio-design.md + CIO Whimsical board  (consumes attribute-map; annotates sources)
  validator         ──▶ work/<target>/<cluster>/validation-report.md
```

### Entry points (a fresh session starts here)

- **New target export to migrate:** `/cluster <target> [export]` → produces `clusters.md`; then `/migrate-cluster <target> <cluster>` per group.
- **You already know a set of templates is one cluster:** `/migrate-cluster <target> <name> --templates A,B,C` — skips clustering, runs the pipeline on that list (recorded as an ad-hoc cluster).

Agents live in `.claude/agents/`. State is fully on disk (`clusters.md`, `work/<target>/<cluster>/*`) — a new session reads it to see what's done; no hand-off prompt needed, this file is the standing brief.

### System 2 — go-live preparation (gated, not auto-run)

Starts where System 1 ends (a validated `cio-design.md` + CIO board exists) and takes a flow to production-ready. Unlike System 1, it has **manual gates between every stage** — Moe validates before the next stage runs. Not live-send monitoring (that's the future System 3).

```
A. golive-dev-task-writer         ──▶ golive/dev-validation-task.md  ⟨gate: devs validate flow⟩
B. golive-data-structure-designer ──▶ golive/data-structure.md       (the ONLY data stage. Consumes System 1's attribute-map, VERIFIES every sync-add/relationship/deletion vs ERP code + mmdb, outputs a code-accurate spec of sync/group-query additions + deletion queries)  ⟨gate: Moe validates → hands the spec to a separate query-editing session⟩
   golive-api-spec-writer         ──▶ golive/api-specs.md   (when design needs APIs; grounded, transient→event)
C. golive-final-checker           ──▶ golive/final-check.md   (Moe feeds the built CIO board/description; when a CustomerIO MCP is provided [PENDING], checks the built campaign directly in CIO)
```

The dev-task is polished markdown Moe posts to Jira; the **data-structure** output is a code-verified spec Moe hands to a **separate query-editing session** (the old data-team-task/Jira stage is merged into data-structure). System 1's attribute-mapper *prepares* the data-attribute steps so data-structure only verifies + formats them. Events follow `docs/event-design.md`; new relationships follow the deletion rule in `docs/customerio-conventions.md`. Run each stage via `/prepare-golive <target> <cluster> <stage>` (stages: `dev-task | data-structure | api-spec | final-check`).

### System 3 — shadow-mode reconciliation (go-live parity; BUILT 2026-07-08, connector pending)

Starts where System 2 ends (a cluster built in CIO + validated). The cluster goes live in **shadow mode** — CIO journeys run people through the whole flow but **do NOT send**; ERP keeps sending. System 3 then measures whether CIO is **correct**, per template, and loops fixes to cutover. Full method + accuracy definition in `docs/system3.md`.

```
Step 1  validate  → golive-final-checker (connector-upgraded)  → built-campaign + data live/accurate vs low-code  ⟨GO ⇒ enter shadow mode⟩
Step 2  reconcile → system3-reconciler → system3/reconciliation-<date>.md
        compares CIO would-sends (connector) vs ERP actual sends (Snowflake) vs DB ground truth
        ⟨per-template CIO-correctness; fix CIO → re-run → loop until ~80% ⇒ CUTOVER (CIO on, ERP off)⟩
```

Key rules: **accuracy = CIO-correctness vs DB ground truth** (ERP is fallible; ERP mistakes logged separately, excluded from the score), **per template rolled to cluster**, match = **same person + same template + same Dubai day**, honor Snowflake's **~2h ingestion lag** (exclude the last ~2h from "miss" calls; `sent_date` is trusted). Run via `/system3 <target> <cluster> <step>` (step = `validate | reconcile`). **Connector pending** — designed against an assumed CustomerIO connector; enhance to its real API when Moe confirms it.

## Fixing the system (governance)

A correction isn't done until it's written into the file that caused it. Wrong flow logic → agent playbook; wrong CIO taste → customerio-conventions.md; wrong drawing → whimsical-standards.md; wrong domain understanding → glossary.md. Log every judgment call in `docs/decisions.md`.
