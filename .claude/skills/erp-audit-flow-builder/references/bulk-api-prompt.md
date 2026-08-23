# Writing the prompt for a purpose-built bulk API (Phase 3b)

Companion to Phase 3b. Platform mechanics, limits and the full rule set live in
`docs/lcp-dynamic-apis.md` (AI_Experience-Automation repo). This file covers the one
thing that determines whether you get a usable endpoint — **the prompt** — plus the
review you must do on what comes back, and a worked grounded example.

## Why the prompt carries all the weight

Creation is `POST /lowcode/apis/async?applicationId=N` with a natural-language
`user_query`. An external AI service turns that into a SpEL expression and a handler
persists it. Nothing between your prompt and a live endpoint validates the expression —
no allowlist, no parse-check, no reviewer; the DTO has zero validation annotations.

So the prompt is not a request, it is a specification, and **an ungrounded prompt buys a
confidently wrong endpoint** — one returning plausible rows built on a column that
doesn't exist or an enum stored differently than you assumed. Every field name, enum
constant, column and query path must come from the code first, cited.

How much that matters, concretely: drafting the contract example below, two assumptions
that *felt* safe were both wrong. There is no `ContractProspectType` enum with a
`MAID_VISA` constant (CC/MV is a picklist **code** join), and `Contract` has **no**
soft-delete or test-data column at all. A prompt written from memory would have specified
both and got a confidently wrong endpoint.

## The established SpEL convention — follow it

Two families exist. Read both before writing a prompt.

**1. The hand-registered one-liner** (`SetupDynamicApis.java`, client-management /
accounting / visa-processing) — wraps a service bean, returns a scalar for one entity:

```java
api.setExpression("T(com.magnamedia.core.Setup).getApplicationContext().getBean('housemaidService').isEidAndPassportReceived(_entityId_)");
```

**2. The AI-generated, list-returning one** — read live from the platform 2026-08-23
(`GET /lowcode/apis/{apiId}`; copies in `work/lcp-dynamic-apis/real-examples/`). This is the
family a bulk audit API belongs to, and it is far more capable than the first suggests.
Verbatim skeleton from a real, accepted definition (`getprecolllistrenewalupdated_cloned`,
id 27629, module `clientmgmt`):

```
#root['currentDate'] != null && !#root['currentDate'].toString().isEmpty() ?
T(com.magnamedia.core.helper.SelectQuery)
.builder(
  'SELECT DISTINCT ddgp FROM DirectDebitGenerationPlan ddgp ' +
  'LEFT JOIN FETCH ddgp.contract c ' +
  'LEFT JOIN FETCH c.client cl ' +
  'WHERE DATE(ddgp.ddSendDate) = :targetDate ' +
  'AND c.status = :contractStatus ' +
  'AND (c.contractProspectType IS NULL OR c.contractProspectType.code != :ccProspectCode) ' +
  'ORDER BY cl.id ASC, c.id ASC',
  'SELECT COUNT(DISTINCT ddgp.id) FROM DirectDebitGenerationPlan ddgp ... ',
  T(com.magnamedia.entity.DirectDebitGenerationPlan),
  { 'contractStatus': T(com.magnamedia.module.type.ContractStatus).ACTIVE,
    'ccProspectCode': 'maids.cc_prospect' }
)
.withTotalCount(true)
.build()
.execute(T(org.springframework.data.domain.PageRequest).of(
   #root['page'] != null ? T(java.lang.Integer).parseInt(#root['page']) : 0,
   #root['size'] != null ? T(java.lang.Integer).parseInt(#root['size']) : 20))
.getContent()
.![{ 'clientId': contract.client.id, 'contractId': contract.id,
     'maidSalary': contract.workerSalary }]
: {'error': 'currentDate is required (format: yyyy-MM-dd)'}
```

Everything that matters is in there:

- **`T(com.magnamedia.core.helper.SelectQuery).builder(jpql, countJpql, entityType, params)`**
  — the idiomatic way to run a real query from an expression. Use it instead of trying to
  call a repository finder and post-filter.
- **`LEFT JOIN FETCH`** loads associations *inside the query*. This is the correct answer to
  the lazy-loading hazard below — not avoidance.
- **`.![{ ... }]`** is SpEL's collection-projection operator, mapping each row to a map. This
  is how you return a projection without a Java change.
- **Pagination is conventional**, via `context.page` / `context.size` and `PageRequest.of`,
  defaulting to 0 / 20, with `.withTotalCount(true)`.
- **A guard clause returning `{'error': '...'}`** for missing required input.
- **`T(...)` and `new` both appear in production** — `T(java.lang.Long).parseLong`,
  `T(java.util.Date)`, `T(java.time.ZoneId)`, even
  `new java.text.SimpleDateFormat('yyyy-MM-dd')`. So neither is a smell on its own; judge the
  **type being named** against the prohibited list.
- A third bean idiom also appears:
  **`T(com.magnamedia.core.Setup).getRepository(T(com.magnamedia.repository.ContractRepository))`**
  — type-safe and cleaner than `getBean('name')` when you want a repository.

### Parameter naming — the detail that will bite you

In a real definition, BODY parameters are **declared** with a `context.` prefix and **read**
without it:

| Declared `name` | `parameterType` | Read in SpEL as |
|---|---|---|
| `context.currentDate` | `BODY` | `#root['currentDate']` |
| `context.page`, `context.size` | `BODY` | `#root['page']`, `#root['size']` |
| `code` | `QUERY` | (the runtime's own lookup key) |
| `entityId`, `entityType` | `BODY` | `#root['_entityId_']` / injected |
| `Content-Type` | `HEADER` | — |

So: **declare `context.<name>`, read `#root['<name>']`.** The hand-written examples use bare
`_entityId_` (the map root plus `MapAccessor` makes both work), but every AI-generated
definition uses the explicit `#root['...']` form — prefer it, it is unambiguous.

**The declared `type` is free-form, and real definitions exploit that.** `GET
/lowcode/apis/parameters-types` offers `String, int, long, boolean, double, float, date, time,
datetime, timestamp, json`, but that is only what the UI suggests — the column is a plain
`String(50)`, unvalidated, and live definitions carry `List<FilterItem>`, `String or Number`,
`String or Integer`. It is documentation for the caller, not a constraint. Use a descriptive
value (`List<Long>` reads better than `json` for an id list) and remember **nothing enforces
it** — validate inside the expression or in the caller.

### Do you actually want an id list? Check the precedent first

Surveyed 85 live dynamic APIs (the whole dynamic population in the last ~600 rows). Of the
list-returning ones, **8 of 9 sampled use `SelectQuery` + `.![...]`** — so that skeleton is the
house style, confirmed. But note what they take as *input*:

- **Filter-based is the dominant bulk shape.** They accept scalar filters — a date, a status —
  plus `context.page`/`context.size`, and let the database select the population.
  E.g. `getclientrenewalbatches` filters
  `c.contractProspectType.code = 'maidvisa.ae_prospect' AND c.status = :status AND NOT EXISTS (...)`.
- **A collection parameter is precedented**, via `bulk-payments`: `context.filters` declared
  `List<FilterItem>`, passed straight into a service —
  `getBean(T(com.magnamedia.service.QueryService)).managePaymentsAdvanceSearch(#root['filters'], PageRequest.of(...))`.
- **But no live definition binds a collection into a JPQL `IN :ids`.** That specific step is
  still new ground (standard JPA, but unprecedented here).

**So prefer the filter shape when the check has a population definition** ("all ACTIVE MV
contracts with X") — it is the precedented pattern, it avoids multi-thousand-id request bodies
and client-side chunking, and the DB does the selection. Reach for an id list only when the ids
genuinely come from a previous step and cannot be re-expressed as a filter. Say which you chose
and why.

One syntax detail from the live JPQL: inside a SpEL single-quoted string, a literal single quote
is written **doubled** — `''maidvisa.ae_prospect''`. Prefer a bound parameter over an inline
literal and the problem disappears.

### The lazy-loading hazard — and its real fix

`evaluateApi` is **not** `@Transactional` (`docs/lcp-dynamic-apis.md` §5), so walking a
`fetch = LAZY` association *in the expression* can throw `LazyInitializationException`, and
doing it per row re-introduces the N+1 you came to delete.

The fix, as the real example shows, is **not** to avoid the field — it is to pull it in the
query: `LEFT JOIN FETCH` the association, or filter on it by path
(`c.contractProspectType.code != :code`), then project from the fetched graph. That is why
CC/MV *is* obtainable in one call, contrary to a first reading.

## Anatomy of the prompt

Ten sections. Dense beats prose; the model does better with exact names.

1. **Purpose, one line** — what it returns, for whom, at what cardinality.
2. **Read-only, as a constraint.** State it even though published APIs are write-guarded;
   the guard misses `EntityManager` mutations and you want the intent on record.
3. **Module**, by code (`clientmgmt`, `accounting`, …). It decides which module evaluates the
   expression, and entities are duplicated across modules — so naming it is not optional.
4. **Input** — each parameter as `context.<name>` / `type` / `BODY` / required, plus
   `context.page` and `context.size`. Say whether the shape is a **filter** or an **id list**,
   and why (see the survey above — filter is the precedented default).
5. **Output** — exact JSON keys and types, one object per row, and what happens to input that
   matches nothing.
6. **The grounded logic** — entity, `@Table`, PK; the JPQL to run; every enum constant with its
   **stored** value; each output key mapped to its source field. Cited `class:line`.
7. **Mandatory filters** — or an explicit statement that there are none. "None" must be a
   *finding from the code*, never an omission. (For `Contract`: there is genuinely no
   soft-delete — say so rather than leaving it unaddressed.)
8. **Shape constraints** — one query via `SelectQuery.builder(...)`, `LEFT JOIN FETCH` every
   association you project, `.![{...}]` to map rows, no lazy walking, no managed entities in the
   response.
9. **Edge cases** — no-match input, nulls, duplicates, empty input, deterministic ordering, and
   any type coercion the input needs (e.g. JSON numbers arriving as `Integer` where `Long` is
   wanted).
10. **The closing instruction** — verify every name against current code, cite `class:line`,
    and **stop rather than substitute** on a mismatch.

That last sentence matters most. Without it, a wrong field name in your prompt gets
silently "corrected" to something adjacent and you inherit a bug you specified.

## Return raw values, never derived verdicts

An API returning `isEligible: true` hides which condition fired, making a wrong verdict
unattributable and the endpoint unreusable by the next check.

Domain-specific and load-bearing: **the CC-versus-MaidVisa distinction is not a boolean.**
`docs/decisions.md` (2026-07-07, Cluster-7) records a `contract.type = 'MV'` gate as a
fidelity bug — there is a dual-contract "Both" cohort holding a CC *and* a MaidVisa
contract, plus a blank cohort, and gating on type silently dropped them. Return the stored
value and let the check decide. Same for dates: return the date, not `expired: true`.

## Worked example — bulk contract core read

Grounded 2026-08-23, ask-code session 44663, plus two real live definitions read from the
platform (ids 27626, 27629 — `work/lcp-dynamic-apis/real-examples/`).

**Ground truth:**

| Fact | Value |
|---|---|
| Owning module | `magnamedia-client-management`, module code **`clientmgmt`**, alias `erp/magnamedia-client-management`. `Contract.java` is duplicated across **7 modules**; this is the canonical `@Entity` |
| Table / PK | `CONTRACTS` / column `ID` (`BaseEntity.java:104-110`) |
| Repository | `com.magnamedia.repository.ContractRepository`, bean `contractRepository` |
| `status` | `ContractStatus`, `@Enumerated(STRING)`: `FILTER_ACTIVE, ACTIVE, CANCELLED, EXPIRED, UNKNOWN, PLANNED_RENEWAL, FILTER_CANCELED, FILTER_INCOMPLETE_DOCUMENTS, FILTER_BLOCKED, PENDING_RENEWAL, CANCELLED_RENEWAL, POSTPONED` |
| `contractType` | `ContractType`, `@Enumerated(STRING)`: **`LONG_TERM, SHORT_TERM` only** — *not* CC/MV |
| CC vs MV | `contractProspectType` → `PicklistItem`, matched by **`.code`**: CC = `maids.cc_prospect`, MV = `maidvisa.ae_prospect`. Declared LAZY, so reach it via **JPQL join**, not entity walking. Confirmed in a live definition: `AND (c.contractProspectType IS NULL OR c.contractProspectType.code != :ccProspectCode)` |
| Soft delete | **Contested — verify before relying on it.** ask-code says `Contract` in client-management has no `deleted`/`active`/`archived` and no test/fake column. But live API 27626 (module **accounting**) calls `contract.getDeleted()`. The entity is duplicated per module, so the accounting copy may carry a flag the client-management copy lacks. **Confirm against `clientmgmt` before deciding whether to filter**, and say which you did |

### Variant A — the id-list shape, paste as `user_query`

> **Read Variant B below first.** A is written out in full because it is the longer text, but the
> filter shape is the precedented default — use A only when the ids genuinely come from a prior
> step.

> Create a **read-only** bulk API for an internal audit process.
>
> **Purpose.** Given a list of contract ids, return one row per contract with core contract
> fields, so an audit check can fetch thousands of contracts in a few paginated calls instead
> of one HTTP request per contract.
>
> **Read-only — hard requirement.** No `save`, `saveAndFlush`, `delete`, `persist`, `merge`,
> `remove`; no JPQL or native `UPDATE`/`DELETE`; no outbound HTTP; no scheduling. Read and
> return only.
>
> **Module.** `clientmgmt` (`magnamedia-client-management`). This matters: `Contract` exists in
> seven modules and only the client-management copy is the canonical `@Entity`
> (`com.magnamedia.entity.Contract`, table `CONTRACTS`, PK column `ID` from `BaseEntity`).
>
> **Follow the established pattern for a list-returning dynamic API in this platform**, as in
> the existing definition `getprecolllistrenewalupdated_cloned`: build the query with
> `T(com.magnamedia.core.helper.SelectQuery).builder(<jpql>, <countJpql>, T(<EntityClass>),
> <paramsMap>).withTotalCount(true).build().execute(T(org.springframework.data.domain.PageRequest).of(page, size)).getContent()`
> and then map rows with the SpEL collection-projection operator `.![{ ... }]`.
>
> **Input parameters** — declare each BODY parameter with the `context.` prefix and read it as
> `#root['<name>']`:
> - `context.contractIds` — type `json`, BODY, **required**: a JSON array of numeric contract ids.
> - `context.page` — type `int`, BODY, optional, default `0`.
> - `context.size` — type `int`, BODY, optional, default `200`.
>
> Do not declare parameters named `_entityId_` or `_entityType_`; the runtime injects those keys.
>
> **Query.** One JPQL query over `Contract` filtered by `c.id IN :ids`. Use
> `LEFT JOIN FETCH` for `c.client`, `c.housemaid` and `c.contractProspectType` so no association
> is resolved lazily outside a transaction — this API is not transactional, so a lazy walk would
> throw `LazyInitializationException` and cause per-row queries. Order by `c.id ASC` so results
> are deterministic. Provide the matching `SELECT COUNT(DISTINCT c.id)` count query.
>
> **Id conversion — handle explicitly.** A JSON array of numbers deserialises to `Integer`
> values, but the ids are `Long`. Convert every element to `Long` before binding it to `:ids`,
> tolerating elements that arrive as `Integer`, `Long` or numeric `String`.
>
> **Output.** A list with one object per contract found, each with exactly these keys, as
> **raw stored values** — do not derive, translate or summarise, and add no computed flags:
> - `id` ← `c.id`
> - `uuid` ← `c.uuid` (column `_UUID`)
> - `status` ← `c.status` as its **enum constant name** (`@Enumerated(STRING)`; values listed
>   below)
> - `contractType` ← `c.contractType` as its enum constant name (`LONG_TERM` or `SHORT_TERM`)
> - `prospectTypeCode` ← `c.contractProspectType?.code` — the **raw picklist code**
>   (`maids.cc_prospect` for CC, `maidvisa.ae_prospect` for MaidVisa). Return the code itself,
>   **not** a derived `isMaidVisa` boolean: a client can hold both a CC and a MaidVisa contract,
>   and collapsing that to a flag loses the distinction the caller needs.
> - `clientId` ← `c.client?.id`
> - `housemaidId` ← `c.housemaid?.id`
> - `startOfContract`, `endOfContract`, `adjustedEndDate` ← the corresponding fields, ISO-8601
>   dates or null
> - `cancelledContract` ← `c.cancelledContract` (Boolean, nullable)
> - `cancelledDate`, `dateOfCancellation`, `dateOfTermination` ← corresponding dates or null
>
> Valid `status` values: `FILTER_ACTIVE, ACTIVE, CANCELLED, EXPIRED, UNKNOWN, PLANNED_RENEWAL,
> FILTER_CANCELED, FILTER_INCOMPLETE_DOCUMENTS, FILTER_BLOCKED, PENDING_RENEWAL,
> CANCELLED_RENEWAL, POSTPONED`.
>
> **Return maps, not entities.** Project with `.![{ ... }]`; returning `Contract` instances
> would serialise a very large entity graph.
>
> **Filters.** Do **not** filter by status — the caller needs cancelled and expired contracts
> too. And apply **no soft-delete filter**: `Contract` has no `deleted`/`isDeleted`/`active`/
> `archived` field in any module, and neither does its base chain
> (`BaseEntityWithAdditionalInfo → BaseEntity → BaseEntityParent`). Contracts are hard-deleted,
> so a missing row *is* the deletion. Do not invent a `getDeleted()` call — no such method
> exists on `Contract`.
>
> **Edge cases.**
> - An id with no matching contract is simply absent from the output — no placeholder, no error.
> - Null columns produce `null`, not omitted keys or empty strings.
> - Duplicate ids produce at most one row each (`SELECT DISTINCT`).
> - An empty or absent `contractIds` returns an empty list, without running the query — guard
>   with a clause returning `{'error': 'contractIds is required and must be a non-empty array'}`
>   only when the parameter is missing entirely, matching the guard style of the existing
>   definitions.
>
> **The substrings `Parameter`, `CoreParameter` and `BackgroundTask` must not appear anywhere in
> the expression** — not as a type, a method name, an identifier, or inside a string literal.
> `DynamicApiUtil.enforceSpelExpressionRestrictions` is a naive `String.contains` check, so
> `getParameter`, `RequestParameter` or a variable named `parameter` all trip it. It throws
> `SecurityException` at **call** time, and it is absent from every save path — so a violation
> persists and publishes cleanly and only fails when someone calls the API.
>
> **Before writing the expression, verify every entity, field, column, enum constant and
> repository signature above against the current code, and cite class:line for each. If any
> name here does not match the code, stop and report the mismatch rather than substituting a
> similar one.**

### Variant B — the filter shape (prefer this when the check defines a population)

The prompt above takes an id list, which is the right shape only when the ids genuinely arrive
from a previous step. When the check can *describe* its population — which is usually — use the
precedented filter shape instead. It's the same prompt with two sections swapped:

**Replace the input section with:**

> **Input parameters** — declare each with the `context.` prefix, read as `#root['<name>']`:
> - `context.status` — type `String`, BODY, optional: a `ContractStatus` constant name. When
>   absent, do not filter on status.
> - `context.prospectTypeCode` — type `String`, BODY, optional: a `contractProspectType` picklist
>   code (`maids.cc_prospect` for CC, `maidvisa.ae_prospect` for MaidVisa). When absent, do not
>   filter on prospect type.
> - `context.page` — type `int`, BODY, optional, default `0`.
> - `context.size` — type `int`, BODY, optional, default `200`.

**Replace the query section with:**

> **Query.** One JPQL query over `Contract`, with each filter applied only when its parameter is
> supplied — use the `(:param IS NULL OR <predicate>)` idiom so one query serves every
> combination. Filter prospect type by **path** (`c.contractProspectType.code = :prospectTypeCode`),
> which joins rather than lazily loading. `LEFT JOIN FETCH` `c.client`, `c.housemaid` and
> `c.contractProspectType` for the projected fields. Order by `c.id ASC`. Provide the matching
> `SELECT COUNT(DISTINCT c.id)` count query and enable `.withTotalCount(true)`, so the caller can
> page deterministically and know when to stop.

Everything else — output keys, read-only constraint, no soft-delete filter, the forbidden
substrings, the closing verification instruction — is unchanged.

**Why this is usually the better trade.** The caller sends a small body and pages until the total
is exhausted, instead of enumerating ids first and shipping thousands back. It also removes the
one genuinely unprecedented step in Variant A: binding a collection into a JPQL `IN :ids`. And it
keeps the population definition in one place — the API — rather than split between the flow that
built the id list and the API that consumed it.

**Its risk, which Variant A doesn't have:** a filter is a *claim about the population*, so a
wrong predicate silently changes who gets audited. Reconcile the total against an independent
count before trusting it (Phase 2's completeness guard), and never let the filter drift from the
spec's population definition without saying so.

### Before you submit: confirm you can

Verified 2026-08-23 — our own ERP token **authenticates but is not authorised** for any
`/lowcode/apis/*` management endpoint (`developermessage: API_NOT_FOUND_FOR_PAGE`). The
`lc_conversation` page grants the ask-the-code *chat* surface only: not create, not
`test-spel`, not reading back the generated `spel`, not publish. Details and the re-runnable
probe: `docs/lcp-dynamic-apis.md` §8b.

So today this prompt's destination is **whoever holds the Low-Code console grant**, and the
review checklist below is what you ask them to apply. Once the grant exists for our account,
the call is:

### Create call

```
POST /lowcode/apis/async?applicationId=<valid id>
Content-Type: application/json

{
  "workflow_type": "spel",
  "module_selection": "erp/magnamedia-client-management",
  "user_query": "<the prompt above>",
  "name": "audit-contracts-core-bulk",
  "branch": "master",
  "deep_prompt_enhancement": false,
  "version": "1.0"
}
```

Get a valid `applicationId` from `GET /lowcode/apis/list/{appId}`. The response is a
`WorkflowAck` with a `request_id` and `conversation_id` — **not** an API id; the row
appears asynchronously.

## Reviewing what comes back — non-negotiable

Nothing validated the expression, so this is the entire safety net.

**Why this is not optional.** Live definition 27626 carries **three** independent fatal defects:
a forbidden `CoreParameter` token (throws on every call), a `.getDeleted()` call on `Contract`
where no such method exists, and fourteen redundant re-executions of `findByUuid` for one
response. It was created, persisted and published without anything objecting. Nothing on the
write path checks the token list, and nothing anywhere type-checks the expression.

1. `GET /lowcode/apis/{apiId}` and **read the `spel` field**.
2. Check it against the spec: right repository method, one call not a loop, scalar
   projection not entities, `contractProspectType` untouched, ids widened to `Long`.
3. **Reject on sight**: `new`, anything reflective, any bean call that isn't a read, any
   `T(...)` naming a prohibited class (Runtime, ProcessBuilder, System, Class,
   reflect.Method, reflect.Field, File, FileInputStream, FileOutputStream, Files, Paths),
   and any reference to `Parameter`, `CoreParameter` or `BackgroundTask`. A
   `T(com.magnamedia.core.Setup)` bean lookup is the sanctioned convention — that one is
   expected.
4. `POST /dynamicApi/validateSpel` and treat any prohibited-class hit as a hard stop. The
   platform never calls this automatically; skip it and nobody checks.
5. **Reconcile against Phase 2.** Run it on a handful of ids you already fetched
   per-contract and compare field by field. **Same ids, same values.** A bulk endpoint
   that disagrees with the single-entity route is the endpoint that's wrong — and finding
   that out after the full run means re-running the check.

To change behaviour use `POST /lowcode/apis/edit-by-ai/async/{apiId}` (or `fix-by-ai`
after a failure). `PUT /apis/{apiId}` **cannot** change the expression — it edits only
name, category and description.

## Calling it

```
POST /admin/dynamicApi/evaluateApi?code=<code>
Content-Type: application/json

{ "context": { "contractIds": [ ... ] } }
```

- **Verify the `code` you actually got.** A near-duplicate name is silently suffixed
  `_1`, and calling the wrong one returns plausible rows from a different definition.
- **Chunk it** — ~200 ids is a working default. There is no row cap, result-size cap,
  query timeout or rate limit anywhere in this path; your loop is the only bound.
- Keep the existing pacing (5 concurrent, 500 ms between batches). Fewer, larger calls
  still deserve pacing.
- **Reconcile counts every batch**: ids sent vs rows returned vs ids unresolved. A silent
  shortfall is a population gap, and Phase 7 requires it explained.
- On failure the endpoint returns `Can't evaluate API - <root cause>`, which leaks the
  underlying message — log it to the working file, not to chat.

## Never debug-run one returning sensitive fields

`POST /apis/{apiId}/debug/async` writes full request and response bodies to
`api_debug_log`, unmasked, with no retention policy, and Envers mirrors it. That data
would outlive the run somewhere nobody watches. Keep such fields out of the API entirely —
which is why the example above returns ids and dates, and no names, contacts or amounts.
