---
name: erp-audit-flow-builder
description: End-to-end automated process for building a maids.cc audit check as an n8n flow from a written spec — probe the ERP APIs, document their payloads, resolve the business logic, build via the n8n MCP, test end to end, and validate the results. Use this whenever someone hands over an audit spec (a Notion check page, a Jira ticket, a description of a check) and wants a flow built, or says anything like "build this flow", "develop this check", "make an n8n flow for this spec", "automate this audit", or "probe these APIs and build it". Also use when resuming a half-built check, when re-probing ERP access for a check, or when a check needs its logic validated against live ERP data. Run this rather than improvising a build order — the phase order exists because skipping ahead produces flows that look finished and quietly clear contracts they shouldn't.
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
  the execution architecture, not just the runtime.
- **Note free wins.** Fields arriving inline that the spec expected to fetch
  separately can delete whole enrichment passes and permission dependencies.

Emit amounts and identifiers into working files, **never into chat or logs** —
see [Output hygiene](#output-hygiene).

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

**Ask the code before you ask a person.** The ERP codebase is not available locally, but it is
queryable: the ask-the-code API (the Low Code Platform code-LLM, `scripts/ask-code.sh`, guide in
`docs/code-llm-api.md`) answers questions about how the ERP actually behaves. Most questions that
look like they need the spec owner are really questions about the system, and the system can be
asked directly at no cost to anyone's attention. Do that first — it is often faster than waiting,
and it removes the question from the list entirely rather than deferring it.

**Then verify what it tells you. Never take its answer as fact.** It is a model reading a
codebase, not the codebase. It is confidently wrong often enough that an unverified answer is a
liability, and the failure is silent: a plausible wrong answer becomes a rule in your scorer and
nothing downstream disagrees with it. So treat every answer as a hypothesis and close it against
something that cannot be mistaken:

- **Probe the live API** and check the field is really there, really that shape, really populated
  on real entities. A field the code-LLM describes may be dead, renamed, or always null in
  practice.
- **Ask again differently.** Re-ask the same question from another angle, or ask for the method
  and the call site rather than the behaviour. An answer that changes under rephrasing was never
  knowledge.
- **Make it cite.** Ask which class, method and line the answer comes from, then ask for that
  code. An answer that cannot name its own source is a guess wearing a suit.
- **Watch for the two specific lies.** "This template is sent from method X" often means the
  template is *referenced* there, not sent — the send may be commented out or gated by a flag.
  And a scheduled send is not a sent send: trace it through the dispatch method's runtime gates,
  because a branch can be permanently suppressed and still look live in the code.

Where the answer changes an outcome and you could not verify it, say so in the run summary and
route the affected cases to a human. An unverified assumption that stays invisible is the same
false-clearance shape as everything else in this file.

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
   returning slim projections, so the parent retains kilobytes.
3. **Always build through the n8n MCP**, in the correct project. If no staging flow
   exists, create a new one. Never hand-edit JSON when a tool exists.
4. **Wire credentials via `addNode`** — the only path that works — then read back and
   verify. Assert credentials inside the run too, because build-time success doesn't
   guarantee runtime binding.
5. **Assert reference data with a checksum** before scoring anything against it.
6. **Deliver as a draft.** Never publish, never schedule, never activate.
7. **Do not treat Phase 5b as optional or as cleanup.** The load layers are part of the build,
   not a pass over it afterwards — a flow without them is not a draft, it is a hazard.

**Prefer building the deterministic scorer as standalone code first** and testing it
offline against the spec's test cases. It's faster to iterate outside n8n, and it
gives you a fixed reference: if a later refactor changes the known-good numbers, the
refactor is wrong.

## Phase 5b — ERP load safety (mandatory, not a nice-to-have)

ERP is production. It serves the business while we read it, and **audit traffic has taken it
down three times**. The cause was never a reckless node. It was that a per-item HTTP node's cost
is invisible at build time and only becomes load in production: a flow tested on ten contracts
behaves identically to one running against five thousand.

`audit-flows/ERP-LOAD-POLICY.md` is **binding on every flow, existing and future**. Read §7
before you wire anything. The shape is not four independent good ideas — it is four layers, each
of which sees exactly one thing and is blind to the others:

```
  [0] TWO ENTRIES ......... webhook + Retry Entry -> ONE Normalize Entry node
  [1] LEASE ACQUIRE ....... is another audit already hitting ERP? (no_wait; re-invoke if queued)
  [2] sweeps .............. paced
  [3] BUDGET GATE ......... how many calls will the per-entity phase make?
  [4] canary chunk ........ first batch small, so the breaker gets a cheap verdict
  [5] per-entity phase .... paced; every projection node carries the CIRCUIT BREAKER
  [6] LEASE RELEASE ....... on BOTH rails
```

Pacing knows the rate and nothing about the count. The gate knows the count and nothing about
whether the calls succeed. The breaker knows how ERP is answering and nothing about who else is
calling it. The lease knows who else is calling and nothing about any of the rest. **Drop one
and the others do not cover for it** — which is how a flow can be perfectly paced, correctly
budgeted, and still take ERP down because a second audit started ten minutes later.

What you must do, in order:

1. **Declare `ERP_CALLS_PER_ENTITY` before writing the node that makes the calls.** If you
   cannot state the number, you do not yet understand the phase you are about to build.
2. **Pace every ERP node: 2 concurrent / 500 ms, with a timeout.** Copy the numbers from the
   policy, never from a sibling flow — cloning is how `batchSize: 15` (30 req/s, three times the
   documented ceiling) reached every node of every flow. Nobody chose 15.
3. **Wire the pre-flight budget gate** into the last Code node before the first per-entity call.
   It projects the run's cost and **hard-fails over budget — it never trims the work to fit.** A
   partial audit that looks complete is worse than a refused one.
4. **Acquire the ERP lease before the first ERP call and release it on both rails.** A release
   that never fires leaves a 3-hour hole in the queue.
4b. **Pass `no_wait: true` and build the self-re-invoke rail.** The acquire must never block.
   n8n cancels any execution 2400 s after it starts and the kill is **silent** — status
   `canceled`, nothing thrown, no error rail, the run simply vanishes — so a flow that waits
   inside one execution has a 40-minute ceiling on its wait AND no way to report crossing it.
   Instead: `no_wait: true` → on `queued`, pause 60 s, re-invoke this workflow, exit. Copy the
   shape from `audit-flows/cc-price/README.md`; four things there are load-bearing and every one
   of them failed live before it worked:
   - **two entries, one normalizer** — the webhook and a `Retry Entry` trigger both feed a
     `Normalize Entry` Code node, and *everything downstream reads the request from that node*.
     `$('Run (webhook)')` throws in any execution where the webhook did not run, which is every
     retry.
   - **pin `run_id` in the retry payload** — otherwise the retry is a brand-new run with a new
     queue ticket at the back of the line, and it can be overtaken for ever.
   - **`Re-queue Self` must be fire-and-forget** (`waitForSubWorkflow: false`), or the parent
     stays alive across attempts and meets the ceiling anyway.
   - **skip the webhook response on retries** — there is no webhook to answer.
5. **Generate the circuit-breaker block into every projection node** that reads a batch of ERP
   responses: `python3 audit-flows/tools/build_breaker_embed.py`. **Generate, never hand-copy** —
   a hand-copied safety check is one nobody can tell has drifted.
6. **Size the first chunk as a canary.** The breaker cannot speak until a batch finishes, so the
   first batch is what an already-failing ERP costs you before anything of yours gets a say.
7. **The first run of any new flow is capped. No exceptions.**
8. **Run the checkers before publishing.** Export the flow and run
   `python3 audit-flows/tools/erp_compliance.py --all`. Green or it does not ship.

Three traps worth knowing before you meet them:

- **An auth failure is not degradation.** A 401/403/498 is a permission or a dead token — the
  same answer arriving fast, every time. One route in this system returns
  `INSUFFICIENT_PERMISSIONS` on *every* call, thousands unbroken. A breaker that counted those
  would trip on call five of every run ever fired, and the fix anyone reaches for then is to
  raise the threshold until it stops complaining.
- **The breaker cannot trip mid-batch.** n8n's HTTP node returns only when its last request is
  done. Whatever your batch size is, that is how many calls a failing ERP takes before you can
  react.
- **n8n static data persists between production executions, not manual ones.** Anything the
  breaker carries between chunks is inert on the canvas. Log that it is absent rather than
  letting a dead check look healthy.

**Retrofitting an existing flow** is the same list run backwards: export it, run
`erp_compliance.py`, and fix what it names. It prints where each missing layer belongs. If a
layer legitimately lives in the caller, say so *in the flow* with the `ERP-COMPLIANCE:` marker
the checker looks for — a declared exemption is visible to the next reader; a silent one is a
blind spot, and this project has already watched a green suite hide a whole misfiled review
queue.

## Phase 6 — Test end to end

Goal: evidence it works, produced by you and not requiring the human to run anything.

1. **Offline first.** Run the deterministic logic against every row of the spec's
   test cases plus guards for each edge the rules name (missing fields, absent
   reference windows, zero-valued discounts, category mappings that differ by axis).
   Independently reproducing the spec's own verified figures is the strongest signal
   the logic is right.
2. **Then live, small — and capped.** One batch against real data, with an explicit cap in
   the params. Confirm the population count, the reference checksum, and that verdicts land
   where they should. "Small" is a number you set, not a hope about the data.
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

Everything else is automated. These three are not:

1. **The ERP token** — one paste per session from the operator. See Phase 1.
2. **Genuinely undecidable business rules** — only those passing Phase 4's four tests.
3. **Sign-off before a real run against production, and before publishing or
   scheduling.** Findings from these checks reach real clients and real money.
   Build completion is not approval, and the person who commissioned the build may
   not have read the spec. Where a spec names a maker/checker, that sign-off is
   theirs to give.

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

## Reporting as you go

Autonomy is not silence. After each phase, post a short status: what you did, what
you found, what changed in your plan, what's next. Surface bad news immediately —
a blocked population endpoint discovered in Phase 2 is useful; discovered at handover
it means the whole build was speculative.

Report in the register of the person you're talking to. A colleague who hasn't read
the spec needs the consequence, not the mechanism.
