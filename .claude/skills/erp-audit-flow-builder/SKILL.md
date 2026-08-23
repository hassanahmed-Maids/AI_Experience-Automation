---
name: erp-audit-flow-builder
description: End-to-end automated process for building a maids.cc audit check as an n8n flow from a written spec — probe the ERP APIs, document their payloads, resolve the business logic, build via the n8n MCP, test end to end, and validate the results. Use this whenever someone hands over an audit spec (a Notion check page, a Jira ticket, a description of a check) and wants a flow built, or says anything like "build this flow", "develop this check", "make an n8n flow for this spec", "automate this audit", or "probe these APIs and build it". Also use when resuming a half-built check, when re-probing ERP access for a check, when a check needs its logic validated against live ERP data, or when a check is too slow because it calls the ERP once per contract and needs a better API architecture (a purpose-built bulk endpoint). Run this rather than improvising a build order — the phase order exists because skipping ahead produces flows that look finished and quietly clear contracts they shouldn't.
---

# ERP audit flow builder

Build a maids.cc audit check from spec to validated n8n flow, autonomously.

Default to acting. This process is designed to run start to finish without check-ins;
the person handing over the spec should be able to walk away. There are exactly three
things you cannot decide alone, listed in [Where humans are required](#where-humans-are-required).
Everything else — probing, documenting, architecture, code, tests, verification — is
yours to do and report.

**Read `references/erp-and-n8n-traps.md` before Phase 1.** Every item in it was
learned by hitting it in production. It will save you hours and prevent at least two
classes of silent wrong answer.

## Why the order matters

Each phase produces the input the next one needs. Probing before documenting means
you document what actually returns, not what the spec claims. Documenting before
logic means the logic is written against real field shapes. Logic before building
means you don't build twice. Testing before validating means you have output to
validate. Skipping ahead is how you end up with a flow that runs clean and is wrong —
the expensive failure, because it looks like success.

---

## Phase 1 — Get a working ERP token

Goal: a token that demonstrably works, with the operator's involvement minimised but
not eliminated.

Throughout, "the operator" means whoever is running and authorising this run. Make no
assumption about who that is — it may be the person in the conversation, a colleague
running it on their own machine, or a dedicated audit service account. Nothing here is
specific to any individual.

1. **Check for an existing credential first.** List n8n credentials and look for a
   current ERP credential in the target project. If one exists, try it before asking
   for anything.
2. **If none works, ask the operator once, precisely.** Request the bearer token and
   the numeric device id, and say it only needs to last the session. Don't ask for a
   cookie blob — you need two values, and a full cookie header drags in analytics
   cookies and unrelated secrets for no benefit.
3. **Verify immediately** with one cheap call before doing anything else. A dead
   token produces the 498-inside-500 shape, not a 401 — see the traps file. Say
   plainly "that token is expired, I need a fresh one" rather than reporting a
   server error.
4. **Take the token as a runtime payload**, never a literal in a Code node or header,
   and never a value you write into a stored credential. The flow holds no ERP
   credential of its own; it uses the operator's token per run.

**Do not automate token acquisition.** No scripted SSO login, no browser automation
against a login page, no credential capture. It would mean handling someone's
identity-provider credentials, and it removes the authorising human from a process
whose output accuses named clients.

**The token must belong to the operator.** Any authorised person's token is fine —
what doesn't work is running on a token issued to someone who isn't the one running
it. Three concrete reasons:

- ERP logs every read under the token's identity, so findings get attributed to
  someone who didn't produce them. Where that person also reviews or signs off the
  check, the reviewer becomes the actor in their own evidence.
- Permissions tested on a borrowed token get recorded as working and stay recorded.
  This is an observed failure, not a hypothetical: a route documented as verified
  turned out to be refused on the auditing account, because the original check had
  been made on a different login.
- Borrowed tokens mask access gaps. **If the operator's token lacks a permission,
  that is a finding to report**, not an obstacle to route around.

When a colleague has access the operator doesn't, the version that works is: they
trigger the run themselves, or the permission is granted to the operator or the
service account. Same data, attribution intact.

## Phase 2 — Probe every API the spec needs

Goal: know exactly which surfaces are readable before writing any logic.

1. **Enumerate from the spec**, not from memory. Collect every endpoint the check
   needs: population/enumeration, the values being compared, the reference data, and
   the evidence sources a human reviewer would read. Include the independent count
   source if the check needs a completeness guard.
2. **One probe per surface, with the real pagecode and the real body.** Use known-good
   ids from the spec's test cases. Where documentation claims a pagecode works,
   probe that pagecode *and* a plausible alternative — a wrong pagecode and a missing
   permission both return 401, and only the `developermessage` header separates them.
3. **Pace it.** Production ERP: max 5 concurrent, 500 ms between batches. A handful
   of probes should just be serial.
4. **Capture status, headers and shape** — never assume. Use full-response mode so a
   non-2xx doesn't get swallowed by an error rail.
5. **Classify every failure** into one of the three denial shapes. Report
   `INSUFFICIENT_PERMISSIONS` separately from `SecurityException` separately from a
   dead token — they need different requests to different owners.

**Report back a table**: surface, pagecode, status, denial shape, and whether the
check can proceed without it. Distinguish blockers (no population = no run) from
degradations (an unreadable evidence source caps verdict confidence but still runs).

If a surface is blocked, **do not build a workaround that guesses at the data**. Build
the degraded path the spec defines: the surface is unavailable *for the whole
population*, so cases proceed on readable surfaces and affected verdicts are capped
and labelled with the named gap. Silently defaulting a missing input is how a check
clears contracts it never actually examined.

## Phase 3 — Document payloads and responses

Goal: a written record that makes the next build cheaper and corrects the spec where
it's wrong.

For each working surface record: method, full path, pagecode, complete request body,
response envelope shape (bare array vs paged vs object), the key names you'll read,
and any trap you hit. Then:

- **Write corrections back to the spec's variable rows.** If a documented route
  doesn't behave as recorded, fix the record and say what evidence changed it. Stale
  "verified" rows cost more than blank ones.
- **Recount the call budget.** Specs routinely cost only the population sweep and
  omit per-entity enrichment. Multiply properly: per-contract calls × population.
  If the real figure is an order of magnitude above the spec's, say so — it changes
  the execution architecture, not just the runtime. Then go to
  [Phase 3b](#phase-3b--consider-a-purpose-built-erp-api) **before** you design around
  the absence of a bulk endpoint.
- **Note free wins.** Fields arriving inline that the spec expected to fetch
  separately can delete whole enrichment passes and permission dependencies.

Emit amounts and identifiers into working files, **never into chat or logs** —
see [Output hygiene](#output-hygiene).

## Phase 3b — Consider a purpose-built ERP API

Goal: decide whether this check deserves its own bulk endpoint, before you spend the
build working around the absence of one.

Phase 3's budget recount is the trigger. When the cost is dominated by **per-entity
enrichment** — the same few fields fetched once per contract, across thousands of
contracts — the answer is usually not a cleverer flow. It is one endpoint that takes a
list and returns a row per entity. The Low Code Platform can create one as
*configuration* rather than a deployment, so this is a realistic move inside a build, not
a quarter-long request to a backend team. Mechanism, limits and the full rule set:
`docs/lcp-dynamic-apis.md` in the AI_Experience-Automation repo — read it before
proposing one. **How to write the prompt, plus a worked grounded example and the review
checklist: `references/bulk-api-prompt.md`.**

**Propose one when all of these hold:**

- **Per-entity calls dominate.** Population × per-entity calls is an order of magnitude
  above a single sweep. Pacing is max 5 concurrent / 500 ms — roughly 10 calls/s — so do
  the division and state the wall-clock, not just the call count. Thousands of contracts
  × two enrichment calls is hours; that is the number that justifies the work.
- **The fields are few, scalar, and identical for every entity.**
- **They are persisted.** A value the ERP never writes to a table cannot be recovered by
  an id-keyed API, however the request is phrased. Confirm persistence before proposing.
- **They live in one module.** One expression cannot span modules — two modules means two
  APIs, which may not be worth it.
- **Nothing existing already returns them in bulk.** Re-read Phase 2's table first: an
  inline field you overlooked is cheaper than any new endpoint, and Phase 3 already tells
  you to look for exactly that.

**Don't propose one when:**

- The population is small (a few hundred), or the check is genuinely one-off. The review
  overhead outstrips the saving.
- The check needs to **write**. These are read-only; a write path is a different
  conversation with a different owner.
- The fields are personal or financial. Keep them out entirely — see
  [Output hygiene](#output-hygiene).

**Check access before you promise it.** The LCP management endpoints are authorised by
**per-page API registration**, so a token can be perfectly valid and still be refused. Probe
first — a GET on `/lowcode/apis/types` with the console pageCode — and read the
**`developermessage` header**, not just the status: `PAGE_CODE_MISSING` means you omitted the
header, `PAGE_NOT_FOUND` means that page doesn't exist, and `API_NOT_FOUND_FOR_PAGE` means the
page is real but the endpoint isn't granted to it. All three surface as a bare `401` — the same
trap Phase 2 warns about. If the grant is missing, **that is a finding to report**: do not
brute-force pagecodes until one answers, and do not promise a timeline that depends on access
nobody has confirmed. The fallback that works is to hand the finished prompt to someone who
holds the grant. (Verified 2026-08-23: the audit team's own token is *not* granted these
endpoints — see `docs/lcp-dynamic-apis.md` §8b.)

**If you propose one, do the work properly:**

1. **Ground it first**, via ask-the-code: the entity, table and primary key; a repository
   method taking a collection, with its exact signature; enum constants with their stored
   values; and the soft-delete / status / test-or-fake-data columns. Cite `class:line`.
   This grounding *is* the deliverable — creation is driven by a natural-language prompt,
   so an ungrounded prompt buys you a confidently wrong endpoint.
2. **Specify the shape**: a BODY collection of ids; one repository call with
   `... where x.id in :ids`; a projection of exactly the scalar columns needed, never
   managed entities; and every filter written *into* the expression. Nothing is injected
   for you — not a row limit, not a soft-delete filter, not a test-data filter.
3. **State the saving** in the run summary: calls and wall-clock before, calls and
   wall-clock after. If it isn't at least an order of magnitude, say so and build without
   it. "It felt cleaner" is not a justification for a new production endpoint.

**Comply with these yourself, because the platform does not enforce them.** The expression
evaluates in an unrestricted engine with access to arbitrary application beans, and the
creation path performs no validation of it at all:

- **Read the generated expression before anything depends on it.** Nothing reviewed it —
  there is no approval gate and no automatic check.
- **Judge `T(...)` by what it references, not by its presence.** The sanctioned idiom for
  reaching a bean *is* a type reference —
  `T(com.magnamedia.core.Setup).getApplicationContext().getBean('someBean').method(...)` —
  and every committed dynamic API in the ERP uses it, so a blanket ban would reject the
  convention. What must be rejected is a `T(...)` naming a **prohibited class**: Runtime,
  ProcessBuilder, System, Class, reflect.Method, reflect.Field, File, FileInputStream,
  FileOutputStream, Files, Paths. A validator endpoint exists for exactly this list — but
  it only *reports*, and nothing invokes it automatically. Run it yourself and treat any
  hit as a hard stop, not a warning. Reject `new`, reflection, and any bean call that
  isn't a read, unconditionally.
- **Never reference `Parameter`, `CoreParameter` or `BackgroundTask`** anywhere in an
  expression — a substring match rejects it outright.
- **Never request a public endpoint.** It means no authentication.
- **Chunk the calls** (~200 ids is a working default). There is no row cap, no result-size
  cap, no query timeout and no rate limit anywhere in this path — nothing stops a runaway
  query except you.
- **Never debug-run an API whose response carries sensitive fields.** The debug log
  persists full request and response bodies unmasked, with no retention policy.

Designing, grounding, costing and dry-running one is yours to do. **Creating one on
production is a human gate** — see [Where humans are required](#where-humans-are-required).

## Phase 4 — Resolve the business logic

Goal: every rule implementable, with the minimum possible questions asked.

Work the spec's rules yourself first. Most apparent ambiguity dissolves on a careful
read or a live ERP check. **Only ask when a question passes all four of these:**

1. The spec genuinely doesn't answer it — you've read the rule bodies, not just titles.
2. You can't settle it by probing live data.
3. Getting it wrong changes an outcome, not just a label.
4. No conservative default exists that avoids a false clearance.

**Do not manufacture questions to look thorough.** A list of questions the spec
already answers trains the owner to ignore your questions, which costs you the one
time you genuinely need an answer. If you have no questions, say so and proceed.

When you do ask, and the reader is a busy colleague rather than a formal stakeholder:

- Lead with the one question that actually changes behaviour. Cap it at 2–3 asks.
- One line of context each — the risk, not the mechanism.
- State the default you'll use if they don't reply, so nothing blocks.
- Plain language: no rule numbers, no endpoint names, no internal jargon.
- Batch them into one message. Never drip-feed.

**Two spec pathologies to expect.** *Internal contradictions* — a policy body and a
test-case table giving different answers for the same case. Don't pick silently;
implement the more conservative reading, flag it, and note both. *Undefined rules* —
a rule naming tests that were never written down. Score them as NOT PASSED, route
affected cases to human review, and **declare the inflation in the run summary**.
A quietly absorbed gap is worse than a loud one.

## Phase 5 — Plan and build

Goal: a working draft flow, built on proven rails.

1. **Clone a golden, don't start blank.** Find the closest working sibling check and
   clone its architecture. The rails — pacing, error handling, run bookkeeping,
   delivery — are already proven; only the check-specific logic should be new.
2. **Choose the execution shape from the data budget.** Estimate retained data:
   per-entity payload size × population. Large per-entity enrichment across thousands
   of entities cannot live in one execution — use a staged chain or a sub-workflow
   returning slim projections, so the parent retains kilobytes. If Phase 3b produced a
   bulk endpoint, re-estimate before cloning: a list-in/rows-out call often collapses the
   staged chain you would otherwise have needed into a single paced loop.
3. **Always build through the n8n MCP**, in the correct project. If no staging flow
   exists, create a new one. Never hand-edit JSON when a tool exists.
4. **Wire credentials via `addNode`** — the only path that works — then read back and
   verify. Assert credentials inside the run too, because build-time success doesn't
   guarantee runtime binding.
5. **Assert reference data with a checksum** before scoring anything against it.
6. **Deliver as a draft.** Never publish, never schedule, never activate.

**Prefer building the deterministic scorer as standalone code first** and testing it
offline against the spec's test cases. It's faster to iterate outside n8n, and it
gives you a fixed reference: if a later refactor changes the known-good numbers, the
refactor is wrong.

## Phase 6 — Test end to end

Goal: evidence it works, produced by you and not requiring the human to run anything.

1. **Offline first.** Run the deterministic logic against every row of the spec's
   test cases plus guards for each edge the rules name (missing fields, absent
   reference windows, zero-valued discounts, category mappings that differ by axis).
   Independently reproducing the spec's own verified figures is the strongest signal
   the logic is right.
2. **Then live, small.** One batch against real data. Confirm the population count,
   the reference checksum, and that verdicts land where they should.
3. **Then live, full** — only once the small run is clean.
4. **Read execution output back** every time. A `success` status means the workflow
   didn't crash, not that it did the right thing.

Expect to find bugs here, and expect them to be false clearances rather than crashes.
The two most common: a later passing test overriding an earlier gate's routing
decision, and a NULL comparison result being indistinguishable from a genuine match.
Both clear entities that should have been reviewed. When you find one, fix it and
say what it would have done in production.

## Phase 7 — Validate the results yourself

Don't hand over "it ran." Hand over evidence. Produce:

- **Test results** against every spec test case, with the figures.
- **A field-level diff** versus the golden: every node changed, every field changed
  inside the enumeration request, and the row count each produced.
- **A population proof**: the count, an independent count from a second source, and
  the delta *explained*. An unexplained delta is a finding, not a rounding error.
- **Any declared gaps**: unimplemented rules, blocked surfaces, capped verdicts,
  spec deviations — each named, with its effect on the numbers.
- **Spec corrections filed**, not just noticed.
- **A statement of what still needs a human** and why.

Then check your own output the way a reviewer would: could any clearance in here be
wrong? A check that flags too much wastes review time. A check that clears wrongly
defeats its own purpose and nobody finds out.

---

## Where humans are required

Everything else is automated. These four are not:

1. **The ERP token** — one paste per session from the operator. See Phase 1.
2. **Genuinely undecidable business rules** — only those passing Phase 4's four tests.
3. **Sign-off before a real run against production, and before publishing or
   scheduling.** Findings from these checks reach real clients and real money.
   Build completion is not approval, and the person who commissioned the build may
   not have read the spec. Where a spec names a maker/checker, that sign-off is
   theirs to give.
4. **Creating a new ERP API on production** (Phase 3b). Propose it, ground it, cost it
   and dry-run it autonomously — then get one explicit go-ahead before creating it. It is
   a persistent, callable server-side endpoint that no platform review gates, so the
   operator is the only reviewer it will get. One line is enough; don't turn it into a
   ceremony. Editing or replacing an API you already created under the same check does
   not need a fresh ask.

If asked to remove the third one, say what it protects rather than just complying.
A check that publishes findings about named clients without a second reader is a
different risk category from a slow build.

## Output hygiene

These checks handle client financial data and staff personal data.

- Per-entity amounts, identifiers and gaps belong **in the case store** — the Data
  Table or portal record. That store *is* "behind the case".
- Chat, run summaries, logs and anything a human sees in passing carry **counts,
  flags and totals only**.
- Never print names, contact details or salaries anywhere. When confirming a field
  exists, report the key path, not the value.
- Never substitute the data warehouse for the system of record as authority. Use it
  to orient; confirm against the ERP.
- Never set up recurring or scheduled data pulls as part of a build — route those
  to the ERP/Data team.
- Never put personal or financial fields into a purpose-built API (Phase 3b). Its debug
  log stores whole request and response bodies unmasked and unpurged, so those fields
  would outlive the run in a place nobody is watching.

## Reporting as you go

Autonomy is not silence. After each phase, post a short status: what you did, what
you found, what changed in your plan, what's next. Surface bad news immediately —
a blocked population endpoint discovered in Phase 2 is useful; discovered at handover
it means the whole build was speculative.

Report in the register of the person you're talking to. A colleague who hasn't read
the spec needs the consequence, not the mechanism.
