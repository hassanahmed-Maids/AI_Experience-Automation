# First live test of a converted flow — CC Overstay Fines, 2026-08-30

**Execution `110182`, 8.1 s, status `error`.** The failure is the ERP credential. Everything the
conversion changed worked.

## The workaround that made a test possible

Two blockers looked fatal and were not:

1. **n8n Variables are owner-only and unavailable.** They were never needed here — **CC Overstay
   Fines and MV Overstay Fines read their ERP token from a stored CREDENTIAL, not from `$vars`.**
   Credentials sit in the Adeeb project with `credential:update` on the operator's own scopes, so
   the token path is reachable without owner rights. Variables are a dead end; credentials are not.
2. **`saveManualExecutions` was `false`,** so the first run (`110179`) left *no record at all* —
   it could not be read back, which made it look like nothing happened. Set to `true`.

   **`saveDataSuccessExecution` deliberately left at `none`.** This check handles sensitive data;
   persisting successful-run node data would put per-entity case detail into n8n execution records,
   which the output-hygiene rule keeps in the case store. `saveDataErrorExecution` is already `all`,
   so a *failure* carries full detail — which is exactly what a test needs.

## What the run proves

`Build Run Context` executed and emitted, live:

| Field | Value | What it proves |
|---|---|---|
| `window_from` / `window_to` | `2026-07-01` / `2026-07-31` | **the computed previous full calendar month works** — this was `2026-05-01`..`2026-08-31` hard-coded before |
| `run_id` | `sched-2026-07-110318` | the pinned-vs-scheduled prefix works |
| `trigger` | `scheduled` | ditto |
| `delivery.workbook` | `true` | the corrected flag reaches the payload |
| `callback_url` | `""` | no portal delivery |
| `erp_call_budget` | `2000` | the gate's knob survived the rewrite |

**The error rail also ran end to end**, which is the part a naive delete would have broken:
`Build Error Callback` → `Build Error Run Row` → `Release Lease (error)` → `Fail Loudly`, with the
lease handed back cleanly (`action: release`, `state: free`, `verified: true`). The bridge from the
lease-strip work is sound on the error side as well as the main path.

## What failed

```
CC OVERSTAY FINES FAILED at "Get CC Change of Status Transactions" [erp_error]
```

The first ERP call. The flow's own rail classified it `erp_error` and reported `unknown error` —
consistent with the credential `ERP Token 12th Aug 2026` (`uDGE06IdxKx74kFz`) holding an expired
token, which is what its name has been saying for eighteen days.

Nothing partial was written: *"The Cases and Verdicts tables were NOT written for this run, so there
is no partial result to mistake for a complete one."* The flow failed in the correct direction.

## One nuance worth knowing

The run came from `Manual Trigger` (that is what `execute_workflow` picks), yet `trigger` reads
`scheduled`. That is by design — the label records **how the window was chosen**, not which trigger
fired, and no window was pinned. Worth remembering when reading a Runs row.

## The one fix

**Update the credential `ERP Token 12th Aug 2026` with a fresh token, in the n8n UI.** The operator
has `credential:update` on it. That single change makes both CC Overstay Fines and MV Overstay Fines
runnable — they share it.

It is also the production answer, unchanged: a stored credential, refreshed at deployment with a
production token. The four flows still reading `$vars` need that credential bound to their ERP nodes
before they can be tested at all.


---

# Second attempt — execution `110226`, 2026-08-30 11:57Z

**Same failure, and now the raw cause is visible.** ERP returned:

```json
{"timestamp":"2026-08-30 15:57:43","status":500,"error":"Internal Server Error",
 "message":"Token not valid, {Token is expired}",
 "path":"/accounting/transactions/page/advancesearchNew"}
```

**The credential still holds an expired token.** The update did not land — or landed on a different
credential. Nothing else changed between `110182` and `110226`.

This is exactly the shape Wellcare's own run-config node warned about:

> *"a dead token gives a 498-inside-500 shape rather than a clean 401, which reads like a server
> fault instead of 'get a fresh token'."*

The lease behaved correctly again: acquired (`granted: true`, `state: held`), then released on the
error rail (`state: free`, `verified: true`).

## NEW DEFECT — the error classifier loses the cause

`Build Error Callback` reported:

```
{"code":"erp_error","node":"Get CC Change of Status Transactions","status":null,"message":"unknown error"}
```

…while the raw error item plainly carried `statusCode: 500` and `"Token not valid, {Token is
expired}"`. **The classifier read neither.** So the flow's own failure record says *unknown error*
about a failure the API described precisely.

That matters beyond cosmetics: the Runs row, the failure e-mail and `Fail Loudly`'s thrown message
all inherit `unknown error`, so an operator reading any of them learns nothing and goes hunting.
An expired token is the single most likely failure of a scheduled audit — it is the one cause the
rail should name without being asked.

The error shape it needs to read is nested: `json.error.statusCode` and `json.error.error` (the
latter a JSON string containing `message`). Worth fixing before any of these flows is scheduled,
because on a schedule nobody is watching the execution list — the failure record IS the diagnosis.


---

# Third attempt — execution `110239`, after rebinding to `Hassan Bearer`

## The rebind

The refreshed token went into **`Hassan Bearer`**, but this flow was bound to
**`ERP Token 12th Aug 2026`**. Both are `httpBearerAuth`, so the six ERP nodes were repointed at
`Hassan Bearer` (`6LuYiBDo4D641TEz`, Adeeb project — note there are **two** credentials with that
name; the other is personal). **Recorded as a TEST-TIME rebind, not a production decision** — the
deployment ticket still asks the deploying team to create an ERP credential with a production token,
and a personal working credential is not that.

## The token works, and the flow got far past where it died before

| Run | Died at | After |
|---|---|---|
| `110182`, `110226` | `Get CC Change of Status Transactions` — the FIRST ERP call | 8 s |
| `110239` | `Judge Detail Batch` — the circuit breaker, several stages deeper | 13 s |

The population call **succeeded and returned real July 2026 transactions** — the execution context
carries the cohort, correctly windowed. So this is now confirmed working end to end on live ERP:
the schedule entry, the computed previous-full-month window, the lease, and the population pull.

## What stopped it — an ERP PERMISSION FINDING, not a bug

`Judge Detail Batch` is the generated circuit breaker (`audit-flows/tools/erp_breaker.js`). It
tripped on a **total refusal** of the `Get Transaction Detail` batch — every call to
`/accounting/transactions/{id}` (pagecode `AddEditTransaction`) was refused. Its own message:

> *"a refusal that is total does not heal, and a retry doubles it. Get the grant (or a live token),
> then re-run. ERP-LOAD-POLICY.md §5."*

The breaker is behaving exactly as designed: it refused to retry into a wall rather than hammering
ERP, and the run stopped in 13 seconds instead of grinding.

**This is the finding Wellcare's own doctrine anticipated:**

> *"If the operator's token lacks a permission, that is a FINDING to report, never an obstacle to
> route around with somebody else's login."*

So: the token can read the transaction **search** endpoint but is refused on the transaction
**detail** endpoint. That is an ERP access grant to request — not something to work around by
borrowing another account.

## The classifier defect bit twice more

`Build Error Callback` again reported `status: null`, `message: "unknown error"` — while the
breaker had produced a precise, actionable sentence. Diagnosing this run took two extra round-trips
purely because the flow's own failure record discarded the reason.

**This is now the highest-value fix in the flow.** On a monthly schedule nobody reads the execution
list; the Runs row and the failure e-mail are the whole diagnosis, and today they both say
*unknown error* about a permission problem the breaker named exactly.

## A note on execution data

The successful population call put per-entity detail (names, amounts, attachments) into the
execution payload. None of it is reproduced here or in chat. This is precisely why
`saveDataSuccessExecution` stays `none` on a check flagged *Handles sensitive data* — a green run
with success-data persistence on would write that detail into n8n's execution store.


---

# Classifier fixed — execution `110245`

## Before / after, same failure

| | Before (`110239`) | After (`110245`) |
|---|---|---|
| `code` | `erp_error` | **`erp_breaker_trip`** |
| `status` | `null` | `null` (correct — a self-trip has no HTTP status) |
| `message` | `"unknown error"` | **the breaker's full sentence** |

What `Fail Loudly` now throws — and therefore what the Runs row and the failure e-mail inherit:

> `CC OVERSTAY FINES FAILED at "Judge Detail Batch" [erp_breaker_trip]: a refusal that is total does
> not heal, and a retry doubles it. Get the grant (or a live token), then re-run.
> ERP-LOAD-POLICY.md §5.`

An operator reading only the Runs row now learns the cause and the next action.

## The two bugs

**A Code-node throw puts its message on the error output as a plain STRING.** The reader did
`err.message` on it, got `undefined`, and fell through to `'unknown error'` — so *every* Code-node
throw, including every circuit-breaker trip, was recorded as unknown.

**An HTTP node's error carries its status on `statusCode`** — the reader checked only `httpCode`
and `status` — **and the ERP body as a JSON string under `error`**, so both the status and the
message were lost. That is the shape of the expired-token failure in `110182` and `110226`.

## Two things found while fixing it

- **The `item_linking` branch was dead code.** It matches on message text, and string errors never
  produced a message, so a paired-item throw could never reach it. It works now.
- **A plain 403 was also losing its status**, so it classified as generic `erp_error` rather than
  `erp_permission`.

## Ordering detail that matters

`erp_breaker_trip` is tested **above** the loose `/token/` match, because the breaker's own message
contains the words *"live token"*. Tested the other way round, a self-protective trip would be filed
as an auth failure and send the reader hunting for a credential problem that may not exist. An
explicit `401` status still wins outright.

## Verification

Six payloads, run against the extracted source rather than a re-typed copy: the two real ones from
`110226` and `110239`, the Error-Trigger envelope the old reader was written for (**unchanged** —
no regression), a plain 403, a paired-item throw, and an empty payload (still the honest
`unknown error` fallback). The node body was parse-checked with `node --check`.

**The underlying ERP grant is still needed** — the run still stops at the same place, for the same
reason. It just says so now.


---

# Porting the classifier fix — not needed, and that is the finding

Checked all six flows before changing anything. **The siblings already had the fix.** CC Overstay
Fines was the outlier.

| Flow | Rail head | string err | `.statusCode` | `response.status` | `err.error` | parses JSON | breaker code | lines |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|--:|
| **CC Overstay (before)** | `Build Error Callback` | **NO** | yes | **NO** | **NO** | **NO** | yes | 104 |
| Dummy Tickets | `Capture Failure` | yes | yes | yes | yes | yes | yes | 187 |
| MV Overstay | `Capture Failure` | yes | yes | yes | yes | yes | yes | 202 |
| Applicant Real Ticket | `Capture Failure` | yes | yes | yes | yes | yes | yes | 182 |
| MV Stage 1 | `Capture Failure` | yes | yes | yes | yes | yes | yes | 184 |
| Terminated HM | `Capture Failure` | yes | yes | yes | yes | yes | yes | 187 |

MV Overstay also has a `Build Error Callback`, and it does lack string handling — but the graph
shows it sits **downstream** of the rail head, reading
`$('Capture Failure').first().json._failure`, i.e. consuming a failure that is already classified
correctly. Its own extraction is a fallback that only runs if that is missing. Nothing to fix.

## What this actually was: skeleton drift

CC Overstay's rail head was a **104-line** node named `Build Error Callback`. Every sibling uses a
**182–202-line** `Capture Failure` that had already solved string errors, nested JSON bodies,
`response.status` and breaker classification. CC Overstay was not missing a fix nobody had written —
it was running an **older generation of the same rail**.

That drift cost three debugging runs and two wrong hypotheses before the cause was visible.

**And it is exactly the drift the readiness gate reported it could not measure.** From
`work/readiness-2026-08-30.md`:

> *"`Skeleton Version` is null on every queued row … There is no version string to compare a built
> flow against, so assertion 9 fails universally and drift is invisible."*

This is that failure mode landing for real. A populated `Skeleton Version` would have shown CC
Overstay behind the family without anyone reading a line of code.

## Recommended, not applied

Rather than back-porting anything, the cheaper correction is the reverse: **CC Overstay's rail head
should be brought onto the sibling `Capture Failure` pattern**, so there is one rail implementation
instead of two. The fix now in place makes it behave correctly, but it is still a second
implementation of the same thing — and a second implementation is how this drift happened.
