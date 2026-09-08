# Audit run — August 2026

**Run 2026-09-08 · adjudicated by the AI Agent · 899 notes · AED 426,377 · logic only**

This run tests **whether each payment followed the rule for its payment type**. Segregation of duties
and attribution are out of scope. Nothing returns GREEN: T4, T5 and T7 are blocked, so a note that
survives every runnable rule is AMBER, not cleared.

| Class | Notes | % | AED |
|---|---:|---:|---:|
| No runnable rule failed (blocked tests outstanding) | 590 | 65.6% | 394,373 |
| BLOCKED — duplicate rule needs an entitlement window | 144 | 16.0% | 12,164 |
| Zero amount | 120 | 13.3% | 0 |
| Duplicate candidate | 41 | 4.6% | 18,590 |
| **RED — no payment type recorded** | **4** | 0.4% | **1,250** |

⚠️ **Anti-attrition contributed 17 notes, not its usual ~760** — its August batch ran 2026-09-01.
The largest payment type is effectively absent from this month.

---

## 🔴 Finding 1 — three salary-dispute notes whose own numbers do not hold

The AI Agent re-added every itemised calculation the reviewers wrote into the free text. **Nine of
twelve reconcile to within one fils.** Three do not, and each fails differently.

**Note 185667 · maid 127702 · AED 347.35 — the reviewer's own figures contradict their own answer.**
> *"Generated salary for July: AED 0 · Correct salary: AED 541 · Difference to be added: AED 347.35"*

**541 − 0 = 541, not 347.35.** A gap of **AED 193.65** with nothing in the note to explain it. Either
a deduction was applied and not written down, or the amount is wrong. **This is the finding of the
month: it needs no data we do not have, and no judgement — the note refutes itself.**

**Note 185497 · maid 90545 · AED 55.00 — the note disagrees with its own expense line.**
Its text carries `/64.50/AED/` while the note pays **55.00**. A gap of **AED 9.50**. The same maid
also received AED 139 on the same day under the same payment type *(note 185722)*.

**Note 185724 · maid 137097 · AED 0.00 — a zero-value note recording a real AED 1,419 entitlement.**
The text works the figure correctly (`2000/31 × 22 days`), then ends: *"Amount is paid manually"*.
🔴 **So a zero-amount note can conceal a real payment made outside the note system entirely.** That
changes what a zero means: not a placeholder, but a payment this audit cannot see. Every zero-amount
note in the month now needs re-reading with that possibility in mind.

### Two the reviewers left unshowable

**186123 · AED 184** — a URL and nothing else. **185685 · AED 387** — a sentence, no working; it
reconciles to `2000/31 × 6 days` but only because the AI Agent inferred the formula. *"The reviewer
did not show their work"* is the reportable category, and these are it.

### Three worth a human's eye, none of them an error

- **186148** corrects **May's** salary in an **August** note — a retroactive change to a closed period.
- **185722** states its reason plainly: *"Resolvers requested to pay full amount even on her SL days
  as client is escalating."* A deliberate policy override, correctly computed. It should be visible
  as a decision, not buried as arithmetic.
- **185721** says *"July 11 already forgiven through forgiveness page ~ AED 103"*. **That is the E4
  cross-check, live**: a Forgive Deduction note for maid 29850 covering July 11 at AED 103 must exist.
  If it does not, the day was deducted twice.

---

## 🔴 Finding 2 — the airfare zeros are an August incident, not a trend

| | Zero-amount airfare |
|---|---|
| Baseline, 12 months excluding August | **49 of 1,298 — 3.8%** |
| **August 2026** | **78 of 163 — 47.9%, thirteen times the baseline** |
| September (partial) | 5 of 96 — 5.2%, back to normal |

**This is a bounded event, which is far more actionable than a trend.** Roughly **72 excess notes**,
all of them unattributed, spread across **9 distinct days** — so not one bad batch run, but something
that ran repeatedly through August and stopped. It has a start, an end, and a shape.

Read alongside note 185724, the question sharpens: are these placeholders, or are they payments made
manually with a zero-value note left behind? **Those are opposite answers and only one of them is
harmless.**

### The same query settled the future-dating question

Airfare notes dated 2026-10 through 2028-06 carry **almost no zeros**, and their volume decays
smoothly — 32, 16, 13, 11, 9, 8, 5, 4, 3, 1. **That is a booking forward-curve.** It supports the
reading that an airfare `NOTE_DATE` is the **travel date**, and it means those notes are real
bookings with real amounts, not defects. The audit-month rule must handle them per payment type.

---

## 🔴 Finding 3 — the four unclassified notes are overstay fines

All four carry the expense category in their own text: `Ex168153/Overstay Fines/…`, and all four were
raised in the last five days of August.

**So this is not a mystery, it is an unmapped category.** The expense side knows what they are; the
note side has no payment type for them. **AED 1,250, four notes, and a fix that is a mapping row
rather than an investigation.**

---

## ⚠️ What this run deliberately does not claim

**144 notes are BLOCKED, not cleared.** The previous run reported 84 `Forgive Deduction` and 37
`Prorated salary` notes as duplicate candidates. They are not: several forgiven days or several
prorated entries in one month is normal on both. The rule needed an entitlement window per payment
type, so it now returns BLOCKED for those two rather than a false queue. **The real duplicate queue is
41 notes, not 154.**

**590 notes passed every rule that can currently run.** That is not a pass. T4, T5 and T7 are blocked
on the expense grant and the three reference lists, so AED 394,373 — 92% of the month's money — has
not actually been examined against a rule. **The honest headline for August is that the audit
examined 8% of the money.**

---

## The queue, in order

1. **185667** — AED 347.35 salary dispute whose own figures give 541. No judgement needed.
2. **185724** — AED 0 note carrying a real AED 1,419 payment made manually. Then re-read all 120 zeros.
3. **185497** — note pays 55.00 against its own 64.50 expense line.
4. **4 notes** — overstay fines with no payment type. A mapping fix.
5. **78 notes** — August's airfare zeros. Bounded, dated, and worth a root cause.
6. **185721** — confirm the AED 103 forgive-deduction note exists for July 11.
7. **41 notes** — genuine duplicate candidates.

---

# Corroboration pass — adjudicated

Run on complaint **taxonomy and dates only**. No complaint text was read, and none needs to be for
this verdict.

## 🔴 The chance baseline changed three of the four answers

| Type | Band 1 of matched | *k* | Chance | **Lift** |
|---|---:|---:|---:|---:|
| Accommodation Relocation | 97% | 1.37 | 36.9% | **2.63×** |
| Salary Dispute | 96% | 1.63 | 42.3% | **2.27×** |
| Medical Assistance | 100% | 2.30 | 53.9% | 1.86× *(n=10)* |
| **Taxi Reimbursement** | **89%** | **5.33** | **83.4%** | **1.06×** |

**Taxi has the highest raw coupling rate and the weakest real signal.** Maids average **5.3**
transport complaints in the window — `Taxi canceled` alone is a 9,490-complaint type — so one sits
near the payment by chance 83% of the time. Unadjusted, a dashboard would read *"89% of taxi
reimbursements corroborated"*. Adjusted, timing carries almost nothing. **For taxi, presence proves
nothing; only absence is informative.**

**Salary Dispute came in at 2.27× against the twelve-month benchmark of 2.33×.** The corroboration
model reproduced itself on an independent month, which is the strongest evidence so far that this
check is measuring something real.

## 🔴 The map is wrong, and reading the cases is what found it

Three complaint types appear in band 3 that plainly belong to the payment they sit under:

| Complaint type seen | Should be expected for |
|---|---|
| `Switch Maid To Live-in` | Accommodation Relocation — the map has only *Live-out* |
| `Renewal/Resignation Salary Raise` | Salary Dispute |
| `Request bank details & Refund` | Salary Dispute |

**Band 3 is therefore overstated.** Some of these 33 notes are corroborated by a complaint type the
map does not list. Fix the map before any of this reaches an auditor, or the report opens cases that
the evidence already answers.

## The cases, worst first

**🔴 Maid 97219 — two Medical Assistance payments, AED 900, three days apart, and not one complaint
of any kind on her record.** Notes 186154 (AED 400, 08-28) and 186214 (AED 500, 08-31). Medical
Assistance is the type where half of all payments carry `Maid is sick or injured` at 6.4× lift. This
maid has nothing at all — no sickness, no appointment, no complaint. **She is also a duplicate
candidate on the same pair.** Two independent checks fire on one maid: the strongest case in the
month.

**🔴 Note 185544 — Salary Dispute, maid 129946, AED 1,200, zero complaints.** The largest
uncorroborated salary dispute, on a type that clears chance at 2.27×.

**🔴 Note 186123 — Salary Dispute, maid 108732, AED 184 — fails two checks.** Its free text is a URL
and nothing else *(no working shown)*, and the maid has **24 complaints in the window, none about
salary**. Small money, but it is the clearest example of a payment with neither an explanation nor a
corroborating record.

**Accommodation Relocation is a flat AED 800** — six of six non-zero notes. That makes a ceiling check
available immediately, with no ingestion needed. **Four of the seven band-3 cases carry
resignation-family complaints** (`Maid Wants To Resign`, `does not want to work with client`) rather
than accommodation ones — which raises a question the audit was not designed to ask: *are maids being
relocated as a retention measure?* If so the payment is real and the map is simply pointing at the
wrong evidence.

**Two more zero-amount notes**, in types nobody was looking at: 185767 (Accommodation, AED 0, on a
maid with 27 complaints) and 185522 (Salary Dispute, AED 0). Together with August's 78 airfare zeros
and note 185724's *"paid manually"*, zero-value notes are now a pattern across four payment types,
not an airfare quirk.

**Taxi's eleven are reported but not pursued** — at 1.06× the type cannot support an absence finding
this month. Worth one observation: **six of the eleven carry `Maid cash advance`**, which may be the
same journey recorded under a different heading.
