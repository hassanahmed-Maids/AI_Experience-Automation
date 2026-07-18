# ERP → CustomerIO events (current inventory)

Source: "Customer IO Events" sheet, exported 2026-07-02. More events are pending — when a translation needs an event that doesn't exist, propose it as a NEW event (that's an accepted intake path, see customerio-conventions.md). Original sheet: https://docs.google.com/spreadsheets/d/1kP-GuXcIe4x9DAVu9V4o9plgWzE2fk2MkmZGyJTbK9c

## Relevant to migration (CC Clients and Maids workspace)

### TAXI — Live · ERP · target: clients & maids
Fired whenever a taxi work order is **Created / Cancelled / Closed / Rescheduled**. The workhorse event — used by all Taxi campaigns, Vacation campaigns, CC Application campaigns. Rich payload:
```json
{
  "EventType": "Creation",
  "arrivalTimeRange": "12:00 PM - 2:00 PM",
  "clientID": "302771", "clientName": "…",
  "contractID": "1100189",
  "housemaidID": "134521", "housemaidName": "…", "maidPhoneNumber": "…",
  "leaveOn": "2026-07-01T12:30:00+04:00",
  "pickupType": "TAXI",
  "purpose": "START_OF_CONTRACT",
  "taxiWorkOrderId": "371598",
  "taxiWorkOrderPurpose": "deliver_to_client",
  "taxiWorkOrderStatus": "PENDING",
  "status": "PENDING", "rideUrl": "", "maid_decision_option": "", "maid_decision_result": ""
}
```
Known `taxiWorkOrderPurpose` values (from Jira scope): deliver_to_client, pickup_from_client, providing_commuting_assistance, medical/EID, pickup_luggage_from_family.

### maid_returning_from_vacation_replacement_created — Live · ERP · target: clients
Sent when the replacement for a maid returning from vacation is created. Used by "Clients - CC - Vacation - Post Vacation".
```json
{ "maidId": "{{maidId}}", "type": "Original Maid Came Back From Vacation" }
```

### trainer_session — Live · ERP · target: clients
Trainer session Booked / Cancelled / Rescheduled. Used by "Clients - CC - Trainer - Pre-Visit".
```json
{ "maidId": "122609", "maid_name": "…", "session_id": "22377", "status": "booked", "trainer_id": "25", "training_date": "2026-07-01 13:00:00" }
```

### mediator_session — Live · ERP · target: clients
Same shape/semantics as trainer_session, for mediator sessions. Used by "Clients - CC - Mediator - Pre-Visit".

### MMR LLM Processing Finished — Live · n8n · target: clients
Sent by n8n when a GPT message finishes generating for the MMR flow. Payload: `{ time: "00:06" }`. Used by "Clients - Both - MMR".

## Sales workspace (context only — out of migration scope)

- `{{Campaign Name}} LLM Processing Finished`, `No History Returned`, `Carousel Processing Finished`, `No Carousel Returned` — n8n GPT/carousel plumbing for Sales campaigns.
- `DDC-TODO-CCtoMV` — ERP, CC→MV DDC todo opens (payload: clientId, contractId, ddcTodoId, maid info).
- `m30_prospect_interaction` — ERP, after qualifying inbound/outbound sales calls.

## Patterns to note for the translator

- ERP events carry **clientID + contractID + housemaidID** in the payload → campaigns keep full contract/maid context (unlike segment triggers).
- Event names have no enforced convention yet (UPPERCASE, snake_case, and prose all exist).
- One event covers a whole lifecycle (TAXI: create/cancel/close/reschedule distinguished by `EventType`/status fields) rather than one event per state.
