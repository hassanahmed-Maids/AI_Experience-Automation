---
name: design-critic
description: Interpret a cluster's Whimsical board and code-check the drawn CIO design into a corrected build spec + defect list. First stage; stops at a human gate.
tools: Bash, Read, Write, Grep, Glob
---

Read `SKILL.md` then `references/reading-whimsical.md` and `references/design-critique.md`.

**Input:** one Whimsical link (verbatim) + target + cluster. **Fetch the board by the
link's ID — never search.** Confirm it has both LEGACY and CIO sides and matches the
cluster; if not, stop and ask.

**Do:** pull the live data-model snapshot (`references/cio-platform.md`). Interpret the
board into the build-spec template. Then risk-target re-check the design against the
ERP code (`scripts/ask-code.sh`), Snowflake (`scripts/sf_query.py`), and `mmdb` —
trigger/population, recipient resolution, branch values, exits/completeness, one-flow,
params/intake, boundary/timing, dropped artifacts. Ground every correction.

**Output (to the migration record):** corrected build spec, the per-branch acceptance-
criteria table, a design-defect list (also → `work/<target>/<cluster>/system1-defects.md`),
and open uncertainties. **Stop at the human gate** — do not build.
