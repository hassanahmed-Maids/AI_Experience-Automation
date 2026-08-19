# Handover — Dummy Tickets Submitted for Refund (Housemaids)

**Published as an artifact:** https://claude.ai/code/artifact/59fb6ac0-b628-48e3-ad69-e1edcd024575
Local copy: `HANDOVER.html`. Full evidence and correction log: `SPEC-FINDINGS.md`.

Prepared per the *Build the n8n Flow — Prompt* handover checklist in the Audit Flow Factory.

| | |
|---|---|
| check_id | `7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02` |
| Spec version | 0.4 draft (2026-08-17) |
| Scoring flow | `aTmGMAlYLwsJQ7js` — published, `activeVersionId 59fb0485` |
| Enrichment sub-flow | `YQlNlxrnhbQpBbdl` — published |
| Flow replaced | `FXrhGBJUnGYgrs9R` — unpublished |
| Golden | CC Non Received Monthly Payments `Qq473Ygj543jxPUN` |
| Offline suite | 67/67, mutation-tested |
| ERP variable rows | 17, all Confirmed/Verified, **0 Pending Technical** |
| Workbook | `172R3JzxXm1nf6Vc3qTesin7eys-jT0ng3SOxUsf3LD8` |

## Checklist coverage

| Handover requirement | Status |
|---|---|
| Deterministic gates run offline against every row of the five test cases, states shown | done — 5/5 match |
| A verified finding that still reproduces live | done — applicant 1508067 / ticket 4261989, read live 2026-08-19 |
| Population pulled live, count reported | done — 137/137 (May), 1197/1197 (June) |
| Reconciled against an independent source | May: delta 0 vs the production run the spec records. **June: no second source exists — declared** |
| Cohort pulled both ways, both counts recorded | done — size 200 → 1 page, size 40 → 4 pages, both `totalElements 137` |
| Nodes differing from the golden listed | done, with the honest caveat below |
| Every field changed in the cohort request, with row counts | done |
| `Pending Technical` variable rows listed | none exist |
| Sensitive data kept out of cases, summaries, portal | done — no names, passports or card-holder names anywhere; passports stripped before the model |
| Delivered as a draft, never published | **deviation — published at owner instruction** |

## Four deviations from the documented procedure

1. **Not a literal clone.** `Validate Inputs` is the golden's verbatim, but pagination, the callback
   nodes, the error rail, verdict merging and the agent wiring were re-implemented rather than cloned,
   because ~1,200 transactions / 605 applicants per month cannot be enriched in one execution. The
   procedure says to stop and say so rather than improvise a skeleton change. Carries exactly the
   regression risk the cloning rule prevents — needs a decision on whether the chunked-enrichment
   shape folds back into the shared golden.
2. **Published, not a draft** — at explicit owner instruction.
3. **Workbook added** though the spec's delivery answers leave Workbook unticked.
4. **Golden used was CC Non Received**, per the owner, rather than the Travel Assist flow the prompt
   names — CC Non Received is itself a Travel Assist clone.

## What still needs a human

1. **Re-verify on the operator's own ERP identity.** Every measurement was taken on a token belonging
   to another user, at owner instruction. Nothing should be marked `Technical Validated` until re-run
   under the identity that will own the findings. Set the n8n variable `ERP_BEARER`.
2. **Repoint the portal.** Publishing did not cut over; the old flow is unpublished, so the check is
   offline for the portal until repointed.
3. **Sign-off** before findings reach reviewers. `Test cases verified`, `Business Validated` and
   `Technical Validated` are all still unticked.

Lower stakes: the repeat-booking threshold deserves a second look against the month-scale number
(281 booking reviews against 7 findings).
