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
