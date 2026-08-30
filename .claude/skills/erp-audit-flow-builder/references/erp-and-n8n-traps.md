# ERP and n8n traps

> **Reconstructed 2026-08-29.** `SKILL.md` has always told you to read this file before Phase 1,
> and the file did not exist — the skill shipped with only `SKILL.md`, so every run since has
> silently skipped its own trap list. This is a rebuild from evidence that can be cited: incidents
> recorded in the live flows' own comments and sticky notes, the 2026-08-25 dead-end routes
> document, and defects found while repairing the five audit flows on 2026-08-26/27.
>
> **Every entry names its evidence.** If you hit a trap that is not here, add it *with* its
> evidence — an item nobody can trace becomes folklore, and folklore is what this file replaces.
> If you cannot say how you know, do not add it.

---

## 1 · ERP load — call count is not load

**A sweep of ~116 requests at `size=500`, 5 concurrent, took the entire `clientmgmt` module to
nginx 503 on 2026-08-19** — contract search *and* `get-client-details`, even at `size=1`.
*Evidence: `INCIDENT-2026-08-19-clientmgmt-503.md`, cited in MV Stage 0's sticky note.*

Each `size=500` response carries 500 nested contract records. **Response size is the load, not
the number of calls.** Sweep at `pageSize` ≈ 100, one request at a time, with a real interval.

### `batchSize` without `batchInterval` is not pacing

n8n's default interval is **0**, so the node fires back to back and your "pacing" is a comment.
Both numbers must be literals on the node. *Evidence: MV Stage 2's sticky note records three
nodes found with `batchSize` set and no interval, each under a sticky describing pacing it did
not have.*

Lower peak concurrency beats lower rate: 3-concurrent/750 ms and 2-concurrent/500 ms are both
4 req/s, but peak simultaneous connections is the dimension the outage was sensitive to.

## 2 · Pagination — the page-0 cap

**Page 0 returns at most 40 rows whatever `size` asks for, while the offset stays `page × size`.**
So any `size > 40` leaves a hole at rows 40..size-1 that no page ever returns. A sweep needs a
two-pass pager: a head pass at `size=40` until it reaches `pageSize-1`, then the tail at
`pageSize`. *Evidence: MV Stage 0 `Plan Page Groups`, which implements exactly this.*

Reconcile every sweep against an independent total, **with a tolerance rather than equality** —
the table moves underneath a long sweep — and hand back **no rows at all** when it does not
reconcile. A short population silently converts missing records into a clean month.

## 3 · Banned routes — and two traps in the ban itself

Thirteen paginated ERP routes are banned from specs *and* flows. *Evidence: ERP Dead-End Routes,
2026-08-25.* Silently keeping a page endpoint is explicitly not an allowed outcome.

Two traps in reading that list:

- **"No `page` in the path" is necessary, not sufficient.** Several routes pass the path test and
  still page. **A `totalElements` / `totalPages` / `content` envelope in a live response means it
  is a page endpoint whatever it is called.**
- **A CSV export is not a JSON list.** Two routes have only a file download as their unpaged
  accessor, and one of those is hard-capped at 2,000 rows.

Nine routes have **no alternative at all** — that is an ERP-team ask, not something a spec can
work around. Where a check depends on one, the spec must carry a *no confirmed non-page route*
row and any rule reading that field routes to the verifier instead of concluding from it.

### The replacement that deletes your population

`getAllPayments?contractId=` is the unpaged replacement for `getPayments/{contractId}` — and it
**excludes `BOUNCED`, `RETURNED_TO_CLIENT`, `UNCOLLECTED` and `TEARED_UP`**. On a bounce-hunting
check that swap removes the entire population and the check goes quietly green. Pair it with
`getBouncedPayments` and `getUnreplacedBouncedPayments`.

**Swapping a route can change the response shape.** `payments/page/advancesearch` returns a page
envelope; its replacement `payments/search` returns a bare list. A scorer reading
`body.content` / `body.totalElements` sees nothing and routes every case to "unreadable". Adapt
the shape deliberately, and handle *both* shapes — see trap 3's first bullet for why.

## 3b · A wrong `pagecode` returns 401 SILENTLY

The call looks like it worked and returns nothing. Every ERP Variables row carries a `pagecode`
for this reason; a missing or guessed one produces an empty result that reads exactly like an
honest absence — and an audit check whose population comes back empty goes quietly green.
*Evidence: the `pagecode` field description in the ERP Variables Database.*

Related, from the same database's own warnings:

- **`Doc Status: Generic stub - do not trust`** means the catalog entry exists but its field names
  are boilerplate that do not match the real ERP response. Never trim or reason against those.
- **`ERP Value Status`** distinguishes *Pending Technical* (parameter name unconfirmed) from
  *Pending Business* (meaning unconfirmed). Marking a guess as **Confirmed** is worse than leaving
  it pending, because it stops anyone looking again.
- **An unstated `Default Value` is how a missing value silently becomes a clean result instead of
  a finding.** State it explicitly for every variable.

## 4 · A dropped ERP session wears two shapes

Both carry the `<LOGOUT>` marker, and the status code does not separate them from their
neighbours:

- `5xx` + `Access Token is missing or malformed <LOGOUT>` *(probed 2026-08-19 11:33Z)*
- `401` + `UNAUTHORIZED <LOGOUT>`, developermessage `UNAUTHENTICATED` *(probed 2026-08-19 14:42Z)*

**Test the `<LOGOUT>` / `UNAUTHENTICATED` marker BEFORE the plain 401/403 branch.** Otherwise a
dead session is reported as a permission gap and the operator goes off to request access they
already hold. *Evidence: the classifier in every audit flow's chunk-summary breaker.*

A dead session should trip on the **first** occurrence — a slice with no live session cannot read
anything, so there is nothing to gain by waiting for a threshold.

## 5 · n8n node behaviour that will bite you

| Trap | Consequence | Evidence |
|---|---|---|
| **`executeOnce` truncates `$input` to the FIRST item** | An aggregation node collected 1 of 3 verifier answers and recorded the other two cases as pending. 3 gate-80 reds went in, 1 finding came out | Terminated HM `Merge Verdicts`, week of 2026-08-09 |
| **A Data Table node matching nothing emits NO items** | Everything downstream is stranded — including the insert you were about to do. Set `alwaysOutputData` | supersession stamps, 2026-08-27 |
| **Data Table update matches row(s) — plural. Google Sheets update is singular** | The Sheets node needs `matchingColumns` that uniquely identify ONE row, so bulk-stamping a sheet means one call per row | D16 design, 2026-08-27 |
| **`renameNode` rewrites connections but NOT `$('Node')` references inside Code bodies** | Verified deliberately on a throwaway workflow before relying on it. Useful: you can rename a node and let a new node inherit the name a Code node already looks for | 2026-08-27 |
| **Data tables are project-scoped** | A workflow created in another project cannot see them; `create_workflow_from_code` fails with "not found or not accessible in this project" | 2026-08-27 |
| **Data Table update has a `dryRun` option** | Returns matched rows in before *and* after states — two items per row. Use it before any stamp that touches real rows | 2026-08-27 |
| **A new column is NULL on pre-existing rows, not `false`** | A `superseded = false` filter returns nothing for every historical row. Filter `!= true`, or backfill | 2026-08-27 |
| **The workflow SDK rejects function declarations**, and sticky `content` must be a string | `validate_workflow` fails with "Function declarations are not allowed in SDK code" | 2026-08-27 |
| **`versionDescription` > 1000 chars and node-group `description` > 145 chars are rejected** | The whole update call fails | 2026-08-27 |

## 6 · Generated nodes

A node body that opens with a **`GENERATED by … DO NOT EDIT HERE`** header is exactly that.
Editing it in n8n breaks the parity test and is silently reverted by the next generator run.
Edit the source, regenerate, re-run parity.

**Corollary, and it is the useful one:** when a change belongs to the *wrapper* rather than the
generated core, put it in a **separate node** instead of editing the guarded body. `jsCode` is a
single parameter, so changing three lines means rewriting the whole node — hundreds of lines of
core included — and a transcription slip there is precisely what the parity test exists to catch.
*Evidence: D5/D6 and the ledger route swap, both shipped as separate nodes with the core
verified byte-identical afterwards.*

## 7 · Case stores — know which kind you have

Two sibling checks were found using **opposite** storage models, with nothing on either page
saying so:

- **Append** (MV Monthly): the same `case_key` can appear twice — a slice restarted after a
  breaker trip re-scores its chunk. Readers must count DISTINCT or a resumed run looks like it
  covered more than it did.
- **Upsert on `case_key`** (CC Price): one row per case, and **`run_id` names the last run to
  touch it, not the run that produced the verdict beside it.** Columns like `first_seen` and
  `times_reported` are the tell.

The upsert model means **a later run silently overwrites an earlier run's per-case evidence** —
it is not superseded, it is gone. Filtering that table by a past `run_id` under-counts, and a
smoke run against the real population destroys the real run's record. *Evidence: a run reporting
`cases_scored: 5399` whose rows returned 1 when filtered by that run_id, 2026-08-27.*

If per-run evidence must survive, the store has to be append-per-run. Decide this before build,
not after someone asks what a past run found.

## 8 · Verifier / AI-judge rules

- **An unanswered verifier downgrades the case to pending and records why.** Never retain — or
  upgrade to — a red on an unanswered call.
- **The run must SAY the review did not happen.** A per-case flag is not enough if the run
  summary is silent; the failure mode is invisible from outside, which is what costs trust.
- **A counter read from a field nothing writes reads 0 forever.** One flow's summary reported
  `verifier_failures: 0` on every run because `Merge Verdicts` never set that key — a green light
  wired to nothing. *Evidence: Terminated HM, 2026-08-27.*
- **A counter attached to the last output item disappears when there are no items** — which is
  exactly the run where the verifier returned nothing. Recompute, or attach it somewhere that
  survives an empty result. *Evidence: Dummy Tickets `__counters`.*
- **Where the run summary is written BEFORE the verifier runs**, no field added to it can ever
  report on the review. Check the graph order before designing the reporting.

## 9 · Scoring traps that manufacture false reds

- **Do not compare a past month against a plan read today.** A salary that rose in July makes
  every earlier month read short. Read the month's own billed figure. *42 false reds.*
- **A bounced instalment and its replacement are the same bill.** Summing both doubles the
  month's expectation and invents a shortfall exactly equal to the bounce. Exclude dead rows
  flagged `replaced`. *85 false reds in a draft fix — worse than the 42 it removed.*
- **A promotional rate is not the standing price.** Reading a bounded introductory line as the
  contract's permanent rate produced *145* false reds. Cross-check the resolver against ERP's own
  numeric statement of the rate, **at the date that figure describes**, never at the audited month.
- **Suppress the amount comparison on a contract's first month.** A partial first month can
  legitimately receive less than a full instalment and still be clean; comparing it manufactures
  the exact shape of the reds above.
- **A scoping decision is not a review queue.** Out-of-population records routed to "awaiting
  reviewer" sit where nobody looks — 211 of them, 181 with the human flag down. Give scope its own
  outcome. But scope it narrowly: *unreadable* is not *out of scope*, and widening the test hides
  real read failures behind a scope label.
- **A red verdict needs at least one real case.** Two gates were measured with zero live
  population across 11,501 contract-months. Retain them as guards if you like, but stop citing
  them as sources of findings.

## 10 · Output hygiene, restated because it is easy to lose

Per-entity amounts and identifiers belong in the case store or workbook — that store *is*
"behind the case". Chat, run summaries, logs and Jira tickets carry **counts, flags and totals
only**. Never print names, contact details or salaries. When confirming a field exists, report
the key path, not the value.

**Never set up a recurring or scheduled data pull as part of a build.** Route those to the
ERP/Data team.
