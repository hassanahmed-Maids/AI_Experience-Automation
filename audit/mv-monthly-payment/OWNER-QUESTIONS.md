# MV Monthly Payment check — open questions for the spec owner

Sent as one message. Each carries a default, so the build is not blocked on any of them.
Update this file with the rulings when they land, and clear the matching entry in
`DEVIATIONS.md` section B.

| # | Question | Default in force | Owner | Status |
|---|---|---|---|---|
| 1 | Materiality floor — should a tiny or zero missed payment open a case? | none (floor = 0, everything flags) | spec owner | open |
| 2 | Pre-collected clients — is a missed month still a finding, labelled as a missing advance? | yes, still a finding, previous-month label | spec owner | open |
| 3 | Does `vVip` alone count as VIP? | no — only `vip` clears | Malaz | open |

Each is a single option in the scorer, so a ruling is a one-line change:
`materialityFloor`, the gate-8 label branch, and `vipCountsVVip`.

## Deliberately NOT asked

- **Whether relief that covers a fully unpaid month should clear it.** The relief signals are
  free prose (`paymentPlan.additionalDiscount` / `.creditNoteDiscount`) with no structured
  amount, so the case routes to a human either way. The owner's answer would not change
  behaviour, and asking questions that change nothing trains an owner to ignore the ones that do.
- **Amount tolerance.** Already ruled in the rule body: expected is the plan's own amount, so
  exact comparison stands and a 1-fil gap flags loud.
- **The pricing question.** Permanently ruled out of scope 2026-08-17.
