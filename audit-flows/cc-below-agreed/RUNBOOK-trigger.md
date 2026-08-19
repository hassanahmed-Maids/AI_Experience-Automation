# Triggering a run by webhook (the operator runs it under their OWN token)

Written 2026-08-19. Use this when the person who should own the run is not the person editing
the flow — the token travels in the request body, so ERP attributes all ~11,000 reads to
whoever sends it, which is the point.

## What Validate Inputs requires

Read from the node itself (`Validate Inputs`, WF-A `uJ8UVNKdN2s5PHHA`):

| field | rule |
|---|---|
| header `X-SR-Webhook-Secret` | must equal the `EXPECTED_WEBHOOK_SECRET` constant (line 97 of the node). Copy it from there — it is deliberately not written down here. The node's own comment is worth reading: it travels in plaintext, lands in every execution's data, and keeps strangers out, not colleagues. |
| `check_id`, `run_id` | any non-empty strings; `run_id` keys the run |
| `callback_url` | origin must be one of the two in `CALLBACK_ORIGIN_ALLOWLIST` (lines 102-105) and the path must match `/ta-callback/<64 hex>` — or `/functions/v1/ta-callback/<64 hex>` |
| `audit_window` | `{"kind":"month","year":2026,"month":7}` — or `{"kind":"date_range","from":"...","to":"..."}` |
| `params.erp_auth.bearer` | `"Bearer <jwt>"`, shape-checked for CR/LF (header-injection guard) |

Optional: `params.previous_cases` (array, default []), `params.enrich_chunk_size`
(default 750, clamped to 1,200), `params.population_floor` (may be raised, never lowered).

**On `callback_url`:** all three callback nodes — `Callback — Runs Log`,
`Callback — Results`, `Callback: Agent Review` — are **disabled**, so nothing is POSTed
anywhere and the results land only in the Google Sheets tabs. The field is still validated,
so a shape-valid placeholder passes. Use the portal's real callback URL if this ever runs with
the callbacks enabled.

## The command

The token is a shell variable ON PURPOSE. Whoever runs this pastes their own token into their
own terminal — it does not need to pass through anyone else's chat log or this repo.

```bash
# 1. paste YOUR OWN ERP token (the Authorization header value from any logged-in
#    erp.maids.cc request, including the "Bearer " prefix)
read -rs ERP_BEARER          # then paste, press Enter — keeps it out of shell history
# 2. paste the webhook secret from Validate Inputs line 97
read -rs SR_SECRET

curl -sS -X POST 'https://sami-team.app.n8n.cloud/webhook/cc-below-agreed-amount' \
  -H 'content-type: application/json' \
  -H "X-SR-Webhook-Secret: $SR_SECRET" \
  -d "$(cat <<JSON
{
  "check_id": "cc-monthly-payments-below-agreed-amount",
  "run_id": "manual-$(date -u +%Y%m%dT%H%M%SZ)",
  "callback_url": "https://security-room-n8n-callback-proxy.hassan-ahmed-e4c.workers.dev/ta-callback/f72a8f7a6fd5e8eb83a0bf98f682e783e25f070cba3503d0faf27863ff9587fc",
  "audit_window": { "kind": "month", "year": 2026, "month": 7 },
  "params": {
    "erp_auth": { "bearer": "$ERP_BEARER" },
    "previous_cases": []
  }
}
JSON
)"
```

It answers immediately (the webhook uses a response node): `200` with the accepted run, or
`400` with the reason. The audit then runs asynchronously for **~45 minutes** — roughly 14
for the population walk, 8 for the sweeps, 24 for the enrichment.

## The one thing this needs that a draft does not have

The production path `/webhook/...` only exists while the workflow is **active**. WF-A is a
draft on purpose and is not activated as part of this runbook — that is a human decision,
and while active the webhook is reachable by anyone holding the URL and that plaintext
secret. Two ways round it:

- **Test mode, no activation:** click *Test workflow* in the editor, then send the request to
  `https://sami-team.app.n8n.cloud/webhook-test/cc-below-agreed-amount` within the listening
  window. Same payload, same validation, runs in manual mode.
- **Activate**, send to `/webhook/...`, and deactivate afterwards.

## Token expiry bounds when you may start

ERP tokens all die at **22:00 UTC / 02:00 Dubai**, whatever time they were issued (see
`docs/code-llm-api.md`). A ~45-minute run started after ~21:15 UTC loses its bearer
mid-flight and every remaining ERP call 401s. Don't start one in that last hour.

---

## Rotating the webhook shared secret into a credential

**Status: not closable by me.** The n8n MCP can neither create a credential nor attach one
to a node — verified against the whole tool surface 2026-08-19. Two `httpHeaderAuth`
credentials already exist in Hassan's personal project (`Header Auth account 2` and
`account 5`), but their values are redacted by the API, so binding one blind would either
reject every real call from the portal or "harden" the trigger with a value nobody has
checked. Both are worse than leaving it. So the credential is a UI action.

What *is* done: `Validate Inputs` now accepts a **set** of named secret slots instead of one
literal, and logs which slot matched (never the value). That removes the trap — with a single
literal there was no ordering that avoided an outage, because changing the portal first makes
the flow reject everything and changing the flow first makes the portal's old value reject.

### The sequence

1. **Add the new secret alongside the old.** In `nodes/Validate_Inputs.js`, uncomment the
   `rotating` slot and put a fresh random value in it (32+ chars). Deploy and **publish** —
   both secrets are now accepted, and nothing has broken.
2. **Create the credential.** n8n → Credentials → new **Header Auth**, name it
   `SR Webhook - CC Below Agreed`, header name `X-SR-Webhook-Secret`, value = the new secret
   from step 1.
3. **Bind it to the Webhook node.** WF-A (`uJ8UVNKdN2s5PHHA`) → the `Webhook` node →
   Authentication → **Header Auth** → the credential from step 2. Publish. n8n now rejects
   unauthenticated callers before the workflow runs; the in-flow check stays as a second
   layer.
4. **Switch the portal.** Update `SR_WEBHOOK_SECRET` to the new value.
5. **Verify on live traffic, do not assume.** Trigger a run and read the `validate_inputs`
   log line: `secret_slot_matched` must read `rotating`. If it still reads `live`, the portal
   change has not taken effect and step 6 would break the trigger.
6. **Remove the `live` slot** from the array and publish. The old secret is now dead.

Do **not** compress steps 1 and 6 into one change — that is exactly the outage the set
exists to prevent.

### What this does and does not buy

It stops the secret being readable by anyone with project access, and it moves rejection to
n8n's edge. It does **not** make the secret confidential against an insider on the portal
side, and it is not a substitute for the `callback_url` allowlist — that allowlist, not the
secret, is what stops an authenticated caller having the audit couriered to their own host.
