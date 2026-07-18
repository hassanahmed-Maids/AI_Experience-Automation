# Event design philosophy

When a campaign needs an ERP→CIO event (existing or newly proposed), it MUST follow these rules. Reusable across the migration pipeline (translator) and the go-live prep system.

## Principles

- **Simple and straightforward.** Events are NOT overloaded with complex booleans that give zero visibility into what's happening. Reading the event name + payload should immediately tell you what real-world thing occurred.
- **Keyed to the recipient of the campaign.** For client campaigns, `customer_id` = the clientId, so the client campaign's wait-until steps can react. (An event keyed to the maid can't drive a client campaign's wait-until.)
- **Minimal payload** — just the ids and the one or two fields needed to disambiguate (e.g. `maidId`, a human-readable `type`). No dumping of internal state.
- **Name describes the occurrence**, not an internal flag. `maid_returning_from_vacation_reserved_for_client` beats a boolean bag.

## Canonical shape

```json
{
  "customer_id": "{{clientId}}",
  "workspace": "Clients & Housemaids",
  "entity": "client",
  "event_name": "maid_returning_from_vacation_replacement_created",
  "event_data": { "maidId": "{{maidId}}", "type": "Original Maid Came Back From Vacation" }
}
```

## Trigger-signal selection (propose the better signal)

Prefer the signal that most directly and reliably represents the real-world moment:
- Replacement-created event of a clear `type` **over** waiting on a Complaint of a given type (the complaint is an indirect/weak indicator).
- If a moment can be expressed as an in-campaign **condition** rather than a new event, do that instead of adding an event. Example (maid overlap): don't emit an overlap event — branch on the condition "a maid exists on the contract that is not the returning maid, and both maids are absent from accommodation."

When a design picks a trigger, it must justify why that signal is the truest indicator, and flag any weak signal with a proposed better one.

### Event vs attribute trigger — don't reach for an event by default (2026-07-07, Replacement-Handover)

An event is warranted when the send is a **transient / source-gated / fire-in-the-moment** signal that stored state cannot express (e.g. a pre-create status snapshot; a send that happens post-gate at one code site with no lasting flag). It is **NOT** warranted merely because the relevant entity "has no CIO relationship / isn't synced today" — **the sync query can be extended** to carry the attribute. Before choosing an event:
- **Check for a persisted, once-per-event flag** the attribute trigger can key on. If ERP sets a purpose-built boolean at the exact mutation (e.g. `HOUSEMAIDATTENDANCELOGS.NEW_MAID_RETURNED`, set once at the returned-then-showed-up mutation, per-log, never overwritten), a sync-add + attribute trigger reproduces the once-fire behavior with no new event. Prefer it.
- **Never key an attribute trigger on an overloaded or mutable field** — one set in multiple unrelated code paths, or overwritten by later steps (e.g. `handOverSelectedMaid=2`, set in ~5 paths incl. an unrelated in-app choice, and later reset to 1). It causes false-positives, false-negatives, and double-fires. A per-row/per-event latch beats a standing mutable field.
- **If the send is genuinely fire-in-the-moment with no persisted trace, keep the event** (Replacement E3: no "found-in-attendance" flag exists; E2: the missed-pickup send is gated by live-in + new-maid-taxi-not-CLOSED + a template variant — the taxi status alone is overloaded/ambiguous). Justify by the transient/source-gate, not by reachability.

## Send timing

Events for a not-yet-live flow are drafted in the dev-validation task but only actually emitted **after the flow is validated** ("send only once the flow is validated"). The task states the events explicitly so devs wire them at go-live.
