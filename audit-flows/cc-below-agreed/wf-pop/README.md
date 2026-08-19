# WF-Pop · CC Below Agreed · 0-Sweep Population

`RbW2fT3b6rtqVQ9H` — Adeeb project, tag `audit: CC Below Agreed`. Published 2026-08-19.

Stages **both** of WF-A's `clientmgmt/contract/search/page` walks out into a sub-execution.

```
When Called  →  Read Population Request  →  Active or Terminated?
                                              ├─true→  Sweep Terminated Contracts ─┐
                                              └─false→ Sweep Active Population ────┴→ Project Population Rows
```

Called twice by WF-A, from nodes that kept their original names:

| WF-A node | mode | rows | Join Bulk Pulls input |
|---|---|---|---|
| `Get CC Contract Population` | `active` (status ACTIVE) | ~5,405 over 136 pages | 0 |
| `Get Terminated Contracts` | `terminated` (FILTER_CANCELED, dateOfTermination ≥ range_start) | ~949 over 24 pages | 5 |

## Why it exists — the honest version

The memory saving is the **weaker** half of the case, and was overstated earlier in the
build. Measured on a live page 2026-08-19: population rows are **904 B/row minified**, so
the active walk is **4.66 MB**, and the projection takes it to ~351 B/row = **1.81 MB**.
That is **~2.85 MB** against a tail that peaks near 98 MB — noise. An earlier 9.2 MB figure
for this sweep came from a pretty-printed probe file and was ~2× high.

The reason that does justify it: every row carries **`workerSalaryMonthlyTip` — the
housemaid's salary** — and nothing in this check reads it. Unstaged, it sat in WF-A's
retained node output for the whole run *and* in the stored execution record, where anyone
with project access could read ~6,350 salaries at leisure. The projection drops it, with
`clientComplaints`, `clientReplacments`, `maidComplaints`, `deletedFromApp`,
`longTermPackage`, `visaRenewalDeclined`, and the `client.lastBlockLog` / `spouseName` /
`city` / `blocked` subtree. **This is why the terminated walk was staged too** — same route,
same DTO; staging only the active book would have left 949 salaries behind and looked done.

## Two decisions that must not be "simplified"

1. **One item per page.** Unlike WF-S (which returns one collapsed item), gate 2 proves this
   walk terminated by its **last page being short** (`< 40`) — a walk ending on a full page
   hit the request cap, not the end of the data, and a truncated cohort is a false green by
   omission. A single 5,405-row item would read `5,405 >= 40` and throw on a *complete*
   sweep. `wf-pop/offline/population_test.js` runs the collapsed shape through the real
   gate 2 and asserts it still throws.
2. **Two HTTP nodes, not one parameterised request.** Each walk's options were tuned and
   verified live and are lifted byte-identically: active runs `fullResponse: true`,
   `maxRequests` 400, no interval; terminated runs plain json, `maxRequests` 200,
   `requestInterval` 250 ms. Folding them together would silently retune both.

`mode` has no default — an unrecognised one throws, because the two walks differ only by a
status filter on the same URL and guessing substitutes a different population. `range_start`
is revalidated as `yyyy-mm-dd` inside the sub-workflow: ERP accepts a malformed
`extraFilters` date and answers with a **different** population rather than an error.

Zero rows means different things per mode. Active: an access or filter failure, never a real
state (the CC book measured 5,202 / 5,393 / 5,405 on three separate days) — it throws.
Terminated: improbable but possible, so it emits **one empty `clients.content` envelope**,
which is exactly the read-happened proof Build Cohort insists on; returning nothing would
make a quiet month indistinguishable from a failed sweep.

## Tests

`node wf-pop/offline/population_test.js` — **31/31**. Runs both real node bodies against the
redacted live page fixture, then feeds the projected output into the real `Verify Bulk Pulls`
and the real `Build Cohort` and asserts identical row counts, declared total, reconciliation
verdict, page count and cohort. Also asserts the salary field is absent from the output
(checked on the output, not the intent), that the three lying envelope fields
(`size`/`totalPages`/`last`) are not passed on, and that every silent-failure path throws.
