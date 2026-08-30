---
description: Inventory the Audit Flow Factory build queue and gate it — which specs are actually buildable, and what blocks the rest
argument-hint: [check-name] [--category <Category>] [--all-stages]
---

Run the readiness gate over the Audit Flow Factory queue: **$ARGUMENTS**

**Scope.** With no arguments, read all six `Checks — <Category>` databases and take every row at
`Status` = **`Spec'd — pending build on n8n`**. With a check name, gate just that one. With
`--category`, just that category's database. With `--all-stages`, include stages 1–4 too and report
what each is missing to reach *Spec'd — pending build* — useful for seeing the whole funnel rather
than only the queue. `Retired` is always excluded; it is an exit, not a stage.

**Run** the `audit-spec-readiness` agent via the Agent tool. Pass it the scope and the output path
`audit-flows/work/readiness-<today>.md`. It is read-only and needs no ERP token, so it can run at
any time against all 39 rows.

**Then report to the operator, in this order:**

1. **Ready to build now** — the buildable list. This is what the run is for.
2. **Blocked, and whose it is** — grouped by owner: the spec owner (unanswered questions, missing
   test cases, no named reviewer), the data team (unconfirmed or undefaulted ERP variables), the
   ERP team (a Section A route with no alternative).
3. **Traps to read before building** — every `Traps` value on the variables the buildable checks
   read, verbatim. These are wrong findings already shipped once.
4. **Skeleton drift** — any existing flow behind the current `Skeleton Version`.

Counts and totals only in the summary; per-entity detail belongs nowhere in this output.

**Do not** move any `Status`, write to Notion, or start a build. This command answers "what can we
build, and what is stopping the rest" — the build is `/build-check`, and it is a separate decision
with its own gate.
