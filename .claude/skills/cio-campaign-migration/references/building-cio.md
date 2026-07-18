# Phase 2 — Building the journey in Customer.io

Input: the build spec from Phase 1 (which is the System 1 `cio-design.md` + the
CIO half of the combined board). Output: the campaign(s) built in CIO, in draft,
matching the design, ready for build QA + shadow reconciliation (Phase 3).

The authoritative design rules live in `docs/customerio-conventions.md` and
`docs/judgment.md` (load as project knowledge). This file is the build procedure
plus the workspace-specific facts verified from the live API.

## Before you build

1. **Prime + schema + snapshot.** `cio_prime`, then `cio_schema` before any write.
   Pull the live data-model snapshot once (`cio-platform.md`) and share it — don't
   re-query per branch.
2. **Confirm the environment: build in test `216662` only.** A human publishes to
   prod. Never publish, never flip a send to `automatic` here (a live webhook fires
   the real ERP — see `erp-send-webhook.md`).
3. **Be idempotent — find before create.** The campaign name is deterministic (the
   locked scheme), so first list campaigns and look for that exact name: if it exists,
   resume/update it; only create when absent. This prevents the `Untitled Automation`
   / `[Copy]` duplicates that come from re-runs. `add_actions` can return 500 but
   succeed — re-read before retrying.
4. **Dry-run rhythm.** `--dry-run` every mutating call to preview, then execute; do
   **not** GET after every write — trust a 2xx and do one read at the end for the record.
5. **Re-read the design's fidelity notes.** The CIO side is a deliberate *translation*,
   not a port — honour every fidelity note and every intentionally-dropped ERP artifact.

## Design rules you must respect (from customerio-conventions.md)

- **Trigger preference order:** (1) relationship-attribute trigger [default for
  contract/maid-state client messages]; (2) event-trigger; (3) profile-attribute
  trigger; (4) **avoid segment triggers** — they lose contract/maid context.
- **Translate, don't mimic.** Drop ERP execution artifacts (same-day dedup
  flags, cron cadence, job re-run guards) — a state/event trigger doesn't re-fire
  like a nightly job. Keep only business eligibility. Say so in fidelity notes.
- **One campaign per journey.** Model a whole journey as a single campaign with
  waits/wait-untils/branches. Split ONLY when CIO forces it (concurrent
  independent event-waits; different entry cardinality; a truly orthogonal
  outcome; unbounded repeat-until → the two-campaign loop pattern). Name the
  reason when you split.
- **Scope to REAL eligibility, not reflexively to `contract.type`.** Add a
  `contract.type = MV/CC` filter only when the SAME template/event genuinely
  reaches both targets and would otherwise double-send. If ERP gates on a *maid*
  attribute or a target-specific event, a blanket `contract.type` filter can
  silently DROP real recipients (verify the `CONTRACT_TYPE` mix in Snowflake —
  a large `Both`/`blank` share is the red flag). Keep `type = client`/`maid`.
- **Verify attribute VALUES as they land in CIO.** Casing is case-insensitive
  (fine), but format / whitespace / enum-ordinal / boolean-polarity mismatches
  break matching. Pin the exact synced value in the design.
- **State-transition triggers can miss fast jumps.** A trigger keyed on
  "changed to X **from** Y" can miss a record that jumps through Y faster than
  the ~2-min sync. When ERP acts synchronously, prefer a trigger on the
  **destination state** ("status became ACTIVE for an MV client") without
  mandating the prior state, or fire from an event. (This is the Cluster 1
  proceed→success-pair case.)
- **Preserve catch-all `else` branches** as true catch-alls (X / Y / everything-
  else), never a closed list.
- **Boundary conditions:** pin the journey-attribute definition and pick `>=` vs
  `>` so the code's inclusive edge lands on the same side (avoid the off-by-one).
- **Deletion is mandatory for every new relationship** you bring in — state when
  the link is deleted, don't just add it.
- **Events** follow `docs/event-design.md` (keyed to the campaign's recipient,
  minimal payload, name describes the occurrence; don't reach for an event when
  a persisted once-per-event flag or an in-campaign condition will do).

## Verified workspace facts (live API, Testing env 216662)

- **Naming (LOCKED — required):**
  `CIO - <MV|CC> - <Clients|Housemaids> - Cluster <N> - <Journey> (<Owner>)`, e.g.
  `CIO - MV - Clients - Cluster 13 - Ansari Salary Statement Delivery (Abdullah)`.
  `<Owner>` = whoever built it. The other in-workspace schemes
  (`Clients - MV - …`, `MV - Clients - …`) are **legacy** — never create new
  campaigns with them. One Whimsical folder per target (MV-Clients →
  `KaSjst3hrHd5e9Yhou8RGm`), but you don't create boards here — you build campaigns.
- **A "send" is the ERP-send webhook, not a native message.** Build every send per
  `references/erp-send-webhook.md` (`webhook_action` → POST to the ERP; only
  `templateName` / `entityType` / `parameters` change per send). Channel is passthrough.
- **Campaign type** follows the trigger (relationship-attr default → `relationship`;
  loop/event legs → `transactional`). `type` is immutable — pick it right the first time.
- **Object type — read it LIVE per environment.** Confirmed **Contracts = id `1`** in
  env 216662 (Companies = 2, disabled) — the docs' "objectTypeId=2" is wrong here. Pull
  it from the live snapshot (`references/cio-platform.md` § Live data-model snapshot)
  and use that id in the relationship/object trigger and in `object_attribute`/
  `relationship_attribute` conditions (`type_id`).
- **Branching attributes are live-verified, not assumed.** `type` (MV/CC), `status`
  (`ACTIVE`/`POSTPONED`/`CANCELLED`), and the visa relationship attrs are synced on the
  Contract object; confirm each branched attribute is in the run's snapshot. Anything
  missing (e.g. `maid_first_name` was absent in test) is a **sync-add build dependency**
  — flag it, don't silently build a branch on an attribute that isn't there.
- **Reverse-ETL freshness ≈ 2 min** — never design for sub-minute freshness.

## Build order

Build in **draft** and wire in this order (mirrors the design, makes QA 1:1):
1. **Trigger / entry** — the chosen trigger (preference order), exact object
   scope + attribute values, plus target/`type` scope per the eligibility rule.
2. **Waits** — each with the design's offset, anchored per the fidelity note.
   No send at an offset the design leaves empty.
3. **Sends** — build each as the **ERP-send webhook** (`references/erp-send-webhook.md`):
   `webhook_action` named `Send <ERP_TEMPLATE_NAME> (<ID>)`, template POSTing to the
   ERP with `templateName` / `entityType` / `parameters` filled. Channel passthrough.
4. **Liquid / params** — fill each `parameters` slot from its source (event
   `{{trigger.x}}` / synced `{{customer.y}}` / API / static). Implement the intake path
   for any GAP, or leave a visible `TBD_` + open uncertainty. **Never ship a `TBD_` or
   broken `{{ }}` as done** — the fixture render check will fail it.
5. **Exits** — every exit from the design (proceed / cancel / expiry / global). Mind the
   graph rules (`cio-platform.md`): branches must reconverge, and **each exiting branch
   needs its own dedicated `exit_action`** — never route two paths into one shared exit.
6. **Multi-campaign links** — if split (name the CIO-forced reason), confirm the
   hand-off condition (the loop pattern: campaign 1 fires the event campaign 2 waits on).

## Self-review before hand-off to the Verifier

Tick every design element against what you built (trigger, each wait, each send, each
branch condition, each exit, every `parameters` slot), record the CIO campaign/action/
template IDs in the migration record, and leave everything in **draft**. Then hand off
to a **separate, blind Verifier** — the builder does not verify its own build. The
Verifier re-derives expected behaviour from the board + snapshot, runs the fixture
loop (`references/tdd-fixtures.md`) against the acceptance-criteria table, then Layer-A
QA (`references/verifying.md`). The journey is not ready-to-publish until those pass.
