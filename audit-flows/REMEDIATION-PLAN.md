# Finishing the audit-flow remediation — an executable plan

**Written 2026-08-23.** Everything below is what remains after the 2026-08-20 → 08-23 sweep.
`erp_compliance.py --all` reports **16 of 16 flows comply, 0 unaudited**, so nothing here is a
policy violation. What remains is: work nobody has run, two deliberately-unshipped behaviour
changes, and gaps the checkers now name rather than hide.

A session picking this up can execute **Track A** end to end without asking anyone. **Track B**
carries decisions — each states a default and what would make that default wrong. **Track C**
cannot start until someone reactivates an ERP account.

---

## 0. Preflight — always, before anything else

Nothing in this repo is trustworthy without this, and two wrong status reports on 2026-08-23 came
from skipping it.

```bash
cd audit-flows
# 1. Refresh every export from n8n. Large flows auto-save to a file: cp that file into exports/.
#    Small ones return inline and must be hand-transcribed - see exports/README.md, and record
#    provenance in MANIFEST.json (export: api | transcribed).
# 2. Then, in order:
python3 tools/erp_compliance.py --all          # policy: expect 16 of 16, 0 unaudited
python3 tools/erp_load_check.py exports/*.json # pacing on live nodes
python3 cc-below-agreed/tools/seam_check.py exports/*.json   # dangling refs + wire mismatches
python3 tools/doc_check.py                     # every path a doc cites actually resolves
python3 tools/regen_breaker_embeds.py --check  # breaker drift
python3 tools/offline/compliance_test.py       # 48
python3 tools/offline/export_mutation_test.py  # 30
node    tools/offline/breaker_test.js          # 51
```

**Read the WARNings, not just the verdict.** Six flows carry a §4 blind-spot warning by design; a
*new* one means something changed.

**Do not trust prose about deployment state.** Five doc claims were stale on 2026-08-23 and one of
them caused a wrong report. The flows and the checkers are the source of truth; docs are maps.

---

## Track A — executable now, no decisions, no ERP

### A1. Re-export the ten hand-transcribed flows *(only when an n8n API route exists)*

`MANIFEST.json` marks ten flows `export: transcribed`. They were copied by hand out of an inline
MCP response because no n8n credential exists in this environment and small workflows are not
auto-saved to a file. A transcribed export can be **wrong**, which a stale one cannot.

**Do this the moment any of these becomes true:** an `N8N_API_KEY` appears in the environment; the
MCP gains a to-file export; or the harness's auto-save threshold drops. Check with
`env | grep -i n8n` and by re-reading `exports/README.md`, *not* by assuming.

**Steps:** re-export each, `cp` into `exports/`, flip its `export` field to `api`, re-run preflight,
confirm the checker's verdict per flow is unchanged. A *changed* verdict means the transcription was
wrong — say so loudly and diff the two.

**Done when:** no flow in `MANIFEST.json` carries `export: transcribed`.

### A2. Give the three bespoke breakers a latency signal

MV Stage 0 `Project Group`, MV Stage 2 `Chunk Summary` and MV Stage 4 `Assemble Evidence` each
classify failures by shape and each carry the same recorded gap: **an ERP answering 200 but dying
slowly trips nothing.** The canonical block in `tools/erp_breaker.js` has a latency detector; these
do not.

**The constraint that makes this non-trivial:** the canonical detector needs a ~200-call baseline.
MV Stage 0's sweep is ~136 pages, Stage 2's chunk is 25 contracts × 2, Stage 4's is 2 per finding —
so the canonical rule would never arm on any of them. Do **not** paste it in; that adds a threshold
that reads as coverage and provides none, which is the exact failure §5 warns about.

**Do instead:** derive a per-flow rule from what each surface actually costs, using the measured
numbers already in the repo (advancesearch ~22–25 s/page; contract search ~5.03 s/page at size 40).
A workable shape: record elapsed per response, compare the last N against the first N of the *same*
batch, trip on a sustained multiple. Write the rule, its N, and its multiple into the node comment
with the measurement it rests on.

**Done when:** each of the three has a latency rule, an offline test that trips it and a mutant that
proves the test bites, and `compliance/mv-monthly-payment.md` outstanding item 3 is struck.

### A3. Close the `scorer.stage2.js` claim

MV Stage 2's `Score Contract Month` and its sticky note both assert the code is byte-identical to
`audit/mv-monthly-payment/scorer.stage2.js`, backed by 140 offline tests. **That path is outside
this repo and nothing here can check it.** It is load-bearing: it is the stated reason the node's
compliance declaration lives in a `notes` rather than in the code.

**Steps:** search the wider filesystem and any sibling repo for `scorer.stage2.js` /
`scorer.js` before concluding anything — `find / -name 'scorer*.js' 2>/dev/null`, not one `test -f`
(see Trap 2). If found: bring it in or record its real path, and add a byte-compare to the suite.
If genuinely absent: strike the "140 offline tests" claim from the node note and the sticky, because
an unverifiable guarantee reads as a verified one.

**Done when:** either a byte-compare runs in CI, or no document claims the scorer is verified.

### A4. Make the MV drafts' status unambiguous

Five MV flows are `active: false` and marked "DRAFT, never publish". They are policy-compliant and
completely unexercised. **Do not publish them** — that is Track C's decision, after a smoke test.

**Steps:** confirm all five are still `active: false` (`get_workflow_details`, check
`activeVersionId: null`). If any has been published, that is a finding: report it, do not quietly
unpublish.

---

## Track B — behaviour changes, each with a default

Both are real improvements that were held back deliberately. An autonomous run **may** ship them
under the stated default; it must record the decision in `docs/decisions.md` and flag it in its
summary. It must **not** ship them silently.

### B1. The canary first chunk — `cc-below-agreed/wf-e/wfa/chunk_candidates.js` → WF-A `Chunk Candidates`

**Default: SHIP IT.**

Repo 10,925 chars vs deployed 9,010 — `+40 / −1` lines, all of it the canary plus its rationale.
Why it matters, in the file's own words: the breaker lives in WF-E's projection nodes and a
projection node does not run until its HTTP node has finished every request, so **the chunk size is
the breaker's blast radius**. At 750 candidates × 2 calls, an already-failing ERP absorbs 1,500 more
calls before anything of ours gets a say. The canary buys the first verdict at ~100 calls.

This is §5 blast-radius control on the flow that makes ~11,264 ERP calls per run, and it is the
single largest remaining reduction in what a bad run costs ERP.

**What would make the default wrong:** if the extra sub-execution per run is unacceptable, or if
someone is mid-run. Neither is likely; both are checkable.

**Steps (the verified-deploy protocol, §Protocol below):** draft → fetch back → `cmp` deployed
`jsCode` against the repo file → publish only on byte-identical → re-export → re-run preflight.

### B2. Fail-closed verdict merge — `cc-below-agreed/wf-b/nodes/merge_agent_verdicts.js` → WF-B `Merge Agent Verdicts`

**Default: DO NOT SHIP. Report and ask.**

Repo 17,923 vs deployed 16,373. The core fix is unambiguous and good: the guard read
`evidenceClass && evidenceClass !== 'JUSTIFIED'`, so an **absent** `evidence_class` made it falsy
and the clearance went through. Measured: omitting the field entirely returned `Agent Justified`.
A clearance is the one outcome that cannot be taken back.

**Why it is not a default-ship:** the repo file itself flags an unresolved consequence —
`'JUSTIFIED'` is not a member of the Verdict Schema's `evidence_class` enum at all (that enum is
`UNDER_BILLED / UNDERPAID / EXPLAINED / AMBIGUOUS / NO QUOTE / UNRESOLVED`, clearing class
`EXPLAINED`). So the cap downgrades **every** schema-valid `Agent Justified` and makes that verdict
unreachable through the model path. Fail-safe — it over-reviews — but it changes what the check
reports, and the file says the question is "deliberately not decided here".

**Steps:** put the enum mismatch to Moe with both options (cap as written and accept
over-review; or align the guard to `EXPLAINED` and keep `Agent Justified` reachable). Ship whichever
he picks by the same verified-deploy protocol. This also unblocks B3.

### B3. WF-B's rail blind spot — `Verify Candidates`

Blocked on B2. WF-B's LLM agent is the node in that flow most likely to fail on any given run and it
is not on the error rail, so a model failure strands the lease for the full 3-hour staleness window.
Left unwired deliberately: an Agent's error output is not known to be at index 1, and guessing is
silent when wrong.

**Two ways to close it, in preference order:**

1. **Verify the index.** If the agent node genuinely exposes an error output at index 1, wire it to
   `Release Lease (error)` exactly like every Code node. Verify empirically — deploy to a draft,
   fetch back, confirm n8n kept the connection at `sourceIndex: 1` — and do not publish on a guess.
2. **`onError: continueRegularOutput`.** A model failure then flows on as an item into
   `Join Verdict Paths` → `Merge Agent Verdicts`, which is the node designed to fail closed. This is
   the same shape already used for the message reads. **It only works once B2 ships**, because
   today's deployed merge does not fail closed on a missing class — routing failures into it would
   turn a model outage into silent clearances, which is strictly worse than a stranded lease.

**Done when:** either the agent is on the rail, or `compliance/` records the measured reason it
cannot be, with the index question settled rather than assumed.

---

## Track C — blocked on ERP access

**Trigger:** an ERP account is reactivated. Both (Hassan's and Abdullaha's) were deactivated after
execution 94355. Until then, nothing in this track can start and no amount of code review substitutes.

**What is unexercised — this is the real state of the programme:** every fix from 2026-08-20 onward
is structurally verified and has never run. That includes the lease wiring into WF-A, all four error
rails, the entire MV re-audit, the Population Guard breaker, and `Build Runs Log`. The rails
especially: by construction they only execute on a path nobody has taken.

### C1. Smoke-test the lease end to end
Acquire → hold → second audit queues → release. `erp-lease/README.md` has the call shapes. Prove the
`no_wait` self-re-invoke survives a real hold (it was proven synthetically over 101 minutes and 94
attempts; it has never run inside an audit).

### C2. Fire a **capped** run of CC Below Agreed
`params.erp_call_budget` set deliberately and a small cohort cap. Follow `RUNBOOK-trigger.md`. Watch
for: `Respond 200` firing first, the lease acquiring before the first sweep, the budget gate logging
its projection, `Build Runs Log`'s footprint self-report, and WF-C releasing at the end.

### C3. Force each error rail at least once
A rail that has never fired is a rail nobody has seen work. Cheapest path: a deliberately bad payload
that trips `Validate Inputs`, then confirm the lease row is free afterwards. Repeat per flow that has
a rail (WF-A, WF-B, WF-C, CC Price 1 and 3, MV 1 and 4).

### C4. MV Monthly Payment: first real slice
Only after C1–C3. Small `limit`, one cohort, `erp_call_budget` set. Then decide on publishing the
five drafts — that is a separate call for Moe, not a consequence of a green slice.

### C5. Re-verify the 2026-08-19 pacing assumptions
The page-cost figures the whole policy rests on (~5.03 s/page contract search, ~22–25 s/page
advancesearch, the 40-row cap) were measured before the outage. Re-measure once, cheaply, and update
§1 if they moved.

---

## Protocol — how to deploy anything here

Proven on `Build Runs Log`, 2026-08-23, on a 453-line body full of regexes.

1. **Generate the escaping, never hand-write it.** `python3 -c "import json;print(json.dumps(open('path').read()))"`. Hand-escaping `\\` inside a JS string inside JSON is the error-prone step; skip it.
2. **Edit → draft.** Editing a live workflow creates a draft; callers keep serving `activeVersionId`. Nothing live moves yet.
3. **Fetch the draft back and `cmp` against the repo file.** Byte-identical or fix and repeat.
4. **Publish.** Then re-fetch and compare again.
5. **Re-export, re-run preflight, update the docs in the same change.**

Clear node **groups** before adding an error rail: n8n requires a group to be single-entry
single-exit and an error output is a second exit. Move each group's description to a node `notes`.

---

## Traps this programme has already paid for

1. **Crying wolf, five times.** A checker that fails a compliant flow stops being read. Every rule
   here warns-with-a-name rather than failing when the flow is right and the tool is merely blind.
2. **`test -f` is not a search.** Three tools were declared non-existent across two sessions; all
   three were in `cc-below-agreed/tools/`. Use `tools/doc_check.py`, or `find`.
3. **A dead `try/catch` looks identical to a healthy one.** `$('X')` naming a node that moved
   workflows throws, the catch swallows it, and the guard is silently gone. `seam_check.py` check 1.
4. **n8n reports a run that falls off an error output as SUCCESS.** Every rail must re-throw.
5. **`batchSize` without `batchInterval` is not pacing** — the default interval is 0.
6. **A prose claim about pacing is not pacing**, and a parameter the flow accepts and never reads is
   worse than none.
7. **The 2400 s ceiling is silent** — status `canceled`, nothing thrown. Never block on a wait.
8. **Docs go stale in one direction: they say "not done" for work that is done.** Point at
   `--all`; do not restate it.

---

## Definition of done

- `erp_compliance.py --all`: 16 of 16, 0 unaudited, and every remaining WARN is one a document
  explains on purpose.
- `MANIFEST.json`: no `export: transcribed`.
- Every flow with a rail has either no blind spot or a recorded, measured reason for each.
- Every error rail has fired at least once, in a real execution, and the lease was free afterwards.
- One capped CC Below Agreed run and one MV slice have completed end to end.
- `tools/doc_check.py` clean, and no document asserts a deployment state that `--all` contradicts.
