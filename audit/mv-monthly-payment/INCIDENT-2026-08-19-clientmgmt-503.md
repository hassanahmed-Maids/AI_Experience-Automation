# INCIDENT 2026-08-19 — clientmgmt module 503 during the first live Stage 1 run

**Status: open at time of writing. All calls to `/clientmgmt/*` stopped.**

## What happened

The first live run of Stage 1 (`IKRXhIco1mwxrcPq`, execution 93412, manual mode) ran
**09:42:49–09:45:08 UTC** and issued roughly **116 requests to
`POST /clientmgmt/contract/search/page`**, most at **`size=500`**, at **5 concurrent with 500 ms
between batches**.

Immediately afterwards the entire client-management module began returning **HTTP 503 Service
Temporarily Unavailable** — an nginx-level 503, not an application error:

- `/clientmgmt/contract/search/page` — 503 at every size probed, including `page=0&size=1`
- `/clientmgmt/client/get-client-details/...` — 503
- `/accounting/payments/page/advancesearch` — **200, still healthy**

So the degradation is scoped to the **clientmgmt module**, not the whole ERP.

Before the run, the same contract-search endpoint had been probed repeatedly and healthily,
including `page=1` and `page=2` at `size=500`, which returned 500 rows each.

## Cause

**Most likely this run.** Causation is not proven — an unrelated deploy or outage is possible —
but the correlation is tight enough that the honest position is that the sweep caused it.

The mistake in reasoning: the spec's "never a bare date-range sweep at width" warning was
correctly applied to the *payments* endpoint and then **not** carried over to contract search,
on the grounds that ~58 calls per cohort is "cheap". **Call count is not load.** Each `size=500`
response carries 500 nested contract records, and two cohorts were swept five at a time. That is
a far heavier request pattern than any human ERP session produces.

## What behaved correctly

The **population guard did its job**. Because tail pages started 503ing mid-sweep, the reconcile
step found the sweep short and **aborted rather than scoring a partial population**:

```
active:    swept 520 of 22,869 (tolerance 46) - SHORT by 22,349
cancelled: swept 669 of 22,649 (tolerance 46) - SHORT by 21,980
```

520 is exactly page 0 (40 rows) plus the 12 head pages (12 x 40). No cases were written, no Runs
row was created, nothing was reported. **The run produced no false clearances** — which is the
whole reason that guard exists, and it is the one part of this that worked as designed.

## Before the sweep runs again

1. **Re-measure the real per-page cost** of contract search rather than assuming it. The earlier
   1.6 s figure was measured on the payments endpoint, not this one.
2. **Pace far more conservatively on a production module:** serial or at most 2 concurrent,
   `size` 40–100, with a longer interval. That costs more calls and is survivable; the current
   shape is not.
3. **Add a circuit breaker.** The sweep should abort on the FIRST 5xx rather than continuing
   through ~100 more requests against a module that is already failing. As built it kept going
   and only noticed at the reconcile step.
4. Consider whether the sweep needs to run at all on every execution, or whether the population
   can be cached per audited month and refreshed deliberately.

## The generalisable lesson

A "cheap" call budget can still be an expensive load profile. Count **bytes and concurrency**,
not just requests, before pointing a sweep at a production module — and make the first 5xx stop
the sweep, not the reconciliation afterwards.
