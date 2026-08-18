# WF-P — CC Below Agreed · 0-Sweep Payments  (`M79KcC9vaHte5Ibi`)

Stage 0, second of two. WF-A's three bulk payment nodes — `Get Month Payments`,
`Get Payments (M-1)`, `Get Payments (M-2)` — no longer call ERP themselves. Each is now
an Execute Sub-workflow node calling **this** workflow with `waitForSubWorkflow: true`,
passing its own window. This workflow does the pull, keeps the CC rows, and **dies with
the ~80% MV rows**.

## Why it exists

n8n retains every node's output for the life of an execution, so WF-A could not release
these pulls however much it trimmed downstream. Measured on the real July 2026 pull
(`probe/payments_jul.json`, 33,213 rows):

| | rows | retained (minified JSON) |
|---|---|---|
| raw, one window | 33,213 | **6.06 MB** (182 B/row) |
| CC only, one window | 6,774 (20.4%) | **1.28 MB** |
| raw, three windows | ~100k | **~18.2 MB** |
| CC only, three windows | ~20k | **~3.8 MB** |

On the pretty-printed basis used by the table in `VALIDATION.md` §12 (235 B/row) the same
reduction reads 22.4 MB → 4.6 MB. Same measurement, two bases; the ratio is what matters
and it is 4.9x.

## What the projection actually drops: nothing, per row

This is the honest part. The DTO carries **exactly seven fields** —
`contractID`, `contractType`, `paymentAmount`, `paymentDate`, `paymentId`,
`paymentMethod`, `paymentType` — and `Attach Month Payments` reads **all seven**. There
is no fat to trim, so the row shape passes through unchanged.

**The entire saving is the CC filter.** 79.6% of rows are MV, and
`Attach Month Payments` discards them on its first line anyway
(`if (s(r.contractType).indexOf('CC') !== 0) continue;`). Dropping them here means WF-A
never retains them.

## Why filtering here does not blind gate 2

Putting a filter upstream of a completeness gate is normally exactly how you blind one:
after the filter, a failed call and a CC-quiet month look alike, and gate 2 previously
had only `payments.length > 0` to go on.

So the **raw** count crosses the boundary as `_raw_rows`, and gate 2 now asks three
questions instead of one:

| question | test |
|---|---|
| was the window actually swept? | `_raw_rows >= 10,000` (July measured 33,213) |
| did the CC filter behave? | `cc + dropped === raw`, exactly |
| was CC itself present? | `cc_rows > 0` (CC is 20.4% of this route) |

That is **stronger** than what it replaced. The gate also refuses a *half*-staged run —
some windows CC-only, some CC+MV — because gate 18 compares months against each other,
and mixing the shapes would compare a CC-only month with a CC+MV one.

Covered by `offline/gate2_payments_test.js`, 8/8: the healthy case, each of the four ways
a staged window can be wrong, the mixed-shape case, and both unstaged cases.

## Contract with WF-A

**Input** (defined trigger fields, not passthrough — each caller maps its own window):

| field | mapped from, in WF-A |
|---|---|
| `bearer` | `$('Validate Inputs').first().json.params.erp_auth.bearer` |
| `from` / `to` | `range_start` / `range_end` for the audited month; `persistence_windows[1|2].from|.to` for M-1 / M-2 |
| `month_key` | `persistence_windows[0|1|2].key` |
| `run_id` | `run_id` |

**Output**: one item, `{ payments: [...] }` — the same envelope key the HTTP node emitted,
so `Verify Bulk Pulls` and `Attach Month Payments`, which both reach for these nodes **by
name** and read `page.json.payments`, needed no rewrite. Plus provenance:
`_raw_rows`, `_cc_rows`, `_dropped_non_cc`, `_rows_missing_contract_type`, `_month_key`,
`_from`, `_to`, `_projected_by`.

**The three caller node names are load-bearing. Do not rename them.**

## What it refuses to do

- **Sweep without a bearer** — every page would 401 and return zero rows, which gate 2
  cannot tell from a quiet month.
- **Sweep a malformed or >31-day window** — HTTP 400 on this route, and a 400 mid-sweep is
  indistinguishable from an access failure by the time WF-A sees it. `Validate Inputs`
  checks the same cap; this re-checks because the workflow can be called by anything.
- **Return an ERP error body as an empty sweep** — the one failure mode that scores the
  whole book as short.
- **Return a sweep whose every row had an empty `contractType`** — that is a shape change
  on the route (100% of live rows carry it), not a quiet month, and it would empty the
  cohort while looking clean.

## Nodes

1. `When Called` — `executeWorkflowTrigger`, five defined input fields
2. `Read Payment Window` — validates the window, refuses rather than sweeping the wrong month
3. `Sweep Month Payments` — `GET /accounting/payments/getReceivedClientsPayments?from&to`,
   no pagecode, not paged, 90s timeout. The `/accounting/` prefix is load-bearing: without
   it the load balancer answers with a bare HTML 403 that reads exactly like an account ban.
4. `Project CC Payments` — CC filter, accounting counters, the guards above

Node bodies are authored in `nodes/` in this directory and were pushed from there. Read
back after deployment and checked for the load-bearing details — the seven-field
projection, the `startsWith('CC')` test, the counters, and the longhand `isYmd` date test
(written out rather than as a regex precisely because a backslash class is the thing that
gets eaten shipping code into a Code node as a string). Not byte-diffed, unlike WF-A's
`Verify Bulk Pulls`, which was.
