
# Ask the Code

> **Part of the P&C audit pipeline.** `audit-pipeline` carries the whole arc — discover → specify → execute → hand over — and the five rules that hold at every stage. Read it if you are not certain which stage this request belongs to; starting in the wrong one wastes the session.


Query the ERP codebase in natural language. Two endpoints: submit a question, then poll for
the answer. A bundled script handles both.

## Get the token first

The API needs a bearer JWT that the user copies from their ERP Low-Code Platform session.
**Tokens expire within hours** — request one at the moment of use, not at session start.

Ask for it plainly: *"I need an Ask the Code bearer token to look up the ERP table names —
can you paste a fresh one?"*

Then export it for the session rather than pasting it into every command:

```bash
export ASK_THE_CODE_TOKEN="<paste jwt here>"
```

Never write the token into a file, a spec, an artifact, or a committed script. The script
decodes the token's `exp` claim locally and prints how long it remains valid, so an expired
token is diagnosed before it wastes a two-minute round trip.

## Run a question

Use the bundled script — it handles submit, the polling loop, the misleading
`"success": false` field, model refusal, and timeout:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ask-the-code/scripts/ask_the_code.py \
  -q "For an audit of maid salary payments, what are the native database table names storing payroll runs, per-maid salary amounts, and deductions? List table names and key columns only." \
  -m erp/magnamedia-payroll-management \
  --model composer-2.5
```

- `-m` takes comma-separated module aliases. `--all-modules` searches everything (slower).
- `-s <conversation_id>` asks a follow-up in the same conversation — use this rather than
  re-asking cold, so context carries over.
- **Always use an intelligent model.** Default `composer-2.5`. Only fall back to `auto` if
  the answer comes back containing "Cannot use this model" (the script exits 5 and tells you).

**Expect 30 seconds to 2 minutes per answer.** A verified run took 118 seconds. Do not
interpret slowness as failure; the script waits up to 3 minutes. Batch several data points
into one question rather than firing many sequential questions.

Read `references/ask-the-code--module-registry.md` to pick modules, and `references/ask-the-code--api-reference.md` for
raw endpoint details if the script cannot be used.

## How to ask well

The pipeline's standard discovery question, from the P&C process chart:

> For these specific data points in the following requested report, what are the native
> data table names in our database?

Make it answerable by adding the report context and the business definition of each data
point. A good question:

- Names the data points as **business concepts**, then asks for tables and columns.
- Asks for **key columns and join keys**, not prose.
- Asks for the **status/enum values** and what they mean, since audit filters depend on them.
- Asks **where the authorised value lives** (contract amount, price list, approval record) —
  that is what an audit compares actuals against.
- Constrains the output: *"List table names and key columns only, no explanation."*

Worked patterns:

| Need | Ask |
| --- | --- |
| Table discovery | "What are the native table names storing <concepts>? Table + key columns only." |
| Join path | "How do <table A> and <table B> join? Give the exact key columns and their types." |
| Enum semantics | "What are all possible values of `<TABLE>.<STATUS>` and what does each mean?" |
| Authorised amount | "Where is the contractually agreed <amount> stored, as opposed to the amount actually charged?" |
| Rule verification | "When a contract is cancelled mid-month, does the code pro-rate <amount>? Show the calculation." |
| Soft deletes / test rows | "Does `<TABLE>` keep deleted rows, and is there a flag marking test or fake records?" |

## Using the answers in a spec

- Record the table and column names **exactly as returned**, including case.
- The answer describes the **ERP operational database**, not Snowflake. A table existing in
  the ERP does not mean it is in Snowflake — it means the Snowflake team has a named source
  to ingest. Put these in the spec's ingestion-request section.
- Treat the answer as a strong lead, not gospel. It is generated from code and can miss a
  second table holding adjustments or overrides. Where a number matters, ask a follow-up
  that specifically probes for adjustment, override, correction, and reversal tables.
- If the ERP's actual behaviour contradicts what the requestor described, surface the
  contradiction to the user rather than silently adopting either version. That contradiction
  is often itself an audit finding.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Exit 2 | No token | Ask the user for a fresh one |
| "TOKEN EXPIRED" note | `exp` claim in the past | Ask for a fresh one |
| Exit 3, HTTP 401/403 | Token invalid or expired | Fresh token |
| Exit 4 (timeout) | Question too broad, or `--all-modules` | Narrow to specific modules, split the question |
| Exit 5 | Model unavailable | Retry with `--model auto` |
| Answer says the module has no such code | Wrong module chosen | Check the registry; try adjacent modules or `--all-modules` |
| `"success": false` in a raw call | Backend quirk, not an error | Success is `data.conversation_id` being present |
