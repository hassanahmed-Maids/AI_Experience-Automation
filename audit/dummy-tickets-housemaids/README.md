# Dummy Tickets Submitted for Refund — Housemaids

Rebuild of the live check `FXrhGBJUnGYgrs9R`, against Notion spec **v0.4 draft (2026-08-17)**.
check_id `7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02`.

## What is where

| | |
|---|---|
| **1-Score** (main flow, PUBLISHED) | https://sami-team.app.n8n.cloud/workflow/aTmGMAlYLwsJQ7js |
| **0-Fetch Tickets** (sub-workflow, PUBLISHED) | https://sami-team.app.n8n.cloud/workflow/YQlNlxrnhbQpBbdl |
| Result workbook | https://docs.google.com/spreadsheets/d/172R3JzxXm1nf6Vc3qTesin7eys-jT0ng3SOxUsf3LD8 |
| Golden it is built on | `Qq473Ygj543jxPUN` — CC Non Received Monthly Payments |
| The flow it replaces (LIVE) | `FXrhGBJUnGYgrs9R` |

`scorer.js` · `test-cases.js` · `prod-comparison.js` · `SPEC-FINDINGS.md`

## Running it

```bash
node test-cases.js       # 49 assertions: spec test cases + one guard per "Never" clause
node prod-comparison.js  # scores the same fixtures through the LIVE flow's logic
```

For a live run: set the n8n workflow variable `ERP_BEARER` to `Bearer <token>` — **the token of
the person running the check** — and execute from the `Run Manually` trigger. Disable the three
`Callback —` nodes first unless you intend to post to the portal.

**Runs completed end to end** (both 2026-08-19, results in the workbook):

| window | population | applicants | findings | exposure | wall clock |
|---|---|---|---|---|---|
| 2026-05-01..05 (5d) | 137/137, 1 page | 93 | 4 | AED 11,517 | ~2m40s |
| 2026-06-01..30 (30d) | 1197/1197, 6 pages | 605 | 7 | AED 22,611.54 | 8m05s |
| 2026-06-01..30 (re-run) | 1197/1197, 6 pages | 605 | 7 | AED 22,611.54 | **7m24s** |

The two June runs produced an **identical scored result** — same findings, same exposure, same
population proof. Only the ERP-transient `applicants_unreachable` count moved (4 → 1).

The June run is the **first month-scale run ever to complete** — the spec records the only previous
attempt dying with `erp_unavailable`. 25 sequential chunks, zero ERP failures across ~1,200
authenticated reads.

## Before this goes live

1. **Sign-off — still outstanding, and now the flow is live.** This was written while the flow was a
   draft. It is published and the portal is cut over to it (see *Cutover* below), at owner instruction.
   Nobody who has read the spec has yet approved a production run, and findings here name real clients
   and real money. This is the one item the cutover made *more* urgent, not less.
2. **All four business questions are settled** (Hassan, 2026-08-19) — see `SPEC-FINDINGS.md`
   Parts 3 and 4. Every default is a ruling; each is overridable in `params` only so an
   alternative can be measured:
   - blank refund schedule → **flag it** (1 red in 93)
   - zero-amount siblings → **clean** when the money all came back (clean 61 → 82)
   - repeat-booking threshold → **2**, which sends **49 of 93** for a booking review
   - scope → **applicants only**; a housemaid charge is counted but caseless

   Note on the threshold: it drives review load only. Findings stay at 4 and exposure at
   AED 11,517 at any threshold. A threshold of 6 would send 8 for review instead of 49.
3. **Re-verify on the operator's own ERP account.** Everything in Part 2 was measured on a
   borrowed token; nothing should be marked `Technical Validated` until it is re-run under the
   identity that will own the findings. Portal-driven runs solve this on their own — the token
   arrives in the payload from the triggering user's saved credentials.
4. ~~**The live flow's webhook is unauthenticated** (Part 1 §1).~~ **Closed 2026-08-19** — the old
   flow is archived, and the path it exposed is now served by this flow's shared-secret gate.

## The verifier

Rules 1 and 2 are **built** (see `SPEC-FINDINGS.md` Part 5). Enforcement lives in
`Merge Verdicts`, not the prompt: only `EXPLAINED`+quote or `CLAIMED_OFF_ERP`+quote may move a
ticket, a claimed off-ERP refund downgrades to *pending* and never clears the amount, and there
is no path by which a confirmed loss becomes clean.

**Rule 1 has no live case yet** — the reference window holds zero `Used` tickets. Covered offline
only; do not record it as validated.

## Cutover — done 2026-08-19

The portal was repointed **from the n8n side**, not the portal side. Rather than edit the check's
registry row (it lives in the Security Room's Supabase project, which was not reachable), this flow
**adopted the retired flow's webhook path**. The URL the portal already stores now resolves here:

```
POST https://sami-team.app.n8n.cloud/webhook/applicant-dummy-ticket-refund-audit
```

`/webhook/dummy-tickets-housemaids` **no longer exists** — do not use it in a manual test.

The repoint needed **no portal-side payload change**. This flow's validator is the golden's, and the
golden is what the portal already drives:

| Demanded | Already satisfied |
|---|---|
| `x-sr-webhook-secret` header | same value the golden expects |
| `callback_url` on the origin allowlist, `/ta-callback/<64-hex>` | the allowlist *is* the portal's two callback hosts |
| ERP token | backwards compatible — prefers `params.erp_auth.bearer`, still reads the legacy `auth.erp.token` the old flow used |
| window ≤ 31 days | portal default is the previous calendar month |

Verified by POSTing the production path with no secret: it answered
`{"accepted":false,"message":"unauthorized"}` — the new validator's terse security rejection. The old
flow had no secret check and would have replied with a `Missing required field(s)` shape instead.

**The old flow `FXrhGBJUnGYgrs9R` is archived**, not merely unpublished. Two reasons: republishing it
would collide with this flow on that path and could silently take the URL back, and archiving closes
its unauthenticated-webhook exposure for good. Its logic is preserved in `prod-comparison.js`.

### Two things to know about the first portal-driven run

1. **A misconfigured repoint fails quietly.** If the portal does not send the shared-secret header for
   *this* check, every call returns `unauthorized` — and that branch sets `_silent`, deliberately, so a
   stranger who finds the URL cannot mail-bomb anyone. The portal would look like it ran and produce
   nothing. Watch the first run in the n8n execution list; do not assume it.
2. **A rejection returns HTTP 200** with `accepted:false` in the body, not a 4xx. That is inherited
   golden behaviour, and the portal is already built against it — left alone deliberately.

## What the cutover did *not* settle

- **Sign-off.** `Test cases verified`, `Business Validated` and `Technical Validated` are still unticked.
- **Two rules have never seen a live case:** gate 80 and verifier rule 1 (no `Used` outcome has ever
  appeared, across 1,290 tickets read), and gate 100's date-based half.
- The **repeat-booking threshold of 2** costs 281 booking reviews per 7 findings at month scale.

The borrowed-token gap, though, closes itself: in production the token arrives in the portal's payload
from the triggering user's own saved ERP credentials. `ERP_BEARER` matters only for manual runs.
