# CC Monthly Payments Below Agreed Amount — the eight flows

n8n project **Adeeb** `gxKXV4pckO4b4pQM`, all tagged `audit: CC Below Agreed`, all
published/active. Base URL `https://sami-team.app.n8n.cloud/workflow/<id>`.

| # | flow | id | nodes | role |
|---|---|---|---|---|
| 1 | **WF-A** · CC Monthly Payments Below Agreed Amount — generated v1 | `uJ8UVNKdN2s5PHHA` | 67 (60 + 7 sticky) | the parent. Webhook → validate → sweeps → cohort → enrich → batch-score → runs log → payload → verifier handoff |
| 2 | **WF-Pop** · 0-Sweep Population | `RbW2fT3b6rtqVQ9H` | 6 | one `contract/search/page` walk per call, `mode: active` or `mode: terminated` |
| 3 | **WF-P** · 0-Sweep Payments | `M79KcC9vaHte5Ibi` | 4 | one 31-day payment window per call, ×3 (audited month, M-1, M-2) |
| 4 | **WF-S** · 0-Sweep Statuses | `D1mCMJuN9lMURJHb` | 4 | the paged status sweep, projected 1,056 → 489 B/row |
| 5 | **WF-E** · 0-Enrich Candidates | `NDk03cYGF4XSXsk5` | 6 | one chunk of candidates: plan read + replacement read |
| 6 | **WF-T** · 1-Score Batch | `pOa3yRIyguSyoBk4` | 10 | one batch: score → guards → adjudicate → band → sheet rows → Cases append |
| 7 | **WF-B** · 2-Verify | `2LaIbHqQ1A2sEBKm` | 22 | verifies candidates against message evidence; self-calls per batch |
| 8 | **WF-C** · 3-Deliver | `yEF4BHYDZAnhBnYg` | 4 (3 + 1 sticky) | one Run Summary row |

### Shared, not owned by this check

| flow | id | role |
|---|---|---|
| **ERP Lease** · one audit at a time | `9gVijqvtLVEhQZXz` | ERP-LOAD-POLICY.md §4. Every audit acquires before its first ERP call and releases when the run ends. Published 2026-08-20; **not yet wired into WF-A**. See `audit-flows/erp-lease/README.md`. |
| **ERP Breaker Sandbox (no ERP)** | `GgqCYYnmRcC6cUet` | A test rig, not a step in anything. Answers the one question no offline suite can: whether n8n static data exists in the Code sandbox and survives between executions. Left unpublished so its schedule cannot fire. |

Everything heavy runs in a sub-execution because n8n retains every node's output for the life
of an execution — ending a sub-execution is the only thing that frees it.

## How they call each other

```
                    POST /webhook/cc-below-agreed-amount
                                  │
                                WF-A
     ┌──────────┬──────────┬──────┴───┬──────────┬─────────────┐
   WF-Pop     WF-Pop      WF-P ×3    WF-S      WF-E ×n       WF-T ×n
  (active) (terminated)                                         │
                                  │                             │
                                  └──────────► WF-B ──► WF-B (self, per batch)
                                                          └────► WF-C
```

## Canvas layout — and why it is not cosmetic

**Position is behaviour in n8n.** Under `executionOrder: v1`, equally-ready branches run in
POSITION order — top to bottom, then left to right. That cost this project a production defect
on 2026-08-19: WF-A's `Respond 200` sat below the five sweep starters, so it fired 6th, after
~30 minutes of ERP sweeps, and every caller got a Cloudflare 524 instead of its acknowledgement
(VALIDATION.md §22).

So the canvases were laid out by `tools/tidy_canvas.py`, which treats the tidy as a
behaviour-preserving refactor rather than a visual one:

1. read each fan-out's CURRENT execution order by sorting targets on (y, x);
2. turn those into ordering constraints;
3. assign y by topological longest-path, x by topological rank;
4. **re-derive every fan-out's order from the new coordinates and refuse to emit unless it
   matches the old.**

`tools/verify_order.py` then re-checks the same property against what n8n actually SAVED, plus
that nodes and connections are byte-identical. On WF-A: **23 fan-out orderings compared, 0
changed; nodes identical, connections identical.**

| flow | layout | fan-outs held |
|---|---|---|
| WF-A | 35 columns × 8 rows — happy path along the top, error rail beneath | 18 (incl. `Validation OK?`'s 8 targets, `Respond 200` still first) |
| WF-B | 17 columns — evidence chain across the top, model branch and self-call tail below | 3 |
| WF-Pop | 5 columns, one diamond — `Sweep Active` above `Sweep Terminated` | 1 |
| WF-T, WF-E, WF-P, WF-S, WF-C | single straight rows | none |

Two conventions: 300px column pitch and 140px row pitch throughout; AI sub-nodes
(`Anthropic Chat Model`, `Verdict Schema`) attach by `ai_*` rather than `main`, so they are
tucked under the agent they serve instead of stranded at column 0.

**Sticky notes are never moved.** They carry the human commentary and their placement is
deliberate; repositioning them mechanically would scramble the annotations that make these
flows readable.

## Where the output goes

One spreadsheet, `1oCjmjGPR4dRThoX8v2CWWJw_wyaVV8FCpQhVV6osyp0` — "CC Below Agreed Amount —
run output": **Cases** (WF-T, per batch), **Run Summary** (WF-A), **Verifier Verdicts** (WF-B).
Do not let `12ModCwP5xgXhuEsYvhIfI5cSUePH4jrDhlT-pW0-DLw` back in — that is the SIBLING check's
workbook (VALIDATION.md §26).
