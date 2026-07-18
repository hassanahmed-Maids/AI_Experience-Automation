# Business glossary

Maids.cc domain knowledge every agent needs. Grow this file whenever a term causes confusion.

## Company & products

- **Maids.cc** — offers two contract packages: **CC** and **MV** (MaidVisa). The `Domain` column in exports shows e.g. "MaidVisa".
- **Client** — a customer holding ≥1 contract. Rarely holds both a CC and an MV contract (then they're a target in both groups).
- **Housemaid (maid)** — each contract has exactly one current maid; a maid is on at most one contract. Her type (CC/MV) is inherited from the contract. Replaceable (vacation, sickness, client request).
- **Contract** — links one client + one current maid. Status: `ACTIVE`, `POSTPONED`, or `CANCELLED`. CIO prospect types: CC = 1650, MV = 1726.

## The four migration targets

`CC-Clients`, `MV-Clients`, `CC-Housemaids`, `MV-Housemaids`. Nothing else. Termination/cancellation messages ("Cancelled CC/MV") belong inside the client targets, keyed off contract status — not a separate target.

## Messaging

- **Broadcast template (ERP-template)** — the migration unit. Static text + fill-in `@params@` (e.g. `@maid_name@`, `@taxi_time@`). Sent by ERP code calling an internal API with (recipient, template_name, params). ~500 total, exported from **JourneyAI** (Google-SSO site; Moe exports on request).
- **CIO campaign** — the destination. We never use CIO "Broadcasts".
- Channels: WhatsApp (mostly) and SMS. Passthrough — migrate the template, keep its channel.

## Replacement-related concepts (heavily used in flows)

- **Replacement** — a maid swap on a contract. Type-8 = vacation replacement. Sick-leave replacements tracked via `SICKNESSLEAVES` + `DOCTORWORKORDERS`.
- **maid_role** (CIO relationship attribute) — `permanent`, `temporary_replacement`, `on_vacation`, `sick_leave`.
- **Bouncing Flow** — a termination path; terminations from it are flagged not to receive some cancellation messages.
- **Taxi / LogisticsWorkOrder** — maid transport work orders (`taxiWorkOrderPurpose`: deliver_to_client, pickup_from_client, …). Drives many messages and the TAXI event.
- **WPS** — Wage Protection System payroll transfer run (maid salary payments). Note: the salary-transferred notification (`Payroll_Maid_Salary_Transferred_Notification`, 1749) is NOT CC-only — **MAID_VISA maids receive it too** (the `housemaidType <> MAID_VISA` exclusion applies only to the on-hold sibling path). Don't assume "WPS = CC maids."
- **PDC / DD** — post-dated cheque / direct debit payment concepts on contracts.

## Visa-processing patterns (recurring across MV clusters)

- **Prior-employer immigration block** — a maid arrives still tied to a previous employer (active work permit, active visa with company/private sponsor, MOHRE ban, or inactive tourist visa). The visa is paused until the client provides cancellation/clearance proof. Each block type = an initial message + a reminder chain.
- **Proof-doc attachment tags = the canonical "chain-stop" mechanism.** Visa-processing reminder chains stop when a proof document with the right tag is uploaded — e.g. `visa_cancellation_proof_doc_tag`, `work_permit_cancellation_proof_doc_tag`, `ban_lifting_proof_doc_tag`. Chains are enforced two ways: an in-handler null-check and a `NotificationClose.Disable…` hard-cancel when the workflow step completes. Reminder cadence pattern: REMINDER_1 at +2d (one-shot), REMINDER_2 at +5d then self-loops every +5d (Sat→+7, Sun→+6), as `ScheduledAction` rows re-dispatched by `NotificationTrigger`.

## Common-knowledge vs obscure entities

(Seed list — Moe to extend. Rule: common-knowledge entities may appear in flows by name; obscure ones must be translated to business meaning — see docs/judgment.md.)

- Common knowledge: Contract, Housemaid/Maid, Client, Replacement, Taxi, Vacation, Sick leave, WPS payroll, Termination/Cancellation, maid statuses like WITH_CLIENT.
- Obscure (tech-margin only): internal helper entities like `MEDICALASSISTANTS` rows, `CONTRACTS_REVISIONS` mechanics, picklist IDs, `M_STATUS` flags — anything that "sounds simple but is obscure".
