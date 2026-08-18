# Stage 3 — Deliver (`ZJDiRTzk6uRYBJwq`)

Chain: Stage 1 `7j5Z5KPvBcWRPfvy` (draft) → Stage 2 `bBYbpHcWMWybDQxN` (published)
→ Stage 3 `ZJDiRTzk6uRYBJwq` (published).

```
Receive Baton → Read Cases For Run → Reconcile + Aggregate
              → Write Run Row → Verify Run Row Landed
```

## The one design decision that shaped everything

**Counts come from re-reading the Cases table, not from Stage 2's counters.**

Stage 2 knows how many contracts it *scored*. It does not know how many were
*persisted* — and today those two numbers differed by 40, because every insert
was being rejected while the node reported success. Stage 3 therefore treats the
table as the only source of truth and ignores `cumulative_processed` entirely
except as context.

The same reasoning is applied to Stage 3's own write: the Runs insert leaves
`optimizeBulk` off so the node returns the stored row, and `Verify Run Row
Landed` throws unless that row carries an assigned `id`. Stage 3 will not claim
to have reported a run it did not actually store.

## Delivery refusals (hard stops, no summary written)

- any contract in the population without a case row
- zero case rows for a non-empty population
- population guard did not report a complete pull
- price card failed its checksum

Each throws with the count, because a summary covering part of the population
reads exactly like a complete audit.

## Verdicts — why there is an INCONCLUSIVE

| overall | when |
|---|---|
| `HALTED EARLY` | `chunk.max_chunks` stopped the run deliberately |
| `INCONCLUSIVE` | **half or more of contracts could not be judged** |
| `FINDINGS` | at least one contract priced below the card |
| `CLEAN` | every contract judged, none below the card |

`INCONCLUSIVE` exists because of the nationality blocker. Today every contract
scores `pending / no_nationality`, and a naive summary would report **0 red, 0
under-priced** — which reads as a clean bill of health for 5,393 contracts the
check never actually examined. That is the single most dangerous output this
system could produce, so it is a distinct verdict with an explicit headline:

> "Could not judge N of M contracts (X%). This is NOT a pass — the check could
> not form an opinion on most of the population. Dominant reason: no maid
> nationality available in ERP."

## Honest-accounting fields

- **`unimplemented_tests_inflation`** — counts contracts that failed every
  *implemented* test. Since the two unimplemented tests (`upgrading_nationality`,
  `pro_rated`) can only ever clear a contract, this is the exact upper bound on
  how many non-green verdicts might be wrong. Reported on every run.
- **`blocked_surfaces`** — names each surface that could not be read and how many
  contracts it affected, including the payment-term gate that never fired.
- **`nationality_source`** — the provenance breakdown, so a future reader knows
  whether a green verdict rested on a real nationality or a fallback.

## Not implemented

`first_seen` and `times_reported` on the Cases table are for recurrence tracking
across runs. Stage 3 does not populate them; a case is currently a fresh row per
run. Wire this up when more than one real run exists to compare.

## Publishing note

Publishing Stage 2 is refused by n8n while any referenced sub-workflow is a
draft, regardless of `waitForSubWorkflow`. Stage 3 therefore had to be published
for the Stage 2 chain to stay live. Stage 1 remains a draft and is still the only
entry point.
