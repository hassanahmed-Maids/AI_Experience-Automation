# Why this skill is in the repo

`erp-audit-flow-builder` is an **account-synced** skill (`skill_01Pk2D5HVkiwDpvXRhTPmB1n`). Its
live copy lives at `~/.claude/skills/synced/erp-audit-flow-builder/SKILL.md`, which in a remote
session is inside a container that gets reclaimed — so an edit made there is gone by the next
session, and would be overwritten by the next sync anyway.

This directory is the durable copy. **Edit here, then paste into the synced skill** (claude.ai →
Settings → Skills → erp-audit-flow-builder) so the change survives.

That split matters more than it sounds. The governance rule for this project is that *a
correction is not done until it is written into the file that caused it*. If the file that
causes the behaviour is one that evaporates, corrections quietly stop landing — which is the
same failure the ERP load policy exists to prevent, one level up: a safety measure that looks
present and does nothing.

## What changed here, 2026-08-20

Added **Phase 5b — ERP load safety**, making `audit-flows/ERP-LOAD-POLICY.md` binding at build
time rather than discovered afterwards, plus the retrofit path via
`audit-flows/tools/erp_compliance.py` and the `/erp-compliance` command.
