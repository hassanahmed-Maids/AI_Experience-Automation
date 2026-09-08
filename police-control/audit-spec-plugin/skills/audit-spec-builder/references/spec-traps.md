# The traps that make a spec wrong

Every entry here cost real rework on a real spec. They are ordered by how expensive they are to
miss. A spec that has not been read against this list is not finished.

---

## 1. The clearance defect — the one that keeps coming back

**Shape:** something is marked as blocked on the screen while the underlying numbers still count
those notes as clean. A guard that changes no number. Or a clearance that lets a record skip a test
that could not run.

It recurred through six review rounds of one spec, fixed in one group and left live in another each
time. Treat it as the primary risk of any audit build, not a footnote.

**The construction that prevents it.** Let `A` be the tests that apply to a record.

```
RED    <= any test in A returned RED          (one is enough)
AMBER  <= not RED, and any test in A BLOCKED
GREEN  <=> every test in A RAN and returned GREEN
```

A finding is evidence; a clearance is only the absence of one. One red outweighs any number of
greens; one blocked outweighs any number of greens.

Then four rules that make it hold in practice:

- **No early exit.** "The first test that fires decides the outcome" is incompatible with the
  algebra above: a test that *cannot* run does not fire, so the record falls through and can reach
  green with an applicable test silently unrun. Evaluate every applicable test, record all outcomes
  in a trace column, and use the ladder only as *display precedence for the reason*.
- **Every test returns one of four things** — `RED(type)` / `GREEN` / `BLOCKED(reason)` /
  `NOT_APPLICABLE`. A test table with only a "fires → RED" column cannot express blocking, and any
  spec whose verdict algebra mentions BLOCKED while its test table does not is describing two
  different engines.
- **One verdict column, computed once.** Every tile, chart, filter, row colour and export column
  aggregates it. Nothing anywhere re-derives eligibility. If a number and a pill can disagree, the
  build is wrong by construction.
- **No fourth state.** A "reported" or "informational" outcome that is neither red, amber nor green
  belongs to no metric: it renders as a colour on screen and is countable nowhere, and the tie-outs
  silently stop summing. Map it into one of the three and carry the nuance in a label column.

## 2. Assertions that cannot fail

An assertion like *"count displayed as blocked = count counted as blocked"* is a **tautology** when
both sides read the same verdict column — which the single-verdict rule mandates. It passes in
exactly the failure mode it was written to catch.

**Test the join between two representations, not one representation against itself.** The real
assertions are: every amber record has a non-null blocking reason; the reason buckets sum to the
amber total in both count and money; every verdict word rendered anywhere is one of the three.

## 3. A scope filter that silently deletes the records a test exists to flag

A population filter written as `WHERE profile.IS_DELETED <> '01'` evaluates on the *joined* row. A
missing profile and a NULL flag both make it UNKNOWN, so those records vanish from every count,
every total, every reason breakdown and every tie-out — while the tie-outs still balance perfectly
on the survivors. Nothing on the report says they existed. **That is worse than counting them as
clean.**

**Rule: scope is defined by the audited record alone.** The state of anything it joins to is a
*test outcome*, never a population filter. Join outward with LEFT JOIN and let a missing row be
amber.

## 4. A flag that does not mean what its name says

`PAID = true` did not mean "was paid". The ERP wrote it only for carried-forward *must-be-paid*
records; for the majority it wrote nothing at all. Scoping the population on it would have dropped
most of the population and reported the month clean.

**Never take a boolean's meaning from its name.** Ask the code which write paths set it, and under
what conditions. A flag that is written by one code path out of five is a category marker, not a
state.

## 5. An enum that is longer in the code than in the warehouse

The warehouse profiled three values for a type column; the ERP enum had seven. Two of the extra four
would have been in scope had they been live.

**Get enum membership from the source, and make the surplus a run guard** — assert the count of
out-of-scope values is zero, rather than assuming it.

## 6. Two different things sharing one code

Referral and signing bonuses shared one reason code and were separated only by a second field.
Routing on the code alone applies each rule to the other's records; routing on the resolved *name*
is worse, because a rename silently re-routes everything.

**Route on ids, never on display names, and check whether one id covers two business meanings.**

## 7. "No record found" when the view has a hidden exclusion

A curated view excluded an entire category of source rows (`is_secure = 1`) via an INNER JOIN. A
record backed by an excluded row is indistinguishable from a record backed by nothing — so
"no authorising record exists" cannot be concluded from that view alone.

**Read the view's own filter before trusting an absence.** Where an absence can be caused by the
view, absence must be amber, and the *match rate* becomes a published metric with a floor rather
than each row being judged alone.

## 8. Reference lists that gate a verdict but exist nowhere

Three mappings gated red/green outcomes and appeared as no data point, no ingestion item, no open
item. Two silent failure modes: an empty list reds everything, a permissive default greens
everything.

**Any list that decides a verdict is a named data point with an owner.** A value absent from it
makes that test BLOCKED — never a pass, never a red.

## 9. Matching without a key

Where no foreign key exists, a match is a heuristic and must be written out in full: candidate
predicate, tie-break, and what happens on multiple candidates. **Never resolve to the first
candidate** — on one real dataset 89% of matched records had more than one candidate, and the
upstream model that took "the most recent" put a large fraction of rows on the wrong side of a
split.

Publish the match rate **per category, per period**, with a floor below which "no record" cannot be
called a finding. **A low match rate means unverified, never clean.**

## 10. A tie-out that fails structurally

Comparing a *filtered* population against an *unfiltered* control total produces a residual every
period that is definitional rather than a finding. A tie-out that always fails is noise an operator
learns to ignore — and it was the only test in the design that could see a missing record.

**Both sides of a tie-out carry the same filters**, and scope exclusions are reconciled as named,
quantified lines rather than left in the residual.

## 11. Duplicate detection that only sees one period

If the population is one month and the duplicate test compares "to another record", two identical
records astride a month boundary are never compared and both go green.

**State the scan population explicitly** — the longest entitlement window of any category, not the
reporting period — and return BLOCKED when the window extends outside loaded history. Group
duplicates rather than pairing them, and nominate one representative so a group of three does not
contribute its amount three times.

## 12. Inheriting the filter of the system you are auditing

The ERP's own auditor queried only records where its confirmation flag was false. Once a human
confirmed a case it left that list **while the payment stayed over the limit**. An independent check
that inherited the filter would go blind on exactly the population it exists to see.

**An internal sign-off is displayed as context and never clears a case.** Make it a run guard: zero
occurrences of the confirmation flag in any filter or test.

## 13. A sensitivity guarantee the report contradicts

A spec asserted "no salary appears anywhere" while specifying a payment type whose amount *is* a
salary figure, and named the salary-bearing table in its own provenance line. Staff names are
personal data too — an approver column populated with names, exported row-level, attached to cases
framed as wrongdoing.

**Re-read the sensitivity paragraph against the actual column list** before shipping, and cover
staff as well as subjects.

## 14. Dead columns and epoch dates

Columns that profile as entirely NULL (a manager id, a lock date, an EID) will be reached for by
someone. Dates that bottom out at `1970-01-01` are "unknown" wearing a date, and length-of-service
arithmetic on them returns a confident wrong answer.

**List dead columns explicitly as dead**, and make epoch-zero a blocking condition rather than an
input.

## 15. Type traps that return zero rows instead of an error

TEXT flags that look boolean (`'00'`/`'01'`, `'YES'`/`'NO'`), empty-string sentinels where NULL is
expected, TEXT parameters compared to numbers, TIMESTAMP columns with no stated timezone near a
period boundary. Each returns a wrong answer silently, and **zero rows reads exactly like "no
findings"**.

Carry a trap table in the spec, one row per trap, each stating the consequence if ignored.

## 16. A row-per-evidence export where the check needs a score

A check that weighs several pieces of evidence against one record — every complaint on this maid,
every expense near this note, every log line around this event — is naturally written as a join, and
a join returns **one row per (record × evidence)**. The moment the evidence is dense, that export
explodes: a corroboration queue over two payment types and three months returned 32,247 rows for
~2,570 notes, because the maids averaged ~12.5 complaints in the window. The header still said
"one row per note".

**The instinct is to add a `LIMIT`, and it is always wrong here.** Truncating cuts one record's
evidence list mid-way, and the consumer — a human reviewer or an agent — cannot see that it was cut.
It returns *"no corroborating evidence"* for records whose evidence simply fell below the line. That
is the clearance defect (#1) arriving through the export instead of the logic: a test that could not
see its inputs reported as a test that passed.

The fix is not a smaller export, it is a different shape. **If the verdict is a function of the
evidence set, compute it where the evidence lives.** Type-match, timing and per-record normalisation
are all aggregates; they collapse to one row per record when scored in the warehouse, and to 32k rows
when scored outside it. Split the query by what each output is actually for:

| | Grain | Free text | For |
|---|---|---|---|
| **distribution** | one row per band | no | sets thresholds; tells you whether the queue is worth building at all |
| **queue** | one row per record, capped and ranked | no | the work list — ids, dates, amounts, scores |
| **detail** | one record, by id | yes | the only place free text appears |

Two things follow. **Pick the winner explicitly**: collapsing with `QUALIFY ROW_NUMBER()` forces you
to *state* which piece of evidence represents the record (nearest in time? strongest type match?),
which is trap #9 — matching without a key needs stated behaviour at >1 — answered rather than
skipped. And **the split is the privacy boundary**: the wide, movable outputs carry no personal text,
so the one output that does can be scoped to a single record and kept inside the warehouse session.
Run the distribution first — it is small enough to read in full, and it will often tell you the queue
should not exist in the shape you planned.

## 17. A window-based association test with no chance baseline

Any check of the form *"is there a related record within N days"* has a built-in hit rate that owes
nothing to the business. If the lookup window spans W days and "close enough" covers C of them, one
related record lands inside C by geometry alone with p = C/W, and a subject with *k* related records
does so at 1 − (1 − p)^k. **Report the raw percentage and you are reporting the window's shape.**

Worked: a 105-day window with a 30-day proximity band gives p = 0.286. At k = 1.7, chance alone
produces a 40% hit rate. An observed 40% is therefore **zero** signal — but it reads as "40% of
payments are corroborated" on a dashboard, and nobody asks what 0% would have looked like.

Three requirements follow.

**State the chance rate next to every observed rate**, computed per subject from that subject's own
*k*, not from a cohort average. Cohort *k* is a Jensen trap: the average of 1 − (1 − p)^k is not
1 − (1 − p)^avg(k), and estimating *k* rather than measuring it produced errors of 1.46× vs 2.33×
in a real case — wrong enough to misrank two payment types against each other.

**Carry a null cohort where one exists.** A population selected by a mechanism known to be unrelated
to the thing being tested — a random draw, a lottery, a scheduled batch — is a free control group,
and it validates the window empirically rather than by arithmetic.

**Check the shape, not just the count.** Bin the related records by signed distance and normalise
per day, because edge bins are not full width. A causal driver spikes in the nearest bin and decays
monotonically. Two failure shapes to recognise: **flat** means the window is talking to itself, and
**a peak in a bin that is not the nearest one** means a cycle is beating against another cycle — a
real driver does not sit further from the event than the bin beside it.

One consequence for aggregation. A per-record view and a per-subject view can disagree honestly: a
mild near-window enrichment concentrated on high-*k* subjects raises the per-record rate while
leaving the per-subject rate exactly at chance, because for those subjects the nearest record was
already going to be close. **The verdict grain is the subject, so the subject-level rate is the one
that decides** — the per-record rate will overstate it. Normalise per subject before reading either.
