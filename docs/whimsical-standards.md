# Whimsical flow standards

Distilled 2026-07-02 from the CC Clients boards (CC Cancellation Flow, CC Unexpected Attendance Flow, CC Maid Sickness Flow). These aren't treated as gold standards — but they encode the team's intent: **judgment-sounding data attributes, an understandable flow, message content set aside as notes.**

## The audience test (from docs/judgment.md)

A business analyst with zero prior knowledge must understand, from the board alone, how the client/maid moves through the journey and why each message fires. Journey logic, not raw data checks.

## Observed conventions (keep these)

1. **Entry node = the triggering state/event**, stated as a fact: "Termination Date Set", "Maid Triggered Unexpected Attendance", "Maid Status is SICK_WITHOUT_CLIENT And Has a Doctor Work Order".
2. **Early eligibility filter node** right after entry: e.g. "Filter: Status = WITH_CLIENT, Contract Status = Active". Disqualifiers up front, once.
3. **Decision nodes ask one question** ending in "?", with **Yes/No (or True/False) labeled connectors**. Every "No/Yes" that ends the journey goes to an explicit **Exit** node.
4. **Send nodes**: `Send <TEMPLATE_NAME>`. Consolidate identical variants: "Send X_1 (which is identical to _2 and _3)".
5. **Message content NEVER lives in the flow** — it sits beside the flow in a colored note/box: `TEMPLATE_NAME` + full message text with `@param@` placeholders.
6. **Wait semantics are explicit nodes**: "Wait 24 Hours", "Wait Until the Doctor Work Order Is Closed", "Wait Until Taxi Work Order is Created OR Maid Status = RESERVED_FOR_REPLACEMENT" — with event-labeled outgoing connectors ("Taxi Event", "Maid Reserved"). These map naturally to CIO delays/wait-untils.
7. **Business wording in the flow, tech detail in the margin.** The Cancellation board has a "Tech" column on the left: flow says "Contract has any payments of type received", margin says "Payment Status = Received"; flow says "Contract has PDC payment sent to bank and DD accepted", margin says "Payment Status = PDC & SENT_TO_BANK_BY_MDD = true & M_STATUS = 'CONFIRMED'". This dual-layer IS the judgment rule in action — keep it.
8. **Condition language mixes freely**: business English ("While the maid was sick, was a temporary replacement sent to the client?") and attribute-speak where the attribute is common knowledge ("MAID_TYPE = CC?", "scheduledDateOfTermination = Today?"). Obscure entities (LogisticsWorkOrder internals…) belong in the tech margin, not the flow.
9. **Status annotations** as overlay notes: e.g. a purple note "Template Inactive" over a dead branch.

## Inconsistencies to standardize (proposed — confirm with Moe)

| Aspect | Board variance | Standard |
|---|---|---|
| Decision shape | rects (Cancellation/Attendance) vs diamonds (Sickness) | **diamond** for decisions, rect for states/actions |
| Message note style | purple #730FC3 notes vs blue #2C88D9 rects | **one fixed color for message notes** (pick purple #730FC3) |
| Send label | "Send NAME" vs "Send Template N — NAME" | `Send <NAME>` only; numbering adds nothing |
| Exit vs terminal send | both exist | Exit only for no-send ends |

## Node vocabulary (for the flow-diagrammer agent)

| Node | Shape | Content |
|---|---|---|
| Trigger/entry | rect | The state/event that starts the journey |
| Filter | rect | Upfront eligibility (audience) conditions |
| Decision | diamond | One question, "?", Yes/No edges |
| Wait | rect | "Wait <duration>" or "Wait Until <event/state>" |
| Send | rect | `Send <TEMPLATE_NAME>` |
| Exit | rect | Journey ends without message |
| Message note | note, purple | `TEMPLATE_NAME` + full text with @params@ |
| Tech margin | rect, left column under "Tech" header | Raw attribute/entity conditions backing each business condition |

## Spacing & no-overlap (MANDATORY self-check)

Boards must open with **no overlapping nodes**. Overlap is the #1 quality complaint (Moe, 2026-07-02). Rules:
- Space nodes generously — do not let boxes, diamonds, or side-notes sit on top of each other. Give decision diamonds room (they're tall) and keep exit rects clear of the nodes above them.
- Absolutely-positioned board items (Tech margin, message notes) must sit **well clear of the flow's bounding box** — put the Tech margin far enough left and message notes far enough right that they never overlap the flow, even after auto-layout expands it.
- **Multi-split fan-outs are the #1 overlap trap.** A decision that fans into 3+ branches (e.g. a 5-lane blocker split → 5 `Send` boxes) crams the boxes and their edge labels on top of each other. Give each branch a FULL COLUMN of horizontal room (≥ box-width + gap per branch), or stack the branches vertically with a routed connector, or split the fan-out into its own sub-diagram. Never let two sibling branch boxes or their labels touch.
- **A flowchart REFLOWS when you add/edit nodes** — its bounding box grows and can then collide with manually-placed title/margin/message notes that were previously clear. After ANY flowchart edit, re-measure the flow bbox and re-clear the manual notes; don't assume they're still safe.
- **Verify at a LEGIBLE zoom, and check the dense regions specifically** — after creating/editing, `fetch` the board as an image AND fetch a zoomed viewport of (a) the header/title/margin band and (b) every fan-out/junction. A full-board thumbnail hides overlaps; you must see node text clearly. If any node text is unreadable or two boxes/labels touch, it is NOT done — widen gaps / move panels / `auto_layout` / split, then re-fetch the same regions. Do not report clean from a thumbnail alone.
- **Prefer `auto_layout` for the flow core; hand-position only the margin notes.** Hand-computed coordinates repeatedly produce two failures: node text wraps and expands past its assumed box (collisions), and connectors get routed straight *through* nodes. `auto_layout` guarantees no node-on-node overlap and routes connectors around nodes. Lay out the flow graph with `auto_layout`, then measure its resulting bbox and place the Tech margin (far left) and message notes (far right) clear of it. Reserve fully-manual positioning for boards where a bespoke layout is essential.
- **The ORCHESTRATOR verifies the board, not just the drawing agent (MANDATORY).** The agent that placed the nodes is unreliable at spotting its own overlaps — it has self-reported "verified, no overlaps" on boards that were visibly overlapping (Cluster-6, twice; Moe caught them). So the drawing agent's self-check is necessary but NOT sufficient: the orchestrator MUST independently `fetch` the finished board at legible zoom (full image + every dense region) and confirm before declaring a board done or handing it to Moe. Treat "agent says it's clean" as a claim to check, not a result.

## Drawing hard cases (conventions)

- **Additive send + suppression.** When a branch sends a message *in addition* (doesn't stop the main flow) while separately suppressing a later send (e.g. Resolvers-screen → sends 4_1_1 AND suppresses the standard SMS), don't force it onto a single Yes/No edge. Draw the additive send off the branch, and put an explicit "suppression applies to the sends below" annotation + a Tech-margin note. A `Yes` that doesn't halt the flow must be visually distinct from a `Yes` that exits.
- **Deferred / cross-job flag hand-off.** When a real-time path only *sets a flag* and a separate job later reads it and sends (two disjoint control graphs joined by shared state, not a control edge), draw the job as its own lane and connect the flag-set node to the job lane with a **dotted, labelled data-connector** ("deferred"). Never imply a direct control-flow edge between them.
- **Runtime-configurable thresholds.** Values that are DB-configurable (e.g. `DAYS_TO_END_OF_MONTH`, default 4) render in the node as `N (default X)`, with the parameter name + "DB-configurable" in the Tech margin. Never present a configurable default as a hardcoded business rule.

## Subset-of-a-decision-tree clusters

When a cluster's in-scope templates are only part of a larger decision tree (common — the export doesn't always contain every sibling), **draw the whole tree** for journey completeness (the audience must see the full picture), but clearly annotate every branch/send whose template is **not in the current export** with a `(not in export)` label and no message note (we don't have its text). This keeps the journey understandable while being honest about scope. (Decision: Moe, 2026-07-02, Cluster 14 — draw all 7 termination branches, mark the 4 not in the MV-Clients export.)

**Make in-export vs pulled-in unmistakable (Moe, 2026-07-04):** a plain "(not in export)" buried in node text isn't clear enough. Put a **consistent, legible visual marker on EVERY send node**: e.g. prefix in-export sends with `✔ [EXPORT]` and pulled-in ones with `＋ [NOT IN EXPORT]` (or use a distinct border/deco — pick one scheme and apply it uniformly), AND add a small **legend note** on the board stating the scheme. A reader must be able to tell at a glance which messages came from the JourneyAI export and which were brought in later from the code. Applies to legacy AND CIO boards.

## CIO flow lives NEXT TO the legacy flow on ONE board (Moe 2026-07-13) — SUPERSEDES separate-board rule

**A cluster has ONE board holding BOTH flows side by side.** From 2026-07-13, we no longer produce a standalone CIO board separate from the legacy board. Instead:

- **The board shows two flows on one canvas:** the **legacy ERP flow** on the left and the **CIO design flow** on the right, each under a large, unmistakable section header (`LEGACY — ERP` / `CIO — DESIGN`) so a reader instantly sees which is which. A vertical divider or clearly separated x-ranges keep them from bleeding into each other.
- **Drawing a CIO board = adding a flow next to the existing legacy flow** on that cluster's board. The legacy flow is not redrawn or moved; the CIO flow is added beside it (its own generous x-range so the two never overlap — this is a fan-out-scale spacing job, see the no-overlap rules above).
- Each flow keeps its own three-layer treatment (business flow + Tech margin + purple message notes) and its own `BUILD REQUIREMENTS` / legend notes; label the notes per-flow so it's clear which flow a Tech-margin or message note belongs to.
- **This SUPERSEDES "Legacy vs CIO board separation (2026-07-08)"** below (separate boards in separate folders). Going forward there is one combined board per cluster; keep it in the pipeline-folder **root** (`KaSjst3hrHd5e9Yhou8RGm` for MV). Existing separate boards are being merged into combined boards; the combined board becomes the cluster's canonical board recorded in `boards.md` and the sheet's Whimsical column.
- **MCP `edit` is not available in this environment** → build the whole combined board in ONE `create` call (fetch both source boards first to preserve their verified content), and recover from any overlap with a single delete+recreate. Orchestrator independently verifies overlap-free at legible zoom (both flows + every fan-out + both note columns).
- **Use `create(type:'board')` — a FREEFORM board — NOT `type:'flowchart'` / group containers (Moe 2026-07-13).** A freeform `board` honors the explicit `x`/`y` AND note `width` you pass, so you can reproduce the three-column layout (Tech margin far left, flow center, WIDE ~300–560px message notes far right) and place the legacy/CIO halves in their own x-bands. Wrapping the flows in a `flowchart`-type group forces Whimsical's auto-layout, which **ignores your x/y and note widths** — it crushes the message notes into unreadable tall vertical strips and shrinks the flow to a tiny cluster (this happened once on Cluster 3, 2026-07-13, and had to be deleted+rebuilt). Place shapes, connectors, and sticky notes as individual free items at explicit coordinates.
- **Preserve source wiring exactly; never silently "fix" it.** If a source board has an omission (e.g. an unwired decision diamond), transcribe it as-is and add a small annotation flagging it for verification — do not infer and rewire.

## CIO board message-note format + build-requirements note (Moe 2026-07-08)

Every CIO design board's per-template message note follows this format:
- **Header line, bold:** `**<TEMPLATE_NAME> (<ID>)**` — template name, then its numeric ID in parens, bold. Keep a short role qualifier if useful ("— reminder R1", "— terminal success"). **Do NOT** write the channel/surface tag ("WhatsApp WABA", "SMS", "push", "HOME/INBOX") — channel is passthrough, not shown.
- **Sends line:** `Sends last 45d: <N> (<M> recipients)` — pulled from Snowflake `broadcasts_final_layer` (`COUNT(*)` + `COUNT(DISTINCT RECEIVER_MOBILE_NUMBER)` where `SENT_DATE >= DATEADD(day,-45,CURRENT_TIMESTAMP())`, by `TEMPLATE_ID` or name). This surfaces real volume next to each message so a reader sees which sends actually matter. (0 or "not tracked" for CC-app push templates absent from the broadcast layer.)
- Then the message body + `params:` line as before.
- A template that is **removed** (not sent in 2026, per `MV_TEMPLATES_REMOVED.md`) gets its note deleted, not enriched.

**One `BUILD REQUIREMENTS — Events & Attributes` note per CIO board** (green), listing everything needed to build the campaign: **EVENTS** (each new/reused event + key payload fields; "none — attribute-triggered" if so), **ATTRIBUTES** (synced vs sync-add, with `table.column` where known), **APIs**, and **TEMPLATE PARAMS** (`@param@` → source). This is the at-a-glance data-intake summary for whoever builds the campaign. The customerio-translator should produce both the per-note format and this note on every new CIO board.

## Folder discipline (agents MUST follow)

- **Never create folders, and never create a "master index" page or any board beyond the single one you were asked to draw.** Agents guessing/creating folders is what produced duplicate folders — don't.
- Create every board in the **exact Whimsical folder ID passed to you by the orchestrator**. If no folder ID was provided, STOP and ask — do not invent one.
- **Pinned pipeline folders** (canonical homes for generated boards, per Moe 2026-07-02):
  - MV-Clients → `KaSjst3hrHd5e9Yhou8RGm` ("CIO Pipeline — MV Clients")
  - CC-Clients → `Vg2CdPhEhFt1AWXHU3Ra4y` ("CIO Pipeline — CC Clients")
- **Legacy vs CIO board separation (Moe 2026-07-08):** legacy-flow boards (`<flow> (Legacy ERP)`) go in a **"Legacy ERP Boards"** subfolder *inside* the target's pipeline folder; CIO design boards stay in the pipeline-folder root. Create NEW legacy boards directly in the subfolder.
  - MV-Clients legacy subfolder → `9ka6KvrhJC3Zf3L6Te1Ar5` ("Legacy ERP Boards", inside `KaSjst3hrHd5e9Yhou8RGm`).
  - CC-Clients: create the equivalent subfolder inside `Vg2CdPhEhFt1AWXHU3Ra4y` when the next CC legacy board is drawn.
  - **MCP has no move op** — already-created legacy boards must be dragged into the subfolder by hand (Moe); only newly-created boards can be placed there directly via `parent_id`.
- **Disregard Moe's pre-existing MV draft work** (the "Customer IO - MV Clients" folder with the 17-flow "MV Client Message Flows — Master Index" and its "MV Flow —" boards). It is old drafts — never read it as truth, never write into it.
- Legacy-flow boards: name `<flow> (Legacy ERP)`. CIO design boards: names start with **CIO** (exact pattern TBD in customerio-conventions.md).
