# CIO platform reference (frozen) + live data-model snapshot

Stable, product-level facts verified from CIO's own API skills (`cio_skills_read
fly-api/*`) and the live workspace. These don't drift, so they're frozen here.
The **data model** does drift — pull it live each run (last section).

## Campaign trigger types — the `type` field

The eight UI trigger tiles map to `type`. **`type` is immutable after creation** —
wrong type = delete and rebuild the whole campaign, so choose deliberately.

| UI tile | `type` | Key fields | Notes |
|---|---|---|---|
| Attribute or Segment | `seg_attr` | `trigger` (raw JSON object) | The supported segment/attribute path. **Never `behavioral`** (deprecated, agent-created ones are rejected). |
| Event | `transactional` | `event` (+ optional `attribute_filters`) | Event-triggered *workflow* (not a standalone transactional message). |
| Important date | `date` | `date_triggered_attribute/frequency/start_time/zone/fallback_zone/lead_days` | frequency = once/monthly/yearly. |
| Form submission | `form` | `event` | |
| Contract updated | `object` | `object_campaign` (+ `object_attribute_triggers`), `audience` | **Related audience only** (Self → 400). Attribute-change trigger **must** be `type: "Updated"` or it silently matches no one. |
| Profile added to Contract | `object`/`relationship` | as above | "profile added to a contract" = a relationship/object event. |
| Relationship changed | `relationship` | `relationship_campaign`, `audience` | May use Self (the person whose relationship changed). Re-entry is always `rematch` (don't set `restart_mode`). |
| Webhook | `webhook` | `webhook_id` | API-triggered broadcast. |

Our default per `docs/customerio-conventions.md`: **relationship-attribute trigger**
for contract/maid-state client messages; event trigger next; avoid segment triggers
(they lose contract/maid context).

## Setting the trigger (recipients write is a FULL REPLACE)

All trigger/targeting changes: `PUT /campaigns/:id` with `update_type: "recipients"`.
A `recipients` write **rebuilds targeting from the body** — a field required for the
`type` is 422 if omitted; every other field is **silently reset**. So on an existing
campaign: **GET first, change one field, resend the full field set for that `type`.**
`seg_attr` targeting lives entirely in `trigger` (don't send `filters`).

`trigger` is a raw JSON **object** (not a string — double-encoding → 422). Its shape
wraps each condition: `{"and":[{"attribute":{"field":"status","operator":"eq","value":"POSTPONED"}}, {"segment":{"id":N}}]}`. Add `"inverse":true` to negate.

## Action types

- **Message/send:** for us this is almost always `webhook_action` → the ERP call
  (`erp-send-webhook.md`). (`email_action`, `twilio_action`, `whatsapp_action`, etc.
  exist but we don't use native channels — the ERP sends.)
- **Delays:** `delay_seconds_action` (`delay` secs), `delay_time_window_action`
  (`start_time`/`end_time`/`days`/`zone`+`fallback_zone`; use `customer_time_zone`
  for Dubai-day logic), `randomized_delay_action` (`min_delay`/`max_delay`).
- **Wait Until:** `conditional_wait_action` — holds until a condition or timeout.
  This is what ERP "Wait Until <event/state>" maps to. `exit_type: "never"` (delay=0,
  wait forever) or `"continue"` (delay>0, timeout branch). `"leave"`/`"exit"` don't
  exist (422). Supports `foreign_event` + `message` conditions (branches don't).
- **Flow control:** `conditional_branch_action` (T/F, singular `conditions`, exactly
  2 edges), `multi_split_branch_action` (`multi_conditions` array, N+1 edges, first
  match wins, last = default), `random_cohort_branch_action`.
- **Data ops / AI:** attribute-update, create-event, `llm_action`, etc. (see
  `cio_skills_read fly-api/data_operations.md` when needed).
- **System (auto-created, never create):** `exit_action`, `trigger`.

`type`/`sub_type` are immutable (changing → 500). `sending_state`: `"draft"` (our
default — a draft webhook does NOT fire) or `"automatic"` (fires — **never in test**).

## Edges, convergence, and exits (the graph rules)

`add_actions`/`delete_actions`/`edges` **replace the entire edge list** — always
resend all edges. New action needs an incoming edge (reroute an existing edge
through it) or you get `"graph has more than one root"`.

- Non-branch, non-exit action = exactly **1** outgoing `continue` edge.
- T/F branch = exactly 2 `branch` edges (index 0 matched / 1 not). Multi-split =
  `len(conditions)+1` edges.
- **Branch convergence:** all continuing branches must reconverge at the same
  downstream action. A branch is exempt only if it goes to a **dedicated `exit_action`
  with no other incoming edge**. **The "free" exit is a trap:** routing a branch to
  the campaign's existing exit that another path already flows into gives that exit a
  second incoming edge → convergence fails (422/409). **Create a NEW `exit_action`
  per exiting branch.**
- **Exit conditions:** `update_type:"exit_conditions"` + `global_exit_conditions`
  (array of `Filter` objects, e.g. `[{"segment":{"id":10}}]`; event exits
  `{"event":{"etype":ID}}`). `exit_on_trigger_or_filter_not_matched` for
  "leave when they no longer match". Malformed → silently `null`.

## Condition encoding (the silent-failure minefield)

Two different encodings — do not mix them:

- **`trigger`** (seg_attr) and **`attribute_filters`** (event campaigns) are **raw
  JSON objects**. `attribute_filters` root must be `{"and":[…]}`/`{"or":[…]}`/ a bare
  `{"field":…}` / an `attribute_compare` node / `{}` — **never a top-level array**.
- **`conditions`/`multi_conditions`/`preconditions`/`filters`** are **base64 of
  URL-encoded JSON**: `base64(encodeURIComponent(JSON.stringify(x)))`. Plain base64
  (skipping URL-encode) is accepted but decodes empty.
- The attribute key is **`field`**, never `attribute` (wrong key → blank field name,
  silent no-match).
- **Campaign action conditions are a FLAT ARRAY** `[{"type":"attribute","field":…,
  "operator":…,"value":…}]` — NOT the segment condition tree (using segment-style →
  500). Types: `attribute`, `segments_negatable`, `event_attribute`, `object_attribute`
  (+`type_id`), `relationship_attribute` (+`type_id`), `device_attribute`;
  `foreign_event`/`message` are **Wait-Until only** (500 in branches).
- Operators: `eq !eq exists !exists gt lt bw`(+`value2`)`contains !contains`; dates
  `timestamp_gt/lt` (relative secs), `timestamp_gta/lta` (absolute unix), `timestamp_bw`.
- **Values matter, casing doesn't:** CIO string equality is case-insensitive, but
  format / whitespace / enum-ordinal / boolean-polarity mismatches DO break matching.
  Pin the exact synced value (from the sync query text or `mmdb`).

## Other build gotchas

- `add_actions` may return **500 but actually succeed** — re-read the campaign before
  retrying (don't create duplicates).
- Editing a campaign in `stopping` state → 422; wait for `stopped`.
- Campaigns list paginates **20/page** (`page`, 0-based); filter by tag via
  `searchTagIds[]` in `--params`, never by name.
- **Canvas sticky notes:** `POST /campaigns/:id/notes` annotates the workflow canvas
  (set `position.relative_to.id` to a node, e.g. `"-1"` = trigger). Use for a build
  note in CIO itself, not just Whimsical.
- Verification endpoints: `deliveries?drafts=true` (would-sends), `campaigns/:id/metrics`,
  `campaigns/:id/action_status`, `subjects`, `journey_attributes`, `subjects/:id/force_exit`.

## Live data-model snapshot (pull once per run, share across roles)

The data model drifts per environment, and **the test env is NOT a faithful mirror**
of prod (its attribute/event lists are polluted with manual demo + journey-generated
data). So each run, snapshot the live model to disk and treat it — plus the sync
queries and object `sent_attributes` — as ground truth, never the test env's loose
lists.

```bash
# object types → real ids + synced object AND relationship attributes
cio api /v1/environments/216662/object_types --jq '.object_types[] | {id, name, enabled, sent_attributes, sent_rel_attributes}'
# events known to the workspace (do NOT hit /data_index/events — it queues an export)
cio api /v1/environments/216662/event_names
# segments
cio api /v1/environments/216662/segments --jq '.segments[] | {id, name}'
```

Verified facts (env 216662, confirm each run — they move):
- **Contract object = `id: 1`** here (Companies = 2, disabled). The docs' "objectTypeId=2"
  is wrong for this env. **Read the id live per environment before wiring an object /
  relationship trigger.**
- The Contract object **does** sync `type` (MV/CC), `status`, `startdate`/`enddate`,
  `current_visa_step`, `visa_step`, `first_payment_received_card`, `name`, plus a rich
  set of relationship attributes (`visa_documents_status`, `documents_status`,
  `visa_last_day`, `client_location`, `maid_presented_at_center`, loop counters, …).
- `maid_first_name` is not synced in test — a send that needs it may need a sync-add;
  confirm against the sync query / prod.
- Reverse-ETL freshness ≈ 2 min — never design for sub-minute freshness.

**Convention to adopt:** document every sync-add / journey attribute with its cluster
+ purpose in the attribute's CIO description (the workspace already does this, e.g.
"…— Cluster 16 primary exit"). It makes the data map self-describing.
