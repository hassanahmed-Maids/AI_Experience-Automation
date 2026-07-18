# The judgment file — why we migrate the way we do

This is the soul of the project. When any agent faces a design choice not covered by a specific rule, it resolves it against this file.

## The mission (not just re-sending messages)

We could blindly mimic each ERP job and fire the same messages at the same moments. **That is explicitly not the goal.** The goal is to *translate* each flow into CustomerIO with a logical trigger and a logical pipeline — to create an understanding of the client/housemaid journey, not a port of the code.

## The audience test

> A business analyst with **zero prior knowledge** of the flow must be able to look at the campaign (its Whimsical board) and understand how the client/maid moves through the journey and **why each message is sent**.

Corollaries:
- No low-level raw-data checking in the visible flow. The flow shows journey logic; raw conditions live in the tech margin (see whimsical-standards.md).
- Prefer conditions phrased as things that happen to people ("maid returned from vacation") over data states ("REPLACEMENTS row with type=8 exists").

## The obscurity rule

The team shares high-level knowledge of many business concepts — those can be used directly. But not every code entity is like that:

- **Common-knowledge entities** (Contract, Replacement, Taxi, vacation, sick leave…) — use freely in flows and attribute names.
- **Obscure entities** — tables/attributes/functions that *sound* simple but aren't shared knowledge. Do NOT surface them in flows or attribute names. Translate them into business meaning using judgment, and put the raw form in the tech margin.

Seed lists live in docs/glossary.md; extend them whenever a judgment call is made (and log it in decisions.md).

## Attribute naming judgment

New journey/computed attributes must be self-explanatory in a branch condition. Canonical example: `vacation_start_date` (profile attr) → journey attr `days_until_vacation_starts`. If a reviewer must ask "what does this mean?", the name failed.

## Fidelity vs. logic (when mimicry and clarity conflict)

Default: preserve the *business outcome* (who gets what message under which real-world conditions) while restructuring the *mechanism* to be CIO-logical. If exact timing fidelity would force an unintelligible design, prefer the understandable design and flag the timing delta in the validation report for Moe's call. Log the decision in decisions.md.
