# Security status — n8n estate

Written 2026-08-25 (overnight). Covers the sami-team security audit tickets (SA-*, due
**Thursday 27 August**) and the findings raised separately in-session.

**How to read this.** Everything under "Done" is deployed and verified — you do not need to
redo it. Everything under "Yours" needs a UI click, a portal change, an external rotation, or
a decision that is not mine to make. Everything under "Drafted, not published" is written and
tested but deliberately not live, with the reason given each time.

The single rule I worked to overnight: **nothing that could break a live flow while you are
asleep gets published.** Where a fix was safe and reversible I applied it; where publishing it
would change how a production endpoint answers, it sits as a draft with a note on what breaks.

---

## 1. Done — deployed, no action needed

### 1.1 The ERP bearer is no longer written to execution data (22 flows)

Every retained execution stored the ERP bearer in plaintext, readable by anyone with
execution-list access in this n8n project. The first pass at this covered four parent flows —
which was not a fix, because **every sub-workflow receives the same token in its baton and was
still writing it to disk**. All 22 bearer-carrying flows now carry:

```
saveDataSuccessExecution: none
saveDataErrorExecution:   all
saveManualExecutions:     false
```

No republish was needed: `setWorkflowSettings` writes the workflow record, not the version
snapshot (WF-A's `versionId` was unchanged by the write, and `get_workflow_version` returns
only nodes/connections/groups). Republishing would have pushed unrelated pending drafts live
as a side effect, which is why I did not.

**Two limits, stated plainly:**

- It is **forward-only**. Runs already stored keep their data. Every ERP token in them has now
  expired (the daily expiry is 22:00 UTC), so this is hygiene rather than an incident — but see
  §2.1.
- `saveDataErrorExecution` stays `all` on purpose, so a **failed** run still retains the token.
  Losing error data would have cost you the diagnostics this estate is currently living on.
  Flip it to `none` on any flow where that trade is wrong.

To temporarily restore success data for debugging, one call per flow:
`setWorkflowSettings { saveDataSuccessExecution: "all" }`.

### 1.2 Webhook shared-secret rotation — step 1 complete, and step 4 is unblocked

The secret is **shared by five flows**, not one (six as of tonight — see §3.4). Rotating it in a single flow and then
switching the portal would have taken the others offline with a deliberately silenced
`unauthorized` — the quietest failure this codebase produces.

All five now accept a **two-slot set** (`live` = the old value, `rotating` = a new 256-bit
value) instead of a single literal, so there is no ordering in which the audit stops running.
The two live ones are **published**:

| Flow | Workflow | State |
|---|---|---|
| CC Below Agreed | `uJ8UVNKdN2s5PHHA` | published `084f8783` — in force |
| Dummy Tickets 1-Score | `aTmGMAlYLwsJQ7js` | published `da348166` — in force |
| CC Non Received | `Qq473Ygj543jxPUN` | draft (flow unpublished) |
| Terminated HM 1-Score | `sXsn4NUYt4kh3OAU` | draft (flow unpublished) |
| MV Overstay Fines | `LDtsstXDfF99TnYe` | draft (flow unpublished) |

Verified by executing the **deployed** `safeEqual`, array and match loop — extracted from the
live body, not re-implemented — against nine cases: both secrets match their own slot; wrong
value, empty string, missing header, a 20-character prefix, both values with a trailing space,
and the old value lowercased are all rejected; the value appears in no log line. Script:
`$SCRATCHPAD/rotation/verify_atmg.mjs`.

**The old value is four characters.** No constant-time compare rescues that — it is guessable
by hand. The security is bought at **step 6**, when the `live` slot is deleted. Until then the
four-character value still opens every one of these webhooks.

Full sequence, corrected for the five-flow scope: `cc-below-agreed/RUNBOOK-trigger.md`.

### 1.3 Unauthenticated webhooks — five closed

Five webhooks accepted POSTs with no credential and no secret check. Investigation first
established **who actually calls them**, and the answer changed the risk: the Security Room
portal has never called any of them. The only one ever POSTed to is CC Price Stage 1, and both
webhook executions were `curl/8.5.0` and `curl/8.7.1` with an operator-shaped body — hand-run,
by you.

All five now carry the same two-slot check. **CC Price Stage 1 is published** (`cf1b1677`); it
was the only active one, so it was the only one where the fix was otherwise inert. The other
four are unpublished flows — their webhook URLs are not registered while they are drafts, so
the exposure there is latent, and publishing them would activate audits kept as drafts on
purpose (two are described as "DRAFT — never publish").

Two design points worth keeping:

- The check is gated on **`headers`**, not on the request body. The first version gated on
  `raw.body`, which a caller defeats by POSTing a literal `null` body — the check would skip
  itself on exactly the request it exists to stop. That counterfactual is in the test matrix.
- The rejection is **loud, not `_silent`**. The sibling flows suppress the alert email because
  an anonymous caller can trigger it at will. Here the opposite risk dominates: these endpoints
  have never required a header, so the most likely first rejection is a legitimate caller that
  has just been broken, and that must be visible.

55 of 55 simulation cases pass across the five flows.

### 1.4 Two hardcoded ERP credentials found and cleared

A sweep of **all 27 workflows** — every `jsCode`, HTTP node parameter, Set value and sticky
note — found one live credential beyond the one cleared on 2026-08-23:

| Where | Whose | Status |
|---|---|---|
| `7HYpRKJQnH5C7jkj` Wellcare → `Manual Run Config` → `ERP_BEARER` | **Malaz.a** | expired 22:00Z 2026-08-25; live most of that day. Cleared. |
| `uJ8UVNKdN2s5PHHA` WF-A → `Manual Run Config` (2026-08-23) | **Abdullaha** | already cleared |

Nothing else. Every other bearer and cookie in the estate is an `={{ }}` expression reading
from a baton or sub-workflow input, never a literal. The repo is clean — the only JWT-shaped
strings tracked are offline test fixtures with absent or fake signatures.

### 1.5 SA-124 — the diagnostic probe

`1sQJ72njQra4d5CQ` carried **Abdullaha's** signed ERP JWT (expired 2026-08-07) as a literal
`authorization` header on all three HTTP nodes, and — not mentioned in the ticket —
`cookie: isErpAuth=Abdullah.Mahdi` on all three. A bearer expires; an identity assertion does
not. Both cleared on every node, then the workflow archived.

The sibling `MvBUAdN2YfgcrwZC` "TEMP - ERP auth probe" was checked and is already clean
(`REDACTED - supply per run`).

**This does not close the ticket.** It clears the *current* version; earlier versions in the
history still hold both values, and the n8n API has no delete — see §2.2.

---

## 2. Yours — I could not do these

Ordered by how much they matter.

### 2.1 SA-97 — the two halves I could not reach

SA-97 asks for three things. §1.1 does the third (stop the bleeding). The other two are UI:

**Prune the retained runs.** n8n's MCP surface has no delete-execution tool. §1.1 stops new
writes; it cannot remove what is stored. One retained execution of `zwSxrV00VE4rOSvd` holds
25,290 payroll rows plus four live ERP session fields. *Every ERP token in retained executions
has now expired*, so the credential half is closed by time — the payroll rows are not.

→ n8n → each affected workflow → Executions → delete the retained runs.

**Enable production masking.** This is a real per-workflow capability — the API exposes
`workflow:enableRedaction` / `workflow:disableRedaction` as *scopes* — but there is no
corresponding MCP tool and no `settings` field for it, so I could not set it. It is the
better long-term control than §1.1, because it lets you keep execution data for debugging
*and* redact the sensitive fields, rather than choosing between them.

→ n8n → workflow → Settings → the redaction/masking control.

**Rotate the ERP session credentials** named in the ticket — external to n8n, and covered by
§2.5.

### 2.2 Delete the diagnostic probe with its history — UI

SA-124 asks for deletion of the workflow *together with its version history*. Archived and
stripped (§1.5); the history purge needs the UI.

→ n8n → Archived → `DIAGNOSTIC - ERP endpoint auth probe` → Delete permanently.

### 2.3 Finish the secret rotation — UI + portal

Step 1 is done and step 4 is unblocked. The new value is at
`$SCRATCHPAD/webhook-secret-rotating.txt`, mode 600 — **it is not in this repo and not in any
version description, and the scratchpad dies with the session container.** If you lose it,
generate a fresh one and redo step 1; nothing breaks meanwhile, because `live` still works.

1. Create a Header Auth credential, header name `X-SR-Webhook-Secret`, value = the rotating
   value. One credential serves all five — they share the secret.
2. Bind it to each flow's webhook node (the API can neither create nor attach a credential).
3. Switch the portal's `SR_WEBHOOK_SECRET` to the rotating value.
4. Fire each published flow and confirm its `validate_inputs` log line reads
   `secret_slot_matched: "rotating"`. **Do not skip this** — it is the only evidence that live
   traffic has moved.
5. Only then delete the `live` slot from all five. **This is the step that actually buys the
   security**, and it also kills the four-character value's three copies in git.

### 2.4 Rotate the Render PDF API key — external + UI (SA-109)

A live API key sits as a literal `X-API-Key` header on `Daily - Household Expenses` →
`Render PDF`. I did not remove it: without a credential in place the daily report breaks, and
it would have broken overnight with nobody watching.

→ Rotate the key at the PDF provider, create an n8n credential, point the node at it.

### 2.5 Tell three people their credentials were exposed

- **Malaz.a** — ERP bearer in plaintext in a Code node in a shared project, live most of
  2026-08-25. Window closed by expiry; treat as disclosed and re-log-in.
- **Abdullaha** — ERP bearer plus an identity cookie, in two places.
- **Yourself** — the token pasted into tonight's chat (`Hassan.Ahmed`, device
  `1765547372465`, valid to 22:00Z 2026-08-26) is in the conversation transcript along with
  your full ERP session cookie. Re-log-in.

### 2.6 Create the `ERP_BEARER` n8n Variable — UI

Needed before §3.2 can be published. Settings → Variables → `ERP_BEARER`, value **including**
the `Bearer ` prefix (the guards test `indexOf('Bearer ') !== 0`, so a bare JWT is refused).
No MCP tool lists Variables, so I could not check whether it already exists.

### 2.7 Decisions only you can make

- **SA-322** — the daily report emails financial ledger data to a hardcoded address outside the
  company domain. The ticket asks *you* to confirm whether that recipient is intentional. I
  have not touched it.
- **SA-142** — audit output goes to a `workers.dev` subdomain under a personal Cloudflare
  account. Provisioning a company host is not something I can do.
- **SA-146** — tenant-level finding. Belongs to the security team.
- **`ZZ SDR Portal Contract Test`** is a contract test that is published and answering
  production traffic. Whether it should be active at all is worth a separate decision.

### 2.8 Not mine to touch — Abdullah's and Malaz's workflows

`Client Refunds Audit` (`NIUelKhaMucLLSqK`) and `Travel Assist Payments Audit`
(`LM7ofq89VWXiLRU0`) are named in SA-101, SA-105, SA-129 and SA-142, and both are live and
owned by colleagues. I deliberately made **no changes** to either — Ali's own note asks for a
sync before anyone starts, and changing someone else's production workflow overnight without
their knowledge is not a call I should make.

The fix pattern is identical to §1.2/§1.3 and is ready to lift. The one-line reversible win on
both, if they agree, is §1.1's retention setting.

---

## 3. Drafted, not published

Each is written, syntax-checked, byte-verified against the deployed body, and simulated. None
is live. Publish when you have read what breaks.

### 3.1 Rotation slots on three unpublished flows

`Qq473Ygj543jxPUN`, `sXsn4NUYt4kh3OAU`, `LDtsstXDfF99TnYe`. Nothing to publish — those flows
are not live. The slot is there for whenever they are.

### 3.2 Paste-slot removal — four flows

The `const ERP_BEARER = ''` paste-then-clear slot has now held a live token **twice**. A guard
that throws on empty makes an empty slot safe; it does nothing about the operator who pastes
and forgets. **The slot is the defect.**

Converted to read the `ERP_BEARER` Variable, matching the pattern Dummy Tickets already uses:
`uJ8UVNKdN2s5PHHA`, `Qq473Ygj543jxPUN`, `2LaIbHqQ1A2sEBKm`, `7HYpRKJQnH5C7jkj`.

**Blocked on §2.6.** Until the Variable exists, these manual-run nodes throw — which is the
designed refusal, not a regression, but it means publishing before creating the Variable turns
manual runs off.

Also: the **tracked repo copies still contain the defect** and would reintroduce it on any
re-deploy — `cc-below-agreed/nodes/Manual_Run_Config.js:33`,
`cc-non-received/nodes/wfa_manual_run_config.js:30`, `cc-below-agreed/wf-b/nodes/test_baton.js:15`.

### 3.3 Webhook auth on four unpublished flows

`IKRXhIco1mwxrcPq`, `Z9fTvmaM526eYofe`, `9T91z5VFH5g69WyT`, `YXRZdtk2Geeeqaal` (§1.3).

### 3.4 SA-101 / SA-105 / SA-142 — Housemaid Payroll Critical Checks

`zwSxrV00VE4rOSvd`, node `Guard Inbound Request` (renamed from `Guard Callback Origin`),
draft **`8fb7eacd`**. Active version is still `318048f1` (2026-08-02) and has no guard at all.

**A bypass was already there, and it is the most important thing on this page.** A draft from
2026-08-25 08:48 had added an origin check whose parser was `/^(https:\/\/)([^/?#@\\]+)/i` —
**unanchored**. `https://<allowed-host>@evil.com/…` matched as the allowlisted origin and was
**accepted**. The classic userinfo bypass, in a node named "Guard". It is closed, and twelve of
the thirty-five simulation cases exist to keep it closed.

What the draft now does: constant-time two-slot secret check; `callback_url` origin allowlist
plus an anchored `/ta-callback/<64-hex>` path shape parsed without the `URL` constructor (n8n's
sandbox does not expose it); and CRLF-injection shape checks on all **three** SA-105 values —
`erp_token`, `erp_is_auth` and `erp_device_id` are string-concatenated into a `Cookie` header,
so all three are injection points, not just the bearer. 35/35 simulation cases pass, run with
`global.URL` shadowed to `undefined` throughout.

**SA-142** is pinned, not closed: the `workers.dev` origin is allowlisted on its own line,
commented as a personal-account host pending replacement, so it is one line to change once a
company host exists.

**Before publishing this one — read all four:**

1. **The header requirement is unproven against the real caller.** This flow has **zero
   retained executions** — not one, at any status, at any date. Nobody has ever seen what its
   caller actually sends. That absence is pruning and pre-existing settings, not §1.1 (turning
   retention off does not delete what was stored) — but §1.1 does mean no new evidence will
   accumulate either. So: set `saveDataSuccessExecution: "all"` on this flow, let one
   legitimate run land, read the captured `headers`, then publish. Publishing first makes every
   caller that does not send the header fail.
2. **The callback path shape is inherited from a sibling, not measured here.** If the portal
   posts this check to anything other than `/ta-callback/<64-hex>`, that is a second break.
   Confirm it from the same captured request.
3. **A rejected caller sees HTTP 200 and silence.** `Webhook → Respond 200` runs independently
   of the guard, so a refused request is acknowledged and then simply never gets a callback.
   This flow has **no Error Workflow set** — attach one before publishing if you want a
   rejection to reach an inbox rather than only the execution list.
4. **It is now the sixth flow in the rotation.** Step 6 must delete its `live` slot too.

---

## 4. Known divergence — do not read it as drift

WF-A's deployed `Validate Inputs` and its repo copy
(`cc-below-agreed/nodes/Validate_Inputs.js`) **differ on purpose**. The repo keeps the
commented-out `rotating` placeholder; the deployed node has the real value. The new secret is
deliberately absent from git. Anything that byte-compares the two will hit on the
`ACCEPTED_WEBHOOK_SECRETS` block — that is expected, not drift.

Likewise, the new value must never be written into `audit-flows/exports/`. Refreshing an export
from a deployed flow would drop it into a directory one `git add .` away from being committed,
which is the exposure this whole exercise exists to end.
