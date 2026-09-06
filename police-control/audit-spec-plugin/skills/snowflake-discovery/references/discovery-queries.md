# Snowflake Discovery — Query Set

Copy-adapt these. Run one data point at a time and keep the output as spec evidence.
All read-only. Never wrap any of these in a schedule.

## 0. Connection and orientation

```sql
SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE();
```

```sql
SHOW DATABASES;
SHOW SCHEMAS IN DATABASE <DB>;
```

If the connector returns an invalidated-connection error, stop and ask the user to
reconnect the Snowflake connector. Do not proceed on assumptions.

## 1. Check for an approved KPI definition first

Do this **before** hunting raw tables — an approved definition ends the search.

```sql
SELECT *
FROM BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER
LIMIT 50;
```

```sql
-- Find an approved definition by keyword. Widen the column list to whatever
-- the container actually exposes (inspect it with the LIMIT 50 above first).
SELECT *
FROM BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER
WHERE LOWER(TO_VARCHAR(OBJECT_CONSTRUCT(*))) LIKE '%<keyword>%';
```

```sql
-- What else lives in the approved-views schema
SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT, LAST_ALTERED
FROM BA_VIEWS.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'CORE_SILVER'
ORDER BY TABLE_NAME;
```

If a definition exists, lift its query logic verbatim with every filter (e.g. `FAKE = false`).
If none exists, record in the spec: *"No approved definition exists for <metric>; this is a
new Police & Control definition and should be added to the Data Catalog."*

## 2. Find candidate tables by name

```sql
-- Table names containing a concept, across the whole account
SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT, LAST_ALTERED
FROM SNOWFLAKE.ACCOUNT_USAGE.TABLES
WHERE DELETED IS NULL
  AND TABLE_NAME ILIKE '%PAYROLL%'
ORDER BY LAST_ALTERED DESC
LIMIT 100;
```

```sql
-- Same, scoped to one database (works without ACCOUNT_USAGE access)
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT, LAST_ALTERED
FROM <DB>.INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME ILIKE '%INVOICE%'
ORDER BY LAST_ALTERED DESC;
```

## 3. Find candidate tables by column name

Often more effective than searching table names — you know the field you need.

```sql
SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM SNOWFLAKE.ACCOUNT_USAGE.COLUMNS
WHERE DELETED IS NULL
  AND COLUMN_NAME ILIKE '%SALARY%'
ORDER BY TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME
LIMIT 200;
```

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM <DB>.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME ILIKE '%CONTRACT_ID%'
ORDER BY TABLE_SCHEMA, TABLE_NAME;
```

## 4. Inspect the candidate's full column list and types

```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COMMENT
FROM <DB>.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = '<SCHEMA>' AND TABLE_NAME = '<TABLE>'
ORDER BY ORDINAL_POSITION;
```

Record `DATA_TYPE` for every column used as a join key or a filter. This one query prevents
the most common silent-zero-rows failure.

## 5. Liveness and freshness — is the source still being written?

```sql
SELECT COUNT(*) AS row_count,
       MIN(<ts_col>) AS earliest,
       MAX(<ts_col>) AS latest,
       DATEDIFF('day', MAX(<ts_col>), CURRENT_DATE()) AS days_stale
FROM <DB>.<SCHEMA>.<TABLE>;
```

A large row count with a stale `latest` means a dead source. Treat it as MISSING for any
current-period audit and say so.

```sql
-- Volume per month: reveals a source that quietly stopped, or a backfill gap
SELECT DATE_TRUNC('month', <ts_col>) AS month, COUNT(*) AS rows
FROM <DB>.<SCHEMA>.<TABLE>
GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
```

## 6. Coverage over the audit period specifically

```sql
SELECT COUNT(*) AS rows_in_period,
       COUNT(DISTINCT <entity_id>) AS distinct_entities
FROM <DB>.<SCHEMA>.<TABLE>
WHERE <ts_col> >= '<period_start>' AND <ts_col> < '<period_end>';
```

## 7. Grain check — is one row really one thing?

```sql
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT <candidate_key>) AS distinct_keys,
       COUNT(*) - COUNT(DISTINCT <candidate_key>) AS duplicate_rows
FROM <DB>.<SCHEMA>.<TABLE>;
```

```sql
-- See what a duplicate actually looks like before deciding how to dedupe
SELECT <candidate_key>, COUNT(*) AS n
FROM <DB>.<SCHEMA>.<TABLE>
GROUP BY 1 HAVING COUNT(*) > 1
ORDER BY n DESC LIMIT 20;
```

If duplicates are legitimate, the spec must state which row wins (earliest, latest, highest
amount, approved one) and re-check any ranking after deduplication.

## 8. Enum / status values and hygiene flags

```sql
SELECT <status_col>, COUNT(*) AS n
FROM <DB>.<SCHEMA>.<TABLE>
GROUP BY 1 ORDER BY n DESC;
```

Look for and ask about: test/fake/demo flags, soft-delete flags, cancelled and reversed
states, and any `IS_*` column — check whether it is TEXT rather than BOOLEAN before
filtering on it.

```sql
-- Detect the TEXT-pretending-to-be-boolean trap
SELECT <flag_col>, COUNT(*) FROM <DB>.<SCHEMA>.<TABLE> GROUP BY 1;
-- If this returns 'true'/'false'/'TRUE' strings, filter with = 'true', not = TRUE
```

## 9. Join viability between two candidate tables

```sql
SELECT
  (SELECT COUNT(*) FROM <A>)                              AS a_rows,
  (SELECT COUNT(*) FROM <B>)                              AS b_rows,
  (SELECT COUNT(*) FROM <A> a JOIN <B> b ON a.<k> = b.<k>) AS joined_rows;
```

If `joined_rows` is 0, suspect a type mismatch before suspecting the business. If
`joined_rows` exceeds `a_rows`, the join fans out — the grain is wrong.

```sql
-- Orphans on each side. For an audit these are usually exception rows,
-- not rows to drop.
SELECT COUNT(*) AS a_without_b
FROM <A> a LEFT JOIN <B> b ON a.<k> = b.<k>
WHERE b.<k> IS NULL;
```

## 10. Sample rows — with care

```sql
SELECT * FROM <DB>.<SCHEMA>.<TABLE> LIMIT 5;
```

Before pasting any sample into chat, a spec, or an artifact, check it for personal or
financial detail (phone numbers, contact details, salaries). If present, do not display it,
do not name the table in the deliverable, and describe the field abstractly instead. Use
masked or synthetic values in all examples and mockups.

## Recording the verdict

For each data point, capture: verdict, `DATABASE.SCHEMA.TABLE`, column, data type, row
count, latest timestamp, grain, and the query used. That set is what the spec's verified
data-points table is built from.
