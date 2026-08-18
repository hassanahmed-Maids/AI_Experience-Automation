# Handover: build the CC price-by-cohort audit flow in n8n

You're taking over construction of an n8n audit check for maids.cc. Everything
below is established fact from a prior session — read it before touching anything,
because several of these were learned the expensive way.

Accompanying files: `scorer.js` (built and tested — reuse it), `card.json` (the
price card, pinned), `test.js` (the harness), `erp-access-probe-handover.md` (the
access probe, run that first).

---

## 1. What the check asserts

Every active CC client contract should be billed the monthly rate published for
its **cohort** — the maid's nationality bucket × live-in/live-out — as at the
**contract's start date**, not today's rate. Clients on older, cheaper published
prices are legitimately grandfathered. The check finds contracts paying less than
any price the company ever published for their cohort.

A red is **a question, never an established loss.** Every unexplained contract
routes to a human verifier. Nothing is auto-reported as a loss, and findings can
reach PIL against named clients — which is why false clearances matter more than
false flags here.

## 2. Source of truth — read these

The Notion pages are authoritative. Where this doc and Notion disagree, Notion wins.

- **Check page** (spec v1.3, cohort definitions, test cases, volume model):
  `https://app.notion.com/p/3bcfe1c78bf081a3b1bdebc10200d7bb`
- **Audit Conditional Policy — CC Client** (the 17 rules; click each for its
  Condition + Policy body): `https://app.notion.com/p/8360c6f0aabb4e35b93e54ef941a6c4e`
- **Skeleton Contract** (the rails every check inherits): `https://app.notion.com/p/3b8fe1c78bf081659b43fe5430db8a91`
- **Audit Flow Factory build prompt** (the procedure you must follow): `https://app.notion.com/p/3b8fe1c78bf081ed81f4ec50d2b933e6`
- **ERP Variables Database** — 22 rows tagged to this check, each with the exact
  route, pagecode, verified example values and traps. Filter the DB by Check.

`check_id` is `manual-cc-price-by-cohort` (smoke runs: `SMOKE-manual-cc-price-by-cohort`).
Already written to the Notion row.

## 3. Decisions already made — do not relitigate

Made by Hassan (owner), recorded:

- **Execution shape: clone the proven 3-stage chain** from CC Non Received Monthly
  Payments — `Qq473Ygj543jxPUN` (Stage 1 score) → `qAuvLHhae2sKD7mM` → `XN5DaOAfveAqtDMC`.
  Reason: ~5,000 per-contract enrichments blow past the 100 MB retained-data kill
  line in a single execution.
- **Delivery: n8n Data Tables**, not the Security Room portal. Follow the sibling's
  naming: `CC Price by Cohort — Cases / Runs / Verdicts`, in the **Adeeb** project
  (`gxKXV4pckO4b4pQM`). The sibling's `cases` table already carries `first_seen`
  and `times_reported` — mirror those; carry-forward reads the previous run's rows
  from our own `cases` table.
- **The two undefined rate tests** (`upgrading_nationality`, `pro_rated`) stay
  **unimplemented and scored NOT PASSED.** No definition exists anywhere in the
  spec. This inflates the verifier pile by ~30 cases. That must be *declared in the
  run summary*, not silently absorbed.
- **Population guard: warn-only** was requested, but is an open question — see §9.
  Build the band version; it's trivially switchable.
- **Yardstick: the contract's stored agreed monthly rate**, not actual payments
  collected. Collection is a separate sibling check.

## 4. Already built — reuse, don't rebuild

**`scorer.js`** — the full deterministic gate chain, tested offline against all
seven rows of the spec's test-case table plus four extra guards. It independently
reproduces the spec's own verified gap figures (525, 4137, 1585.50) and clears the
grandfathered case for the documented reason. Port it into the Stage 1 Code node
essentially as-is. Run `node test.js` and confirm 10/10 before you change anything.

Two bugs its harness caught, already fixed — preserve both:

- **`needs_human` is one-way.** A passing rate test must never clear a contract a
  gate already routed. A living-switch contract read its price-at-start off a
  possibly-wrong cohort history, so "it matches *some* published price" was
  laundering a false clearance.
- **`unpriceable_at_start` is flagged explicitly.** The live-out card starts
  2024-07-15; ~21 live-out contracts predate it, so their price-at-start is NULL.
  A NULL was failing the test indistinguishably from a real mismatch.

**`card.json`** — the parsed price card, 49 windows across 5 cohorts. Pinned so
scoring can be tested without hitting Sheets. Do not hand-edit prices.

**Workflows in Adeeb (both throwaway, delete when done):**
- `psroZBP7aFtiwnzz` — access preflight, takes auth as a runtime webhook payload
- `1kX3isU27HfmPMU0` — price card reader + checksum, working

## 5. The price card

Google Sheet `1F0cKdaxm9Ct701N5dMpyUQW1-KiiiN8eZgb725GXolE`, tab `Sheet1`
(gid `826582475`), read with credential **`Malaz`** (`cNk10BYICAh91OZX`,
`googleSheetsOAuth2Api`) — already in the Adeeb project, no sharing needed.

**Checksum is a hard stop: exactly 49 windows across exactly 5 cohorts.** If the
file changes shape, the run stops rather than auditing against a partial card.

Card traps:

- **Compare on column F** ("Minimum monthly payment + VAT"). Column E is ex-VAT;
  comparing on it drops old-price agreement to 98.72%. Both sides of every
  comparison are VAT-inclusive — never gross up.
- **Parse by header name, not column position.** The live-out Filipina 2025-09-15
  row has extra unlabelled cells appended past column F, which shifts positional parsing.
- **Dates arrive as `M/D/YYYY` strings.** Never string-compare them — `1/6/2025`
  sorts before `9/24/2024`. `scorer.js` has the parser.
- **Each cohort's final window is open-ended.** Its end date is a live `=TODAY()`
  that recalculates every run. A date after the last end is *still in the last
  window*, never unpriced.
- **Live-out has no Ethiopian cohort.** A live-out Ethiopian maid prices as Other.
  That's why there are 5 cohorts, not 6.

## 6. ERP access — five surfaces confirmed, five were blocked

Run `erp-access-probe-handover.md` first; permissions have reportedly changed.

Confirmed working on the owner's token (2026-08-17):
`contract/search/page` @ `ClientList` · `get-client-details?type=CONTRACT_DETAILS`
@ `ClientSummary` · `contract/liveinoutlogs/{id}` @ `ClientSummary` ·
`complaint/page/client/{id}` @ `ClientComplaints` ·
`teamComplaintUpdate/historyOfComplaint/{id}` @ `ClientComplaints`

Blocked: the **dynamic-API population pull** (`SecurityException` — execute rights
on the evaluator, not a screen permission), `getActiveCptInfo` under two different
pagecodes, `complaint/{id}`, and `clientEnchanterTodoNote/byClient`.

**The population pull is the only true blocker** — no cohort, no run. If it's still
refused, fall back to `contract/search/page` (confirmed working) but note it does
*not* carry `maidNationality` / `maidLiveOut` / `startDate` inline, so the cohort
key then needs per-contract enrichment and the call budget rises sharply.

**ERP has three distinct denial shapes and only one is a 401.** See the probe
handover for the table. Build the auth gate to classify all three — the spec's
"treat any 401 as wrong pagecode or expired token" is too narrow, and two of three
are 500s that would otherwise route to the error rail as server faults.

Auth model: the flow **holds no ERP credential of its own**. It takes the
triggering user's bearer per run from the payload. No token in any Code node or
header literal. Send `authTokenProduction` + `deviceIdProduction`, not `isERPAuth`.
Never run on another employee's token — findings would be logged under their id.

## 7. Call volume — the check page understates this by ~20×

The page says "~50 calls, inside the 500-per-run budget." That counts only the
population sweep. The actual side needs `get-client-details` **per contract**
(~5,000) and `liveinoutlogs` per contract for the living-switch gate (~5,000).
Real total ≈ 10,400 calls, ~2–3 hours at the house pacing law (5 concurrent,
500 ms between batches).

You cannot cheaply avoid the liveinout sweep: fetching logs only for contracts
that already failed would let a switched contract priced off the wrong cohort pass
silently, which is the exact false clearance the gate exists to prevent.

Correct the page's volume line as part of the handover.

## 8. n8n MCP traps — all confirmed this session

- **`update_workflow`'s `appliedOperations` count does not mean the write landed.**
  Always read back and verify.
- **Credentials cannot be wired via `create_workflow_from_code` or
  `setNodeCredential`** on this instance. Both silently declined, twice.
  **`addNode` with a `credentials` object is the only path that worked.** Assert
  credentials live inside the run — don't trust the build.
- **`execute_workflow` always fires the *first* trigger** and can't be pointed at a
  specific one. A webhook trigger must be the *only* trigger for payload input to work.
- The SDK **rejects native array methods at build level** (`.concat`, `.map` outside
  Code nodes). Inline literals instead.
- This instance uses a **LiteLLM gateway** — model ids need provider prefixes
  (e.g. `anthropic/claude-sonnet-5`).

## 9. Open questions — build defaults, don't block

Sent to the check owner; unanswered as of handover.

1. **Population completeness (the one that matters).** The population route returns
   no total, so completeness rests on the empty-page terminator alone — a short pull
   produces a smaller, cleaner-looking report indistinguishable from a clean month.
   Owner asked for warn-only; the Skeleton Contract mandates an abort floor.
   **Build:** hard abort below 4,600, warn band 4,600–4,900 writing
   `population_complete=false` to the `runs` row, abort on >1% divergence from an
   independent `contract/search/page` count. Flag warn-only as a *named skeleton
   deviation* if the owner insists.
2. **The ~21 pre-2024-07-15 live-out contracts.** The test-case table says "pending
   — unpriceable"; the rate-test rule says score NOT PASSED and rest on the other
   two (→ red, verifier). Both are written down. **Build:** pending/unpriceable, the
   more conservative reading. Both route to a human regardless; only the label and
   finding count differ.
3. **Verifier verdict vocabulary** — not yet defined by the business. Needed for
   the review queue to be consistent. Build the verifier; leave the vocabulary
   configurable.

## 10. Output hygiene — enforce this

Per-contract amounts, cohort keys and gaps belong in the `cases` Data Table — that
table *is* "behind the case". Run summaries, chat output and anything a human sees
in passing carry **counts, flags and totals only**. Maid names never land anywhere.
Never print client financial data into a chat or a log line.

## 11. Before you call it done

The Factory build prompt requires all of these:

- `node test.js` passes 10/10 offline against every test-case row
- a **field-level diff**: every node changed versus the golden, and every field
  changed inside the cohort request — before, after, and the row count each produced
- a **live population proof**: the cohort count, the independent count, and the
  delta explained (there's a known unexplained 2-contract drop between 5,005 and
  5,003 — the first real run should identify *which* two)
- the price card checksum asserted at 49/5 in a live run
- delivered as a **draft**, named `CC Client Paying According to Price by Type /
  Nationality / Start Date — generated v1`, never published
- the unimplemented-tests declaration in the run summary
- corrections filed: the check page's volume line, and the ERP Variables row
  claiming a working `getActiveCptInfo` (it was almost certainly verified on a
  different user's token — that's how the wrong record got in)
- maker/checker sign-off from Abdullah Mahdi before the first real run. The owner
  has not read the spec; do not treat build completion as approval.

Do not publish, do not schedule, do not run on production data beyond the proofs
above without sign-off.
