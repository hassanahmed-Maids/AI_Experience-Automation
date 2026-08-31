# ILOE Checker — build validation report

Built 2026-08-30 from spec v0.8. Everything below was produced by the build, not
asserted from the spec.

---

## 1. What was built

| Workflow | id | Role |
|---|---|---|
| `ILOE Checker · Run (draft)` | `0eg6NXyfwiIUrQFr` | Parent. Manual webhook, no schedule, never published. |
| `ILOE Checker · 0-Sweep Population (draft)` | `Ci4naQW3ktglTmwg` | Population sweep, fail-closed completeness, slim projection. |
| `ILOE Checker · 1-Resolve Identity (draft)` | `zTKeneQAffMX0QlJ` | Gate 2, one detail call per payment. |
| `ILOE Checker · 2-Fetch Loans (draft)` | `vF77TcudKYe4hs0U` | Gate 4 input, one loans call per distinct maid. |
| `ILOE Checker — Cases` (data table) | `8Y6kyJqyVxCSH2iO` | The case store. |
| `ILOE Checker — Runs` (data table) | `IjGK33fiz41xo6qQ` | One row per run, counts and totals only. |
| `ZZ TEMP probe — ILOE surfaces` | `ESOVrx1JZMby60W1` | Nine-surface probe. **Keep** — it is the re-check once permissions are granted. |

**No workflow holds an ERP credential.** The token arrives per run in the payload.

---

## 2. Test results

### Offline — 31 / 31 green

`node checks/iloe/scorer/run_tests.js`

All seven of the spec's own test cases, plus a guard for every trap the rule
bodies name: retired expense heads, the retired `UNEMPLOYMENT_INSURANCE_PREMIUM`
loan type, `%UNEMPLOYMENT%` type bleed, fine-vs-subscription mismatch, the
absolute AED 0.50 tolerance in both directions, the over-recovery mirror case,
NEW-vs-RENEW partitioning, subscription-vs-fine partitioning, an unreadable loans
call, zero-amount rows, empty and bare waiver notes, an unseen waiver reason, and
the waiver-must-not-clean-a-duplicate case.

### Independent reproduction of the spec's verified figures

`node checks/iloe/scorer/reproduce_spec_figures.js`

| | Spec (hand-verified 2026-08-20) | This build |
|---|---|---|
| Candidate maids by raw payment count | 8 | **8** |
| Real duplicates after netting | 3 | **3** |
| Which maids | `132336`, `132405`, `132888` | **same three** |
| Total net excess | AED 378 | **AED 378** |

Reproducing the spec's own figures from independently written logic is the
strongest correctness signal available without live data.

### On the built flow — fixture run, execution `110456`

All seven spec shapes, scored by the **deployed** node rather than the reference:

| Payment | Expected | Produced |
|---|---|---|
| MV, no loan ever | finding · not recovered · 126 | ✅ |
| duplicate pair, both loaned | finding · paid twice · 126 excess | ✅ (both halves red) |
| paid 126, loaned 123 | finding · short · 3.00 | ✅ |
| paid 126, loaned 126 | clean · Recovered | ✅ |
| loan waived, note names approver + Escalation | clean · Written off with authority | ✅ |
| CC, no loan | pending · Awaiting the CC ruling | ✅ |
| payment reversed 51 days later | pending · Reversed, out of scope | ✅ |

Run row: `cases_scored 8 · red 4 · green 2 · pending 2 · total_finding_aed 255 ·
overall complete · cases written 8 of 8`.

**Live run: not performed.** Blocked on permissions — see §5.

---

## 3. The bug this build found, and what it would have done in production

Testing the built flow (execution `110448`) surfaced a **false clearance**.

Maid `132336` is one of the spec's three real duplicates. Gate 9 fired only on the
group's designated excess owner (`1970167`). The sibling payment (`1970166`)
therefore carried no red; its maid has a waived loan (the AED 2.00 *"because
Duplicate"* waiver), so gate 8 routed it to the verifier, verifier 2 read a valid
approver and reason, and with no red surviving it resolved to **clean**.

```
  txn 1970167  -> finding  "ILOE paid twice"             AED 126   correct
  txn 1970166  -> clean    "Written off with authority"  AED   0   WRONG
```

This is precisely what verifier rule 2's own `Never` line forbids — *"Never let
this close a duplicate payment or a missing loan elsewhere on the same maid"* —
and what its enrichment note predicts: *"maid 132336 is both a waived loan and one
of the three real duplicates, and a case-scoped clean here would have erased a
live finding."*

**In production it would have cleared one half of every waived duplicate.** On the
measured live-era population, waived maids are ~150× enriched for the duplicate
verdict, so this is the likely case, not an edge one.

**Fix:** every payment in a duplicate group is now red; the excess is still
attributed once, so the money total does not inflate. The run row now also carries
`n_duplicate_groups`, so "2 red payments" is never read as "2 duplicates".

**The offline suite had a test for this and it was too weak** — it asserted *some*
case in the group was a finding, which passed because the sibling was. It now
asserts *no* case in the group is clean. Reverting the fix makes the suite fail
2 / 28, verified.

---

## 4. Field-level diff versus the golden

Cloned from `MV Overstay Fines — generated v1` (`LDtsstXDfF99TnYe`).

| Area | Golden | This check | Why |
|---|---|---|---|
| Auth | stored credential `ERP Token 12th Aug 2026` on every HTTP node | **no credential anywhere**; `Authorization` from the run payload | Findings must be attributed to whoever ran the check. |
| Shape | one 81-node execution | parent + 3 sub-workflows, slim projections | ~1,500 calls/month cannot live in one execution. |
| Population body | `expense.name` `=` one exact name | `expense.name` `like 'ILOE'`, then client-side filter to six names | Six heads; `like` is one sweep not six, and an unrecognised ILOE-shaped name must route to pending rather than vanish. |
| Page size | `size=200` | **`size=40`** | At `size=50` the pager silently skips offsets 40–49. |
| Window | audited month | audited month **+ 60-day lookahead**, lookahead rows never become cases | Gate 12 nets a payment against a reversal that can land two months later. |
| Pacing | `batchInterval 500` | **`batchInterval 2000`** | Jacky's standing 2.0 s instruction, 2026-08-20. |
| Per-entity read | 2 concurrent | 1 at a time | Same. |
| Loan projection | full loan array | **`UNEMPLOYMENT_*` rows only** | The maid carries 43 other loan types; none needs to leave the sub-workflow. |
| Failure on denial | `continueRegularOutput` per node | aborts the chunk when **all** calls return `INSUFFICIENT_PERMISSIONS` | A missing grant is a finding, not a population of silent pendings. |

Row counts produced by the enumeration request: `like 'ILOE'` over
`2026-08-01 → 2026-08-19` returns **489** (`totalPages 13`).

---

## 5. Population proof — INCOMPLETE, and why

| Source | Count |
|---|---|
| ERP `advancesearchNew`, `like 'ILOE'`, 2026-08-01→19 | **489** |
| Warehouse mirror, same window, subscription + fines | 487 (per spec, 464 + 23) |
| Delta | **+2** |

**The delta is explained**: `like 'ILOE'` also matches the two staff expense heads,
which the warehouse query excluded. The build filters them at the population gate.
This is the spec's own recorded explanation and it now reproduces exactly.

**What is missing:** a second independent count taken *by this build* rather than
read from the spec. I have deliberately **not** wired a Snowflake query into the
flow — a per-run warehouse read would be a standing data process, which belongs
with the ERP/Data team, not inside an audit flow. The cross-count should be taken
once, by hand, out of band, before the first real run.

---

## 6. Declared gaps

| Gap | Effect on the numbers |
|---|---|
| **Ruling R1 open** (who owes the CC subscription) | Every CC payment with no loan is `pending`. On live-era rates ~1,280 of 2,335 CC new-subscription payments — **the pending count will dominate any real run**. Intended, not a defect. |
| **Ruling R4 open** (duplicate window) | Implemented as the conservative in-month + lookahead reading. A rolling window would find more. |
| **Ruling R3 open** (waiver authority) | Verifier rule 3 is implemented and unit-tested but **has no known reachable case** — `waiveNotes` is templated and always supplies an approver and a reason. Declared: this red may be unproducible by construction. |
| **Waiver reasons outside `Escalation` / `Duplicate`** | Routed to `pending`, not cleaned. This is a deliberate deviation from verifier 2 as written, because R3 says the real question is whether the reason is *acceptable*. Avoids a false clearance on a reason nobody has ruled on. |
| **Late reversals** | A payment reversed after the run executes is unknowable. Direction is a false **red**, and a re-run corrects it. Recommend running month M no earlier than M+2. |
| **Two reds on one case** | Headline `finding_aed` is the larger component, never the sum; both are carried separately. The spec does not define the combined case. |
| **Fixture rows in the case store** | Execution `110456` wrote 8 rows tagged `run_id = iloe-FIXTURE-TEST`. No row-delete tool is exposed over MCP — **delete them from the n8n UI before the first real run.** |

---

## 7. What still needs a human

1. **ERP permissions — blocking.** `AddEditTransaction` and `HousemaidsPayrollLoans`
   both return 401 `INSUFFICIENT_PERMISSIONS` on the audit account. A control probe
   with a deliberately wrong pagecode returned `API_NOT_FOUND_FOR_PAGE` instead,
   proving the pagecodes are right and the grant is missing. These are gate 2 and
   gate 4; without them the check produces no verdicts at all.
2. **Rulings R1, R3 and R4** — owner questions, not technical gaps. R1 decides
   whether this check finds anything on the CC half.
3. **Sign-off before the first production run and before publishing.** The spec
   names Jacky as maker/checker for this check, before anything reaches the Visa
   team. Build completion is not approval.
4. **Delete the fixture rows** from `ILOE Checker — Cases` (see §6).
5. **File the spec corrections** in `spec-corrections.md` back to the Notion rows.

---

## 8. Reviewing my own output

*Could any clearance in here be wrong?*

One was, and it is fixed and regression-tested (§3). Of the remaining paths to
`clean`, there are exactly two:

- **Gate 10 (Recovered)** — requires a matching-type loan inside the window, at or
  above the payment less AED 0.50, with nothing waived and no duplicate in the
  group. Every one of those conditions is an explicit spec requirement and each has
  its own test.
- **Verifier 2 (Written off with authority)** — requires a parsed approver *and* a
  reason *and* that the reason is one of the two ever observed. Anything else
  routes to `pending`.

Every other terminal state is `finding` or `pending`. Silence cannot produce a
clean: gate 11 floors the deterministic layer, verifier 4 floors the verifier
layer, an unreadable loans call is `pending`, an unresolved maid is `pending`, an
unrecognised expense name is `pending`, and an unseen loan-type member is
`pending`.

*Does it flag too much?* Yes, by design and by declaration — the CC population is
routed wholesale to `pending` pending R1. That is review cost, not a false
clearance, and the run row states it in `declared_gaps` on every run.

---

## 9. Finish-development pass (2026-08-31)

A self-review of my own diff, before the final test round, found two more
defects. Both were the same class as the first: they made the check produce
work it shouldn't, not crash.

### D-1 — the lookahead admitted positive payments

Stage 0 swept `range_start → range_end + 60d` and returned **every** row.

- **Budget:** a weekly run would then make an identity call for roughly two
  extra months of payments — ~1,500 calls instead of ~190, straight back over
  the cap the staged design exists to stay under.
- **Correctness:** a *positive* payment six weeks later is a separate
  obligation. Pulled into the same `maid + family + stage` group it inflates
  `net_paid` and manufactures a duplicate that ruling R4's conservative
  in-window reading excludes.

The lookahead exists for exactly one purpose — letting gate 12 net a payment
against its reversal. **Only negative rows survive it now.**

### D-2 — a weekly window scored the whole month

The scorer derived scope as `date.slice(0,7) === audited_month`. On a run of
`2026-07-01 → 07-07` with a lookahead to `2026-09-05`, a payment dated
`2026-07-20` is in the lookahead *and* in the same month — so it was scored as
a case despite falling outside the window being audited.

**The run window decides what is a case, never the calendar month.** Stage 0
now sets `in_audited_month` from the window and the scorer takes it verbatim.

### D-3 — the run row overstated ruling R1's population

A waiver whose reason is outside `Escalation` / `Duplicate` is parked pending
R3, but it was borrowing verifier 1's `Awaiting the CC ruling` label. On the
fixture that reported `pending_cc_ruling: 2` when exactly **one** case was
waiting on R1 — a 100% overstatement of the population behind the single
decision this check most needs. It now carries its own label, and a case takes
the label of the pending verdict that actually fired.

### Also finished in this pass

- **Crash path.** An Error Trigger now releases the shared ERP lease. Without
  it a mid-run failure left the lease held and wedged *every other audit check*
  until expiry.
- **Measured run row.** `txns_pages`, `erp_calls_made`, `population_complete`
  and `lookahead_to` were hardcoded zeros/true; all four are now measured.
  `erp_calls_made` reads 15 on the fixture = 1 page + 8 identity + 6 loans.
- **Empty-window guard.** A window with no ILOE payments now aborts rather than
  reporting a clean run.
- Workflow tagged `audit: ILOE Checker`, matching the sibling checks.

### Regression proof

Each fix has a test that **fails without it** — verified by reverting:

| Revert | Suite result |
|---|---|
| duplicate sibling not red | 26 / 28 — 2 failures |
| scope from month, not window | 30 / 31 — 1 failure |
| positive lookahead rows grouped | 30 / 31 — 1 failure |

---

## 10. Full test matrix — final state

| # | What | How | Result |
|---|---|---|---|
| 1 | Scorer logic | 31 offline tests | **31 / 31** |
| 2 | Spec's verified figures | independent reproduction | **8 → 3 duplicates, AED 378, same three maids** |
| 3 | Stage 0 projection | pinned sweep page, 7 rows | in-window kept · same-month positive **dropped** · August negative **kept** · staff excluded · retired excluded · unrecognised flagged · pages 1 |
| 4 | Stage 0 fail-closed | pinned `totalElements 99`, 1 row | **aborts**: "pulled 1 of 99" |
| 5 | Stage 1 identity | pinned 200 / empty-housemaids / 401 | resolved · `no_housemaid_on_transaction` · `http_401_INSUFFICIENT_PERMISSIONS` |
| 6 | Stage 2 loan projection | pinned loans incl. `SALARY_ADVANCE` 5,000 and a medical loan | **only `UNEMPLOYMENT_*` survives**; maid ids de-duplicated |
| 7 | Stage 2 permission abort | all calls 401 | **aborts** rather than scoring with no recovery side |
| 8 | Parent, monthly window | 7 spec shapes | all 7 correct; total AED 255 |
| 9 | Parent, weekly window | 8 rows incl. a reversal in the lookahead | 7 cases (reversal is **not** a case) · red 3 · green 1 · pending 3 · AED 252 · `overall complete` |
| 10 | Run-row accuracy | same run | `pending_cc_ruling 1` · `pending_unseen_waiver_reason 1` · `erp_calls_made 15` · `lookahead_to 2026-09-05` |
| 11 | Live ERP re-probe | 9 surfaces, 2026-08-31 | **token expired** — no new permission signal; §7 item 1 stands as last measured |

**Not exercised:** the crash path. n8n fires Error Triggers on production
executions, not manual/test runs, so it is wired and reviewable but unproven.
It is the one path in this build with no test behind it.
