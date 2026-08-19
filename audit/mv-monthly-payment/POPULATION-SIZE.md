# Why ~23,000 contracts, and not fewer

Asked 2026-08-19, before the first full run. Short answer: **23,000 is the owner's ruling, not an
accident of the sweep.** But the number that actually costs hours is not the population — it is how
many of those contracts need an expensive read, and that is a separate question with a real answer.

## 1. Where 23,000 comes from

Two cohorts are swept and unioned:

| cohort | reported total | in scope for one audited month |
|---|---|---|
| ACTIVE (`maidvisa.ae_prospect`, default status) | 22,870 | ~22,700 |
| CANCELLED (`FILTER_CANCELED`) | 22,649 | **~50–350** |

The cancelled cohort is nearly the same size as the active one, but almost all of it is out of
scope: a contract that terminated before the audited month owes nothing for it. Measured on a
500-row page, only 0.2%–1.6% of cancelled contracts terminated in or after a candidate audited
month (`DEVIATIONS.md` F12). So the union is ~23,000 — barely more than ACTIVE alone.

Those few hundred cancelled contracts are not a rounding error. **Both of this check's verified reds
(1023590 and 1074171) are CANCELLED contracts.** An ACTIVE-only sweep is a snapshot of today and
would have reported neither. That is why the cheap population is not the correct one.

## 2. Why the population is not narrowed further

The spec forecloses it explicitly:

> Every MV contract should be paying us, so every MV contract is in scope whether or not it appears
> in any file.

> Never narrow this population to contracts that produced a payroll row. A contract that was never
> billed at all is invisible to a payroll-driven run, and that is the most serious shape this check
> can find.

Every cheap way to shrink the population works by starting from evidence that money was *expected* —
a payroll row, an invoice, a ledger entry. A contract that was never billed produces none of that.
It is silent in exactly the systems you would filter on, and silence is indistinguishable from
"paid" unless you start from the contract side. The check's most valuable finding is the one that
cannot be reached from a payment file, so the population has to be contract-driven and complete.

The scope filters that ARE applied are the ones that cannot hide a finding:

- **starts after the audited month** — owes nothing for it, and the Pre-Collected shift only ever
  moves the tested month *earlier*, so this is safe in both directions.
- **ended before the cutoff** — and the cutoff reaches one month *further back* than the audited
  month, precisely so a Pre-Collected contract tested on the previous month survives it.
- **client 24190** — the company owner account, excluded from collection and from findings.

## 3. The number that actually costs time

23,000 contracts in scope is not the same as 23,000 expensive reads. ~94.2% of contract-months are
paid in full, so ~1,300 contracts are plausible candidates for a finding. In principle the run could
read the cheap ledger for everyone and the expensive `CONTRACT_DETAILS` only for the ~1,300 whose
ledger does not already clear them — roughly halving the call budget.

**Not done, deliberately.** Deciding a month is clean from the ledger alone requires inferring
`expected` from the ledger, and the audit already knows three ways that inference goes wrong:

- `is_pre_collected` lives on `CONTRACT_DETAILS`, and it decides **which month is under test**.
  Read it wrong and the run audits the wrong month — which is how contract 1074171's AED 2,405 red
  nearly got suppressed.
- `expected` comes from `currentPayments[].workerSalary + visaFees`, also on `CONTRACT_DETAILS`.
  A contract whose plan says 2,405 and whose ledger says nothing looks identical, from the ledger,
  to a contract that owes nothing.
- termination and start dates on the search row disagree with `CONTRACT_DETAILS` often enough that
  gate 2 prefers the detail record.

So the cheap pre-filter would clear contracts using the very fields it skipped reading. Every case
it got wrong would be a **false clearance** — a contract silently marked clean — which is the one
error class this check exists to prevent. Paying 2× the calls to avoid it is the right trade for a
monthly manual check.

If the runtime becomes the binding constraint, the safe version of this optimisation is to read
`CONTRACT_DETAILS` for everyone but skip the **ledger** read where the detail record shows nothing
owed (`expected <= 0`). That direction only ever drops reads for contracts already proven to have
nothing at stake, so it cannot manufacture a clearance. Not built.

## 4. So the honest cost

| | |
|---|---|
| contracts in scope | ~23,000 |
| ERP reads | ~46,000 (ledger + `CONTRACT_DETAILS` per contract) |
| pacing | 3 concurrent, 750 ms interval, per surface |
| estimated wall clock | ~5–9 hours |
| token lifetime | ~10 hours at best, and the last one died after 4 |

The run is therefore **sliced**, not shortened: `offset` + `limit` cut the in-scope population by
ascending `contractId`, consecutive slices share one `runId`, and the month is covered when the
slices reach the reported in-scope total. Shrinking the population was never the available lever;
splitting the run was.
