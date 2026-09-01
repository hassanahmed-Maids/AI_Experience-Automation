# Offline fixtures — pinned-data testing

`make-fixtures.js` generates the pinned data for testing the n8n flow **without
touching production ERP**. Regenerate with:

```
node make-fixtures.js > happy.json
```

It is deterministic — no randomness, no clock — so the generator is the source of
truth and `happy.json` is a build artifact (gitignored).

## What the fixture is built to exercise

| Rows | Expected outcome |
|---|---|
| 250 at exactly the era base | `clean` · *One application, one price* |
| 4 above base | `pending`, capped — the fines record is refused |
| 1 repeat 80 days after a prior | **`finding`** · *Duplicate application* |
| 1 repeat 140 days after a prior | `pending`, **no spec verdict word** — only the visa request could settle it |
| 1 `purpose = Entry Visa` | `pending` · *Misfiled charge* (Order 25) |
| 1 with no maid id | `inconclusive` · *Identity unresolved* |
| 1 negative amount | `pending` · *Negative amount* |
| 1 unreadable amount | `pending`, **no spec verdict word** |

Validated against the local scorer before use: 250 clean / 8 pending / 1 finding
/ 1 inconclusive / 6 needing a verdict word.

## Two things worth knowing

**The rows are slim on purpose.** Each carries only the fields the flow reads.
The full 157-field ERP row shape was already exercised against real payloads by
`scorer/verify-generated.js`; repeating it here would add bulk and prove nothing.

**260 population rows is not arbitrary.** `Verify Population Pull` refuses a
cohort below 250, because a real month runs 303–1,040 and a short one is a query
bug. The fixture is built to clear that floor — the floor is **not** lowered to
fit the fixture, which is the wrong way round and is what the guard exists to
stop.

## Nodes that must be re-enabled after offline testing

Pinning covers trigger, credentialled and HTTP nodes. It does **not** cover the
ERP lease or the data-table writes, which have no credentials and would execute
for real, so offline runs disable them:

- `Acquire ERP Lease`, `Release ERP Lease` — would take a real lease
- `Write Run`, `Write Cases` — would write real rows
- `Webhook` — disabled so `test_workflow` starts from the Manual Trigger

**All five must be re-enabled before handover.** Both data-table writes were
already exercised by live runs 110429 and 110690.
