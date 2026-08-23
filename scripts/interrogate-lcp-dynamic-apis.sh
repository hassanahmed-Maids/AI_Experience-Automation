#!/usr/bin/env bash
# interrogate-lcp-dynamic-apis.sh — learn the Low Code Platform's dynamic-API
# feature well enough to author dynamic APIs ourselves, and to comply with every
# security rule the platform enforces before it accepts one.
#
# Why this exists: audit flows currently do one ERP request per contract. A
# purpose-built bulk dynamic API collapses that into one call. To generate those
# ourselves (instead of handing paste-ready prompts to Moe) we need the full
# contract: definition schema, creation endpoint, runtime binding, and — above
# all — the exhaustive list of validation/security rules a definition must pass.
#
# Usage:
#   ./scripts/interrogate-lcp-dynamic-apis.sh            # all questions, 3 at a time
#   ./scripts/interrogate-lcp-dynamic-apis.sh 4          # just question 4
#   ./scripts/interrogate-lcp-dynamic-apis.sh 4 5 7      # a subset
#
# Answers land in work/lcp-dynamic-apis/raw/qN-<slug>.md (raw Markdown, with the
# SESSION_ID line kept so follow-ups can continue the same conversation).
#
# Requires ERP_AUTH_TOKEN / ERP_SECC_PLATFORM (via .env or the environment).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$DIR/work/lcp-dynamic-apis/raw"
mkdir -p "$OUT"

LCP="erp/low-code-platform"

# Appended to every question. The module-visibility hazard in docs/code-llm-api.md
# means a confident "doesn't exist" is often just a module the session cannot see —
# so we demand the distinction explicitly.
RIGOR='

Rules for your answer:
- Cite real code for every claim: file path + class + method + line numbers. A claim without a citation is worthless to me.
- If you cannot find something, say "NOT FOUND IN THE CODE I CAN SEE" and name the modules you actually searched. Do NOT guess, do NOT describe how such a feature is usually built, and do NOT invent field names, endpoints or DTOs.
- Quote the actual source of anything I have to reproduce exactly (a DTO, a validator, a regex, a blacklist, an error message).
- Where behaviour depends on configuration (properties/yaml/DB rows), name the exact key and its committed default.'

q_slug() {
  case "$1" in
    1) echo "feature-surface" ;;
    2) echo "definition-schema-and-crud" ;;
    3) echo "runtime-execution-and-binding" ;;
    4) echo "security-creation-time" ;;
    5) echo "security-runtime" ;;
    6) echo "bulk-patterns-and-examples" ;;
    7) echo "ai-api-creator-harness" ;;
  esac
}

q_alias() {
  # Q1 and Q7 sweep all modules: the feature may be split across low-code-platform,
  # admin and the AI modules, and Q7's harness may not live in the LCP module at all.
  case "$1" in
    1|7) echo "" ;;
    *)   echo "$LCP" ;;
  esac
}

q_text() {
# Anchors discovered in session 44652 (2026-08-23): dynamic APIs are SpEL-driven,
# not stored SQL. Entities LcApi / ApiParameter / ApiType / LcApiPageCode;
# ApiManagementService + ApiManagementController; DTOs CreateDynamicApiRequest,
# TestDynamicApiBySpelRequest. Questions are anchored on these so the session digs
# into real code instead of searching. If an anchor turns out to be wrong, say so.
case "$1" in

1) cat <<'Q'
Focus: the DATA MODEL of a Low Code Platform dynamic API.

Start from these classes in erp_low-code-platform (correct me if any name is wrong):
entity/LcApi.java, entity/ApiParameter.java, entity/ApiType.java, entity/LcApiPageCode.java.

1. LcApi: reproduce EVERY field with its Java type, JPA column mapping, nullability, length and default. Explain what each field means in one line — especially `path`, `spel`, the HTTP method field, and any status/enabled/active flag.
2. The DDL: name the migration/changelog file that creates each table and reproduce the column definitions and constraints (primary keys, unique constraints, indexes, foreign keys). Is there a unique constraint on path (+ method)?
3. ApiType: list every enum constant and its exact stored value, and explain what each type changes about how the API behaves at runtime.
4. ApiParameter: every field, and how a parameter is attached to an LcApi. What parameter data types are supported (list every allowed value), and how are "required", "default value" and validation expressed?
5. LcApiPageCode: what it links, and what it is FOR (I suspect authorization) — describe the relationship cardinality and the columns.
6. Any other entity/table in the dynamic-API graph I have not named (audit/log tables, response-mapping tables, version tables). List them with their purpose.
7. Is a definition mutable in place or versioned? Is there an audit trail of who changed a definition and when — which table/columns?
Q
;;

2) cat <<'Q'
Focus: the MANAGEMENT surface — how a dynamic API definition is created, updated and tested. I intend to create dynamic APIs by calling HTTP endpoints myself, so I need the exact contract.

Start from erp_low-code-platform: controller/ApiManagementController.java, service/ApiManagementService.java, and the DTOs controller/dto/CreateDynamicApiRequest.java and controller/dto/TestDynamicApiBySpelRequest.java.

1. Enumerate EVERY endpoint on ApiManagementController: exact HTTP method, exact full path (include any class-level @RequestMapping and the application context path), what it does, and whether it mutates state. Flag clearly which ones create or modify a definition and which are read-only or dry-run.
2. CreateDynamicApiRequest: reproduce the DTO in full — every field, Java type, required or optional, every validation annotation (@NotNull/@NotBlank/@Size/@Pattern/custom), and for constrained fields the allowed values. Do the same for the response type returned by create.
3. TestDynamicApiBySpelRequest and the testDynamicApi / testDynamicApiBySpel endpoints: what exactly do they do, do they execute against real data, do they persist anything, and what do they return? This is my dry-run path — describe how I would use it to validate an expression before creating anything.
4. Walk ApiManagementService's create/update methods line by line and list, in order, every step performed: validation, normalization, defaults applied, persistence, cache/route registration, event publication.
5. Update and delete: are they supported? What happens to a live API on update/delete, and is deletion soft or hard?
6. Is creation gated to the UI or an internal caller? Look for a required pageCode, a referer/origin check, an internal-only annotation, a feature flag, or an @PreAuthorize. Quote the gate and tell me exactly what my HTTP call must carry to pass it.
7. Give me the minimal, complete, realistic JSON body that a successful create call requires — every required field filled with a plausible value, derived strictly from the DTO in the code.
Q
;;

3) cat <<'Q'
Focus: RUNTIME execution of a defined dynamic API. I need to know exactly what happens between my HTTP call and the response.

1. The runtime entry point: which class and method receives a call to a dynamic API's configured `path`? Is it a catch-all controller, a HandlerMapping, a filter, or a servlet? Quote the mapping literal, and tell me the exact URL I call for an LcApi whose path is (say) "my-bulk-check", including any prefix.
2. How is the LcApi resolved from the incoming request (path match, method match)? Is it cached, and what invalidates the cache?
3. SpEL evaluation — the part I most need to get right:
   a. Which class builds the EvaluationContext, and what exactly is available inside an expression? List the root object, every registered variable, every bean or function reachable, and every property accessor/method resolver registered. Quote the context-construction code in full.
   b. Can an expression reach arbitrary Spring beans (e.g. via @beanName or a BeanFactoryResolver)? If yes, that is how I would call repositories/services — show the syntax and give a working example from the code or tests.
   c. How are the declared ApiParameters bound into the expression — as #variables, as a map, as the root object? Quote the binding code, and show the exact syntax I use in `spel` to reference a parameter.
   d. LIST/COLLECTION parameters: how do I declare and pass a collection, and how do I use it inside SpEL (e.g. to feed a repository method taking a List)? Quote the parsing/coercion code. What is the maximum collection size enforced?
   e. Type coercion and nulls: what happens when a parameter is omitted, null, or the wrong type?
4. The response: how is the expression's return value serialised to JSON? What happens if it returns an entity, a List of entities, a Map, a projection, a primitive, or null? Is there a response wrapper/envelope? Are lazy JPA associations a hazard here — what does the code do about them?
5. Transactions: does execution run in a transaction, and is it read-only? Can an expression cause writes?
6. Pagination and result limits: does the runtime support/require pagination? Parameter names, default and maximum page size, and any hard cap on returned rows. Name the enforcing code and the config key.
7. Timeouts: query timeout, request timeout, and what the caller receives when one trips.
8. The complete error model: every failure mode (API not found, bad parameters, SpEL parse error, SpEL evaluation error, permission denied, downstream exception) with the HTTP status and the exact response body shape for each.
Q
;;

4) cat <<'Q'
Focus: the SECURITY and VALIDATION rules that decide whether a dynamic API DEFINITION is ACCEPTED or REJECTED. This is the most important question I will ask you — be exhaustive, walk the actual code path, and quote it.

Because the behaviour is a SpEL expression, arbitrary-expression execution is the central risk. For EVERY check, give class + method + line, what it inspects, the exact failing condition, and the exact exception/error code/message.

1. Walk the create/update path in ApiManagementService from controller entry to persistence and list every validation performed, in order.
2. SpEL sandboxing — the crux. Is the expression restricted in any way before it is stored or evaluated?
   a. Is there an allowlist or denylist of types, packages, beans or methods? Reproduce it verbatim and in full, and name where it is maintained (code constant, config key, DB table).
   b. Is a restrictive TypeLocator / BeanResolver / MethodResolver / PropertyAccessor installed, or is a default StandardEvaluationContext used (which would allow T(java.lang.Runtime) and reflection)? Quote the context construction and state plainly whether expressions are sandboxed or effectively unrestricted.
   c. Are dangerous constructs specifically blocked — T() type references, `new` object construction, reflection, class loading, file/network access, System/Runtime/ProcessBuilder, assignment to properties, calls to repository save/delete/update methods? Quote each block, or state clearly that it is NOT blocked.
   d. Is the expression parse-checked at creation time (compiled/parsed to catch syntax errors before storing)? Quote it.
3. Are writes (persist/merge/remove, native queries, DDL, HTTP calls out) prevented in an expression? Quote the enforcement, or say it is not prevented.
4. Path/name rules: constraints on `path` (character set, length, reserved prefixes, uniqueness, case sensitivity), and what happens on collision with an existing LcApi or with a real Java controller route. Which wins?
5. Mandatory scoping: does the platform require or inject anything into the behaviour — a row limit, a company/branch/tenant filter, a soft-delete filter, a test-data filter? Quote it and state exactly what my definition must contain to pass.
6. Authorisation to CREATE: the exact authentication requirement and the exact authorisation requirement on the create endpoint — role, permission code, privilege, pageCode/menu binding, feature flag. Name the concrete string values, and how I check whether my token has them.
7. Approval/publication: does a created dynamic API become callable immediately, or does it need review/approval/enabling by someone else? Name the states, the transitions, and who can advance them.
8. Anything else in the path that can reject a definition and that I have not asked about.

Finish with a CHECKLIST: "for a definition to be accepted and safe, it must ..." — one line per hard requirement, each traceable to code you cited. Where the platform does NOT enforce something I would expect, say so explicitly and mark it as a discipline-we-must-self-impose rather than a platform guarantee.
Q
;;

5) cat <<'Q'
Focus: the SECURITY controls applied at RUNTIME when a dynamic API is CALLED. Quote code (class:line) for each, and name the config key and committed default where behaviour is configurable.

1. Authentication: what must a call to a dynamic API carry? Name every header the security chain requires — the Authorization JWT, `secc-ch-ua-platform`, `pageCode`, and any other — and for each: which filter/interceptor validates it, how, and what happens if it is missing or wrong. What is `secc-ch-ua-platform` actually for, and how is a valid value obtained?
2. The JWT: issuer, claims, lifetime, and how it is validated. Is there a service-account / machine-to-machine / long-lived token pattern for automation, or only short-lived user tokens? If only user tokens, what does the code support for an unattended automation that must run on a schedule? Answer from the code, not from good practice.
3. Authorisation per API: how does the platform decide whether THIS caller may call THIS dynamic API? Explain the role of LcApiPageCode precisely — how a pageCode gates an API, how the incoming `pageCode` header participates, and the exact steps I take to grant a caller access to an API I create. Quote the check.
4. Is the caller's identity injected into execution as a scope filter (user, company, branch, department)? Quote the injection, and say what happens if my expression already filters on the same thing.
5. Rate limiting, throttling, concurrency caps applying to dynamic API calls: the limits, the scope counted over (per user / per API / per IP / global), the response when exceeded, and the config keys. If none exist, say so plainly.
6. Runtime guards on size: maximum rows, maximum response bytes, maximum request body size, maximum input collection length. Name each and its enforcing code — or state that the limit does not exist.
7. Audit logging: what is recorded for a dynamic API call (caller, api id, parameter values, row count, duration, errors), which table or log receives it, and retention. Specifically: are parameter VALUES persisted — i.e. would passing a list of contract identifiers write that list somewhere?
8. Abuse/anomaly controls: timeout kills, circuit breakers, auto-disabling a failing or slow API, alerting.
9. Data protection on the way out: any masking, redaction or encryption applied to response fields, and which fields it covers.
10. For a HIGH-VOLUME automated use case — repeated bulk reads on a schedule — name in order the limits I would hit first, with the enforcing code, and what the platform expects me to do instead.
Q
;;

6) cat <<'Q'
Focus: my actual use case, and the precedent already in the codebase.

The use case: an audit process today issues ONE ERP request PER CONTRACT, which is far too slow for a few thousand contracts. I want a dynamic API that accepts a LIST of contract identifiers (or a filter such as "all active contracts of type X") and returns one row per contract with a handful of fields, in a single call.

1. PRECEDENT — most important: are there existing LcApi definitions anywhere I can copy the shape of? Look in migrations/changelogs, SQL seed/data files, tests, fixtures, and any committed export. For each one you find, give the file, the `path`, the HTTP method, the parameters, and the full `spel` expression verbatim. I want real accepted examples, not invented ones.
2. Of those, which take a collection input or return many rows? Show exactly how the collection is declared as an ApiParameter and used inside the SpEL.
3. From SpEL, how do I reach data? Show the concrete syntax for calling a Spring bean's method (repository or service) inside an expression, with a real bean name from this codebase, and name which beans are actually reachable.
4. Contract data: name the entity, the table, and the primary-key column a contract-keyed bulk read targets. Name the repository bean and a repository method (with signature) that takes a collection of ids and returns many contracts — or the closest existing method. Also name any soft-delete / status / test-or-fake-data column that convention requires filtering on.
5. Recommended shape for my API: collection-of-ids input versus a server-side filter input. Justify from the platform's real limits (max collection size, max rows, pagination, timeouts) — cite the numbers and their enforcing code.
6. Practical numbers: the largest id list one call may carry, the largest number of rows one call may return, and therefore the chunk size I should use for a few thousand contracts. Cite the code behind each number, or say the limit is unenforced.
7. Can one dynamic API read across tables owned by different ERP modules, or across databases/schemas? What is actually allowed, and quote the restriction.
8. TESTING: the exact call I make to dry-run my expression before creating the definition (use the testDynamicApiBySpel path if that is what it is for) — method, URL, headers, body — and what it returns.
9. The failure modes you would expect THIS design to hit (N+1 lazy loading, serialization of entity graphs, transaction scope, memory on large result sets, expression timeout), and how to avoid each.
Q
;;

7) cat <<'Q'
Focus: the AI-assisted API creation path, as distinct from the read-only code-question API I am using right now.

Context: I am talking to you via POST /lowcode/c2d/query/async (repo_type "erp", multi_workspace true, a project_alias list, header pageCode: lc_conversation). I am told there is also a capability that CREATES APIs from a prompt — an "API creator".

1. Does it exist in the code? Name it, its module, and its classes. If you cannot find it, say so plainly and list the modules you searched — do not speculate.
2. Enumerate every endpoint under /lowcode (and any sibling low-code namespace) with exact path, method, request body and response body. Mark each as read-only or state-changing, and identify specifically any endpoint that generates, previews, validates, creates or deploys an API definition or source code.
3. For the creation/generation endpoint(s): reproduce the request DTO in full — every field, type, required or optional, allowed values — including how model, repo, workspace, project and page/permission context are specified.
4. What does it DO with the prompt? Trace it: does it generate Java source and commit it to a repository (which repo, which branch, does it open a pull request?), or does it write an LcApi row that the runtime interprets? Answer definitively, with the code path.
5. What human gate sits between the prompt and a live callable endpoint — code review, PR approval, an approval state, a deploy? Name who can pass each gate.
6. What does it REFUSE? Any guardrails or validators applied to a generated API — the same rules as a hand-written definition, or different ones? Quote them.
7. What must a prompt contain for the generated API to be accepted first time — required sections, expected grounding, enforced conventions (naming, package, read-only, error handling)? If a prompt template or examples exist in the repo, quote one verbatim.
8. Which role/permission is required to call it, and how do I tell whether my token has it?
Q
;;
esac
}

run_q() {
  local n="$1" slug alias file
  slug="$(q_slug "$n")"
  [[ -z "$slug" ]] && { echo "unknown question: $n" >&2; return 1; }
  alias="$(q_alias "$n")"
  file="$OUT/q${n}-${slug}.md"
  echo "→ Q$n ($slug) [alias: ${alias:-ALL MODULES}]" >&2
  {
    echo "<!-- Q$n $slug | project_alias: ${alias:-[] (all modules)} -->"
    echo
    ASK_CODE_TIMEOUT="${ASK_CODE_TIMEOUT:-900}" \
      "$DIR/scripts/ask-code.sh" "$(q_text "$n")$RIGOR" "$alias"
  } >"$file" 2>"$file.err"
  local rc=$?
  if (( rc == 0 )); then
    echo "  ✓ Q$n → $file ($(wc -l <"$file") lines)" >&2
    rm -f "$file.err"
  else
    echo "  ✗ Q$n failed (rc=$rc) — see $file.err" >&2
  fi
  return $rc
}

QUESTIONS=("$@")
if (( ${#QUESTIONS[@]} == 0 )); then QUESTIONS=(1 2 3 4 5 6 7); fi

# docs/code-llm-api.md: 3 simultaneous conversations verified safe. Stay at 3.
i=0
for n in "${QUESTIONS[@]}"; do
  run_q "$n" &
  ((++i % 3 == 0)) && wait
done
wait

echo >&2
echo "Raw answers in $OUT" >&2
echo "Next: fold them into docs/lcp-dynamic-apis.md, and re-ask any question that came" >&2
echo "back NOT FOUND while pinned to a single module (module-visibility hazard —" >&2
echo "see docs/code-llm-api.md)." >&2
