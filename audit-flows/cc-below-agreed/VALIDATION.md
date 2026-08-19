# Validation — CC Monthly Payments Below Agreed Amount

Spec v1.5 · WF-A `uJ8UVNKdN2s5PHHA` → WF-B `2LaIbHqQ1A2sEBKm` → WF-C `yEF4BHYDZAnhBnYg`
All three are DRAFTS. Nothing is published, scheduled or active.

## 1. Test results against the spec's own cases

The scorer was extracted and run offline against all seven verified rows plus six edge
guards: **13/13 pass**, and every one of the seven reproduces the figure the spec
records for it.

| Spec case | Spec says | Scorer produced |
|---|---|---|
| 1054346 Jul | finding — under-billed | `red_flag / shortfall_persistent_varying`, verifier-bound. expected 4,715, actual 2,100, short 2,615, persistence `persistent_varying` |
| 1090543 Jul | finding — under-billed | `red_flag / shortfall_persistent`, verifier-bound. expected 5,712, actual 3,360, short 2,352 |
| 1097602 Jul | clean (explained) | `green_flag / paid_in_full`. 2,252 monthly + 2,200 credited as an exact split = 4,452, leftover 0 |
| 1055190 Jul | clean (explained) | `green_flag / paid_in_full`. 10,598 received net of a 5,299 MP-reversing refund = 5,299 |
| 1101890 Jul | clean (explained) | `green_flag / paid_in_full`. pro-rated 1 of 31 days = 184, matching to the dirham |
| 1088698 Jul | clean (explained) | `red_flag / shortfall_unstable`, verifier-bound — **a declared deviation, see §5** |
| 1093404 Aug | pending / unresolved | `pending_flag / payment_in_flight` on a 305 PRE_PDP row |

Reproduce: `node offline/harness.js`

## 2. Two false clearances found and closed

Neither would have crashed. Both were green verdicts on contracts that deserved review.

**Gate 80 credited unrelated money.** Monthly 1,000 against expected 5,000, with an
unrelated 9,000 charge on the account, scored `paid_in_full`. Gap-completion credited
any non-refund charge merely large enough to cover the gap. The discriminator is the
LEFTOVER: a genuine split lands on the amount owed exactly and leaves nothing over
(1097602: 2,252 + 2,200 = 4,452, leftover 0, and the client's own message says why),
while an unrelated charge leaves a remainder. Other types are now credited only when
they close the gap exactly; otherwise `actual` is the Monthly Payment alone and the
case goes to the verifier carrying `split_declined`. 1097602 still green.

**Gate 110 cleared unnetted overpayments silently** while gate 100 is only half built
(see §5). Double-then-refund nets to green before reaching that branch; an overpayment
that does NOT net now carries the verifier flag.

## 3. Field-level diff versus the golden

Cloned from `CC Non Received Monthly Payments` (`Qq473Ygj543jxPUN`). Changes made in
this session:

| Node | Change |
|---|---|
| `Compute Case States` | gate 80 leftover test; gate 110 overpayment → verifier; three header comments corrected to match behaviour |
| `Build Cohort` | source A re-pointed to `contract/search/page`, parsing BOTH the nested and the flat shape |
| `Verify Bulk Pulls` | gate 2 reconciles population against top-level `total` and statuses against `totalElements`; per-route page cap; emits the keys WF-C reads |
| `Get CC Contract Population` | route swapped (see §4); empty-page terminator only |
| `Launch Verifier (WF-B)` | ADDED — `Assemble Baton` was a terminus, so no verdict could ever be produced |
| Sticky "Error rail" | corrected: a disabled n8n node is pass-through, not a dead end |

## 4. Population proof

| Source | Count |
|---|---|
| `contract/search/page`, status ACTIVE + `maids.cc_prospect`, top-level `total` | **5,393** |
| Independent: distinct CC contracts with any July payment row | **5,651** |
| Independent: distinct CC contracts with a `Monthly Payment` row | **5,613** |
| Spec's own figure for July | 5,612 |

The delta between 5,393 active and 5,651 payers is **explained, not rounding**: the
active list is a snapshot of who is active *now*, while the payment feed covers anyone
who paid *in July* — including contracts terminated since. That is exactly why the
cohort unions three sources (active list, payment-row stubs, terminated sweep) rather
than trusting any one. `Monthly Payment` on 5,613 contracts against the spec's 5,612 is
a one-contract drift over five days.

The dynamic API the spec names could not be used — see §5.

## 5. Declared gaps

Every one of these is stated on the run's own output, not only here.

1. **Population route changed.** `getactivecccontracts` is access-denied to this
   account (HTTP 500 `SecurityException` on four pagecodes; a bogus code 404s, so the
   surface resolves and that one code is ungranted). It works on another auditor's
   login, which is why it was not tested there. **Equivalence between the two routes is
   unverified** and stays unverifiable until one account can call both.
2. **Replacement history is 401 `INSUFFICIENT_PERMISSIONS`** with the correct pagecode.
   Gate 70 can therefore never clear a no-coverage month and coverage pro-rating never
   fires, so a genuine mid-month gap becomes a candidate. Fails safe; inflates the
   candidate list; caps confidence on every verdict.
3. **Gate 100 (covered month) is half built.** `paymentDate` places a payment in the
   period, but the billing cycle that decides which month it SETTLES is not exposed
   anywhere found. Measured exposure: **20 contracts** had more than one Monthly
   Payment row in July (the spec named 4). Those now carry the verifier flag.
4. **Gate 60 (freeze) is unbuildable on DATA, not access** — correcting the spec, which
   says the permission is missing. `client-contracts-v2` returns 200 and
   `isCurrentlyFrozen` is present, but it is a bare boolean with no dates, and a
   currently-frozen test is a proven 4-of-4 false positive. Mitigated by gate 128.
   This is why 1088698 comes out verifier-bound rather than clean.
5. **Gate 2 still cannot reconcile the three bulk payment sweeps** — they return no
   envelope at all, so "zero rows" is the only detectable failure. Both PAGED sweeps do
   now reconcile.
6. **Call budget is ~1,256 per run before enrichment**, not the ~500 the spec states.
   The status sweep alone (1,094 pages) is twice the stated budget.
7. **Gate 125 (exception register) is inert** by the owner's clean-slate ruling.
8. **Verdict vocabulary is unsigned.** Malaz has not signed off the five display words.

## 6. What still needs a human

- **Results sign-off is Abdullah Mahdi's**, per the spec, before anything reaches PIL.
  Authorisation to execute a run is not authorisation to publish its findings.
- **The replacements permission** — the one access gap that changes the numbers.
- **The verdict vocabulary** — Malaz.
- **A freezing/unfreezing date in ERP** — the ERP team. Today the business cannot
  answer "when was this contract frozen?" from ERP at all.

## 7. The live run — execution 92265, and why it is NOT the evidence

Fired 2026-08-18 12:04:21 UTC against production, read-only, `cohort_cap: 25`,
`batch_size: 10`, July 2026. Authorised by Hassan to execute.

**Outcome: inconclusive. Abandoned at 136+ minutes with no handoff to WF-B.**
Do not read anything about the check's correctness from this run either way.

What it did prove:
- Validation accepted the payload and derived the three windows correctly, and
  `auth_mode` came back `caller_payload:params.erp_auth.bearer` — the token travelled
  as a RUNTIME PAYLOAD. Nothing was written into a Code node and no stored ERP
  credential was used, which is the property the whole auth design turns on.
- It survived past **95 minutes**, where runs 89604 (94m44s) and 90669 (~95m) both
  died. The earlier memory work moved it out of that band.

What it exposed:
- **`cohort_cap` does not bound the sweep half.** It caps the cohort AFTER
  `Build Cohort`, so enrichment and verification shrink but the five sweeps stay at
  full size — ~23 MB of payment rows across three windows plus 43,727 status rows.
  The execution record passed the readable threshold within ~35 minutes: an
  `includeData` fetch for a SINGLE small node succeeded at 3m41s and failed on payload
  size later. So the run became unobservable while still running, which is why this
  section can report no figures.
- **Sweep latency under sustained load is far worse than isolated probes suggest.**
  Measured alone: population ~5.1 s/page, terminated ~20.5 s/page, statuses ~0.65 s
  plus a 250 ms interval. Predicted ~36 minutes of sweeps; actual >136 minutes with no
  handoff. Roughly 4x.
- Not a runaway walk — every terminator was verified against live envelopes:
  ACTIVE population returns 39 rows on page 134 and 0 from page 135 (136 requests);
  statuses stop on the 7-row partial page; terminated stops on the empty page 24. All
  sit well inside `maxRequests`.

## 8. The fix this run argues for

Stage the SWEEPS out of WF-A exactly as the verifier was staged out into WF-B. The
status sweep is the first target: **1,094 pages, over 80% of the run's call budget,
for one field** (`status.value`, needed only by gate 12). It should be its own stage
emitting a slim projection, or a narrower query, so WF-A never holds it.

Until that is done, this check cannot complete a full-population run, and a capped run
cannot be observed. Neither state is publishable.

## 9. A gap in this session's own gate-2 change, stated rather than left implicit

The reconciliation guards only the SHORT direction: `popRows < declaredTotal - 25`
throws, because a short cohort is the false clearance. It does NOT guard the LONG
direction. If a paged route ever clamped over-range pages and kept returning full
pages, the walk would collect far more rows than `total` and pass silently.
`Build Cohort` dedupes by `contract_id`, so this is not a false clearance — the cohort
stays correct — but it would burn an hour invisibly. The long-direction check belongs
in gate 2 and is not there yet.

## 10. Why execution 92265 really took 136 minutes — and a 45x fix

**It was not hung, not loaded, and not a memory problem. It was doing a ~6.8 hour job.**

Measured 2026-08-18 on SUCCESSFUL advancesearch pages:

| page size | secs/page | pages for 43,727 rows | whole sweep |
|---|---|---|---|
| 40 (as built) | ~22.5 | 1,094 | **6.8 hours** |
| 500 | ~24.0 | 88 | 35 min |
| 1000 | ~25.2 | 44 | 18.5 min |
| **2000 (server clamp)** | ~24.9 | **23** | **~9 min** |

Per-page cost is ~flat: the work is per ROW on the server, not per request. Window
width makes no difference either — a ONE-month window (15,129 rows) costs the same
~22s per page as three months. So the only lever is fewer requests, and the server
clamps `size` at 2,000 (ask 5,000, get 2,000 with totalPages 22).

**The estimate that hid this was mine, and it was wrong by ~25x.** The 0.65 s/page
figure came from the very first advancesearch probe — the one that returned HTTP 500 on
a literal `sort=null`. Error responses are fast. I never timed a successful page until
after the run was abandoned, and every runtime projection in this file's earlier
sections was derived from that number.

Fixed: `size` 40 → 2000, terminator's short-page test tracks the size, `maxRequests`
2500 → 60 so a runaway is caught in minutes rather than days.

**Also fixed, because raising the size would otherwise have broken gate 2:** the
short-page proof hardcoded `< 40`, so a complete sweep's final 1,727-row page would not
have read as short and the gate would have thrown on a correct run. The test now
compares against the largest page actually seen AND is only a fallback — a sweep that
reconciles against `totalElements` is complete by arithmetic whatever its last page
looked like. Covered by three new cases in `offline/gate2_test.js`.

### Revised runtime estimate, from verified per-page costs

| sweep | requests | secs each | total |
|---|---|---|---|
| population | 136 | ~4.9 | ~11 min |
| terminated | 24 | ~20.5 | ~8 min |
| payments x3 | 3 | ~2.8 | <1 min |
| statuses | 23 | ~24.9 | ~9 min |
| **sweeps total** | **186** | | **~29 min** |

Down from ~1,256 requests and ~7 hours. The check is runnable for the first time.

## 11. On staging the sweeps out of WF-A

Still worth doing, but it is a MEMORY and OBSERVABILITY fix, not a runtime one — and
the runtime fix above is what actually unblocked the check. Retention is unchanged by
it: WF-A still holds ~100k payment rows (~23 MB), 43,727 status rows, 5,393 population
rows and 949 terminated rows until it ends, which is why execution 92265 became
unreadable ~35 minutes in.

The highest-value staging target is the THREE PAYMENT SWEEPS, not the status sweep:
**80% of those rows are MV** (26,439 of 33,213 in July) and are discarded immediately
in `Attach Month Payments`. A sub-workflow returning CC rows only, projected to the
seven fields actually read, cuts ~23 MB to ~4.6 MB.

Recommended order: run the flow now that it is ~29 minutes, and stage out only if
observability is still lost. Stacking a large refactor on top of an untested runtime
fix means building twice and having no clean signal about which change did what.

## 12. Execution 92433 — the runtime fix worked, and it exposed the memory wall

Re-run at 14:48 UTC with the size-2000 sweep, same shape as 92265 (July 2026,
`cohort_cap: 25`, `batch_size: 10`).

**CRASHED at 22m35s.** Not a throw, not a gate rejection — n8n killed the process, the
same `crashed` status as 89604.

That is a clean result, not a disappointment. The runtime fix did exactly what it
claimed: the sweeps that took >136 minutes (and were heading for ~6.8 hours) finished
in ~22. Removing the time barrier exposed the wall underneath, and reached it 4x
sooner than 89604 did at 94m44s. Same wall, found faster.

### Retention, measured per row from probe responses on disk

| sweep | bytes/row | rows | retained | share |
|---|---|---|---|---|
| **Get Payment Statuses** | 1,418 | 43,727 | **59.1 MB** | **64%** |
| payments x3 (all types) | 235 | ~100k | 22.4 MB | 24% |
| population | 1,781 | 5,393 | 9.2 MB | 10% |
| terminated | 1,672 | 949 | 1.5 MB | 2% |
| | | | **~92 MB** | |

Against the measured healthy band (44-61 MB) and kill band (100.6-142.6 MB), ~92 MB
plus scoring overhead is the crash.

**`cohort_cap` cannot help here** — it caps the cohort AFTER `Build Cohort`, so all four
sweeps are already resident by then. That is why a capped run crashes too.

### Correction to §11 of this file

§11 recommended staging the PAYMENT sweeps first, on the reasoning that 80% of their
rows are MV and discarded. That was a guess at relative size and it was wrong: the
status sweep retains 2.6x more (59.1 MB vs 22.4 MB) because each row is a
PaymentReportDto carrying 22 fields including a 9-key nested contract. **Stage the
status sweep first.** The payments projection is still worth doing second.

### The projection each sweep needs

A status row is 1,418 B; downstream reads only: `id`, `amountOfPayment`,
`dateOfPayment`, `status`, `methodOfPayment`, `typeOfPayment`, and from `contract`:
`id`, `status`, `dateOfTermination`, `startOfContract`, `client{id,name}`,
`housemaid{id,label,nationality}`, `contractProspectType{code}`. That is ~350 B/row,
so **59.1 MB becomes ~15 MB**. With CC-only payments (22.4 -> 4.6 MB) and a projected
population (9.2 -> ~2 MB), total retention lands near 23 MB — well inside the healthy
band with room for scoring.

### Mechanism

A sub-workflow per sweep, called with `waitForSubWorkflow: true`, doing its own paging
and returning ONLY the projection. The sub-execution holds the raw rows and dies with
them; WF-A retains kilobytes-to-megabytes. Keep the CALLING NODE'S NAME identical
(`Get Payment Statuses` etc.) and return the SAME ENVELOPE SHAPE, so
`Verify Bulk Pulls`, `Build Cohort` and `Attach Month Payments` — which all reach for
these by node name — need no changes at all.

Note the gate-2 fix from §10 is what makes this safe: returning all rows as one item
gives `maxStatusPageSeen == lastPage`, which the OLD hardcoded short-page test would
have rejected. Reconciliation against `totalElements` now carries the proof instead.

## 13. A false-clearance generator, found while deriving the status projection

Looking up which fields the status sweep's consumers actually read — in order to
project the rows and cut the 59 MB — turned up a field-name bug with a worse
consequence than the memory problem it was found in service of.

**`Attach Month Payments` read the payment type from `typeOfPayment.label ||
typeOfPayment.value`. Neither key exists.** Measured 2026-08-18: the advancesearch DTO
carries `typeOfPayment: { code, id, name }`. The fallback, `r.paymentType`, is the BULK
feed's spelling and does not exist here either. So `type` was `''` on **every**
advancesearch row.

That alone would be a labelling problem. It is not, because **a status row OVERRIDES
the bulk row for the same `payment_id`** — deliberately, so a payment advancesearch
calls DELETED stops counting. The override discarded the correctly-typed bulk row along
with everything else.

Consequence chain, all three from an empty type:

    isMonthlyType('')      -> false   never counted as a Monthly Payment
    refundKind('')         -> null    never detected as a refund
    countsTowardActual('') -> TRUE    counted as OTHER received

So `monthly_net` collapsed toward zero, the money moved into `other_received`, and
**refunds were counted as income.**

### Proved, not inferred

The same six tests were run against a copy differing ONLY in that one read:

| case | pre-fix | fixed |
|---|---|---|
| Monthly Payment in both sweeps | `monthly 0, other 5000` | `monthly 5000, other 0` |
| **MP-reversing refund** | **`monthly 0, other 15000, refundMp 0`** | `monthly 5000, refundMp 5000` |
| split collection (2,252 + 2,200) | `monthly 0, other 4452` | `monthly 2252, other 2200` |

The refund row is the false clearance: a 10,000 monthly with a 5,000 refund reported
**15,000 received instead of 5,000 net** — money returned to the client inflating what
they appeared to pay. And it defeated the gate-80 leftover test added earlier the same
day, because with everything labelled "other" there is no monthly to start from.

Fixed by reading `typeOfPayment.name`, which matches the bulk feed's `paymentType`
vocabulary EXACTLY (zero advancesearch-only values), so one allowlist serves both
sweeps. `code` is snake_cased and would match nothing.

### Two further field mismatches, one benign and one declared

- `paymentMethod` does not exist either; it is `methodOfPayment`. Nothing decides on
  `method`, so this cost nothing. Corrected so the column stops lying.
- **`replacementForId` / `REPLACEMENT_FOR_ID` do not exist on this route at all** (0 of
  40 rows), so the replacement de-duplication has never fired. Those names belong to
  the Snowflake table, not this API — which is also where the "PAYMENT_WAS_REPLACED is
  true on 112,458 of 112,458 rows" note came from. It is NOT a hole here: only
  `status === 'RECEIVED'` counts toward actual, and the live sample ran RECEIVED 28 /
  DELETED 10 / BOUNCED 2 with the two `replaced: true` rows not RECEIVED. The status
  override is what removes them. Left wired for the day the field appears, with
  `replaced` now carried so the assumption is measurable instead of invisible.

**Priority note.** This outranks the memory staging. A crash is loud and costs a run;
this was silent and would have put wrong numbers in front of a reviewer. The staging
work is still outstanding.

## 14. Both stagings done — the retention ledger, and a gate made stronger by the change

Executions 89604 (94m44s) and 92433 (22m35s) both died of retention, not of logic. Both
sweeps named in §12 are now staged into sub-workflows. Neither WF-A consumer changed:
each caller node keeps the name its consumers reach for and each sub-workflow returns the
same envelope key.

| sweep | before | after | mechanism |
|---|---|---|---|
| `Get Payment Statuses` | 44.1 MB | **20.4 MB** | WF-S `D1mCMJuN9lMURJHb`, field projection (1,056 → 489 B/row) |
| `Get Month Payments` ×3 | 22.4 MB | **4.6 MB** | WF-P `M79KcC9vaHte5Ibi`, CC filter (20.4% of rows kept) |
| population | 9.2 MB | 9.2 MB | not staged |
| terminated | 1.5 MB | 1.5 MB | not staged |
| | **~77 MB** | **~36 MB** | |

Two things about those figures, said plainly rather than left to be discovered:

- **The status number is 44.1 MB, not the 59.1 MB in §12's table.** 59.1 came from
  dividing the pretty-printed probe file by its row count (1,418 B/row). Re-measured
  minified — which is what n8n retains — a row is 1,056 B. §12's table is on the
  pretty-printed basis throughout, so every figure in it runs ~30% high. The *ratios* in
  §12 stand; the absolute totals do not.
- **The payments row-count reduction is real but the per-row projection is nil.** The DTO
  carries exactly seven fields and `Attach Month Payments` reads all seven. There is
  nothing to trim per row, so the whole 4.9x is the CC filter — 79.6% of rows are MV and
  were being carried the length of the run to be discarded on the first line of the
  consumer.

**No run has yet completed end to end**, so ~36 MB is a projection from measured
per-row costs, not an observed figure. It is below the observed healthy band (44–61 MB),
which is the point; the next live run is what turns it into evidence.

### Gate 2 got stronger, which is not what usually happens here

Moving the CC filter upstream of a completeness gate is textbook blinding: after the
filter, a failed call and a CC-quiet month look identical, and gate 2's only payment test
was `payments.length > 0`. So WF-P carries the **pre-filter** count across the boundary
and gate 2 now asks three questions where it asked one:

| question | test | previously |
|---|---|---|
| was the window swept? | `_raw_rows >= 10,000` (July measured 33,213) | inferred from the filtered sum |
| did the filter behave? | `cc + dropped === raw`, exactly | not askable |
| was CC present at all? | `cc_rows > 0` | conflated with the above |

It also refuses a **half**-staged run: gate 18 compares months against each other, so a
CC-only month beside a CC+MV month would silently change what the persistence test is
measuring. Stage all three windows or none.

`offline/gate2_payments_test.js` — 8/8, each case stating its expectation before running:
the healthy case; raw below floor; `cc + dropped` not balancing; raw healthy with zero CC;
raw zero; mixed shapes; all-unstaged (passes, and the stats say the weaker test ran); and
unstaged-empty. The pre-existing suites still pass unchanged: `gate2_test` 10/10,
`harness` 13/13, `attach_payments_test` 6/6, `cohort_test` 7 cases.

### What is left unreconciled, narrowed twice in one day

The bulk route still declares no total of its own, so a truncated response **above** the
10,000-row floor would pass. The floor and the CC/MV balance are proxies, not a server
reconciliation. That — not the population read, and no longer the whole payment pull — is
the residue a sign-off covers. The gate still fails closed.

## 15. Execution 92534 — the staging worked, and the wall moved to enrichment

Run 92534, 2026-08-18 16:24:05 → 17:02:41 UTC (38m36s), status `crashed`. First run with
both sweeps staged. **The staging did what it claimed and the run died somewhere else.**

### What is proven, from the sub-executions

Sub-workflows get their own execution records, so this part is evidence rather than
inference:

| execution | workflow | window | result |
|---|---|---|---|
| 92551 | WF-P | 2026-07 | success, 3.6s — **33,213 raw → 6,774 CC, 26,439 dropped**, projection 360 ms |
| 92552 | WF-P | 2026-06 | success, 1.8s |
| 92553 | WF-P | 2026-05 | success, 1.7s |
| 92554 | WF-S | 3-month span | success, **7m34s** |

The audited-month numbers are exactly the offline measurement (6,774 of 33,213), and the
status sweep that was heading for 6.8 hours at size 40 finished in 7m34s. **No WF-B
execution exists**, so WF-A never reached `Launch Verifier`.

### The timeline, and the 17 minutes that matter

| elapsed | what |
|---|---|
| 16:24:05 → 16:37:56 (13m51s) | validate + the population walk |
| 16:37:56 → 16:38:07 (11s) | all three payment windows |
| 16:38:09 → 16:45:44 (7m34s) | the status sweep |
| 16:45:44 → 17:02:41 (**16m57s**) | everything after the sweeps — no sub-executions, no WF-B |

The population walk is confirmed independently: re-probed today, `contract/search/page`
answers in **5.03s per 40-row page** against a `total` of **5,405**, so 136 pages is
11–14 minutes. It is capped at 40 rows however large a `size` you ask for, so there is no
page-size lever here — unlike the status sweep, this one is genuinely 136 round trips.

### What the missing 17 minutes was doing

`Attach Month Payments` sets `needs_enrichment = received_anything`. Measured on the real
July pull: **5,651 distinct CC contracts, 5,632 of them received a positive amount.** So
the enrichment gate excludes 19 contracts out of 5,651 — it reads like a narrowing and is
effectively none.

Each survivor triggers two per-item HTTP nodes, both `batchSize 15 / batchInterval 500ms`.
Re-probed today for real latency:

| call | measured | per candidate |
|---|---|---|
| `get-client-details?type=CONTRACT_DETAILS` | 200, **3,851 B** minified, **1.80s** | 1 |
| `replacement/page/contract/{id}` | **401** (permission still missing), 185 B, 1.11s | 1 |

- **11,264 ERP calls** for one run — against a spec budget of ~500. My earlier
  "~186 requests" figure counted the sweeps only and was wrong for the whole run.
- **376 batches per node.** At the measured latencies that is ~14 min for the plan call
  and ~10 min for the replacement call, ~24 min total. The run had 16m57s before it died,
  so it crashed **part way through enrichment** — most likely still inside
  `Get Contract Plan`.
- **~22.7 MB of raw bodies** if it had finished (5,632 × 3,851 B, plus 1.0 MB of 401s).

### Why it crashed, stated as the inference it is

`crashed` means the worker process died, as in 92433 and 89604. The execution record
cannot be retrieved through the n8n MCP at all — three attempts, each failing with a
transport error, while the same call against a 1.27 MB sub-execution succeeded. That is
consistent with a record too large to transfer, and it is corroboration rather than proof:
**no error message from this run has been read.**

The arithmetic that makes memory the leading explanation:

| retained at crash | MB |
|---|---|
| staged sweeps (statuses 20.4 + payments 4.6) | 25.0 |
| population + terminated | ~10.7 |
| ~5,650 case objects, copied at each retained node output down the enrichment chain (6–8 copies × ~6.8 MB) | ~45 |
| enrichment bodies accumulated before the crash | ~15 |
| | **~95** |

Against the measured kill band of 100.6–142.6 MB. **The staging removed 41 MB and the
enrichment fan-out put most of it back** — and the dominant term is no longer a sweep, it
is the case objects multiplied by the number of nodes the enrichment chain retains.

### What to do about it, in order

1. **Stage enrichment into a sub-workflow, in chunks.** Same mechanism that worked twice
   today: WF-E takes a chunk of candidates, makes both calls inside its own execution, and
   returns only the scalars the scorer reads. That deletes the ~22.7 MB of raw bodies and
   collapses four retained node outputs into one. It must be chunked — one sub-execution
   holding all 5,632 responses would OOM by itself.
2. **Attack the fan-out, which is the real cost.** 11,264 calls exist because `expected`
   comes only from the per-contract plan read. The population route does **not** carry the
   contract's monthly rate — checked: its only money-shaped field is
   `workerSalaryMonthlyTip`, which is the maid's salary, not the client's fee. So the
   question for ask-the-code is whether ANY bulk or paged route returns the contract's
   monthly payment. If one exists, `expected` is known for all 5,405 contracts in the walk
   we already do, and enrichment narrows from 5,632 contracts to the few hundred that
   actually look short. If none exists, ~11k reads per run is the honest cost and needs a
   decision, not a workaround.
3. **The replacement call is still 401** on every one of those candidates. It is 376
   batches spent to collect nothing, and until the permission lands it could be skipped
   entirely rather than called 5,632 times — the declared confidence gap is unchanged
   either way.

Even fixed for memory, the run at this shape is ~14 min population + 8 min sweeps + ~24 min
enrichment ≈ **46 minutes**. Item 2 is what makes it a short run rather than a survivable one.

### Footnote to §15 — the bearer dies at a fixed hour, which bounds when a run may start

Asking the code about a bulk contract-rate route (fix item 2) hit a hard stop: both tokens
in play expired at **1787090400 = 22:00 UTC / 02:00 Dubai**, and ask-the-code answered
`500 "Token not valid, {Token is expired}"`. Decoding three tokens shows ERP tokens do not
last 24h from login — every token issued in a day expires at that same wall-clock moment
(two tokens minted four minutes apart shared an identical `exp`; the previous day's `exp`
was exactly 86,400 s earlier). Written up in `docs/code-llm-api.md`.

For this check that is an operational constraint, not a footnote: a full run is ~45 minutes
and carries the bearer as a runtime payload, so **a run started after ~21:15 UTC loses its
token mid-flight** and every remaining ERP call 401s. Run 92534 finished at 17:02 UTC, well
clear, so this did not contribute to that crash.

## 16. WF-E — enrichment staged out, and what it does not buy

Built 2026-08-18 in response to §15: `CC Below Agreed · 0-Enrich Candidates`
(`NDk03cYGF4XSXsk5`), plus two new WF-A nodes. Four WF-A nodes are gone —
`Get Contract Plan`, `Attach Plan`, `Get Replacements`, `Attach Replacements` — replaced by
`Chunk Candidates` → `Enrich Candidates (WF-E)` (`mode: each`, `waitForSubWorkflow: true`)
→ `Join Enrichment` → `Merge Streams [0]`. `Compute Case States` is untouched, because
`Join Enrichment` emits exactly the shape `Attach Replacements` did.

### The memory arithmetic, itemised so it can be argued with

| retained in WF-A | before | after |
|---|---|---|
| plan responses (5,632 × 3,851 B) | 21.7 MB | **0** — held in the sub-execution, freed per chunk |
| replacement 401 bodies (5,632 × 185 B) | 1.0 MB | **0** |
| plan deltas (`Attach Plan`) | 5.6 MB | **0** — folded into the caller's output |
| chunk inputs (ids only, 5,632 × ~60 B) | — | 0.34 MB |
| WF-E caller output (the deltas) | — | 5.6 MB |
| assembled cases (`Attach Replacements` → `Join Enrichment`) | ~14 MB | ~14 MB |
| **net** | | **~22 MB removed** |

That takes the projected peak from the ~95 MB of §15 toward **~73 MB**, against a measured
kill band of 100.6–142.6 MB. Two caveats, stated rather than buried: these are per-row
measurements multiplied by counts, **not an observed heap figure**, and ~73 MB is still
above the observed healthy band of 44–61 MB. What remains is the population sweep (9.2 MB,
unstaged) and the case objects copied at each of the ~6 remaining retained node outputs.
The next run is what turns this into evidence.

### What it explicitly does not buy

**The call count is unchanged: 11,264 calls, ~26 minutes.** Chunks run sequentially — the
chunk size is a memory ceiling, not a throughput knob, and raising it toward WF-E's own
limit of 1,200 changes nothing but how much one sub-execution holds. The three node
comments, the node notes on the canvas and `wf-e/README.md` all say this in the same words,
because "we staged the enrichment" is exactly the kind of sentence that gets remembered as
"we fixed the enrichment".

Cutting the fan-out still depends on the open question in
`askcode/q-bulk-contract-rate.md`: if any bulk route carries the contract's monthly rate,
`expected` is known for all 5,405 contracts from the walk already being done, and enrichment
narrows from 5,632 contracts to the few hundred that actually look short.

### Fidelity: this replaced reasoned code, so it was tested as a replacement

`Attach Plan` and `Attach Replacements` carried the discount-prose parsing, the gate-4
departure, the gate-5 pro-rating branches, and the `newHousemaid: ""` no-successor signal.
All of it moved verbatim. Two mechanical changes:

1. The pairing source is `Read Chunk` instead of `Needs enrichment?`.
2. **Every regex is rewritten with character classes** — `[.]` for `\.`, `[ ]+` for `\s+`,
   `[(]Monthly[)]` for `\(Monthly\)` — because a body shipped into a Code node as a string
   is precisely where a backslash class gets eaten, and newlines are flattened with
   `String.fromCharCode(10)` first so the narrower space class cannot change an outcome.
   `wf-e/offline/enrich_test.js` runs the original and rewritten patterns over the same
   strings and asserts they agree; that assertion is the reason the rewrite is defensible
   rather than a silent behavioural change.

`wf-e/offline/enrich_test.js` — **39/39**, including a pass over the real
`get-client-details` response probed the same day (flags asserted, never the amount).
`Join Enrichment` and `Chunk Candidates` were diffed byte-for-byte against their deployed
copies; WF-E's three bodies were read back and checked at every escape-sensitive point.

### One behaviour worth knowing before the next run

`Enrich Candidates (WF-E)` has `onError: continueErrorOutput` wired to `Build Error
Callback`. So a failed chunk posts an error callback AND then `Join Enrichment` throws,
naming how many candidates came back without a delta. That double report is deliberate: a
partially-enriched cohort must not reach the scorer, because those cases would present as
CANNOT TELL — which reads like a judgment about a contract rather than a lost chunk.

## 17. Asked the code, and the answer moved the problem from cost to correctness

Two questions asked 2026-08-19 (ask-the-code session 44252, answers verbatim in
`askcode/a1-*.md` and `askcode/a2-*.md`, code-cited). The session could see only
`accounting`, `client-management` and `reporting`, so every negative below is scoped to
those three modules.

### The bulk-rate question, answered: no usable route

- **`currentPayment` is not a stored column.** The stored source is
  `CONTRACTPAYMENTTYPES.AMOUNT` (`AbstractPaymentTypeConfig.amount`) on the active payment
  term's monthly line; the API value is computed per request in
  `ContractService.getContractPaymentInfo`.
- **`contract/search/page` cannot be widened by request.** Its row DTO is the private
  interface `ContractController.ContractSearchProjection` (lines 991-1034);
  `extraFilters` and the query params only add WHERE clauses. Adding the amount needs a
  Java change, would trigger an N+1 lazy load per row, and would return the raw CPT amount
  rather than the discount/VAT-adjusted figure.
- **One bulk exposure exists and is unreachable.** `GET /bytable/PaymentsReport` renders a
  Jasper report carrying `contractId` + `monthlyPayment` for a whole date window, with no
  permission annotation in code. **Probed live: bare HTML 403, `content-type: text/html`,
  identical on four pagecodes** — the load-balancer signature, not an ERP denial. So it is
  blocked at the edge and cannot be used from n8n.
- The JSON endpoint that once ran the same SQL is **commented out** in `ReportingController`
  (~lines 1520-1585), and `AdHocController`, `DynamicJasperController` and
  `CSVDynamicJasperController` are commented out entirely. The Alert engine can run
  arbitrary SQL but only emails or logs the rows — no synchronous API return.

**So the fan-out stands at 11,264 calls per run** unless someone adds a thin JSON controller
over `ContractRepository.getPaymentsReportInfo(from, to)`, which already returns
`contractId` + `monthlyPayment` in bulk. That is a Java change plus a deploy, and it is the
single highest-leverage thing anyone could do for this check's runtime.

### The finding that outranks it: `expected` may be derived from what was PAID

The same answer exposed the tier-one path in `getContractPaymentInfo`: when the current
window holds any non-DELETED, non-refund monthly payment row, `currentPayment.amountValue`
is taken from **`Payment.amountOfPayment`** — the collection — and only falls back to the
CPT computation when no such row exists. Quoted query
(`PaymentRepository.java:519-531`): window is the calendar month of **now** (or the CC
billing cycle), `status <> 'DELETED'` only — **PDC, BOUNCED and PRE_PDP all count** — ordered
by status rank with **no date or id tiebreak**, so which row wins among two RECEIVED rows is
undefined.

If that fires, this check is circular: it would compare a payment against itself and clear a
short-paying contract. So it was probed live rather than accepted.

### What the probe actually found — narrower than the code reading, and still real

Eight contracts with a RECEIVED August monthly payment, comparing
`currentPayment.amountValue` against the payment and against the plan's `(Monthly)` prose
line (ratios only; no amounts recorded here):

| contract | paid / plan-line | currentPayment / plan-line | reading |
|---|---|---|---|
| 1101305 | 0.4403 | **1.0501** | **paid ~42% of the agreed rate and `currentPayment` still returned the AGREED rate** |
| 1084149, 1078368, 1060026 | 1.05 | 1.05 | compliant payer — uninformative either way |
| 1103097, 1103086, 1103085 | 0.4403 | 0.4403 | **first-month contracts**: plan's `(Monthly)` line starts Sep, and the August row is the `(One Time Payment)` |
| 1049000 | — | unreadable | the expected-unknown case gate 3 already handles |

Three conclusions, in order of importance:

1. **The circular path did NOT fire in the case that matters.** 1101305 paid ~42% of its
   agreed rate and `currentPayment` returned the full agreed figure. That is the exact
   shape this check hunts, and the expectation held. It also matches the three contracts
   recorded in §13 (1054346, 1086789, 1090543), where the field read 4,715/4,715/5,712
   while collections ran 2,100/2,100/3,360 for months.
2. **But `currentPayment` is NOT the recurring rate on a first-month contract.** On all
   three new contracts it returned the one-time/first-month figure — which equals what was
   paid, so such a case would self-clear. The plan text is what reveals it: a
   `(One Time Payment)` line dated in the audited month and a `(Monthly)` line starting
   AFTER it. `Project Plan` already extracts both lines; nothing yet reads their dates.
3. **The plan's `(Monthly)` prose line is EX-VAT.** Measured 1.05 exactly on four contracts.
   Anything comparing it to `currentPayment` (VAT-inclusive) must add VAT first, or it will
   report a 5% shortfall on every compliant contract.

### Two guards this argues for, neither needing another ERP call

- **A first-month guard** (per case): if the `(Monthly)` line's first date is after the
  audited month, or a `(One Time Payment)` line falls inside it, the contract had no
  recurring monthly obligation that month. Route it out rather than scoring it — today it
  would self-clear, which is the quiet direction of failure.
- **A systemic circularity detector** (free): count candidates where `expected` equals the
  month's `monthly_net` exactly. Under the circular path that share goes to ~100%. If it
  crosses an implausible threshold, halt the run rather than publish a book of green
  verdicts. Cheap, needs no extra data, and fails closed.

### The uncontaminated source, for the record

`CalculateDiscountsWithVatService.getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, date)`
never reads `PAYMENTS`, is VAT-inclusive and discount-adjusted, and takes a date. It is
exposed over HTTP as `GET /accounting/ContractPaymentTerm/getnewddInfo?contractId=&startDate=`
→ `suggestedAmount`. **Probed live: 401 on all seven contracts** (permission
`ContractPaymentTerm/getNewDDInfo`), so it is a second declared gap rather than a fix — and
worth requesting alongside the replacements permission, because it is the only clean
agreed-amount read found anywhere. Note its own caveat from the code: it uses the
**active** payment term, so it cannot reconstruct a rate that changed after the audited
month.

## 18. Two guards built for §17 — gate 35 and the circularity tripwire

Both live in a new WF-A node, `Guards`, between `Compute Case States` and
`Adjudicate Cases`. Neither needs an extra ERP call.

### Gate 35 — was a monthly payment even due?

A case whose plan starts its recurring monthly schedule **after** the audited month is closed
`no_monthly_obligation_yet`: green, no verifier, `expected: null`, and the superseded verdict
kept on the case so the override is auditable. It is deliberately **not** merged into
`paid_in_full` — whether the one-time amount itself was right is a different expectation that
no gate here can test.

It fixes two live errors in opposite directions, both measured in §17: the self-clearing
first-month shape (1103085/86/97, where `currentPayment` returned the one-time figure the
client had just paid) and the false candidate (1101305, which read ~58% short because it
returned the full monthly rate).

The input is `plan.monthly_schedule_starts`, parsed in WF-E from the `(Monthly)` prose line.
That the date means "schedule start" and not "next payment due" is measured, not assumed:
over 44 live contracts it sits a median +0.8 months after `startOfContract`, 40 of 44 within
0–2.5 months, and it stays fixed in the past on old contracts (1014657 started 2022-07-12,
its line reads 2022-08-01).

**Expected fire rate.** Only contracts whose schedule begins after the audited month — in
practice those starting within ~1.5 months of it. A 120-contract sample from the middle of
the population walk (pages 20/60/100) contained **none** starting after 2026-05-07, so for a
July audit this is a small carve-out, not a filter over the book. An earlier 43% reading came
from a sample biased to brand-new contracts (advancesearch page 0) and is not the base rate.

Gate 10 and carried cases are protected: a month with nothing received belongs to the sibling
check whatever the plan says, and a carried case was never re-scored.

### The circularity tripwire

Halts the run when either holds over 500+ scored cases:

| test | threshold | measured norm |
|---|---|---|
| share of cases where `expected` equals what was received **exactly** | > 97% | **81.5%** (July 2026: 4,575 exact of 5,612) |
| shortfall cases beyond the AED 5.00 tolerance | **zero** | 984 of 5,612 |

Either shape means `expected` is being read from the payment itself — ERP's `currentPayment`
falling through to its payment-derived tier. That failure is invisible per case, because each
case individually looks perfectly reconciled, which is why the guard is a population test and
why it throws rather than warns. Under 500 scored cases it stays disarmed so small test runs
are not blocked. The error message names the check: compare a short-paying contract's
`currentPayment.amountValue` against `getnewddInfo`'s `suggestedAmount`.

Probed 2026-08-19, the circular tier is **not** firing today (1101305), so this is a
regression tripwire — worth having precisely because the day it fires the output looks
*better*, not worse.

### Why they are a separate node, and what that costs

The ideal placement for gate 35 is inside the gate chain, before gate 50. It is not there
because `Compute Case States` is 576 lines of ordered gates, tested 13/13 against the spec's
own cases, and shipped into n8n as a string — retyping the whole body to insert two blocks is
how money gets moved by accident. The guards need no scorer internals, so they run on its
output and the scorer was left untouched (verified: the deployed body still matches the repo
copy byte for byte, modulo one trailing newline).

The cost, stated rather than buried: the scorer still scores a gate-35 case internally before
`Guards` overwrites the verdict, so the scorer's own log counts it under the original verdict.
`Guards` logs `scorer_tally_superseded_for` to reconcile the two, and re-derives the tally it
emits.

### Tests

`offline/guards_test.js` — **24/24**, driving the real scorer and then the real `Guards`
body, the same pairing that runs in n8n: gate 35 fires on both live shapes, abstains on a
2022 schedule, abstains on a schedule starting inside the audited month (gate 50 keeps those),
abstains on an unparsed date, never overrides gate 10, and records what it superseded; the
tripwire passes a realistic month, refuses an all-exact book, stays disarmed under 500 cases;
the plan-date parser handles a normal date, a literal "Today", multiple one-time lines, an
unparseable month, a line with no date, and an empty plan. `Guards` also refuses a payload
with no `cases` array, and reports a missing `Join Enrichment` rather than passing silently.

Every pre-existing suite still passes unchanged: `harness` 13/13, `wf-e/offline/enrich_test`
39/39, `gate2_payments_test` 8/8, `gate2_test` 10/10, `attach_payments_test` 6/6,
`cohort_test`.

## 19. Execution 93346 — the furthest a run has ever got, and where it died

First run through the published chain, triggered by webhook 2026-08-19 08:58:08Z with
Hassan's own token. **Crashed at 09:39:36Z, 41.5 minutes in, 26 seconds after the last
enrichment chunk returned.** Every stage that has killed a previous run passed.

### The measured timeline — every figure below is observed, not projected

| phase | measured | previously |
|---|---|---|
| population + terminated paged walks | **16.0 min** | I estimated 11-14 for the population alone, and had not counted the terminated walk, which runs in the same branch queue |
| WF-P × 3 payment windows | **9 s total** (1.6-1.9 s each) | ~11 s yesterday |
| WF-S status sweep | **7 min 51 s** | 7 min 34 s yesterday — reproducible under load |
| gate 2 + Build Cohort + Attach Month Payments + Chunk Candidates | **10.0 min** | never measured; no run had reached it |
| WF-E × 8 enrichment chunks | **7.0 min** (56-57 s each, final partial chunk 27 s) | I estimated ~26 min — the per-chunk cost was 3x pessimistic |
| Join Enrichment → scorer | **26 s, then crashed** | — |
| **total** | **41.5 min** | ~46 min projected |

Eight chunks of 750 with a 382-candidate tail confirms **~5,632 candidates**, exactly the
figure §15 derived from the July payment rows.

### What chunk 0 proves about the enrichment (from its returned deltas)

| | |
|---|---|
| candidates / deltas returned | 750 / 750 — nothing lost, so the join had a complete set |
| plan fetch failures | **0** |
| expected rate readable | **750 / 750 (100%)** |
| monthly schedule date parsed | **750 / 750 (100%)** — the gate-35 parser reads live prose at full coverage |
| gate 35 would fire | **0 of 750** — the narrow carve-out §18 predicted, confirmed on live data |
| carrying a discount | 52 (6.9%) |

### Where it died, and what that costs to fix

The crash sits between `Join Enrichment` and the scorer. That is the retention term §16
explicitly left in place: the assembled cases. `Join Enrichment` holds ~5,632 full cases,
`Merge Streams` holds them again, `Compute Case States` a third time, then `Guards`,
`Adjudicate Cases` and `Build Case Payload`. At ~2.5 KB per assembled case that is ~14 MB
**per retained node output**, six times over, on top of the ~25 MB of staged sweeps and
~10 MB of population and terminated rows still resident.

So the ~73 MB projection in §16 was too low, and the reason is structural rather than a
mis-measurement: staging removed the raw bodies but the case objects were never the thing
being staged, and there are six copies of them at the end of the flow instead of four.

### A hypothesis worth testing before the next run, NOT a conclusion

**The memory ceiling may be per-INSTANCE, not per-execution.** Two other audits were live
in the same n8n instance during this run: `CC Price by Cohort · 2-Enrich+Score` ran
09:10:39-09:30:17 (success) and its follow-on chained at 09:30:17 and **crashed two seconds
later**, nine minutes before this run died. If n8n workers share a heap, every concurrent
execution's retained data counts against the same budget, and this entire retention analysis
has been reasoning about WF-A in isolation.

Evidence for: two crashes in one instance inside ten minutes, both in flows carrying large
row sets. Evidence against: the price-by-cohort crash came 2 s after its start, which looks
more like its own failure than a shared ceiling. **Not settled.** The cheap test is to re-run
this check when nothing else is executing and compare.

### The fix list, in the order that buys the most

1. **Batch the scoring tail.** The cohort does not need to reach the scorer in one item set.
   Splitting it into batches of ~1,500 through score → guards → adjudicate → sheet-write
   holds a quarter of the cases at a time and removes the six-copy peak entirely. This is the
   same medicine as the sweeps and the enrichment, applied to the last unstaged stage.
2. **Stage the population sweep** (9.2 MB, the only sweep still inline).
3. **Run it alone** and see whether concurrency was a factor.
4. Fix a defect this run exposed: **`_replacement_permission_denied` counted 0** while all
   750 replacement reads failed. The detector tests `resp.status === '401'` and an `error`
   string, and n8n's `continueRegularOutput` clearly hands back a different shape. Verdicts
   are unaffected — coverage is degraded either way, as declared — but the counter exists so
   a permission grant shows up as it falling to zero, and today it cannot.

### What this run settled that no amount of offline testing could

- The staged sweeps work under production load, reproducibly.
- Gate 2 reconciled a real cohort and let the run through.
- `Attach Month Payments` collapsed three months of real payments without dying.
- The enrichment chunking works, returns complete delta sets, and is 3x faster than modelled.
- The gate-35 parser reads live plan prose at 100% coverage and fires on nobody in a normal
  month — so it is a carve-out, not a filter over the book.

The circularity tripwire never got to run: it lives in `Guards`, downstream of the crash.

## 20. Population staged out — and a correction to why

`RbW2fT3b6rtqVQ9H` (`CC Below Agreed · 0-Sweep Population`), published 2026-08-19. Both of
WF-A's `contract/search/page` walks now run in a sub-execution: `Get CC Contract Population`
(mode `active`) and `Get Terminated Contracts` (mode `terminated`). Names, returned envelope
and `Join Bulk Pulls` inputs (0 and 5) unchanged, so gate 2 and `Build Cohort` needed no edit.

**The correction.** I told Moe this sweep was 9.2 MB and worth ~4.5 MB of retention. That
number came from a **pretty-printed** probe file. Re-measured minified on a live page:
**904 B/row**, so the active walk is **4.66 MB** and the projection saves **~2.85 MB** —
against a tail peaking near 98 MB, roughly 3% of the problem. Stated plainly rather than let
the pattern imply otherwise. This is the second time a pretty-printed measurement inflated a
figure in this file (see §14 on the 59.1 MB → 44.1 MB status sweep); minify before quoting.

**What actually justified building it.** Every row of this route carries
`workerSalaryMonthlyTip` — the housemaid's salary — and no gate reads it. Unstaged it sat in
WF-A's retained output for the whole run *and* in the stored execution record. ~5,405 active
rows plus ~949 terminated = **~6,350 salaries readable by anyone with project access**, for
every run ever kept. The projection drops it, plus `client.lastBlockLog`/`spouseName`/`city`/
`blocked` and six other unread fields. Staging only the active book would have left the 949
behind and looked finished, which is why both walks went through one sub-workflow.

**One item per page, deliberately** — the opposite of WF-S. Gate 2 proves this walk
terminated by its last page being short (`< 40`); a single 5,405-row item reads
`5,405 >= 40` and throws on a *complete* sweep. `wf-pop/offline/population_test.js` runs the
collapsed shape through the real gate 2 and asserts it still throws, so a later
"simplification" fails loudly instead of blinding the terminator.

`wf-pop/offline/population_test.js`: **31/31**, including a raw-vs-projected comparison
through the real `Verify Bulk Pulls` and the real `Build Cohort` (same rows, same declared
total, same reconciliation verdict, same page count, same cohort, first case field-for-field).

One behavioural change worth knowing: `Validation OK?` lists its parallel branches in a new
order (the two replaced nodes are now last), so the sweeps start in a different sequence.
`Respond 200` is still first, and the sweeps are order-independent, but a run's log lines
will not appear in the same order as in 93346.

## 21. The scoring tail batched — the fix for 93346, and three things found on the way

### The tail (WF-T `pOa3yRIyguSyoBk4`, published)

`Compute Case States`, `Guards`, `Adjudicate Cases`, `Build Sheet Rows` and the Cases append
are out of WF-A (69 nodes → 67) and run per batch of 1,200 inside a sub-execution. Five
retained copies of the cohort — ~14 MB each on the 93346 measurement, ~70 MB — now die with
each batch. `Chunk Cases` costs **one** copy back, and the README says so rather than
presenting the change as free: ids-and-re-read is unavailable here because these case objects
are derived, not fetchable.

Three of the four relocated bodies are **byte-identical** to WF-A's, verified after deploy.
That was the design goal, not a happy accident: WF-T names two nodes `Validate Inputs` and
`Join Enrichment` precisely because the lifted bodies already read those names, so 930 lines
of tested scoring logic never had to be retyped. `Build Sheet Rows` has one change — where its
case list comes from.

**Proof, not assertion:** `wf-t/offline/batch_equivalence_test.js` runs the batched and
un-batched chains over the same twelve fixtures (all six display bands) at batch sizes 1, 2, 5,
n−1, n, n+3 and compares scored cases field for field and in order. **Identical every time.**
46/46 including the guards on the new boundary.

### Three things the work exposed

**1. The circularity tripwire's arming depended on a tuning parameter.** It arms at 500 scored
cases, so inside a batch whether it arms at all is a function of `score_batch_size` — and the
failure it watches for is the one that makes output look *better*. `Join Scored` now repeats it
run-level. The suite fires it in both directions and proves it stays quiet on a normal book
(82% exact, 120 short).

**2. `written_at` changed meaning** — now the moment a row's batch was appended, not one
instant per run. More accurate, and a crashed run's timestamps show how far it got. Stated
because it is a behaviour change, however small.

**3. The Cases tab is written incrementally now.** A crash after batch 3 leaves three batches
of rows rather than nothing. Both `Return Batch Result` and `Join Scored` reconcile
rows-appended against the case count **in both directions**, so neither a short queue nor a
duplicated one (the Sheets retry makes that possible) can pass as complete.

### The `_replacement_permission_denied` defect from §19.4, fixed

The detector tested `resp.status === '401'` and searched `String(resp.error)` for `unauthor`.
n8n's `continueRegularOutput` hands a Code node an **error object**, not the HTTP body, so
`status` was undefined and `String()` on the error rendered `[object Object]`. It read **0**
while all 750 replacement calls were failing — a counter reporting zero for both "the grant
landed" and "every call is denied", and the number I would have used to claim the permission
had been granted.

Now three outcomes from the nested `httpCode` and a JSON-stringified search:
`permission_denied` (the route's known steady state — does not throw), `token_dead`, `other`.
A bare 401/403 with no ERP marker still counts as denied but is flagged **unmarked**, so a
change in ERP's error vocabulary surfaces as a rising number rather than silence.

**The substantive half: a dead token now throws, on both the plan and replacement reads.**
Every read after a token dies comes back empty; an empty maid history scores as "no maid
change" and an unreadable plan as "expected amount unknown". One contract like that is a
careful verdict. A chunk of them is a book-wide write-off wearing the same words. The plan side
had no classifier at all before this. 52/52 offline (was 39/39).

### The webhook secret is now a set, so rotating it cannot cause an outage

Not the credential itself — the n8n MCP can neither create a credential nor attach one, checked
against the whole tool surface, so that stays a UI action with the six-step sequence in
`RUNBOOK-trigger.md`. What is done is the part that made a safe rotation impossible: with one
literal there was no ordering that avoided an outage. `Validate Inputs` now compares against
named slots, does not break the loop early (so the comparison count cannot leak which slot
matched), and logs the matched **slot name** — never the value, which would land in every
stored execution record. `offline/validate_inputs_test.js`: 36/36, covering the secret set,
both rejection shapes, the `callback_url` exfiltration guard including the userinfo and
traversal tricks, and CRLF injection via the bearer, with the `URL` global shadowed away.

### Measured and reverted, recorded so nobody repeats it

Trimming the plan's unread prose fields. `payments_info` is written by WF-E and read by
nothing, so it looked like free weight — but measured on 44 real contracts it is **143 B**,
not the ~400 I assumed. With `expected_basis` and `plan_line_amounts_are_ex_vat` the whole trim
was worth **~8 MB of an ~84 MB problem**, and it cost the plan read's audit trail. Reverted.
That is the third time in this file a per-record size estimate of mine ran ~3× high; measure
before quoting, and minify first.

### What is still not done

A run. Everything above is offline-proven and deployed; nothing has been executed end to end
against the batched tail. That needs a live ERP token from whoever fires it, and the §19
per-instance memory hypothesis is still unsettled — the cheap test is to run it when nothing
else is executing.

## 22. The first end-to-end test run — and the acknowledgement the caller never gets

Run fired 2026-08-19 13:53 UTC as execution **94122**, `cohort_cap: 400`,
`score_batch_size: 100` (4 batches), `enrich_chunk_size: 150` (3 chunks) — the cheapest
shape that still fans both stages out. Token supplied by Hassan but **issued to Abdullaha**;
that is recorded here because §22's access findings are account-scoped, not check-scoped
(see PROBE-RESULTS corrections 1 and 2).

### The 524, which is a real defect and not a symptom of the run

`RUNBOOK-trigger.md` said: *"It answers immediately (the webhook uses a response node): `200`
with the accepted run, or `400` with the reason."* **It does not.** The POST hung and
Cloudflare returned **524 A timeout occurred** at 100 s. The workflow itself was unaffected —
94122 was already running — so the run is fine and the *caller* is the casualty.

Cause, read off the deployed graph rather than guessed:

- The `Webhook` node is `responseMode: responseNode`, correctly.
- `Validation OK?`'s true output fans to **seven** nodes: `Respond 200` **and** the six sweep
  starters (`Get Payment Statuses`, `Get Month Payments`, `Get Payments (M-1)`, `Get Payments
  (M-2)`, `Get CC Contract Population`, `Get Terminated Contracts`).
- n8n `executionOrder: v1` runs equally-ready branches in **position order, top to bottom** —
  not in connection order. The y coordinates are:

  | node | y | runs |
  |---|---|---|
  | Get CC Contract Population | −640 | 1st |
  | Get Month Payments | −528 | 2nd |
  | Get Payments (M-1) | −400 | 3rd |
  | Get Payments (M-2) | −288 | 4th |
  | Get Payment Statuses | −160 | 5th |
  | **Respond 200** | **−144** | **6th** |
  | Get Terminated Contracts | 208 | 7th |

So the acknowledgement fires **after the population walk, all three payment windows and the
status sweep** — roughly thirty minutes of work — and Cloudflare has hung up twenty-eight
minutes earlier. The 200 is dispatched into a closed socket.

**Why this matters beyond cosmetics.** The portal is the intended caller. It receives a 524,
which reads as *the audit did not start*. The obvious portal-side response to that is a retry,
and a retry launches a **second** full run — another ~11,000 production ERP reads, a second set
of Cases rows, and two runs racing on the same `run_id`. The check has never been fired by the
portal, so this has never been observed; it would have appeared on the first real integration.

**The fix is one coordinate.** Move `Respond 200` above the sweeps (any y below −640) and v1
ordering runs it first, before the population walk starts. Nothing else changes — same
connections, same validation, same branch. It is deliberately NOT applied mid-run, because
publishing WF-A while 94122 is executing would disturb the very run being measured. Applied
and re-verified after the run completes.

**A second reading of the same fact:** position is load-bearing behaviour in n8n, not layout.
That is worth carrying to the sibling checks — any flow whose respond node is drawn below its
work has the same latent bug, and it is invisible until someone measures the caller's wait
rather than the workflow's status.
