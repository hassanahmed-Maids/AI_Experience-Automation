# Phase 3a — Fixture tracing (the TDD inner loop)

You cannot unit-test a campaign, so "TDD" here means: **derive acceptance criteria
from the spec first, then seed known fixtures and prove they land where the criteria
say.** This is the fast, pre-live loop that runs entirely in the CIO test env
(`216662`). The slow, live loop is shadow reconciliation (`verifying.md` Layer B).

## Step 1 — Acceptance criteria FIRST (before building, in Phase 1/2)

From the corrected build spec, write a per-branch table into the migration record:

```
| Fixture | Input attribute/relationship values      | Enters? | Path taken            | Expected send(s)        | Exit |
|---------|------------------------------------------|---------|-----------------------|-------------------------|------|
| F1      | Contract status=POSTPONED, type=MV       | yes     | nudge week 1 → 2 → …   | POSTPONED_NUDGE_1        | on ACTIVE |
| F2      | status=ACTIVE (already)                  | no      | —                     | none                    | —    |
| F3      | status=POSTPONED, <boundary case>        | yes     | <boundary branch>     | <template>              | …    |
```

One fixture per branch, per exit, and per boundary. This table is the contract the
Verifier checks against — it is written before the build so the build can't define
its own success.

## Step 2 — Seed fixtures (tagged, in test env only)

Create synthetic profiles + Contract objects + relationships whose attribute values
hit each branch. **Every fixture is tagged** so it can be found and torn down and
excluded from counts — the test env is already polluted with demo/journey data, and
un-torn-down fixtures poison the next run's trigger-population numbers.

- Tag convention: a profile attribute `qa_fixture: true` (+ `qa_run_id: <id>`) and/or a
  `qa_` id prefix on the synthetic ids.
- Set object/relationship attributes to the exact synced **values** from the spec
  (mind format/enum-ordinal/boolean-polarity).
- `cio_write_api` with `--dry-run` first for every create; verify once at the end.

## Step 3 — Trace

Drive the fixtures through the draft campaign and read where they land:

- `GET /campaigns/:id/action_status` — customer counts per action.
- `GET /campaigns/:id/subjects` / `GET /actions/:id/subjects` — who is at each step.
- `GET /journey_attributes?customer_id=…&campaign_id=…` — computed journey attrs
  (verify boundary/threshold math).
- **Would-sends:** `GET /deliveries?campaign_id=:id&drafts=true&size=200` (paginate
  `meta.continuation`; drafts cap ~20/page). A drafted delivery does **not** fire the
  ERP webhook — safe. The `subject` = the send-action name; `customer_id` = the cio_id.

## Step 4 — Assert against the criteria table

For each fixture: entered iff expected, took the expected path, produced exactly the
expected would-send(s), and exited as expected. Any mismatch → a build bug (or a
spec/design bug → loop back to Critic). 

**Render check (the classic silent failure):** for each would-send, pull the rendered
body (`GET /actions/:id/variables` + a preview) and assert **no `TBD_`, no unresolved
`{{ }}`, no blank `parameters` value, correct `templateName` and `entityType`**. A
param that renders empty because an attribute name drifted is the "built fine, sends
garbage" bug — catch it here.

## Step 5 — Teardown (mandatory)

`POST /subjects/:id/force_exit` for any parked fixtures, then delete the synthetic
profiles/objects/relationships (all tagged `qa_fixture`). Confirm none remain. Never
leave fixtures behind — they corrupt the next run's population counts and the
workspace's attribute list.

## What this loop does and doesn't prove

- **Proves:** flow logic (entry, branches, waits, exits), boundary math, param
  resolution / render correctness, and that the ERP-send bodies are well-formed.
- **Does NOT prove:** real WhatsApp delivery/rendering by the ERP (the test env can't
  fire the ERP webhook), or real-population parity. Those are proven later in prod
  shadow-mode (`verifying.md` Layer B / System 3). State this boundary in the record —
  don't claim delivery parity from fixtures.
