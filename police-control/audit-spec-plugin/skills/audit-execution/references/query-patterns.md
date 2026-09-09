# Query patterns

Six shapes, every one lifted from a query that ran, each annotated with what it caught.
The guard column in P-1 is not optional: it is the only reason a AED 137,500 claim was checked
before publication rather than after.

---


Six shapes. Every one is lifted from a query that ran, and each is annotated with what it caught.
Full files in `queries/`; `AUDIT-RUN.sql` is the whole cross-cutting battery as one statement.

### P-1 · The as-of read, with its diagnostic

The status and type logs are **interval tables** — `CHANGE_DATE` *and* `NEXT_CHANGE_DATE` — so this is
plain containment. No window function, no approximation.

```sql
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
       ON t.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND n.note_day >= t.CHANGE_DATE::DATE
      AND (t.NEXT_CHANGE_DATE IS NULL OR n.note_day < t.NEXT_CHANGE_DATE::DATE)
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY t.CHANGE_DATE DESC) = 1
```

**Always with this column beside the result:**

```sql
COUNT_IF(t.NEXT_CHANGE_DATE IS NOT NULL) AS resolved_to_a_PAST_interval
```

*Caught:* airfare MV read 76 notes / AED 137,500 with **1 of 76** resolving to a past interval — the
signature of a point read in costume. The real figure was **AED 4,500**.

### P-2 · The chance baseline, summed per note

```sql
ROUND(SUM(1 - POWER(1 - 38.0/211, k_window)), 1)                     AS chance_expected,
ROUND(COUNT_IF(in_band > 0) / NULLIF(SUM(1 - POWER(1 - 38.0/211, k_window)), 0), 2) AS TIMES_CHANCE
```

Per note, with each note's own `k`. Averaging `k` first and applying the formula once biases the
baseline (Jensen).

*Caught:* Salary Dispute corroboration read **90.8%** and scored **1.08× chance**. Both framings of the
raw number — "90.8% corroborated" and "9.2% uncorroborated, AED 31,200" — were wrong.

### P-3 · One verdict per note, before any total

```sql
QUALIFY ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY severity_rank) = 1
```

*Caught:* O6/O7 would have overstated by **58%**; O12 found the two bonus findings overlap by 3 notes.

### P-4 · The base-rate guard on a flag

Before treating any marker as evidence, ask what its holders actually look like:

```sql
WITH holders AS (
    SELECT ID AS maid_id FROM ...HOUSEMAIDS_INFO
    WHERE ASSIGNED_OFFICE_WORK_REASON_ID IS NOT NULL
), now_status AS (
    SELECT HOUSEMAID_ID, TO_STATUS FROM ...HOUSEMAID_STATUS_LOGS
    WHERE NEXT_CHANGE_DATE IS NULL
)
SELECT n.TO_STATUS, COUNT(*), ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),1) AS pct
FROM holders h LEFT JOIN now_status n ON n.HOUSEMAID_ID = h.maid_id
GROUP BY 1 ORDER BY 2 DESC;
```

*Caught:* **57.4%** of office-work-reason holders are `EMPLOYEMENT_TERMINATED` and **0.8%** are in
office-work status. The flag is a never-cleared marker; a clear built on it was void.

### P-5 · A positive control inside an absence test

Carry a population **known to show the presence**. If it comes back empty too, the test is **void, not
negative**.

*Caught:* the loan-recovery test found nothing — and its control (65 relocation notes that *do* book a
loan) also found nothing, proving deduction notes are the wrong table. Without it, "AED 30,220 never
recovered" would have been published. ⚠️ **Use two controls chosen to differ:** a single control
*passed* on the loan-field test, on the one head where the two fields coincide, and bought a full round
of false confidence in a measure wrong everywhere else by an order of magnitude.

### P-6 · What the standing filter hides

Every test carries `NOTE_DATE <= CURRENT_DATE()`. Price that exclusion once, per type:

```sql
SELECT CASE WHEN NOTE_DATE > CURRENT_DATE() THEN 'FUTURE-dated'
            WHEN NOTE_DATE < DATEADD('month',-12,CURRENT_DATE()) THEN 'older than the window'
            ELSE 'inside the window' END AS dating,
       COUNT(*), ROUND(SUM(AMOUNT)), MIN(NOTE_DATE)::DATE, MAX(NOTE_DATE)::DATE
FROM ...HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE='ADDITION' AND REASON = :type AND AMOUNT > 0
GROUP BY 1;
```

*Caught:* **216 airfare notes / AED 385,000** dated to 2028, excluded from every test in the audit and
absent from the coverage ledger. And **70% of all bonus money ever paid** — AED 1,992,552 — sits older
than the window.

---

