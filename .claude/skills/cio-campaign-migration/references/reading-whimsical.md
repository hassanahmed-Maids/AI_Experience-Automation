# Phase 1 — Reading the Whimsical board → build spec

The board is one logical journey drawn twice on ONE canvas: a `LEGACY — ERP` half
(left) and a `CIO — DESIGN` half (right), split by a vertical divider. Your goal
is not to admire the drawing — it's to extract a **complete, unambiguous build
spec** that Phase 2 builds from and Phase 3 verifies against.

## Which board — the canonical link, never a search

**The board is the exact Whimsical link the human handed you (via the master).** The
workspace has multiple draft copies of every journey — `Customer IO - MV Clients`
and `MV Client Messages V2` are old draft folders, and even the live pipeline folder
has superseded/dated duplicates. So:

- Fetch the board by the **ID in the provided link**. **Never** `Whimsical:search` or
  `file_tree`-browse to "find" the board — title-matching reliably grabs a stale draft
  and builds the wrong thing *silently* (the draft is real and reads plausibly).
- A link may be a **file** URL (`whimsical.com/<slug>-<ID>` → the trailing token is the
  board id, pass it straight to `fetch`) or carry a `?bo=` / node fragment (pointing
  *inside* a board) — always fetch the **parent board**, not just the fragment.
- **Two sanity checks on open** (to catch a bad *paste*, not to override the human):
  confirm the board actually has both a `LEGACY — ERP` and a `CIO — DESIGN` side, and
  that its cluster label matches the cluster you were told to build. If a link 404s or
  clearly isn't a combined cluster board, **stop and ask the human** — do not wander off
  to find a substitute.

The board is authored to the team standard in `docs/whimsical-standards.md` (load
as project knowledge) — read it for the full conventions. The parts you rely on:
- **Three-layer treatment per flow:** business flow (center), a **Tech margin**
  (raw attribute/entity conditions, far left) backing each business condition,
  and **purple message notes** (far right). Business wording lives in the flow;
  obscure entities live in the Tech margin (the judgment/obscurity rule).
- **Message-note format:** header `**<TEMPLATE_NAME> (<ID>)**`, then
  `Sends last 45d: N (M recipients)` (from Snowflake), then body + `params:`.
  Channel is NOT shown (passthrough).
- **One green `BUILD REQUIREMENTS — Events & Attributes` note** per CIO flow:
  EVENTS, ATTRIBUTES (synced vs sync-add, with `table.column`), APIs, TEMPLATE
  PARAMS (`@param@` → source). This is your data-intake summary — lean on it.
- **In-export vs pulled-in markers:** send nodes are marked (e.g. `✔ [EXPORT]`
  vs `＋ [NOT IN EXPORT]`) with a legend. Only in-export templates are in scope;
  pulled-in ones are drawn for journey completeness but may lack message text.
- **Preserved-as-is wiring:** the board transcribes source quirks (e.g. an
  unwired decision) with a flag rather than silently fixing them — don't assume
  an annotated gap is an error to route around; confirm it.

## How to pull the board

```
Whimsical:fetch(id=<board-id from the provided link>, detail="simple", limit=200)
```
- The `id` is the last path segment of the provided whimsical.com URL
  (e.g. `.../cluster-1-...-RxRjL1s6mx5RrvguNPx2Hi` → `RxRjL1s6mx5RrvguNPx2Hi`) —
  from the human's link, never from a search.
- Compound flowcharts show as summaries ("… (14 shapes)"). To read their inner
  nodes, re-fetch with `scope:<flowchart-id>`.
- Use `grep_text:["EXIT","trigger","link","4625"]` etc. to locate nodes fast.
- Use `image:true` if the spatial layout (which send follows which wait) is
  ambiguous from text alone.
- `Whimsical:edit` IS available here (add/update/delete/find_replace + `auto_layout`)
  if you ever need to annotate the board — but you rarely edit; the drawing is done
  and the CIO side is the contract.

## The board's anatomy (what each region means)

Each half contains, in columns:

| Region | Side | What it tells you |
|---|---|---|
| **Tech (raw conditions)** flowchart | both | ERP: the real code behaviour. CIO: the journey you must build. |
| **Message content** notes | both | The actual template bodies, IDs, params, and send counts. |
| **BUILD REQUIREMENTS** node | CIO | Events / attributes / template params / APIs the build needs. |
| **PARAM MAPPING** node | CIO | `@erp_placeholder@ → {{cio.liquid}}` for every template variable. |
| **Attribute VALUES** node | CIO | Exact enum values CIO branches on (e.g. status `POSTPONED`). |
| **Fidelity / clock notes** | CIO | Where and why CIO intentionally differs from ERP. |

The CIO side is usually split into named **CAMPAIGN 1 / CAMPAIGN 2 …** blocks —
each is a separate CIO campaign, but together they're one journey. Read the
"Two campaigns = ONE logical journey" style note to understand how they relate.

## Node types you'll meet on the CIO side

- **ENTRY / trigger** — how a profile enters. Two common shapes:
  - *Relationship-attribute trigger* — enter when a related object's attribute
    hits a value (e.g. client linked to a Contract where `status=POSTPONED AND
    type=MV`). Note the object type and the exact match values.
  - *Attribute-change trigger* — enter on a transition (e.g.
    `status POSTPONED → ACTIVE`). Fires for *every* path that causes the change.
- **Wait** — a delay before the next send. **Read the clock-anchor fidelity
  note**: CIO usually measures waits from ENTRY, while ERP may bucket from a
  different timestamp (e.g. `creationDate`). Build what the CIO side says.
- **Send** — a message. Capture: template ID, channel (WABA / SMS / push —
  respect FORCED-channel notes), body, and every param.
- **Exit / global exit** — conditions that remove a profile (proceed / cancel /
  expiry / status leaves the trigger value). Capture every one; missing an exit
  is how people get double-messaged.
- **Dropped-artifact notes** — ERP mechanics deliberately NOT rebuilt (e.g. a
  CSV "already-sent" dedup guard replaced by CIO's once-per-wait semantics).
  Confirm you understand *why* it's safe to drop, then drop it.

## The build spec you produce

Write it into the migration record. It must answer all of the following with no
"figure it out later":

```
TRIGGER
  - type: relationship-attribute | attribute-change | event
  - object / person scope: <e.g. person type=client, Contract objectTypeId=2>
  - enter when: <exact condition + exact attribute VALUES>
  - source of attributes: <synced? which object? verified where?>

FLOW (ordered)
  - wait <offset, anchored on ENTRY unless note says otherwise>
  - send <template id> · channel <…> · params <…>
  - (repeat; note any offsets with NO configured message = no step)

EXITS
  - <transition> → <exit behaviour>  (list every one, incl. global exits)

BUILD REQUIREMENTS
  - events: <list or "none — attribute-triggered">
  - attributes: <each, with synced? and exact values>
  - template params: <each, with fill source>
  - APIs / new events: <list or none>

PARAM MAP
  - @erp@ → {{liquid}}   (one line per variable; flag any GAPs)

OPEN UNCERTAINTIES
  - #N: <what's unconfirmed> — how to confirm (usually a Snowflake query)
```

## Reading discipline

- **Read both halves.** The ERP side tells you *what correct looks like* so
  Phase 3 has a ground truth. Don't skip it.
- **Copy exact values.** Enum casing matters (`POSTPONED`, not `postponed`).
  Template IDs matter. Channel-forced notes matter.
- **Treat every `@param@` as unresolved until it's in the PARAM MAP** with a
  concrete fill source. `link` variables are a frequent trap — some are static
  URLs, some are per-record deep-links that aren't in the sync and need an
  intake path. The board flags these; carry the flag forward.
- **Every "confirm at build / go-live" becomes an Open Uncertainty** with a
  planned check. Nothing gets silently assumed true.
