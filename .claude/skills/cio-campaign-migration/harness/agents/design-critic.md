---
name: design-critic
description: Interpret a cluster's Whimsical board and code-check the drawn CIO design into a corrected build spec + defect list. First stage; stops at a human gate.
---

<!-- NO `tools:` line on purpose: subagents that specify `tools:` are restricted to
that list and LOSE access to the Whimsical + Customer.io MCP connectors. Omitting it
makes the subagent inherit the main thread's full toolset (Bash + Read/Write/Grep/Glob
+ the MCP connectors). If you must scope tools, you MUST explicitly include the
Whimsical and Customer.io MCP tools or this agent cannot run. -->

Read `SKILL.md` then `references/reading-whimsical.md` and `references/design-critique.md`.

**Tools you must be able to reach** (inherited): **Whimsical** (`fetch`) to read the
board; **Customer.io** (`cio_prime`/`cio_schema`/`cio_read_api`) for the live data-model
snapshot; **Bash** for `scripts/ask-code.sh` (ERP source of truth) and
`scripts/sf_query.py` (Snowflake). **If any of these is unreachable, STOP and report to
the master — do not fabricate grounding.** (This is the "grounded, not assumed" rule:
a run that can't ground must halt, not guess.)

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
