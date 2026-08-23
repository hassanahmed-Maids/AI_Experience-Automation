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
constant and repository signature must come from the code first, cited.

How much that matters, concretely: drafting the contract example below, two assumptions
that *felt* safe were both wrong. There is no `ContractProspectType` enum with a
`MAID_VISA` constant (CC/MV is a picklist **code** join), and `Contract` has **no**
soft-delete or test-data column at all. A prompt written from memory would have specified
both and got a confidently wrong endpoint.

## The established SpEL convention — follow it

Every committed dynamic API in the ERP uses one shape (`SetupDynamicApis.java` in
client-management, accounting, visa-processing):

```
T(com.magnamedia.core.Setup).getApplicationContext().getBean('beanName').method(_entityId_)
```

Real examples, verbatim:

```java
// magnamedia-client-management/.../service/SetupDynamicApis.java:52
api.setExpression("T(com.magnamedia.core.Setup).getApplicationContext().getBean(\"ccAppContentHelper\").fetchReplaceOrHireMaidVisibility(_entityId_)");
// magnamedia-visa-processing/.../module/SetupYAYAFaqDynamicApis.java:22
api.setExpression("!T(com.magnamedia.core.Setup).getApplicationContext().getBean('housemaidService').isEidAndPassportReceived(_entityId_)");
```

Notes that matter:

- **`T(...)` is the convention, not a smell.** `T(com.magnamedia.core.Setup)` is not on the
  prohibited-classes list. Judge a type reference by *what it names* (Phase 3b).
- **`_entityId_` / `_entityType_` are runtime-injected context keys**, referenced **bare**
  (not `#_entityId_`) because the context map is the root object with a `MapAccessor`
  registered. Never name a parameter either of those.
- Both `'bean'` and escaped `\"bean\"` quoting work.
- A `@beanName` form also resolves (a `BeanFactoryResolver` is installed) and is used in
  `@Value("#{...}")` projections elsewhere — but **no committed dynamic API uses it**.
  Prefer the proven `getBean(...)` form.

### Two gaps you are stepping into

Searched across all modules: **no committed dynamic API calls a `*Repository` bean, and
none returns a `List`.** Every example wraps a *service/helper* bean and returns a scalar
for a single `_entityId_`. A bulk list-in/rows-out API is therefore **a new pattern**, not
a variation on an existing one. That is allowed, but it means:

- Say so when you propose it, and expect more review, not less.
- Keep the expression as small as it can be. A long expression in an unvalidated,
  untyped string is the worst place in this system to put logic.
- If the expression starts needing real branching, that is the signal to add a typed,
  tested **service method** in the owning module and let the dynamic API be a one-line
  wrapper over it — matching every existing example. That costs a deploy; weigh it
  against the risk rather than defaulting to the string.

### The lazy-loading hazard — read before designing the field list

`evaluateApi` is **not** `@Transactional` (`docs/lcp-dynamic-apis.md` §5). So an
expression that touches a **LAZY** association can throw `LazyInitializationException`,
and one that touches associations per row re-introduces the N+1 you are trying to delete.

Practical rule: **return own-table scalar columns**, plus ids of `@ManyToOne`
associations, which default to EAGER and are already loaded. The moment a field requires
walking a LAZY association, it belongs in a repository `@Query` projection with an
explicit join — a Java change to propose separately, not something to smuggle into a
string.

## Anatomy of the prompt

Nine sections. Dense beats prose; the model does better with exact names.

1. **Purpose, one line** — what it returns, for whom, at what cardinality.
2. **Read-only, as a constraint.** State it even though published APIs are write-guarded;
   the guard misses `EntityManager` mutations and you want the intent on record.
3. **Input** — parameter name, `type`, `parameterType: BODY`, `required`. One collection.
4. **Output** — exact JSON field names and types, one object per entity, and what happens
   to ids that don't resolve.
5. **The grounded logic** — entity, table, PK; the repository method's exact signature;
   every enum constant with its **stored** value; each output field mapped to its source.
   Cited.
6. **Mandatory filters** — or an explicit statement that there are none. "None" must be a
   finding from the code, never an omission.
7. **Shape constraints** — one repository call, scalar projection, no lazy walking.
8. **Edge cases** — unknown id, nulls, duplicates, empty list, ordering, numeric widening.
9. **The closing instruction** — verify every name against current code, cite `class:line`,
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

Grounded 2026-08-23, ask-code session 44663 (`work/lcp-dynamic-apis/raw/qA-contract-grounding.md`).

**Ground truth established first:**

| Fact | Value |
|---|---|
| Owning module | `magnamedia-client-management` (alias `erp/magnamedia-client-management`) — `Contract.java` is duplicated across **7 modules**; this is the canonical `@Entity`, 4,937 lines |
| Table | **`CONTRACTS`** (`@Table` has no explicit `name`; inferred from the `@Formula` bodies, `Contract.java:73-75`) |
| PK | field `id`, column **`ID`** (`BaseEntity.java:104-110`) |
| Repository | `com.magnamedia.repository.ContractRepository`, bean **`contractRepository`** |
| Bulk method (exists) | `List<Contract> findAllByIdIn(ArrayList<Long> Ids)` — `ContractRepository.java:216`. Note the **concrete `ArrayList`** parameter type |
| `status` | `ContractStatus`, `@Enumerated(STRING)` → stored as constant name. Constants: `FILTER_ACTIVE, ACTIVE, CANCELLED, EXPIRED, UNKNOWN, PLANNED_RENEWAL, FILTER_CANCELED, FILTER_INCOMPLETE_DOCUMENTS, FILTER_BLOCKED, PENDING_RENEWAL, CANCELLED_RENEWAL, POSTPONED` |
| `contractType` | `ContractType`, `@Enumerated(STRING)`. Constants: **`LONG_TERM, SHORT_TERM` only** — this is *not* CC/MV |
| CC vs MV | **`contractProspectType`, a `PicklistItem` FK, matched by `.getCode()`**: CC = `maids.cc_prospect`, MV = `maidvisa.ae_prospect`. **No `MAID_VISA` enum exists.** Declared `fetch = LAZY` (`Contract.java:555-557`) ⇒ excluded from v1, see below |
| Soft delete / test data | **None.** No `deleted`/`active`/`archived`, no `fake`/`isTest`/`dummy`, on `Contract` or its base classes. Rows are hard-deleted |
| Eager associations | `client` and `housemaid` are `@ManyToOne` with default **EAGER** fetch (`Contract.java:277-281`) ⇒ their ids are safe to read |

**Scope decision:** v1 returns own-table scalars plus the two eager association ids. It
**excludes** CC/MV, because `contractProspectType` is LAZY and `evaluateApi` is
non-transactional — reading it per row risks `LazyInitializationException` and an N+1.
Getting CC/MV needs a repository `@Query` projection joining
`contractProspectType.code`, which is a Java change to propose on its own merits.

### The prompt — paste as `user_query`

> Create a **read-only** bulk API for an internal audit process.
>
> **Purpose.** Given a list of contract ids, return one row per contract with core
> contract fields, so an audit check can fetch thousands of contracts in a few calls
> instead of one HTTP request per contract.
>
> **Read-only — this is a hard requirement.** The expression must perform no writes: no
> `save`, `saveAndFlush`, `delete`, `persist`, `merge` or `remove`; no JPQL or native
> `UPDATE`/`DELETE`; no outbound HTTP; no scheduling. It reads and returns data only.
>
> **Module.** `magnamedia-client-management`. This matters: `Contract.java` exists in
> seven modules and only the client-management copy is the canonical `@Entity`
> (`magnamedia-client-management/src/main/java/com/magnamedia/entity/Contract.java`,
> class `com.magnamedia.entity.Contract`, table `CONTRACTS`, primary key column `ID`
> inherited from `BaseEntity`).
>
> **Input.** One parameter:
> - name `contractIds`, type `json`, parameterType `BODY`, required `true` — a JSON array
>   of numeric contract ids.
>
> Do not use the names `_entityId_` or `_entityType_`; those keys are injected by the
> runtime.
>
> **Data access.** Use the existing repository method
> `List<Contract> findAllByIdIn(ArrayList<Long> Ids)` on
> `com.magnamedia.repository.ContractRepository`
> (`magnamedia-client-management/src/main/java/com/magnamedia/repository/ContractRepository.java:216`),
> reached with the established convention
> `T(com.magnamedia.core.Setup).getApplicationContext().getBean('contractRepository')`.
> Exactly **one** repository call for the whole input list — never one call per id.
>
> **Numeric widening — handle this explicitly.** A JSON array of numbers deserialises to
> `Integer` values, but `findAllByIdIn` expects an `ArrayList<Long>`. Convert every
> element to `Long` before the call, and make the conversion tolerant of values arriving
> as `Integer`, `Long` or numeric `String`.
>
> **Output.** A JSON array with one object per contract **found**, each with exactly these
> keys:
> - `id` (number) ← `id`
> - `uuid` (string, nullable) ← `uuid` (column `_UUID`)
> - `status` (string, nullable) ← `status`, as its **enum constant name** (it is
>   `@Enumerated(STRING)`; valid values are `FILTER_ACTIVE, ACTIVE, CANCELLED, EXPIRED,
>   UNKNOWN, PLANNED_RENEWAL, FILTER_CANCELED, FILTER_INCOMPLETE_DOCUMENTS,
>   FILTER_BLOCKED, PENDING_RENEWAL, CANCELLED_RENEWAL, POSTPONED`)
> - `contractType` (string, nullable) ← `contractType`, enum constant name (`LONG_TERM` or
>   `SHORT_TERM`)
> - `clientId` (number, nullable) ← `client.id`
> - `housemaidId` (number, nullable) ← `housemaid.id`
> - `startOfContract` (ISO-8601 date string, nullable) ← `startOfContract`
> - `endOfContract` (ISO-8601 date string, nullable) ← `endOfContract`
> - `adjustedEndDate` (ISO-8601 date string, nullable) ← `adjustedEndDate`
> - `cancelledContract` (boolean, nullable) ← `cancelledContract`
> - `cancelledDate` (ISO-8601 date string, nullable) ← `cancelledDate`
> - `dateOfCancellation` (ISO-8601 date string, nullable) ← `dateOfCancellation`
> - `dateOfTermination` (ISO-8601 date string, nullable) ← `dateOfTermination`
>
> Return these **raw stored values**. Do not derive, translate or summarise them, and do
> not add computed flags — the calling audit check applies its own rules.
>
> **Return scalars only — do not return managed entities.** Build a plain list of
> maps/objects containing only the keys above. Returning `Contract` instances would
> serialise a very large entity graph.
>
> **Do not touch `contractProspectType`.** It is declared `fetch = LAZY`
> (`Contract.java:555-557`) and this API runs outside a transaction, so reading it per row
> risks `LazyInitializationException` and per-row lazy queries. `client` and `housemaid`
> are `@ManyToOne` with default EAGER fetch, so reading their ids is safe.
>
> **Filters.** None. `Contract` has no soft-delete, `deleted`, `active`, `archived`,
> `fake`, `isTest` or `dummy` column, on the entity or its base classes — verify this and
> if you find such a column, apply it and say so. Do not filter by status: the caller
> needs cancelled and expired contracts too.
>
> **Edge cases.**
> - An id with no matching contract is simply absent from the output — do not emit a
>   placeholder and do not fail the call.
> - Null columns produce `null` values, not omitted keys or empty strings.
> - Duplicate ids in the input produce at most one row each.
> - An empty or absent `contractIds` returns an empty array, without a repository call.
> - Order the output by `id` ascending, so results are deterministic.
>
> **Do not reference `Parameter`, `CoreParameter` or `BackgroundTask`** anywhere in the
> expression — those tokens are rejected at evaluation.
>
> **Before writing the expression, verify every entity, field, column, enum constant and
> repository signature above against the current code, and cite class:line for each. If
> any name here does not match the code, stop and report the mismatch rather than
> substituting a similar one.**

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
