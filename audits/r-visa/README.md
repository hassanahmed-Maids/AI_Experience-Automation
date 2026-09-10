# R-Visa Duplicate Payments — Police & Control audit

Ad-hoc P&C audit, run 2026-09-09/10. **Not part of the ERP → CustomerIO migration
pipeline this repository otherwise serves** — it lives here because this branch was
designated for the work and the analysis is worth keeping.

| File | What it is |
| --- | --- |
| `SPEC_rvisa_duplicate_payments_v3.md` | The deliverable. Business logic, data points, tests T1–T9, metrics, UI, worked examples, 10 open decisions. |
| `rvisa-dashboard.html` | Published mockup with real rows — https://claude.ai/code/artifact/3ce6b63e-afbb-4b45-8eff-d530f899e735 |
| `payments-184.tsv` | Payment-level detail for the 90 multi-payment cases (184 rows). |
| `cases.json` | Adjudicated cases with verdict, reasons, money and recovery state. |
| `queries_W1_W2.sql` | Coverage waterfall + case pricing. Other queries are inline in the spec's history. |

## Headline

45 confirmed cases · **AED 16,853.50 still out** · 45 blocked pending a ruling
(AED 8,873.50) · 69,218 R-visa payments examined, all-time.

Over half the exposure is in the last 24 months and the rate is rising — see the
by-year metric in the spec.

## Standing constraints

- **Never schedule this.** Manual runs only; a recurring data process goes to the ERP team.
- **No approved KPI exists** for this definition. Every figure is an unverified ad hoc
  measure pending Data Catalog registration.
- **No personal data** is selected into the report or export. `DESCRIPTION` may be read
  as a filter predicate only.

## Before re-running

Read §2.4 first. The reference lists (heads, fee schedule, refund amounts, batch dates)
each gate a verdict, and three of them were wrong at some point during development in ways
that moved money. Their run guards are stated with them.
