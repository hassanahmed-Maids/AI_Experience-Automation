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
