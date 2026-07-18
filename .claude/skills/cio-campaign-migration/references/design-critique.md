# Phase 1b — Design critique (the code-grounded gate)

The drawn CIO flow is **not assumed correct.** System 1 produced it, and System 1
has bugs (see `docs/decisions.md` — module-visibility false negatives, recipient-vs-
addressee, one-vs-two-sided gates). This stage pressure-tests the drawn design
*before* a line is built. But it is a **critique of the drawn flow**, not a from-
scratch re-architecture — you improve the board's design and get human sign-off, you
do not invent a rival flow and "validate" it against the board (that's circular).

**Grounding rule:** every correction must be backed by the ERP code (`ask-code`),
Snowflake, or `mmdb`. An ungrounded "I think this is wrong" is not a finding — it's a
new Open Uncertainty with a planned check. Do a **risk-targeted** re-check (the items
below), escalating to a full re-interrogation only on systemic breakage. You are not
re-running System 1's seven agents.

## What to re-check (in priority order)

1. **Trigger choice & population.** Is the trigger the right one per the preference
   order (relationship-attr > event > profile-attr; avoid segments)? Does it reproduce
   the ERP population? Cross-check the Snowflake `CONTRACT_TYPE`/`RECEIVER_TYPE` mix
   for the templates (see `verifying.md`). Watch for: a state-*transition* trigger that
   misses fast jumps (prefer destination-state), and target-scoping that either
   double-sends (shared template → needs `contract.type`) or **drops** recipients (a
   blanket `contract.type='MV'` over a maid-attribute-gated send — a large `Both`/`blank`
   share is the red flag).
2. **Recipient resolution.** Confirm *who actually gets the message* in ERP code —
   recipient ≠ addressee (a copy addressed to a partner may still send to the client).
   This determines `entityType` and the `target[].id` transform in the ERP-send body.
3. **Branch conditions & attribute VALUES.** For every branch/wait-until, confirm the
   condition against code and the **exact synced value** (format/enum-ordinal/boolean-
   polarity — casing is fine). An enum stored as an integer ordinal, or a boolean whose
   polarity is inverted, silently never matches.
4. **Exits & completeness.** Is every exit present (proceed / cancel / expiry / status-
   leaves-trigger / global)? A missing exit is how people get double-messaged. Are
   catch-all `else` branches true catch-alls (X / Y / everything-else), not closed lists?
5. **One-flow vs forced split.** Could this be one campaign? Push to merge sequential
   steps into one journey. Only accept a split for a CIO-forced reason (concurrent
   independent event-waits; different entry cardinality; orthogonal outcome; unbounded
   repeat-until → the two-campaign loop pattern). Name the reason.
6. **Params & intake paths.** Every `@param@` → a concrete source (event / synced attr /
   API / static). Flag each `TBD_`/GAP with the intake path it needs. Confirm synced
   attrs exist in the live data-model snapshot.
7. **Boundary/timing fidelity.** Pin threshold definitions and comparator direction
   (`>=` vs `>`) so the code's inclusive edge lands on the right side (the off-by-one).
   Honour the board's clock-anchor fidelity notes.
8. **Dropped ERP artifacts are correctly dropped.** Same-day dedup, cron cadence, job
   re-run guards have no place in CIO — confirm each dropped artifact is genuinely ERP
   mechanics, not business eligibility.

## Output

Append to the migration record:

- **Corrected build spec** — the `reading-whimsical.md` spec template, with every
  correction applied and grounded (cite the `ask-code` session id / Snowflake result).
- **Design-defect list** — each defect: what the board got wrong, the code/data
  evidence, and the fix. **These are System-1 bugs** — also write them to a structured
  defect log (`work/<target>/<cluster>/system1-defects.md`) so they feed back into the
  responsible System-1 agent (Governance). If the design is clean, say so explicitly.
- **Open uncertainties** — anything you could not ground, each with a planned check.

## The gate

Stop here and present the design-defect list + corrected spec to the human. **Do not
build until the human approves the corrections.** If there are no corrections, still
surface "critique clean, ready to build" — the gate is a checkpoint, not just an
error channel.
