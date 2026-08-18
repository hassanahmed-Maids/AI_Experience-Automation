# WF-S — CC Below Agreed · 0-Sweep Statuses  (`D1mCMJuN9lMURJHb`)

Stage 0. WF-A's `Get Payment Statuses` node no longer sweeps ERP itself — it calls this
workflow with `waitForSubWorkflow: true`. This workflow does the paging, projects the
rows, returns the projection, and **dies with the raw copy**.

## Why it exists

n8n retains every node's output for the life of an execution, so WF-A could not release
the status sweep however much it trimmed downstream. Measured 2026-08-18:

| | bytes/row | rows | retained |
|---|---|---|---|
| raw DTO | 1,056 | 43,727 | **44.1 MB** |
| projected | 489 | 43,727 | **20.4 MB** |

44.1 MB was the largest single item of retention in the run and 57% of ~77 MB total,
against a measured healthy band of 44–61 MB and a kill band of 100.6–142.6 MB.
Execution 92433 crashed at 22m35s carrying it; 89604 crashed at 94m44s. Ending a
sub-execution is the only mechanism that actually frees the rows.

`cohort_cap` never helped: it caps the cohort AFTER `Build Cohort`, by which point every
sweep is already resident. That is why the capped runs crashed too.

## Two properties that make this safe

**The node name in WF-A is unchanged.** `Verify Bulk Pulls`, `Build Cohort` and
`Attach Month Payments` all reach for `$('Get Payment Statuses')` **by name** and read
`page.json.content`. This workflow returns the *same envelope shape* —
`{content, totalElements, totalPages}` — so not one of those three consumers changed.
Do not rename that node.

**It returns ONE item, not one per page**, which is only safe because of a gate-2 change
made the same day: the completeness proof is now the reconciliation against
`totalElements`, and the short-page test is a fallback that runs only when no total was
declared. Under the previous hardcoded `content.length < 40`, a single 43,727-row item
would have read as a full page and gate 2 would have thrown on a complete sweep.

## The projection is derived, not guessed

Every retained field is one a consumer reads:

- `Attach Month Payments` — `id`, `amountOfPayment`, `dateOfPayment`, `status.value`,
  `typeOfPayment.name`, `methodOfPayment.label`, `replaced`, `contract.id`
- `Build Cohort` source B — `contract.{id,status,startOfContract}`,
  `contract.client.{id,name}`, `contract.housemaid.{id,label,nationality}`,
  `contract.contractProspectType.code`

Nesting is preserved rather than flattened, so consumers need no edit.

Dropped, present on the DTO and read by nobody: `bankName`, `chequeName`,
`chequeNumber`, `chequeWithTheBank`, `creationDate`, `dateChangedToPDP`,
`dateChangedToReceived`, `directDebitFile`, `errorMessage`, `isInitial`, `note`,
`ongoingCollectionFlows`, `vat`, `vatPaidByClient`, and
`contract.{contractType,isProRated,paidEndDate}`.

`contract.dateOfTermination` is **not** dropped — it was never there. A payment-row stub
carries no termination date, which is precisely why `Build Cohort` dates cancelled stubs
from the terminated sweep's index instead.

## Completeness is checked on BOTH sides

If this workflow returned a short sweep, WF-A would see a projection that looks
perfectly well-formed. So the reconciliation against `totalElements` runs here too, with
the same 25-row drift allowance — one dropped page at size 2000 is 2,000 rows, far
outside it.
