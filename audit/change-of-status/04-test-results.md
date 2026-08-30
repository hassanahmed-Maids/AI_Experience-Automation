# Phase 6 — test results

## 1. Offline, against the spec's test cases

`audit/change-of-status/scorer/score.test.js` — **32 assertions, 0 failures,
3 declared deviations**. Run with `node score.test.js`.

Every row of the spec's test-case table:

| Spec case | Spec expects | Scorer gives | Match |
|---|---|---|---|
| Maid `130598`, 80 days apart | finding | **finding**, gap measured 80 | yes |
| Maid `120382`, 98 days apart | "not yet decidable" | **pending**, gap measured 98 | yes, in substance |
| Maid `118206`, AED 840 fine | finding (Order 100) | **pending**, fine detected, capped | **deviation — declared** |
| Txn `171743`, no maid id, head `736` | inconclusive | **out_of_population** (head 736 is retired) | yes — and the identity floor is tested separately on a live head, where it gives **inconclusive** |
| Maid `125815`, same day, two products | pending, NOT a duplicate | **pending** at Order 25, and explicitly not a duplicate | yes |
| Maid `109560`, 140 days apart | clean | **pending** (91–365 band) | **deviation — declared** |

Plus a guard for every `Never` the rules name: exactly-the-base is clean; a
missing amount is never read as the base; a negative amount exits with a named
reason; an unmatched date is off-era, never nearest-neighbour; a reversed repeat
is never red; a cross-month pair is still caught; a pair straddling the
2025-12-19 rename is caught; an over-a-year repeat is clean and counted; a
misfiled row never becomes a duplicate leg; the case verdict is the worst of its
rows; unattributed rows never aggregate into a clean case.

### The bug this found

`applyDuplicateRule` overwrote `verdict` on **any** row it matched. A row already
routed to `pending` because its amount or its era could not be **read** was
promoted to `finding` — and rule ⓳ values a finding "at its own amount", the very
field that could not be read.

In production that would have raised red flags carrying a null amount against
named maids, and a reviewer opening one would have found nothing to review. It
is the "later passing test overriding an earlier gate's routing decision" shape.

Fixed by adding `dedup_eligible`, set only where every input the rule needs was
actually read. Three regression tests pin it, including the escalation that IS
correct: a fine-bearing row is still caught as a duplicate, because the duplicate
finding needs no fines record.

## 2. Offline, against REAL ERP payloads

The scorer's projection was run over the 40 real July-2026 rows captured by the
Phase 2 probe (head `1677`, page 1) — a genuine test of the projection against
actual ERP row shapes rather than hand-written fixtures.

| Measure | Result |
|---|---|
| rows projected | 40/40 |
| maid id read | **40/40** |
| date read | 40/40 |
| amount read | 40/40 |
| `purpose = 'Change of Status'` | 40/40 |
| base band resolved | **575.65 on all 40** |
| verdicts | 35 clean · 5 pending (capped) · 0 finding · 0 inconclusive |

**Independent corroboration of the spec's own figure.** 5 of 40 rows carry an
amount above the base — **12.5%**. The check page's heading 9 independently
states that fine-bearing rows are *"12.5% of rows"*. The scorer reproduces that
rate from the raw payload without having been given it.

Zero findings on this page is the expected result and not a null test: the
earlier census measured 0 repeat maid ids within the page, and the spec puts
duplicates at roughly 10 pairs in 8.2 months.

## 3. Live, end to end — NOT YET COMPLETED

Status: **blocked on the n8n instance, not on the flow.**

- Execution `110420` proved the validator: it correctly **refused to run** with
  no `params.erp_auth.bearer`, with the intended message.
- Execution `110422` (webhook path) parked with empty `runData` — a
  webhook-triggered manual execution appears to wait for a real inbound HTTP
  request and holds its slot until it times out.
- Execution `110429` (manual path) has been queued behind it.

There is no cancel-execution tool exposed through the MCP server, so `110422`
has to time out on its own before the queue clears.

What this leaves untested live, and it is a real gap, not a formality:
multi-page pagination across ~88 pages, `Verify Population Pull` on a full
month, `Score Cases` over 704 rows, and both data-table writes. The ERP request
shapes themselves ARE proven live — the Phase 2 probes returned 200 with the
exact bodies, headers and page size the flow uses.

## 4. The one deliberate delta between what was tested and what will run

The flow authenticates from `params.erp_auth.bearer`, so that it holds no ERP
credential of its own and every read is logged under the identity of the person
who ran it. To test it live without the raw token entering this session, the two
ERP nodes were **temporarily** bound to the stored `Hassan Bearer` credential and
the `Authorization` header parameter removed.

**That scaffolding must be reverted before the flow is used**, along with the
placeholder bearer in `Build Manual Run Context`. See `05-handover.md`.
