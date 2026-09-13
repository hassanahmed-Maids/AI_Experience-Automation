# Scope as defined by the business — and what already exists against it

The chart defines **four checks**, branching on inside- vs outside-country, with change-of-status
hanging off the inside branch only. That branch matches the code exactly:
`CheckEntryVisaImmigrationApprovalStep.onDone` sends inside-UAE cases (and all office staff) to
`ChangeOfStatusStep`, and outside-UAE cases straight to medical/flight.

| # | Check (as defined) | Applies to | Status |
| --- | --- | --- | --- |
| **A** | No duplicate payments **for the same maid** | both branches | Built as F4 — **but at the wrong grain**, see below |
| **B** | Rejected → partial refund claimed **within 60 days**, else record a loss | both branches | Built as F1 + the proven tariff. **The 60 days needs a ruling**, see below |
| **C** | Correct entry-visa **type** used (inside vs outside) | both branches | 🔴 **BLOCKED and now first-class.** Location is computed, never stored |
| **D** | Change of status (**cost 572**): no duplicate payments; if fines apply, who repays | inside branch only | 🔴 **NOT BUILT.** Explicitly scoped out of v1 |

---

## Three things this changes

### A · "for the same maid" is a wider net than I built

F4 works at **request grain** — two charges on one visa request. The check says **maid grain**. A maid
can hold more than one visa request (a stopped case then a fresh one; a cancellation then a
re-application), so paying twice for the same maid **across** requests is a duplicate the current rule
cannot see. The per-request version is a subset.

**Consequence:** F4 must be re-cut on `OWNER_ID` with `OWNER_TYPE='HOUSEMAID'`, keeping the
justifying-event logic from W4. Expect the population to grow, and expect a new legitimate case to
appear — a genuinely new visa journey after a failed one — which needs its own justifying event
(a new request whose predecessor was stopped or cancelled).

### B · The 60 days does not exist where the check assumes it does

The check reads *"confirm the partial refund was claimed within 60 days"*. Three findings bear on it:

- **The ERP has no 60-day rule.** No constant, parameter or job encodes a refund deadline. Verified
  directly against the code.
- **GDRFA publishes 60 days as the ENTRY PERMIT's own validity** — *"valid for 60 days from the date
  of issue and cannot be extended"* — not as a refund window. The two clocks are different things.
- **Measured, it makes no practical difference.** Of 556 refunds paired to a dated rejection,
  **547 arrived within 7 days**, 9 more within 30, and **none ever later than 30 days**. A 60-day test
  therefore flags the same cases as "was it refunded at all".

**This does not block the check** — implement 60 days as written, since it is the business's stated
rule and it is conservative. But report the ageing distribution beside it, and record that the
operational reality is **7 days, not 60**: a claim not filed in the first week is not late, it is
almost certainly never coming.

### C · "Correct entry-visa type" is the one check with no data

This was `M6`, marked non-blocking in v1. As a named check it is now **blocking**, and it cannot run:

- `NewRequest.isInsideUae()` is **computed at runtime and never persisted**. There is no
  `is_inside_uae` column on the request or on the expense.
- The only durable trace is the expense **purpose**, which is derived from the **amount**, not from
  location — so using it to test "was the right type used" is circular.
- The reference prices are the measured modes, **1,022.50** and **372.50**, since no price list exists
  in the system at all.

**To unblock:** ingest `new_request.location_id` → `picklist_item.name` (emirate names ⇒ inside), and
`office_staff.location_enum` for staff. There is no flag to copy; it must be re-derived.

⚠️ A partial proxy exists and must not be mistaken for the attribute: nationality correlates with
location (Kenyan, Ethiopian and Indonesian maids cluster on the outside-country price; Filipina and
Indian on the inside price). That is recruitment geography. **Useful as a cross-check, never as the
test.**

### D · Change of status is not built at all

In scope per the chart, out of scope in v1. What exists already:

- `CHANGE_OF_STATUS` is a live expense purpose with **40,163 rows** in the ledger.
- It is reached from `ChangeOfStatusStep`, on the inside-UAE branch only — matching the chart.
- The stated cost is **572**. Three other figures circulate for change of status elsewhere in the
  company (590.54, 575.65, 572.50), so the first task is establishing which is authoritative and what
  the ledger actually shows.
- The fines question maps to real columns: `OVERSTAY_FINE`, `OVERSTAY_FEE`,
  `OVERSTAY_FINES_BEFORE_CHALLENGING`, `OVERSTAY_FINES_AFTER_CHALLENGING`, and **`FINES_PAID_TO_US`**
  — which is precisely *"who is responsible for repayment"*.

Duplicate-payment logic transfers directly from A; the fines question is new work.

---

## What was found that the chart does not ask for

Reported so the decision to drop it is deliberate rather than accidental. Both are larger than
anything in scope:

| Finding | Measured | Why it may still matter |
| --- | --- | --- |
| **F10 — approved, then cancelled** | **5,747 cases · AED 3,454,994** | The largest single number in the audit. After validating against GDRFA it is a **cost, not recoverable** — the refund entitlement is scoped to rejection. Worth managing (cancel *before* approval) rather than auditing |
| **F3 — permit expired unused** | **444 cases · AED 329,107 gross, ~203,455 recoverable** | Larger than the rejection channel the chart does ask for. The company's own loss view already calls it *"Should Have Been Refunded"*. A permit has a hard 60-day life it cannot extend |
| F9, F11, F7, F8 | ≈ AED 36,000 plus hygiene | Ledger-integrity errors found on the way. F9 is the only finding **getting worse** — one operator, 4 cases in 2025 → 25 in 2026 |

**Recommendation:** keep F3 in scope. It is the same money, the same fee and the same failure — *the
application did not succeed and the money did not come back* — differing only in whether immigration
said no or the clock ran out. The chart's branch B already covers the rejection half; excluding the
expiry half leaves the larger portion uncontrolled.


---

# Measured, 2026-09-13

## Check A — duplicate payments per maid

| verdict | pairs | maids | AED | median days apart |
| --- | --- | --- | --- | --- |
| a · justified — refund / rejection / refund step | 911 | 873 | 878,712 | **8.0** |
| b · justified — a new journey after the last one ended | 391 | 387 | 339,712 | **214.0** |
| **c · DUPLICATE across requests** | **76** | 75 | **36,575** | 74.0 |
| **d · DUPLICATE on one request** | **522** | 486 | **459,865** | 17.5 |

> ### Check A's answer: **598 duplicate charge pairs across ~561 maids, AED 496,440.**

**Both justifying rules are doing real work and neither is over-forgiving.** (a)'s median gap is
**8 days**, which lines up almost exactly with the measured refund turnaround of 7 — the
reject → refund → re-charge cycle, visible as a timing signature rather than an assumption. (b)'s
median gap is **214 days**, which is a genuinely new visa journey, not a re-payment.

⚠️ **I over-stated the case for the re-cut.** I said request grain was "structurally blind" to
cross-request duplicates, implying a large hidden population. Measured, it is **76 pairs and
AED 36,575 — 7% of the finding**. The maid-grain rule is still correct, and it is the business's
stated definition, but it adds a small population rather than a large one.

## Check D — change of status

### 🔴 The three "competing tariffs" are one tariff on three payment channels

| observed | lines | what it is |
| --- | --- | --- |
| **572.50** | 7,407 (**78.6%**) | the base fee — the chart's 572, confirmed |
| 575.65 | 302 | **572.50 + 3.15** — flat channel surcharge |
| 590.54 | 793 | **572.50 × 1.0315** — proportional 3.15% channel surcharge |

**This settles a question that was open across three documents.** 590.54, 575.65 and 572.50 were
circulating as rival figures for change of status with nothing reconciling them. They are the same
fee. And the **same two surcharges appear on the entry visa**: 1,025.65 = 1,022.50 + 3.15 and
1,054.71 = 1,022.50 × 1.0315; 375.65 = 372.50 + 3.15 and 384.24 = 372.50 × 1.0315. One surcharge
structure, both fees, consistent to the fils.

### 🔴 The overstay fine is bundled inside the change-of-status fee

The long tail is an arithmetic progression: **572.50 + 50.00 × n**, and on the surcharged channel
**590.54 + 51.57 × n** — the same AED 50/day carrying the same 3.15%. Observed up to 2,272.50, i.e.
**34 days of overstay charged inside a line labelled `CHANGE_OF_STATUS`**.

Three consequences, and they change what check D can be:

1. **"If fines apply, check who is responsible for repayment" cannot be answered from the expense
   ledger** — the fine has no line of its own. It must be decomposed as `amount − base`, or read from
   the request's own overstay columns, which the spec already records as **not reconciled to each
   other**.
2. **A duplicate test on change of status cannot compare amounts.** Two different amounts can both be
   correct for the same maid because the overstay differs. Match on the **base**, not the total.
3. **The company has a fines exposure it cannot currently see.** `D4` decomposes and prices it.

### ✅ D4 — the tariff model holds, and the hidden fine is priced

`D4` decomposed all 9,696 change-of-status lines over the rolling 12 months. **9,689 of 9,696
(99.93%) fit the model** — base fee on one of three payment channels, plus AED 50/day of overstay.
Seven lines do not (below). A model that explains 99.93% of a ledger it was inferred from is
adopted.

| schedule | fine? | lines | maids | total AED | embedded fine AED |
| --- | --- | ---: | ---: | ---: | ---: |
| plain 572.50 | no | 7,407 | 7,396 | 4,240,508 | — |
| plain 572.50 | **yes** | 998 | 995 | 1,455,005 | **883,650** |
| proportional ×1.0315 | no | 795 | 795 | 469,479 | — |
| flat +3.15 | no | 304 | 304 | 174,998 | — |
| proportional ×1.0315 | **yes** | 147 | 147 | 150,040 | **63,231** |
| flat +3.15 | **yes** | 38 | 38 | 45,075 | **23,200** |
| unexplained | — | 7 | 7 | 59,938 | — |

**AED 970,081 of overstay fine per year is being paid inside a line labelled `CHANGE_OF_STATUS`,
on 1,180 maids (12.2% of lines).** Implied ≈ 19,363 overstay days, averaging 16.4 days per affected
maid. Nothing in the expense ledger names this as a fine.

⚠️ **The seven unexplained lines average AED 8,563 each** — 15× the base fee, against a ledger whose
next-largest line is 2,272.50. Either a different fee is booked under this purpose, or the amount is
wrong. `D6` isolates them. Until it runs, do not describe the 9,689 as "all lines".

⚠️ **`MAX_IMPLIED_DAYS = 515`** on the plain schedule (AED 26,322.50). At 515 days the arithmetic
match is probably coincidental — any amount ending in the right fils lands on the ladder. The mean
is 17.7 days, so the outlier moves the total by <3%, but the per-maid figure is not safe at the tail.

### 🔴 D3 — the company recovers one fifth of the overstay fines it records

Over 24 months, 916 requests carry a recorded `OVERSTAY_FINE`, totalling **AED 5,942,450**. Only
**90 of them (9.8%), worth AED 1,233,300 (20.8%), are flagged `FINES_PAID_TO_US = '01'`.**

| FINES_PAID_TO_US | requests | with overstay fine | fine AED | with overstay fee | fee AED |
| --- | ---: | ---: | ---: | ---: | ---: |
| `'00'` — not repaid | 64,268 | 811 | 4,616,250 | 2,443 | 1,321,595 |
| *(blank)* | 8,569 | 15 | 92,900 | 222 | 123,450 |
| `'01'` — repaid to us | 131 | 90 | **1,233,300** | 88 | 696,699 |

This is the chart's "who is responsible for repayment" question, answered: **on the ledger's own
telling, AED 4,709,150 over 24 months (~2.35m/yr) was fined and not recorded as recovered.** That is
not yet a loss figure — an unrepaid fine may be correctly the company's to bear, depending on cause.
It is the *population* the audit must adjudicate, and it is currently invisible.

⚠️ **`REDUCED_BY_CHALLENGE_AED` is a measurement artifact — do not publish it.** The query computed
`before − after`, but only 50 of the 209 requests with a before-challenge value have any after-
challenge value. Where `after` is null the formula scores the *entire* fine as "reduced", which
reads a missing record as a total win. The AED 1,798,075 and AED 832,630 figures are therefore
meaningless. What the columns *do* show is that the challenge process is recorded on **209 of 916
fined requests (22.8%)** — the appeal route exists and is barely tracked.

### ⚠️ D3 and D4 do not reconcile, and must

| source | population | annualised |
| --- | --- | ---: |
| D4 — fine embedded in the change-of-status fee | NewRequest change-of-status, 12mo | **970,081** |
| D3 — `OVERSTAY_FINE` on the request | all requests, 24mo | **2,971,225** |

A 3× gap. Three readings, and they are not distinguishable from these two queries: (a) different
populations, since D3 spans renew and cancel legs that D4 excludes; (b) `OVERSTAY_FINE` is the fine
*declared*, while the change-of-status payment settles only part of it; (c) the same fine is counted
in both places, and the company's true exposure is the smaller of the two. **`D5` joins them at
request grain and settles it.** No fines figure should be published until it runs.

### D2 — duplicate change of status: 24 payments, AED 17,527

| verdict | pairs | maids | AED | median days apart |
| --- | ---: | ---: | ---: | ---: |
| a · justified — new journey after the last ended | 170 | 169 | 131,601 | **767.0** |
| b · **DUPLICATE** | **24** | 24 | **17,527** | **15.0** |

Small, and clean. The justifying rule validates on its timing signature exactly as it did in check A,
and more sharply: a **767-day** median gap is unambiguously a new visa journey, not a re-payment. The
duplicates sit at **15 days**, within a day of check A's 17.5-day on-request duplicates — the same
operational failure showing the same signature on a different fee.

### ✅ A2 — check A closes, with an exact internal control

| maids with a charge | charges | requests | requests per maid |
| ---: | ---: | ---: | ---: |
| 59,524 | 61,424 | 60,127 | **1.010** |

Excess charges over maids = 61,424 − 59,524 = **1,900**. Check A's four verdicts summed to
911 + 391 + 76 + 522 = **1,900 pairs**. Every excess charge in the ledger is accounted for by exactly
one adjudicated pair — the finding has no unclassified remainder.

It also confirms the over-statement correction rather than excusing it: at **1.010 requests per
maid**, 99% of maids have a single request, so request grain was structurally blind to only ~1% of
the population. The re-cut was right and small, as measured — not right and large, as I first claimed.

### 🔴 D5 — the 3× gap is not a population difference. The two columns mean different things.

On the **same population and the same 12 months**, embedded fine = 970,080 and `OVERSTAY_FINE` =
3,068,900. Reading (a) — "different populations" — is dead. And the two sets barely overlap:

| reconciliation | requests | embedded AED | OVERSTAY_FINE AED | OVERSTAY_FEE AED | flagged repaid |
| --- | ---: | ---: | ---: | ---: | ---: |
| a · no fine on either side | 8,149 | 0 | 0 | 17,945 | 2 |
| b · **embedded in the fee, nothing in OVERSTAY_FINE** | **997** | **640,800** | 0 | 630,299 | 14 |
| c · **OVERSTAY_FINE recorded, nothing embedded** | **364** | 0 | **2,384,550** | 37,980 | 6 |
| e · both, and they **disagree** | 137 | 269,380 | 624,450 | 269,250 | 24 |
| d · both, and they agree | 48 | 59,900 | 59,900 | 59,900 | 3 |

Of 1,546 requests carrying a fine on either side, **48 (3.1%) agree**. The join loses nothing: the
embedded column sums to 970,080, matching D4's 970,081 to the rounding.

**`OVERSTAY_FEE` is the column that tracks the money.** Read it down the table against the embedded
amount — the numbers I derived arithmetically from the fee ladder, with no knowledge of this column:

| | embedded | OVERSTAY_FEE | apart |
| --- | ---: | ---: | ---: |
| d · both agree | 59,900 | 59,900 | **0.00%** |
| e · both disagree | 269,380 | 269,250 | **0.05%** |
| b · fine invisible to OVERSTAY_FINE | 640,800 | 630,299 | 1.64% |

So the two columns are not two attempts at one number, and the spec's "not reconciled to each other"
resolves into a meaning:

- **`OVERSTAY_FEE` ≈ what the company actually paid**, mirroring the amount buried in the fee.
- **`OVERSTAY_FINE` ≈ what was assessed/declared** — ~3× larger, and on 364 requests (AED 2,384,550)
  it carries a fine that no payment anywhere corresponds to.

⚠️ **This is corroboration only if the two are independent, and they may not be.** If the ERP computes
`OVERSTAY_FEE` and then writes `amount = base + OVERSTAY_FEE`, it is one measurement stored twice, and
a 0.00% agreement is a tautology rather than a proof. **Asked of the code; do not cite the agreement
as independent confirmation until the answer is in.**

**The recovery rate, tighter than D3's.** Across all 1,546 fined requests, **49 (3.2%)** are flagged
`FINES_PAID_TO_US`. And in category **b** — the fines that are invisible in the fine column — it is
**14 of 997 (1.4%)**. The fines nobody can see are the ones that are almost never recovered. Stated
as an association, not a cause; it is nonetheless the actionable shape of the finding.

### ✅ D7 — the AED 50/day ladder is real

| implied overstay | lines | % |
| --- | ---: | ---: |
| 0 days | 8,506 | **87.73** |
| 1–7 days | 704 | 7.26 |
| 8–30 days | 345 | 3.56 |
| 31–90 days | 94 | 0.97 |
| 91–180 days | 25 | 0.26 |
| 181+ days | 15 | 0.15 |
| unexplained | 7 | 0.07 |

A smooth monotonic decay — which is what an overstay-days distribution looks like, and is *not* what
a false-positive matcher produces. An over-permissive modulo test would scatter matches roughly evenly
across the range, and would bulge at the tail where more amounts are available to land on the ladder.
It does neither. The ladder holds across its whole range.

⚠️ **Correction.** I wrote that the 515-day outlier "moves the total by <3%". That was reasoning from
one line; there are **15** in the 181+ band, and at 182–515 days each they could carry roughly a fifth
of the AED 970,081. The direction of my claim was wrong, not just its size. `D8` measures the band's
actual weight instead of estimating it.

### D6 — the seven unexplained lines are the same fee, one notch off the ladder

| amount | implied days off base 572.50 |
| ---: | --- |
| 13,397.50 | 256.5 |
| 11,997.50 | 228.5 |
| 11,947.50 | 227.5 |
| 7,847.50 | 145.5 |
| 7,147.50 | 131.5 |
| 6,647.50 | 121.5 |
| 952.50 | 7.6 |

**Six of the seven are exactly half a day off** — an odd multiple of AED 25 above the base, i.e.
`572.50 + 25 + 50n`. Six independent lines landing on the same AED 25 offset is a tariff component,
not noise: a half-day charge, or a fixed AED 25 add-on. The seventh (952.50) fits neither.

All seven are **MV**, all **HOUSEMAID**, all inside a ten-week window (2026-01-05 → 2026-03-16). One
contract type, one quarter — a process or tariff change, not corrupt data. Their implied overstays of
121–256 days independently corroborate D7's tail: long overstays exist in this population.

At base + fine, the six carry ≈ **AED 55,550** of further embedded fine, +5.7% on the headline.

### Revised overstay picture

| | AED | basis |
| --- | ---: | --- |
| Paid by the company, buried in the change-of-status fee | **970,081/yr** | D4, arithmetic decomposition |
| Same, as the ERP's own `OVERSTAY_FEE` | 1,015,374/yr | D5 — corroborating **only if independent** |
| Assessed but matched to no payment | 2,384,550 on 364 requests | D5 category c |
| Recovered from the maid | **3.2% of fined requests** | D5, 49 of 1,546 |

The AED 2.97m/yr from D3 is the **declared** figure and should not be presented as money out. The
money-out number for overstay is **≈ AED 1m/yr**, arrived at down two paths.

### 🔴 D8 — the tail is 23% of the money, and 40 cases are 39% of it

| implied overstay | lines | embedded fine AED | % of fine |
| --- | ---: | ---: | ---: |
| 0 days | 8,506 | 0 | — |
| 1–7 days | 704 | 110,671 | 11.41 |
| 8–30 days | 345 | **262,399** | **27.05** |
| 31–90 days | 94 | 220,960 | 22.78 |
| 91–180 days | 25 | 153,450 | 15.82 |
| **181+ days** | **15** | **222,600** | **22.95** |
| unexplained | 7 | 0 | — |

**My correction was the right one and the size is confirmed: 22.95%, not "<3%".** The 15 longest
cases average ≈297 days of overstay each — nearly ten months. That is not a filing delay; it is a
case that was abandoned or stuck.

**The distribution is the finding.** The cost is not spread across the 1,183 affected maids:

- **40 cases (91+ days) carry AED 376,050 — 38.8% of the total.**
- **134 cases (31+ days) carry AED 597,010 — 61.5%.**
- The 704 short cases (1–7 days), 60% of all fined lines, carry 11.4%.

Forty cases a year is a caseload a human can review by name. This is not a diffuse process problem
to be fixed with a policy; it is a small, nameable set of runaway cases nobody is watching.

**Illustrative ceiling, clearly labelled as such:** had the 40 long cases been closed at day 30, the
saving would be ≈ AED 316,000/yr (376,050 − 40 × 30 × 50). That assumes every long case was
preventable, which it certainly is not — some will be absconded maids or disputes outside the
company's control. It sizes the prize, not the recovery.

**The tail's fate rests on the same independence question as everything else here.** If ~23% of the
embedded total were a matcher artifact, `OVERSTAY_FEE` would have to be inflated by the same artifact
to keep agreeing within 4.7%. Either the tail is real, or the two figures are one number written
twice. **The code answer decides both at once.**

### 🚧 BLOCKED — ask-the-code is unavailable in this container

`.env` does not exist here (only `.env.example`), so `scripts/ask-code.sh` cannot authenticate. Three
questions are waiting on it, and they gate the headline:

1. What writes `OVERSTAY_FEE` vs `OVERSTAY_FINE`, and is the change-of-status `AMOUNT` computed as
   `base + OVERSTAY_FEE`? — decides whether D5's agreement is corroboration or a tautology, and with
   it whether the AED 970,081 has one source or two.
2. What sets `FINES_PAID_TO_US`?
3. Does **any** flow deduct an overstay fine from a maid, and who decides who bears it? — the half of
   the chart's repayment question that Snowflake cannot answer.

---

## Check B — started

### 🔴 The 60-day test cannot be applied to the whole rejection population

Before writing the check I looked for the rejection date. `SHOW COLUMNS` on
`INITIAL_VISA_REQUESTS` returns **118 columns and not one of them dates this event** — there is no
`LAST_MODIFICATION_DATE` on the live row and no rejection-date column. The date exists only in the
revision history.

That collides with G5's corrected rule. The rejection set is a **union** of history and live because
each misses part of the other (history misses 22.6%, live misses 41.5%). But **only the history side
carries a clock.** So the ~22.6% of rejections that exist only as a live point-read cannot be tested
against 60 days, or against any deadline, at all.

This does not sink check B. It splits it:

- **B1** runs the check as written on the dated subset — the only population where "within 60 days"
  is a meaningful question.
- **B2** prices the undateable slice. If it is large, the business's 60-day rule has to degrade to
  *"was it ever claimed"* for that slice, and the spec must say so rather than quietly reporting a
  60-day number computed on part of the population.
- **B0** looks for the cheapest possible rescue first: a workflow task (`CheckEntryVisaImmigration…`
  is a real code step) whose `ENDED_AT` would date the live-only rejections. If it exists, B1's
  population roughly doubles and the constraint disappears. Worth asking before accepting a limit.

### What B1 carries forward from A and R

Not re-derived — the same four disciplines that were each bought with a measured error earlier:

| discipline | the error it prevents |
| --- | --- |
| refunds resolved to the **maid**, and the query reports how often that mattered | check A's grain bug, asserted then measured at 7% |
| both refund legs bridged through `CANCEL_VISA_REQUESTS.NEW_REQUEST_ID` | the cross-leg id mis-join that inflated 17 → 26 |
| refund search bounded by the maid's **next** rejection (1:1 pairing) | R1's fan-out, which ran 3.5× high |
| rejections inside the last 60 days excluded from "loss" | manufacturing a finding out of cases still in window |

Recoverable is priced at **charged − 283.00**, the proven flat government retention, not the whole
charge.

⚠️ **A known conservatism in check A, recorded now that B has re-opened the rejection question.**
A1's justifying-event set read rejections from the **history only**, not the union. It therefore
misses ~22.6% of rejections as justifiers, which would push a small number of genuinely justified
pairs into the duplicate verdicts. A1's 598 duplicates are an **upper bound**, not a point estimate.
The refund and refund-step justifiers damp the effect, but the direction is known and should be
stated wherever the figure is quoted.

### ✅ B0 — the rescue exists

| task | rows | requests | first seen |
| --- | ---: | ---: | --- |
| **Check Entry Visa Immigration Approval** | 60,313 | **56,634** | **2019-04-03** |
| Apply for entry Visa | 62,090 | 61,201 | 2019-04-03 |
| Fix the problem of entry visa | 2,064 | 1,851 | 2019-04-07 |
| Refund Entry Visa Application | 1,225 | 1,164 | **2024-11-05** |

The immigration-approval step runs on **56,634 requests back to 2019** — against ~60,127 requests
that carry a charge, i.e. essentially all of them, and seven years earlier than the approval field's
history. Its `COMPLETED_AT` dates the decision, so the 196 undateable rejections are recoverable.

And the tasks view carries **`ITERATION`** — the number of times a request cycled back through a
given step. A request that *re-enters* immigration approval was sent back. **That is a rejection
signal that owes nothing to the approval field or its history floor**, which makes it the independent
check the rejection set has lacked all along.

⚠️ Noted in passing: the `Refund Entry Visa Application` **task** starts 2024-11-05 while the refund
**expense** starts 2024-02-06. The task is not a complete refund signal and must not be used as one.

### B2 — the undateable slice is 22.6%, and the split is internally consistent

| source | requests | maids | charged AED | recoverable AED |
| --- | ---: | ---: | ---: | ---: |
| in both — dateable | 312 | 311 | 222,921 | 137,423 |
| history only — dateable | 360 | 358 | 696,363 | 594,483 |
| **live only — cannot be clocked** | **196** | 194 | 129,802 | **74,617** |

Union = 868, history = 672, live = 508 — matching the earlier measurement exactly, which is a clean
control on both. Dateable is **77.4%**; undateable **22.6%**, worth AED 74,617 recoverable.

**An asymmetry worth keeping:** history-only requests carry **AED 1,934 of charge each**, against 714
for "in both" and 666 for live-only — roughly 3×. Requests whose rejection survives only in history
are the ones charged more than once, i.e. re-application cycles; requests that still *read* rejected
today are mostly dead ends charged once. The live point-read is biased toward cases that never
recovered. Do not treat the two sources as interchangeable samples.

### 🔴 B3 — half the refund book cannot be traced to a rejection

| coverage | leg | refunds | maids | AED |
| --- | --- | ---: | ---: | ---: |
| traces to a rejection | NewRequest | 779 | 740 | 387,571 |
| **ORPHAN** | NewRequest | **433** | 415 | **293,872** |
| **ORPHAN** | CancelRequest | **223** | 222 | **118,109** |
| traces to a rejection | CancelRequest | 22 | 22 | 9,769 |

**656 of 1,457 refunds (45.0%), worth AED 411,981 (50.9%), have no rejection anywhere for that maid.**
On the cancel leg it is **223 of 245 — 91%**.

This is a bigger problem for check B than the missing dates were, because it attacks the
denominator. If half of all refunds happen without a detectable rejection, then a "rejections that
were never refunded" figure is computed against a population that is missing most of itself, and the
loss number is not interpretable. **B1's output must not be quoted until this resolves.**

Two candidate explanations, and they have opposite consequences:

1. **The rejection-history floor.** Orphan NewRequest refunds start **2024-04-02**; rejection
   change-events do not reach back that far. If the orphans sit mostly before the floor, the
   rejection set is sound and check B simply scopes to the post-floor window. → **B4 measures this.**
2. **Rejection detection is genuinely incomplete** — the approval field is not where rejection
   reliably lands. → **B5 tests this with the task signal, which has no floor.**

⚠️ **A third reading threatens a ruling we already made, and it has to be said out loud.** We
concluded from GDRFA that the refund entitlement is scoped to **rejection**, that cancellation is a
separate non-refundable service, and on that basis moved **AED 3.45m from "recoverable" to "cost"**
(F0c). But 245 refunds are booked on the **CancelRequest** leg, and 223 of them have no rejection at
all. Either those cancellations followed a rejection we cannot see — which is explanation 2 — or
**cancellation is refundable in practice and the AED 3.45m reclassification was wrong.** B4 and B5
distinguish these. Until they run, F0c is **provisional, not settled.**

### B1 — failed to compile, fixed

`Unsupported subquery type cannot be evaluated`. Snowflake will not run a correlated scalar subquery
whose predicate is an inequality plus an `OR`. Rewritten as a non-equi `LEFT JOIN` + `MIN`, which it
does support. The pairing logic is unchanged.
