# The flows — CC Client Paying According to Price by Type / Nationality / Start Date

Everything built in n8n for this audit, in the n8n project **AI Experience &
Automation**, all tagged `audit: CC Price Cohort`.

Three flows run the audit. Two more are history — kept deliberately, because the
probe is the evidence behind a design decision and the setup flow documents how
the result tabs were created.

## The chain

```
POST /webhook/cc-price-by-cohort-stage1
        │
        ▼
   Stage 1  Population & Price Card ──baton──▶  Stage 2  Enrich & Score
                                                    │  ├─ more chunks? ──▶ itself
                                                    ▼
                                               Stage 3  Deliver & Verify
                                                    │
                                     Runs table + Audit Runs / Audit Findings tabs
```

## Live

| # | Flow | ID | What it does |
|---|---|---|---|
| 1 | **Stage 1 — Population & Price Card** | `7j5Z5KPvBcWRPfvy` | Validates the run token, checksums the card (49 windows / 5 cohorts or abort), pulls the population and proves it complete against an independent count from a *different* route. Drops `clientName` / `maidName` — the one PII boundary. |
| 2 | **Stage 2 — Enrich & Score** | `bBYbpHcWMWybDQxN` | Three ERP reads per contract, scores against the card, writes a case row per batch. Chunks itself across executions to stay under the 2400s kill. |
| 3 | **Stage 3 — Deliver & Verify** | `ZJDiRTzk6uRYBJwq` | Reads the Cases table back as ground truth, refuses to report on a partial population, writes the Runs row and both sheet tabs, then reads them back and asserts they landed. |

`https://sami-team.app.n8n.cloud/workflow/<ID>`

Only Stage 1 has a trigger. Stages 2 and 3 are sub-workflows — never run them
directly; they expect a baton.

## History, kept on purpose

| Flow | ID | Why it is still here |
|---|---|---|
| **Setup — Result tabs** (one-off, already run) | `UY6oO1gC0rOqenc6` | Created the `Audit Runs` / `Audit Findings` tabs and seeded their headers, then read both back and failed loudly on a mismatch. Re-run only if a tab is lost. Never touches `Sheet1`. |
| **Probe — ERP price card** (spent) | `0oB2SX1nN2D3nyIE` | Established that ERP holds today's price matrix but **no dated history**, which is why the sheet stays the source of the 49 windows and ERP is only a staleness cross-check. Findings: `erp-price-card.md`, `erp-price-matrix-mapping.md`. |

## Canvas conventions

Applied to all three live flows on 2026-08-20 so the canvas reads without
opening a node:

- **One 260px grid.** Main line at `y = 0`; branches drop to their own row.
- **Numbered sticky sections** behind the nodes, each explaining what that
  stretch does and — more usefully — *why it is built that way*. The guards in
  this system exist because of specific failures; the notes name them.
- **Every node sits inside exactly one section.** Verified by recomputing
  bounding boxes, not by eyeballing: the first attempt had two 20px sticky
  overlaps and two nodes floating between sections, none of which were visible
  at a glance.
- Stage 2's `Pace 500ms` sits one row below the loop body so the backward edge
  to `Batch of 5` is readable rather than hidden behind eight nodes.

## The one node nobody should hand-edit

Stage 2's **Score Batch**. It is generated:

```
node n8n/build-score-node.js     # inlines the tested sources
node test-node-parity.js         # proves the generated body passes all 73 assertions
```

The deployed body is verified `sha256`-identical to `n8n/score-batch.gen.js`
after every deploy. Edit `scorer-month.js` / `paymentsinfo.js` / `score-glue.js`
and regenerate — never the node.
