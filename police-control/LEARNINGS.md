# What the Manager Notes spec taught us

Written 2026-09-06, after specifying the Police & Control Manager Notes audit end to end
(business brief → catalogue discovery → ERP code verification → spec → mockup → DNA tickets).

Everything below is now **enforced in the plugin**, not just recorded here. The plugin source
lives at `police-control/audit-spec-plugin/` and is packaged as
`police-control/audit-spec-plugin.plugin` (v0.2.0). Install that and future specs inherit these
rules; this file is the reasoning behind them.

## Where each learning lives

| Learning | Enforced in |
| --- | --- |
| The 15 defects that cost rework | `skills/audit-spec-builder/references/spec-traps.md` (new) |
| How to hand a spec to DNA | `skills/audit-spec-builder/references/dna-handoff.md` (new) |
| Two operating principles + Step 7 handoff stage | `skills/audit-spec-builder/SKILL.md` |
| Metadata-only discovery without a warehouse grant | `skills/snowflake-discovery/SKILL.md` |
| 20 audit checks, trap-catalogue first | `agents/spec-auditor.md` |

## The five that mattered most

**1. A clearance is not a finding's opposite.** This defect recurred through six review rounds
of the business brief and is now check #1 of the auditor. A test that could not run is not a
test that passed. The algebra the plugin now requires:

```
RED    ⟸ any applicable test returned RED
AMBER  ⟸ any applicable test was BLOCKED (its inputs were missing)
GREEN  ⟺ every applicable test RAN and returned GREEN
```

with four supporting rules: every test returns four values (RED / GREEN / BLOCKED /
NOT-APPLICABLE), blocking is scoped to the individual test rather than a group, exactly one
verdict column exists at the record grain and every tile and filter aggregates *that* column,
and no fourth workflow state (REPORTED, PENDING) quietly leaves the denominator. The symptom
this prevents: the screen says "blocked" while the numbers still count the record as clean.

**2. A scope filter can delete the evidence.** `PAID = true` as a population filter on a
completeness audit removes exactly the records the audit exists to find. The general form: for
every filter, ask what a failing record looks like and whether the filter removes it. This was
the single most damaging defect caught in this spec.

**3. No column's meaning comes from its name.** Ask the Code changed the design five times over
what the warehouse metadata implied — an enum longer in the ERP than in `ba_views`, two
business events sharing one code, a flag that did not mean its name. Verified semantics, or an
explicit `UNVERIFIED` mark, for any column that gates a verdict.

**4. Matching without a key needs stated behaviour at 0 and at >1.** The note→expense link has
no foreign key. "Take the first candidate" is always a defect; zero and multiple must resolve
to explicit outcomes (usually BLOCKED, not RED), and the spec states a match-rate floor below
which the metric is withheld. DNA-9464 had already hit and fixed the same class of defect in
`BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` — 1 of 8,632 rows matching before, 7,878 after.

**5. No warehouse grant is not a blocker.** `SHOW`, `DESCRIBE` and `GET_DDL` need no warehouse,
and `ba_views` column COMMENTs carry dbt-generated `allowed_values`, `source_expression` and
extracted `WHERE` clauses. The entire data section of this spec was built that way. One
caution now recorded in the skill: `SHOW OBJECTS IN SCHEMA` truncated silently at 15 objects
and omitted the table the spec depended on — `SHOW ... LIKE '%NOTE%' IN ACCOUNT` found it.

## On the DNA handoff

Researched against 162 distinct DNA tickets, 14 opened, with their comments and resulting
dashboards. Findings now in `dna-handoff.md`:

- Intake is a bot with playbook templates; **set the issue type yourself** — an analytic-engineer
  model task and a BI visualisation task are two issues, and the model always blocks the
  dashboard.
- Long-form specs do ship. The median ticket is 785 characters, but DNA-9236 at 6,999 characters
  and fully structured reached a merged MR. Length is not the constraint.
- Four rules with teeth: acceptance criteria must be numeric and testable; **artifact links are
  unreadable to DNA** — put the detail in the ticket; ship source-table detail as an in-ticket
  `.md` attachment rather than prose; search existing tickets before filing (this spec's core
  join defect was already fixed under DNA-9464).
- The thing no ticket craft can fix: every P&C ticket in DNA sits at Priority "Not Urgent", and
  none of them are blocked on information. Ticket quality is not what determines when it gets
  built.

## Deliverables this produced

- `manager-notes-audit/SPEC_manager_notes_audit_v2.md` — the full spec on the Wellcare template
- `manager-notes-audit/SPEC_manager_notes_audit_DEV.md` — the concise developer spec
- `manager-notes-audit/snowflake-discovery.md` — the evidence log, every claim with its statement
- `manager-notes-audit/dna-jira-reference-analysis.md` — the DNA process research
- `manager-notes-audit/jira/` — the two tickets, the source-tables attachment, filing notes
