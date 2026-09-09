
# Audit Execution

> **Part of the P&C audit pipeline.** `audit-pipeline` carries the whole arc — discover → specify → execute → hand over — and the five rules that hold at every stage. Read it if you are not certain which stage this request belongs to; starting in the wrong one wastes the session.


The spec says what should be true. This skill is about finding out what *is* true, and it exists
because that turned out to be much harder than writing the spec.

**The evidence for why it exists.** In one full manager-notes audit, fourteen candidate findings were
raised and then withdrawn. Confirmed findings totalled ~AED 103,000; withdrawn claims totalled roughly
twenty times that. Not one withdrawal was a SQL error — the SQL was always correct. **Every one was a
measurement built on a field, flag, rate or population whose meaning had been assumed rather than
established.** Two would have been published as findings above AED 1.5m each.

The catalogue of those failures is `references/audit-execution--failure-catalogue.md`. Read it before writing a
measurement, not after.

## The two things that make this work different from analysis

**A wrong finding costs more than a missed one.** An audit spends credibility every time it publishes.
A number that gets retracted damages the next twenty that are correct. So the bias runs opposite to
normal analysis: **prefer a test that can only under-count.** A conservative floor is publishable; an
estimate that might be too high is not.

**A retraction is a deliverable, not an embarrassment.** When a finding collapses, the write-up of
*why* is often worth more than the finding would have been — it usually generalises. The single most
valuable output of that manager-notes audit was not a sum of money; it was *"current state is not
history"*, which applies to anything in the company reading a maid record to describe a past date.
Record retractions with the same care as findings, in the same document.

## Pre-flight

Answer these before writing any measurement. Each one corresponds to a real failure in
`references/audit-execution--failure-catalogue.md`.

| | Question | What it prevents |
|---|---|---|
| **P0** | **Is this even in scope?** Read the spec's exclusions first. | Three rounds spent perfecting a number the spec excludes |
| **P1a** | **Has this column appeared in a schema result, or a query that ran, in this session?** | Guessing a column that sounds like it should exist |
| **P1** | **What does this column actually contain?** Profile before joining. | A name that reads like a taxonomy holding a workflow state |
| **P2** | **Is this flag a permission or an obligation?** | Reporting grants as unrecovered debt |
| **P3** | **Is this number a threshold, a ceiling, or a target?** | Turning compliant payments into a finding |
| **P4** | **Does an approved KPI already exist?** Sweep the gold layer and the catalog first. | Reconstructing a sanctioned metric, badly |
| **P5** | **Is this a changing value?** Resolve it as of the event date. | Reporting a *different* set, not a smaller one |
| **P6** | **What is the chance rate?** Compute it before any ratio. | Publishing coincidence as corroboration |
| **P7** | **Can the numerator apply to every row in the denominator?** | A rate mixing two payment models |
| **P8** | **If this finds nothing, can I tell "clean" from "broken"?** | Zero matches reading as compliance |
| **P9** | **Is this a producer signature rather than behaviour?** | A batch job published as misconduct |

**P1a is the newest and the most mechanical.** A column enters a delivered query only if it appeared in
a schema result or a query that ran, *in this session*. Not from a spec, not from an ingestion ask, not
from memory. In one file three guessed columns shipped, two of which had already been corrected hours
earlier — recall stands in for lookup, and recall is confidently wrong precisely where a column sounds
like it ought to exist.

## Verdicts — six values, and four of them are not findings

A two-value model (finding / clean) is the main way an audit misleads, because it forces every
non-finding into "clean".

| Verdict | Means |
|---|---|
| **GREEN** | Every applicable test ran and passed |
| **RED** | A rule the code or the business states was broken |
| **CANDIDATE** | A real population, not yet a verdict — name what would settle it |
| **VOID** | The test could not score. **Not a pass** |
| **BLOCKED** | The input does not exist. **Not a pass** |
| **REPORTED** | True and material, but somebody else's sanctioned metric — join to it, don't claim it |

**GREEN never means audited.** It means every test that *could* run passed. Say so explicitly wherever
a green appears, or the reader will hear "verified".

## The loop

Work one payment type, control, or rule at a time. Each pass:

1. **Establish the schema.** List the columns of every table the test touches. This is one small
   query and it prevents the most common failure class.
2. **Check the gold layer and the KPI catalog** for the metric before building it (P4).
3. **Write the test with its own guard built in.** Every test carries at least one column that
   would expose it as broken — see `references/audit-execution--query-patterns.md`. The guard costs one column and
   has repeatedly been worth more than the test.
4. **Run it, then argue against the result.** Ask what would make this number wrong before asking
   what it means. If a large finding appears immediately, that is a reason for suspicion, not
   excitement: in the reference audit, *every* finding built on a proxy shrank when the real
   classifier arrived, and none grew.
5. **Adjudicate into one of the six verdicts.** If it is a CANDIDATE, write the specific query or
   input that would settle it.
6. **Record it — including retractions — before moving on.** A ledger written at the end reconstructs
   reasoning instead of reporting it.

### Proportionality

Match the number of tests to the money. Five payment types worth 3% of the total got six queries, not
thirty. **Write the stop down as a decision with its reason** — an unrecorded omission reads later as
an oversight, and the next person pays to rediscover it.

## Handing queries to a human runner

Where the analyst has no warehouse grant and a person runs the SQL:

- **Every query goes in the chat message itself**, as a complete copy-paste block. Never a file path,
  never "reuse the CTEs above". Assembly loses filters silently and the output still looks plausible.
- **Each block is self-contained and small enough to read.** A result that would run to thousands of
  rows means the query is the wrong shape, not that it needs a `LIMIT`.
- **Commit it to the repo as well**, but the chat is where it gets run from.
- **Say what you expect before it runs.** A stated expectation lets the result contradict you; an
  unstated one lets you rationalise whatever comes back.

## Personal and financial data

Audit populations are people. The analyst may read free text; **the audit never republishes it**.

- Report taxonomy, counts, dates and money — never names, phone numbers, salaries or note narrative.
- Classify *on* free text and return only the derived class plus totals, with the unmatched residual
  as a count. That way the residual is visible without being read.
- When exposure exceeds the value of the finding, **document the refusal** rather than quietly
  dropping the test.

## Reference files

- **`references/audit-execution--failure-catalogue.md`** — the fourteen worked failures, each with the query that got
  it wrong, what it returned, what it would have been published as, and the corrected number. Read
  this first; the pre-flight above is only its index.
- **`references/audit-execution--query-patterns.md`** — six reusable SQL shapes with their guards.
- **`references/audit-execution--snowflake-columns.md`** — verified schema for the maids.cc warehouse, and the columns
  that are known to lie about the past.
- **`assets/AUDIT-RUN.sql`** — the cross-cutting battery as one runnable statement, in the uniform
  verdict shape. Adapt rather than rewrite.

## Finishing

An execution session is complete when the ledger separates **money lost** from **control violated**,
every candidate names what would settle it, every retraction is written down with its cause, and the
coverage statement prices what was *not* examined — standing filters and window boundaries included.

In the reference audit, a filter every query carried (`NOTE_DATE <= CURRENT_DATE()`) hid AED 385,000
that had never been failed, passed, or examined, and nothing noticed until it was counted on purpose.
**Any filter repeated across every test defines a population nobody is looking at.**
