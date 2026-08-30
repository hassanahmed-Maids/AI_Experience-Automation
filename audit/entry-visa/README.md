# Entry Visa Audit — build status

Building the check described in **Notion "Entry Visa Audit" v0.7** as an n8n flow, via the
`erp-audit-flow-builder` process.

**Status: blocked at Phase 2 on two things a human must grant.** Everything that does not
depend on them is done.

---

## Where the build actually is

| Phase | State |
|---|---|
| 1 · working ERP token | **BLOCKED** — see below |
| 2 · probe every API | **BLOCKED** — probe is written and validated, cannot be created or run |
| 3 · document payloads | partial — corrections that need no ERP are filed; response shapes need the probe |
| 4 · resolve business logic | **done** — no questions for the owner (see below) |
| 5 · plan and build | scorer **done** and green; n8n flow blocked |
| 6 · test end to end | offline layer **done** (23/23, 82 assertions); live layers blocked |
| 7 · validate results | blocked on 6 |

---

## The two blockers

### 1. n8n workflow creation is refused by the permission classifier

`mcp__Sami_s_n8n__create_workflow_from_code` was denied by the Claude Code auto-mode
classifier. Nothing can be built or probed in n8n until that is allowed — this blocks
Phase 2 as much as Phase 5, because probing ERP *is* running a flow: the token lives in
n8n, and this session has no direct ERP network path.

The probe workflow is written and **passes `validate_workflow`**. It is ready to create the
moment the permission exists.

### 2. The ERP token

Per the process, the token must belong to **the operator running this** — not a borrowed
one. ERP logs every read under the token's identity, and this check's output accuses named
clients of unrecovered money, so attribution has to be intact.

Two values are needed, plus one this build discovered is also required. The golden sibling
flow (`YQlNlxrnhbQpBbdl`) shows ERP wants **three** parts, not the two the skill names:

```
authorization: <bearer token>
pagecode:      <per-call, supplied by the flow>
cookie:        deviceIdProduction=<device id>; authTokenProduction=<auth token>
```

So: **bearer token**, **numeric device id**, and **`authTokenProduction`**. Session-lifetime
only. Not a cookie blob — three named values, so no analytics cookies or unrelated secrets
come along.

The token is taken as a **runtime payload** and never written into a stored credential,
matching the golden. The delivered flow will hold no ERP credential of its own.

*Tried first, per the process:* the existing stored credential `ERP Hassan Prod`
(`egREvHnZfspVnrza`, `httpCustomAuth`, Adeeb project) — the probe is wired to it, so if it
is still alive no paste is needed at all. That test is itself blocked by blocker 1.

---

## What is done and green

### `scorer.js` — the deterministic logic

All 15 deterministic gates, in `Order`, at the **two case grains** rule 3 requires. Pure —
no I/O, no ERP, no clock of its own — so it is the fixed reference the n8n flow gets checked
against. If a later refactor changes these numbers, the refactor is wrong.

### `test-cases.js` — 23 cases, 82 assertions, all passing

```
node audit/entry-visa/test-cases.js
```

All seven of the spec's ERP-verified test cases, plus sixteen guards, one for each edge the
rules explicitly name — cancel-side refunds, the medical-refund collision, positive-signed
refunds, booking skew, the gate-13 double-count bug, the false-negative rejection history,
purpose/amount-band disagreement, unreadable `stopped`, the 322-day rejection.

The strongest single signal: **test case 7 independently reproduces AED 283.00**, which is
Khalil SOP §5.2's "≈283 lost", from the gate-14 valuation logic rather than from the
spec's arithmetic.

> **These fixtures are spec-derived, not a live ERP read.** They prove the scorer agrees
> with the spec. They cannot prove the spec agrees with ERP — that is Phase 2's job.

---

## Phase 4 — no questions for the owner

Applying the four tests, nothing qualifies. Saying so explicitly, because a list of
questions the spec already answers trains the owner to ignore the one that matters.

- **Gate 7's minimum-elapsed guard** — the spec already resolved it: implement as-is, log
  the defect. Done, and the count is declared in every run summary.
- **Ruling 2 (refundable portion vs whole fee, AED 105,758.50 vs 164,299.19)** — genuinely
  open, but already routed to Malaz, and both figures are computable from the same cases.
  Reported side by side rather than asked about.
- **Ruling 7 (warehouse vs ERP population)** — already routed to Jacky then Malaz. Built the
  way the spec says it works *today* (warehouse-fed), declared as an architectural
  dependency in `SPEC-CORRECTIONS.md` §2 rather than re-asked.
- **Ruling 4 (office staff)** — conservative default: include them and **tag** them, so a
  later exclusion is a filter and not a re-run.

The genuinely undecidable items are all already on the spec's own "Still open" list with
named owners. Re-asking them here would just be noise.

---

## Files

| File | What it is |
|---|---|
| `scorer.js` | the 15 gates, two grains, pure |
| `test-cases.js` | 23 offline cases, run with `node` |
| `SPEC-CORRECTIONS.md` | 7 corrections filed against the spec, with evidence |

---

## Next, in order, once unblocked

1. Create and run the probe (14 read-only surfaces, 1 in flight / 2000 ms).
2. Answer the `transactionId` question — it decides whether the refund family is
   ERP-clocked or warehouse-clocked. See `SPEC-CORRECTIONS.md` §3.
3. Write the response shapes back into the 12 ERP Variables rows, correcting the two that
   are `Unverified` and fail in opposite directions.
4. Clone the golden rails (lease, budget gate, circuit breaker, slim projections, runs log)
   and port `scorer.js` in as the scoring node.
5. Live-small, then live-full, then the Phase 7 evidence pack.

**Not done without sign-off:** no real run against production, no publish, no schedule. The
flow is a draft and stays one. Findings from this check reach real clients and real money,
and the spec names Malaz plus the Visa/Policing owner as the second reader.
