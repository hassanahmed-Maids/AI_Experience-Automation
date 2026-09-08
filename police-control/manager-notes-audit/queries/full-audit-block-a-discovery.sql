-- =====================================================================================
-- BLOCK A — DISCOVERY. Run first, paste back. Every query is small.
-- Purpose: establish what the expanded grant actually exposes BEFORE writing T4/T5.
-- Rationale: this session lost a 364KB result to grouping by EXPENSE_ID on the belief it
-- was a category (it is the per-request id), and built a hypothesis on a formula that had
-- been transcribed without its cast. Schemas get read, not assumed.
-- =====================================================================================

-- A1. Is a warehouse attached now? (Was zero rows for PAYROLL_AND_MONEY_CONTROL_ROLE.)
SHOW WAREHOUSES;

-- A2. Every expense-related object now visible, account-wide.
SHOW TERSE OBJECTS LIKE '%EXPENSE%' IN ACCOUNT;

-- A3. The raw payroll manager-notes table — carries N1-N6 (APPLIED, PAID, PAYROLL_MONTH,
--     EXPENSE_ID, ADDITION_REASON_ID, PURPOSE_ID, CREATOR, CREATION_DATE, IS_REFUND).
--     If this is now visible, six outstanding ingestion asks collapse at once.
SHOW TERSE OBJECTS LIKE '%PAYROLLMANAGERNOTE%' IN ACCOUNT;

-- A4. Picklists — routing must be on (ADDITION_REASON_ID, PURPOSE_ID), never on the name.
SHOW TERSE OBJECTS LIKE '%PICKLIST%' IN ACCOUNT;

-- A5. Parameters (airfare caps, incentive amount_values) and the payroll lock window.
SHOW TERSE OBJECTS LIKE '%PARAMETER%' IN ACCOUNT;
SHOW TERSE OBJECTS LIKE '%MONTHLYPAYMENTRULE%' IN ACCOUNT;

-- A6. 🔴 Envers revision history (N23). Any object ending _AUD, plus the revision table.
SHOW TERSE OBJECTS LIKE '%\_AUD' IN ACCOUNT;
SHOW TERSE OBJECTS LIKE '%REVINFO%' IN ACCOUNT;

-- A7. The three still-missing sources, re-checked under the new grant.
SHOW TERSE OBJECTS LIKE '%RAFFLE%' IN ACCOUNT;
SHOW TERSE OBJECTS LIKE '%EXTRA_FIELD%' IN ACCOUNT;
SHOW TERSE OBJECTS LIKE '%LOAN%' IN ACCOUNT;

-- A8. Columns of every expense-ish object inside BA_VIEWS, in one pass. This is what T4
--     and T5 will actually be written against — the join key, the amount, the currency,
--     the authorisation state and the expense head.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME ILIKE '%EXPENSE%'
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;
