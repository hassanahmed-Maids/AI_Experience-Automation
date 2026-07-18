# Phase 0 — Derive the flow from ERP code (board-less mode)

Use this **only when no Whimsical board link is provided** — an ad-hoc template, or a
journey System 1 hasn't drawn yet. It replaces Phase 1's "read the board" with
"reverse-engineer the flow from the ERP code," then produces the **same build spec** so
Phases 2–3 (build → verify) run unchanged.

> **This is System 1's job, done inline and lighter.** When a board exists, ALWAYS use
> it (`reading-whimsical.md`) — a board is System 1's grounded, adversarially-validated
> output. Board-less derivation has none of that backing, so: the human gate and the
> blind Verifier carry more weight here, and the derived design should be **fed back to
> System 1** to get the full treatment. Mark every board-less record `DERIVED FROM CODE
> (no System-1 board) — higher risk`.

## Hard preconditions

- **ask-the-code MUST be reachable** (`scripts/ask-code.sh`). It is the *only* source of
  truth with no board. If it's down, **STOP** — there is no degraded fallback (do not
  derive a flow from the template name or from memory).
- You need a **scope**: the template name(s)/id(s) to migrate (e.g.
  `/build-cluster <target> <name> --templates A,B,C`). Without a board *and* without
  named templates there is nothing to interrogate — stop and ask.

## Procedure (reuses the code-interrogator method)

1. **Interrogate per template.** For each template ask the code: the exact send site
   (class + line), what triggers it (event / state / job / synchronous hook), the
   **actual recipient** (trace the real send target — recipient ≠ addressee), the
   eligibility conditions, every `@param@` and its source, and the channel. Demand code
   citations in every answer (`docs/code-llm-api.md`).
2. **Branch-completeness sweep.** For every send site, enumerate ALL templates its
   method/switch/if-else can emit. For each excluded/other branch, ask what it sends and
   whether it's in scope. Never accept a "not found / dead" verdict unless the session
   was pinned to the module that plausibly owns the code (module-visibility hazard).
3. **Sibling liveness + scope.** Check Snowflake — is each template actually sent in 2026?
   Honor the export-as-scope rule: build only in-scope templates; mark pulled-in siblings
   `(not in export)` and don't build them. n8n-orchestrated / not-in-code → out of scope
   (manual-review), same as the board path.
4. **Zero-corrections echo-back.** Restate your full understanding (trigger, branches,
   recipients, params, sends) back to ask-the-code and iterate until it returns **zero
   corrections**. This is the gate — do not proceed on a first-pass answer.
5. **Attribute / param map.** For each param and branched condition, resolve DB
   `table.column` + value semantics (ask-code + `mmdb`), and classify the CIO intake:
   synced / sync-add / event / API (persisted-vs-transient gate, per `docs/event-design.md`).
   Cross-check names against the live data-model snapshot (`cio-platform.md`).
6. **Snowflake reality check.** Real recipients, volume ("Sends last 45d"), and the
   `CONTRACT_TYPE`/`RECEIVER_TYPE` mix for target-scoping (a large `Both`/`blank` share
   warns against a blanket `contract.type` filter). Look for duplicate sends (de-dup risk).
7. **Translate to a CIO design** per `docs/customerio-conventions.md` + `judgment.md`:
   trigger preference order, one-campaign-per-journey (split only when CIO forces it),
   translate-don't-mimic (drop ERP execution artifacts), every exit, boundary comparators,
   deletion rule for any new relationship, event-design for any new event. Build each send
   as the ERP-send webhook (`erp-send-webhook.md`).

## Output — same contract as the board path

- The **build-spec.md** template from `reading-whimsical.md` (trigger / flow / exits /
  build requirements / param map / open uncertainties), plus the acceptance-criteria
  table (`tdd-fixtures.md`) — so Phases 2–3 are identical.
- **Draw the board (recommended).** Produce the combined `LEGACY — ERP` + `CIO — DESIGN`
  board per `docs/whimsical-standards.md` (freeform `create(type:'board')`; `edit` is
  available here) in the target's pipeline folder, named per the standard, and record its
  ID. This gives the derived design a reviewable artifact for the human gate, for System 3,
  and to hand back to System 1. If you skip it, say why.
- A **provenance flag** in the record: `DERIVED FROM CODE — no System-1 board; ask-code
  sessions <ids>; recommend feeding back to System 1`.

## Then rejoin the normal pipeline

Present the derived design (ideally the drawn board) at **Gate 1** for human approval —
exactly as the board path does. On approval → Builder → **blind Verifier** (unchanged;
here it's the primary safety net, since there was no System-1 validation upstream) →
Gate 2 (human publishes).
