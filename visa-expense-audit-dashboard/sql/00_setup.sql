-- =====================================================================================
-- Visa Expense Audit — 00 · setup
--
-- Creates the dashboard's own database/schema and the only two tables it ever WRITES.
-- Everything else in this build is a view over read-only BA_VIEWS sources.
--
-- DEPLOY NOTE: POLICE_CONTROL / VISA_AUDIT are placeholders. Substitute the real
-- target before running; the DNA team owns that naming. The reading role is the one
-- the specs' own discovery ran as (MONEY_CONTROL_ROLE, per the LAWP spec §2).
--
-- Refresh is MANUAL, ON DEMAND. There is deliberately no TASK, no STREAM and no
-- scheduled refresh anywhere in this build — every one of the six specs says so
-- independently, and a standing unattended Snowflake process is the ERP/Data team's
-- to own, not Police & Control's.
-- =====================================================================================

CREATE DATABASE IF NOT EXISTS POLICE_CONTROL;
CREATE SCHEMA   IF NOT EXISTS POLICE_CONTROL.VISA_AUDIT;

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


-- -------------------------------------------------------------------------------------
-- T_CASE_REVIEW — auditor workflow state.
--
-- This is the ONLY user-writable state in the dashboard. It is deliberately kept apart
-- from every computed column, because:
--
--   "Workflow status (New / Under review / Escalated / Closed) is a separate column and
--    MUST NOT feed any filter default that changes a metric."   — R-visa §3.2
--
-- Marking a case reviewed never changes its flag, its amount, or any tile.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS T_CASE_REVIEW (
    AUDIT_CODE      VARCHAR(32)   NOT NULL,   -- LAWP | ENTRY_VISA | MEDICAL | ILOE | RVISA | EID
    CASE_ID         VARCHAR(256)  NOT NULL,   -- the audit's own case key, as its spec defines it
    REVIEW_STATUS   VARCHAR(32)   NOT NULL DEFAULT 'New',  -- New | Under review | Escalated | Closed
    ASSIGNEE        VARCHAR(128),
    REVIEW_NOTE     VARCHAR(4000),            -- auditor's own words. Never a copy of ERP free text.
    OUTCOME         VARCHAR(64),              -- Claim filed | Loan raised | Written off | Not a finding | ...
    UPDATED_AT      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_BY      VARCHAR(128)  NOT NULL DEFAULT CURRENT_USER(),
    CONSTRAINT PK_CASE_REVIEW PRIMARY KEY (AUDIT_CODE, CASE_ID)
);


-- -------------------------------------------------------------------------------------
-- T_VERIFIER_VERDICT — one contract for every AI verifier in the programme.
--
-- Entry visa (§V1), medical (§7.5) and e-ID (§3.5) each specify a verifier, and all three
-- independently arrived at the SAME six verdicts with the same meanings. That convergence
-- is recognised here rather than re-implemented three times.
--
-- Rules carried from all three specs, and enforced by the CHECK constraints below:
--   * NOT_READ is a RUN STATE, not a verdict. It stays grey/red and is counted apart from
--     NOT_RELATED — otherwise the report cannot tell "read and unexplained" from
--     "never read", which is the whole distinction a verifier exists to create.
--   * A verdict with no quote and no SOURCE_ID is not a verdict — the case stays red.
--   * CATEGORY_ID must be NULL for NOT_RELATED, NO_TEXT and UNRESOLVED.
--   * THREADS_READ is checked against what was supplied; lower is rejected and re-run.
--   * The verdict is pinned to TEXT_SHA256 — the hash of the exact note/comment set read —
--     so a case can never move flag with no data change.
--   * REDACTED_QUOTE is the quote the MODEL redacted. Raw ERP note text is never stored.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS T_VERIFIER_VERDICT (
    AUDIT_CODE        VARCHAR(32)   NOT NULL,
    CASE_ID           VARCHAR(256)  NOT NULL,
    TEXT_SHA256       VARCHAR(64)   NOT NULL,  -- hash of the exact text set read
    VERDICT           VARCHAR(16)   NOT NULL,
    RUN_STATE         VARCHAR(16)   NOT NULL DEFAULT 'READ',   -- READ | NOT_READ
    CATEGORY_ID       NUMBER(4,0),
    CATEGORY_NAME     VARCHAR(256),
    SOURCE_TABLE      VARCHAR(64),
    SOURCE_ID         VARCHAR(256),
    REDACTED_QUOTE    VARCHAR(8000),           -- model-redacted ONLY. Never re-fetched raw text.
    REASONING         VARCHAR(2000),
    THREADS_SUPPLIED  NUMBER(9,0),
    THREADS_READ      NUMBER(9,0),
    MODEL             VARCHAR(128),
    CREATED_AT        TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_VERIFIER PRIMARY KEY (AUDIT_CODE, CASE_ID, TEXT_SHA256),
    CONSTRAINT CK_VERDICT CHECK (
        VERDICT IN ('JUSTIFIED','PLAUSIBLE','AMBIGUOUS','NOT_RELATED','UNRESOLVED','NO_TEXT')
    ),
    CONSTRAINT CK_RUN_STATE CHECK (RUN_STATE IN ('READ','NOT_READ')),
    CONSTRAINT CK_CATEGORY_NULL CHECK (
        VERDICT NOT IN ('NOT_RELATED','NO_TEXT','UNRESOLVED') OR CATEGORY_ID IS NULL
    ),
    CONSTRAINT CK_EVIDENCE CHECK (
        -- "A verdict with no quote and no source_id is not a verdict."
        RUN_STATE = 'NOT_READ' OR VERDICT = 'NO_TEXT'
        OR (SOURCE_ID IS NOT NULL AND REDACTED_QUOTE IS NOT NULL)
    )
);


-- -------------------------------------------------------------------------------------
-- The latest verdict per case — what every audit view LEFT JOINs.
-- A superseded verdict (an older TEXT_SHA256) is kept for audit trail, never displayed.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_VERIFIER_LATEST AS
SELECT
    AUDIT_CODE,
    CASE_ID,
    -- A short read was rejected and re-run; if it still stands, it is NOT_READ.
    CASE WHEN RUN_STATE = 'NOT_READ'
              OR (THREADS_SUPPLIED IS NOT NULL AND THREADS_READ < THREADS_SUPPLIED)
         THEN 'NOT_READ' ELSE VERDICT END          AS VERIFIER_VERDICT,
    CASE WHEN RUN_STATE = 'NOT_READ'
              OR (THREADS_SUPPLIED IS NOT NULL AND THREADS_READ < THREADS_SUPPLIED)
         THEN NULL ELSE CATEGORY_ID END            AS VERIFIER_CATEGORY_ID,
    CASE WHEN RUN_STATE = 'NOT_READ'
              OR (THREADS_SUPPLIED IS NOT NULL AND THREADS_READ < THREADS_SUPPLIED)
         THEN NULL ELSE CATEGORY_NAME END          AS VERIFIER_CATEGORY,
    SOURCE_TABLE,
    SOURCE_ID,
    REDACTED_QUOTE,
    REASONING,
    TEXT_SHA256,
    CREATED_AT                                     AS VERIFIED_AT
FROM T_VERIFIER_VERDICT
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY AUDIT_CODE, CASE_ID
    ORDER BY CREATED_AT DESC, TEXT_SHA256          -- explicit tie-break; never an implicit one
) = 1;


-- -------------------------------------------------------------------------------------
-- Grants. The P&C reader role sees everything and writes only review state.
-- -------------------------------------------------------------------------------------
-- GRANT USAGE ON DATABASE POLICE_CONTROL                    TO ROLE <P_AND_C_ROLE>;
-- GRANT USAGE ON SCHEMA POLICE_CONTROL.VISA_AUDIT           TO ROLE <P_AND_C_ROLE>;
-- GRANT SELECT ON ALL VIEWS IN SCHEMA POLICE_CONTROL.VISA_AUDIT  TO ROLE <P_AND_C_ROLE>;
-- GRANT SELECT ON FUTURE VIEWS IN SCHEMA POLICE_CONTROL.VISA_AUDIT TO ROLE <P_AND_C_ROLE>;
-- GRANT SELECT, INSERT, UPDATE ON TABLE T_CASE_REVIEW       TO ROLE <P_AND_C_ROLE>;
-- GRANT SELECT ON TABLE T_VERIFIER_VERDICT                  TO ROLE <P_AND_C_ROLE>;
