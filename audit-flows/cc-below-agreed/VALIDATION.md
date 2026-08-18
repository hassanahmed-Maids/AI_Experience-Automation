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
