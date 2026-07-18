# System 3 — shadow-mode reconciliation (go-live parity)

**Status: BUILT 2026-07-08, designed against a PENDING CustomerIO connector.** The reconcile step needs a CIO connector (MCP) that can read journey/campaign membership; until it exists, System 3 Step 1 runs in the manual mode and Step 2 is wired but blocked on the connector. Moe will inform when the connector lands; enhance the reconciler against its real API then.

## What it is
After a cluster is **built in CIO and validated**, it goes live in **shadow mode**: CIO journeys run people through the *entire* flow but **do NOT actually send** — ERP keeps sending the real messages. System 3 then **compares** what CIO *would have sent* against what ERP *actually sent* (Snowflake) and against **DB ground truth**, measures **CIO correctness per template**, and drives a **fix loop to ≥80% → cutover** (turn CIO sending ON, ERP OFF for that cluster). This is NOT design validation (that's System 1/2) — it's live-parity measurement.

## The two steps (run per cluster via `/system3 <target> <cluster> <step>`, gated)
- **Step 1 — `validate`** = the connector-upgraded **`golive-final-checker`** (System 2's final-check doubles as System 3's entry gate). With the CIO connector it inspects the **actually-built** campaign directly + confirms every event / API / data-attribute the design needs is **live and accurate**, cross-checked against the low-code (`scripts/ask-code.sh`) + `mmdb`. **GO here ⇒ the cluster may enter shadow mode.**
- **Step 2 — `reconcile`** = **`system3-reconciler`**. The shadow compare + accuracy + fix loop (below).

## Accuracy — the definition (the crux)
- **Unit: per template**, rolled up to the cluster. **Gate: a cluster is cutover-ready when its templates reach ~80%.**
- **Source of truth: the DB, not ERP.** ERP is fallible ("can make mistakes but won't be all wrong"). So accuracy = **how often CIO's decision is correct vs DB ground truth**, NOT how often CIO matches ERP.
- **`accuracy(template) = CIO-correct / adjudicated-total`**, where each adjudicated case is decided by re-deriving the flow-spec's eligibility for that person from `mmdb`.
- **ERP mistakes are excluded** from CIO's score and **logged separately** (an ERP-discrepancy report). Where CIO correctly diverges from an ERP mistake, flag it as a **CIO win**.

## The three checks (per template, over the trailing window)
1. **CIO → ERP:** each CIO would-send → did ERP send the **same template to the same person on the same Dubai calendar day**? (Snowflake `broadcasts_final_layer`.)
2. **ERP → CIO:** each ERP send → did CIO have a matching would-send recipient (same template, same day)?
3. **DB adjudication:** for **every CIO≠ERP disagreement** + a **sample of the agreements**, re-derive from `mmdb` whether the person **should** have received it (per the cluster's flow-spec conditions):
   - DB agrees with CIO → **CIO-correct** (if ERP diverged → **ERP-mistake**, logged, excluded).
   - DB disagrees with CIO → **CIO-bug** → emit a **low-code-verified fix**.

## Matching & data rules
- **Person match:** CIO `clientId` → client mobile → hash → `broadcasts_final_layer.RECEIVER_MOBILE_NUMBER` = `CLIENTS_LIVE.NORMALIZED_MOBILE_NUMBER` (~98%; see `docs/snowflake.md`). Unmatched recipients are a **data-quality note**, NOT auto-counted as CIO misses.
- **Template match:** exact template (id/name; mind the `VisaServices / ` prefix).
- **Time match:** same Dubai **calendar day** (CIO would-send day == ERP `sent_date` day).
- **Snowflake lag:** ~1–2h ingestion delay — **exclude the most-recent ~2h** from "miss" judgments (`sent_date` itself is always correct, never shifted). Never call a would-send a miss until its day has fully cleared the lag.

## Run cadence & scope
- **On-demand, per cluster.** Scores each template over a **trailing ~14-day window**; a template is only scored once it has **≥ ~20 would-sends** in the window (widen the window for low-volume templates). Re-run after each fix.
- **Data sources:** CIO connector (would-sends: per-person, per-send-node, clientId/phone + template + timestamp; + live campaign read for Step 1) · Snowflake `broadcasts_final_layer` (ERP actual sends) · `mmdb` (DB ground truth) · `scripts/ask-code.sh` (low-code — verify eligibility logic + proposed fixes).

## Output & the loop
`work/<target>/<cluster>/system3/reconciliation-<date>.md`:
- Per-template accuracy (+ cluster roll-up) and the cutover verdict (≥80% ⇒ cutover-ready).
- **CIO-bug list** with a proposed, low-code-verified fix each (this is what Moe fixes in CIO before re-running).
- **ERP-mistake log** (separate; excluded from CIO score; hand to the ERP team).
- Data-quality notes (unmatched recipients, low-sample templates), and iteration tracking (accuracy across re-runs).
- **Loop:** fix CIO → re-run `reconcile` → repeat until each template clears ~80% → the cluster is cutover-ready (CIO on, ERP off).

## Connector — VERIFIED behavior (2026-07-14, env 217768 campaign 125)
The CustomerIO MCP (`cio_read_api`/`cio_schema`, EU base) is live. Verified against the deliveries API:
- **Would-sends = drafted deliveries:** `GET /v1/environments/{env}/deliveries?campaign_id={id}&drafts=true&size=200`, paginate `meta.continuation` until empty. **Drafts cap at 20 rows/page** regardless of `size`; `page_all=true` times out over many draft pages — paginate manually. Each record: `customer_id`, `template_id`, `subject` (= the send-action name, e.g. "Send RENEWAL_MV_MEDICAL_REMINDER_AUH_INITIAL" — a direct ERP-template label), `created` (unix), `state=drafted`, `action_id`.
- **Identity gotcha:** delivery `customer_id` is the **cio_id (hex, e.g. `a8a50d02…`), NOT `c_<clientId>`.** Resolve to the external id via `GET /customers/{cio_id}` → `.customer.attributes.id` = `c_<clientId>` (and `.clientCity` for the emirate). Person profiles are thin — routing attributes are not on the person; adjudicate CIO-correctness from mmdb/CLIENTS_LIVE by clientId.
- **template_id → ERP name:** inline `campaign.actions` is null; read `GET /campaigns/{id}` → `.campaign.version`, then `GET /campaigns/{id}/versions/{version}` → `.actions[]`, pair each `webhook_action` `name` ↔ its `template` (=template_id). Branch conditions live in `conditional_branch_action.conditions` as **base64 of URL-encoded JSON** (decode: `urllib.parse.unquote(base64.b64decode(x))`).

## Connector-pending assumptions (revisit when it lands)
Designed against a connector that can: read per-person journey/campaign membership + per-send-node arrivals (the "would-send" set) with the person's `clientId`/phone + template + timestamp, over a queryable window; and read live campaign structure for Step 1. If the real connector differs, adapt the reconciler's "would-send" extraction accordingly.
