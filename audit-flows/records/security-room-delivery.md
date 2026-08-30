# Security Room delivery — what the three staged flows can actually do

**Date:** 2026-08-30 · **Trigger:** operator ruling — *"nothing should deliver to security room now"*
**Method:** full workflow read via the n8n MCP for all three staged flows, plus their execution history.

## The ruling

Nothing delivers to the Security Room as of 2026-08-30. `check_id` (the portal id) is therefore not
assigned by a build, and the Notion rows now say so — see `decisions.md`, 2026-08-30.

## What the flows are actually wired to do

| Flow | Published? | Security Room callback wiring | Outbound callback nodes |
|---|---|---|---|
| **Dummy Tickets** `aTmGMAlYLwsJQ7js` | **YES — `active: true`** | `CALLBACK_ORIGIN_ALLOWLIST` with two portal origins (a Cloudflare Worker proxy + a Supabase functions host), path `^(/functions/v1)?/ta-callback/[0-9a-f]{64}$` | `Callback — Results`, `Callback — Error` |
| **Terminated HM** `sXsn4NUYt4kh3OAU` | no — draft | same allowlist, same path regex | `Callback — Results`, `Callback — Error` |
| **Applicant Real Ticket** `YXRZdtk2Geeeqaal` | no — draft | **none** | none |

Delivery is **caller-driven**: the portal POSTs to the flow's webhook with a `callback_url`, the flow
validates that URL's origin against the allowlist, and posts the results back to it. The flow does
not hold a portal address of its own — which is why "nothing delivers" can be true in practice while
the capability stays open.

## In practice vs in capability

**In practice the ruling holds.** Dummy Tickets has 24 executions total, all `webhook` or `manual`,
and **none since 2026-08-24** — six days before this check. There is no schedule trigger on any of
the three. Nothing is calling them.

**In capability it does not.** Dummy Tickets is the one published flow: its production webhook is
live, and any caller holding a webhook secret can trigger it and have the results POSTed to a
Security Room origin. The ruling is currently enforced by *nobody calling*, not by configuration.

**Recommendation (not applied — needs the operator's word):** `unpublish_workflow` on
`aTmGMAlYLwsJQ7js`. It is reversible, it costs nothing while nothing is calling, and it makes the
ruling true by configuration. Turning off a live production webhook is an outward-facing change, so
it is not made unilaterally. The other two are already drafts and need nothing.

## Separate finding — webhook secrets are hardcoded in Code nodes

All three flows carry **two accepted webhook-secret slots inline in a Code node body** (a live slot
and a rotating slot, so the portal can be switched over without a disagreement window — the design
reason is sound). The storage is not: `CLAUDE.md` rule 2 is *secrets live in `.env` only, never
pasted into prompts, agent files, or docs*, and a Code node body is none of those but is the same
hazard — the value is readable by anyone with workflow read scope, it is captured in every workflow
version snapshot, and it travels with any export.

n8n's own homes for this are a credential or an environment variable referenced at runtime. Moving
them is a build change on all three flows and is **not** in scope here; recorded so it is not
rediscovered a third time.

*No secret values appear in this file, and none were written to chat.*
