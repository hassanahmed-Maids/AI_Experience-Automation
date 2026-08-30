# Delivery plan — build the 12 specced checks, ship the staging ones to Jira

**Date:** 2026-08-30 · **Author:** this session · **Basis:** full sweep of all seven
`Checks — <Category>` databases, the ERP Variables Database (192 rows), the three staged flows read
node-by-node via the n8n MCP, and the one existing prod-deployment ticket.

---

## 0 · What is actually in flight

26 live rows, not the 12 the queue suggests. Three tracks, and they are blocked on completely
different things:

| Stage | Count | Blocked on |
|---|---:|---|
| `Under spec'ing` | 1 | spec owner (Manager Notes) |
| `Spec'd — pending build on n8n` | 12 | **confirmation, not build capacity** — 0 of 12 pass the readiness gate |
| `Built on n8n — Staging` | **11** | test cases (5 of 11) + a cross-cutting route question (all) |
| `On Jira pending production` | 1 | devs — Travel Assist, `VPMGOV-1633` |

**The two tracks are not equally blocked, and that decides the order.** The deploy track has six
flows that could have a ticket written this week. The build track has *zero* that can start. So the
plan is: ship the deploy track now, and spend the build track's time converting blockers rather than
waiting on them.

---

## Track B — Jira deployment tickets for the staging flows

### B1 · The 11 staging flows, and which can go

The Factory's own rule on `Test cases verified` is *"Five real cases checked in the ERP by a human.
**Flow cannot go live without this.**"* That is the gate.

**Ready to draft a ticket (6):**

| Check | Category | Staging workflow | Sheet |
|---|---|---|---|
| MV Monthly Payment check | MV Client | 5 chained workflows | — |
| Wellcare Advanced Clinic — Medical Loan Check | CC Maid | `7HYpRKJQnH5C7jkj` | ✓ |
| CC Overstay Fines | CC Maid | `3465kkSf4JYjlpXk` | ✓ |
| Dummy Tickets Submitted for Refund — HM | CC Maid | `aTmGMAlYLwsJQ7js` | ✓ |
| Applicant Real Ticket | CC Maid | `YXRZdtk2Geeeqaal` | ✓ |
| MV Overstay Fines | MV Maid | `LDtsstXDfF99TnYe` | ✓ |

**Blocked on test cases (5)** — `Test cases verified = NO`:
CC Monthly Payments Below Agreed Amount · CC Non Received Monthly Payments · CC Client Paying
According to Price by Type/Nationality/Start Date · SDR Payment Check · Terminated Housemaids Tickets

Two data gaps worth fixing while we are in there: **CC Client Paying According to Price** sits at
Staging with **no `n8n Staging Link` at all**, and none of the three CC Client rows has a results
sheet. A flow nobody can open is not really at staging.

### B2 · The template is established by `VPMGOV-1633` — but its formatting is broken

The Travel Assist ticket set the eight sections, and those are good. **Its formatting is not**: it
was submitted in Jira Server wiki markup (`h2.`, `||…||`), which Jira Cloud stores as unparsed plain
text and renders literally. Corrected template and a paste-ready fixed body are in
`audit-flows/jira/`; the rule and the ten-second ADF check are in `audit-flows/jira/README.md`.

**Two access limits block the automated path and need Jira admin:** `description` is not on the edit
screen for issue type `n8n Flow` in `VPMGOV`, and this account cannot create issues in `VPMGOV` at
all. See B2a below.

Its shape:

- **Project** `VPMGOV` (Visa Gov) · **Issue type** `n8n Flow` · **Assignee** Wesam.Tanous
- **Labels** `audit`, `n8n`, `prod-deployment`, `<check-slug>`, `visa_ba_aganda`
- **Summary** `Deploy to prod: <Check Name> (n8n, <trigger shape>)`

Eight required sections:

1. **Business context / goal** — what the money question is, plus an explicit *Expected outcome*
2. **Trigger & schedule** — and, where true, the sentence *"No webhook, no manual trigger, no
   inbound endpoint of any kind"*
3. **Inputs & data sources** — a Method / Endpoint / Purpose table, every endpoint, read-only stated
4. **Outputs & recipients** — sheet, notification mail, failure alert; Travel Assist's mail
   deliberately carries *no counts, amounts, names or case keys*
5. **Expected number of executions per day** — with real measured per-run load (requests, API calls,
   wall clock, concurrency, execution ceiling)
6. **Attachments** — the n8n flow export JSON + the workflow link
7. **Credentials used** — a Credential name / Type / Used-by table, with *"No secrets in this ticket
   or in the export"*
8. **APIs used**

### B2a · Target confirmed, and the one limit that remains

**Project `SD` (Service Desk), issue type `n8n Flow` (11166).** Creatable, `description` on the
create screen, same issue type as the precedent. The deploy track is no longer project-blocked.

The precedent `VPMGOV-1633` lives in `VPMGOV`, where `description` is *not* on the edit screen and
this account cannot create — so that ticket needs a UI paste to fix, but it constrains nothing going
forward.

Required fields on create, both derivable or precedent-set:

| Field | Source |
|---|---|
| `Company Department` (`customfield_10822`) | the check's Notion `Module`, mapped 1:1 |
| `Accountable PIL` (`customfield_10825`) | precedent: Amin Aljebbeh — confirm whether it is constant |

`N8N Link` (`customfield_12033`) is a first-class URL field on this issue type, so the staging link
gets structured storage rather than living only in the description.

### B3 · Most of that ticket can be generated, not written

Sections 3, 5, 6, 7 and 8 are all derivable from the workflow JSON, which the n8n MCP already
returns in full. A `/draft-deploy <check>` command can extract:

- every `httpRequest` node's method + URL → the endpoint table (section 3)
- every node's `credentials` block → the credential table (section 7)
- the trigger node type and cron → section 2
- node count, execution history, concurrency and timeout settings → sections 5 and 6

That leaves sections 1 and 4 as the genuinely human parts — the business framing and the recipient
list. **Per-flow effort drops from ~2 hours to ~20 minutes of review.**

This is step 6 of the pipeline design (`deploy-task-writer` + `/draft-deploy`). It is now the
highest-value thing to build, because it is the only automation on the critical path of work that
can actually move today.

### B4 · The blocker that applies to ALL of them — the route ban

The 2026-08-25 Dead-End Routes ruling bans thirteen paginated ERP routes **from specs and flows**.
Every audit flow held on disk breaks it, and three depend on a Section A route with *no alternative*.

**`VPMGOV-1633` already went to the devs listing a banned route** — `/clientmgmt/contract/search/page`
is endpoint #1 in its Inputs table. So the ban and the deployment tickets currently disagree, and
nobody has noticed because no one has cross-read them.

Known status of the six deploy candidates:

| Flow | Route-ban status |
|---|---|
| MV Monthly Payment | Stage 2 **swapped** to `payments/search` (2026-08-27). Stages 1 and 0 still call the banned `contract/search/page` — deliberately not swapped; it is a rebuild, not a swap |
| Dummy Tickets · Applicant Real Ticket | call `/accounting/transactions/page/advancesearchNew` — **Section A, no alternative** |
| Wellcare · CC Overstay Fines · MV Overstay Fines | **never audited** — unknown |

**This needs a decision before any ticket is written, not after.** Three options:

- **(a) Ship as-is, disclose in the ticket.** Add a *Known route exceptions* section naming each
  banned route, why no alternative exists, and the ERP-team ask. Honest, unblocks now, and makes the
  ERP dependency visible to the people who can fix it. **Recommended.**
- **(b) Hold every ticket until the ERP team provides alternatives.** Correct in principle, but nine
  routes have no alternative at all — this is an indefinite hold on eleven flows.
- **(c) Swap what can be swapped first.** Only helps where a replacement exists and is verifiable;
  today `.env` is absent so no replacement's response shape can be checked against the ERP source.

### B5 · Order of work for Track B

1. Decide (a)/(b)/(c) on the route ban.
2. Audit the three never-audited flows for banned routes (read-only, ~30 min via the n8n MCP).
3. Build `/draft-deploy`.
4. Draft the 6 tickets; review sections 1 and 4 by hand; you post them.
5. On each post: write `Jira Task Link` + move `Status` → `On Jira pending production`.
6. Separately, chase the 5 flows' test cases — that is the only thing between them and the same path.

---

## Track A — develop the 12 specced checks

### A1 · Nothing is buildable today, and that is the plan's central fact

The 2026-08-30 readiness gate: **0 of 12 pass**. Not one is short of build capacity; every one is
short of a confirmed input. Treating this as a build backlog and starting anyway is precisely how a
flow ships that looks tested and quietly clears cases it should flag.

Two session-level blockers sit on top of that, and both are cheap to clear:

- **`.env` is absent** — so `scripts/ask-code.sh` cannot run, and `CLAUDE.md` names the ERP code as
  the *only* source of truth for behaviour. Without it no route replacement or payload shape can be
  verified. This also blocks the Stage 1/0 rebuild in Track B.
- **The ERP token** — one paste per session, Phase 1 of the builder skill. Nothing can mint it.

### A2 · The critical path is unblocking, and it has three owners

**Spec owner — cheapest, highest yield.**

- Promote the two 2026-08-19 owner rulings on **CC Maids Salary Raise** to `Confirmed`
  (`renewal_raise_lifetime_cap`, `ruled_cohort_level`). Both are already ruled by Jacky and logged in
  `decisions.md`; they sit at `Pending Business` only because nobody moved the field. **This one
  change takes the check from 7 variable blockers to 0** and leaves only a named reviewer.
- Name a **Tech Owner on the 9 checks** that require independent review and have none.
- Get five human-verified test cases for the 4 that lack them.

**Data team — the bulk of it.** Unconfirmed variables, worst first:
R-Visa Audit (12 of 20) · CC Client Refunds (13 of 38, and the only two missing `Default Value`s in
the whole 192-row set) · Medical from Visa Expenses (7 of 9) · Entry Visa Audit (7 of 12) ·
GCC Payments Checker (7 of 13) · Terminated HM (5 of 20) · E-ID Audit (5 of 18) ·
Change of Status Audit (5 of 28) · ILOE Checker (1 of 14).

**ERP team — the long pole.** 10 of 12 read at least one variable with no confirmed route.
Two on CC Client Refunds are marked *permanently* unroutable. One access request is already
identified: `getTheRefundAndPaidEndDateFromContract` returns 401 for this role.

### A3 · Build order once unblocked

Sequenced by how close each is to buildable, not by business value — the point is to get the
pipeline's first real end-to-end run through on the easiest case, then widen:

| Wave | Checks | Why here |
|---|---|---|
| **1** | CC Maids Salary Raise | 2 field changes from clean; tests already verified |
| **2** | ILOE Checker · Entry Visa Audit · Medical from Visa Expenses | few unconfirmed vars, tests verified, ≤3 unrouted fields |
| **3** | E-ID Audit · Change of Status Audit · GCC Payments Checker · Terminated HM | need real ERP-team work first (E-ID has 10 unrouted vars and one marked *BLOCKS SCORING*) |
| **4** | R-Visa Audit · Client Refunds | most unconfirmed; Client Refunds has two permanently unroutable fields and needs the spec routed around them |

Wave 1 is also the **pilot for the whole pipeline** — the first check to run
`/build-check → /validate-run → /draft-deploy → /close-build` end to end. Build the machinery on the
easiest case, not the hardest.

---

## Sequencing

```
NOW        ── decide route-ban posture (a/b/c)           ⟵ blocks every Jira ticket
           ── restore .env, supply ERP token             ⟵ blocks every build
           ── promote the 2 CC Maids Salary Raise rulings ⟵ 1 check, 7 blockers, one field each

WEEK 1     Track B: audit 3 unknown flows · build /draft-deploy · draft 6 tickets
           Track A: spec owner names 9 Tech Owners; data-team ask goes out

WEEK 2     Track B: post tickets, write back Status → On Jira pending production
           Track A: Wave 1 build (CC Maids Salary Raise) as the pipeline pilot

WEEK 3+    Track A: Wave 2 as variables clear. Track B: the 5 test-case-blocked flows follow
```

**Track A and Track B do not compete for the same resource.** Track B is your time plus dev time;
Track A is mostly other people's confirmations. Run them in parallel.

---

## Decisions needed

1. **Route ban posture** — (a) ship with disclosure, (b) hold, (c) swap first. Recommend **(a)**.
2. **Does `VPMGOV-1633` need a follow-up comment** noting the banned route it already lists?
3. **Unpublish `aTmGMAlYLwsJQ7js`** (Dummy Tickets)? It is the one `active: true` flow, with a live
   production webhook and a Security Room callback allowlist, under a ruling that nothing delivers to
   the Security Room. See `records/security-room-delivery.md`.
4. ~~**Which Jira project?**~~ **RESOLVED 2026-08-30 — `SD` (Service Desk) → issue type
   `n8n Flow`.** Same issue type as the Travel Assist precedent, creatable by this account, and its
   create screen carries `description`. Field spec and the `Module → Company Department` mapping are
   in `audit-flows/jira/deploy-ticket-template.md`. One value still needs your call:
   **`Accountable PIL`** is required and the precedent used Amin Aljebbeh — same for all of these, or
   per check?
6. **Fix `VPMGOV-1633`'s formatting?** It needs a UI paste (the API cannot write that field). The
   corrected body is ready at `audit-flows/jira/VPMGOV-1633-corrected.md`.
5. **Do the 5 test-case-blocked flows get chased now, or after the 6 ship?**

*Counts and totals only. No per-entity detail, names, contact details, salaries or amounts.*
