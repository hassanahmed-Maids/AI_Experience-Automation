# Flow exports for the compliance checker

`tools/erp_compliance.py --all` and `tools/erp_load_check.py` read **deployed** workflow JSON,
because the question they answer is "what is live", not "what is in the repo". n8n is the source
of truth for that, so the exports are refreshed rather than committed as gospel:

```
get_workflow_details(workflowId)   # n8n MCP, one JSON per flow, saved here as <flow>.json
python3 tools/erp_compliance.py --all
```

Either the raw workflow object or the `{"workflow": {...}}` wrapper is accepted.

**A stale export is the one way this checker lies.** It will happily pass a flow whose live
version was edited after the export was taken — which is the same class of mistake as reading a
repo file and assuming it is deployed. Re-export before you rely on a green run.

Exports are not committed: they are large, they contain full node bodies, and a committed copy
would be read as current long after it stopped being.
