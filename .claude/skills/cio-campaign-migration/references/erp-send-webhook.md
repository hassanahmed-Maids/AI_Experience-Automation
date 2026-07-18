# The ERP-send webhook (frozen send primitive)

On CIO a "send" is **not** a native message — it's a `webhook_action` that POSTs to
the ERP, and the **ERP** resolves the number and fires the WhatsApp/SMS. Channel is
pure passthrough: CIO never touches WABA templates, and the CIO template's
`whatsapp` flag is `false`. This is the single build primitive for every send node
in every cluster.

Reverse-engineered from a filled, code-true example (Kareem's Overstay-Fine loop,
`Send PAY_OVERSTAY_FINE_OUTSIDE_DUBAI_REMINDER_2`, template 723). Scaffold lives in
`assets/erp-send-template.json`.

## The call

```
POST https://erpbackendpro.maids.cc/clientmgmt/template-message/send-message?async=true
Content-Type: application/json
```

Body:

```json
{
  "templateName": "PAY_OVERSTAY_FINE_OUTSIDE_DUBAI_REMINDER_2",
  "target": [
    {
      "id": "{{ customer.id | remove_first: 'c_' }}",
      "entityType": "client",
      "mobileNumber_filler": "mws",
      "whatsappNumber_filler": "wms",
      "orderedDelivery": true,
      "skipAlreadyQueuedPhoneNumbersAllTemplates": true,
      "skip_time_interval": 10
    }
  ],
  "parameters": {
    "calculated_overstay_fine": "TBD_FRESH_API",
    "his/her": "{{trigger.hisHer}}",
    "link_to_main_tracker": "TBD_TRACKER_BASE/{{trigger.contractId}}",
    "link_to_Whatsapp": "TBD_STATIC_LINK"
  }
}
```

## How to build a send (in CIO, test env, draft)

1. Add a `webhook_action`, named `Send <ERP_TEMPLATE_NAME> (<ID>)` (match the board's
   send-node label — Layer-A QA and the deliveries `subject` rely on it).
2. On its linked **template** (`PUT /templates/:template_id`): set `template_type:
   "webhook"`, `request_method: "POST"`, `url` = the endpoint above,
   `headers: [{"name":"Content-Type","value":"application/json"}]`, and `body` = the
   JSON above with the three per-send slots filled. Keep `sending_state: "draft"`.

Only **three things** change per send — everything else is fixed boilerplate:

- **`templateName`** — the ERP broadcast template, verbatim (the migration unit).
- **`target[].entityType`** — `"client"` or `"housemaid"` (the campaign's target).
- **`parameters`** — the ERP template's `@param@` slots, each mapped to a source.

## Fixed boilerplate (carry unchanged unless the code says otherwise)

- `target[].id` = `{{ customer.id | remove_first: 'c_' }}` — strips the `c_` prefix
  off the CIO profile id to recover the raw ERP clientId (maids: `m_` → strip `m_`).
- `mobileNumber_filler:"mws"`, `whatsappNumber_filler:"wms"` — ERP-side number
  selection.
- `orderedDelivery`, `skipAlreadyQueuedPhoneNumbersAllTemplates`, `skip_time_interval`
  — ERP-side ordering / de-dup / throttle. (These are ERP execution controls, not
  CIO logic — don't try to reproduce them as CIO branches.)

## Filling `parameters` — the three sources (this is the attribute-map's job)

Each `@param@` from the board's PARAM MAP resolves to exactly one of:

1. **Event-carried** → `{{trigger.<field>}}` (the ERP→CIO event payload). Preferred
   when the value is known at the triggering moment.
2. **Synced profile / relationship attribute** → `{{customer.<attr>}}` (must exist in
   the live data-model snapshot; if not, it's a sync-add build dependency).
3. **Live-API or static** → a value fetched via an in-campaign API journey attribute
   (e.g. the overstay fine amount, `TBD_FRESH_API`) or static config (`TBD_TRACKER_BASE`,
   `TBD_STATIC_LINK`). These are exactly the params the board flags as needing an
   intake path.

## Hard rules

- **`TBD_` and unresolved `{{ }}` are build blockers.** An empty/unrendered param =
  a broken send (the ERP either fails or sends garbage). The fixture render check
  (`tdd-fixtures.md`) must show zero `TBD_` and zero unresolved liquid before done.
- **Draft only in test.** This webhook hits **prod ERP**. A `draft` webhook does not
  execute — which is exactly why shadow-mode reads would-sends via `deliveries?drafts=true`
  without sending. **Never set `sending_state: "automatic"` in the test env** — that
  fires real ERP sends. The human flips to automatic at publish, in prod.
- **entityType must match the target.** A client campaign sends `entityType:"client"`;
  wiring a maid id/type into a client campaign (or vice-versa) mis-delivers.
