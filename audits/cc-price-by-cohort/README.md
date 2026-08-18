# CC Client Paying According to Price by Type / Nationality / Start Date

`check_id`: `manual-cc-price-by-cohort` (smoke: `SMOKE-manual-cc-price-by-cohort`)

Deterministic scorer + offline harness for the CC price-by-cohort audit check.
Built per the `erp-audit-flow-builder` skill. Source of truth is Notion (see
`build-handover.md` §2); where this directory and Notion disagree, Notion wins.

## Files

| File | What it is |
|---|---|
| `scorer.js` | The deterministic gate chain, in ACP order. Ports into the Stage 1 Code node as-is. |
| `test.js` | Offline assertion harness. Exits non-zero on any drift. |
| `card.json` | Pinned price card, 49 windows / 5 cohorts, so scoring is testable without Sheets. |
| `build-handover.md` | Prior session's build handover. |
| `erp-access-probe-handover.md` | The ERP access re-probe brief (Phase 2). |

## Running the tests

```
node test.js     # 10/10 + 2 standalone guards; exit 1 on any failure
```

The harness pins the run date to 2026-08-17 (the date the card was captured) so
the spec's verified figures — 525, 4137, 1585.50 — stay comparable forever.
`scorer.js` itself defaults to real today.

## Do not

- Hand-edit prices in `card.json`.
- Compare on ex-VAT. Both sides of every comparison are VAT-inclusive (column F).
- Let a passing rate test clear a contract a gate already routed — `needs_human`
  is one-way, and there is a standalone guard asserting it.
