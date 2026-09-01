# R-Visa Audit — build notes

Spec: **R-Visa Audit v0.6** (Notion `3c2fe1c78bf0817190fac75010bf9703`), plus the
18 rule rows tagged `Check = R-Visa Audit` and the check's 20 ERP-variable rows.

Status 2026-08-30: **deterministic scorer built and passing 91/91 offline. ERP
probed on a live operator token. The check cannot run on that account** — there is
no readable route from a transaction to the maid it belongs to, and every red
verdict this check has depends on one. Build stopped at that blocker rather than
producing a flow that runs clean and reports nothing.

Probe flow: `EQJKewOEsOVjDQO8` (*ZZ R-Visa probe*, Adeeb project, draft,
read-only, throwaway). Executions `110373`, `110401`, `110434`, `110445`.

---

## Phase 1 — ERP token

Both pre-existing credential paths were tried before asking for anything:

| Path | Result |
|---|---|
| n8n instance var `ERP_AUTH_TOKEN` (used by the shared *ERP read executor*) | not set on this instance |
| Stored credential `ERP Token 12th Aug 2026` (`uDGE06IdxKx74kFz`) | expired |

**An expired ERP token returns HTTP 500, not 401** — `{"status":500,"error":
"Internal Server Error","message":"Token not valid, {Token is expired}"}`
(execution `110373`). It reads as a server fault; it isn't one.

The operator then supplied a live token, taken as a **runtime payload** on the
probe's webhook — never written into a stored credential, never a literal in a
Code node. It is shape-checked (`Bearer <token>`, no control characters) before
being interpolated into any header, because a CR/LF in that value would smuggle
extra headers into every ERP request downstream.

## Phase 2 — probe results

### The three denial shapes, separated live

The skill's warning holds exactly. All three are HTTP 401 with an identical body
(`"UNAUTHORIZED <LOGOUT>"`); only the `developermessage` response header
distinguishes them:

| `developermessage` | Means |
|---|---|
| `API_NOT_FOUND_FOR_PAGE` | the pagecode is wrong for this route |
| `PAGE_NOT_FOUND` | the pagecode does not exist at all |
| `INSUFFICIENT_PERMISSIONS` | the pagecode is right and **the account lacks the permission** |

Probing a plausible alternative pagecode alongside the documented one is what
made this readable. On `GET /accounting/transactions/{id}` (execution `110434`):

| pagecode | Result |
|---|---|
| `AddEditTransaction` | 401 **`INSUFFICIENT_PERMISSIONS`** |
| `ManageTransactions` | 401 `API_NOT_FOUND_FOR_PAGE` |
| `VisaProcessingPage` | 401 `API_NOT_FOUND_FOR_PAGE` |
| `TransactionReport` | 401 `PAGE_NOT_FOUND` |

So `AddEditTransaction` is the only pagecode that serves the route — it is the
one the MV Overstay Fines golden uses — and the operator's account is refused on
it. This is a permission gap, not a wrong header.

### Surface table

| Surface | pagecode | Status | Check can proceed? |
|---|---|---|---|
| `POST /accounting/transactions/page/advancesearchNew` | `ManageTransactions` | **200** | yes — the population sweep works |
| `GET /accounting/transactions/{id}` | `AddEditTransaction` | 401 `INSUFFICIENT_PERMISSIONS` | **no — blocker** |
| `GET /visa/overstay-fines/housemaid/{id}` | `VisaProcessingPage` | 401 `INSUFFICIENT_PERMISSIONS` | no — degradation |
| search filtered on `housemaid.id`, `housemaid.housemaidId`, `housemaidId`, `contract.id`, `client.id` | `ManageTransactions` | **500** (SecurityException family) | no — parser rejects all five |
| visa request / task history, cancellation type, rejection status, contract term | — | **no route established** | no — already declared gaps |

### 🔴 The blocker: nothing links a transaction to a maid

Three independent routes to identity, all closed on this account:

1. **The list payload carries no maid id.** Its keys are `id`, `expense{code,
   name,id}`, `description`, `amount`, `date`, `creationDate`, `paymentId`,
   `contractId`, `clientId`, `supplier{id}`, `license`, `fromBucket`, `toBucket`,
   `vatType`, `vatAmount`, `attachments[]`, `transactionType`, `pnlValueDate`,
   `paymentType`, `isDescriptionSecured`, `qashioTransactionId`. A key-path scan
   for `/housemaid|maid|employee|worker|person/i` returned **empty on every list
   probe**. This confirms the spec's claim, which had been recorded but not
   verified.
2. **The detail route, which would carry it, is refused** (above).
3. **The search cannot be filtered by maid** — all five identity properties
   return 500, against a control query that returns 996,778, so they are being
   rejected rather than silently ignored.

Rule ❷ requires the maid id and forbids the name in the description as a
substitute (name-keyed: 56 groups, 54 resolving to more than one maid id, ~4%
precise). **Without identity, ❷ parks every record as `identity-unresolved`, and
❼, ❽, ❾, ❿ and ⓫ — every rule that can produce a red — never evaluate.**

What would still run: ❶ population, ❺ base-fee resolution, ❹ date integrity, ⓭.
That is the money counted and odd amounts flagged. **No red verdict this check
defines can fire.** A flow shipped in that state would report zero findings for
a reason invisible in its own output — the precise failure ⓬'s rule body names as
the most expensive available here.

### Free win: the server filters on description text

`{property: "description", operation: "like", value: "R-VISA"}` **binds and
narrows** — on `NEW - Immigration - CC Maids` for September 2025 it took 1,593
rows to 641 (execution `110401`). The pre-cutover text legs are therefore a
server-side filter, not a client-side sieve over roughly ten times the rows. That
removes a whole pass from the pre-cutover architecture.

### Reference data: expense ids for the checksum

Live from ERP, window 2025-12-01 → 2026-08-30 (execution `110445`):

| Expense head | id | rows |
|---|---|---|
| NEW - MV Housemaids - R-visa Application 2 years | 1708 | 5,250 |
| NEW - CC Housemaids - R-visa Application 2 years | 1620 | 2,731 |
| RENEW - CC Housemaids - R-visa Application 2 years | 1647 | 2,460 |
| RENEW - MV Housemaids - R-visa Modification | 1735 | 38 |
| RENEW - CC Housemaids - R-visa Modification | 1649 | 10 |
| NEW - CC Housemaids - R-visa Modification | 1622 | 9 |
| *RENEW - MV Housemaids - R-visa Application 2 years* | — | **0** |
| *NEW - MV Housemaids - R-visa Modification* | — | **0** |
| NEW - OfficeStaff - R-visa Application 2 years (out of scope) | 1797 | 14 |

**Only six of the spec's "eight dedicated heads" carry rows.** Two return zero on
an exact-name match while the other six match exactly, so the naming convention
is right and those two combinations appear not to exist. That matters for ❾,
whose renewal test keys on a RENEW head: there is no
`RENEW - MV Housemaids - R-visa Application 2 years`, so **MV renewals are either
booked somewhere this population rule does not look, or they do not exist as a
category.** Unresolved, and it is a population question, not a cosmetic one.

The six in-scope heads total **10,498** rows in that window. The spec's warehouse
figures for a near-identical window are ~11,924. The windows are not identical
and the sources differ (ERP walk vs warehouse), so this is **a delta to
reconcile, not yet a discrepancy to attribute** — but it must be reconciled
before a run, per the spec's own instruction to walk one month against ERP with
`pulled == totalElements` asserted.

### Build constraint found: the ~60s Code-node ceiling

Two probe rounds making 18 and 22 serial ERP calls **both errored at ~61s**,
while a 10-call round finished in 17s and a 9-call round in 47s. A Code node
making serial ERP calls dies around 60 seconds regardless of the per-call
timeout. The build must therefore batch across nodes or sub-workflow executions,
not inside one Code node — which is how the MV Overstay Fines and CC Below Agreed
chains are already shaped.

## Phase 3 — the call budget, restated with real numbers

The spec budgets 500 calls/run and proposes scoping detail calls to fine-bearing
rows plus "repeat-payment candidates, identifiable by grouping the list on
whatever key it does carry". **The probe closes that option:** the list carries no
identity key, and the only alternative — the name in the description — is the one
rule ❷ forbids. Identifying repeat-payment candidates requires the maid id the
scoping was meant to avoid fetching.

A case is one maid carrying *every payment she has ever had* (within 2025 only 2
maids repeat; all-time 182), so this is not solvable by narrowing the window.

Three ways forward, in the order I'd recommend them:

1. **Ask the ERP team to put the housemaid id on the transaction list payload.**
   One field turns a ~48,000-call problem into a ~241-call one (48,192 rows at
   `size=200`), and makes the check's flagship rule answerable directly. It is
   also the only option that does not depend on a second system.
2. **Grant the operator `AddEditTransaction`, and source candidates from
   Snowflake.** Its `TRANSACTIONS` view carries `HOUSEMAID_ID` on the same rows,
   so the warehouse identifies candidate maids and ERP confirms each — tens of
   ERP calls. This matches the spec's own division of labour (*the warehouse
   measures and explores, ERP is the authority*). Note the standing rule that
   recurring or scheduled warehouse pulls go to the ERP/Data team; this check is
   manual-trigger only, which is why it is worth raising explicitly rather than
   just building.
   ⛔ **Blocked as well, as of 2026-08-30.** The Snowflake connector authenticates
   as `hassan.ahmed@maids.cc` with role `PAYROLL_AND_MONEY_CONTROL_ROLE`, but
   `CURRENT_WAREHOUSE()` is empty and `SHOW WAREHOUSES` returns **zero rows** — the
   role holds USAGE on no warehouse, so every query that scans data fails with
   *"You must specify the warehouse to use"*. This option needs a warehouse grant
   on top of the ERP permission, which is why option 1 is now the cleaner ask.
3. **Grant the permission and call detail per transaction.** ~1,400 calls a month
   against a budget of 500, and an all-time backfill far worse. Not viable.

## Phase 4 — business logic: resolved, no blocking questions

Every open ruling in the spec carries either a stated `Verdict` or a conservative
default, so none meets the bar for a blocking question (spec-silent · unprobeable
· outcome-changing · no safe default). Implemented as written, flagged where it
matters:

- **❽ — is a day-count shortfall a finding?** The rule's own `Verdict` is
  `finding (red)`, and red is the non-clearing direction. Implemented as red.
  This is the check's decisive ruling — the difference between ~18 findings a
  year and none — and it belongs to Malaz at sign-off, not to the build.
- **❹ which date is authoritative** — already answered operationally: park the
  disagreements rather than pick a side.
- **❾ 601 days / ⓫ 30 days** — empirical boundaries, implemented as written. The
  measurement says 30 is probably the wrong band (31–90 is *more* enriched for
  the double-payment signature than the 0–30 band that reds), but widening it is
  a business decision with 69 pairs behind it.
- **⓬ / verifier ❸ rejection sub-audit** — a rule the source states and never
  defines. Scored as not-passed, routed, and declared not-executed in the run
  summary rather than quietly absorbed.

### Spec corrections filed

**1. ❺'s arithmetic justification is wrong, and a literal implementation makes
the check report nothing.** The rule says the three base fees *"differ by 10.81
and 100.00 — neither a multiple of 50 — so two bases can never both fit"*, and on
that basis instructs: park if more than one qualifies. But
`446.65 − 346.65 = 100.00 = 2 × 50` exactly, so 346.65 fits **every** amount that
446.65 fits, with two extra fine days. The park clause then fires on the entire
main-base population and every record exits `base-fee-unresolved` — the flow runs
clean, finds zero, and looks fine.

Implemented tie-break: **take the highest base that fits, and annotate the
ambiguity on the record.** A fine is the rare exception (25 of 14,409 positive
2025 rows), so the parse implying the fewest fine days is right. This reproduces
every figure the spec verified independently — 92 fine days on `1641662`, 54 on
`1526423`, 2/7/9 on the three 2026 overcharges — which the park-on-ambiguity
reading cannot produce at all.

**2. Two test cases expect `clean` where the rules produce `pending`.** Test case
2 (maid `61273`, 819-day gap, both payments on `NEW` heads) and test case 3 (maid
`94824`, two visa cycles) are recorded as *clean*, but only ❾ and verifier ❶ can
produce clean and neither reaches these pairs: ❾'s day-gap fallback is scoped to
*"rows predating the December 2025 taxonomy"*, and ⓫ produces no verdict for
payments in different cycles. Both land on the ⓭ floor as `pending`. That is the
safe direction and the shared requirement — *not red* — holds either way, so it
is implemented conservatively. The spec needs to state **which payment of a
straddling pair decides "predating the taxonomy"** (implemented as the earlier
one, which is what makes test case 2 come out clean) and **whether "different
visa cycles" should produce a clean rather than falling through**.

**3. ❺ vs test case 6.** The spec says transaction `1536291` (AED 798.05) *"must
reach ⓭ as pending"*, but ❺'s own `Verdict` is `pending` and ❺ is where the
amount fails. Implemented at ❺ — same verdict, more precise reason.

**4. The eight dedicated heads are six.** See the reference-data table above.

**5. Two spec claims now verified rather than assumed:** the list payload really
does lack a maid id, and the description `like` filter really does bind.

### Two consequences the run summary must state plainly

- **`pending` is the majority state, by design.** Only ❾ and verifier ❶ produce
  `clean`, so every ordinary payment no gate reds lands on the ⓭ floor as
  pending. That is what ⓭ is for (*never let silence mean clean*), but a reader
  seeing tens of thousands of pending records is seeing correct behaviour. It
  must never be folded into a clean count.
- **Verifier ❷ reds every fine-bearing record.** `fine_repayment_responsibility`
  has never been observed as a field, so *unassigned* is unknowable rather than
  known-false, and the rule rightly refuses to default to the company bearing it.
  ~25 records a year. Declared as an inflation, not presented as 25 discoveries.

## Phase 5 — the flow, built

Built on the MV Overstay Fines rails (ERP lease, pre-flight budget gate,
population reconciliation, runs-log-before-payload, draft-only delivery), but
not its execution shape: MV Overstay is window-scoped and this check is all-time
per maid.

| Artefact | id |
|---|---|
| `R-Visa Audit · 1-Run` (25 nodes, draft) | `2yJCYs1YUZz7BVDG` |
| `R-Visa Audit · 0-Sweep Head` (sub-workflow) | `4Fn3xvQDPMVucq0I` |
| `R-Visa Audit · 0-Resolve Identity` (sub-workflow) | `j3jHiOtkAOOLTe3o` |
| `R-Visa Audit — Cases` (data table) | `850KgI3ms4Zw9T7L` |
| `R-Visa Audit — Runs` (data table) | `AYSssg596CcIXtpp` |

Three design decisions worth knowing:

**The sweep is all-time, the window only scopes reporting.** A case is every
payment a maid has ever had; within 2025 only 2 maids repeat, all-time 182. A
window-scoped duplicate test misses roughly nine in ten cases.

**The population is 14 paginated sweeps, not one.** Six dedicated heads with no
text test, plus four generic heads × two server-side text legs (`R-VISA` and
`Renew Residence`). The `like` operator was proved to bind, which keeps the
generic legs to R-visa rows instead of pulling ~10× the volume and sieving.

**Identity is scoped by `contractId`.** With no maid id on the list payload, the
only rows that can reach a red are fine-bearing rows and rows sharing a contract
with another row. Those get a detail call; the rest are scored as single-payment
cases so ❹ and ❺ still run and they land on the ⓭ floor. This is what makes the
budget close — the pinned run projected **17 calls against a budget of 500**.
Its cost is a declared recall gap: a maid whose two payments sit on *different*
contracts is not examined for a duplicate until the list payload carries a maid
id. Nothing is falsely cleared; the run says so on every row.

The scoring node is **generated**, not hand-written: `build-node.js` concatenates
`scorer.js` + `driver.js` into `dist/score-node.js`, and `--check` fails if the
deployed body and the tested source diverge. Parity was verified byte-for-byte
against the deployed node.

## Phase 6–7 — testing

**131 offline assertions, all passing.**

- `node audit/r_visa/scorer.test.js` — **91**. The rules: all six spec test cases,
  the three 2026 ❼ overcharges (reproducing the stated 4 excess days / AED 200
  independently), both population eras, all four deliberate exclusions, and a
  guard for every edge the rules name.
- `node audit/r_visa/pipeline.test.js` — **40**. The glue: executes the exact
  deployed node body against fixtures shaped like the real upstream nodes.

**Two end-to-end runs of the real deployed flow**, with pinned fixtures instead
of ERP (executions `112775` and `112777`):

| | happy path | identity blocked |
|---|---|---|
| status | `completed` | `completed-blocked` |
| population | 14/14 heads reconciled, checksum verified | same |
| projected ERP calls | 17 vs budget 500 | 17 |
| case verdicts | 1 red | 0 red, 2 pending |
| record verdicts | 1 red, 2 pending | 0 red, 2 pending |
| review email | drafted | **not drafted** — Any Reds? routed false |
| run row + case rows | written | written, flagged `identity_blocked` |

The blocked run is the one that matters: the same two payments that red on the
happy path produce **no red at all**, and the run says in its status, its
declared gaps and its notes that it could not have found one.

### Four defects found by testing, all fixed

1. **Verifier ❸ relabelled every case.** Its `inconclusive` — true for every case,
   because the rejection fields have never been observed — outranked `pending` in
   the rollup, so every non-red case would have reported as inconclusive. It is
   now counted at run level and excluded from the case verdict.
2. **A missing sweep result passed silently.** The reconciliation only inspected
   results it received, so a leg that never came back looked like a head with no
   rows. It now asserts one result per planned head.
3. **An ordinary payment's pending reason named a resolved base-fee ambiguity**,
   which reads as a data problem it does not have. Only ❹'s date-integrity
   suppression is a reason now; the rest stays in `annotations`.
4. **The case store lost the expense id**, and the summary reported case-grain
   counts only — showing "Pending: 0" beside a note explaining that pending is the
   majority state. Both grains are now reported.

### Not yet tested — needs a live token

The two things pinning cannot exercise: the paginated sweep against real ERP
(including the one-month walk with `pulled = totalElements` asserted, which the
spec requires before a first run) and the identity resolver against the real
detail route. Both are written and unit-covered; neither has met production.

**Test rows left behind:** run ids `r-visa-PINNED-TEST-2026-08-31`,
`r-visa-PINNED-A-happy` and `r-visa-PINNED-B-blocked` in both data tables. They
are obviously labelled and can be dropped before a real run.

**Nothing published, scheduled or activated.** No email was sent — the delivery
node creates a Gmail *draft*, and it was pinned in both test runs.

## What needs a human

1. **A route from a transaction to its maid.** Preferably the list-payload field
   (option 1); failing that, `AddEditTransaction` on the auditing account plus a
   decision on Snowflake-assisted candidate sourcing. Blocks every red verdict.
2. **`VisaProcessingPage` / overstay-fines read**, if the fine-responsibility and
   fine-record evidence are to come from ERP rather than the transaction amount
   alone.
3. **Sign-off before any run against production**, and before publishing or
   scheduling — the spec names **Malaz** as reviewer and requires independent
   review before delivery. Build completion is not approval.
4. **Malaz, at sign-off, not blocking:** ❽'s decisive ruling, the MV-renewal head
   question, and the spec corrections above.
