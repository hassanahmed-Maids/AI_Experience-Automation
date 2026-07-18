# Phase 3 — Verifying the journey (fixtures → build QA → shadow reconciliation)

Verification has three layers. **Layer 0** is fixture tracing — the fast TDD inner
loop, run in the test env before anything is trusted (`references/tdd-fixtures.md`).
**Layer A** is build QA before the journey enters shadow mode (the go-live final-
check). **Layer B** is shadow-mode reconciliation — the real parity measurement that
drives cutover. All are grounded in the department docs; where this file summarises a
rule, the authoritative version lives in `docs/system3.md`, `docs/snowflake.md`, and
`docs/customerio-conventions.md` (load them as project knowledge).

> **Verify blind.** Whoever runs verification must NOT be the agent that built the
> campaign, and must NOT read the builder's transcript. Re-derive expected behaviour
> independently from the board + the run's data-model snapshot, write (or re-confirm)
> the acceptance-criteria table, and check the built campaign against *that*. A verifier
> that reads the build just rubber-stamps the build's mistakes (our boards self-reported
> "clean" while overlapping — twice). Confirm the campaign against coordinates/values,
> not vibes.

> **Draft-safe.** All sends stay `sending_state: "draft"` throughout verification. A
> drafted delivery is a would-send — it does **not** fire the ERP webhook. This is why
> shadow reconciliation can read `deliveries?drafts=true` without sending anything real.

## The accuracy definition (read first — it's the crux)

- **Source of truth is the DB (`mmdb`), NOT ERP.** ERP is fallible. Accuracy =
  how often CIO's decision is correct vs DB ground truth, not how often CIO
  matches ERP.
- **Unit = per template, rolled up to the cluster.** A cluster is cutover-ready
  when its templates reach **~80%**.
- Where CIO correctly diverges from an ERP mistake, that's a **CIO win**; log
  ERP mistakes separately and exclude them from CIO's score.

## Layer A — build QA (before shadow)

Confirm the built campaign matches the `cio-design.md` / board before it goes
into shadow mode. This is System 2's final-check / System 3 Step 1.

1. **Structure vs design.** Read the built campaign back from CIO and confirm
   trigger, every wait, every send (template + action name), branch conditions,
   and exits match the design. Reading actions is a 2-hop call — see "Reading a
   built campaign" below; branch conditions are base64-of-URL-encoded JSON.
2. **Trigger population.** The entry condition should select ~the ERP population.
   Count the ERP population in Snowflake (below) and compare to the CIO segment/
   entry count. Explain every material delta.
3. **Attribute VALUES, not just existence.** Per `customerio-conventions.md`:
   casing is *not* a concern (CIO string equality is case-insensitive), but
   **format, whitespace, enum-ordinal, and boolean-polarity mismatches DO break**
   a branch/wait-until. Confirm each branched value as it actually lands in CIO
   (query text or `mmdb`).
4. **Renders.** Each send renders for a sample profile — no raw `@param@`, no
   empty deep-links; channel is passthrough (don't treat it as a design axis).
5. **Every event / API / data-attribute the design needs is live and accurate**,
   cross-checked against the low-code (`scripts/ask-code.sh`) + `mmdb`.

GO here ⇒ the cluster may enter shadow mode.

## Layer B — shadow-mode reconciliation (the three checks)

In shadow mode CIO runs the whole flow but does not send; ERP still sends. Score
each template over a trailing ~14-day window, once it has ≥ ~20 would-sends
(widen the window for low-volume templates). Re-run after every fix.

1. **CIO → ERP:** for each CIO would-send, did ERP send the **same template to
   the same person on the same Dubai calendar day**?
2. **ERP → CIO:** for each ERP send, did CIO have a matching would-send?
3. **DB adjudication:** for every CIO≠ERP disagreement (plus a sample of
   agreements), re-derive from `mmdb` whether the person **should** have received
   it per the flow-spec conditions.
   - DB agrees with CIO → **CIO-correct** (if ERP diverged → **ERP-mistake**,
     logged + excluded).
   - DB disagrees with CIO → **CIO-bug** → emit a low-code-verified fix, fix in
     CIO, re-run.

Loop until each template clears ~80% ⇒ cutover-ready (CIO on, ERP off).

### Matching & data rules
- **Person match:** CIO `clientId` → client mobile → hash →
  `broadcasts_final_layer.RECEIVER_MOBILE_NUMBER = CLIENTS_LIVE.NORMALIZED_MOBILE_NUMBER`
  (~98%; whatsapp fallback). Unmatched recipients are a data-quality note, NOT an
  auto-miss.
- **Template match:** exact id/name (mind any `VisaServices / ` prefix).
- **Time match:** same Dubai calendar day.
- **Snowflake lag:** exclude the most-recent ~2h from "miss" calls; `sent_date`
  itself is trusted.

## Reading CIO would-sends (verified connector behaviour)

From `docs/system3.md` (verified 2026-07-14). Base is EU (`https://eu.fly.customer.io`).

- **Would-sends = drafted deliveries:**
  `GET /v1/environments/{env}/deliveries?campaign_id={id}&drafts=true&size=200`,
  paginate `meta.continuation` until empty. **Drafts cap at 20 rows/page**
  regardless of `size`; `page_all` times out over many draft pages — paginate
  manually. Each record has `customer_id`, `template_id`, `subject`
  (= the send-action name, a direct ERP-template label), `created` (unix),
  `state=drafted`, `action_id`.
- **Identity gotcha:** delivery `customer_id` is the **cio_id (hex), NOT
  `c_<clientId>`.** Resolve via `GET /customers/{cio_id}` →
  `.customer.attributes.id` = `c_<clientId>`. Person profiles are thin — adjudicate
  correctness from `mmdb` / `CLIENTS_LIVE` by clientId, not from the CIO profile.
- **template_id → ERP name & branch logic:** inline `campaign.actions` is null.
  `GET /campaigns/{id}` → `.campaign.version`, then
  `GET /campaigns/{id}/versions/{version}` → `.actions[]`; pair each
  `webhook_action` `name` ↔ its `template` (= template_id). Branch conditions are
  in `conditional_branch_action.conditions` as **base64 of URL-encoded JSON**
  (`urllib.parse.unquote(base64.b64decode(x))`).

## Snowflake (verified schema — `docs/snowflake.md`)

Run queries with `python3 scripts/sf_query.py "<SQL>" [rowlimit]` (key-pair auth,
reads `.env`, prints TSV). Read-only warehouse `BA_VIEWS`, silver + gold layers.
Numbers/phones are SHA-256 hashed everywhere.

**Fact table (one row per send):** `BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER`.
Key columns: `RECEIVER_MOBILE_NUMBER` (hashed), `TEMPLATE_NAME`, `TEMPLATE_ID`,
`SENT_DATE`, `SEND_INITIATED_DATE`, `RECEIVER_TYPE` (Clients/Housemaids/…),
`CONTRACT_TYPE` (MaidVisa/Both/blank/…), `TEMPLATE_TARGET`, `DELIVERY_STATUS`,
`PRIMARY_CHANNEL`, `CAMPAIGN_NAME`. Target-scoping is checkable on the fact row —
no join needed.

> ⚠️ **Join-key gotcha:** `HASHED_NORMALIZED_MOBILE_NUMBER` /
> `HASHED_NORMALIZED_WHATSAPP_NUMBER` are **empty decoys** (NULL everywhere). The
> populated hash lives in `NORMALIZED_MOBILE_NUMBER` / `NORMALIZED_WHATSAPP_NUMBER`.
> `SHA2()` does NOT reproduce the gold hash — **join on the column, never recompute.**

**Send volume for the board's "Sends last 45d" anchor:**
```sql
SELECT TEMPLATE_ID, TEMPLATE_NAME,
       COUNT(*)                              AS sends_45d,
       COUNT(DISTINCT RECEIVER_MOBILE_NUMBER) AS recipients
FROM BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER
WHERE SENT_DATE >= DATEADD(day,-45,CURRENT_TIMESTAMP())
  AND TEMPLATE_ID IN (/* ids from the spec */)
GROUP BY 1,2 ORDER BY sends_45d DESC;
```

**Recipient pull + dedup (earliest per recipient+template; 7d → widen to 14d):**
```sql
WITH ranked AS (
  SELECT RECEIVER_MOBILE_NUMBER, TEMPLATE_NAME, SENT_DATE, RECEIVER_TYPE, CONTRACT_TYPE,
         ROW_NUMBER() OVER (PARTITION BY RECEIVER_MOBILE_NUMBER, TEMPLATE_NAME
                            ORDER BY SENT_DATE ASC) rn
  FROM BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER
  WHERE TEMPLATE_NAME = :name
    AND SENT_DATE >= DATEADD(day,-7,CURRENT_TIMESTAMP()))
SELECT * FROM ranked WHERE rn = 1;
```

**Target-scope sanity (the double-send / dropped-recipient check):** inspect the
`CONTRACT_TYPE` mix for a template — a large `Both`/`blank` share means a blanket
`contract.type='MV'` filter would drop real recipients (see the scoping CAUTION
in `building-cio.md`).
```sql
SELECT CONTRACT_TYPE, RECEIVER_TYPE, COUNT(*) AS n
FROM BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER
WHERE TEMPLATE_ID IN (/* ids */)
  AND SENT_DATE >= DATEADD(day,-45,CURRENT_TIMESTAMP())
GROUP BY 1,2 ORDER BY n DESC;
```

**Client resolution:** `RECEIVER_MOBILE_NUMBER = CLIENT_MANAGEMENT_SILVER.CLIENTS_LIVE.NORMALIZED_MOBILE_NUMBER`
(whatsapp fallback). `CLIENTS_LIVE.ID` = client id, `PROSPECT_TYPE_ID` = CC/MV
(CC=1650, MV=1726). Maids resolve against
`HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO`. Alt id path:
`BROADCASTING_SILVER.BROADCASTS.ENTITY_ID/PROFILE_ID`.

**Point-in-time:** for "did the recipient meet the condition *at send time*",
prefer `*_STATUS_LOGS` / `*_HISTORY` / `*_REVISION` (state as-of `SENT_DATE`).
For recent (7-day) sends, current-state tables are a close proxy — state the
approximation.

## Sign-off & output

Write `work/<target>/<cluster>/system3/reconciliation-<date>.md`: per-template
accuracy + cluster roll-up + cutover verdict, the CIO-bug list (each with a
low-code-verified fix), the ERP-mistake log (separate/excluded), data-quality
notes, and iteration tracking. The journey is cutover-ready only when every
template clears ~80% and every open uncertainty is resolved.
