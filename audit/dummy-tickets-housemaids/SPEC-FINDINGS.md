# Dummy Tickets Submitted for Refund — Housemaids · build findings

Spec v0.4 draft (2026-08-17) · check_id `7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02`
Build session 2026-08-19. Golden: **CC Non Received Monthly Payments** (`Qq473Ygj543jxPUN`),
itself cloned from the Travel Assist golden (`LM7ofq89VWXiLRU0`).
Production flow under rebuild: **Applicant Dummy Ticket Refund Audit** (`FXrhGBJUnGYgrs9R`), ACTIVE.

---

## 0 · Blocker in the spec, now closed

The spec's red callout says the live n8n flow body *"could NOT be read… sits in an n8n project
Jacky's token cannot see… Ask Hassan or Malaz for access or an export."*

It was not a project-permission problem. Both flows were simply not exposed to MCP
(`availableInMCP: false`); there is no API operation to change it, so it needed one UI click.
Once toggled, both flow bodies and their execution history read normally.
**Action: update that callout — the two "open questions" it blames on unreadable code are answerable.**

---

## 1 · SECURITY — the production webhook is unauthenticated and can be told where to send the audit

Severity: **high, live now.** `FXrhGBJUnGYgrs9R` is `active: true` with an open `n8n-nodes-base.webhook`
whose `options` are empty. Its `Validate Inputs` node — unlike the golden's — performs **none** of the
three checks the golden added on 2026-08-06:

| Golden check | Present in dummy flow? | Consequence |
|---|---|---|
| `X-SR-Webhook-Secret` shared secret | **No** | Anyone who learns the URL can trigger a production audit run |
| `callback_url` origin allowlist + `/ta-callback/<64-hex>` path shape | **No** | **Exfiltration.** `callback_url` is taken verbatim and later POSTed the entire audit — applicant names, ticket amounts, card-holder names, per-case history. A caller names their own host and this flow couriers it there |
| `Bearer <token>` shape check | **No** | CR/LF in the token injects arbitrary headers into 4 authenticated ERP reads |

The golden's own comment calls the callback_url hole "the serious one" for exactly this reason, and
this check's Notion page marks it **Handles sensitive data = YES**.

This is not introduced by my rebuild — it is the current state of a running check. The rebuild adopts
the golden's validator verbatim, which closes all three. **Worth raising independently of this build,
because the exposure exists until the running flow is replaced or unpublished.**

---

## 2 · Corrections to the spec's ERP Variables rows

**2.1 — Auth needs ONE value from the operator, not two.**
The spec (and the build skill) ask for a bearer token *and* a numeric device id. Production derives the
device id from the token's own JWT `device` claim and only falls back to a supplied one:

```
deviceIdProduction = decodeJwtDevice(bearer).device || erp.device_id
authTokenProduction = erp.is_auth (if it starts 'eyJ') || bearer
```

So the ERP cookie header is fully derivable from the bearer token. Record the header set, which no
variable row currently states:
`authorization: <bearer>` · `pagecode: <per call>` · `cookie: deviceIdProduction=<jwt.device>; authTokenProduction=<jwt>`

**2.2 — Page size is 200, not 40.**
`dummy_ticket_expense_id` says *"The page envelope caps at size 40 — walk all 4 pages"*. Production
sends `size=200`. The measured 137-row window is therefore **1 page, not 4**. The page-walk discipline
still applies; the page count in the spec and in the call-volume callout does not.

**2.3 — Pagination completes on `last === true`.**
Production's completion expression is `$response.body.last === true`, capped at `maxRequests: 50`.
Note the golden warns that on a *different* endpoint `last: true` lies on page 0 of 3 — so the
`pulled == totalElements` assertion remains mandatory. It is **not implemented today** (see 3.2).

**2.4 — `currency` is read as `.name`, not `.label`.**
The `ticket_currency` row's *API Parameter Name* says `flightsTickets.requestFlightTicketActions[].currency.label`,
but its own *Example Values* show `"currency": {"name": "AED"}`, and production reads `name || label || code`.
Correct the row to name the actual key.

**2.5 — The call budget omits a whole per-case pass.**
The spec's ceiling callout counts *4 population pages + 137 detail + ~322 Hustler ≈ 460*. Production also
makes one **all-time transaction search per flagged applicant** (`Get All-Time Transactions (ERP)`,
`description like 'Applicant ID - <id>'`), which the budget does not mention. At the current 271-case
store that is up to +271 calls — the budget is understated by more than half, and it grows with the case
store exactly as the callout warns. Net of 2.2 the corrected figure is roughly **1 + 137 + 322 + flagged**.

---

## 3 · What the production flow actually does wrong

Measured by porting its `Classify Dummy Tickets` node verbatim and running the spec's own five test
cases through it (`prod-comparison.js`).

**3.1 — Gates 50, 90 and 100 do not exist in the flow at all.**
`requestRefundOn` and `requestRefundAutomaticallyType` are never read — `normalizeDummy` does not
extract them. Combined with `is_flagged = kind !== 'refunded'`, this publishes **five of the seven live
statuses as red flags**:

```
REFUNDED               -> silent pass
REFUND_FAILED          -> PUBLISHED RED   (correct)
REFUND_SENT_TO_PAYERS  -> PUBLISHED RED   (money in flight — should be pending)
PENDING_REFUND         -> PUBLISHED RED   (should be pending / not-yet-due)
ISSUED                 -> PUBLISHED RED   (should be pending / not-yet-due)
CANCELED               -> PUBLISHED RED   (should be parked by gate 90)
REQUESTED              -> PUBLISHED RED   (should be parked by gate 90)
```

This is the measured origin of the 89% noise, and it is the one spec test case production fails at the
portal level (TC4, applicant 1535511: spec wants `pending`, production publishes `red_flag`).

**3.2 — No completeness assertion.** `Flatten Transactions` never compares rows pulled against
`totalElements`. This is precisely the shape of the golden's incident — a truncated sweep reporting
SUCCESS and publishing false reds. The rebuild ports the golden's fail-closed GATE 2.

**3.3 — No retry before declaring an applicant unreadable.** Gate 30 says *"!= 200 after one retry"*.
The Hustler node has `retryOnFail: null`, so there is no retry, and `neverError: true` +
`continueRegularOutput` means a 500 yields a body with no tickets → `dummy.length === 0` →
`applicant_not_found` → **published as a red flag about a person**, which is the exact defect ❸ names.

**3.4 — Null amount collapses to zero, using the forbidden field.**
`amount: Number(t.amount) || 0`, and `toAed`'s AED branch returns `d.amount` when `amountInAED` is null.
That (a) destroys gate 90's null-vs-zero distinction and (b) substitutes the sibling `amount` field the
spec says never to substitute (differs on 72 of 88 money-bearing rows, up to ±0.45).

**3.5 — Case-level figures come from one ticket.** `rep_status`, `rep_amount`, `rep_currency` and
`amount_aed` are all the single `rep` ticket's. A case with two lost tickets reports one amount, so
exposure understates. (The `dummy_tickets[]` array is carried, so the siblings are not lost entirely.)

**3.6 — Pacing exceeds the golden's rail.** Golden: 5 concurrent / 500 ms, with the note *"bursts are
what got this ERP account disabled in June 2026."* Production dummy runs Hustler at 5/300 and the
transaction detail at **10/200**. The rebuild aligns both to 5/500.

### 3.7 — A spec claim that does not hold up

The spec states the one-ticket-decides defect (❹) as production behaviour, and makes applicant `1473519`
its proof: *"A check that reads one ticket per applicant can pick a refunded one and clear a real 4,773
loss… ❹ exists because of it."*

**Production already ranks worst-first.** Its `ORDER = {financial_loss:0, used_review:1, pending:2,
refunded:3}` map picks the worst ticket, and on both `1473519` and `1667497` it selects the
`REFUND_FAILED` / `Used` ticket correctly. Measured: production returns `financial_loss` on TC5.

So ❹ is a correct rule that production **already satisfies** at verdict level; what production gets wrong
is the *reporting* of it (3.5). The rule should stay — it is load-bearing for the rebuild — but the
"proof" should be re-worded, because as written it directs the next reader to fix a defect that is not
there while 3.1 (the real one) is described only as noise.

---

## 4 · Business logic: one contradiction, one undefined rule

**4.1 — Contradiction on an empty `requestRefundAutomaticallyType`.** Two spec statements disagree:

- `request_refund_automatically_type` (variable row) and gate **90**'s body both say empty ⇒ treat as
  `DoNotRequestRefund`, and gate 90 calls that default *"load-bearing, not a nicety"*.
- Gate **100**'s own analysis says the gate *could not fire* on cohort A because `requestRefundOn` was
  empty on every row — which is only true if empty does **not** count as `DoNotRequestRefund`.

Both readings cannot hold. Implemented the **conservative** one (empty ⇒ gate 100 can fire ⇒ red),
because it is the reading that avoids a false clearance *and* the only one under which the gate can ever
catch the AED 194,793 / 68 never-refunded tickets the spec says it exists to catch. The alternate reading
is available behind `ctx.empty_schedule_means_do_not_request = false` so its impact can be measured on a
live run before anyone rules. **Not blocking; flagged for Jacky.**

**4.2 — Undefined rule: gate 110 `repeat_threshold`** is unset (Pending Business, owner Malaz). The gate
is left **inert** rather than scored NOT PASSED, because it is additive (route-to-verifier alongside the
real verdict) and a null threshold would otherwise route every multi-ticket case to a human — 271 cases
to buy nothing. Instead every case with ≥2 dummy tickets carries the flag `repeat_threshold_unset`, and
the run summary declares the count, so Malaz can pick a number from the distribution rather than in the
abstract. **Declared inflation: gate 110 contributes zero verdicts until a threshold exists.**

**4.3 — An assumption I made without asking.** The spec ranks case severity
`Lost/REFUND_FAILED → Used → past-due → not-yet-due → Refunded` but does not place `immaterial`
(gate 90) or `unsettled` (gate 115) in it. I ordered them `not-yet-due → unsettled → immaterial`.
All three map to the same standard state (`pending`), so this changes a case's **label, never its
outcome or its exposure** — which is why it is recorded here rather than asked.

---

## 5 · Verdict-name mapping used by the rebuild

| Ticket verdict | Gate | Standard state |
|---|---|---|
| `financial_loss` | 70 | finding (red) |
| `refund_overdue` | 100 | finding (red) |
| `refunded` | 60 | clean |
| `clean_explained` | verifier 1 | clean |
| `awaiting_scheduled_refund` | 50 | pending |
| `immaterial` | 90 | pending |
| `unsettled` (`no_gate_matched`) | 115 | pending |
| `erp_unreachable` | 30 | pending |
| `unresolved` | verifier 2 | pending |
| `used_review` | 80 | route to verifier |
| `repeat_bookings` | 110 | route to verifier (inert) |

`applicant_not_found` is **retired**, per the spec. Its two causes are separated: ERP failure →
`erp_unreachable` (gate 30); a genuinely ticket-less applicant reached through a 492 transaction →
`unsettled` + `route_verifier_scope_contradiction` (gate 40).
