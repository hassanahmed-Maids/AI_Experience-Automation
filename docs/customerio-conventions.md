# CustomerIO conventions & translation philosophy

Captured from Moe, 2026-07-02. This is the constitution for the `customerio-translator` agent — every CIO design must comply.

## Canonical references (do NOT duplicate — always read fresh)

- **Architecture doc:** `/Users/moe/Desktop/Clients & Housemaids Query/docs/CustomerIO-Architecture.md` — the full data model: who syncs, all profile/object/relationship attributes, the 6 UNION branches, daily cleanup. It "keeps getting updated" — read it at the start of every translation run.
- **Sync queries (source of truth for attribute semantics):** `/Users/moe/Desktop/Clients & Housemaids Query/New CIO Queries/` — `CIO Clients Profile Query.txt`, `CIO Maids Profile Query.txt`, `CIO Contracts Groups Query.txt`.
- **ERP events already sent to CIO:** see `docs/erp-events.md` (exported 2026-07-02; more pending — new events are a valid intake path).
- **DB access:** read-only MySQL, creds in `.env` (`CIO_DB_*`), database `mmdb`. Verified working 2026-07-02 (39 tables). Use it to check what attributes exist / verify data shape. It may not have everything.

## Data model in one breath

Reverse ETL every ~2 min (Moe, 2026-07-02; the architecture doc says 5 — treat "a few minutes" as the guarantee, never design for sub-minute freshness): **Clients query, Maids query, Contracts query**. Workspace = person profiles (`type` = `client` | `maid`, ids `c_<id>` / `m_<id>`) + a custom **Contract object** (`objectTypeId = 2`, `groupId` = contract id) with **relationships** linking client↔contract and maid(s)↔contract. Because of replacements (vacation/sickness), one contract can link **multiple maids** (current + old/sick/vacation maid via branches B3–B5) — this is deliberate, so clients can get messages about a replaced maid. Daily 06:00 Dubai cleanup deletes aged-out contracts, broken links, stale profiles (`snapshot_date` ≠ today).

## Trigger preference order (for campaign design)

1. **Relationship-attribute triggers (MOST prominent).** Condition(s) on contract↔maid relationship attributes; the campaign admits a person from the contract object filtered by profile attribute `type = client` (or `maid`). This is the default choice for client messages driven by contract/maid state.
2. **Event-triggered** — events sent by ERP (see the sheet; more pending). Use when state-based triggering can't express the moment.
3. **Profile-attribute triggers** — only when the message genuinely concerns the client/maid alone, not a contract (infrequent for client messages).
4. **Segment-based triggers — AVOID.** Moe dislikes them: you can't tell which contract/maid triggered entry, and those attributes can't be used inside the campaign.

## Scope every campaign to its target (CC/MV, client/maid)

Migration is target-by-target, but many ERP templates/send-paths are NOT target-scoped in code (e.g. `Payroll_Maid_Salary_Transferred_Notification` reaches both CC and MV clients). Every CIO campaign MUST therefore include an explicit target filter — `contract.type = MV` (or `CC`) and the right `type` (`client`/`maid`) — even when the legacy code has no such filter. Otherwise the per-target campaigns overlap on shared data and double-send.
- For a template/event shared across CC and MV: either add the `contract.type` entry filter to each target's campaign, OR use per-target event names. State the chosen scheme in the design.
- `contract.type` exists on the contract object in the sync (architecture doc) — use it directly.

### CAUTION — scope to the REAL eligibility, not reflexively to `contract.type` (2026-07-07, Cluster-7-Medical-Finished)

The goal of this rule is to stop per-target campaigns from **overlapping on a shared template and double-sending** (the 1749 case). It is NOT a mandate to bolt `contract.type = MV` onto every campaign. **Before adding a `contract.type` filter, verify what ERP actually gates on** — a blanket filter can silently DROP real recipients:

- **The ERP gate may be a MAID attribute, not the client's contract type.** In the medical-finished flow the eligibility is the *maid* being `HousemaidType.MAID_VISA` with an active visa request; the message is sent against the maid's **newest `ACTIVE`/`PLANNED_RENEWAL` contract of EITHER type** (no type predicate in the query). A `contract.type='MV'` filter is then wrong.
- **Dual-contract "Both" clients.** A client can hold both a CC and a MaidVisa contract. If the send is maid-driven and the client's *newest* contract is CC, ERP sends against the **CC** contract — a `contract.type='MV'` filter drops them. Verify in Snowflake: `CONTRACT_TYPE` on `BROADCASTS_FINAL_LAYER` shows `MaidVisa` / `Both` / blank per template; a large `Both` or `blank` share is the red flag. (Medical-finished: ~13-14% `Both`, plus a sizable `blank` cohort — and **zero pure-`CC`**, proving the maid-type gate already keeps the other target out with no filter needed.)
- **A source-gated, target-specific event IS the scope.** When the trigger is a new event that only fires for this target's process (emitted at the real ERP send point), the event firing already encodes eligibility. Adding `contract.type` is redundant and, per the above, potentially harmful. Prefer the event's own specificity (or per-target event names) over a contract-type filter. Keep `type = 'client'`/`'maid'` — that's cheap and correct.
- **Rule of thumb:** add `contract.type` only when the SAME template/event genuinely reaches BOTH targets and would otherwise double-send (1749). If ERP has no contract-type gate and the audience is defined by a maid attribute or a target-specific event, do NOT add it — mirror ERP, and let the source-gated event scope the campaign. Never add a gate ERP's own send path lacks.

## Verify attribute VALUES, not just existence

Confirming an attribute exists in the sync is not enough — a branch/wait-until must match its **exact synced value**. Proven failure modes (CC Maid Sickness check, 2026-07-03):
- **Format (not casing):** confirm the real synced *format* (query text or `mmdb`), not an assumed pretty form — e.g. `doctor_work_order_status` is synced raw as `CLOSED`. ⚠️ **Casing is NOT a functional concern (Moe, 2026-07-14): CIO string equality is case-insensitive** — `'abu dhabi'` matches synced `'Abu Dhabi'`, `'closed'` matches `'CLOSED'`. Pin the synced casing in designs for readability, but a casing-only difference does not break a branch/wait-until. (This supersedes the earlier CC Maid Sickness note that blamed a non-firing `'closed'` wait-until on casing — that failure had another cause; re-examine if it recurs. Format/whitespace/enum-ordinal mismatches DO still break matching.)
- **Boolean polarity:** `maid_refused_to_join_client = IF(want_to_join_her_client = 1, FALSE, TRUE)` — it's the *inverse* of "wants to join." Verify which direction the flag means before branching on it.
- **"Field" that isn't a field:** "a new/temp maid is on the contract" is not a column — it's `maid_role = temporary_replacement` (or the B4/B5 link's presence). Map such business phrases to the actual synced attribute.
- **Signals that need wiring:** conditions like taxi `deliver_to_client` require the TAXI event to be wired — they aren't passively available.
- **Enum stored as an integer ORDINAL.** A code enum compared by name may be persisted as its ordinal int (Cluster 2: `typeOfPreviousVisa` → `Tourist_Visit_Visa=1`, `Company_Sponsorship=3`, `Private_Sponsorship=4`). A CIO/API branch on the string label silently never matches — decode the ordinal to the enum name at the source (API), and pin the exact int↔name mapping.
So: for every value compared in a trigger/branch/wait-until, confirm the exact string/enum/boolean as it lands in CIO. Pin it in the design.

## Prefer ONE campaign per journey (don't over-split)

Default to modeling a whole client journey as a **single campaign** entered at its originating moment, using waits / wait-untils / branches for the downstream steps. This serves the audience test (one understandable flow) and matches how the business thinks ("everything that follows from a replacement being created"). Splitting into several campaigns fragments the story and should be the exception.

**Split ONLY when CIO genuinely forces it**, and state which reason applies:
- **Concurrent independent event-waits** where each spawns its own multi-step sub-flow — CIO moves a person along one path; racing several independent events with separate logic is where one campaign breaks. (Use "wait until A or B or timeout, whichever first" for simple races before giving up and splitting.)
- **Different entry cardinality** (per-contract vs per-occurrence).
- **A truly orthogonal outcome** unrelated to the main journey (e.g. a nationality-downgrade refund).
- **Unbounded repeat-until** → the two-campaign loop pattern.

When you split, name the constraint and keep the fewest campaigns. (Correction, 2026-07-04: the first Replacement-Handover design over-split into 6; Moe: join the sequential ones — C1–C5 flow from replacement-created and belong in one campaign; only the refund (C6) is legitimately separate.)

## In-campaign toolkit (preferred patterns)

- **True/false branches & multi-splits** on profile attributes or **journey computed attributes** — but only *understandable* ones. Canonical example: from `vacation_start_date` compute journey attribute `days_until_vacation_starts`, then branch on it. Attribute names must pass the business-analyst readability test (see docs/judgment.md).
- **API-call journey attributes:** if an attribute is too complex to get from the DB sync, call an API inside the campaign and store the result as a journey attribute. **But an API can only return PERSISTED state.** A transient/request-scoped flag that the ERP never writes to a table (e.g. `isFromBouncingFlow`, a `@RequestParam` used only at scheduling time) CANNOT be recovered later by a `contractId`-keyed API — it must be captured as a **CIO event fired at the moment it exists** (see docs/event-design.md). Before specifying an API, confirm the value is actually persisted; if it's transient, use an event instead.
- **Wait-untils:** wait for an attribute change or an event (e.g. "Taxi is booked"). Reminders: wait statically until a time, or dynamically until a timestamp via a **unix computed journey attribute**.

## Translate, don't mimic — drop ERP execution artifacts

The legacy code contains two kinds of conditions. **Separate them:**
- **Business eligibility** (who genuinely should/shouldn't get the message) → keep, express as entry filter / branch / attribute.
- **ERP execution artifacts** — guards that exist only because of *how the ERP runs* (job re-runs, cron cadence, same-day dedup flags, "already sent today" checks). These usually have NO place in CIO, because a state/attribute/event trigger doesn't re-fire the way a nightly job does.

Canonical example (Cluster 14, per Moe): the ERP guard `isScheduledTerminationSMSAlreadySent` (same-day dedup) should NOT be replicated — the CIO trigger is simply "an MV contract has its scheduled termination date set (exists)", which won't fire multiple times. Likewise, a suppression guard (e.g. bouncing/accounting-flow) becomes an entry **API call or a person/relationship attribute check**, not a re-implementation of the Java branch.

When translating, for every legacy guard ask: "is this business logic, or is this compensating for ERP's job mechanics?" Drop the latter and say so in the fidelity notes.

## Encoding threshold / boundary conditions (avoid off-by-one)

When translating a code predicate like `x <= K` or `x >= K` into a CIO branch of the form `journey_attr vs N`, you MUST pin the attribute's exact definition and choose the comparator so the **boundary value lands on the same side as the code's inclusive edge**. This is a proven failure mode (Cluster 14, 2026-07-02): the code used `dayOfMonth <= daysInMonth − N` (boundary day inclusive in the "earlier" arm); the design encoded `days_until_end_of_month > N → earlier`, which put the boundary day on the WRONG side → sent the wrong template and missed a message one day per month.
- State the attribute definition explicitly on the board and in the design (e.g. `days_until_end_of_month = daysInMonth − dayOfMonth`).
- Trace the boundary value by hand (does day 26 → value 4 → land in "earlier"?) and pick `>=` vs `>` accordingly.
- Note **when** the attribute is evaluated (entry/scheduling time vs later), since that changes its value.

## State-transition triggers can miss fast jumps

A trigger keyed on a state *transition* (e.g. "status changed to ACTIVE **from** POSTPONED") can MISS a record that jumps through the intermediate state faster than the ~2-min sync cycle — CIO may first observe the record already in the final state, so the transition never fires. When ERP does the action synchronously regardless, prefer a trigger on the *destination* state ("status became ACTIVE for an MV client") without mandating the prior state, or fire from an event at the moment the action happens. (Cluster 1: the proceed → success-pair campaign.)

## Preserve catch-all branches; verify before collapsing send sites

Two translation-narrowing pitfalls that miss legitimate sends (Replacement-Handover FAIL, 2026-07-04):
- **Catch-all `else` must stay a catch-all.** When the code selects a template with `if X return; else if Y … else <send>`, the final `else` fires for EVERY other value — not just the ones you happened to enumerate. Translate it as `X / Y / everything-else`, never as a closed list of known values. (C2 dropped `DONE`/`CANCELLED` taxi statuses because the split only listed `PENDING`/`ONGOING`.) If an event payload carries the discriminator, its enum must include an "other" bucket.
- **Before collapsing two ERP send sites into one event/campaign, prove they're truly identical — including null/edge cases.** A claimed "fidelity improvement" that merges two sites is only valid if both fire under the same conditions. (The two found-in-attendance sites disagreed on the null-work-order case: one sends when `wo == null OR pending`, the other requires non-null — collapsing them silently dropped the null case.) When they differ, either keep them separate or make the merged campaign match the SUPERSET, and emit the event at each real ERP send point so the campaign doesn't re-derive (and re-narrow) the condition.

## The loop pattern (CIO has no loops)

For "send message, then daily reminder until client responds":
- **Campaign 1** (attribute-triggered) sends the first message, then fires a trigger event for Campaign 2.
- **Campaign 2** (event-triggered): 1-day delay → send reminder → re-fires its own trigger event → exits. Infinite loop by self-re-triggering; exit condition breaks the chain.
Moe dislikes needing two campaigns for one logical flow, but this is the accepted workaround. The translator should use this pattern when the legacy flow has repeat-until semantics, and label both campaigns as one logical unit.

## Known limitations / friction

- **CIO:** no looping (→ two-campaign pattern above). Segment triggers lose contract/maid context (→ avoid). Others exist but "we always find a way" — don't treat unlisted things as blockers; propose a design and flag uncertainty.
- **ERP:** none hard-known yet. Anticipated: "the sync query would be too complex" → substitute an API call or a new ERP event. When a translation needs an attribute that doesn't exist yet, the design should say which of the three intake paths it needs: add to a sync query, new ERP event, or API-call journey attribute.

## Deletion is mandatory for every new relationship

CustomerIO does **not** delete un-retrieved links, profiles, or objects on its own — if the sync stops returning a row, the record just goes stale in CIO. So **any campaign that requires bringing a new relationship (or profile/object) must also specify when that link is deleted**, and propose a deletion rule. Reference patterns: the existing deletion queries at `/Users/moe/Desktop/Clients & Housemaids Query/Deletion Queries/` (contract drops, relationship removals for maid-swapped / client-changed / sick-leave-expired / vacation-maid-reassigned, stale-profile by `snapshot_date`). CC vacation and sickness relationships are the hard worked examples of "bring extra maid links, then delete them when the condition ends" — study them. For MV, replacement is scarce, so this is usually trivial — but the deletion rule must still be stated.

## Reading the built campaign (no CIO API/export)

There is currently no way to export from CustomerIO. Agents that need to inspect a built campaign (the go-live final-checker) get it one of two ways, fed manually by Moe: (a) the **Whimsical board of the CIO campaign** (read via Whimsical MCP), or (b) Moe's **pasted description**. Design agents around this — never assume programmatic CIO read access.

## Naming

- Campaign/board names start with **CIO** (exact pattern TBD).
- One Whimsical folder per target. Ignore pre-existing MV campaign boards (drafts).

## Design checklist for every translated campaign

1. Trigger chosen by the preference order above, with the *why* stated.
2. Entry filtering mirrors legacy eligibility (audience + disqualifiers up front).
3. Every legacy wait/timing rule expressed as delay / wait-until / dynamic timestamp.
4. Every branch condition uses understandable attributes (or defines a new journey computed attribute with a readable name).
5. Attributes used must exist in the sync (check architecture doc / DB); if not, specify the intake path (query change / event / API attribute).
6. Repeat-until flows use the two-campaign loop pattern, labeled as one logical unit.
7. Message content sits in side notes with @params@ mapped to CIO attribute equivalents.

### The current JourneyAI export is the scope authority (2026-07-08)

Migrate ONLY templates present in the target's **latest** export. The export changes between pulls (a 6-day gap moved templates in and out). Therefore:
- Any **out-of-export template pulled in** for chain-completeness, and any **"live but not in export" candidate**, must be re-checked against the CURRENT export. If it is absent, do NOT migrate it — remove it and log in `<target>_TEMPLATES_REMOVED.md`.
- Re-pull the export before starting a new target, and reconcile already-completed clusters against it.
- A template being high-volume / clearly-live does **not** override this — it may simply belong to a **different target** now (e.g. `1749` Payroll_Maid_Salary_Transferred, ~6,976 sends/45d, dropped out of the MV export → reclassified to a payroll target). Flag such a template for re-scoping under its real target rather than forcing it into this one.
