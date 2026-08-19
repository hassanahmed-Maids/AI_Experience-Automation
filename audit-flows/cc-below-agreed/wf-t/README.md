# WF-T · CC Below Agreed · 1-Score Batch

`pOa3yRIyguSyoBk4` — Adeeb project, tag `audit: CC Below Agreed`. Published 2026-08-19.

Scores **one batch** of assembled cases in its own execution and writes that batch's rows to
the Cases tab, so WF-A never holds the scoring tail's five copies of the cohort.

```
When Called → Validate Inputs → Join Enrichment → Compute Case States → Guards
            → Adjudicate Cases → Stamp Display Bands → Build Sheet Rows
            → Cases -> Google Sheet → Return Batch Result
```

In WF-A: `Merge Streams → Chunk Cases → Score Batch (WF-T) [mode: each] → Join Scored → Build Runs Log`.

## What it fixes

Execution 93346 crashed **26 seconds after the last enrichment chunk returned** — at the last
unstaged stage. WF-A retained the whole cohort at `Compute Case States`, `Guards`,
`Adjudicate Cases`, `Build Sheet Rows` and the Sheets node's echo of the appended rows: five
copies at ~2.5 KB a case over ~5,632 cases, roughly **70 MB**. All five now live and die inside
one batch's sub-execution.

**One copy is paid to remove five, and that is not free.** `Chunk Cases` holds a second copy of
the cohort (the first is `Merge Streams`, retained whatever happens). The ids-and-re-read trick
that WF-E and the sweeps use is *not available here*: these case objects are derived from three
payment windows and an enrichment read, so there is nothing to re-read them from.

## Two names are load-bearing

`Validate Inputs` and `Join Enrichment` carry those exact names because `Compute Case States`,
`Guards` and `Build Sheet Rows` already read them — `$('Validate Inputs').first().json` and
`$('Join Enrichment').all()`. Keeping the names is what let **930 lines of tested scoring logic
be lifted byte-identical instead of edited**. That matters more than it sounds: these bodies are
shipped into n8n as strings, so "editing" one means retyping it, and a slip in the scorer moves
money. Do not rename either node.

| node | provenance |
|---|---|
| `Compute Case States` | byte-identical to WF-A's, 576 lines, 13/13 against the spec's cases |
| `Guards` | byte-identical |
| `Adjudicate Cases` | byte-identical |
| `Build Sheet Rows` | one change only: the case list comes from `Stamp Display Bands`, since no run-level payload exists per batch |
| `Stamp Display Bands` | `bandOf` lifted verbatim from `Build Runs Log` |

## Decisions worth not re-litigating

**No projection at the batch boundary.** The obvious optimisation — pass the scorer only the
fields it reads — was measured field by field against all 41 node bodies and **rejected**: the
scorer trio reads nearly every field an assembled case carries, so an allow-list would save
little and would fail *dangerously*, because a field left off arrives as `undefined` and moves a
verdict with no error anywhere. The batch boundary bounds how many cases exist at once; it does
not shrink a case.

**`bandOf` now has three copies** (here, `Build Runs Log`, and `Build Case Payload`'s fallback).
That is one more than before and it is the price of the sheet needing a band per batch. It is
pure — it reads only fields the three scoring nodes have already set — so batching cannot change
its answer, and `Build Runs Log` recomputing it over the returned cases is a free cross-check: a
disagreement means the run record and the Cases tab have drifted.

**The circularity tripwire is checked twice.** `Guards` arms at 500 scored cases, so per-batch
arming depends on the batch size — and the failure it watches for (ERP's `currentPayment`
falling through to its PAYMENT-derived tier, making the audit compare a payment against itself)
is the one that makes output look *better* rather than worse. A guard whose arming depends on a
tuning parameter is not a guard, so `Join Scored` repeats it over the whole cohort.

**`written_at` changed meaning.** It is now stamped when a row's *batch* was appended rather
than once for the run. More accurate, and a crashed run leaves timestamps showing how far it got.

**The Cases tab is now written incrementally.** A crash after batch 3 leaves three batches of
rows on the sheet rather than nothing. `Join Scored` reconciles rows-appended against the cohort
in both directions, so neither a short queue nor a duplicated one can pass as complete.

## Tests

`node wf-t/offline/batch_equivalence_test.js` — **46/46**. It runs the batched and un-batched
chains over the same twelve fixtures (spanning all six display bands) at batch sizes 1, 2, 5,
n−1, n and n+3, and compares the scored cases **field for field and in order**: identical every
time. Cases-tab rows match on every column except `written_at`. It also fires the run-level
tripwire in both directions and proves it stays quiet on a normal book (82% exact, 120 short).
