# Graph fixtures

Flow graphs transcribed from live n8n workflows for checking a flow against
`ERP-LOAD-POLICY.md` when the full export is impractical to capture. They carry **every field
`erp_compliance.py` reads** for the sections they claim to cover — node names, types, `onError`,
connections, the ERP nodes' `batching`/`timeout`, lease-node parameters, and enough of each Code
node's body (or its `notes`) to carry the `ERP-COMPLIANCE:` declarations and any `throw` — and
nothing else.

They live here rather than in `exports/` on purpose: a partial file in `exports/` would be picked
up by `--all` and report a clean §1/§2/§5 for sections it does not actually contain the data to
check. A fixture that looks like an export is the silent blind spot this whole tool exists to
avoid.

## What a fixture proves, and what it does not

It proves the **checker's verdict on the flow as described**. That is worth having: it caught a
real §3 gap in MV Stage 4 — a per-item ERP surface behind an entry point nobody had costed — that
three careful read-throughs of the same workflow had missed.

It does **not** prove the deployment matches, because the transcription is by hand. Only a real
export does that, which is why `exports/MANIFEST.json` still lists these flows as
`audited_by_hand` with the export outstanding, rather than as covered.

## Keeping them honest

`tools/offline/fixture_mutation_test.py` breaks each property the fixture claims to test, one at a
time, and requires the checker to notice. A fixture that passes because the relevant field is
simply absent is worse than no fixture, and this is what stops that.

```
python3 tools/offline/fixture_mutation_test.py
```

## Current fixtures

| fixture | flow | why no export |
|---|---|---|
| `ccprice-stage3-graph.json` | CC Price by Cohort · Stage 3 | §4 only — no ERP nodes, so §4 is its whole audit |
| `mv-stage0-graph.json` | MV Monthly Payment · 0-Sweep Population | draft, export pending |
| `mv-stage1-graph.json` | MV Monthly Payment · 1-Population | draft, export pending |
| `mv-stage2-graph.json` | MV Monthly Payment · 2-Score chunk | draft, export pending |
| `mv-stage4-graph.json` | MV Monthly Payment · 4-Verify findings | draft, export pending |

MV Stage 3 (`3-Deliver`) has no fixture: it holds no ERP node, no lease call and no sub-workflow
call, so every section of the policy is vacuous for it. Nothing to fix and nothing to check.
