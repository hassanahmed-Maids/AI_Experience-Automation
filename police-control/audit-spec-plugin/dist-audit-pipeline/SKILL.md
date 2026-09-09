---
name: audit-pipeline
description: >
  The single entry point for any Police & Control (P&C) audit work at maids.cc — from a vague
  business worry through to a filed finding. Use this skill whenever someone wants to check that
  money moved correctly, control a payment type, verify a charge, build an auditing dashboard, or
  investigate a discrepancy — and use it EVEN WHEN THE REQUEST SOUNDS LIKE ONE SMALL STEP, because
  the most common failure in this work is doing the right thing at the wrong stage. Triggers on
  "audit X", "control X", "verify X financially", "did anyone get paid twice", "find the
  overpayments", "build an audit spec", "P&C dashboard", "reconciliation", "exception report",
  "is this a real finding", "give me the query for X", "run the audit", "file this with DNA", and
  on any request to design, run, adjudicate, or hand over a financial check. It routes to the
  specialised skills in this plugin rather than doing the work itself — read it first to find out
  which stage you are actually in.
metadata:
  version: "0.1.0"
  owner: "Police & Control"
---

# The P&C audit pipeline

> **Self-contained.** Everything the five specialised skills carried is bundled here under
> `references/`, so every pointer resolves inside this skill. Find your stage from the table below,
> then open **only** the reference you need — they are long on purpose and are not meant to be read
> together. `assets/AUDIT-RUN.sql` is the cross-cutting battery, runnable as one statement.


This skill is a router. It carries the arc, the rules that hold at every stage, and the signals that
tell you which stage you are in. **The work itself lives in the skills it points to** — go there once
you know where you are.

## The arc

```
business worry
   │
   ├─ 1  DISCOVER    does the data exist?          → snowflake-discovery
   │                 what does the ERP actually do? → ask-the-code
   │
   ├─ 2  SPECIFY     what should be true?           → audit-spec-builder
   │                 what does the report look like? → audit-report-ui
   │
   ├─ 3  EXECUTE     what IS true?                  → audit-execution
   │                 adjudicate · publish or retract
   │
   └─ 4  HAND OVER   spec + tickets to DNA          → audit-spec-builder (dna-handoff)
```

Stages 1–2 and 3 are not the same craft. Specification defects are errors of **design** — a clearance
that lets a record skip a test. Execution defects are errors of **measurement** — a column whose
meaning was assumed. A flawless spec protects against none of the second kind: in one full run,
**fourteen candidate findings were raised and withdrawn, none of them a SQL error**, two of which would
have been published above AED 1.5m each.

## Which stage am I in?

| What the person says | Stage | Go to |
|---|---|---|
| "we need to control X", "build a dashboard that audits X" | **specify** | `references/audit-spec-builder.md` |
| "does Snowflake have X?", "what tables hold X?" | **discover** | `references/snowflake-discovery.md` |
| "how does the ERP decide X?", "which job sends X?" | **discover** | `references/ask-the-code.md` |
| "what should the report look like?" | **specify** | `references/audit-report-ui.md` |
| "run it", "give me the query", "is this a finding?", "should we report this?" | **execute** | `references/audit-execution.md` |
| "file it", "hand it to DNA", "write the ticket" | **hand over** | `references/audit-spec-builder--dna-handoff.md` |

**When the request is ambiguous, ask which one it is rather than guessing.** "Check whether maids are
being overpaid for taxis" is a specification request if nobody has defined *overpaid*, and an
execution request if the rule already exists. Those two sessions produce completely different
artefacts, and starting in the wrong one wastes the session.

## The rules that hold at every stage

Five things are true whether you are writing a spec or adjudicating a result. Everything else is
stage-specific and lives in the skill for that stage.

**1 · Establish what this audit is designed to catch, before designing anything.** Every P&C report
exists to detect a discrepancy, leakage, unauthorised amount, missing charge, or broken control. If the
person has not said which, ask. A check without a failure mode in mind tests nothing in particular.

**2 · Never invent a table, column, or field name.** A name enters a spec or a query only when it came
from a schema result, from Ask the Code, or from the user. Anything else is labelled
`UNVERIFIED — to confirm`. In one session three guessed columns shipped, two of which had already been
corrected hours earlier: recall stands in for lookup, and recall is confidently wrong precisely where a
column *sounds* like it should exist.

**3 · Verdicts are six values, not two.** GREEN · RED · CANDIDATE · VOID · BLOCKED · REPORTED.
A two-value model forces every non-finding into "clean", so a test that could not run reads as a pass.
**VOID and BLOCKED are not GREEN**, and GREEN itself means *every applicable test ran and passed* — not
*audited*. Say that wherever a green appears, or the reader hears "verified".

**4 · A wrong finding costs more than a missed one.** An audit spends credibility every time it
publishes, and a retracted number damages the next twenty that are correct. So prefer the test that can
only under-count. A conservative floor is publishable; an estimate that might be too high is not.

**5 · A retraction is a deliverable.** When a finding collapses, *why* it collapsed usually generalises
further than the finding would have. The most valuable output of the reference audit was not a sum of
money — it was **"current state is not history"**, which applies to anything in the company reading a
record to describe a past date. Write retractions down with the same care as findings, in the same
document.

## What a finished piece of work looks like

Stages produce different things, and a session that produced discussion but none of these is
incomplete:

| Stage | Deliverable |
|---|---|
| discover | a written answer with its evidence, or an ingestion ask that names what is missing |
| specify | a spec the Snowflake team can build from unaided **and** a UI artifact with realistic data |
| execute | a ledger separating *money lost* from *control violated*, every candidate naming what would settle it, every retraction recorded with its cause, and a coverage statement that **prices what was not examined** |
| hand over | the ticket pack, with attachments current |

## People and data

Audit populations are people. The analyst may read free text; **the audit never republishes it.**
Report taxonomy, counts, dates and money — never names, phone numbers, salaries, or note narrative.
Where classifying on free text is the only route, return the derived class and totals only, with the
unmatched residual as a count. When exposure exceeds the value of the finding, **document the refusal**
rather than quietly dropping the test.

## The skills this routes to

| Skill | Read it for |
|---|---|
| `references/snowflake-discovery.md` | what exists in the warehouse; metadata-only technique when no grant exists; the ingestion ask |
| `references/ask-the-code.md` | interrogating the ERP; ⚠️ a module-scoped question that finds nothing is evidence about the **module**, never the ERP |
| `references/audit-spec-builder.md` | the spec pipeline, the eighteen spec defects, the DNA handoff |
| `references/audit-report-ui.md` | the report surface and its patterns |
| `references/audit-execution.md` | the pre-flight, fourteen worked failures with real numbers, six SQL patterns with their guards, the verdict model |
