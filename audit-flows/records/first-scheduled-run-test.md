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
