# ERP load compliance — MV Monthly Payment

Five flows, tag `audit: MV Monthly Pmt`. All five are `active: false` and marked "DRAFT, never
publish" by their own author, so nothing here is live traffic.

- **First audit 2026-08-20** — by reading, because the flows could not be exported to disk.
- **Re-audit 2026-08-23** — against the rules tightened since (error-path lease release,
  node-scoped breaker exemptions, `lease_mode` read from the call, disabled-node handling), and
  this time **run through `erp_compliance.py`**. First against hand-built graph fixtures, then —
  once all five were exported later the same day — against the real exports, which retired the
  fixtures entirely.

| stage | id | 2026-08-23 verdict |
|---|---|---|
| 0-Sweep Population | `9jOMFEC2zEWy2RHM` | fixed — pacing was declared and not implemented; breaker exemption moved onto the projection node |
| 1-Population | `IKRXhIco1mwxrcPq` | fixed — **error-path lease release + re-throw**, the standing outstanding item since 2026-08-20 |
| 2-Score chunk | `CopNHNsXUzFO59bW` | fixed — breaker exemption on `Score Contract Month`; stale pacing label corrected |
| 3-Deliver | `Z9fTvmaM526eYofe` | **clean, still** — no ERP node, no lease call, no sub-workflow call; every section is vacuous |
| 4-Verify findings | `9T91z5VFH5g69WyT` | fixed — pacing, error rail, a **missing breaker**, and a **missing budget gate** |

`erp_compliance.py --all` now covers **16 of 16 flows in the manifest, 0 unaudited**, and
`tools/offline/export_mutation_test.py` breaks each fixed property in turn against the real
exports (30 assertions) so a green run means something.

**The five MV exports are hand-transcribed**, because the n8n MCP returns a small workflow inline
rather than to a file and this environment holds no n8n API credential. `MANIFEST.json` records
that per flow as `export: transcribed`, and `exports/README.md` says exactly what that does and
does not prove. It is a standing debt, not a footnote.

## What the re-audit found that reading had not

### 1. Pacing that was declared in prose and never implemented (Stage 0 and Stage 4)

Three ERP nodes carried `batchSize` and **no `batchInterval`**, so they fired back to back:

| node | flow | was | claimed by its own sticky note |
|---|---|---|---|
| `Fetch Population Page` | Stage 0 | 1 concurrent, no interval | "ONE request at a time with pacings between them" |
| `Read WhatsApp Log` | Stage 4 | 2 concurrent, no interval | "clientmgmt is read GENTLY (2 concurrent, 1s apart)" |
| `Read Complaints` | Stage 4 | 2 concurrent, no interval | same |

Stage 0 went further: it **declared a `pacingMs` input, Stage 1 passed `1000`, and no node read
it**. The flow accepted a pacing parameter it discarded. Both files now carry a literal interval
(1000 ms) and the dead input is gone from Stage 0's signature and from Stage 1's call.

**Why the interval is a literal and not the caller's `pacingMs`.** Making it `={{ ... }}` is
supported by n8n and was the obvious fix, and it is wrong twice over: §1 is a policy ceiling, and
a rate a caller can set is a rate a caller can set wrong; and an expression is a value that only
exists at runtime, so the checker cannot read it and the node would pass by accident. `erp_load_check.py`
now **fails** any pacing field set by expression — see the tool note below, because that check
found a crash in the tool itself.

### 2. Stage 4 had no circuit breaker at all — the only stage of the check that did not

And it is the worst place for the gap, because Stage 4's failure mode is the silent one. When the
ERP refuses every read, `Apply Verifier Rules` marks each finding *evidence incomplete*, blocks it
from the PIL, and the run **completes**. A whole month of findings comes back "awaiting reviewer"
and nothing anywhere says the reason was an outage rather than the evidence.

`Assemble Evidence` now carries a bespoke breaker, thresholds and denial-shape vocabulary matching
Stage 2's `Chunk Summary`: dead session on the first occurrence, 3 unavailable, 3 denied, or 40 %
of at least 10 reads unreadable. It runs on the first item, before any model call or case write.

**It cannot save the requests, and does not claim to.** A per-item HTTP node completes every call
before any of our code runs, so by the time this node executes the reads are spent. What it saves
is the model spend, the case-store writes, and — the point — a run that reports itself done.

### 3. A budget gate missing on an entry point nobody had costed (Stage 4)

**Found by the fixture, not by reading.** Three careful read-throughs of Stage 4 missed it; the
checker said it in one line.

§3 looked satisfied for Stage 4 because Stage 1's gate charges 1 downstream call per contract as
"Stage 4 worst case". That covers the **sub-workflow** path and nothing else. The **re-verify
webhook** is an independent entry point: it reads every finding for a `runId` out of the case
store and makes two ERP calls each, uncosted. A month with 3,000 findings is 6,000 ERP calls
behind one POST.

This is the same shape as the missing *lease* on this same entry point, which the 2026-08-20 audit
found and fixed. The budget half was missed then for the same reason it was missed now: **the flow
reads as a sub-workflow, and the second entry point is one node off to the side.**

The new gate is path-dependent and says so: it hard-fails on the webhook path (default 2,000
calls ≈ 1,000 findings) and logs-and-passes on the Stage 1 path, where the cost was already
projected with the full population in hand.

### 4. A dead escape hatch (Stage 4)

`Acquire ERP Lease` read `$('Verify In').first().json.ignore_erp_lease`. `Verify In` never emitted
that key, so the comparison was `undefined === true` on every run and **`params.ignore_erp_lease`
did nothing on this entry point**. A dead escape hatch is worse than none: the operator reaches for
it while a stuck lease keeps refusing them, and nothing says why. `Verify In` now emits
`ignoreLease`, and logs it on its own line when set.

### 5. The error rail, on both entry flows

Stage 1 and Stage 4 each acquired the lease and released it **only on the happy path**. Every
failure — dropped session, breaker trip, budget refusal, a short case set in Stage 3 — left the
lease held by a run that no longer existed until the 3-hour staleness backstop.

The 2026-08-20 note gave a reason: an Error Trigger cannot recover the run's `run_id`, and a
force-release would be the silent-steal path the lease exists to prevent. Both true, and **both
irrelevant to the shape that actually works**: an error *output* stays inside the same execution,
so `$('Validate Run Input')` still resolves and the release names the real holder. No steal, no
guess. That is the CC Price pattern, and porting it was mechanical.

Every single-output node between the acquire and the success release routes its error output to
`Release Lease (error)` → `Fail Loudly`, which releases and **re-throws** — n8n marks an execution
SUCCESS when it runs off the end of an error output, so a rail that released and stopped would be
strictly worse than the stranded lease it was added to fix.

Two nodes deliberately keep `continueRegularOutput` instead:

- **`Count Cohorts`** (Stage 1) — `Check Access And Plan Cohorts` must *see* its failures to name
  the denial shape. A breaker and an error rail want opposite `onError` settings, and on a node
  whose batch a breaker must judge, the breaker wins.
- **`Judge Staff Explanation`** (Stage 4) — a model that fails to answer must be UNKNOWN, which
  leaves the finding standing. Crashing the run on it would be a worse answer than the rule.

### 6. Node groups had to go (Stage 1 and Stage 4)

n8n requires a node group to be a single-entry, single-exit subgraph, and **an error output is a
second exit** — so the rail and the groups cannot both exist. Every flow in this repo that already
has a rail has no groups; that was not a style choice, it is the constraint. Each group's
description was moved to a `notes` on its lead node rather than deleted.

## The bespoke breakers are still KEPT, and now declared

Stage 0's and Stage 2's breakers would fail a byte-compare against the generated block. Both are
better where they are, and the re-audit's change is that each now carries a node-scoped
`ERP-COMPLIANCE: no-breaker-because` declaration **in the node §5 actually points at**, saying
which threshold cannot fire and what stops the run instead:

| node | why not the generated block |
|---|---|
| Stage 0 `Project Group` | the breaker is the GROUP boundary: `Group Healthy?` aborts on the **first** failing page of 20, where the generated block needs five consecutive. The latency detector needs a ~200-call baseline and the whole sweep is ~136 pages, so it could never arm. |
| Stage 1 `Check Access And Plan Cohorts` | reads a batch of **two**. No threshold defined over many can fire on two. It throws on the first non-200 instead, which is strictly earlier. |
| Stage 2 `Score Contract Month` | runs once **per item** and cannot see a batch. `Chunk Summary` is the breaker. Declared in the node's *note*, not its code, because that code is stated to be byte-identical to `scorer.stage2.js` for the offline suite — **a file not present in this repo**, see `../mv-monthly-payment/README.md`. |
| Stage 4 `Assemble Evidence` | bespoke, per §2 above — deliberately **not** using the canonical `// ====` markers, so the byte-compare cannot claim it drifted. |

The earlier audit put Stage 0's justification in `Fan Out Group Pages`. That was the wrong node and
would not have satisfied the checker: §5 exemptions are **node-scoped** precisely so one
declaration cannot silence every projection node in a flow.

## What this audit changed about the POLICY and the TOOLS

**Call count is not load; the response is.** (2026-08-20, unchanged.) Stage 0 was rebuilt after the
2026-08-19 clientmgmt outage and already knew something §1 did not: ~116 requests at `size=500`
took the whole module to nginx 503, and it stayed down even for `size=1`. The load was in the
response, each page carrying 500 nested contract records. §1 now carries a page-size ceiling and
counts a sweep's cost as `pages × pageSize`.

**A pacing value set by expression crashed the checker.** (2026-08-23.) `check_node` compared
`batchInterval` to an int directly, so a field holding `"={{ ... }}"` raised `TypeError` and took
down the **whole run** — every flow in it losing its verdict because one node had a tunable
interval. Found while considering making Stage 0's interval caller-tunable, which is the only
reason it was found at all. `num()` now parses what is parseable and `unreadable_pacing()` names
the rest, and an expression-valued pacing field is a **FAIL**, not a silent pass. Pinned by a
regression in `tools/offline/compliance_test.py` (41 assertions).

**A green run proves nothing until you break it.** `tools/offline/export_mutation_test.py` breaks
each property this audit fixed — the pacing intervals, every breaker exemption, all four error
rails, the re-throws, both budget gates — against the real exports, and requires the checker to
notice. 30/30. A checker that silently stopped looking is also green.

## Outstanding

1. **The five MV exports are transcribed by hand, not fetched to a file.** `--all` now covers
   them, but a transcribed export can be wrong in a way a stale one cannot. Bounded by
   `export_report.py` (structural diff against the live fetch), its `--check-js` pass, and the
   breaker byte-compare — none of which proves the bytes match. Re-export the moment an n8n API
   route exists.
2. **Nothing here has been smoke-tested.** These flows are DRAFT and marked UNTESTED by their own
   author. Everything above is structurally sound and unexercised — including the new rails, which
   by construction only run on a path nobody has taken.
3. **No latency signal in any of the three bespoke breakers.** An ERP answering 200 but dying
   slowly trips nothing in Stage 0, Stage 2 or Stage 4. Same gap in all three, recorded in each.
4. **`scorer.stage2.js` and its 140 offline tests are cited by Stage 2 and are not in this repo.**
   Nothing here can check that Stage 2's scorer matches anything. See
   `../mv-monthly-payment/README.md`.
5. **Stage 1's webhook still uses `responseMode: lastNode`.** A slice runs for many minutes, so the
   caller's HTTP client will time out (524) long before the last node. The error rail defuses the
   *lease* half of this — the execution keeps running server-side and now releases on either path —
   but the operator still gets no answer from the request they made. Fixing it properly means
   responding early and having the operator read the Runs table, which is a design decision for
   Moe rather than a compliance fix.
