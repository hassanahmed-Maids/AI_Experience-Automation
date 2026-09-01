# Deploy: Client Refunds audit check to production (n8n, 3 flows) — manual trigger only

**Raise as:** Task · **Component:** n8n / Audit Flow Factory · **Priority:** Medium
**Requester:** Hassan Ahmed · **Business owner / reviewer:** Jacky (maker–checker)
**Spec:** [Client Refunds](https://app.notion.com/p/3c8fe1c78bf0810894a2fb0a55ca521a) (v0.8) · **Status:** Built on n8n — Staging

---

## Summary

Client Refunds is the **first money-out check on the client side** — the six existing client
checks are all money in. It audits every client refund that reached **PAID** in a month
(~1,742/month, AED ~2.8M) and asks, per refund, whether the reason it was filed under
justifies the amount we paid back.

Three n8n flows, built and tested in staging. This ticket asks for them to be **published to
production**. It does **not** ask for a schedule — the check is manual-only by design.

---

## What is being requested

1. **Publish three draft workflows** in the n8n **Adeeb** project:

   | Stage | Workflow | Role |
   |---|---|---|
   | 1-Score | `XNAeirfksS1dIpZl` | Entry point. Publish and make runnable. |
   | 2-Verify | `xGXVJyGkPgZYIn0X` | Sub-workflow. Called by 1-Score only. |
   | 3-Deliver | `OznVXTRb1hApsYRH` | Sub-workflow. Called by 2-Verify only. |

2. **Do NOT schedule any of them.** The spec is explicit: *manual only, not scheduled.* The
   operator starts a run from the 1-Score form and supplies their own ERP token per run.

3. **Do NOT activate 2-Verify or 3-Deliver as independent entry points.** Both are
   sub-workflows; caller policy is already restricted to same-owner workflows.

---

## Prerequisites — all five block a first real run

These are not deployment work, but the check cannot produce a valid run until each is done.
Raise as blocking sub-tasks or confirm each before publishing.

| # | Blocker | Owner | Why it blocks |
|---|---|---|---|
| 1 | Grant `accounting_ClientRefundSetup` and `accounting_client-refund-summary` to the auditing account | ERP / access | Both return **401 INSUFFICIENT_PERMISSIONS** today. The first is the per-purpose config the only two live gates read; the second is the population itself. **Requested 2026-08-30.** |
| 2 | Share the Google Sheets and Gmail credentials with the n8n **Adeeb** project | n8n admin / Hassan | They sit in a personal project, so 3-Deliver fails with *"does not have access to the credential"* on its first real delivery. |
| 3 | Confirm the reviewer's email address for the draft report | Jacky | Currently a placeholder. The flow creates a Gmail **draft** and never sends. |
| 4 | Tick `Test cases verified` — open the five named cases in the ERP | Jacky | Nobody has opened them. The offline tests currently validate against unconfirmed expectations. The spec states the flow cannot go live without this. |
| 5 | Decide the AI-verifier volume (see *Scope reality* below) | Jacky | It is a cost, review-capacity and data-exposure decision, not a build fix. |

### On blocker 1 — a correction worth reading

Both endpoints are recorded on the spec page as **live-verified**, and the permission ask for
`clientRefundSetup` had been explicitly **withdrawn as "never needed."** Both of those
conclusions came from a **different login** to the one that will run the check. On the
auditing account they are 401. The endpoint rows have been corrected and the withdrawal
reversed. Suggested convention going forward: record *which identity* every "live-verified"
claim was made on — a verification with no identity attached is not reusable.

---

## Scope reality — please read before approving

The spec describes 26 rules. Read each rule's own *run-time sourcing* note and **two gates
can actually conclude** today:

- **⓫** — approval against the CEO limit configured for the refund's own purpose.
- **G-ATTACH** — a required supporting document that is missing. Named independently by G2b,
  G7 and G10, and free: the flag rides on the config read ⓫ already makes.

Everything else — rules ❻ ❼ ❽ ❾ ❿ and groups G3/G5/G8 — depends on evidence that is either
401 for this role or has **no ERP route at all** (freeze windows and the per-month detail
lines are permanently unavailable; that hunt closed 2026-08-27). Those cases close **pending,
with the gap named on the case** — never clean. Two groups, G1 and G7's two big members, are
declared coverage gaps: **AED 1.51M a quarter that no test can reach.**

**Consequence the spec has not yet absorbed.** It sizes the AI verifier at *"208 of 1,768
paid July refunds (11.8%)"*, assuming the mechanical gates settle the rest. They do not —
they hand it over. Real intake is close to the whole population (~1,742/month), and the
verifier reads staff notes, four of which in the measured quarter carry an IBAN, an account
number and a SWIFT code with the holder's name. **That is blocker 5.**

---

## Data protection

- **The flow holds no ERP credential.** The operator pastes their own bearer token and
  `authTokenProduction` cookie per run; neither is stored. ERP logs every read under the
  token's identity, so findings stay attributable to whoever produced them.
- **Per-case note text reaches the workbook and nowhere else** — not the email, not the run
  summary, not a log. The email carries counts, flags and totals only.
- The population read returns `iban`, `eid` and `accountName`, which the check does not need.
  A slim projection drops them in the first node after the HTTP call; a data-minimisation ask
  on that endpoint is outstanding separately.
- The check is flagged **Handles sensitive data** and **Independent review required**.
  Nothing reaches PIL without Jacky.

---

## Evidence

**87 offline tests, all green** — 38 on the scoring gates, 31 on the 41-purpose partition and
the attachment gate, 18 proving the deployed n8n node body matches the tested source line for
line (it is generated from `score-core.js`, not hand-copied).

**Exercised in n8n against pinned data:** scoring (correct findings, group routing, note-key
coverage), delivery both delivering and refusing a short case set *after* logging it, the
verifier's full verdict vocabulary, and the whole chain 1→2→3 in a single execution.

**Not yet exercised, stated plainly:**
- **The live ERP legs.** Every ERP response in every test is pinned, because both endpoints
  are 401. This is what blocker 1 unlocks.
- **A real Sheets write and Gmail draft** — pinned so far.
- **One verifier fix is unverified.** Parallel batching was causing every second model call
  to 400; it now runs serially. Confirming that needs a live model call. **First real run
  should check the `verifier.vocabulary` counts — a `READ FAILED` rate near 50% means the fix
  did not take.**

---

## Notes for whoever deploys

- **The ERP lease was removed on request (2026-09-01).** Stage 1 previously took the shared
  lease (`9gVijqvtLVEhQZXz`). What still protects ERP is the flow's own pacing — one request
  in flight, 500 ms apart, 2 req/s against the ERP-LOAD-POLICY §1 ceiling of 4 — on a run of
  roughly 45 calls. **What is given up: two audits can now hit ERP concurrently, which
  per-flow pacing cannot bound.** Flagging it because bursts are what disabled the ERP account
  in June 2026.
- **The Score node is generated.** Do not edit it in n8n. Regenerate with `node build-node.js`
  and prove it with `node parity.test.js`.
- **Two test rows sit in the workbook's `Runs` tab** with `status = REFUSED`, from pinned
  chain tests. Clear them before the first real run so the log starts clean.
- **The predecessor flow `NIUelKhaMucLLSqK` ("Client Refunds Audit") is retired, not
  inherited.** It scored a category's monthly average against an offline constant and flagged
  22/20/15 categories across May–Jul 2026 — it could never pass. Worth archiving so nobody
  runs it by mistake.

---

## Definition of done

- [ ] All five prerequisites closed
- [ ] Three workflows published, none scheduled, none activated as independent entry points
- [ ] One capped smoke run against live ERP: population count matches ERP's own
      `totalElements`, the config checksum returns 68 contiguous rows, and the run reports
      which note field is populated
- [ ] `verifier.vocabulary` inspected on that run (see the unverified fix above)
- [ ] One full-month run, reviewed by Jacky before anything reaches PIL
- [ ] Notion updated: `Status` → *Live on Production*, `n8n Prod Link`, `n8n Version`
      (the published `activeVersionId`), `Released` date

## Rollback

Unpublish the three workflows. The check writes only to its own workbook and creates an email
draft; it makes **no writes to ERP** and sends nothing. Nothing to reverse beyond deleting
workbook rows.

---

## Links

- **Spec:** https://app.notion.com/p/3c8fe1c78bf0810894a2fb0a55ca521a
- **1-Score:** https://sami-team.app.n8n.cloud/workflow/XNAeirfksS1dIpZl
- **2-Verify:** https://sami-team.app.n8n.cloud/workflow/xGXVJyGkPgZYIn0X
- **3-Deliver:** https://sami-team.app.n8n.cloud/workflow/OznVXTRb1hApsYRH
- **Workbook:** https://docs.google.com/spreadsheets/d/1kuLvDBjXvxfiOWZh-ds0P0hlNV331_hjQorwnKVaNtQ
- **Code, tests and build notes:** `audit-flows/client-refunds/` on branch
  `claude/erp-audit-flow-builder-c0ctp4` — `NOTES.md` carries the endpoint status table, the
  ERP/n8n traps found along the way, and the full run log.
