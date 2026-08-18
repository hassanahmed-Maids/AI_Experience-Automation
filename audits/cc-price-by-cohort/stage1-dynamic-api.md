# Stage 1 rebuilt on the dynamic API — 2026-08-18

All three stages are now published. Stage 1's production webhook:
`https://sami-team.app.n8n.cloud/webhook/cc-price-by-cohort-stage1`

## What changed

```
Validate Inputs → Read Price Card → Parse + Assert Card
   → Get Independent Count        (contract/search/page, size 1, reads `total`)
   → Get Population (dynamic API) (size 500, ~11 pages)
   → Population Guard             (completeness + PII projection)
   → Launch Stage 2
```

**Population source.** `dynamicApi/getactivecccontracts` at `size: 500`, paging on
`context.page`, terminating on the first empty array. Verified behaviour: size is
honoured exactly, offsets are `page × size` with nothing falling between pages,
and an out-of-range page returns `[]`.

11 pages instead of 135 — the pull drops from ~15 minutes to under two. The 2400 s
execution ceiling is no longer the binding constraint on the population stage.

**maidNationality and maidLiveOut arrive inline**, so the cohort key costs no
per-contract call. Stage 2's `Resolve Nationality` now reads `SOURCE = "baton"`.

## Two new guards, because this route is weaker in one way

The dynamic API returns **no `total`**, so completeness cannot be self-reported.

1. **Independent count.** One `contract/search/page` call at `size: 1` reads its
   `total`, and the guard cross-checks the de-duplicated population against it.
   Deliberately a *different route*, so the population is never validated against
   its own arithmetic.
2. **Short-page detection.** Any non-final page returning fewer than 500 rows is
   fatal. This is exactly how the documented flattened-body trap manifests:
   parameters outside `context` return HTTP 200 with a silently smaller page.
   Confirmed live — asking for 100 outside `context` returned 20.

Both are hard aborts. A short read still emits nothing.

## PII boundary moved into the guard

`Assemble Baton` is gone; its projection is folded into `Population Guard`, so
there is exactly one line in the system where `clientName` and `maidName` are
dropped. The baton carries only `contract_id`, `client_id`, `maid_nationality`,
`live_out`, `contract_start_date`.

The raw HTTP node output still holds the names inside n8n execution data. That is
inherent to `saveDataSuccessExecution: all`, which is on deliberately so failures
are diagnosable.

## Known hygiene issue: bearer tokens persist in execution data

The flow takes the operator's token as a runtime payload — correct, and better
than a stored credential. But with execution data saved, the bearer is visible in
the webhook node's output for every past run. Tokens expire in roughly 12 hours,
so the window is bounded, but anyone with n8n execution access can read a live one
inside that window.

Worth deciding on before this runs regularly. Options: set
`saveDataSuccessExecution: none` on Stage 1 only (loses success diagnostics),
prune executions on a schedule, or move to a scoped audit service account so the
token in the logs is the audit function's rather than a person's. The service
account solves this and the nationality grant together.

## Not yet run

Nothing in this rebuild has executed. The account that can test it is the one
holding the grant, so the first real run will be driven by that operator against
the production webhook with their own token.

What that run should show:

| Field | Expected |
|---|---|
| `population.pages_fetched` | ~11 |
| `population.count` | ~5,395, matching `independent_count` |
| `population.with_nationality` | ~4,300 |
| `population.without_nationality` | ~1,072 |
| cases scored | 10 (chunk capped), with real cohorts and possibly the first reds |
