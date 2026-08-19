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

---

# Part 2 · Live measurements, 2026-08-19

Probed and run against production ERP through n8n's egress (the build container gets a 403
from ERP's load balancer, so every call went through n8n).

⚠️ **ATTRIBUTION CAVEAT ON EVERYTHING BELOW.** These reads were made on a bearer token whose
`user` claim is **`Abdullaha`**, not the operator's. Running on it was explicitly authorised by
Hassan after the conflict was raised. It is recorded here because the build process is
explicit that permissions tested on a borrowed token get recorded as working and *stay*
recorded — and this spec already carries one route documented as "verified" that later turned
out to be refused on the auditing account. **Nothing below should be marked
`Technical Validated` until it is re-confirmed on the account that will actually run the check.**

## 6 · The population checksum reproduces exactly

| | |
|---|---|
| Window | 2026-05-01 .. 2026-05-05 |
| `totalElements` declared | **137** |
| Rows pulled | **137** |
| Pages at `size=200` | **1** |
| Independent count | the spec's recorded `transactions_processed` from the last production run = **137** |
| Delta | **0** |

Population purity: **137 of 137** rows were `expense.id = 492` / code `FT 78`; all dates inside
the window; **0** null dates. `transactionType` split `APPLICANT 133 / UNKNOWN 3 / HOUSEMAID 1`
— which confirms the spec's warning never to filter on `transactionType`, since 3 genuine rows
would be dropped as `UNKNOWN`.

## 7 · The GATE 2 landmine is live on THIS endpoint

The envelope carries **both** keys:

```
total:         ""     ← empty STRING
totalElements: 137    ← number
```

This is the exact shape that broke the sibling CC sweep (`"" != null` is true, `Number("")` is
0, so `collected < 0` never fires). **Confirmed present on `advancesearchNew`.** The rebuild
asserts on `totalElements` and refuses any non-numeric declared total. The flow being replaced
asserts nothing at all, so it is not bitten today — but any future "improvement" that reads
`total` would truncate silently and report success.

## 8 · FREE WIN — the per-transaction detail call drops from 137 to 1

`Applicant ID - N` is present in the transaction description on **136 of 137** rows, and the
parsed id matched `applicants[0].applicant.id` on **6 of 6** sampled rows with **zero**
disagreements. The ticketing card is also on the search row (`fromBucket`), so nothing is lost.

**Corrects the `transaction_applicant_id` variable row**, which binds Dummy Tickets to the
detail call and reserves the parse for Applicant Real Ticket. The same shortcut works here.
Implemented as parse-first with the detail call as fallback; gate 20's policy is untouched
(structured source, never a name). Deviation declared, not silent.

Call budget for the reference window, corrected and measured:
`1 population page + 1 detail call + 93 Hustler reads + 1 sentinel ≈ 96` — against the spec's
stated ~460.

## 9 · The one row that resolves a housemaid, not an applicant

**1 of 137** rows is `transactionType: HOUSEMAID`, description prefixed `Maid -`, and its detail
payload carries `housemaids[0].housemaid.id` with an **empty** `applicants` array. This
applicant-scoped check (one case = one applicant) cannot own it.

**The spec does not cover this case.** *Anything this check must NOT cover* addresses real
tickets, duplicate detection and terminated maids — not a housemaid-type charge sitting in the
dummy-ticket expense. It is counted and declared as
`housemaid_charges_out_of_scope`, not dropped, and deliberately not routed to the verifier, who
would have no question to answer. **Owner call:** does it belong to *Terminated Housemaids
Tickets*, or nowhere?

## 10 · A fourth `requestRefundAutomaticallyType` the spec does not list

Measured over the reference window's 247 in-scope DUMMY tickets:

| value | count |
|---|---|
| *(empty)* | 100 |
| **`Immediately`** | **92** |
| `CustomTime` | 38 |
| `TwentyFourHoursBeforeDepartureTime` | 17 |

`Immediately` is the **second most common value** and is absent from the row's *Allowed Values*
(`CustomTime · TwentyFourHoursBeforeDepartureTime · DoNotRequestRefund · empty`). The row's
open-ended fail-safe held — it is a real schedule, so the empty-means-`DoNotRequestRefund`
default correctly does not apply to it, and an unrefunded ticket carrying one lands in the
terminal net rather than in a red. Locked in as offline test **E18**.

`DoNotRequestRefund` was **not observed once**, consistent with the spec's note that no DUMMY
example has ever been seen.

Statuses observed: `REFUNDED 197 · CANCELED 46 · REFUND_FAILED 3 · REFUND_SENT_TO_PAYERS 1`.
Only **4 of the 8** documented states appear in this window; `ISSUED`, `PENDING_REFUND`,
`REQUESTED` and `Used` do not, so gates 50 and 80 were **not exercised on live data** here.

## 11 · Two field-shape corrections

- **`currency` has no `name` key on a DUMMY ticket.** Keys are `[id, label, code]`, with
  `label: "AED"`. The variable row's *API Parameter Name* (`currency.label`) is **right**; its
  *Example Values* (`{"name": "AED"}`, measured on REAL rows) is what misleads. My own earlier
  note in Part 1 §2.4 had this backwards — the parameter name needs no change, the example does.
- **The FLIGHT_TICKTE payload has no `applicants` array at all.** Top-level keys are exactly
  `changesHistory` and `flightsTickets`. The `transaction_applicant_id` row claims the plural
  array "still holds on the ticket-side payload for both checks" — it does not for
  `tab=FLIGHT_TICKTE`. Only the transaction detail carries it.

TC1 confirmed live and exactly: applicant `1508067` / ticket `4261989`, `status REFUND_FAILED`,
`ticketOutcome.label "Lost"`, `amountInAED` matching the spec to the cent, `amount` genuinely
**differing** from `amountInAED` (so the never-substitute rule bites on DUMMY rows too),
`requestRefundOn` empty, `requestRefundAutomaticallyType` empty, `refundable: true`,
`creatorModule: recruitment`. Its `applicantTask.label` is **`Refund_Flight_Ticket`** — on a
confirmed AED 4,674.74 loss. That is live proof of the `applicant_task_label` false-clearance
trap: filtering the population on that field would drop this very loss.

## 12 · A bug this build found in itself

The first full-window run reported `success`, 93 applicants, and a plausible-looking record —
but `never_returned: 68`. **Only 25 of 93 applicants had actually been scored.** The Execute
Workflow node defaults to passing every chunk in ONE call while the sub-workflow read
`$input.first()`, so only chunk 0 was expanded.

In production this would have reported a near-loss-free window it never examined — the
expensive failure, because it looks like success. It was caught only because the scorer asserts
that **every applicant asked for must come back** and records the missing ones as unreachable
rather than dropping them. Fixed with `mode: each`; `never_returned` is now **0**.

The residual imprecision, declared: a never-returned applicant is labelled `erp_unreachable`,
which reads as an ERP outage. The `SUBWORKFLOW_DROPPED_N` line in `declared_gaps` distinguishes
it, so the cause stays visible.

## 13 · Full-window result, and the comparison that matters

Reference window, 93 applicants, 323 ticket rows read (247 in scope after gate 10):

| | rebuild | the flow it replaces |
|---|---|---|
| Red flags published | **4** | **~32** |
| — of which confirmed losses (gate 70) | 3 | 3 |
| — past-due / never-scheduled (gate 100) | 1 | 0 (gate absent) |
| Clean (no portal row) | 61 | 61 |
| Pending (own state, not a red) | 28 | **0 — the state does not exist** |
| Routed to verifier | 0 | 0 |
| ERP unreachable → pending | 2 | published as red `applicant_not_found` |
| Exposure | AED 11,517 | one ticket's amount per case |

The ~32 figure is derived, not guessed: production flags every case whose worst ticket is not
`REFUNDED`, which is the 26 zero-amount cases + 2 unreachable + 4 findings.

**Gate 100 fired.** The spec records it as never having fired. Under the conservative reading of
the §4.1 contradiction it produced exactly **1** red across 93 applicants, via
`reason: no_refund_scheduled` — i.e. through the empty-means-`DoNotRequestRefund` default. That
is the measurement the ruling needs: the conservative reading is **not** noisy. Owner: Jacky.

## 14 · The ranking decision that needs a ruling — with its number

Part 1 §4.3 called the placement of `immaterial` a label-only assumption. **That was wrong**,
and the live run shows why: placing it above `refunded` turns a case whose money all came back
into a **pending** case whenever any sibling ticket carries no amount.

`cases_pending_only_due_to_zero_amount` = **26 of 93 (28%)**. Every one of those 26 has all its
money-bearing tickets refunded and nothing outstanding. Under the alternative ranking they read
clean, and the window becomes 87 clean / 2 pending instead of 61 / 28.

The conservative reading is active by default, because a null amount means *unpriced* and can
still change. Pass `params.immaterial_ranks_below_refunded: true` to run it the other way.
**Owner call — the number above is the whole input to it.**

## 15 · Guards proven to work, not just written

- **GATE 2** asserted 137 == 137 and refused nothing (correctly).
- **Every-applicant-returns** caught the 68-applicant drop in §12. Without it the run would
  have published a false all-clear.
- **Item-alignment assertion** in `0-Fetch` (throws if response count ≠ applicant count) did
  not fire — the counts matched on every chunk.
- **Exact ERP path** used for every applicant: `path_used = tree_walk_FALLBACK` on **0 of 93**.
- **Tripwire** not triggered (4 findings against a ceiling of 40).
- **Webhook security**: an empty POST was rejected `400 unauthorized` by the shared-secret check
  before anything touched ERP. That is the guard the live flow does not have.
- **Dead-token classification**: reproduced both shapes and both are mapped to
  `erp_auth_expired` with a re-save instruction rather than surfacing as a server error.

## 16 · Offline suite

**49 of 49 assertions green** — the spec's five test cases plus one guard per "Never" clause,
plus E18–E20 added from the live findings. Mutation-tested: re-introducing the
gate-90-behind-gate-100 order, substring `REFUND` matching, or first-ticket-wins each fails the
suite, and substring matching turns a confirmed loss **green**.

---

# Part 3 · Owner rulings, 2026-08-19 (Hassan)

## R-1 · Zero-amount siblings — SETTLED: flip it

A case whose money all came back now reads **clean** even when a cancelled zero-amount ticket
sits beside it. Previously it read *pending*.

**Supersedes Part 1 §4.3 and Part 2 §14.** Applied to the flow and to `scorer.js`, with tests
R1–R4 pinning both directions.

Two guardrails kept deliberately:

- A case holding **only** zero-amount tickets is still **pending**. Nothing in it was ever
  verified as refunded, so there is no evidence to clear it with. (`cases_only_zero_amount_tickets`
  = 0 in the reference window, but the path is tested.)
- The ruling **cannot** promote a finding. A loss beside refunds and shells still decides the
  case (test R3).

Reference window before → after: **clean 61 → 82**, **pending 28 → 7**, findings unchanged at 4.
Revert with `params.immaterial_ranks_below_refunded: false`.

## R-2 · Applicants only — SETTLED

A charge in expense 492 that resolves a **housemaid** rather than an applicant is **out of
scope** for this check. Closes the open question in Part 2 §9.

Behaviour: counted as `housemaid_charges_out_of_scope` in the run record, declared in
`declared_gaps` as `APPLICANTS_ONLY_BY_RULING`, and **no case is created**. It is not dropped
silently and not routed to a verifier who would have no question to answer. 1 of 137 rows in the
reference window.

## Still open — re-put to the owner in plain terms

**The blank refund schedule** (Part 1 §4.1). Restated without jargon: some dummy tickets carry
no automatic refund date at all. When the money is also still out, does *blank* mean "nobody set
a refund up for this" (flag it) or "we cannot tell" (leave it)? Flagging is live and produced
**1 red across 93 applicants**. Not flagging would make a forgotten refund permanently invisible
to this check — the spec's own leak figure is 68 tickets / AED 194,793. Owner: **Jacky**.

**The repeat-booking threshold** (Part 1 §4.2). Gate 110 asks a behaviour question, not a money
question, and no money finding depends on it. Measured spread over 93 applicants:

| tickets per applicant | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| applicants | 35 | 22 | 6 | 5 | **10** | 2 | 2 | 3 | 1 |

Cumulative: ≥2 = 51 · ≥3 = 29 · ≥4 = 23 · ≥5 = 18 · ≥6 = **8** · ≥8 = 4 · ≥10 = 1.

**10 applicants sit at exactly 5**, which reads as normal practice rather than an outlier — so a
threshold of 5 would flag the norm. **6 is the first count above it, and yields 8 cases.**
Owner: **Malaz**.

## One thing that moved on its own

`applicants_unreachable` went **2 → 7** between two runs of the same window minutes apart, with
no code change on that path. That is ERP transient failure, exactly the wobble the spec
documents, and it is why gate 30 records an outage as `pending` and re-attempts rather than
publishing a finding about a person. Those 7 are re-read on the next run.

---

# Part 4 · Remaining rulings, 2026-08-19 (Hassan) — all four now settled

## R-3 · Blank refund schedule — SETTLED: flag it

A dummy ticket with no automatic refund date, whose money is still out, is treated as *nobody
scheduled a refund* and raises a red. This closes the contradiction in Part 1 §4.1: the variable
row and gate 90's body were right, and gate 100's "could not fire" analysis is superseded.

Measured effect: **1 red across 93 applicants** — the reading is not noisy. Without it a
forgotten refund is permanently invisible to this check, which is the leak the rule exists to
find (68 tickets / AED 194,793).

Override retained as `params.empty_schedule_means_do_not_request: false`, for measurement only.

**Gate 100's other half — a real `requestRefundOn` more than 30 days past — still has no live
case.** It fired here only through the blank-schedule route. Keep the gate; do not record the
date-based half as validated.

## R-4 · Repeat-booking threshold — SETTLED: 2, "for now"

This forced a **defect fix**, not just a config change.

Gate 110 is **additive**: it routes to a reviewer *alongside* whatever the money gates concluded,
"separate from whether any single ticket was refunded". The build was only attaching a flag to
the case — and since a clean case emits **no portal row at all**, the rule did nothing whenever
the money was fine. At the previous inert threshold that was invisible; at 2 it would have
silently dropped most of the reviews the ruling asked for.

Fixed: a case at or over the threshold is published as `needs_verifier` even when its money
verdict is clean. Two invariants pinned by tests T1–T4:

- it can **surface** a clean case (T1), and a single-ticket case stays silent (T2);
- it can **never** downgrade a finding — a loss beside a refund is over the threshold, is flagged
  for the booking question, and still publishes as `red_flag` with its exposure intact (T3).

Both the money verdict and the booking flag travel in the case metadata (`money_verdict`,
`money_state`, `repeat_review`), so a reviewer opening a surfaced case can see the money was fine.

**Measured cost at threshold 2** — reference window, 93 applicants:

| portal state | rows | reason |
|---|---|---|
| `red_flag` | 4 | 3 confirmed losses + 1 never-scheduled refund |
| `needs_verifier` | **49** | all `repeat_bookings` — money clean, booking pattern reviewed |
| `pending` | 4 | ERP unreachable, retried next run |
| silent (no row) | 36 | clean, below threshold |

**57 portal rows, 49 of them the booking question.** For comparison: a threshold of 6 yields 8
such reviews instead of 49, and 8 yields 4. Nothing on the money side changes either way —
findings stay at 4 and exposure at AED 11,517 under any threshold. Change with
`params.repeat_threshold`, or `params.repeat_bookings_off: true`.

## Run-to-run variance worth knowing

`applicants_unreachable` measured **2, then 7, then 4** across three runs of the same window
within two hours, with no code change on that path. That is ERP transient failure — the wobble
the spec documents — and it is why gate 30 records an outage as `pending` and re-attempts rather
than publishing a finding about a person. Expect the pending count to move a little run to run.

## Final state of the offline suite

**67 of 67 assertions green.** The spec's five test cases, one guard per "Never" clause in the
rule bodies, E18–E20 from the live probe, R1–R4 for the zero-amount ruling, and T1–T4 for the
repeat-booking surfacing. Mutation-tested: re-introducing the gate-90-behind-gate-100 order,
substring `REFUND` matching, or first-ticket-wins each fails the suite.

---

# Part 5 · Verifier, workbook, and publish — 2026-08-19

## The AI verifier is built — the largest declared gap is closed

Verifier rules 1 and 2 now exist, cloned from the golden's pattern. Both flows are **published**.

**It runs after the results callback**, so reds are already visible in the portal as provisional
and a slow or failing model cannot delay them.

**Only the residue reaches the model** — everything settleable from structured fields was already
settled by a gate. Two shapes remain: a dummy ticket someone flew on (rule 1) and a finding
(rule 2). The projection now also carries the ticket's own note fields, which it did not before.

**Grounding.** Each case is bundled with the ticket's written record plus an all-time ERP refund
search on `description like 'Applicant ID - N'` + expense 492, with no date filter. `like` is
deliberate: `contains` returns HTTP 500 on this endpoint — a wrong operator, not a missing
permission. An empty history counts as evidence **only** when the walk is proven complete
(`pulled == totalElements`), and that assertion travels with the bundle. **Passport numbers are
stripped before anything reaches the model.**

**Enforcement is in code, not in the prompt.** Only two model answers may move anything, and each
needs its quoted sentence present:

| model answer | effect |
|---|---|
| `EXPLAINED` + quote | that **ticket** → `clean_explained` |
| `CLAIMED_OFF_ERP` + quote | that **ticket** → `unresolved` (**pending**); the amount is kept as `claimed_amount_aed` and **never written off** |
| `NOT_EXPLAINED` · `NO_CLAIM` · `NO_TEXT` · `UNRESOLVED` · no answer · model error · asserted-but-unquoted | **unchanged** — the gates' verdict stands |

There is **no path by which a confirmed loss becomes clean.** The clean is ticket-scoped and the
case re-takes the worst of its remaining tickets, so an explained emergency can never absorb a
sibling's red. A model echo naming a different case is discarded rather than applied to the wrong
person.

### Live result

All **4** findings went to the verifier. Every one came back `NO_TEXT` — there is no written
record on those tickets — so all 4 stood unchanged and were routed to auditor review.

```
applied_rule1: 0   applied_rule2: 0   refused_unquoted: 0
no_model_answer: 0   auditor_review: 4
refund_history_complete: true on all 4  (so the absence IS evidence)
```

**Rule 1 was NOT exercised on live data.** The reference window contains zero `Used` tickets, so
the flown-on path has no live case — the same honest gap the spec already records for gate 100's
date half. Its logic is covered offline by the ticket-scoped re-aggregation tests.

## A bug the test caught, worth recording

The first end-to-end attempt **aborted the whole run** on an invalid Anthropic key — and took the
Cases and Run Summary sheet writes with it, even though those branches were topologically
independent of the verifier. `onError: continueRegularOutput` did not save it; a credential
failure aborts above that level.

Fixed by **sequencing the workbook writes before the verifier** rather than beside it. It is the
same principle as the golden's "runs log is written first": the durable, visible output must not
be hostage to an optional downstream step.

## The workbook — a declared deviation

`https://docs.google.com/spreadsheets/d/172R3JzxXm1nf6Vc3qTesin7eys-jT0ng3SOxUsf3LD8`
Tabs: **Cases** · **Run Summary** · **Verdicts**. Created in Hassan's Drive.

⚠️ **The spec's *Where do the results go?* has Workbook UNTICKED** — portal and runs log only.
The workbook is therefore a deviation on request, not something the spec asked for, and this check
is marked *Handles sensitive data = YES*.

Mitigated by writing identifiers and amounts only. **Deliberately excluded from every tab:**
applicant names, passport numbers, and card-holder / staff names (the `card` field is dropped at
the row builder). The `Verdicts` tab does carry the model's quoted sentence, because that quote is
the evidence a reviewer needs — it is capped and was passport-redacted upstream.

A Sheet is far easier to forward than a portal case. **Worth a conscious decision about who the
file is shared with.**

## Published

| | |
|---|---|
| `Dummy Tickets Housemaids · 1-Score` | **published**, `activeVersionId bffc22f2` |
| `Dummy Tickets Housemaids · 0-Fetch Tickets` | **published** (required first — a parent cannot publish against an unpublished sub-workflow) |

**Publishing does not cut over.** The portal calls the old flow's path
(`/webhook/applicant-dummy-ticket-refund-audit`); this one answers on
`/webhook/dummy-tickets-housemaids`. Both are now live and the old flow is still active. Traffic
moves only when the portal is repointed — and at that moment the old flow should be unpublished,
which also closes its unauthenticated-webhook exposure (Part 1 §1).

**A live run needs the n8n workflow variable `ERP_BEARER` set** to the token of whoever runs the
check. It is not stored in the flow.

## Final state

Offline suite **67/67**. End-to-end live: population 137/137, 93 applicants scored, 4 findings,
AED 11,517 exposure, 56 portal rows (51 of them the booking-pattern question), 4 verifier
decisions, all three workbook tabs written.

---

# Part 6 · The verifier was starved — found by questioning its own output

## What `NO_TEXT` actually meant

The first verifier run returned `NO_TEXT` on **all four** findings, which read as an honest
absence: no written record, so no claim, so the findings stand. It was wrong.

Probed the raw ERP payload for those exact four tickets. **Every one carries a populated `notes`
string:**

| applicant | `notes` length | character |
|---|---|---|
| 1952366 | 152 | a real narrative — a prior cancelled route and who approved the replacement |
| 1373082 | 49 | booking shorthand |
| 1948469 | 5 | booking shorthand |
| 1961159 | 5 | booking shorthand |

The notes reached the parent correctly. **They were stripped inside my own scorer:** `scoreTicket`
rebuilds every ticket from a `base` object holding only the seven scoring fields, so by the time
`Build Evidence Bundle` read `t.notes` it no longer existed. The model was asked to judge an empty
record and answered accordingly.

## Why this is the dangerous shape

It did **not** produce a false clearance — on rule 2, no claim means the finding stands, which is
the safe direction — so nothing in the output looked wrong. Four unanimous `NO_TEXT` answers are
exactly what a genuinely note-less population would produce. The verifier had been rendered
incapable of ever doing its job, and the run reported success.

On **rule 1** the same defect would have been worse: a `Used` ticket carrying a real explanation
could never be explained, so it would sit as a permanent finding no human input could resolve.

## The fix, and what it changed

`Select For Verifier` now re-reads the written record straight from the `0-Fetch` output instead of
from the scored ticket. That also keeps staff-written text **out of** the portal payload and the
workbook, which is where it belongs.

Same window, same four findings, after the fix:

| | before | after |
|---|---|---|
| `had_written_record` | `false` (wrong) | **`true`** on all 4 |
| model verdict | `NO_TEXT` | **`NO_CLAIM`** |
| `judged_with_written_record` | 0 | **4** |
| findings changed | 0 | **0** |

The verdict is now a real audit conclusion — *we read the note and it makes no claim that the
refund happened outside ERP* — rather than a false *there was no note*. And it is correct on the
evidence: those notes are booking instructions, not refund claims.

## Two guards added so this cannot recur silently

1. **Existence is recorded separately from judgement.** Every decision row now carries
   `ticket_had_written_record` alongside `model_verdict`, in the flow and in the `Verdicts` tab.
   "The model saw nothing" can never again be indistinguishable from "there was nothing to see".
2. **A verifier tripwire.** `suspected_starved_verifier` fires when records demonstrably existed,
   nothing was applied, and every ticket landed in auditor review — the exact signature of this
   bug. It read `false` on the fixed run.
3. A ticket selected for review that the enrichment step never returned now **throws** rather than
   being judged on an unrecoverable record.

## Standing lesson for this build

Both bugs found in this session were of one kind: **a run that reports success while having
quietly examined less than it appears to.** The 68 dropped applicants were caught by an assertion
that every applicant asked for must come back. This one was caught only because someone asked why
the answer was what it was. Where a step can be starved of its input, assert on the input's
presence — not just on the absence of an error.

---

# Part 7 · June 2026 — the first month-scale run ever to complete

`run_id june-2026-paced` · window 2026-06-01..2026-06-30 · **8m05s** · status success.

The spec records that **a month has never been run**: all four production runs used a 5-day
window, and the single attempt at 2026-05-01..2026-06-05 died with `erp_unavailable` HTTP 500.
This is the run that closes that gap.

## Population — proven complete at 6 pages

| | |
|---|---|
| `totalElements` declared | **1197** |
| Rows pulled | **1197** |
| Pages | 6 (at size 200) |
| Expense purity | 1197/1197 on 492 / `FT 78` |
| Null dates | 0 |
| Unique applicants | **605** — all 605 scored |

**`never_returned: 0` across 25 sequential chunks, every one successful.** The chunking fix holds
at 25× the load that first exposed it. `fallback_path: 0` — the exact ERP path served every
applicant.

## Result

| | |
|---|---|
| **Findings** | **7** — 6 `financial_loss`, 1 `refund_overdue` |
| **Exposure** | **AED 22,611.54** |
| Clean | 584 |
| Pending | 14 (4 ERP-unreachable, 7 `unsettled`, 3 `awaiting_scheduled_refund`) |
| Portal rows | **300** |
| Tickets read | 1635, of which 418 out of scope → 1217 in-scope DUMMY |

7 findings across 605 applicants sits comfortably inside the tripwire ceiling and is consistent
with the spec's ~11-real-losses expectation for a case store, not a single window.

## Pacing held

25 chunks ran **sequentially**, each 8–22s at 5 concurrent / 500 ms; the model calls were paced one
at a time with a 1s gap. **Zero ERP failures across roughly 1,200 authenticated reads.** No 500s,
no rate-limit symptoms — which is the thing the June-2026 account disablement makes worth stating.
Total wall clock 8m05s, well inside the 40-minute execution ceiling.

## Gates this window exercised that May did not

The wider window brought out statuses the 5-day one never contained:

```
REFUNDED 966 · CANCELED 207 · REFUND_SENT_TO_PAYERS 21 · PENDING_REFUND 8
REQUESTED 5 · REFUND_FAILED 6 · ISSUED 4
```

- **Gate 50 fired** — 3 cases `awaiting_scheduled_refund`. The not-yet-due path now has live cases.
- **Gate 115 fired** — 7 cases `unsettled`, driven by the 21 `REFUND_SENT_TO_PAYERS` tickets, which
  are money in flight: correctly neither clean nor red.
- **Still no `Used` outcome anywhere.** Gate 80 and verifier rule 1 remain unexercised on live data
  across both windows. Recorded as a gap, not as validated.
- `auto_types`: `TwentyFourHoursBeforeDepartureTime` 464 · `CustomTime` 262 · *(blank)* 262 ·
  `Immediately` 229. **`DoNotRequestRefund` still never observed** on a DUMMY ticket.

## Verifier

All **7** findings were adjudicated. Every one had a written record (`had_written_record: true`),
every one returned `NO_CLAIM`, and **every finding stood**.

```
applied_rule1: 0   applied_rule2: 0   refused_unquoted: 0   no_model_answer: 0
judged_with_written_record: 7   judged_without_written_record: 0
suspected_starved_verifier: false
```

The starvation tripwire read clean at 7× the case count that first exposed the bug.

## The threshold-2 cost, at month scale

| | |
|---|---|
| Actual findings | **7** |
| Cases surfaced **only** for the booking question | **289** |
| Portal rows total | 300 |

**41 booking reviews for every real finding.** The spread at other thresholds, measured on this
same population:

| threshold | applicants routed |
|---|---|
| 2 *(current ruling)* | **294** |
| 3 | 160 |
| 4 | 81 |
| 5 | 44 |
| 6 | **18** |
| 8 | 5 |

Nothing on the money side changes with the threshold — findings stay at 7 and exposure at
AED 22,611.54 at any value. It is purely review load, and it is one parameter. Worth revisiting
now that the month-scale number exists, since "for now" was ruled against the 5-day figure.

Separately, the zero-amount ruling earned its keep at this scale: **151 cases** read clean that
would previously have been pending.

## A defect this run exposed in my own work

The run record has been claiming unattributable charges were *"routed to the verifier, never
dropped"*. **They were only counted** — no case, no row, nothing anyone could work. May had zero of
them so it never showed; **June produced 15**, which made a materially false statement sit in a
durable record.

They genuinely cannot be applicant-scoped cases — one case is one applicant, and these have no
applicant to key one on. So they now go to the **workbook** as their own rows with
`portal_state needs_attribution`, and the run record says what actually happens: listed for manual
attribution, **not** adjudicated, **not** counted in any verdict total. Housemaid charges get the
same treatment as `out_of_scope_housemaid`.

The same audit was applied to every other line in `declared_gaps`, including correcting two that
still described the verifier as unbuilt.

## Part 7b · June re-run — validating the fixes that shipped untested

`run_id june-2026-paced-v2` · **7m24s** · status success. Published as `activeVersionId 59fb0485`.

The `needs_attribution` rows and the corrected `declared_gaps` wording were written **after** the
first June run, so they had never executed. This run exercised them. June is the only window that
can: May produced zero unattributable charges.

**Both fixes confirmed working.** `Cases -> Sheet` wrote **315 rows**:

| portal_state | rows |
|---|---|
| `needs_verifier` | 291 |
| `needs_attribution` | **15** ← new, previously invisible |
| `red_flag` | 7 |
| `out_of_scope_housemaid` | **1** ← new |
| `pending` | 1 |

Each new row carries its transaction id and date (e.g. *transaction 1986941 dated 2026-06-29*), so
it is actually workable rather than merely counted. The run record now states what the code does:
*"CANNOT be applicant-scoped cases… listed in the workbook as needs_attribution… NOT adjudicated
and NOT counted in any verdict total."*

Two `declared_gaps` lines that still described the verifier as unbuilt are also corrected, and one
now carries the threshold cost inline: *"gate_110_repeat_threshold=2: 281 case(s) whose money
verdict was CLEAN are surfaced for a booking-pattern review, against 7 actual finding(s)."*

### Reproducibility across the two June runs

| | run 1 | run 2 |
|---|---|---|
| Population declared / pulled | 1197 / 1197 | 1197 / 1197 |
| Pages | 6 | 6 |
| Unique applicants | 605 | 605 |
| Enrichment chunks | 25, all success | 25, all success |
| `never_returned` | 0 | 0 |
| `fallback_path` | 0 | 0 |
| **Findings** | **7** | **7** |
| **Exposure** | **AED 22,611.54** | **AED 22,611.54** |
| Verifier decisions | 7, all `NO_CLAIM`, all stood | 7, all `NO_CLAIM`, all stood |
| Wall clock | 8m05s | 7m24s |

**The scored result is identical.** The only figures that moved are the ERP-transient ones —
`applicants_unreachable` 4 → 1, which shifts `clean` 584 → 587 and `pending` 14 → 11, and the
booking-review count 289 → 281 as a consequence. Findings, exposure and the population proof are
stable, which is what matters: the money answer does not drift between runs, only the
retry-next-run bucket does.

The workbook now holds rows from four runs, distinguished by `run_id`.

---

# Part 8 · Cutover, 2026-08-19 (Hassan) — the portal now reaches this flow

## What was actually done, and why it is not what "repoint the portal" literally says

The check's registry row — the record holding the n8n URL the portal calls — lives in the Security
Room's **Supabase** project (`nnbyjbdbigcpoqtsczlz`, the same project whose functions host is one of
the two allowlisted callback origins). That project was not reachable from this session: a Supabase
connector exists on the org but was toggled off in-chat. Editing the portal's own config was
therefore impossible, and it is worth naming that plainly rather than filing the cutover as if the
portal had been touched.

**The inverse was done instead, at owner instruction:** this flow *adopted the retired flow's
webhook path*. Its `Webhook` node moved from `dummy-tickets-housemaids` to
`applicant-dummy-ticket-refund-audit`, and the flow was republished
(`activeVersionId ae39d1cc`). The URL the portal already stores now resolves here. **The documented
path `/webhook/dummy-tickets-housemaids` no longer exists** — every doc that quoted it has been
corrected.

## The finding that made this safe: no portal-side change was needed

A path swap alone would have been reckless without checking what the *new* validator demands that
the old one did not. The old flow had **no inbound authentication of any kind**. This one is the
golden's validator, with three gates the old flow lacked. All three turn out to be already satisfied,
because the golden is a check the portal **already drives**:

| Gate this flow adds | Status against the portal |
|---|---|
| `x-sr-webhook-secret` shared-secret header | satisfied — the value is the golden's, unchanged |
| `callback_url` origin allowlist + `/ta-callback/<64-hex>` path shape | satisfied — the allowlist *is* the portal's Worker proxy and Supabase functions host |
| `Bearer <token>` shape check (CRLF header injection) | satisfied — shape only, not validity |
| ERP token location | **backwards compatible** — prefers `params.erp_auth.bearer`, still reads the legacy `auth.erp.token` the old flow sent |
| 31-day window span cap | satisfied — the portal default is the previous calendar month |

So the cutover is a URL change and nothing else. That is a measured claim, not an assumption: the
validator was read in full before the path was touched.

## Verified, not assumed

POSTing the production path with no secret header returned:

```
HTTP 200  {"accepted":false,"message":"unauthorized"}
```

That body is **this** flow's terse security rejection. The old flow, having no secret check, would
have answered with a `Missing required field(s)` shape instead. The difference in reply is the proof
the path now lands here. The probe was chosen because it is rejected at the first gate: it touches no
ERP endpoint and posts no callback.

## The old flow is archived, not just unpublished

`FXrhGBJUnGYgrs9R` was unpublished earlier in the session and is now **archived**. Unpublishing alone
left a live hazard: n8n resolves a production webhook by path, so republishing that flow — by anyone,
for any reason — would have collided on `applicant-dummy-ticket-refund-audit` and could have taken
the portal's traffic back to the unaudited logic. Archiving also permanently closes the
unauthenticated-webhook exposure recorded in Part 1 §1. Its `classifyDummy` logic is preserved
verbatim in `prod-comparison.js`, so the comparison baseline survives the archive.

## Two failure modes to carry into the first portal-driven run

**1. A misconfigured repoint fails *silently*.** If the portal does not send the shared-secret header
for *this* check — the secret is the golden's, but nothing here proves the portal attaches it
per-check rather than per-flow — every call returns `unauthorized`, and that branch sets `_silent` by
design, so that anyone who finds the URL cannot mail-bomb the team by hammering it. The consequence
is the dangerous one: **the portal would look like it ran and produce nothing at all.** The first
portal-driven run must be confirmed in the n8n execution list. Absence of an alert is not evidence of
a run.

**2. A rejection returns HTTP 200**, with `accepted:false` in the body, not a 4xx. Inherited golden
behaviour, and the portal is built against it, so it was deliberately left alone — but anyone testing
by status code alone will read a rejection as a success.

## What the cutover did not settle

It moved traffic; it did not validate anything. Still open, and now open on a **live** flow:

- **Sign-off.** `Test cases verified`, `Business Validated`, `Technical Validated` all still unticked.
  The cutover makes this more urgent, not less.
- **Gate 80 and verifier rule 1** have still never seen a live case — no `Used` outcome has appeared
  across 1,290 tickets read. Gate 100's date-based half likewise.
- **The repeat-booking threshold of 2** still costs 281 booking reviews per 7 findings at month scale.

One item closed itself: the borrowed-token caveat on Part 2 does **not** apply to portal-driven runs.
The token arrives in the payload from the triggering user's own saved ERP credentials, so production
findings are attributed to whoever triggered them. `ERP_BEARER` matters only for manual runs.
