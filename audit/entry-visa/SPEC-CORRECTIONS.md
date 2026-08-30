# Entry Visa Audit — corrections to the spec

Filed against **Notion "Entry Visa Audit" v0.7** (page `3c2fe1c78bf081fca555c4eab7b179bc`),
its 17 rule rows, and its 12 ERP Variables rows.

Everything here was found **without ERP access**, by reading the spec against itself and
by implementing it. Anything needing a live payload is marked *unresolved — needs the probe*.

---

## 1. The check page links to the wrong rules database — **fix the link**

The page says *"Seventeen rows in [Audit Conditional Policy — CC Maid]"*.

The rows are not there. All 17 live in **Audit Conditional Policy — Both Maids**
(`collection://54b89191-424d-47ae-ba22-898936b2f207`). A SQL query against the CC Maid
data source filtered to `Check = 'Entry Visa Audit'` returns **zero rows**, even though
that database's schema does list `Entry Visa Audit` as a valid `Check` option — so the
link fails in the way that looks like "this check has no rules yet" rather than like a
broken link.

Consistent with the page's own `Category` of `Both Maids`. The `CC Maid` category on the
ERP Variables rows is Jacky's deliberate call of 2026-08-20 (open ruling 5) and is a
separate thing; it is the *rules* link that is wrong.

**Evidence:** every rule page's `<ancestor-path>` names the Both Maids data source.

---

## 2. The call budget omits gate 13 entirely — **and this changes the architecture**

The page states, per monthly run:

> 0 paged calls on that endpoint (retired 2026-08-20), plus ≈ 60 ID-scoped calls to
> `GET /visa/newRequest/{id}` for the rejected requests in the window, plus ≈ 250 calls to
> `GET /accounting/transactions/{id}` to date the lines. **Total ≈ 310 calls.**

That figure covers **the refund family only**. Gate 1 also declares a second, wider scope:

> The **duplicate family** (⓭) runs on **every** entry-visa charge with a transaction,
> rejected or not.

and then claims:

> The wider scope costs no extra ERP calls: the duplicate scan reads the charge list this
> gate already pulls and never touches the rejection history.

**That claim is false as written, and true only under an unstated architecture.**

The charge list "this gate already pulls" is the one assembled from ~60 `GET /visa/newRequest/{id}`
calls — and those 60 are *the rejected requests*. Charges on never-rejected requests are
not in it. So a gate 13 fed from the ERP charge list can only see the charges of rejected
requests, which is **exactly the dead-code condition gate 1 was written to fix** (it hid
134 of 176 duplicate-shaped pairs worth AED 92,247.32).

Sizing the honest ERP alternative: `ENTRY_VSIA` alone has 56,542 rows behind it. Fetching
every request carrying an entry-visa charge in a month is on the order of **thousands** of
ID-scoped calls, not sixty — one to two orders of magnitude above the 500-call run budget,
at 2.0 s pacing, sequential. It is not a slower run; it is not a runnable one.

**The claim is true only if gate 13 is scored on warehouse data rather than ERP data.**
That is almost certainly what was meant — every population count on the page is
Snowflake-derived — but it is nowhere stated, and it matters:

- It makes the check **two-sourced by necessity**, not by convenience: the warehouse
  supplies the population list *and* gate 13's whole scope; ERP supplies per-charge-cycle
  detail for the refund family.
- It promotes **open ruling 7** from a convention question ("is a warehouse read allowed
  here?") to **load-bearing architecture**. If the ruling goes against the warehouse,
  gate 13 has no data source at all and must be dropped or re-scoped — a AED 4,002.50
  finding family disappears.
- Gate 13 scored on the warehouse must use the **warehouse vocabulary** (`ENTRY_VSIA`,
  the typo, and `ENTRY_VISA_LESS_THAN_1000`) while the refund family scored on ERP must
  use the **API's human labels** (`Entry Visa > 1000 AED`). The two vocabularies do not
  overlap; a filter written for one returns zero rows against the other. The scorer
  accepts both and records which one a row arrived in.

**Recommended edit:** replace the budget paragraph with a per-family breakdown, and state
the two data sources explicitly rather than leaving them implied by a cost claim.

---

## 3. The ≈250 transaction calls may not be possible at all — *unresolved, needs the probe*

The budget's second line assumes the flow can walk from an expense line to its transaction:

> ≈ 250 calls to `GET /accounting/transactions/{id}` to date the lines

But the `visa_expense_transaction_id` variable row records:

> the two live payloads read on 2026-08-20 did **not** expose a `transactionId` key on the
> embedded expense rows — only `id`, `purpose`, `status`, `amount`, `charge` and
> `paymentDate`. Whether the id is present under another name on this route is **UNVERIFIED**;
> the warehouse mirror does carry `TRANSACTION_ID`.

If that key is genuinely absent from `GET /visa/newRequest/{id}`, then from ERP alone:

- there is **no transaction id**, so the ≈250 calls have no ids to call with;
- there is **no clock**, because `transaction_date` is reached *through* the transaction id
  and the expense line's own `paymentDate` is NULL on 85.7% of charge rows;
- **gate 1's own population filter cannot be evaluated** — it requires
  `visa_expense_transaction_id is not null`, which is the proof money moved.

That is not a degradation. It would mean the entire refund family is warehouse-clocked and
ERP contributes only the rejection history and the request state. **This single unknown
decides the shape of the flow**, and it is the first thing the Phase 2 probe answers
(`transactionId_key_present` / `transactionId_populated_rows`, counted, never printed).

---

## 4. Gate 11 is blocked in a way that produces a false clearance — **declared deviation**

Gate 11's `Condition` reads:

> **BLOCKED, DO NOT EVALUATE**: which constant applies per charge cycle is not established
> … so this rule must not conclude until it is

Taken literally, a refund of an unexpected amount arriving inside the window falls straight
through to **gate 6 and is scored fully clean**. That is precisely the outcome gate 11's own
body says it exists to prevent:

> This gate exists because the alternative is silence: without it, a future short refund
> would fall through ❻ and read as fully clean.

The rule cannot both be forbidden from concluding *and* be the thing that stops a false
clearance. **Deviation taken, and it is the conservative one:** a mapped refund inside the
window whose magnitude is none of the three ever-observed values
(89.50 / 739.50 / 125.65) does **not** clear the case — it routes to the verifier. It is
never scored *as* a shortfall, because that conclusion is genuinely blocked.

Cost of the deviation: zero today. Across 564 refunds measured on two independent sources,
every one is exactly 89.50 or 739.50. The path exists so that the first one that is not
gets seen instead of cleared.

**Recommended edit:** re-word gate 11 as "route, do not value" rather than "do not evaluate".

---

## 5. Gate 14's valuation contradicts test case 7 as written — **resolved in favour of the test case**

Gate 14 says:

> **Never** value this finding at the refundable constant. The waste here is the whole first
> charge, not the unrecovered refund on it — and where that first charge WAS refunded, the
> loss is only the non-refundable remainder.

Two valuations in one paragraph, and the `Condition` field states neither. Test case 7
settles it: request 92147's wasted amount is **1,022.50 − 739.50 = AED 283.00**, matching
Khalil SOP §5.2's "≈283 lost" — so where the first charge *was* refunded, the figure is the
remainder, and only where it was not is it the whole charge.

Implemented that way; the scorer reproduces AED 283.00 independently. Each gate-14 case
carries `first_charge_was_refunded` and, when true, is tagged as depending on **open
ruling 1** — because on a *correctly* typed application that same remainder is an
unavoidable government cost, and the spec is explicit that it appears identically on both
(17 outside and 9 inside rows at exactly 286.15).

**Recommended edit:** put the two-branch valuation in gate 14's `Condition` field.

---

## 6. Gate 7's missing minimum-elapsed guard — **implemented as specified, reported not patched**

Not a correction; a confirmation. Gate 7 has no minimum-elapsed guard, so a request
abandoned one day after its rejection reds instantly. The spec logs this as a defect,
corrects test case 3's expected verdict to `finding`, and leaves the fix to the owner.

Built exactly that way. Every affected case carries
`evidence.premature_by_abandonment: true` and `defect: GATE-7-NO-MINIMUM-ELAPSED-GUARD`,
and the run summary carries a **count** of them under `declared_gaps` — so the inflation is
declared in the run rather than absorbed into the headline number.

---

## 7. Not a spec fault: the skill's own traps file is missing

`erp-audit-flow-builder/SKILL.md` opens with *"Read `references/erp-and-n8n-traps.md`
before Phase 1"*. That file does not exist — the synced skill directory contains only
`SKILL.md`, and no repository carrying it is reachable from this session
(`list_repos` returns empty; the `audit-flows/` tree holding `ERP-LOAD-POLICY.md`,
`tools/erp_breaker.js` and `dummy-tickets-hm/ENDPOINT-FINDING.md` is not attached).

Worked around by reconstructing the same knowledge from two places that *are* reachable:
the `Traps` column of the 12 ERP Variables rows, and the circuit-breaker block plus sticky
notes embedded verbatim in the golden sibling flow `YQlNlxrnhbQpBbdl`. That covers the
denial shapes, the misspelled `taskHistorys`, the `developerMessage` header-vs-text-scan
trap and the pacing rule. It may not cover everything the file holds.

**Worth fixing at the source**, since every future run of this skill hits the same gap.
