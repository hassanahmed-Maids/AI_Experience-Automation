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
