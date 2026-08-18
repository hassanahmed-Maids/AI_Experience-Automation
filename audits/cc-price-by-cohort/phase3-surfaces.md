# Phase 3 — surfaces, rails and call budget

Status: **partial.** The rails below are extracted from the proven golden and are
solid. The per-surface probe table is NOT filled in — Phase 2 needs a live ERP
token, which is the one thing this build cannot self-serve.

## Rails inherited from the golden

Golden: `Qq473Ygj543jxPUN` (CC Non Received Monthly Payments) → `qAuvLHhae2sKD7mM`
(2-Verify) → `XN5DaOAfveAqtDMC` (3-Deliver). 73 nodes in stage 1.

### Auth — payload, never stored

The golden holds **no stored credential of any kind** (verified: every node's
`credentials` is null). The bearer is read per-run from the trigger payload:

```
authorization: {{ $('Validate Inputs').first().json.params.erp_auth.bearer }}
```

Our flow must do the same. This is the attribution rule, not a style choice.

### Population call — confirmed-working fallback, verbatim from the golden

`POST https://erpbackendpro.maids.cc/clientmgmt/contract/search/page`
pagecode `ClientList`, `size=40`, `includeNullNationality: false`,
`timeout: 90000`, `onError: continueErrorOutput`.

Pagination: `page = {{ $pageCount }}`, `requestInterval: 250`, `maxRequests: 200`,
complete when `$response.body.clients.content.length === 0`.

### Error rail

Every HTTP node uses `onError: continueErrorOutput` into a Build Error Callback →
Error Gate → failure email. Nothing crashes the run; failures are classified.

Workflow settings: `executionOrder: v1`, `saveExecutionProgress: true`,
`saveDataErrorExecution: all`.

## Three corrections this study already produced

### 1. The independent count is free on the fallback route (new)

`contract/search/page` returns a **`total`** key alongside `clients`. The handover
says completeness "rests on the empty-page terminator alone" — that is true of the
dynamic-API population pull, but **not** of the fallback route. On the fallback we
get an independent count for nothing and can assert the empty-page terminator
against it directly, which is the strongest form of the §9.1 population guard.

Do not trust it blindly: the traps file records aggregates being fanned out by
joins on other endpoints. Assert `total` against the de-duplicated row count and
report the delta rather than adopting either number as truth.

### 2. The golden does not send the cookie header (discrepancy — resolve in Phase 2)

Both the traps file and the probe handover mandate
`cookie: authTokenProduction=<token>; deviceIdProduction=<device>` on every call.
The golden sends **only** `authorization`, no cookie, and is the proven working
sibling.

So one of these is true, and the probe must say which:
- the cookie is genuinely required and the golden works for another reason, or
- the bearer alone authenticates these routes and the cookie is cargo-cult.

Build the probe to test one endpoint **both ways**. Until then, send both — the
superset is safe, and the cookie costs nothing.

### 3. Call budget — the check page understates by ~20x

| Pass | Calls |
|---|---|
| Population sweep (paged, size 40) | ~130 |
| `get-client-details` per contract | ~5,000 |
| `liveinoutlogs` per contract (living-switch gate) | ~5,000 |
| Evidence pulls on reds only | ~300 |
| **Total** | **~10,400** |

At the house pacing law (5 concurrent, 500 ms between batches) that is ~2-3 hours.
The check page's "~50 calls, inside the 500-per-run budget" counts only the
population sweep. **Correction to file on the check page once Phase 2 confirms
which population route is available** — the figure differs by ~5,000 depending on
whether the dynamic API returns cohort fields inline.

The `liveinoutlogs` sweep cannot be trimmed to failing contracts only: a switched
contract priced off the wrong cohort would then pass silently, which is the exact
false clearance gate 7 exists to prevent.

## Trigger shape

The golden's only trigger is a manual trigger, and its `respondToWebhook` nodes are
vestigial. Ours needs a **webhook trigger as the only trigger** — `execute_workflow`
always fires the first trigger and cannot be aimed, so an extra manual trigger would
silently swallow every payload-carrying run.

## Still to probe (Phase 2 — blocked on a token)

The 10 endpoints in `erp-access-probe-handover.md`, diffed against the 2026-08-17
baseline. Endpoint 1 (the dynamic-API population pull) is the only true blocker and
decides whether the enrichment sweep is ~5,000 calls or ~10,000.

---

# Live findings (2026-08-18, no ERP token required)

Executed the price-card reader (`1kX3isU27HfmPMU0`, execution 92102, manual, success).

### 4. Live price-card checksum: PASSED

49 windows across 5 cohorts, 0 rejected rows. Cohort split matches the pinned
card exactly: livein Filipina 11 / Other 14 / Ethiopian 15, liveout Filipina 5 /
Other 4. This satisfies the "price card checksum asserted at 49/5 in a live run"
item in build-handover §11.

### 5. Credentials are NOT visible on read-back — the traps file is wrong here

The traps file says to wire credentials via `addNode` and "verify by reading the
node back". On this instance `get_workflow_details` **never returns a
`credentials` key**, whether or not one is bound — the working card reader shows
none, and it demonstrably authenticates against Google Sheets.

So read-back cannot distinguish "credential missing" from "credential hidden",
and the traps file's verification step gives false negatives. **The only valid
check is asserting the credential inside a run.** Correction to file against the
traps document.

### 6. The `=TODAY()` drift is real and observable

The live read returns trailing window end dates of `8/18/2026`; the pinned card
captured `8/17/2026`. The end date genuinely moves every day.

`drift-check.js` proves this cannot change a verdict: the pinned card, a card
drifted by one day, one drifted by a year, one with the trailing end date blank,
and one carrying the live float noise (`4150.650000000001` vs `4150.65`) all
produce identical states, verdicts and gaps. The open-ended-window rule is
load-bearing — had the final window been treated as a hard bound, every contract
would have fallen out of the card the day after capture and scored unpriceable.

Run it with `node drift-check.js` (exit 1 on divergence).
