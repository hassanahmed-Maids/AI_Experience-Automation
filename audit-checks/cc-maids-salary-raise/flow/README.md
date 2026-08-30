# Deploying this flow to n8n

**Live draft:** `F0YnLEfyFSdOYtIE` — *CC Maids Salary Raise — generated v1*, Adeeb project.
https://sami-team.app.n8n.cloud/workflow/F0YnLEfyFSdOYtIE

`workflow.sdk.js` is the source of truth. It is verified offline before anything is deployed:
ESM syntax, every Code body parsed in a VM, the builder scope checked for the SDK's forbidden
constructs, and the embedded helpers checked for behavioural parity against `../lib/scorer.js`,
which is what the 115-assertion suite in `../test/` actually tests.

## Why the deploy is two pieces

The SDK file is ~136 KB, and transmitting that in one call is the step most likely to corrupt
silently — a single wrong character in a regex changes behaviour without breaking anything
visibly. So it is split, and the result is **proven** rather than trusted:

```
node make-skeleton.mjs      # splits workflow.sdk.js -> skeleton.sdk.js + bodies.json
                            # skeleton = every node, wiring, HTTP config and sticky, with each
                            # Code body replaced by "__PLACEHOLDER__jsCode#N"
```

1. **Piece A** — `create_workflow_from_code` with `skeleton.sdk.js` (~42 KB). Small enough to
   transmit reliably; `validate_workflow` catches SDK-level problems first.
2. **Piece B** — `update_workflow` with `setNodeParameter` operations installing each body from
   `bodies.json`. Paths are `/jsCode`, or `/options/systemMessage` for the agent.
   `body-map.json` maps each placeholder id to its node name (derived by parsing the skeleton
   against a stub SDK — do NOT regex for the nearest `name:`, it latches onto HTTP header names).
3. **Proof** — `get_workflow_details`, then diff every deployed body against `bodies.json`.
   The deploy is only done when that reports **23 of 23 byte-exact**.

## Verified on deploy (2026-08-30)

- 23 of 23 bodies byte-exact against the repo file
- 64 nodes, no placeholders left anywhere, all 22 Code bodies parse
- draft, not active, no schedule or cron trigger
- **no ERP credential stored on any HTTP node, and no token literal anywhere** — the token is a
  runtime payload, so ERP's read log attributes findings to whoever actually ran the check
- agent wired to model + structured parser, and its prompt is actually fed the evidence
- all three merge joins have both branches wired (an unwired branch silently drops items)
- the crash path releases the ERP lease, reading `run_id` from the row builder rather than from
  the Data Table node, whose output is `{id, createdAt, updatedAt}` and carries no `run_id`

## Still required before any real run

Sign-off. This check accuses named people of being overpaid; the spec requires an independent
Police & Control reviewer who did **not** run the check. Never publish, never schedule.
