# Flow exports for the compliance checker

`tools/erp_compliance.py --all` and `tools/erp_load_check.py` read **deployed** workflow JSON,
because the question they answer is "what is live", not "what is in the repo". n8n is the source
of truth for that, so the exports are refreshed rather than committed as gospel:

```
get_workflow_details(workflowId)   # n8n MCP, one JSON per flow, saved here as <flow>.json
python3 tools/erp_compliance.py --all
python3 tools/offline/export_mutation_test.py     # proves --all would notice if a rule broke
python3 cc-below-agreed/tools/seam_check.py exports/*.json   # $('Node') refs pointing at nothing
```

Either the raw workflow object or the `{"workflow": {...}}` wrapper is accepted.

**A stale export is one way this checker lies.** It will happily pass a flow whose live version
was edited after the export was taken — the same class of mistake as reading a repo file and
assuming it is deployed. Re-export before you rely on a green run.

Exports are not committed: they are large, they contain full node bodies, and a committed copy
would be read as current long after it stopped being. `MANIFEST.json` is the exception — it is the
coverage contract, not an export.

## Two ways an export gets here, and why the difference matters

`MANIFEST.json` records an `export` field per flow:

- **`api`** — the n8n MCP returned the workflow to a file and it was copied verbatim. Only large
  workflows take this path; the harness saves a tool result to disk once it crosses a size
  threshold.
- **`transcribed`** — the MCP returned the workflow **inline** and there is no n8n API credential
  in this environment (checked 2026-08-23: none in the env, none in `.env.example`, and
  `get_workflow_history` returns metadata only, so there is no way to force a file). It was copied
  by hand out of that response.

**A transcribed export can be WRONG, which a stale one cannot.** Three things bound that, and none
of them proves the bytes match:

1. `python3 tools/export_report.py <file>` prints the ~30 lines a verdict turns on — node name,
   type, `onError`, `disabled`, the ERP pacing numbers, the connection edges, which
   `ERP-COMPLIANCE:` tags are present, and each Code body's length and hash. That is short enough
   to diff honestly against the live fetch, which 30 KB of JSON is not.
2. `python3 tools/export_report.py --check-js <file>` runs `node --check` over every Code node
   body. Most transcription damage is not valid JavaScript. The body is wrapped in
   `(async function () { ... })` first, because n8n runs a Code node inside an async frame and
   top-level `await` is legal there — without the wrapper this reported BAD JS on a correctly
   transcribed node (2026-08-23), and a false alarm on the one signal that guards a hand
   transcription is worse than no signal.
3. The §5 breaker byte-compare in `erp_compliance.py` fails on a corrupted breaker block whether
   the corruption came from drift or from a typo.

So an undetected error would have to be valid JS, leave every structural field intact, sit outside
the breaker block, and not touch a compliance tag. **Re-export any `transcribed` flow the moment a
real API route exists**, and treat the field as a standing debt rather than a footnote.

## DRAFT-AHEAD-OF-LIVE, 2026-08-24 — two exports are NOT what is running

`wfa-parent.json` and `wfe-enrich.json` were re-fetched after the WF-A once-per-run grant-probe
change and are therefore the **DRAFT** of each workflow, not the active version. The change was
prepared as a draft deliberately: **no `publish_workflow` was called**, and the operator publishes.

| file | draft `versionId` | still-active `activeVersionId` |
|---|---|---|
| `wfa-parent.json` | `e372043d-f360-4b0e-ab68-e937ea31d3a8` | `efea3a49-29c5-4af0-9be0-816b42ce8da5` |
| `wfe-enrich.json` | `d03f739c-2017-4e45-b301-149ad8ac62fe` | `c0510c1e-a792-469d-8c97-13327278069f` |

This inverts the usual failure this directory warns about. A stale export claims the live flow is
older than it is; these two claim it is **newer** than it is, which is the more dangerous direction
because every checker in this repo goes green on them. **`erp_compliance.py --all` passing on these
two files says the DRAFT complies, and says nothing about what is executing right now.** Re-fetch
both the moment they are published, and delete this section then.

Publish order does not matter and was checked: WF-A published first would send two extra input
fields to the old WF-E, whose trigger declares neither, so n8n drops them and WF-E probes per chunk
exactly as it does today; WF-E published first declares the fields and nothing sends them, so its
gate finds nothing usable and it probes per chunk exactly as it does today. Either single-published
state is the current behaviour, not a broken one.

## STALE-BUT-VERIFIED, 2026-08-23 19:25Z — two of three cleared 2026-08-24

Three exports here lagged the instance. The flows themselves were fixed, deployed and **verified
directly against n8n** - the lag was in this directory, not in the deployment:

| export | id | status |
|---|---|---|
| `mv-stage1-population.json` | `IKRXhIco1mwxrcPq` | **REFRESHED 2026-08-24** during the lease-release-placement work (§4). No longer stale. |
| `mv-stage4-verify.json` | `9T91z5VFH5g69WyT` | **REFRESHED 2026-08-24** during the lease-release-placement work (§4). No longer stale. |
| `wfc-deliver.json` | `yEF4BHYDZAnhBnYg` | still lagging - full payload read back, `activeVersion.sameAsDraft: true` |

`erp_compliance.py --all` therefore still reports the mute-rail failure for `wfc-deliver.json`
only: it is reading that file, and that file is old. **Re-export it before trusting that output.**
Written down rather than left as an unexplained red, which is how a real finding gets ignored
next to a known-stale one.

**How the two MV refreshes were taken, because it is not the `api` path.** `get_workflow_details`
returned both payloads **inline** rather than to a file, so neither could be copied verbatim.
Each on-disk export was instead reconciled field by field against the live payload: per-node
`jsCode` lengths and sha1s compared, the changed nodes replaced, `connections` taken wholesale.
`export_report.py --check-js` is clean on every Code body in both. By the rule above these are
**`transcribed`**, not `api`, and carry that class of risk - re-export them the moment a real API
route exists.

## Capture Failure v3 is deployed to ONE flow only, 2026-08-24

`tools/erp_capture_failure.js` was corrected (v3) after a live measurement showed v2's `<LOGOUT>`
message was wrong half the time. Deployed so far to **`aTmGMAlYLwsJQ7js` only**. The other twelve
flows carrying a `Capture Failure` node still run v2, which asserts "the session is dead, go get a
fresh token" on a marker that also means "this API is not registered under your pagecode" - advice
that loops for ever in the second case.

Regenerate the ops with `python3 tools/make_capture_failure_ops.py <export>` and redeploy. Listed
here rather than left to be discovered, because a wrong diagnostic is worse than none.

### CORRECTION, 2026-08-24 — "the other twelve run v2" IS NOT TRUE

`ZJDiRTzk6uRYBJwq` (CC Price Stage 3) was fetched fresh from n8n today and its deployed
`Capture Failure` is **v1**, not v2. It carries none of v2's machinery: no `statusCode`
extraction, no JSON unwrap, no Whitelabel-HTML `<div>` extraction, no `<LOGOUT>` shape. It is
literally

```js
const message = typeof raw === 'string' ? raw
              : String((raw && raw.message) || item.message || 'unknown error');
```

and **an n8n HTTP error item has no `error.message`** - the text lives in `error.error`. So every
HTTP failure on that rail reports `unknown error`, which is the exact defect v2 existed to fix.

That matters more here than almost anywhere else: this flow's own `Fail Loudly` says DELIVERY
REFUSED is a **designed** outcome, so this rail is not exotic - it fires whenever the Cases table
is short of the population.

**How many others are on v1 is UNKNOWN, and the exports in this directory cannot answer it.** All
ten local exports carrying a `Capture Failure` read v1, including `aTmGMAlYLwsJQ7js`, which
demonstrably has v3 deployed. So those files simply predate the rollout and say nothing about the
instance. The only honest way to establish the real state is to fetch each flow from n8n and
classify the deployed body - not to read this directory and not to trust the paragraph above.

The lesson is the one already written at the top of this file: **a stale export is one way this
checker lies.** It lied about this.

## ANSWERED, 2026-08-24 — the v1/v2/v3 spread, measured on the instance

The section above says "how many others are on v1 is UNKNOWN, and the exports in this directory
cannot answer it". All fifteen flows carrying an error-rail lease release were fetched from n8n
and their deployed rail-head body classified. The answer:

| deployed `Capture Failure` before | flows |
|---|---|
| **v3** (canonical) | `aTmGMAlYLwsJQ7js` — one flow, exactly as claimed |
| **v2** | **none.** v2 was never deployed anywhere. The rollout went v1 → v3 on one flow. |
| **v1**, 2250-byte shared body | `Qq473Ygj543jxPUN` `7j5Z5KPvBcWRPfvy` `bBYbpHcWMWybDQxN` `ZJDiRTzk6uRYBJwq` `LDtsstXDfF99TnYe` `IKRXhIco1mwxrcPq` `9T91z5VFH5g69WyT` `2LaIbHqQ1A2sEBKm` `yEF4BHYDZAnhBnYg` |
| **v1**, 2094-byte variant | `YXRZdtk2Geeeqaal` `sXsn4NUYt4kh3OAU` |
| **v1 + identity recovery** (hand-written, WF-B shape) | `qAuvLHhae2sKD7mM` |
| no `Capture Failure` at all — the rail head is `Build Error Callback` | `uJ8UVNKdN2s5PHHA` `3465kkSf4JYjlpXk` |

So the correction above was right to distrust the paragraph before it, and right again about the
direction: **twelve of thirteen `Capture Failure` nodes were v1**, not v2. The one thing the
correction could not know is that v2 had no deployment at all.

**All thirteen are now v3 + the identity stamp of §4** (`run_id` / `check_id` on the node's own
output item). The two `Build Error Callback` heads were left alone: both already resolved and
stamped `run_id` and `check_id` defensively, and both have downstream consumers — the portal
callback, the failure email, the error Runs row — that a wholesale body swap would put at risk.
`cc-overstay-fines`' `Build Error Callback` does still read only `err.message || err.description`,
so **an HTTP failure on that rail reports `unknown error`** — the v1 defect, surviving in a node
v3 never covered. Worth a follow-up; not folded in here because it is a different node with
different callers.

## DRAFT-AHEAD-OF-LIVE, 2026-08-24 (second batch) — FIFTEEN exports are NOT what is running

Every export below was re-fetched after the §4 error-rail `run_id` work and is the **DRAFT**, not
the active version. **No `publish_workflow` was called** and no workflow was run; the operator
publishes. The same warning as the first batch applies and applies harder at this size: every
checker in this repo goes green on these files, and green here says *the draft complies*, not
*the instance is safe*.

| file | id | draft `versionId` | still-active `activeVersionId` |
|---|---|---|---|
| `ccnonreceived-1-score.json` | `Qq473Ygj543jxPUN` | `0b7ad276-f3c3-45c1-a821-013220e92ccd` | (never published) |
| `ccnonreceived-2-verify.json` | `qAuvLHhae2sKD7mM` | `ff388735-6928-4dfc-a59d-71516b2203f7` | `312737e7-5cfd-45b6-8813-c21424fca8ae` |
| `ccprice-stage1.json` | `7j5Z5KPvBcWRPfvy` | `6f37b855-8ba6-4b88-92a7-291f583a1b38` | `79152f7d-fc5a-4661-91e5-d3f95c4d5afb` |
| `ccprice-stage2.json` | `bBYbpHcWMWybDQxN` | `6d0c875d-b6b6-4f4b-a96b-0446170e6265` | `f5109b1f-333f-492e-bbd6-a0eeafbc034f` |
| `ccprice-stage3.json` | `ZJDiRTzk6uRYBJwq` | `c20dbc91-190a-40d4-bc83-ed06dc52000a` | `609a498b-52ae-4281-b81b-d7a8d322efb8` |
| `dummy-stage1-score.json` | `aTmGMAlYLwsJQ7js` | `63969170-29dc-4dff-9ff7-5fac1f0db824` | `cd9fdad9-5f2c-4596-861c-c32bd389e5f9` |
| `mv-overstay-fines.json` | `LDtsstXDfF99TnYe` | `aca26fcf-ccc0-4192-99ec-da276f7bf039` | (never published) |
| `mv-stage1-population.json` | `IKRXhIco1mwxrcPq` | `16f8182e-7364-46c2-b106-c93edcaac211` | (never published) |
| `mv-stage4-verify.json` | `9T91z5VFH5g69WyT` | `ddaf2c32-6448-4e60-bb34-d90da371ee22` | (never published) |
| `realticket-audit-check.json` | `YXRZdtk2Geeeqaal` | `383b5c38-3b32-444a-896e-081cb4085cdd` | (never published) |
| `terminated-hm-stage1-score.json` | `sXsn4NUYt4kh3OAU` | `53da7bab-1b3b-420b-bb85-f8836e04ca7e` | (never published) |
| `wfa-parent.json` | `uJ8UVNKdN2s5PHHA` | `71e57513-f73f-4329-bf0c-7de74c83f3e8` | `e372043d-f360-4b0e-ab68-e937ea31d3a8` |
| `wfb-verify.json` | `2LaIbHqQ1A2sEBKm` | `8cd68a13-7993-4de1-962f-d9d144f5ab8c` | `748de2a1-639a-47f7-b7b7-fc99bacd2689` |
| `wfc-deliver.json` | `yEF4BHYDZAnhBnYg` | `e35261cd-296f-4b7e-9593-86ce5569b971` | `815f17b8-5adc-4715-b466-2e4947fa969c` |
| `cc-overstay-fines.json` | `3465kkSf4JYjlpXk` | `47dc5518-b7c9-4b7d-bd9b-aa14feb50e13` | (never published) |

`wfa-parent.json`'s active version has moved on since the first batch above (`e372043d` is now the
ACTIVE id, having been the draft id then) — the grant-probe draft was published in between. The
first table is kept as written rather than edited, because it records what was true when it was
written; this row is the current state.

**`wfc-deliver.json` is no longer the stale one.** The row in STALE-BUT-VERIFIED above is
superseded: it now holds the draft. It is **`transcribed`**, not `api` — the MCP returned it
inline (below the size threshold that saves a tool result to a file), so it was rebuilt from the
previous mirror plus the exact ops deployed, then diffed against the live payload.
`export_report.py --check-js` is clean on it and it carries an `_export_note` saying so.

**`activeVersion.nodes` / `.connections` are STRIPPED from these fifteen files.** When a draft is
pending, `get_workflow_details` returns the published version too — a second full copy of every
node body in the same file. Every checker here reads `workflow.nodes` (the draft), so the copy is
dead weight that doubles the file and invites a reader, or a `grep`, into the wrong half.
`activeVersion.sameAsDraft` and `activeVersionId` are kept, and each stripped file says so in
`activeVersion._stripped`. This is a deliberate departure from "copied verbatim"; the alternative
was a directory where half the bytes describe something other than what the filename claims.
