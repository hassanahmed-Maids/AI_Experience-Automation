# LCP dynamic APIs — how they're built, what they can do, and the rules we must comply with

**Why we care.** An audit check that needs one ERP request per contract does not scale: the audit
playbook's pacing rule is max 5 concurrent + 500 ms between batches, so a few thousand contracts is
an hours-long run with thousands of chances to fail halfway. A purpose-built bulk endpoint collapses
that into a handful of calls. The Low Code Platform (LCP) can define APIs as **data** rather than
deployed Java, which is the mechanism we want.

**Provenance.** Interrogated 2026-08-23 via ask-the-code (sessions 44653–44662). Every claim is
traceable to a cited `class:line`; raw answers in `work/lcp-dynamic-apis/raw/`. Two questions came
back honestly negative because the code sat in a module the session couldn't see; both were re-asked
across modules rather than accepted, per the module-visibility hazard in `docs/code-llm-api.md` —
which is how the runtime and the sandbox were eventually found. **New module aliases discovered and
verified: `erp/magnamedia-core` and `erp/magnamedia-admin`** (added to `docs/code-llm-api.md`).

---

## 0. Executive summary — the honest version

1. **Creating a dynamic API is a prompt, not a code change.** `POST /lowcode/apis/async` sends a
   natural-language `user_query` to an external No-Code AI service; a Kafka handler writes the
   returned SpEL expression into an `LcApi` row. No Java is generated, nothing is committed, no PR
   is opened, and **there is no review or approval gate**.
2. **The SpEL engine is not sandboxed.** It is a stock `StandardEvaluationContext` with a
   `BeanFactoryResolver` attached — `T(...)` type references, `new`, reflection and
   **arbitrary Spring beans** are all reachable. This is a remote-code-execution-shaped surface,
   mitigated by three narrow guards (§6), not by a sandbox.
3. **The platform has a prohibited-classes validator and never calls it.** `DYNAMIC_API_PROHIBITED_CLASSES`
   exists with a sensible 11-class default, but only the opt-in `/dynamicApi/validateSpel` endpoint
   reads it, and that endpoint only *reports* — it doesn't throw. Nothing in create, update, publish
   or evaluate consults it.
4. **Writes are genuinely blocked for published APIs** — the one real, enforced guarantee. A
   published API gets `secured = true` and `canUpdate = null`, which puts SpEL in flag-on mode where
   an AOP aspect throws on repository `save`/`saveAndFlush`/`delete`. Caveats in §6.
5. **There are no limits.** No row cap, no result-size cap, no pagination, no query timeout, no rate
   limiting, no circuit breaker, no collection-size cap, and no response masking anywhere in the
   dynamic path. Bulk reads are bounded only by memory and the database.
6. **So "the security rules an API must comply with" is mostly a question we answer ourselves.**
   Two rules are platform-enforced (§6); the rest is discipline (§10). That is the finding, and it
   is worth taking to the LCP owners rather than quietly relying on.

The good news for the original goal: a bulk contract API is entirely feasible, the mechanism is
well-attributed (every definition stores its generating prompt and full Envers history), and the
per-contract-request problem is solvable. The work is in the prompt and the review, not the plumbing.

## 1. The mechanism in one paragraph

An LCP dynamic API is a row. `LcApi.apiType = DYNAMIC` means the behaviour is a **SpEL** string in
`LcApi.spel`; `STATIC` means the row merely documents a hand-written Java endpoint. You never write
the SpEL through the API — you submit a prompt, the AI writes the expression, a Kafka handler
persists it. Path and method are machine-assigned (always `POST`,
`/admin/dynamicApi/evaluateApi?code=<code>`), so the only identifier we choose is the name, from
which a `code` is derived. At call time **one fixed endpoint** resolves the definition by `code` and
evaluates the expression inside the owning module — there is no per-API route and no custom
`HandlerMapping`.

## 2. Data model (session 44653)

`LcApi` is **not its own table**. It is a `@DiscriminatorValue("API")` subclass in single-table
inheritance rooted at `Component` → table **`lc_component`**, discriminated by `dtype`
(`entity/Component.java:22-33`).

| Field | Column | Meaning |
|---|---|---|
| `apiType` | `api_type` (10) | `STATIC` \| `DYNAMIC` |
| `spel` | `spel` (**LOB**) | **the entire behaviour** when `DYNAMIC` |
| `path` | `path` (500) | **machine-generated** (§4) |
| `method` | `method` (10) | forced to `POST` on create |
| `module` | `module_id` FK | which ERP module evaluates the SpEL — one per API |
| `parameters` | → `lc_api_parameter` | `ApiParameter` children, `orphanRemoval=true` |
| `pageCodeEntities` | → `lc_api_page_code` | page-code links (§7) |
| `publicEndpoint` | `public_endpoint` | **public / no auth** |
| `dirty`, `manualEdit` | not null, false | changed since publish / hand-edited |
| `prompt`, `gPrompt` | LOBs | **the AI prompts that produced it** — the record of intent |
| `headerExample` … `responseSchema`, `signature` | LOBs | documentation payloads |

From `Component`: `name`, `code` (not null, 500), `componentVersion`, `properties` (json),
`application` FK, `subVersionOf`, `deleted`. From `BaseEntity`: `id`, `version`, `creationDate`,
`creator`, `lastModificationDate`, `lastModifier`, `uuid`, `creatorModule`.

**No `enabled`/`active`/`status`/approval column exists on `LcApi`.** Per-environment lifecycle is
the separate `PublishState` enum (`DRAFT | PUBLISHED | UNPUBLISHED`) plus `PublishStatus`/`PublishLog`.

> **Two `DynamicApi`-ish entities, don't confuse them.** `LcApi` (low-code-platform) is the
> *authoring* record. Publishing projects it into `com.magnamedia.core.entity.DynamicApi` — the
> *runtime* record, which carries the fields that actually gate execution: `expression`, `code`,
> `apiModule`, **`secured`**, **`canUpdate`**, `restricted`, `securityCode`, `lastException`.

### Parameters (`entity/ApiParameter.java`, table `lc_api_parameter`)

`name` (150), `type` (50, **free-form string** — no enum, no whitelist; comment says
`string, number, boolean, json, etc.`), `parameterType` (real enum **`QUERY | BODY | HEADER | PATH`**,
default `QUERY`), `required`, `picklistCode`, `api` FK.

Confirmed absent from both the entity and the `ApiParameterData` DTO: **no default-value field** and
**no validation/regex field**. `type` is stored verbatim, unchecked (`ApiManagementService:2308`,
`:2675`). `parameterType` *is* validated via `valueOf(pt.toUpperCase())`, silently falling back to
`QUERY`.

⇒ **And at runtime it gets weaker still: `parameterType` is metadata only.** The evaluator receives
one flat context map; declared parameters are never individually validated, coerced or namespaced by
source (§5). Parameter declarations are documentation. Anything we need guaranteed must be asserted
inside the expression or by the caller.

### Supporting tables

- **`lc_api_page_code`** — `(api_id, page_code)`, unique on the pair, `@NotAudited`.
- **`api_debug_log`** — `api_id`, `api_name`, `api_type`, `workflow_request_id`,
  **`api_request` (LOB)**, **`api_response` (LOB)**, `status_code`, `debug_result`, `status`. No user,
  no duration, no row count.
- **`lc_publish_log`** — `component_id`, `environment_id`, `date_time`, `published_version`, `action`.
- **`lc_environment`** — carries **`bearer_token`** (4000, `@JsonIgnore`, `@NotAudited`), see §7.

> ⚠️ **`api_debug_log` persists full request and response bodies, unmasked** —
> `om.writeValueAsString(req.apiRequest)` (`WorkflowServiceAdapter:672-680`). Written **only** by
> `POST /apis/{apiId}/debug/async`, not by normal execution — but it means debug-running an API whose
> response carries personal or financial fields writes them to that table in cleartext, and
> `ApiDebugLog` is `@Audited` so Envers mirrors it. No retention or purge exists. Under our
> sensitive-data policy: keep such fields out of these APIs entirely.

### Schema provenance and the `code` rule

- **No Liquibase/Flyway/SQL DDL in the LCP repo.** Hibernate generates the schema from the JPA
  annotations, so **the annotations are the authoritative schema**.
- **`code` is the real identifier, unique only per application.** `generateSafeCode`
  (`:2559-2580`): lowercase, anything outside `[a-z0-9_|/-]` → `_`, runs collapsed, capped at 500,
  and on collision it **appends `_1`, `_2`, …** rather than rejecting.
  ⇒ *A near-duplicate name silently becomes `my_api_1`. Always verify the `code` you actually got,
  or you will call the wrong API.*
- **No unique constraint on `path` (+ `method`)** — only `(code, application_id)`. Matters less than
  it looks, since dynamic paths derive from the unique `code`; the `findFirstByPathIgnoreCase…`
  lookups (`LcApiRepository:90`) serve the static public-API scan flow.
- Inconsistency to know: the entity maps `lc_api_page_code` (singular) but native queries in
  `LcApiRepository` (`:140-143`, `:168-169`) reference **`LC_API_PAGE_CODES`** (plural).

### History (verified)

Definitions are **mutable in place**, versioned via `Component.subVersionOf` / `subVersions`
(draft has null `subVersionOf`; published versions point at the draft), `component_version`, and
`PublishLog.published_version`. `LcApi`, `Component`, `BaseEntity`, `ApiParameter`, `ApiDebugLog` and
`PublishLog` are all Envers `@Audited`, writing `_AUD` tables plus **`HISTORY_REVISIONS`** recording
**`CREATOR`** and **`CREATOR_MODULE`** with a timestamp. Page-code links are the one exclusion
(`@NotAudited`).

⇒ Combined with `LcApi.prompt` storing the generating prompt, an AI-created API is well attributed:
we can always answer "who asked for this, and what did they ask for". That is genuinely useful for
audit work.

## 3. The management surface (session 44655)

`ApiManagementController` is `@RequestMapping("/apis")`; the app context path is **`/lowcode`**
(`LowCodeApplication.java:13`). So the prefix is **`/lowcode/apis`** — same host and context path as
the ask-the-code endpoint we already use.

41 endpoints exist. The ones that matter:

| Endpoint | Purpose |
|---|---|
| `POST /lowcode/apis/async?applicationId=N` | **create** (async, AI-generated) |
| `POST /lowcode/apis/test-spel` | dry-run an ad-hoc SpEL — needs the `api_code` secret |
| `POST /lowcode/apis/{apiId}/test` | dry-run a stored SpEL (`@Authenticated`, no secret) |
| `POST /lowcode/apis/fix-by-ai/async/{apiId}` | AI regenerates the SpEL after a failure |
| `POST /lowcode/apis/edit-by-ai/async/{apiId}` | AI applies a change request |
| `PUT /lowcode/apis/{apiId}` | update — **name / category / description only** |
| `POST /lowcode/apis/{apiId}/publish` \| `/unpublish` | per-environment promotion |
| `DELETE /lowcode/apis/{apiId}` | **hard** delete |
| `GET /lowcode/apis/{apiId}` | full detail — **read the generated `spel` here** |
| `GET /lowcode/apis/list/{appId}` | paged list — find a valid `applicationId` and real examples |
| `GET /lowcode/apis/{apiId}/debug/history` | debug-log reads |

Three facts to plan around:

- **`PUT /apis/{apiId}` cannot change behaviour.** `updateApi` (`:2656-2667`) sets only `name`,
  `category`, `description`. `ApiUpsertRequest` *has* a `spel` field (`:16`) and `updateApi`
  **ignores it**. Behaviour changes go through the AI fix/edit flows only.
- **`DELETE /apis/{apiId}` is a hard delete** (`:3449-3482`) — detaches sub-versions, deletes the
  `ApiParameter`, `PublishStatus` and `PublishLog` rows, then physically deletes the row, despite a
  `deleted` column existing. The bulk variants call the same hard delete.
  ⇒ *Never use the bulk deletes; `greater-than` over an id range has no undo but Envers.*
- **No synchronous create exists** — `ApiManagementController:302`: *"Synchronous create endpoint
  removed in favor of /apis/async"*.

## 4. Creating one: the AI workflow (sessions 44657, 44659)

1. `POST /lowcode/apis/async?applicationId=N` → `createApiAsync` (`:623-643`).
2. `WorkflowServiceAdapter.createDynamicApi` (`:89-160`) — validates, normalises, enqueues.
3. `WorkflowOrchestrator.enqueueAndExecuteWithMeta` (`:42-91`).
4. `AIWorkflowAdapter.execute` POSTs to `AI_SERVICE_API_BASE + "workflow/execute-async"` — an
   **external No-Code AI service, outside the ERP codebase** (`:43-48`).
5. Result returns over Kafka → `AiWorkflowResultHandler.handleFinalMessage`, case `"create"` (`:78-108`).
6. `ApiManagementService.applyCreateResult` (`:2080-2149`): `apiType = DYNAMIC` (`:2105`),
   `spel = sanitizeFencedCode(responseData.get("spel_expressions"))` (`:2133-2134`),
   `method = POST` (`:2135`), `path = "/admin/dynamicApi/evaluateApi?code=" + code` (`:2132`),
   `code = generateSafeCode(...)`, `save` (`:2148`).
7. `autoTriggerDocumentation` fires for SPEL APIs (`:340-359`).

**`CreateDynamicApiRequest` has no `spel` field.** All fields public, **zero validation
annotations**, and the controller does not mark the body `@Valid`:

| Field | Behaviour |
|---|---|
| `user_query` | **the prompt — the whole deliverable** |
| `module_selection` | module alias from the `LC_MODULE_ALIASES` picklist (`LowCodeModule:197-214`) — **the same aliases we already use for ask-code** |
| `workflow_type` | uppercased into `WorkflowType`. Allowed: **`SPEL`, `CATALOG`, `C2D`, `DYNAMIC_TOUR`, `PLAN_MODE_SPEL`**. Null/empty → `SPEL`; unknown **throws** |
| `name` | becomes the API name and source of `code` |
| `model` | **ignored** — server forces `opus-4.6-thinking` for `PLAN_MODE_SPEL`, else `sonnet-4.6-thinking` (`:99`) |
| `branch` | default `"master"`; **metadata for the AI service only — nothing is committed** |
| `baseApiId` | create as a sub-version, inheriting the base API's module |
| `version` | default `"1.0"` |
| `conversation_id`, `manual_rule_ids` | continue a conversation / apply prompt rules |
| `plan`, `answered_questions` | `PLAN_MODE_SPEL` only |
| `deep_prompt_enhancement` | null → `FALSE` |

Server-side, not client-controllable: `self_healing_rounds=3`, **`disable_input_security=FALSE`**,
`multi_workspace=false` (`:101-105`). No page/permission field — page codes are separate (§7).

`applicationId` is a **query parameter** and the one hard requirement —
`IllegalArgumentException("Invalid applicationId: …")` if null or unknown (`:91-93`).

```
POST /lowcode/apis/async?applicationId=<valid id>
Content-Type: application/json

{
  "workflow_type": "spel",
  "module_selection": "erp/magnamedia-client-management",
  "user_query": "<the grounded specification — see §10>",
  "name": "audit-contracts-bulk-<check>",
  "branch": "master",
  "deep_prompt_enhancement": false,
  "version": "1.0"
}
```

Response is a `WorkflowAck` — `{success, request_id, message, data:{conversation_id}}` — **an
acknowledgement, not an API id**. Retrieve the result with `GET /lowcode/apis/list/{appId}` /
`GET /lowcode/apis/{apiId}` and **read the generated `spel`**.

⇒ **What "generating these ourselves" means.** The JSON is trivial and unvalidated; the leverage is
entirely in `user_query` and in reviewing the output. Same bar as `golive-api-spec-writer` — real
entities, repository signatures, enum constants with stored values, cited `class:line`. **Reviewing
the generated expression is not optional**, because nothing between the prompt and a live endpoint
checks it (§6).

### Fix / edit prompt templates (committed, editable)

No committed template for *create*, but fix and edit have defaults in
`LowCodeModule.getCustomParameters()` (`:92-148`), stored as editable `Parameter` rows with fallback
literals at `WorkflowServiceAdapter:228` / `:283`. `FIX_BY_AI_PROMPT_TEMPLATE` (`:102-106`)
interpolates `{{SPEL}}` / `{{REQUEST}}` / `{{RESULT}}` and asks for *"only the corrected SpEL code
(no commentary)"*; `EDIT_BY_AI_PROMPT_TEMPLATE` (`:107-111`) interpolates `{{USER_SECTION}}` /
`{{SPEL}}`. Both instruct the model to set `error_message` when the request isn't applicable.

The output contract is **`spel_expressions`**. Note the asymmetry: fix/edit throw
`IllegalStateException("AI response did not include 'spel_expressions'")` (`:2207-2208`), but
**create has no such guard** — a null or blank expression is stored as-is.

### The dry-run loop

`POST /lowcode/apis/test-spel`, body (`TestDynamicApiBySpelRequest`, no validation annotations):

```json
{ "environmentId": null, "moduleCode": "core", "spel": "<expression>", "context": { } }
```

`moduleCode` and `spel` required (`:3130-3131`); `context` an unbounded `Map<String,Object>`.
`environmentId` null → evaluate **locally**; otherwise proxy to that environment. **No definition is
persisted.** Fences are stripped by `sanitizeFencedCode` (`:3419-3440`).

Its gate is a **shared secret, not a permission**: `@NoPermission`, but requires header **`api_code`**
== `${api.publish.code}`, else `401 {"error":"Invalid or missing api_code header"}` (`:581-590`).
Doc comment at `:565` says it's the same server-to-server secret as `/publish-api/publish/internal`.
**We do not have it** (committed value lives in `application-default.properties`, unreadable by the
code LLM) — **the one genuinely open item, O1.** Without it the loop becomes
create → read `spel` → `validateSpel` → `POST /apis/{apiId}/test` → fix-by-ai, which works but
persists a definition first.

> **Both test endpoints execute against real data.** "Dry run" means *no definition is persisted* —
> **not** side-effect-free. Whatever the expression does, it does for real. And note the write-guard
> in §6 protects the `evaluateApi(DynamicApi, …)` path; a raw-SpEL `test-spel` call takes the bare
> `evaluateApi(String, Object)` overload, so treat ad-hoc test expressions with more care, not less.

## 5. The runtime (sessions 44660, 44661, 44662)

**There is no per-API route and no custom `HandlerMapping`.** `LcApi.path` is a pointer string, and
all execution funnels through one fixed endpoint in `magnamedia-admin`:

```java
@NoPermission
@PostMapping("/evaluateApi")
@ApiCacheable(includeHeaders = true, includeBody = true)
public ResponseEntity<?> evaluateApi(@RequestParam String code,
                                     @RequestParam(required = false) Long entityId,
                                     @RequestParam(required = false) String entityType,
                                     @RequestBody Map<String, Object> jsonContext)
```
(`magnamedia-admin/.../controller/DynamicApiController.java:133-139`; context path `/admin` per
`META-INF/context.xml:2`.)

```
POST https://erp.maids.cc/admin/dynamicApi/evaluateApi?code=<API_CODE>
Content-Type: application/json

{ "context": { "ids": [1, 2, 3] }, "entityId": 123, "entityType": "Client" }
```

`entityId` / `entityType` may be query params or top-level body keys (`:147-154`). Unknown `code` →
`404`. The definition is resolved by `findByCodeIgnoreCase(code)` (`:140`) and **re-read from the DB
every call** — no in-memory definition cache; `@ApiCacheable` caches *responses*.

Then, in core (`erp/magnamedia-core`):

```java
public Object evaluateApi(String code, Long entityId, String entityType, Map<String,Object> context) {
    DynamicApi dynamicApi = Setup.getRepository(DynamicApiRepository.class).findByCodeIgnoreCase(code);
    if (context == null) context = new HashMap<>();
    context.put("_entityId_", entityId);
    context.put("_entityType_", entityType);
    return evaluateApi(dynamicApi, context);
}
```
(`DynamicApiUtil.java:119-130`) → which delegates to the gated overload (§6).

### Parameter binding — the syntax we need

Declared parameters bind as **entries of a flat `Map<String,Object>` that IS the root object** — not
as `#variables`, not as a typed root. Nothing calls `setVariable`. A `MapAccessor` is added so map
keys read as properties. To read a parameter named `clientId`:

```
clientId                 // or #root['clientId'], or ['clientId']
```

There is **no `#clientId` form.** And `parameterType` (`QUERY|BODY|HEADER|PATH`) is **metadata only
at execution time** — parameters are not individually validated, coerced or namespaced by source;
whatever lands in the `context` map under that name is what the expression reads. QUERY/PATH/HEADER
params are expected to be merged into the map by the caller.

Reserved keys the runtime injects: **`_entityId_`** and **`_entityType_`**. Don't name a parameter
either.

### Collections (our bulk case) — supported, unbounded

A JSON array deserialises to `java.util.ArrayList` at the HTTP boundary
(`@RequestBody Map<String,Object>`), sits in the context map, and passes straight into a repository
method taking a `List`, which Spring Data binds into a JPQL `IN` clause:

```
@someRepository.findByIdInAndDeletedFalse(ids)
```

**There is no dedicated coercion code, no element-count validation, and no maximum size anywhere in
this path.** Unbounded, subject only to what the DB/driver tolerates in an `IN` list.

### Reaching data: arbitrary beans

The evaluation context installs a `BeanFactoryResolver` over the module's
`AutowireCapableBeanFactory`, so **`@beanName.method(...)` reaches any Spring bean in the target
module** (`DynamicApiUtil:98-100`). That is how an expression calls repositories and services — and
also why the surface is as wide as it is (§6).

### No limits, anywhere

`evaluateApi` is **not** `@Transactional` (unlike `create`/`update`/`delete`, which each carry
`@Transactional(transactionManager = "appTransactionManager")`), so it is **not a read-only
transaction** — read-only is enforced logically instead (§6). And there is:

**no row cap, no result-size cap, no pagination, no query timeout, no rate limiting, no throttling,
no concurrency cap, no circuit breaker, no auto-disable, no response masking, and no per-call audit
row.** Confirmed absent across the LCP service, the admin controller and the core evaluator. The
result object is serialised raw by default Jackson (`:178`) — no projection or DTO shaping.

Limits that *do* exist are unrelated: C2D template bulk lookup caps at **20** names
(`C2DController:89-91`), C2D message paging clamps to **200** (`:298`), session paging to **100**
(`:224`), and bulk-op batch defaults of **200** (`:3542`), **500** (`:3612`), **100**-record commits
(`:455`, `:647`). Also note the LCP proxy uses `new RestTemplate()` with **no timeout at all**
(`ApiManagementService:160`), so a cross-environment call can hang indefinitely.

## 6. The security model — what is actually enforced

This is the answer to "all the security rules it needs for an API to be accepted". The
uncomfortable truth is that **almost nothing is enforced at authoring time**, and the runtime relies
on three narrow guards rather than a sandbox.

### 6a. Authoring time: two checks, and that's it

Walking create from controller to persistence, the **complete** validation list is:

1. `applicationId` non-null and exists → `IllegalArgumentException` (`WorkflowServiceAdapter:91-93`).
2. Module alias resolves → `IllegalStateException("Module not found for alias: …")` (`:2122`).
3. `code` sanitised to `[a-z0-9_|/-]`, ≤500, uniquified by suffixing — **mangled, never rejected**.

There is **no** SpEL allowlist or denylist, **no** parse-check before storage (an invalid expression
is accepted and fails at first evaluation), **no** blocking of dangerous constructs, **no** write
prevention, **no** injected scoping (no row limit, tenant/company/branch filter, soft-delete filter
or test-data filter is added), and **no** reviewer or approval gate. The only transformation is
`sanitizeFencedCode`, stripping Markdown fences.

### 6b. The SpEL engine is not sandboxed

```java
public Object evaluateApi(String expressionStr, Object apiContext) {
    enforceModuleRestriction();
    enforceSpelExpressionRestrictions(expressionStr);
    try {
        CurrentRequest.setSpelRequest(true);
        Expression expression = expressionParser.parseExpression(expressionStr);
        StandardEvaluationContext context = new StandardEvaluationContext(apiContext);
        context.getPropertyAccessors().add(new MapAccessor());
        context.setBeanResolver(new BeanFactoryResolver(Setup
                .getApplicationContext().getAutowireCapableBeanFactory()));
        return expression.getValue(context);
    } finally {
        CurrentRequest.setSpelRequest(false);
    }
}
```
(`magnamedia-core/.../helper/DynamicApiUtil.java:88-106`)

It is a **`StandardEvaluationContext`**, not a `SimpleEvaluationContext`. Root = the context map.
No registered variables, no registered functions. Default `StandardTypeLocator` (so `T(...)` works),
default `ReflectiveMethodResolver`, nothing removed, no SecurityManager, plus an explicitly-added
`MapAccessor` and `BeanFactoryResolver`.

⇒ **`T(...)` type references, `new`, reflection, class loading and arbitrary-bean access are all
reachable at the engine level.** Stated plainly: a dynamic API is a code-execution surface.

### 6c. The three guards that do exist

| Guard | Where | What it actually does |
|---|---|---|
| **Token blacklist** | `DynamicApiUtil:50-54`, enforced `:203-214` | `FORBIDDEN_SPEL_TOKENS = ["CoreParameter", "Parameter", "BackgroundTask"]` — a **substring** check throwing `SecurityException`. Blocks only those three literals (`Parameter` also catches `CoreParameter`). Does **not** block `T(`, `new`, `Runtime`, `Class`, `@`, or reflection. |
| **Module blacklist** | `DynamicApiUtil:180-201` | blocks the `officestaffpayroll` module only. |
| **Write guard (the real one)** | `magnamedia-core/.../aspects/SpelSecurityAOP.java:23-32` | AOP `@Before` on `com.magnamedia.core.repository..*.save(..)`, `.saveAndFlush(..)`, `.delete(..)` and `com.magnamedia.core.schedule.JobScheduler..*(..)`: if `CurrentRequest.isSpelRequest()` it logs a severe "Security Violation" and throws `AuthorizationException("UNAUTHORIZED <LOGOUT>", "Security Violation - Can't perform database changes using SpEL!")`. |

**Write-guard caveats, which matter:**
- It is a Spring-AOP pointcut, so it fires only on Spring-proxied beans and only for methods
  *literally named* `save`/`saveAndFlush`/`delete` under `com.magnamedia.core.repository..*`. A JPQL
  or native `UPDATE`/`DELETE` via `EntityManager`, or a differently-named mutator, **is not
  covered.**
- It is gated on a flag: `evaluateApi(DynamicApi, …)` sets
  `setSpelRequest(!Boolean.TRUE.equals(dynamicApi.getCanUpdate()))` (`:112`). An API with
  **`canUpdate = true` runs with the flag off — writes permitted.**

**For a published API, both of these land in the right place.** `dynamicApiUtil.publishApi`
(`:132-146`) sets **`secured = true`** (`:144`) and never sets `canUpdate`, leaving it **`null`**.
So `!Boolean.TRUE.equals(null)` → `setSpelRequest(true)` → **the write guard is active and
repository writes throw**. (Session 44662's closing sentence claimed the opposite — "runs in
write-enabled mode" — which contradicts the logic it had just quoted. Flag on = writes blocked.
Verified against `SpelSecurityAOP:23-32`.)

⇒ **The one solid, enforced guarantee: a published dynamic API cannot write through core
repositories.** Treat it as real but narrow — it is not a sandbox, and it does not cover
`EntityManager` mutations.

### 6d. Authorization at runtime

The HTTP endpoint is **`@NoPermission`** — no authentication or authorization call in the method
body (contrast its siblings `create`/`update`/`delete`, which each call `this.checkPermission(...)`
and `CurrentRequest.authorize()`). Authentication is only whatever the global filter chain
(`AppJwtTokenFilter` / `OAuth2AuthenticationFilter` / `SecurityFilter`) applies.

Per-API authorization happens **inside** the evaluator, and **only for `secured` APIs**:

```java
private static void validationFilterData(DynamicApi dynamicApi){
    if(!dynamicApi.isSecured()) { return; }
    User user = CurrentRequest.getUser();
    if (Setup.isTestMode() || (user != null && user.isSuperUser()) || (user != null && user.isAdmin())) return;
    SecureResourceHolder holder = Setup.getApplicationContext().getBean(SecurityService.class)
            .getSecureResourceHolder(user, dynamicApi.getSecurityCode());
    if(!(holder != null && holder.getPermission() != PermissionType.NO)) throw new SecurityException("Access denied.");
}
```
(`DynamicApiUtil:166-178`)

Because `publishApi` sets `secured = true`, **this gate is active for published APIs**: a
non-admin/non-superuser without a matching `SecureResourceHolder` permission gets
`SecurityException("Access denied.")`. It runs on the `evaluateApi(DynamicApi, …)` path — i.e. for
calls arriving at `/admin/dynamicApi/evaluateApi` — and also on the static entrypoint before the
inter-module hop. It does **not** run on the bare `evaluateApi(String spel, Object ctx)` overload
used by the LCP's own `executeDynamicAPI`/`executeDynamicSpel`, which pass raw SpEL.

Note `canUpdate` is **not** an authorization gate — it only toggles the write flag.

**`pageCode` and `publicEndpoint` do not gate this route.** Core's `ApiAuthorizationService`
(`:142-183`) resolves a request by `pageCode` + method/path and checks a `SecureResourceHolder`
(`READONLY` → sets `spelRequest=true`; denies on `PAGE_CODE_MISSING` / `INSUFFICIENT_PERMISSIONS`),
but because `/dynamicApi/evaluateApi` is `@NoPermission`, that service gates *normal* ERP API routes,
not this one. `publicEndpoint` / page codes are **platform-registration concerns**.

One more sharp edge: on evaluation failure the endpoint throws
`RuntimeException("Can't evaluate API - " + rootCause.getMessage())` (`:173`), **leaking the
root-cause message to the caller**, and sets the full stack trace on `dynamicApi.lastException`
(not persisted — the `save` in `finally` is commented out at `:175`).

### 6e. The validator that is never called

| Mechanism | Status |
|---|---|
| **`DynamicApiController.validateSpel`** (`magnamedia-admin:215`, method `validateSpelClassNotUsed`, `@NoPermission`) | **Advisory and non-blocking.** Reads `DYNAMIC_API_PROHIBITED_CLASSES`, and only *reports* `anyUsed` / `usedClasses` in its JSON response (`:258-261`). It does **not** throw. |
| **`/dynamicApi/oldvalidateSpel`** (`:182`, `@Authenticated`) | legacy, parse-only. |
| **`SecurityController.classifySpel` / `LcSecurityService.classifySpel`** (`:38-74`) | Advisory — forwards a `workflow_type=spel_classify` request to the AI service. |
| **`disable_input_security=FALSE`** (`WorkflowServiceAdapter:102`) | An AI-side prompt filter in the external No-Code service, not a deterministic validator. |

A full search for callers found **zero programmatic callers** of any validate method: not `create`
(`:66-73`), not `update` (`:84-94`), not `delete` (`:104-111`), not `evaluateApi` (`:133-179`), not
`DynamicApiBusinessRule`. **Validation is never triggered automatically** — it runs only when a
client explicitly POSTs to `/dynamicApi/validateSpel`.

**The blacklist it would have applied** — parameter key `DYNAMIC_API_PROHIBITED_CLASSES`
(`AdminModule.java:259`), committed default (`:719-722`), 11 comma-separated FQNs, verbatim:

```
java.lang.Runtime,java.lang.ProcessBuilder,java.lang.System,java.lang.Class,
java.lang.reflect.Method,java.lang.reflect.Field,java.io.File,java.io.FileInputStream,
java.io.FileOutputStream,java.nio.file.Files,java.nio.file.Paths
```

with detection regexes (`DynamicApiController`):

```java
private static final Pattern T_PATTERN   = Pattern.compile("\\bT\\s*\\(\\s*([\\w\\.$\\[\\]]+)\\s*\\)", Pattern.CASE_INSENSITIVE);
private static final Pattern NEW_PATTERN = Pattern.compile("\\bnew\\s+([\\w\\.$]+)(?:\\s*<[^>]*>)?\\s*(?:\\(|\\[)", Pattern.CASE_INSENSITIVE);
```

⇒ **This list is the closest thing to "the security rules an API must comply with", so we should
comply with it voluntarily and call `validateSpel` ourselves on every generated expression** — which
converts an unenforced rule into a step in our process (§10, rule 7).

For contrast, the **Event Streaming Rule** feature in the same module *does* have a Temporal
approval workflow (`EVENT_STREAMING_RULE_APPROVAL_WORKFLOW_ENABLED`, default `true`,
`LowCodeModule:122-126`). Dynamic APIs have no equivalent. That asymmetry is worth raising.

## 7. Publish, environments, page codes, and automation credentials

**Creation ≠ promotion, but creation *is* local callability.** A saved DYNAMIC API is invokable
immediately in the current environment. `executeDynamicAPI` checks only three things
(`ApiManagementService:3005-3015`): API exists, `apiType == DYNAMIC`, module is set.

Cross-environment promotion is a separate manual action: `POST /apis/{apiId}/publish?environmentId=`
(`:428-453`) → `PublishService.publishApiToEnvironment` → `PublishOperationHandler.saveDynamicAPI`
→ core `dynamicApiUtil.publishApi(categoryCode, code, moduleCode, spel, "Auto Generated from Low
Code Platform")` (`:57-59`), recorded in `PublishStatus`/`PublishLog`. The server-to-server half
(`/publish-api/publish/internal`) requires the `api_code` secret. **No second-person review on
either half.**

⇒ **Publishing is the useful gate, and it does real security work**: it is what sets
`secured = true` (§6d). Prefer published APIs over locally-evaluated raw SpEL.

**Page codes.** `lc_api_page_code` links an API to permitted front-end page codes, unique per pair;
the lookup is one JPQL join (`LcApiRepository:87-88`) served by `getApisByPageCode` (`:1037-1072`).
To link one: `LcApi.addPageCode(...)` / `replacePageCodes(...)` (`:334-381`), the idempotent native
`insertPageCodeIfAbsent` (`:139-143`), or `POST /apis/page-codes/public` (`:182-195`) — **but that
last one also sets `publicEndpoint = true`** via `markPublicEndpoint` (`LcApiRepository:131-133`).
⇒ *Use `insertPageCodeIfAbsent`; never the `/page-codes/public` endpoint unless a genuinely public
endpoint is intended.* Remember these are registration concerns, not gates on `evaluateApi` (§6d).

**Permissions on the management endpoints.** `createApiAsync`, `fix-by-ai` and `edit-by-ai` carry
**neither** `@Authenticated` **nor** `@NoPermission` (`:623`, `:645`, `:671`); since `@NoPermission`
is the opt-*out*, they fall through to the default authenticated+authorized chain, resolving via
`CurrentRequest.checkPermission(getClass().getSimpleName(), apiName)`
(`magnamedia-core/.../BaseController.java:97-102`). `LowCodeModule.getCustomApiPermissions()`
returns `null` (`:66-69`) — **no bespoke named permission**; access is the standard resource grant
for the Low-Code app, administered in `magnamedia-admin` (`ApiAuthorizationController`,
`PolicyController`, `ResourceController`).

**To test whether our token can create:** call `GET /lowcode/apis/page-codes` (which *is*
`@Authenticated`). 200 = authenticated for the module; 401 = not. No create-specific scope exists.

**Credentials for unattended runs.** The one machine-to-machine pattern in the code is a
per-environment stored bearer token: `Environment.bearerToken` (4000, `@JsonIgnore`, `@NotAudited`),
resolved by `resolveTokenWithFallback` (`:3289-3304`) as *environment token first, else the caller's
`Authorization` header*. There is **no client-credentials or token-minting flow** (searched
`clientCredentials`, `grant_type`, `serviceToken`, `machineToken` — zero hits). ⇒ For a scheduled
audit job, use a stored `Environment.bearer_token`; a user JWT is unsuitable — ours expires in
about 6.5 hours.

`secc-ch-ua-platform` appears nowhere in the LCP repo; it is handled in core's filter chain.

## 8. Our bulk use case

**Precedent exists — but not where session 44656 looked (corrected 2026-08-23, session 44664).**
There are indeed **zero committed `LcApi` instances** in the low-code-platform repo (no `*.sql`, no
changelogs, no seeds, no fixtures, `204 java files, 0 test dirs`). But the *runtime* entity is
`core.entity.DynamicApi`, and there are **many** committed `DynamicApi.expression` literals, set in
code by `SetupDynamicApis` classes across modules. **The established convention, verbatim:**

```java
// magnamedia-client-management/.../service/SetupDynamicApis.java:52
api.setExpression("T(com.magnamedia.core.Setup).getApplicationContext().getBean(\"ccAppContentHelper\").fetchReplaceOrHireMaidVisibility(_entityId_)");
// magnamedia-visa-processing/.../module/SetupYAYAFaqDynamicApis.java:22
api.setExpression("!T(com.magnamedia.core.Setup).getApplicationContext().getBean('housemaidService').isEidAndPassportReceived(_entityId_)");
```

Three consequences:

1. **`T(...)` is the sanctioned idiom, not a smell.** `T(com.magnamedia.core.Setup)` is not on the
   prohibited-classes list. A blanket "reject `T(...)`" rule would reject every real dynamic API in
   the ERP — judge a type reference by *what it names* (§6e's list), not by its presence. `@beanName`
   also resolves (the `BeanFactoryResolver` is installed) and is used in `@Value("#{…}")` projections
   elsewhere, but **no committed dynamic API uses it** — prefer the proven `getBean(...)` form.
2. **`_entityId_` / `_entityType_` are referenced bare**, confirming §5: the context map is the root
   with a `MapAccessor`, so there is no `#` prefix.
3. **Every committed example wraps a *service/helper* bean and returns a scalar for one
   `_entityId_`. None calls a `*Repository`, and none returns a `List`.** A bulk list-in/rows-out API
   is therefore **a new pattern.** That's allowed, but say so when proposing one, keep the expression
   minimal, and if it starts needing real branching, add a typed tested service method in the owning
   module and let the expression be a one-line wrapper — matching every existing example at the cost
   of a deploy.

**One API = one module.** `moduleCode` is a single scalar
(`interModuleConnector.call(moduleCode, "dynamicApiUtil", "evaluateApi", …)`), taken from
`api.getModule().getCode()`. An expression **cannot fan out across modules**. ⇒ *A check spanning
contracts and payroll is two APIs, not one.*

**Ground the contract side separately.** The `Contract` entity is not in the LCP repo at all (its
entity list is platform-only). The table, PK, a repository method taking a collection of ids, and
any soft-delete/status/test-data columns must be grounded in the owning ERP module via ask-code
first — that grounding *is* the prompt.

**Already done for contracts (session 44663).** Owning module `erp/magnamedia-client-management`
(`Contract.java` is duplicated across **7 modules**; only that copy is the canonical `@Entity`);
table `CONTRACTS`; PK column `ID`; bean `contractRepository`; and the bulk method **already exists** —
`List<Contract> findAllByIdIn(ArrayList<Long> Ids)` (`ContractRepository.java:216`, note the concrete
`ArrayList` parameter). `status`/`contractType` are `@Enumerated(STRING)`. **Two corrections to
assumptions worth recording:** (1) there is **no `ContractProspectType` enum with a `MAID_VISA`
constant** — CC/MV is a `PicklistItem` FK matched by `.getCode()`, CC = `maids.cc_prospect`,
MV = `maidvisa.ae_prospect`; and `ContractType` holds only `LONG_TERM`/`SHORT_TERM`, unrelated to
CC/MV. (2) `Contract` has **no soft-delete and no test/fake column at all** — rows are hard-deleted,
so a correct query filters neither. A ready-to-paste grounded prompt, the create call and the review
checklist live in `.claude/skills/erp-audit-flow-builder/references/bulk-api-prompt.md`.

**The shape to ask for**, given everything above:

- input: a `BODY` collection of contract ids;
- one repository call with `… where x.id in :ids`, plus the soft-delete/status/fake-data filters
  **written into the expression** (nothing injects them);
- return an **interface or constructor projection** of exactly the needed scalar columns — never
  managed entities. The real accepted template to copy (`LcApiRepository:42-46`):

  ```
  select distinct l.id as id, l.name as name, c.id as categoryId
  from LcApi l left join l.category c
  where l.deleted = false and l.apiType = :apiType and l.id in :ids
  ```

**Chunk size has no code-backed answer** — there is no collection cap, row cap or timeout on this
path. A defensible default is **~200 ids per call**, drawn from the repo's own bulk-op default
(`:3542`); treat it as a heuristic from unrelated code, not a guarantee, and tune against real
latency.

**Failure modes to design against**, with the repo's own remedy patterns:

- **N+1 lazy loading** — the trap if the expression walks lazy associations per contract. The repo's
  remedy is explicit batch fetching (`batchFetchPageCodesByApiIds`, `:1247-1260`;
  `LcApiRepository:113-114`) and an N+1-avoiding cache (`C2DController:178-193`). One repository
  call, not a loop.
- **Entity-graph serialization** — returning entities serialises lazy graphs and triggers more
  loading; the result is Jackson-serialised raw with no DTO shaping. Projections solve this.
- **LAZY associations outside a transaction** — the sharpest edge. `evaluateApi` is **not**
  `@Transactional` (§5), so an expression touching a `fetch = LAZY` association risks
  `LazyInitializationException`, and touching one per row re-introduces the N+1 you came to delete.
  Return own-table scalars plus ids of `@ManyToOne` associations (EAGER by default); anything needing
  a LAZY walk belongs in a repository `@Query` projection with an explicit join — a Java change, not
  something to smuggle into a string. Worked example: `Contract.contractProspectType` is LAZY, which
  is why CC/MV is excluded from the v1 bulk contract API.
- **Memory / transaction scope** — no streaming, no `setMaxResults`, and `evaluateApi` isn't
  transactional, so a "return everything" expression materialises the whole result in heap.
- **Timeout** — none client-side or server-side. Keep each call bounded. *(We hit exactly this class
  of failure today polling ask-the-code — see `docs/code-llm-api.md`.)*

## 8b. Our actual access position — the pageCode is `lc_docs` (2026-08-23)

**Corrects an earlier version of this section**, which concluded we had no management access.
That was wrong: it was true of the pagecodes we had tried, not of the platform. The console page
is **`lc_docs`**, and it was discoverable from our own ERP menu the whole time.

### How the authorization model actually behaves

Probed live against `https://erpbackendpro.maids.cc` with read-only GETs:

| pageCode | Call | Result |
|---|---|---|
| `lc_conversation` | `/lowcode/apis/page-codes` | **200** — token authenticates |
| `lc_conversation` | `/lowcode/apis/types`, `/apis/list/1`, `/lowcode/applications` | **401** `API_NOT_FOUND_FOR_PAGE` |
| *(none)* | any | **401** `PAGE_CODE_MISSING` |
| 7 guessed codes (`lc_apis`, `lowcode`, `lc_studio`, …) | `/apis/types` | **401** `PAGE_NOT_FOUND` — those pages don't exist |
| **`lc_docs`** | `/apis/types`, `/apis/parameters-types`, `/apis/meta/list`, `/apis/list/{appId}`, `/apis/{apiId}` | **200** ✅ |

**Three denial shapes**, matching `ApiAuthorizationService` (§6d): `PAGE_CODE_MISSING` →
`PAGE_NOT_FOUND` (page doesn't exist) → `API_NOT_FOUND_FOR_PAGE` (page real, endpoint not
registered to it). All present as a bare `401`; **only the `developermessage` response header
separates them** — the same trap the audit playbook flags.

### How to find the right pageCode — the general method

Do not guess, and do not give up after guessing. **Enumerate from the ERP's own registry:**

```bash
# 1. the menu is filtered to pages YOU can access
GET /admin/menu/getMenu?language=1        # header: pageCode: sidenav_menu
#    -> extract every "code" value; grep for the subsystem you want
# 2. ask what a candidate page authorises
GET /lowcode/apis/page-codes              # header: pageCode: <candidate>
#    -> returns the endpoints registered to that page
```

`lc_docs` was the single `lc*` code in our menu. Because the menu is permission-filtered, its
contents *are* the list of pages we hold — which makes it both the discovery tool and the
access check.

### What `lc_docs` grants (21 registered endpoints)

Management reads we now have: **`GET /apis/{apiId}`** (read a definition including its `spel`),
`GET /apis/parameters-types`, `GET /categories/with-apis`, `GET /apis/document/async/{apiId}`,
plus writes on the metadata edges — `PUT /apis/parameters/{parameterId}`,
`PUT /apis/result-example/{apiId}`, `POST /apis/parameters/{parameterId}/resolve-picklist-code`
— and the whole c2d chat surface. Empirically `/apis/types`, `/apis/meta/list` and
`/apis/list/{appId}` also answer 200 under it, so the match is broader than the registered list
suggests.

### What is still unconfirmed

- **Create (`POST /apis/async`).** A `GET` against it returns **400** (a Spring binding error),
  which proves we pass the authorization gate — but a `POST` would actually create an API, and
  that is the human gate. **Not tested. Do not test it casually.**
- **`POST /apis/test-spel`** still needs the `api.publish.code` shared secret (O1), independent
  of any page grant.
- **`POST /apis/{apiId}/publish`** — not in the registered list; unknown.

⇒ We can **read** the platform, including real accepted definitions, and we can write the
prompt. Whether we can create is one un-run POST away, and that POST needs a person's go-ahead.

### Useful facts read from the live platform

- `GET /apis/types` → `STATIC`, `DYNAMIC`.
- `GET /apis/parameters-types` → the **real** parameter-type value list the UI offers:
  `String, int, long, boolean, double, float, date, time, datetime, timestamp, json`. (The
  column is a free-form `String(50)` at the entity level — §2 — but this is the sanctioned set.)
- `GET /apis/meta/list` → searchable fields: `code, name, version, apiType, method,
  parameters.name, parameters.type, parameters.parameterType, description, category, creator.id,
  creationDate, lastModificationDate, lastModifier.id, manualEntry, coreEndpoint, publicEndpoint`.
- `GET /apis/list/1` → **26,697** APIs, `Page`-shaped (`content`, `totalElements`, …). Filter
  query params are **ignored** (`?apiType=DYNAMIC` returns everything) and so is `sort`;
  paging works, and `type` comes back lowercased (`static` / `dynamic`). Dynamic definitions
  cluster in the high id range — page ~1779 at size 15 surfaced ids 27624–27633.

### Real accepted definitions — read these before writing a prompt

Copies in `work/lcp-dynamic-apis/real-examples/`. Two worth studying:

- **27629 `getprecolllistrenewalupdated_cloned`** (module `clientmgmt`) — a paginated,
  list-returning bulk read. This is the template for an audit API: `SelectQuery.builder(jpql,
  countJpql, entityType, params).withTotalCount(true).build().execute(PageRequest.of(page,size))
  .getContent().![{ ... }]`, with `LEFT JOIN FETCH` for associations and a
  `{'error': ...}` guard clause. **It also proves CC/MV is reachable in one call**, via
  `AND (c.contractProspectType IS NULL OR c.contractProspectType.code != :ccProspectCode)` — a
  JPQL join, not a lazy entity walk.
- **27626 `getPayTabsPaymentLinkForContract`** (module `accounting`) — a contract-keyed scalar
  read, and a cautionary example: 5,339 characters that re-execute
  `findByUuid(...)` **fourteen times** for one response. A demonstration of what an unreviewed
  generated expression looks like, and why §10 rule 6 exists.

**Corrections these forced** (all folded into
`.claude/skills/erp-audit-flow-builder/references/bulk-api-prompt.md`):

1. **Parameter naming.** BODY parameters are *declared* `context.<name>` and *read*
   `#root['<name>']`. Not bare names — the hand-written `SetupDynamicApis` one-liners use bare
   `_entityId_`, but every AI-generated definition uses the explicit `#root[...]` form.
2. **`new` is used in production** — e.g. `new java.text.SimpleDateFormat('yyyy-MM-dd')`. So a
   blanket "reject `new`" is as wrong as a blanket "reject `T(...)`" was. Judge the **type named**
   against §6e's list.
3. **A third bean idiom exists**:
   `T(com.magnamedia.core.Setup).getRepository(T(com.magnamedia.repository.ContractRepository))`
   — type-safe, and cleaner than `getBean('name')` for repositories.
4. **Pagination is conventional**, not absent: `context.page` / `context.size` →
   `PageRequest.of`, defaults 0 / 20, `.withTotalCount(true)`. §5's "no pagination" is about
   *platform enforcement*; the convention supplies it.

### Two open contradictions worth resolving

- **`Contract.getDeleted()`.** ask-code (session 44663) says the client-management `Contract`
  has no soft-delete flag, on the entity or its bases. But live API 27626 calls
  `contract.getDeleted()` — in the **accounting** module. The entity is duplicated across seven
  modules, so the copies plausibly differ. **Verify against `clientmgmt` before deciding whether
  a bulk query must filter deleted rows.** The prompt now asks the generator to check and report.
- **`CoreParameter` vs the token blacklist.** `FORBIDDEN_SPEL_TOKENS` is
  `["CoreParameter", "Parameter", "BackgroundTask"]`, enforced by a **substring** check that
  throws `SecurityException` (§6c). Yet definition 27626 contains
  `T(com.magnamedia.core.Setup).getCoreParameter(T(com.magnamedia.core.entity.CoreParameter).PUBLIC_LINK_BASE)`
  — which should fail that check on every call. Either that API is effectively dead, or the
  blacklist is applied on a path this doesn't take. Unresolved; do not rely on either reading,
  and steer clear of those tokens regardless.

## 9. Open items

| # | Item | Status |
|---|---|---|
| O1 | The `api.publish.code` secret | **Open.** Blocks pre-create dry-runs via `/apis/test-spel`. Needs a person with deploy-config access. Workaround: create → read `spel` → `validateSpel` → `/apis/{apiId}/test` → fix-by-ai. |
| O2 | Is the SpEL sandboxed? | **Closed — no.** Unrestricted `StandardEvaluationContext` + `BeanFactoryResolver` (§6b). |
| O3 | Are writes prevented? | **Closed — yes for published APIs, narrowly.** `SpelSecurityAOP` + `secured=true`/`canUpdate=null` from `publishApi`; does not cover `EntityManager` mutations (§6c). |
| O4 | The prohibited-classes list | **Closed.** 11 FQNs, quoted in §6e — but advisory and never auto-invoked. |
| O5 | Parameter and collection binding | **Closed.** Flat root map, bare-name syntax, no `#vars`; collections unbounded (§5). |
| O6 | Row caps, pagination, timeouts, transactionality | **Closed — none exist** (§5). |
| O7 | What protects `/admin/dynamicApi/evaluateApi` | **Closed.** `@NoPermission` at the route; global auth filter for authentication; per-API `SecureResourceHolder` check inside the evaluator, active because `publishApi` sets `secured=true` (§6d). |
| O8 | Whether the frontend/core calls `validateSpel` over HTTP | **Minor, open.** No in-repo callers exist; an HTTP caller outside these repos can't be ruled out. Doesn't change our practice — we should call it regardless. |
| O9 | The Low-Code console `pageCode` | **CLOSED — it is `lc_docs`** (§8b). Management *reads* work under it, including reading any definition's `spel`. |
| O10 | Whether `POST /apis/async` (create) actually succeeds for us | **Open by choice.** A GET against it returns 400, i.e. we pass authorization — but confirming requires actually creating an API, which is the human gate. Needs a go-ahead, not a probe. |
| O11 | Does `clientmgmt`'s `Contract` have a soft-delete flag? | **Open, contested** (§8b). ask-code says no; live API 27626 calls `getDeleted()` in the *accounting* copy. Resolve before trusting a bulk query's row set. |
| O12 | `CoreParameter` in definition 27626 vs the `FORBIDDEN_SPEL_TOKENS` substring check | **Open** (§8b). One of the two readings is wrong; either that API is dead or the blacklist doesn't apply on its path. |

## 10. Standing rules for us

Split honestly between what the platform enforces and what it leaves to us — because the second
list is much longer, and pretending otherwise is how a bulk API quietly becomes an incident.

*Platform-enforced — just satisfy them:*
1. Valid existing `applicationId`; resolvable `module_selection` alias; `workflow_type` a real
   `WorkflowType` (`SPEL`).
2. Expect `path` and `method` to be assigned (`POST`, `/admin/dynamicApi/evaluateApi?code=`).
3. Verify the `code` you actually got — a near-duplicate name silently becomes `…_1`.
4. Don't reference `Parameter`, `CoreParameter` or `BackgroundTask` anywhere in an expression — a
   substring match throws `SecurityException`. Don't target the `officestaffpayroll` module.
5. Published APIs cannot write through core repositories. Don't design as if they could.

*Self-imposed, because nothing checks it:*
6. **The prompt is the deliverable.** Ground it in code first — real entities, repository signatures,
   enum constants with stored values, cited `class:line`. Same bar as `golive-api-spec-writer`.
7. **Always read the generated `spel`, and always run `/dynamicApi/validateSpel` on it.** The create
   path never validates. Treat any prohibited-class hit (§6e) as a hard stop, and reject `T(...)`,
   `new`, reflection and any bean call that isn't a read, whether or not the linter flags it.
8. **Write the scoping the platform won't inject** — a row limit, the soft-delete/status filter, and
   any test-or-fake-data filter (`FAKE = false` and equivalents) must be *in the expression*.
9. **Return projections, not entities**, with exactly the columns needed; one repository call with
   `id in :ids`, never a per-contract loop.
10. **Chunk client-side** (~200 ids as a working default). There is no server-side cap, timeout or
    circuit breaker to save us.
11. **Publish rather than relying on raw-SpEL evaluation** — publishing is what sets `secured=true`
    and turns on the per-user authorization check.
12. **Never request `publicEndpoint`**, and never use `POST /apis/page-codes/public` (it sets that
    flag). Link page codes with `insertPageCodeIfAbsent`.
13. **Never use the bulk deletes.** Hard delete; the only undo is Envers history.
14. **Keep personal and financial fields out of these APIs entirely** — not merely out of chat.
    `api_debug_log` persists request and response bodies unmasked, with no retention policy, and
    evaluation errors leak root-cause messages to the caller.
15. **One API, one module, one purpose.**
16. **Use a stored `Environment.bearer_token` for unattended runs**; a user JWT expires in hours.
17. **Name no parameter `_entityId_` or `_entityType_`** — the runtime injects those keys.

## 11. Where this plugs into our systems

- **Audit flows (`erp-audit-flow-builder`).** A bulk LCP API is the structural fix for the
  "per-contract calls × population" blow-up that skill's Phase 3 tells us to recount — its own words
  are that an order-of-magnitude miss *"changes the execution architecture, not just the runtime"*.
  That skill is a synced global skill, not in this repo, so updating it is a separate deliberate
  change. Worth doing now that O2–O7 are closed.
- **System 2 `golive-api-spec-writer`.** Its output is already a paste-ready prompt for exactly this
  creation path, so the agent needs no redesign. **Correction to an earlier draft of this doc:** I
  wrote that its framing ("Moe pastes this into his API-creating ask-the-code") could become "we
  submit it ourselves". §8b falsifies that for our current token — we hold the chat surface, not the
  management surface. The paste-to-Moe design was correct, and remains the working path until the
  console grant is obtained. What genuinely changes is that we can now write a *much* better prompt,
  and specify the review (rules 6–9) that whoever submits it should apply. Its persisted-vs-transient
  feasibility gate applies unchanged: a SpEL expression reads persisted state, so a transient value
  still needs a CIO event, not an API.
- **Governance / to raise with the LCP owners.** Three things, in order: (1) the create path stores
  AI-generated SpEL with no validation and no approval gate, while Event Streaming Rules in the same
  module *do* get a Temporal approval workflow; (2) `validateSpel` reports rather than throws and is
  never auto-invoked, so `DYNAMIC_API_PROHIBITED_CLASSES` is decorative in practice; (3) the write
  guard misses `EntityManager`-level mutations and is bypassed entirely by `canUpdate = true`. We can
  comply voluntarily (rules 6–9); a platform that enforced it would be better, and none of these
  needs a large change.
