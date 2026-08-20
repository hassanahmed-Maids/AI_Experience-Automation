# ERP load compliance — CC Price by Cohort

Audited 2026-08-20 against `../ERP-LOAD-POLICY.md`. Three flows, tag `audit: CC Price Cohort`.
**IN PROGRESS — Stage 1 only.** Stages 2 and 3 not yet read.

| stage | id | verdict |
|---|---|---|
| 1 — Population & Price Card | `7j5Z5KPvBcWRPfvy` | pacing fixed; 4 findings open |
| 2 — Enrich & Score | `bBYbpHcWMWybDQxN` | **not yet audited** |
| 3 — Deliver & Verify | `ZJDiRTzk6uRYBJwq` | **not yet audited** |

## Fixed

**§1 pacing.** `Get Population (dynamic API)` ran `batchSize 3 / batchInterval 250` = **12 req/s**,
three times the ceiling. Now 2 / 500 = 4 req/s. The sweep is ~12 pages, so this costs a couple of
seconds of wall-clock.

## Open findings

### 1. §1 page size — `SIZE = 500`, unmeasured

`Build Page List` and `Population Guard` both hardcode `SIZE = 500`. The new §1 rule caps
nested/entity responses at **100 rows**, allowing larger *only with a measured per-page byte cost
recorded next to the node*. There is no such measurement here.

**It may well be fine**, and that is why it is a finding rather than a fix: this route is
`admin/dynamicApi/evaluateApi?code=getactivecccontracts`, which returns a **flat six-field
projection**, not the nested contract trees that took clientmgmt down at `size=500`. A flat 500
rows is a different animal from a nested 500. But nobody has measured it, and the whole point of
the new rule is that the response — not the call count — is the load.

**Do not change it blind**, for a second reason: `SIZE` appears in *two* nodes and they must
agree. `Population Guard` validates page shapes against it (interior pages must be exactly
`SIZE`), so changing one and not the other fails the guard on correct data. That coupling is
itself worth removing — the guard should read the size the page list actually used.

Action: measure one page's byte cost when ERP is healthy, then either record it beside the node
or drop to 100.

### 2. §3 no pre-flight budget gate

Stage 1 knows the population (~5,401 contracts) and launches Stage 2, which reads per contract.
Nothing projects or refuses that cost. The gate belongs immediately before `Launch Stage 2`.

### 3. §4 no ERP lease — and this chain needs the lease held ACROSS executions

Stage 1 is an entry flow (webhook) that reaches ERP, so §4 applies. But it launches Stage 2 with
**`waitForSubWorkflow: false`** — fire and forget — so Stage 1 *ends* while Stage 2 is still
hitting ERP. A lease released when Stage 1 ends would protect almost nothing.

The design that fits: **acquire in Stage 1, release in Stage 3.** The lease is a row keyed by
`run_id`, not something an execution has to stay alive to hold, so a chain can carry it across
executions by passing `run_id` along — which this chain already does. A crashed chain is covered
by the 3-hour staleness takeover.

This is a better fit for the lease than the blocking model, and worth noting as a pattern: **the
lease is held by the RUN, not the execution.**

### 4. §5 no circuit breaker in `Population Guard`

It is the projection node downstream of `Get Population` and has excellent *completeness* guards —
page-shape rules per class, an independent count from a deliberately different route, a probe page
past the end — but nothing that notices ERP degrading.

Partial mitigation already present: `Get Population` sets no `neverError`/`onError`, so a 5xx
fails the node and stops the run after 3 retries. That is a crude abort-on-error rather than a
breaker, and it means a single 5xx kills a run that a breaker would have let ride.

## Worth copying from this check

Stage 1 answers the webhook **200 immediately** (`Respond 200 (accepted)`) and audits in the
background. MV Monthly Payment does not — it holds the connection for the whole run and would 524.
This flow gets it right.
