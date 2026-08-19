# ERP's price matrix vs the price card — mapped, 2026-08-19

Reachable, complete, and it does **not** say quite what the card says.

Probe: n8n workflow `0oB2SX1nN2D3nyIE`, execution 93413.
`GET /sales/paymenttermconfig/getconfigs?page=N&size=200`, pagecode
`salesPaymentTermsConfig`, 7 pages → **1026 of 1026 rows, 0 duplicates, page 6
empty**. No completeness problems.

## Correction: the route was never closed, I had the path wrong

Earlier I recorded `/paymenttermconfig/*` as "refused at the edge, not a
permission problem, cannot be built on". **Wrong.** The real path carries the
module prefix — `/sales/paymenttermconfig/...` — exactly like every other ERP
call this check makes (`/clientmgmt/...`, `/admin/...`). I took ask-the-code's
`@RequestMapping("/paymenttermconfig")` literally and never added the prefix, so
the 403 from `awselb/2.0` was a path that does not exist, not a wall.

Two other self-inflicted wrong turns on the way, both worth remembering:

- **`size=500` is a SHORT READ.** `totalElements` is 1026 and the page caps at
  500. The first attempt silently analysed half the matrix and reported every
  cohort as "unmapped".
- **`contractProspectType` serialises its LABEL, not its code.** The label is
  `Maids.cc`; a case-sensitive match on `"maids.cc"` dropped 329 of 500 rows.
  Match on `code` (`maids.cc_prospect`), and note the MV variant's label is
  `maids.cc/VisaServices` — it starts with "maids.cc" and must be excluded.

## The mapping rule that works

```
contractProspectType.code = "maids.cc_prospect"     (exclude maidvisa.ae_prospect,
                                                     whose LABEL also starts "maids.cc")
isDefault = true  AND  disabled = false
packageType = NORMAL_LONG_TERM
live-out  =  type = LIVE_OUT
live-in   =  type = LONG_TERM
```

Everything else in ERP is a different product and must not be compared against
this card: `SHORT_TERM`, `INSIDE_COUNTRY`, `OUTSIDE_COUNTRY`,
`RESIDENCY_VISA_RENEWAL`, `SWITCH_FROM_CC_TO_MV`, `SWITCH_FROM_MV_TO_MV`, and the
`TEMPORARY_PACKAGE` / `PROBATION_PACKAGE` / `RENEWAL` package variants.

`monthlyPaymentWithoutVat` is **not** returned by this route, so the figures are
the VAT-inclusive ones. That is the right side to compare on, and the agreement
below confirms it.

## Four cohorts agree

| Cohort | Card (inc VAT) | ERP | Delta |
|---|---|---|---|
| livein:Filipina | 4,714.50 | 4,715 | +0.50 |
| livein:Other | 3,129.00 | 3,129 | 0 |
| liveout:Filipina | 5,712.00 | 5,712 | 0 |
| liveout:Other | 4,126.50 | 4,127 | +0.50 |

The half-dirham gaps are the VAT rounding the card's own `Traps` field predicts,
and are exactly why the tolerance is absolute rather than a percentage.

## One cohort differs — livein:Ethiopian, by 210

Card **3,129.00**. ERP **2,919** (two rows, ids 3 and 44440, both default and
enabled, agreeing with each other).

**NOT reported as a finding, because two readings fit and they mean opposite
things:**

1. ERP holds `Ethiopian / LONG_TERM / RENEWAL` at **exactly 3,129** — the card's
   number. The card may be tracking the renewal price rather than the
   new-contract price for this cohort.
2. The config may have moved from 3,129 to 2,919 *after* the spec's 2026-08-14
   measurement, which recorded the Ethiopian modal stored rate as 3,129 and
   matched the card exactly. That would be a genuine card-staleness event.

`getconfigs` returns no last-modified field, so nothing here separates them.
**Needs a human who knows the pricing history.**

## The bigger finding: the card's nationality buckets are an approximation

ERP prices **per nationality**. The card collapses everything except Filipina and
Ethiopian into one `Other` price. Those two models do not agree, and the
disagreement has a direction.

Live-in, within the card's single `Other` = 3,129:

| ERP price | Nationalities |
|---|---|
| 3,129 | Kenyan, Ghanaian, Nigerian, Ugandan, Congolese, Togolese, Ivorian, Sierra Leonean, Zimbabwean, Nigerien, Gambian, Liberian, South African, Tanzanian, Rwandan, Malagasy, Lesotho, Cameroonian |
| 3,234 | Malawian |
| 3,675 | Indian |
| 4,190 | Nepali |
| 4,715 | Indonesian, Sri Lankan |
| 2,100 | Cameroonian *(a second, conflicting row — see below)* |

Live-out, within `Other` = 4,127: Ethiopian **4,232**, Indian **4,673**,
Malawian **4,547**, Nepali **5,187**, Sri Lankan and Indonesian **5,712**.

### What that does to the check

- Where ERP prices a nationality **ABOVE** the card's Other rate (Indian, Nepali,
  Indonesian, Sri Lankan, Malawian): a contract sitting at 3,129 passes the card
  test while being below ERP's own published price. **Missed findings** — the
  check clears something it should question.
- Where ERP prices **BELOW** (Cameroonian at 2,100): a correctly-priced contract
  is flagged. **False reds.**

Neither is visible while the card is the only yardstick, which is the strongest
argument yet for reading ERP alongside it.

## ERP data-quality issue, reportable on its own

**Cameroonian has two enabled default live-in configs**: id 19 at **3,129** and
id 79057 at **2,100**. `findSuitableConfig` filters on `isDefault`/`disabled` and
returns a single row, so which of the two a new Cameroonian contract gets is
undefined. Worth raising with whoever owns Sales pricing regardless of this audit.

## What to build

The cross-check, per the 2026-08-19 decision, now has more to do than staleness:

1. Read the matrix with the mapping rule above, paged, with the row count
   asserted against `totalElements`.
2. Compare each of the five cohorts' current card window against ERP; abort the
   run on a mismatch outside 3.00 rather than auditing against a stale card.
3. **Report per-nationality divergence separately** — the nationalities whose ERP
   price differs from their card bucket, and in which direction. This is not an
   abort condition; it is a standing declaration of where the check
   under-reports and where it over-reports.

Access: this works on a colleague's token and returns `INSUFFICIENT_PERMISSIONS`
for Hassan.Ahmed. `salesPaymentTermsConfig` belongs in the same access request as
`getactivecccontracts`.
