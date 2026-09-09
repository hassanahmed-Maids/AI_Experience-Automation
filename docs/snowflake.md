# Snowflake (analytics warehouse) — access & verified schema

Read-only warehouse `BA_VIEWS` with **silver** (cleaned source mirror) and **gold** (BI aggregates) layers — no bronze/raw. Used by the `snowflake-validator` stage to check the diagram's *theory* against real send data. Creds in `.env` (`SNOWFLAKE_*`, key-pair auth). All findings below verified 2026-07-04.

## Access

- Query via `scripts/sf_query.py "<SQL>" [rowlimit]` — key-pair auth, reads `.env`, prints TSV (first line = columns). Packages `snowflake-connector-python` + `cryptography` installed under `~/Library/Python`.
- **Reserved words**: `ROWS`, `ROW`, etc. must be aliased/quoted (`COUNT(*) AS n`, not `AS rows`).
- Numbers/phones are **SHA-256 hashed** everywhere (privacy). 64-char hex.

## Fact table — `BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER`

One row per send. Key columns: `RECEIVER_MOBILE_NUMBER` (hashed), `TEMPLATE_NAME`, `TEMPLATE_ID`, `SENT_DATE` (TIMESTAMP_NTZ), `SEND_INITIATED_DATE`, `RECEIVER_TYPE` (`Clients` / `Housemaids` / `Prospects` / `AE Clients` / `AE Housemaids` / …), `CONTRACT_TYPE` (`MaidVisa` / …), `TEMPLATE_TARGET`, `DELIVERY_STATUS`, `PRIMARY_CHANNEL`, `CAMPAIGN_NAME`. **Target-scoping (target/contract-type/receiver-type) is checkable directly on the fact row — no join needed.**

### Recipient pull + dedup (earliest per recipient+template)
```sql
WITH ranked AS (
  SELECT RECEIVER_MOBILE_NUMBER, TEMPLATE_NAME, SENT_DATE, RECEIVER_TYPE, CONTRACT_TYPE,
         ROW_NUMBER() OVER (PARTITION BY RECEIVER_MOBILE_NUMBER, TEMPLATE_NAME ORDER BY SENT_DATE ASC) rn
  FROM BA_VIEWS.BROADCASTING_GOLD.BROADCASTS_FINAL_LAYER
  WHERE TEMPLATE_NAME = :name AND SENT_DATE >= DATEADD(day,-7,CURRENT_TIMESTAMP()))
SELECT * FROM ranked WHERE rn = 1
```
`rn=1` keeps the oldest row per (phone, template) → the "first time ever in the window" dedup Moe specified (collapses the 15-min retry duplicates). **Window policy:** start 7 days; if `< ~20–30` distinct recipients, widen to 14 days max.

## Recipient → entity resolution (THE join key — critical gotcha)

⚠️ The `HASHED_NORMALIZED_MOBILE_NUMBER` / `HASHED_NORMALIZED_WHATSAPP_NUMBER` columns are **empty decoys** (NULL across all 416k rows). The **populated hash lives in `NORMALIZED_MOBILE_NUMBER` / `NORMALIZED_WHATSAPP_NUMBER`** (and `GOOGLE_FORMAT_*`) — those columns ARE the hash, not plaintext. `SHA2()` of anything does NOT reproduce the gold hash — join on the column, don't recompute.

**Clients** (`RECEIVER_TYPE` = Clients / MV clients / AE Clients):
```sql
gold.RECEIVER_MOBILE_NUMBER = BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENTS_LIVE.NORMALIZED_MOBILE_NUMBER
   -- fallback: = CLIENTS_LIVE.NORMALIZED_WHATSAPP_NUMBER
```
Verified ~98% match by mobile (3674/3734), ~90% by whatsapp; use mobile first, whatsapp as fallback. `CLIENTS_LIVE.ID` = client id, `PROSPECT_TYPE_ID` = CC/MV type. (`CLIENTS` = SCD/history variant; `CLIENTS_LIVE` = current.)

**Housemaids** (`RECEIVER_TYPE` = Housemaids): resolve against `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` on the same `NORMALIZED_MOBILE_NUMBER` pattern (verify the exact column at runtime).

**Alternative id path:** `BROADCASTING_SILVER.BROADCASTS` carries `ENTITY_ID` / `PROFILE_ID` per send — a non-hash id route if the phone join underperforms for a template. Cross-check when needed.

## Dimensions & point-in-time (history exists)

- Clients: `CLIENT_MANAGEMENT_SILVER.CLIENTS_LIVE` (current), `CLIENTS` (history). Gold: `CLIENT_MANAGEMENT_GOLD.BI_ACTIVE_CONTRACTS_PER_DAY`, `BI_CLIENTS_SCHEDULED_FOR_TERMINATION`, `BI_CLIENT_ATTRITION_LOGS`, etc.
- Maids: `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` (+ `_REVISION`), `HOUSEMAID_STATUS_LOGS`, `HOUSEMAID_TYPE_LOGS`, `HOUSEMAID_VACATIONS`, `FACT_MAID_TERMINATIONS`.

### Point-in-time reads — use the logs, not the Envers revision table (verified 2026-09-09)

`HOUSEMAID_STATUS_LOGS`, `HOUSEMAID_TYPE_LOGS` and the gold `BI_HOUSEMAID_STATUS_LOGS` /
`BI_HISTORICAL_STATUS_LOGS` are **interval tables**, not event tables — each row carries
`CHANGE_DATE` **and `NEXT_CHANGE_DATE`**. So an as-of read is plain interval containment and needs no
window function:

```sql
ON  l.HOUSEMAID_ID = n.HOUSEMAID_ID
AND n.note_day >= l.CHANGE_DATE::DATE
AND (l.NEXT_CHANGE_DATE IS NULL OR n.note_day < l.NEXT_CHANGE_DATE::DATE)
```

| Table | Columns | Use for |
|---|---|---|
| `HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID, FROM_STATUS, TO_STATUS, CHANGE_DATE, NEXT_CHANGE_DATE, PREVIOUS_CHANGE_DATE, DESCRIPTION, ERP_USER` | status as of any date |
| `HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID, FROM_TYPE, TO_TYPE, CHANGE_DATE, PREV_CHANGE_DATE, NEXT_CHANGE_DATE` | **N17 — the CC/MV contract-type timeline** |
| `BI_HOUSEMAID_STATUS_LOGS` | the above + `ERP_USER_NAME, HOUSEMAID_TYPE, MAID_NATIONALITY, EXCLUDED_NOSHOW_IN_ACCOMMODATION` | status with type/nationality attached |
| `FACT_MAID_TERMINATIONS` | `HOUSEMAID_ID, TERMINATION_DATE, TERMINATION_CATEGORY, LIVING_TYPE` | left-the-company date |

🔴 **`HOUSEMAIDS_INFO_REVISION` is the fallback, not the first choice.** It is an Envers audit table:
it records *that a row changed*, where these record *what the value became*, with the interval already
closed. Any point-in-time question should try a log first. The manager-notes audit built three as-of
findings on the revision table before noticing these existed — and they had been listed on the line
above since the file was written.

🟡 **Placement ("with a client") is not a column anywhere.** Two candidate routes, in order of
preference: a value inside the status vocabulary, or `CLIENT_MANAGEMENT_SILVER.REPLACEMENTS`
(`HOUSEMAID_ID, CLIENT_ID, CONTRACT_ID, TAGGING_DATE, UNTAGGING_DATE`) as a placement interval, with
`BED_ASSIGNMENTS` (`ASSIGNMENT_DATE, EXPIRY_DATE`) as its accommodation complement. Prefer the first —
a status value is one join; reconstructing placement from tag/untag events is a model, and a model can
be wrong.
- Contracts: `SALES_SILVER.CONTRACTS` + `CONTRACTS_HISTORY`, `CONTRACTS_PAYMENTS_TERMS`. Replacements: `CLIENT_MANAGEMENT_SILVER.REPLACMENETS_CLIENTS_MAIDS_MTS`, `CLIENT_REPLACEMENTS`.
- **Point-in-time:** for "did the recipient meet the condition *at send time*", prefer the `*_STATUS_LOGS` / `*_HISTORY` / `*_REVISION` tables (state as-of `SENT_DATE`). For recent (7-day) sends, current-state tables are a close proxy — state the approximation in the report.

## Discovering near-match tables at runtime

`INFORMATION_SCHEMA.TABLES` / `.COLUMNS` filtered by keyword (see the exploration queries used to build this doc). The naming is descriptive (UPPER_SNAKE, plural). When a drawn attribute has no obvious column, search columns by keyword across the maid/client/contract schemas and reason about near-matches — that's the "ask the database" step.
