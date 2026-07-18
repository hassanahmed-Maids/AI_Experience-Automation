# The ERP → CustomerIO Migration System — Architecture Report

*A reference overview of the 3-system multi-agent pipeline, the environment it runs in, and the orchestrator that drives it. Companion to `CLAUDE.md` (the standing brief).*

---

## 1. The environment (what this whole thing is)

**Mission.** Migrate ~500 ERP broadcast templates (WhatsApp/SMS) into CustomerIO campaign **designs** — target-by-target, cluster-by-cluster. We do **not** build in CustomerIO. We produce copy-paste-ready **Whimsical boards** + validated **flow-specs**, so a business analyst with zero prior context can understand each client/maid journey (`docs/judgment.md`).

**The four targets** (each = one JourneyAI export): CC-Clients, MV-Clients, CC-Housemaids, MV-Housemaids.

**Sources of truth & data planes** the agents reach into:

| Plane | Access | Role |
|---|---|---|
| **ERP code** ("ask-the-code" LLM API) | `scripts/ask-code.sh` (async submit→poll) | **The ONLY source of truth** for how templates are sent. API-only, no local code. |
| **Snowflake** (`BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER`) | `scripts/sf_query.py` (key-pair) | Real send data — who *actually* received each template. |
| **mmdb** (read-only MySQL mirror) | `pymysql` + `.env` `CIO_DB_*` | Point-in-time DB value checks (enum casing, distributions). |
| **CustomerIO MCP** (live, EU acct 138725) | `cio_read_api` / `cio_schema` / `cio_skills` | Read the real CIO data model + action model. Read-only. |
| **Whimsical MCP** | `create` / `fetch` | Draw & verify the boards. |
| **The sync queries** | `~/Desktop/Clients & Housemaids Query/New CIO Queries/` | What's *already* synced into CIO (Contracts-Groups + Clients Profile). |

**Hard rules** that constrain every agent: ERP code is authority (JourneyAI's `Triggers` column is ~50% accurate — hint only); secrets in `.env` only; n8n-sent / not-in-code templates → dismiss to `manual-review.md`; channel is passthrough, never a design axis; campaigns only (never Broadcasts); templates are static text + fill-in `@params@`; live ask-code wins over the `~/Desktop/magnamedia` snapshot on any conflict.

**State is 100% on disk.** `work/<target>/<cluster>/{flow-spec, attribute-map, snowflake-validation, cio-design, validation-report}.md` + `boards.md` + `clusters.md`. A fresh session reads the tree to know what's done — no hand-off prompt needed. The living knowledge base (`docs/glossary, judgment, code-llm-api, customerio-conventions, erp-events, snowflake, whimsical-standards, decisions, event-design`) governs behavior and is corrected when wrong (see §6).

---

## 2. The orchestrator (the main session)

The orchestrator is not a stage; it's the conductor.

- **Dispatch & chain.** Reads on-disk state, launches the right subagent per stage, and chains each cluster forward (attr-map → sf-validate → translate → validate) as prior stages land via **completion notifications**.
- **Concurrency & throughput.** Fans out independent work in parallel (e.g. all clusters' attribute-maps at once), caps concurrency to keep the ask-code/Snowflake load sane, and holds waves back when needed.
- **Resilience.** When agents die (org **spend-limit** bursts, "connection closed mid-response" stalls), it **resumes them from their transcripts via `SendMessage`** — near-finished ones just write their outputs instead of redoing work.
- **Independent verification.** Per the governance rule, the orchestrator *itself* re-`fetch`es every Whimsical board at legible zoom — it does **not** trust an agent's "verified, no overlaps" self-report.
- **Loop-back adjudication.** On a validator **FAIL**, it decides how far back to loop (translator for a design bug; interrogator for a flow-spec error) and feeds the exact findings down. It also decides what is a genuine **Moe-level decision** vs an autonomous fix.
- **Governance.** Writes corrections back into the file that caused them; logs judgment calls in `docs/decisions.md`.

---

## 3. System 1 — the migration pipeline (auto-run, zero-corrections loop)

Seven agents (incl. the clustering entry point), each a specialist with a fixed input→output contract. Entry via `/cluster <target>` then `/migrate-cluster <target> <cluster>`.

| # | Agent (skill) | Tools | Input → Output | The one thing it guarantees |
|---|---|---|---|---|
| 0 | **cluster-analyzer** | Bash, Read, Write, Grep, Glob | `raw/<export>.xlsx` → `clusters.md` | Groups templates into business-logic clusters. |
| 1 | **code-interrogator** | Bash, Read, Write, Grep, Glob | cluster → `flow-spec.md` | Reverse-engineers *how each template is actually sent* by interrogating ask-code until an **echo-back returns zero corrections**. |
| 2 | **flow-diagrammer** | All | flow-spec → **legacy Whimsical board** + `boards.md` | Draws the ERP flow (three-layer: business flow + Tech margin + message notes). |
| 3 | **attribute-mapper** | Bash, Read, Write, Grep, Glob | flow-spec → `attribute-map.md` | Every attribute → exact `table.column` + CIO intake class (**synced / sync-add / API / event**). |
| 4 | **snowflake-validator** | Bash, Read, Write, Grep, Glob | + real sends → `snowflake-validation.md` | Checks that *real recipients* met the drawn conditions; **hard mismatch → loops back to the interrogator**. |
| 5 | **customerio-translator** | All | all above → `cio-design.md` + **CIO board** | Translates (doesn't mimic) the ERP flow into CIO campaigns; annotates every attribute's source. |
| 6 | **validator** | Bash, Read, Write, Grep, Glob | design → `validation-report.md` | **Adversarially re-interrogates the code from scratch** to prove the design is faithful; PASS / PASS-WITH-NOTES / **FAIL→loop-back**. |

**The pipeline (file handoffs):**

```
raw/<export>.xlsx ── cluster-analyzer ──▶ work/<target>/clusters.md
for each cluster:
  code-interrogator   ──▶ flow-spec.md          (validated, zero-corrections echo-back)
  flow-diagrammer     ──▶ legacy Whimsical board (+ boards.md)
  attribute-mapper    ──▶ attribute-map.md       (each attr → table.column + CIO intake)
  snowflake-validator ──▶ snowflake-validation.md (real recipients vs drawn conditions; hard mismatch → loop back)
  customerio-translator ──▶ cio-design.md + CIO board
  validator           ──▶ validation-report.md
```

**Why the "zero-corrections loop" matters.** The interrogator's flow-spec, the snowflake-validator's real-data check, and the validator's *independent* re-derivation are three separate reads of the same ground truth. When they disagree, the pipeline loops (a validator FAIL routes back to the translator for a design bug, or all the way to the interrogator for a flow-spec error, then re-runs forward).

**Drawing convention (current).** The CIO flow lives **next to** the legacy flow on **one combined board** — freeform `create(type:'board')` (NOT `flowchart`, which auto-layouts and crushes the notes), left = `LEGACY — ERP`, right = `CIO — DESIGN`, divider between. Each flow keeps its own Tech margin + message notes + BUILD-REQUIREMENTS note. MCP `edit` is unavailable → whole board in one `create`; recover from overlap with a single delete+recreate; orchestrator verifies at legible zoom. (`docs/whimsical-standards.md`.)

---

## 4. System 2 — go-live preparation (gated, not auto-run)

Starts from a validated `cio-design.md`. Unlike System 1, **Moe validates between every stage.** Run via `/prepare-golive <target> <cluster> <stage>`.

| Stage | Agent | Output | Gate |
|---|---|---|---|
| A | **golive-dev-task-writer** | `golive/dev-validation-task.md` (polished for Jira) | devs validate the built flow |
| B | **golive-data-structure-designer** | `golive/data-structure.md` | **the only data stage** — verifies every sync-add / relationship / deletion vs ERP code + mmdb; emits a code-accurate sync/group-query + deletion spec → Moe hands it to a separate query-editing session |
| B′ | **golive-api-spec-writer** | `golive/api-specs.md` | when the design needs APIs (grounded; transient value → event) |
| C | **golive-final-checker** | `golive/final-check.md` | checks the *actually built* CIO campaign vs the design truth |

System 1's attribute-mapper deliberately *pre-classifies* the data steps so stage B only has to verify + format them. Events follow `docs/event-design.md`; new relationships follow the deletion rule in `docs/customerio-conventions.md`.

---

## 5. System 3 — shadow-mode reconciliation (built; connector pending)

Starts where System 2 ends. The cluster goes live in **shadow mode**: CIO runs people through the whole journey but **does not send**; ERP keeps sending. Run via `/system3 <target> <cluster> <step>`.

| Step | Agent | What it does |
|---|---|---|
| 1 · validate | **golive-final-checker** (connector-upgraded) | confirms built campaign + data are live/accurate vs the design; GO ⇒ enter shadow mode |
| 2 · reconcile | **system3-reconciler** | compares **CIO would-sends** (connector) vs **ERP actual sends** (Snowflake) vs **DB ground truth** → `system3/reconciliation-<date>.md` |

**Accuracy = CIO-correctness vs DB ground truth.** ERP is fallible; its mistakes are logged separately and **excluded from the score**. Match = same person + same template + same **Dubai day**; honors Snowflake's **~2h ingestion lag** (exclude the last ~2h from "miss" calls; `sent_date` trusted). Per-template, rolled to cluster; fix CIO → re-run → loop until **~80% ⇒ CUTOVER** (CIO on, ERP off). **Connector is pending** — the system is designed against an assumed CIO connector, to be enhanced to the real API when confirmed. (`docs/system3.md`.)

---

## 6. Governance (how the system fixes itself)

A correction isn't done until it's written into the file that caused it:

- wrong flow logic → the agent's playbook
- wrong CIO taste → `docs/customerio-conventions.md`
- wrong drawing → `docs/whimsical-standards.md`
- wrong domain understanding → `docs/glossary.md`

Every judgment call is logged in `docs/decisions.md`.

---

## 7. Entry points (a fresh session starts here)

| Command / skill | Does |
|---|---|
| `/cluster <target> [export]` | Clusters a target export → `clusters.md`. |
| `/migrate-cluster <target> <cluster>` | Runs the full System-1 pipeline for one cluster. |
| `/migrate-cluster <target> <name> --templates A,B,C` | Ad-hoc cluster: skip clustering, run the pipeline on a known template list. |
| `/prepare-golive <target> <cluster> <stage>` | Runs ONE gated System-2 stage (`dev-task \| data-structure \| api-spec \| final-check`). |
| `/system3 <target> <cluster> <step>` | Runs a System-3 step (`validate \| reconcile`). |

Agents live in `.claude/agents/`. Because all state is on disk, a new session just reads `clusters.md` + `work/<target>/<cluster>/*` to see what's done — `CLAUDE.md` is the standing brief.
