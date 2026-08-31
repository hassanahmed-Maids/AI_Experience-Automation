# The population query

Produces the `population[]` the flow scores. **Draft — column names are NOT verified**, and
that is stated rather than hidden: the Snowflake connector user has no warehouse granted, so
only metadata-path queries (`COUNT(*)`, `SHOW`) succeed and nothing that needs compute can be
run. See `ACCESS-REQUEST.md`.

What IS confirmed, from metadata:

| object | rows |
|---|---|
| `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | 619,056 |
| `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` | 98,702 |

Everything below — column names, join keys, the history view's name — comes from the spec's
own ERP Variables rows and must be checked against `SHOW COLUMNS` on the first run with a
warehouse. Do not treat it as verified because it is written down.

---

## Why the population is a warehouse read at all

Retiring `/accounting/visarequestexpense/advanceSearch/page` on 2026-08-20 — the endpoint
whose hammering disabled the ERP account in June 2026 — removed the only thing that produced
the list of request ids. Every population figure on the check page is Snowflake-derived.

This is **open ruling 7**, and it is load-bearing rather than a convention question: gate 13
runs on *every* entry-visa charge, rejected or not, which from ERP would be thousands of
ID-scoped calls at 2 s pacing. Not a slower run — an unrunnable one.

## What each side supplies

The split is not arbitrary. Each source is used for what it is actually reliable for.

| | supplies | why |
|---|---|---|
| **Warehouse** | charges, refunds, amounts, statuses, transaction ids **and dates**, owner ids | it has all of it, and cheaply |
| **ERP** | `taskHistorys` (the rejection history), `stopped`, `taskName`, `ownerId` | these are what the warehouse gets **wrong** |

The rejection history is the reason ERP is in the loop at all. It has **measured false
negatives** — request 114752 carries an Added refund between two identical charges and zero
`Rejected` rows. Of 14 same-request identical pairs the history called not-rejected, **5 had
a refund between them**: a 36% false-positive rate on the history test alone, and every one
would have become a false duplicate finding against a named person.

**Consequence for the call budget:** the spec's ~250 transaction-dating calls are a
*fallback*, not a per-run cost, because the warehouse already carries the dates. The run
cost is ~60 ID-scoped calls for the rejected requests. The flow records `clock_source` per
charge so a silent switch from warehouse to ERP dating is visible.

---

## The query

```sql
-- ENTRY VISA AUDIT — population.
-- Window is bounded by the CHARGE's transaction date, never by the expense line's own
-- paymentDate: that field is NULL on 85.7% of ENTRY_VSIA rows, and a rule clocked off it
-- drops six of every seven cases while the survivors still reconcile — so nothing looks
-- wrong.
WITH params AS (
  SELECT
    -- Never earlier than 2025-09-05. The rejection history carries no dated rejections
    -- before then, so an earlier window returns a SILENTLY EMPTY population that reads as
    -- a clean month. The flow refuses it too, but refusing twice is cheaper than not at all.
    DATE '2026-07-01' AS window_from,
    DATE '2026-07-31' AS window_to
),

-- Entry-visa CHARGES. Note ENTRY_VSIA — a TYPO in the live enum with 56,542 rows behind it.
-- Spelling it ENTRY_VISA returns zero rows and reads as a scoping decision, not a bug.
charges AS (
  SELECT e.*
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  WHERE e.PURPOSE IN ('ENTRY_VSIA', 'ENTRY_VISA_LESS_THAN_1000')
    AND e.REQUEST_TYPE = 'NewRequest'   -- RenewRequest is out of scope
),

-- Refunds, BOTH channels. 243 refunds hang off the CANCELLATION request; joining only on
-- the new-request id raises 243 findings against money we actually got back.
-- REFUND_MEDICAL_APPLICATION_FEES sits in the same table and belongs to a check whose
-- window is 90 days, not 60 — a contains('REFUND') filter pulls it in.
refunds AS (
  SELECT r.*,
         COALESCE(c.NEW_REQUEST_ID, r.VISA_REQUEST_ID) AS effective_request_id
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES r
  LEFT JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS c
         ON r.REQUEST_TYPE = 'CancelRequest'
        AND r.VISA_REQUEST_ID = c.ID
  WHERE r.PURPOSE = 'REFUND_FOR_ENTRY_VISA'
),

-- The rejection history, from the HISTORY table and never from today's status. Rejected is
-- transient: 694 requests were ever rejected while only 487 read Rejected today, and the
-- 30% a snapshot drops are precisely those that recovered after a rejection — which is
-- where a forgotten refund hides.
-- The enum was refactored in Oct 2024; = 'Rejected' is valid from 2024-10 forward ONLY.
rejections AS (
  SELECT h.REQUEST_ID, h.CHANGED_AT AS rejected_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
),

-- TWO SCOPES, and they are different populations.
--   refund family (gates 5-12, 14): charges on requests EVER rejected
--   duplicate family (gate 13):     EVERY entry-visa charge, rejected or not
-- Scoping gate 13 behind the rejection filter hid 134 of 176 duplicate-shaped pairs worth
-- AED 92,247.32, including the 62 cleanest. So the query returns BOTH and the scorer splits
-- them; it does not return only the rejected ones.
scoped_requests AS (
  SELECT DISTINCT ch.VISA_REQUEST_ID AS request_id
  FROM charges ch
  JOIN BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES t
    ON t.ID = ch.ID
  CROSS JOIN params p
  WHERE ch.TRANSACTION_DATE BETWEEN p.window_from AND p.window_to
)

SELECT
  r.ID                    AS "requestId",
  r.OWNER_ID              AS "ownerId",
  r.OWNER_TYPE            AS "ownerType",
  -- stopped / taskName are OVERWRITTEN by the ERP enrichment. They are selected here only
  -- so a warehouse-only run has something rather than nothing, and such a run is marked
  -- warehouse-only in the runs log so nobody mistakes it for an enriched one.
  NULL                    AS "stopped",
  NULL                    AS "taskName",
  -- everRejectedKnown FALSE on a warehouse-only run: the history is exactly the thing the
  -- warehouse gets wrong, so claiming to know it would be the false clearance this check
  -- exists to prevent. False sends every charge to gate 15 (pending), never to clean.
  FALSE                   AS "everRejectedKnown",
  NULL                    AS "identityAgrees",
  ARRAY_AGG(DISTINCT rj.rejected_at) WITHIN GROUP (ORDER BY rj.rejected_at) AS "rejectionDates",
  -- expenses[] and cancelSideRefunds[] are assembled as JSON so the flow receives the exact
  -- shape the scorer reads, with no reshaping step in between to get wrong.
  ...  -- OBJECT_CONSTRUCT per expense line; see the note below
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r
JOIN scoped_requests s ON s.request_id = r.ID
LEFT JOIN rejections rj ON rj.REQUEST_ID = r.ID
GROUP BY r.ID, r.OWNER_ID, r.OWNER_TYPE;
```

The `expenses[]` construction is left as `...` deliberately. It depends on the exact column
names, and writing a plausible-looking `OBJECT_CONSTRUCT` that has never been run would be
the same mistake as a spec row marked "verified" by a login that could not read the route.
Fill it in against `SHOW COLUMNS IN VIEW BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` on the
first run with a warehouse.

## The independent count

The completeness guard needs a count from a **different query**, not a `COUNT(*)` over the
same CTE — a short read would shorten both identically and the guard would pass.

```sql
SELECT COUNT(DISTINCT VISA_REQUEST_ID) AS n
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA', 'ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
  AND STATUS = 'Added'
  AND TRANSACTION_ID IS NOT NULL
  AND TRANSACTION_DATE BETWEEN :window_from AND :window_to;
```

Pass it as `expected_population_count`. Without it the flow still runs, but records a
**declared degradation** saying completeness could not be verified — never a silent skip.

## Ad hoc only

This check is manual-trigger. No recurring or scheduled Snowflake query is part of the
design; recurring data processes go to the ERP/Data team.
