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

## STALE-BUT-VERIFIED, 2026-08-23 19:25Z

Three exports here lag the instance. The flows themselves were fixed, deployed and **verified
directly against n8n** - the lag is in this directory, not in the deployment:

| export | id | verified how |
|---|---|---|
| `mv-stage1-population.json` | `IKRXhIco1mwxrcPq` | full payload read back from n8n, rail correct |
| `mv-stage4-verify.json` | `9T91z5VFH5g69WyT` | full payload read back from n8n, rail correct |
| `wfc-deliver.json` | `yEF4BHYDZAnhBnYg` | full payload read back, `activeVersion.sameAsDraft: true` |

`erp_compliance.py --all` therefore still reports the mute-rail failure for these three: it is
reading these files, and these files are old. **Re-export them before trusting that output.**
Written down rather than left as three unexplained reds, which is how a real finding gets ignored
next to a known-stale one.
