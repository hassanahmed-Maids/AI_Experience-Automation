# Triggering a run by webhook (the operator runs it under their OWN token)

Written 2026-08-19. Use this when the person who should own the run is not the person editing
the flow — the token travels in the request body, so ERP attributes all ~11,000 reads to
whoever sends it, which is the point.

## What Validate Inputs requires

Read from the node itself (`Validate Inputs`, WF-A `uJ8UVNKdN2s5PHHA`):

| field | rule |
|---|---|
| header `X-SR-Webhook-Secret` | must match one of the slots in `ACCEPTED_WEBHOOK_SECRETS` (line 116 of the node) — today just the `live` slot. Copy it from there; it is deliberately not written down here. The node's own comment is worth reading: it travels in plaintext, lands in every execution's data, and keeps strangers out, not colleagues. The `validate_inputs` log line reports which slot matched, never the value. |
| `check_id`, `run_id` | any non-empty strings; `run_id` keys the run |
| `callback_url` | origin must be one of the two in `CALLBACK_ORIGIN_ALLOWLIST` (line 124) and the path must match `/ta-callback/<64 hex>` — or `/functions/v1/ta-callback/<64 hex>` |
| `audit_window` | `{"kind":"month","year":2026,"month":7}` — or `{"kind":"date_range","from":"...","to":"..."}` |
| `params.erp_auth.bearer` | `"Bearer <jwt>"`, shape-checked for CR/LF (header-injection guard) |

Optional:

| param | default | what it does |
|---|---|---|
| `params.previous_cases` | `[]` | carried cases from a previous run |
| `params.enrich_chunk_size` | 750, clamped to 1,200 | candidates per WF-E sub-execution |
| `params.score_batch_size` | 1,200, clamped to 2,000 | cases per WF-T sub-execution. **Lower it to force more batches on a small cohort** — that is how the fan-out gets exercised. Do not go below ~600 for a real run: the circularity tripwire inside `Guards` arms at 500 scored cases (`Join Scored` repeats it run-level, so nothing is lost, but the per-batch check goes quiet). |
| `params.cohort_cap` | absent = **uncapped = a real audit** | caps the cohort for a PIPELINE TEST. Every number from a capped run is unpublishable and the run says so in its own log. |
| `params.population_floor` | 4,600 | may be raised, never lowered |

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
# 2. paste the webhook secret from Validate Inputs line 116 (the 'live' slot)
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

**It does NOT answer immediately — measured 2026-08-19, see VALIDATION.md §22.** The intent
was `200` with the accepted run (or `400` with the reason) straight away, and the `Webhook` node
is correctly set to `responseMode: responseNode`. But `Respond 200` is drawn at y=-144, *below*
five of the six sweep starters, and n8n's `executionOrder: v1` runs equally-ready branches in
POSITION order — so the acknowledgement fires 6th, after ~30 minutes of sweeping. Cloudflare
gives up at 100 s and the caller gets **`524 A timeout occurred`**.

**A 524 here does NOT mean the run failed.** The workflow is already executing; check the
execution list before concluding anything, and never re-POST on a 524 — a retry starts a
SECOND full audit (~11,000 more production ERP reads) against the same `run_id`. Fixed by
moving `Respond 200` above the sweeps; until you have confirmed that fix is deployed, treat
the 524 as the expected response. The audit then runs asynchronously. Measured on execution 93346, the
furthest a run has reached — these are observed, not projected:

| phase | measured |
|---|---|
| population + terminated walks (now WF-Pop) | 16.0 min |
| three payment windows (WF-P) | 9 s |
| status sweep (WF-S) | 7 min 51 s |
| gate 2 + cohort + payment attach + chunking | 10.0 min |
| enrichment, 8 chunks of 750 (WF-E) | 7.0 min |
| the scoring tail | **never completed** — 93346 crashed here, which is what WF-T fixes |

So budget **~45 minutes** and expect the tail to add roughly five sub-executions on top of the
41.5 minutes 93346 reached before it died.

## Activation state — CHANGED, read this

**WF-A is published and active** (since 2026-08-19, at Hassan's instruction), so the
production path `/webhook/cc-below-agreed-amount` is live right now. That means the earlier
version of this section is obsolete: you do not need test mode, and the webhook is reachable
by anyone holding the URL and that plaintext secret until it is rotated into a credential (see
the rotation section below).

Two things follow:

- A **crash deactivates the workflow.** If a run dies, the next POST returns
  `{"code":404,...,"is not registered"}` — that is not a bad payload, it is a deactivated
  workflow. Re-publish before re-firing. This has already caught me once.
- If you would rather not leave it reachable, unpublish after the run. Test mode still works
  as an alternative: click *Test workflow*, then POST to
  `https://sami-team.app.n8n.cloud/webhook-test/cc-below-agreed-amount` inside the listening
  window — same payload, same validation, manual mode.

Publishing order matters if anything is edited first: **leaves before the parent.** n8n refuses
to publish WF-A while any of WF-Pop / WF-P / WF-S / WF-E / WF-T / WF-B / WF-C is unpublished,
and it names them.

## The run to fire FIRST — a capped pipeline test

Nothing in this chain has executed since the tail was batched, so the first run should be the
cheap one that exercises the new parts rather than the full book. Same command as above with two
params added:

```json
  "params": {
    "erp_auth": { "bearer": "$ERP_BEARER" },
    "previous_cases": [],
    "cohort_cap": 2000,
    "score_batch_size": 400
  }
```

**Why 400 and not the default.** `cohort_cap: 2000` alone gives two batches at the default 1,200,
which barely tests the fan-out. At 400 you get five, so `Score Batch (WF-T)` fans out properly and
`Join Scored`'s batch-index reconciliation (no gaps, no repeats) is actually exercised. That
reconciliation is the thing standing between a lost batch and a run that reports on 1,600 of
2,000 contracts while looking perfectly clean.

**Two things a capped run does NOT do, so nobody reads more into it than it earns:**

- **It does not reduce the sweep cost.** The cap is applied inside `Build Cohort`, *after* the
  population walk, the three payment windows and the status sweep — so a capped run still pays
  ~30 minutes and the sweeps' full memory. It tests the tail, not the sweeps.
- **Every number it produces is unpublishable.** `Build Cohort` logs
  `PIPELINE TEST - NOT AN AUDIT` and the case store carries `pipeline_test: true`. Coverage is
  incomplete by design.

**It does have real side effects.** It appends ~2,000 rows to the Cases tab (the review queue) and
a Run Summary row. The three callback nodes are disabled so nothing is POSTed to the portal. If
you want the queue kept clean, use `cohort_cap: 400` with `score_batch_size: 100` — still four
batches, 400 rows.

### What to read afterwards, in order

1. `chunk_cases` — `batches` and `batch_sizes` match the cap and the batch size.
2. `wft_return_batch`, once per batch — `rows_appended` equals `cases`, and `bands` is populated.
3. `join_scored` — `batch_indexes` is `0..n-1` with no repeat, `rows_appended` equals `cases`,
   and `circularity_tripwire_run_level` reads *armed and passed* (or *not armed* on a cohort
   under 500 — expected on a small cap, and it says so rather than looking like a pass).
4. `guards` — `plan_source` should read `Join Enrichment`, not `unavailable`.
5. `wfpop_project_rows`, twice — `last_page_short: true` on the active walk, and
   `salary_fields_dropped` greater than zero, which is the proof the salary field never reached
   WF-A.
6. The execution's peak memory, and whether anything else was running in the instance — that is
   the open question from VALIDATION.md §19 and the reason to run this alone.

Then, if it is clean, the same command with `cohort_cap` and `score_batch_size` removed.

## Verify the token IMMEDIATELY before firing — not at session start

Learned from execution 94355, which died 7 seconds in. Tokens die **early**, not only at
22:00 UTC: 94355's bearer had `exp` 22:00 and was already dead at 14:49, having answered 200
at 14:41 and walked 136 pages until 14:27. Something logged the session out elsewhere.

One call settles it, and it costs nothing:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://erpbackendpro.maids.cc/clientmgmt/contract/search/page?page=0&size=1&sort=&searchKey=&unAssignedClients=false&vipClients=false&vVip=false&gccClients=false' \
  -H 'pagecode: ClientList' -H 'content-type: application/json' \
  -H 'origin: https://erp.maids.cc' -H 'referer: https://erp.maids.cc/' \
  -H "authorization: $ERP_BEARER" \
  -d '{"contract":{"status":"ACTIVE","contractProspectType":{"code":"maids.cc_prospect"},"client":null,"housemaid":{"nationality":null},"contractType":null},"extraFilters":[],"flowTypeCode":null,"paymentMethod":null,"bankIds":[],"clientNationalityIds":[],"includeNullNationality":false,"emirate":null,"clientsWithMultipleContracts":false}'
```

`200` means fire. `401` means get a fresh token — the body will read `UNAUTHORIZED <LOGOUT>`,
which is ERP's generic 401 and says nothing more specific than "not authorized right now"
(see PROBE-RESULTS). A dead token costs one ERP call to discover here, because the population
walk runs first — but it costs the whole run.

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

### THE SECRET IS NOT THIS FLOW'S. IT IS SHARED BY FIVE.

Discovered 2026-08-25, and it invalidates every earlier version of this section. The same
literal is the accepted secret in **five** audit flows, all called by the same portal
trigger. Two of them are published and answering traffic today; the other three carry the
check but are unpublished drafts, and would inherit the outage the day someone publishes
them:

| Flow | Workflow | Published? |
|---|---|---|
| CC Below Agreed (this one) | `uJ8UVNKdN2s5PHHA` | **yes — live** |
| Dummy Tickets Housemaids 1-Score | `aTmGMAlYLwsJQ7js` | **yes — live** |
| CC Non Received Monthly Payments | `Qq473Ygj543jxPUN` | no (draft) |
| Terminated Housemaids Tickets 1-Score | `sXsn4NUYt4kh3OAU` | no (draft) |
| MV Overstay Fines | `LDtsstXDfF99TnYe` | no (draft) |
| Housemaid Payroll Critical Checks | `zwSxrV00VE4rOSvd` | no (draft) — **added 2026-08-25, see below** |

So switching `SR_WEBHOOK_SECRET` on the portal after adding a slot **here only** does not
half-rotate one check — it takes Dummy Tickets offline immediately and arms the same failure
in the other three. The symptom is the quietest one this codebase produces: a silent
`unauthorized` in the execution list with the alert email deliberately suppressed
(`_silent`). The set therefore has to exist in all five *before* the portal moves, drafts
included. Any future step that touches the shared value is a five-flow step.

**Make that THIRTEEN as of 2026-08-25 — see the authoritative table in
`audit-flows/SECURITY-STATUS.md` §1.2 and work from it, not from this section.** Closing the
unauthenticated-webhook findings and tickets SA-101/105/142, SA-116 and SA-129 gave eight more
flows the same two-slot set. Step 6 is a thirteen-flow step. The paragraph below covers only
the first of those eight and is kept because its reasoning generalises.

**Make that SIX as of 2026-08-25.** `zwSxrV00VE4rOSvd` (Housemaid Payroll Critical Checks) was
not originally one of them — it is a different caller route on an older payload contract
(`ansari_data` / `payroll_data` / `credentials.erp_token`, not `params.erp_auth.bearer`), and
the "`ta-trigger-run` sends the header on every call" evidence does **not** transfer to it.
Closing SA-101 gave it the same two-slot set, so it now accepts the same secret. Consequences:

- **Step 6 must delete the `live` slot from six flows, not five.** Miss it and the payroll
  audit is the one endpoint still trusting a dead secret.
- Its draft is **unpublished**, and publishing it is riskier than the others were: there is no
  retained execution anywhere on that flow, so nobody has ever seen what its real caller sends.
  Capture one live request first — see `SECURITY-STATUS.md` §3.4.

The value itself is **four characters**, which no constant-time compare can rescue — it is
guessable by hand, never mind by a script. It is also committed to git in three tracked files
(`cc-below-agreed/nodes/Validate_Inputs.js`, `cc-below-agreed/nodes/Manual_Run_Config.js`,
`cc-non-received/nodes/wfa_manual_run_config.js`) and sits in five untracked local exports
under `audit-flows/exports/`. So it has no strength against anyone who can read the repository
or the n8n project, and not much against anyone who cannot. It keeps casual strangers out,
nothing more.

Two consequences worth being explicit about. First, **the security is bought at step 6, not
step 1** — until the `live` slot is deleted, the four-character value still opens every one of
these webhooks, and adding a strong second slot next to it changes nothing about that.
Second, the new value must never be written into `audit-flows/exports/` — refreshing an export
from a deployed flow would drop it into a directory one `git add .` away from being committed,
which is the exposure this whole exercise exists to end.

### What *is* done

**Step 1 is deployed in all five flows, 2026-08-25.** Each `Validate Inputs` now accepts a
**set** of named secret slots instead of one literal, and logs which slot matched (never the
value). That removes the ordering trap — with a single literal there was no sequence that
avoided an outage, because changing the portal first makes the flows reject everything and
changing the flows first makes the portal's old value reject.

**Deployed is not the same as in force, and on one live flow it is not yet in force:**

| Flow | Slot deployed | Version answering live traffic |
|---|---|---|
| CC Below Agreed `uJ8UVNKdN2s5PHHA` | yes | **published `084f8783` — in force** |
| Dummy Tickets 1-Score `aTmGMAlYLwsJQ7js` | yes | **published `da348166` — in force** |
| CC Non Received `Qq473Ygj543jxPUN` | yes, as a draft | flow is unpublished |
| Terminated HM 1-Score `sXsn4NUYt4kh3OAU` | yes, as a draft | flow is unpublished |
| MV Overstay Fines `LDtsstXDfF99TnYe` | yes, as a draft | flow is unpublished |

Both live flows are published on both slots as of 2026-08-25, so **step 4 is unblocked** —
switching the portal will not take either audit offline.

Publishing Dummy Tickets also shipped a pre-existing unpublished draft it was stacked on (the
round-3 error-rail `run_id` fix). That was the owner's call, made explicitly, not a side
effect nobody noticed.

Before publishing, the deployed body was simulated against nine cases — old value, new value,
wrong value, empty string, missing header, a 20-character prefix of the new value, both values
with a trailing space, and the old value lowercased. Both secrets matched their own slot; all
seven near-misses were rejected; the value appears in no log line. The harness executes the
**deployed** `safeEqual`, array and loop pulled out of the live body rather than a
re-implementation, because re-implementing would have tested an idea of the check instead of
the check. Script: `$SCRATCHPAD/rotation/verify_atmg.mjs`.

Both slots are live: `live` (the four-character value the portal has always sent) and
`rotating` (256 bits, generated 2026-08-25). **The new value is deliberately not in this
repository and not in any version description** — it exists only inside the five deployed
nodes and in the file handed to the owner out of band. If it is lost before step 4, generate
a fresh one and redo step 1; nothing breaks in the meantime, because `live` still works.

### The sequence

1. ~~**Add the new secret alongside the old**, in all five flows.~~ **Done 2026-08-25.**
   Both slots are accepted everywhere; nothing has broken.
2. **Create the credential.** n8n → Credentials → new **Header Auth**, name it
   `SR Webhook - Audit Flows`, header name `X-SR-Webhook-Secret`, value = the `rotating`
   value. One credential serves all five, because they share the secret.
3. **Bind it to each Webhook node.** Each of the five flows' webhook trigger → Authentication →
   **Header Auth** → the credential from step 2. Publish each. n8n then rejects
   unauthenticated callers before the workflow runs; the in-flow check stays as a second
   layer. (This step is a UI action — the n8n API can neither create a credential nor attach
   one, verified against the whole tool surface 2026-08-19.)
4. **Switch the portal.** Update `SR_WEBHOOK_SECRET` to the `rotating` value. This is the
   step that must not precede step 1 on any of the five.
5. **Verify on live traffic, do not assume.** Trigger a run of each of the two published
   flows and read its `validate_inputs` log line: `secret_slot_matched` must read `rotating`.
   If either still reads `live`, the portal change has not reached that caller and step 6
   would break it. The three drafts cannot be verified this way — they answer no traffic — so
   for those, step 6 is a code review, not a measurement.
6. **Remove the `live` slot** from all five and publish. The old secret — and its eleven
   copies in git — is then dead, which is also what closes the committed-secret exposure.

Do **not** compress steps 1 and 6 into one change — that is exactly the outage the set
exists to prevent.

### What this does and does not buy

It stops the secret being readable by anyone with project access, and it moves rejection to
n8n's edge. It does **not** make the secret confidential against an insider on the portal
side, and it is not a substitute for the `callback_url` allowlist — that allowlist, not the
secret, is what stops an authenticated caller having the audit couriered to their own host.
