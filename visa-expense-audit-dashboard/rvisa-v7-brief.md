# Prompt — R-visa spec v7: close the two legs the flowchart asks for

*Paste this to the agent that produced `Rvisa_Duplicate_Payments_v6`.*

---

Produce **v7** of the R-visa spec. v6 answers one of the three checks the flowchart asks of
the R-visa node. Two are open, and one of them is now unblocked by a table another spec found
this week.

## 1. Add a §9 source-coverage section, and run it first

`Visa_Process_Audit_Flow.pdf` names three checks at the R-visa node. Put them in a table with
their status and where each one lives, in the PDF's own words:

| The check, in the PDF's own words | v6 status |
| --- | --- |
| *"Ensure no duplicate payments for the same maid."* | BUILT — T1, and pair bucket A |
| *"Confirm the 1-year or 2-year option matches the contract and the visa validity."* | **PARTIAL** — §3.8, 25 pairs held AMBER |
| *"If fines apply, check who is responsible for repayment."* | **PARTIAL** — §2.6 defines the finding, no rule exists |

**Do this before anything else, and do not take my word for the three rows — read the PDF.**
Two sibling specs ran this comparison for the first time this week and **both found checks they
had never specced**: LAWP v4 found two of Phase 1's five missing (its v1 had cited the PDF but
taken its requirements from a Google Doc instead), and E-ID v2 found one missing *after being
gated twice*. E-ID's own note on how it happened is worth reading — the phrase "2-year validity"
had been read during an earlier era and spent on a different question, so the flowchart's own
check was never separated out as its own rule. **A missing rule leaves no hole to find**, which is
why every gate this workspace runs had passed over it. Assume the same failure mode is present
here until the comparison proves otherwise.

## 2. The term check is unblocked — the table exists and is named

§3.8 says a build-time measurement is required: *"the visa validity actually issued, per case, to
separate 'we overpaid by 100' from 'the visa was cancelled early'"*, and holds the 25 pairs AMBER
with reason `term-mismatch-unverified` until it is read.

**That measurement is now possible.** E-ID v2 §3.4d needed the same fact and found it:

- **`BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION`** — `MAID_ID`, `R_VISA_ISSUANCE_DATE`,
  `R_VISA_EXPIRY_DATE`.
- The term is **`EXPIRY − ISSUANCE`**. **There is no stored 1-year/2-year field anywhere in the
  warehouse** — E-ID looked. Band at 400 days.
- Measured 2026-09-14 over 306,267 maids carrying both dates: 1 year (201–400 days) **1,782**
  maids, 108 issued since 2025-09-01 · 401–600 days **628** · 2 years (601–800) **269,230** ·
  over 800 **34,285** · under 200 **94** · negative **248**.
- **The one-year residence visa is 0.6% of all history and 0.2% of the current era.** Size your
  expectations against that before you measure: whatever this finds will be small.

**Two traps E-ID hit, which will silently break the same join here:**

1. **The table is one row per REQUEST, not per maid.** Joining without deduplicating fans out
   roughly 5–20× — the same query returned 1,682 charges for 82 maids before the dedupe and 95
   after. Reduce to **one term per maid first** (latest issuance, then latest expiry), exactly as
   §3.4 of the E-ID spec does for the loan table and as you already do elsewhere.
2. **The dates are NULL on 94,445 rows and negative on 248.** A maid with no term is **not a
   finding and not clean** — she is unreadable and belongs in the grey bucket, never silently
   dropped.

**What to produce.** Convert S2 from `term-mismatch-unverified` AMBER into a decided class:
for each of the 25 pairs, the term actually issued, and therefore whether the first payment bought
two years and got one, or the visa was cut short. Report the split. Keep anything the dates cannot
answer in grey.

🔴 **And before you price it, read what E-ID concluded, because it may apply here too.** E-ID
measured the median E-ID charge at **AED 353.91 on a one-year visa and AED 353.91 on a two-year
one** — the price does not track the term at all — so it made M8 **a COUNT and refused to put a
money figure on it**, on the ground that naming a cheaper one-year price would be inventing a
constant. R-visa is different: you have a **documented** 1-year tier at **343.50** from two company
sources, and a 100-dirham term step. So you probably *can* price it. **But prove the tier is what
the authority actually charges for a one-year visa before you do** — `343.50` has 90 payments
against 443.50's 44,100, and `293.50` is in your schedule on inference alone (§6.13). If the
evidence does not hold, follow E-ID: report the count, price nothing, and route it.

## 3. The fine-responsibility leg has a finding and no rule

§2.6 does the hard thinking and stops short. It establishes:

- Alert 931's own threshold sheet marks R-visa **"May include Fines? = FALSE"** — only E-ID is TRUE.
  So an above-tariff R-visa payment is **an overspend to be explained, not a fine to be accepted**.
- The real R-visa fine is the **Modification** charge — heads `1622` / `1649` / `1735`, at
  **143.50 or 243.50** — the cost of re-submitting data we typed wrong. `143.50 mod 50 = 43.50`, so
  **a 50-step residue test cannot see it**, and conversely any 50-step residue found on an R-visa
  payment is overstay arithmetic belonging to the overstay audits.
- Alert 970's loan-mapping table of 17 expense types that must become a maid loan **contains no
  R-visa item at all**, modification included. So the company shouldering an R-visa fine is the
  **expected** state, not a finding.
- ➡️ The finding is therefore **"a fine was paid and nobody assessed whose fault it was"**, never
  "no loan exists" — a rule written the second way reds every case.

**None of that is a rule, a metric, or a measurement in v6.** Build it:

- A test with a RED / GREEN / BLOCKED / NOT_APPLICABLE contract like T1–T9, in the same verdict
  algebra, scoped like the others.
- Its own metric, at the modification heads, priced at 143.50 / 243.50 and **scored as a
  document-error cost, never against the residence fee**.
- A measurement. ⚠️ §0.5 **withdrew** v5's fine-sizing figures (AED 152,850 across 195 payments)
  because they were computed through `IS_DELETED = FALSE`, a predicate that matches zero rows.
  Those numbers are void and have never been restated. Re-measure from scratch.
- Name who assesses fault, and what a red row asks that person to do. The E-ID node is the only
  one in the flowchart with an explicit fault rule — *"if the EID was lost and a replacement
  requested, confirm whose fault it is; if the maid's, charge it to her loan"* — and **no
  equivalent is written for R-visa.** If the answer is that nobody owns it, say so as the finding.

## 4. Two constants that must not repeat DNA-9529

`DNA-9529` — the AE ticket built from an earlier version of this spec — was **withdrawn by Hassan
Okasha on 2026-09-06**, hours after the DNA intake bot graded it *Ready*. His two reasons:

> *"1. It was raised prematurely, before the requesting team had signed off the spec it is built
> from. 2. A subsequent check against the ERP code contradicted one of the constants it quotes.
> This ticket assumes a 60-day grace period before overstay begins. The ERP has no flat 60-day
> grace: it reads `PARAMETERS.CODE = 'tourist_visa_grace_period'` (seed default 0) or
> `'employment_visa_grace_period'` (seed default 30), selected by
> `NEWREQUEST.TYPE_OF_PREVIOUS_VISA`. The AED 50/day rate is likewise a configurable parameter
> (`fine_for_tourist_visa` / `fine_for_employment_visa`), not a constant."*

v6 §2.6 already moves the overstay question off this node, which addresses the substance. But
**`FINE_STEP = 50` is still in R-FEE-SCHEDULE**, still marked *assumed*, and it is the entire
tolerance of the fee match — widen it and fines become fees, narrow it and every fine-bearing
payment falls to T3. Either:

- read the real parameter (`fine_for_employment_visa`) and cite it, or
- state plainly that the step is a **fee-matching tolerance**, not an overstay rate, and that no
  claim about overstay pricing is made on this node.

Do the same for **`293.50`**, which §6.13 admits is inference with no document behind it.

**Ask the code, do not reason from the data's shape.** The ERP is the only source of truth for how
a fee is priced and charged; a pattern in the ledger is corroboration, never a tariff.

## 5. Also close, or explicitly carry with a size

- **The 981 orphan transactions** — R-visa heads with no visa line at all, 1.4% of the population
  and ten times the finding set, examined by **no test**. §1 says this needs *either* a proximity
  screen (same maid, same head, ±90 days, hits published) *or* an explicit out-of-coverage
  statement. Neither exists. Pick one and build it.
- **`VISA_REQUEST_ID` is not unique** — cancel requests run a colliding id sequence, so every
  request-keyed read merges two unrelated people. v6 states it; make sure T8 and the classifier
  both actually enforce it, and that nothing else in the spec keys on request id alone.
- **R-VISA-PURPOSES is verified against a warehouse view only** (`MISSING_EXPENSES`, coverage
  starts 2025-06-01). A third purpose the "Apply for R-visa" task can emit, or one retired before
  that cutoff, is invisible to both the population and its own guard. Confirm against the ERP enum.
- **N1 and N2** keep T4 and T6 BLOCKED. Say what each is worth in cases and AED so the ingestion
  ask can be prioritised rather than just listed.
- **§6 decisions** — the spec's own status line says *"Draft — decisions in §6 outstanding."* v7
  should either carry them as rulings or name who owes each one and by when.

## 6. What done looks like

1. §9 exists, every row reads BUILT or names a ruling, and anything the comparison turned up that
   is not in the three rows above is written up rather than absorbed.
2. S2 is a decided class with a measurement behind it, or it is a count that is explicitly refused
   a price with the reason given.
3. Fine responsibility is a test, a metric and a measured number.
4. Every constant in R-FEE-SCHEDULE and THRESHOLDS either cites a source or is labelled as an
   internal tolerance that makes no claim about the authority's pricing.
5. The status line no longer says "decisions outstanding".

Then the corrected DNA pair Hassan Okasha said would follow can actually be raised.

**Two standing rules.** Never invent a table, column or constant — a name enters the spec only from
a schema result, from Ask the Code, or from a person, and anything else is labelled
`UNVERIFIED — to confirm`. And prefer the test that can only under-count: a conservative floor is
publishable, an estimate that might be too high is not, because a retracted number damages the next
twenty that are correct.
