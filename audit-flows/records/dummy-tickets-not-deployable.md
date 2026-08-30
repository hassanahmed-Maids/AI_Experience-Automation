# Dummy Tickets is NOT deployable — correcting an earlier readiness call (2026-08-30)

I said Dummy Tickets was the closest of the six to deployable, on the strength of n8n execution
statuses. That was wrong, and the error is worth naming: **n8n reported `success` for runs in which
the check read nothing and found nothing.**

## What execution 100502 (2026-08-24) actually did

Its own Run Summary row:

```
overall:                  incomplete
population_declared:      581      population_pulled: 581     (3 pages)
transactions_processed:   581
applicant_id_via_description_parse: 560
unique_applicants:        399
applicants_scored:        399
applicants_unreachable:   399      ← every one
findings: 0    clean: 0    pending: 399
tickets_seen:  0
exposure_total_aed: 0
```

Every case row carried `gate_reason: gate_20_identity_unresolved`,
`reason_code: applicant_id_unresolved`, `flags: unattributable`.

The population sweep works. **Nothing after it does.** The check has never seen a single ticket and
has therefore never produced a single finding.

## Why — recorded in the flow's own code

The ticket read lives in a sub-workflow, `YQlNlxrnhbQpBbdl` (*Dummy Tickets Housemaids · 0-Fetch
Tickets*), whose `Project Tickets` node says, verbatim:

> *"THE AUTH WALL IS THE ONE THAT ACTUALLY FIRED HERE, and it is why this node changed on
> 2026-08-24. Execution 100409 read 0 of 399 applicants: `Get Hustler Tickets` returned 401 on every
> call, the fan-out ran all 399 anyway with maxTries 2 (~800 requests), and the run then reported
> `overall: pass` with `applicants_unreachable: 399`. Three runs that day, ~2,400 requests to
> production ERP, not one of which could have succeeded."*

The endpoint is `GET /recruitment/maid-at-common/get-main-data/{applicantId}?tab=FLIGHT_TICKTE`.
The auth-wall breaker was added *because* of this, and now stops the run on the first chunk of 25
instead of firing ~800 refused calls.

## Two things the deploy draft got wrong, independent of the above

1. **It says "1 endpoint".** There are **two** ERP endpoints — the transactions sweep in the parent,
   and the recruitment ticket read in the sub-workflow — plus the sub-workflow itself, which the
   draft never mentions at all. A deployment that ships only the parent ships a check that cannot run.
2. **`YQlNlxrnhbQpBbdl` is `active: true`** — the sub-workflow is *published* while its parent is a
   draft. Whatever is decided about deployment, that asymmetry should be deliberate rather than
   inherited.

## What would make it deployable

One run in which `Get Hustler Tickets` returns 200 and `tickets_seen > 0`. Until a single ticket has
been read, there is nothing to deploy — the check's entire scoring half is unexercised, and no amount
of ticket-writing substitutes for that.

## The lesson, for the readiness gate

**An n8n `success` status is not evidence a check works.** Both flows here reported success while
reading nothing: this one, and the sibling that reported `overall: pass` with 399 unreachable. The
readiness gate should require a run with a non-zero scored population, not a green execution.
