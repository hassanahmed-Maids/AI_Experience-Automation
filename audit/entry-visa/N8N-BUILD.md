# The n8n build — what exists, and what it proved

| Flow | ID | State |
|---|---|---|
| `Entry Visa Audit · 1-Score (draft)` | `Rr6WyZmR0ysXR1k3` | 18 nodes, end to end |
| `Entry Visa Audit · 0-Enrich (sub-workflow)` | `V62H8yZQYGesvYzp` | ERP enrichment, chunked |
| `Entry Visa Audit · 0-Probe (throwaway)` | `bnXWEJxfUsYnwhDD` | Phase 2, blocked on grants |
| `Entry Visa Audit · Cases` (Data Table) | `TBYy8qk2M84XDEha` | the case store |
| `Entry Visa Audit · Runs` (Data Table) | `ZjHtOK6fQz1BF7j1` | the runs log |

All drafts. Never published, never scheduled, never activated. Manual trigger only, and
`Validate Run Input` refuses a run flagged as scheduled.

```
Run Trigger → Validate Run Input → Load Population → Enrich From ERP?
                                                       ├ yes → Expand Chunks → Enrich via ERP → Merge Enrichment ─┐
                                                       └ no  ─────────────────────────────────────────────────────┤
                                          Assert Population Complete ←──────────────────────────────────────────────┘
                                                       ↓
   Score Cases → Flatten Cases → Write Cases → Read Cases Back → Verify Case Write → Write Runs Row → Build Run Summary
```

---

## What each source is trusted for

Not arbitrary — each side is used for what it is actually reliable for.

| | supplies | why |
|---|---|---|
| **Warehouse** | charges, refunds, amounts, statuses, transaction ids **and dates**, owner ids | it has all of it, cheaply |
| **ERP** | `taskHistorys`, `stopped`, `taskName`, `ownerId` | these are what the warehouse gets **wrong** |

The rejection history is the whole reason ERP is in the loop. It has **measured false
negatives**: of 14 same-request identical-amount pairs the history called not-rejected,
**5 had an Added refund between them** — a 36% false-positive rate, and every one would have
become a false duplicate finding against a named person.

**This shrinks the call budget.** The spec's ~250 transaction-dating calls are a *fallback*,
not a per-run cost, because the warehouse already carries the dates. The run cost is ~60
ID-scoped calls. `clock_source` is recorded per charge so a silent switch is visible.

---

## Two bugs found by testing, both false clearances

Phase 6 predicts this: *"expect to find bugs here, and expect them to be false clearances
rather than crashes."* Both were.

### 1. An undateable charge scored CLEAN

A paid charge whose `transactionDate` could not be read had `time === null`, which made
`rejectionForCharge` return null — and a null rejection is exactly what **gate 5 treats as
proof the application succeeded**. So a charge nobody could date was scored
*"Application succeeded, no refund due."*

Unreachable while every fixture carried a date. It stops being unreachable the moment ERP
enrichment is wired, because a charge can carry a transaction id — so it is "paid" and in
the population — while the lookup that would date it fails or is refused.

Now exits pending at gate 15. **In production it would have cleared every charge whose
transaction lookup failed**, silently, at exactly the moment ERP is least reliable.

### 2. The case store read back 121 rows for 11 cases

`Read Cases Back` had no `executeOnce`, so it ran once per incoming case and returned the
run's rows that many times over. `executeOnce` cannot be set through `addNode`'s node object
— it is a node *setting*.

Caught by `Verify Case Write`, which refused to report. That is the guard doing its job, but
the node was still wrong and is now fixed.

---

## Test results

### Offline — 24 cases, 86 assertions, all passing

```
node audit/entry-visa/test-cases.js
```

All seven ERP-verified spec test cases plus seventeen guards, one per edge the rules name.
**Test case 7 independently reproduces the SOP's AED 283.00** from the gate-14 valuation
logic rather than copying it.

### End to end — exact match, twice

Execution `112411`, the full chain including both stores. Same fixtures as the offline
harness, from the same file, so a disagreement is a finding about the flow rather than a
fixture mismatch to explain away.

| | expected | n8n |
|---|---|---|
| charge cases | 10 | **10** |
| findings / clean / pending / routed | 3 / 5 / 1 / 1 | **3 / 5 / 1 / 1** |
| by gate | 7:3, 5:3, 6:2, 12:1, **15:1** | **identical** |
| pair cases | 2 (gate 14) | **2 (gate 14)** |
| recoverable AED | 2,218.50 | **2,218.50** |
| pair wasted AED | 566.00 | **566.00** |
| cases written / read back | 12 / 12 | **12 / 12** |
| constants checksum | `a002fbe4` | **`a002fbe4`** |

The AED 566.00 is two independent AED 283.00 figures reached by different routes.

### Fail-closed guards — each driven to fail, each checked for the RIGHT error

`success` only means the workflow did not crash.

| Input | Execution | Fired at |
|---|---|---|
| no population, no source | `110787` | `Load Population` |
| `window_from` before 2025-09-05 | `110788` | `Validate Run Input` |
| 1 row vs independent count 694 | `110789` | `Assert Population Complete` |
| enrichment requested, no token | `112403` | `Expand Chunks` |
| 11 cases written, 121 read back | `112389` | `Verify Case Write` |

The short-read case matters most: it does not error, does not look empty, and yields a
plausible smaller number of findings. Only an independent count catches it.

The enrichment test cost **zero ERP calls** — it proved the branch routes and its gate fires
without spending requests at a wall we already know is there.

---

## On the scorer node's provenance — a correction

The `Score Cases` node's header claimed it was **GENERATED** from `scorer.js` and
byte-identical to it. That was not true: it is a hand-written **port**, and nothing in this
pipeline can verify byte-equality through the n8n API. The claim is withdrawn, in the node,
in the run summary's `provenance.scorer`, and here.

What actually holds the two together is the **end-to-end comparison** — and a drift detector
is only as good as the paths it exercises. That is not hypothetical: the undateable-charge
fix existed in `scorer.js` and not in n8n, and every fixture carried a date, so nothing
failed. The e2e fixture set now includes a gate-15 case, so a stale node **fails** the
comparison instead of passing it quietly.

`build-node.js` and `dist/score-node.js` remain, and are the right basis for making the node
genuinely generated later.

---

## Not proven, and why

- **The live ERP leg.** Blocked on pagecode grants. The enrichment flow is built, chunked at
  25 (the blast radius of a wall), breaker armed, and refuses to run unenriched.
- **The warehouse population.** Blocked on a Snowflake warehouse grant. `POPULATION-QUERY.md`
  holds the query, marked unverified because column names could not be checked.
- **The >500-call budget gate.** Needs a population that large.

All three are in `ACCESS-REQUEST.md`.

## Re-running the evidence

```
node audit/entry-visa/test-cases.js            # 24 cases, 86 assertions
node audit/entry-visa/e2e-payload.js --expected # what the flow must return
node audit/entry-visa/e2e-payload.js            # the payload to POST
node audit/entry-visa/build-node.js             # regenerate dist/score-node.js
```
