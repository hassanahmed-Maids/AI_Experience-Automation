# ERP and n8n traps

Every item here was learned by hitting it. Read before Phase 1. Each one is either a
wrong answer already shipped, or a wrong answer caught one step before shipping.

---

## Part 1 — ERP

### A dead token is an HTTP 500, never a 401

```
HTTP 500
{"status":500,"error":"Internal Server Error",
 "message":"Token not valid, {Token is expired}",
 "path":"/accounting/..."}
```

Measured on every surface, 2026-08-19. **No `498` appears in the body and no
`developermessage` header is set** on this shape, despite the response advertising
`access-control-expose-headers: technical, token, captchaId, captchaAttachmentUuid,
SPEED_TEST_REQUIRED, developerMessage`. Match on the string `Token is expired`.

Say "that token is expired, I need a fresh one." Never report it as a server error —
that sends someone to debug ERP for an hour.

### The three denial shapes are different problems with different owners

| shape | means | who fixes it |
|---|---|---|
| `Token is expired` inside a 500 | stale token | the operator, one paste |
| `INSUFFICIENT_PERMISSIONS` | the account lacks the grant | ERP access owner |
| `SecurityException` | the route refuses this role | ERP access owner |
| bare `401` | **wrong pagecode OR missing grant** | you first, then the owner |

A bare 401 is ambiguous by design. Probe the documented pagecode *and* a plausible
alternative before you report a permission problem.

### A wrong pagecode returns 401 silently and looks like a working call returning nothing

The `pagecode` header is required on every ERP call. Getting it wrong does not error
in a way that names the cause.

### Page size is capped below what you ask for

`advancesearchNew` caps a page at **40 rows** while the offset stays `page × size`.
Ask for `size=50` and offsets 40–49 are never requested — the gap is invisible and
reads as an absence. **Walk at `size=40` and assert `pulled == totalElements`
before trusting any absence.**

Related: derive the page list from a cheap `size=1` pre-count rather than relying on
n8n's auto-pagination, and fetch nothing beyond it. `$pageCount` does **not** resolve
inside `jsonBody` — it renders the literal string `undefined` and ERP answers
`NumberFormatException`.

### `contains` 500s where `like` returns 200

On a `description` filter, `operation: "contains"` returns HTTP 500;
`operation: "like"` returns 200. This was recorded for months as a role-permission
block. It was a wrong operator. **Probe the operator before you report a permission.**

### An all-time search must not carry a date filter

Where a check asks "did the money ever come back?", the window truncates the answer.
A charge inside the window is frequently refunded in a later month, so a windowed read
shows a charge with no offsetting reversal and looks like an unrecovered loss. Search
without a date filter, and treat an empty history as evidence **only** when the walk
is provably complete (`pulled == totalElements`). A truncated call is not an absence.

### Reversals: 30%+ of an expense book can be negative

Counting rows without regard to sign counts a refund as a second charge. Match a
reversal to its charge **by reference first**, with a tolerance — the refund fee is
retained so the pair never sums to zero, and exact equal-and-opposite matching finds
almost nothing. A reversal's description is a **verbatim copy** of the charge's and
still quotes the original amount; never read an amount out of description text.

Also: a negative with no in-window positive is normal — its charge sat in an earlier
month. That is not a defect and must not be flagged as one.

### Object-valued fields that look like strings

Picklist fields arrive as objects, not strings. Reading them directly yields
`[object Object]` and every comparison fails silently:

```
ticketOutcome.label     NOT  ticketOutcome
refundReason.label      NOT  refundReason
currency.name           NOT  currency
layover[]               an ARRAY OF picklist objects, read .code or .name per element
```

An empty string is a real value on these fields and does **not** mean the default.

### Rounded sibling fields

Where both `amount` and `amountInAED` exist, they differ on most money-bearing rows —
`amount` is rounded to whole units. Use the precise field. Substituting the rounded
one invents differences that are not there and hides ones that are.

### Empty is not zero

An empty amount means *unresolved*, zero means *cost nothing*. Collapsing them loses
the distinction between "not priced yet" and "priced at nothing", and only the first
changes on a later run.

### An unreadable entity is an outage, not a finding

ERP returns **500, not 404**, for an entity it cannot read. A failed read therefore
says nothing about whether the entity exists. Retry once; if it still fails, record an
infrastructure outcome counted separately from business outcomes. A run that silently
skips its unreachable entities reports a clean month it never checked.

### Identity: never by name

Resolve entities by id. Where an id must be parsed out of free text, keep the
per-record detail call as a **fallback for the rows that fail to parse** — making it
unconditionally can cost hundreds of calls a month and blow the run budget on its own.
Plural array paths are common (`applicants[0].applicant.id`) with **no** top-level
singular key; the singular path returns null on every row and empties the population
while the run reports success.

### A population filter that looks correct while losing cases

Filtering on a type/status enum instead of the documented discriminator can silently
drop genuine records — measured: a type filter agreed with the real discriminator on
381 of 387 rows and lost 5 cases. Use the discriminator; use the enum only to
corroborate, and route the disagreements for review rather than dropping them.

### Recount the call budget yourself

Specs routinely cost only the population sweep and omit per-entity enrichment.
Multiply properly: per-entity calls × population. A spec figure derived from a
**sample** of the population understates the real cost by the sampling ratio —
measured once at 5–10×.

---

## Part 2 — n8n

### `success` means it did not crash

It does not mean it did the right thing. **Read the node output back every time.** A
run that finished in 0.45s for seven production HTTP calls did not make them.

### Use full-response mode so a denial is data, not an error rail

`fullResponse: true` + `neverError: true` on every ERP call. Then a 401/500 is an item
you can classify and record, not an exception that skips your guard. Classify the
denial shape in code and abort with a message that names the cause.

### A node that emits zero items takes the rest of the chain with it

Downstream nodes are skipped, the workflow reports **success**, and nothing was
scored. Any node that can legitimately produce nothing must either emit a sentinel and
branch on it, or sit on a branch that rejoins via Merge. Never leave a
possibly-empty node in the middle of a linear chain.

### Credentials

Assigning a credential in code does not guarantee it binds — and `get_workflow_details`
**strips credentials**, so you cannot verify by reading the workflow back. Verify by
running. A credential can also be valid and still be refused at runtime
(`Authorization failed`), which surfaces only in the node's output.

Where a flow must not hold a credential of its own, take the token as a **runtime
payload** and send it as `authorization` plus the cookie the app sends. Never write it
into a stored credential, never a literal in a header, never into a shell command.

A credential homed in a personal project can bind to a workflow in a team project.
A credential belonging to another person writes artefacts into **their** Drive —
check whose account you are about to create something under.

### Item pairing is positional and silent

When you pair an HTTP node's N responses against the N items that produced them, you
are trusting order. **Assert the counts match and throw if they do not** rather than
pairing by guess — a mismatch otherwise attributes one entity's data to another.

### The SDK is not JavaScript

Workflow-SDK code forbids function declarations, native array methods (`.map`,
`.concat`), and helpers like `JSON.stringify`. Everything must be a literal. Code
**inside** a Code node is normal JS — the restriction is only on the SDK layer.

For large Code bodies, deploy a skeleton then set each `jsCode` via
`setNodeParameter`: the code is a raw tool parameter, so there is no JS-string
escaping to get wrong. Then **hash the deployed bodies against your tested source**
and fix any drift.

### `get_execution` with a node filter returns only those nodes

Other nodes then appear absent. That is the filter, not the run. Do not conclude a
node did not execute from a filtered fetch.

### Data Table upsert needs a `filters` object

Without it the node always inserts. And a Data Table is project-scoped — a workflow in
another project cannot read it.

---

## Part 3 — The false clearances to expect

These are the failures worth designing against, because they look like success.

1. **A later stage recomputes a verdict and drops an earlier routing decision.**
   Record case-level escalations as *data* and re-apply them in every stage that
   recomputes. Observed: a case routed to review came back clean.
2. **A gate that returns on its first match masks the gate after it.** Where two
   tests can both apply to one entity, evaluate both and let the more severe win.
   Observed: a duplicate-detection gate was never reached.
3. **A one-limb reading of a two-limb condition silently excludes records.**
   Observed: dropping money-less rows on the amount alone removed an unpriced loss
   from scoring entirely — no verdict, no counter.
4. **A NULL comparison is indistinguishable from a genuine match.** Default every
   unknown toward review, never toward clean.
5. **An explained finding gets deleted from the total.** Explaining why money went
   out does not un-spend it. Keep money-out, explained, and unrecovered as three
   figures that reconcile.
6. **A guard that fires on a correctly-handled case.** Over-flagging is cheaper than
   false clearance but it is not free — it buries the real findings. Observed: 15 of
   19 review cases were one guard misfiring.
7. **A verifier-dependent figure quoted as a hard number.** Deterministic figures
   reproduce exactly across runs; model judgements do not. Measured on one check:
   identical population and money-out across two runs, with the *unrecovered* figure
   moving 13%. Label which is which.
