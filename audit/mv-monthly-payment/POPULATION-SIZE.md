# Why ~24,000 contracts, and not fewer

Asked 2026-08-19, before the first full run. Short answer: **the population size is the owner's
ruling, not an accident of the sweep.** But the number that actually costs hours is not the
population — it is how many of those contracts need an expensive read, and that is a separate
question with a real answer.

> **Measured 2026-08-19, run `mvmp-2026-07-full` slice 1.** The in-scope population for 2026-07 is
> **24,378**, not the ~23,000 estimated below. Both cohorts reconciled exactly (22,870/22,870 and
> 22,649/22,649). The estimate was wrong in one place and it is worth saying why — see §1.

## 1. Where the number comes from

Two cohorts are swept and unioned:

| cohort | reported total | in scope for 2026-07 (**measured**) |
|---|---|---|
| ACTIVE (`maidvisa.ae_prospect`, default status) | 22,870 | 22,281 |
| CANCELLED (`FILTER_CANCELED`) | 22,649 | **2,097** |
| | | **24,378 in scope** |

Out of scope: 661 start after the audited month, 20,455 ended before the cutoff, 25 owner-account.

The cancelled cohort is nearly the same size as the active one, and most of it is out of scope: a
contract that terminated before the audited month owes nothing for it. But **most is not almost
all.** The pre-run estimate said 0.2%–1.6% of cancelled contracts were in scope (~50–350); the
measured figure is **9.3% (2,097)** — off by 6× to 40×.

The estimate came from sampling a single 500-row page, and the default sort returns the oldest
contracts first. That page was overwhelmingly 2017–2018 terminations, so it could not have contained
recent cancellations at their true density. **A single page of a sorted endpoint is not a sample of
the population.** Extrapolating a rate from one is the error; the guard that caught it was reading
the run's own counts instead of trusting the estimate.

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

24,378 contracts in scope is not the same as 24,378 expensive reads. ~94.2% of contract-months are
paid in full, so ~1,400 contracts are plausible candidates for a finding. In principle the run could
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

| | | source |
|---|---|---|
| contracts in scope | **24,378** | measured, slice 1 |
| ERP reads | ~48,800 (ledger + `CONTRACT_DETAILS` per contract) | |
| pacing | 3 concurrent, 750 ms interval, per surface | |
| measured scoring rate | **15.7 s per 25-contract chunk** (0.63 s/contract, both reads) | measured, slice 1 |
| scoring wall clock | **~4.3 hours** | 24,378 × 0.63 s |
| population sweep, per slice | **12.5 min** (both cohorts, ~460 paced calls each) | measured, slice 1 |
| session lifetime | assume ~4 hours; one session dropped that fast | measured |

The run is therefore **sliced**, not shortened: `offset` + `limit` cut the in-scope population by
ascending `contractId`, consecutive slices share one `runId`, and the month is covered when the
slices reach the reported in-scope total. Shrinking the population was never the available lever;
splitting the run was.

Slice size trades sweep overhead against execution length: every slice re-sweeps (12.5 min), so 3,000
contracts per slice costs ~44 min per execution and ~1.7 h of sweep across the month, while smaller
slices spend more of the run sweeping than scoring.
