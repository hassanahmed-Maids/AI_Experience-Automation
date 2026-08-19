# The Phase 8 handover document

One HTML file. Two sections. Business first. A manager reads the top and stops when
they have their answer, so the answer goes at the top.

## Page skeleton

```
<title>            <Check name> — Audit Check Handover     (short, no explainer)
Run banner         run id · window · status · DRAFT/LIVE · whose token
Verdict at a glance 4-6 stat tiles: population, findings, needs-review, money
────────────────── SECTION 1 — WHAT THIS CHECK DOES (business)
What a finding means      one paragraph, owner's language
Verdict flow diagram      how ONE record becomes red / clean / pending / review
What it deliberately      the must-NOT-cover list, as a table
  does not cover
Numbers, explained        the run's figures with what each one means
Reproducible vs judgement the split. Non-negotiable.
────────────────── SECTION 2 — HOW IT WORKS (technical)
Pipeline diagram          the bands, with the guards that abort
Band-by-band table        what each band does and what it refuses to do
Where numbers come from   surface → pagecode → what it yields
Call budget               measured, not estimated
────────────────── DECLARED GAPS
Open rulings, deviations, blocked surfaces, attribution, draft status
Who has to do what next   named person, named decision
```

## Rules the design must obey

- **Section 1 contains no endpoint, node, pagecode, or rule number.** If a business
  reader needs to know a gate's number to follow the logic, the diagram is wrong.
- **Section 2 never restates the business rationale.** It says how, not why.
- Stat tiles carry a **label, a value, and a one-line meaning**. A number without a
  meaning line is decoration.
- Anything model-dependent is **visually marked** wherever it appears — not just
  explained once in a caption a reader may skip.
- Gaps get the same visual weight as results. A gaps section styled as fine print
  is a gaps section nobody reads.

## Colour and type

Define every colour as a token on bare `:root`, then redefine under
`@media (prefers-color-scheme: dark)` guarded `:root:not([data-theme="light"])`,
and again under `:root[data-theme="dark"]`. Never give a colour its only definition
inside a media block. Give `body` an explicit token background.

Semantic palette — verdicts must be the same colour everywhere, including inside
diagrams:

```
--red      finding / money not recovered
--amber    needs review / model judgement
--slate    pending / not settled
--green    clean
--ink      body text          --muted   secondary text
--bg       page               --panel   raised surface      --line  borders
```

Type: one family stack (system UI), 4 sizes only — page title, section title,
body, small. Tabular numerals for every figure (`font-variant-numeric: tabular-nums`)
so columns of amounts line up.

## The two diagrams

Both as **inline SVG**, not mermaid — you need exact control of colour tokens so the
verdict colours match the rest of the page in both themes, and mermaid cannot use
your CSS variables reliably. Wrap each in `overflow-x: auto`.

### 1. Verdict flow (business, Section 1)

A single record entering at the left, passing decision points, landing in one of
four terminal states. Requirements:

- Terminal states use the semantic verdict colours and are visually heavier than
  the decision nodes — the outcomes are the point.
- Each decision node is a **question in plain language**, not a field name.
  "Did she fly it?" not `ticketOutcome = 'Used'`.
- Where a gate exists to prevent a specific wrong answer, annotate the edge with
  the consequence: "without this, 12 multi-leg journeys a month read as duplicates".
  That annotation is the single most valuable thing on the page.
- Order the branches so the most common path is the straightest line.

### 2. Pipeline mechanism (technical, Section 2)

Left-to-right bands, each band a labelled group of what actually happens, with:

- the **guards** drawn as hard stops, visually distinct from processing steps
- the **fan-out point** and its cost (e.g. "1 read per applicant × N")
- where the run **aborts** vs where it **degrades**

Do not draw one box per n8n node. Draw the bands a reader needs to reason about,
and put the node names in the accompanying table.

## Accuracy checks before you publish

Run these against the document, not against your memory:

1. Every figure appears in a run row you read back. No exceptions.
2. The run id in the banner is the run the figures came from.
3. No per-entity amount, id, name, or note anywhere in the file. Grep for it.
4. Model-dependent figures are marked as such everywhere they appear.
5. The diagram matches the deployed flow — walk it against the node list.
6. Draft status is stated if the flow is a draft.
7. Open the file with no network and confirm it still renders.
