# The 231 "no_nationality" contracts — what they actually are, and the fix

**2026-08-19.** The July run left 231 in-scope contracts unscoreable with
`reason_code = no_nationality`. This is the investigation that closed them.

## The premise I gave LCP was wrong

I asked LCP for "every way to obtain a maid's nationality for a CC contract that
has a maid but whose nationality is null". LCP answered that question well, and
led with: read `getNationality().getCode()` instead of `.getName()`, because a
picklist row with a blank `name` yields null even when the FK is present.

That fix would have changed nothing here, because the premise was false. Pulling
the entire live population (5,401 rows, 12 paged calls, 3 s apart):

| | count |
|---|---|
| rows with a blank `maidNationality` | 292 |
| …of those, rows that also have a blank `maidId` | **292** |
| …of those, rows with a maid attached and a null nationality FK | **0** |
| blank-nationality **and** in scope for 2026-07 | **231** |

Every one is LCP's cause #1 — no maid attached to the contract — not cause #2.
There is no picklist to read a code off. `blank maidLiveOut` tracks it exactly:
37 of 37 on page 0, which is the same set.

This is the general lesson, now written into the skill: **an answer is only as
good as the premise in the question.** Test the premise before acting on the
answer.

## What does answer for them

`ContractPaymentTerm` carries its own `HOUSEMAID_ID`, and keeps it after the maid
leaves the contract. So the active term still knows the nationality the contract
was **priced for** — which, for a pricing audit, is the more defensible key than
whichever maid happens to be standing in the house today.

**`GET /accounting/directDebit/getActiveCptInfo/{contractId}`**, pagecode
`ClientMgmtClientDirectDebits`, returns 200 on the audit account. Probed on three
maid-less in-scope contracts, all three returned a nationality.

### Verifying LCP's semantics rather than trusting them

LCP said the field is `cpt.getHousemaid().getNationality().getName()` — the
maid's name string, not the term's own `nationality` FK. That contradicted a note
in `stage2-design.md` claiming `cptName` "provably contains" the nationality, so
both were tested against 14 contracts that DO have a maid:

| | result |
|---|---|
| `getActiveCptInfo.nationality` vs the dynamic API's `maidNationality` | **agreed 14 / 14** |
| `cptName` contains the nationality | **false** — contract 1099770 reads nationality `Ethiopian` under cptName `CC - Default - Kenyan -OMG` |

LCP was right; the repo note was wrong and has been corrected. This is why the
rule is *verify*, not *trust* and not *distrust*.

## The resolution order

`resolveNationality()` in `scorer-month.js`, covered by assertions:

1. **`maid_nationality`** from the population — the live maid always wins.
2. **`cpt_nationality`** from the active term — only when there is no live maid.
3. neither → still `no_nationality`, still a pending. **Never a default bucket**:
   `Other` is the cheapest live-in cohort and defaulting to it would clear real
   under-pricing at scale.

Every case records `nationality_source`, and a term-sourced case carries the flag
`nationality_from_payment_term` so a reviewer knows which of the two they are
reading.

## Side effects worth keeping

The same call also returns, per contract:

- `type` — `Live Out` vs `Long Term`, an **independent** read of the living axis
  that today comes only from the population row.
- `cptPaymentTypes[].amount` — ERP's own monthly figure. On the samples it was
  4301 / 4715 (Filipina live-in), 3129 (Ethiopian live-in), 5299 / 5712 (Filipina
  live-out) — the card's own numbers, which is the first per-contract corroboration
  of the Google-Sheet card we have had.
- `cptPaymentTypes[].type.code` — `monthly_payment` on all samples. This is the
  same field that would read `upgrading_nationality` on a switch charge.

`amount: 3129` for Ethiopian live-in is also evidence on the open Ethiopian card
question: the live term says 3129, matching the card, not the 2919 sitting in the
ERP price matrix.
