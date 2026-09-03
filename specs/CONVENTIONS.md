# Spec-writing house rules

Standing rules for everything under `specs/`. Add to this file when a correction would otherwise
be repeated.

1. **Never name the automation platform a spec replaces.** Refer to it as *the retired
   process*, *the predecessor*, or *the legacy check / code / rule* as the sentence needs.
   Threshold provenance reads `*(legacy constant NAME = value.)*`. No workflow IDs, no
   platform URLs, no vendor name — in specs, tickets, mockups or handover docs.
   *(Set 2026-09-03 by Hassan Ahmed.)*

2. **Every P&C audit spec follows `_template/SPEC_TEMPLATE.md`.** It is extracted from the
   Wellcare Invoice Audit, which is the reference implementation — read that spec alongside the
   template, because the template gives the skeleton and the reference shows the depth.
   Non-negotiable in it: the **Blocking?** column on open items; **§7 requestor decisions kept
   separate** from §6 data items; **named guards** with at least one arithmetic identity that
   cannot be satisfied by construction; per-metric **null / legitimate-zero / negative** rules;
   `UNVERIFIED` on every unconfirmed name; and corrections to earlier versions made **in the
   open**, with what the wrong answer produced.
   *(Set 2026-09-03 by Hassan Ahmed.)*

3. **Delivery platform naming.** **MaidsInsights** is the dashboard the auditor opens;
   **Snowflake** is the warehouse underneath it — tables, role, grants, SQL. They are not
   interchangeable and a spec says which it means.
   *(Set 2026-09-03 by Hassan Ahmed.)*
