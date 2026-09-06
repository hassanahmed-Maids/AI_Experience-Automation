# Ask the Code — Raw API Reference

Use the bundled `scripts/ask_the_code.py` in normal operation. This reference is for
debugging, for environments without Python, and for building other tooling.

Base URL: `https://erpbackendpro.maids.cc`

## Headers

| Header | Required | Value |
| --- | --- | --- |
| `Authorization` | Yes | `Bearer <jwt>` |
| `pageCode` | Yes | `lc_conversation` (literal) |
| `Content-Type` | Yes on POST | `application/json` |
| `secc-ch-ua-platform` | **No** | Session value. The original guide lists this as required, but submit and poll were both verified working without it. Send it if a call ever 401s with a valid token. |

The token is a JWT with claims `user`, `device`, `iat`, `exp`. Decode `exp` to check validity
before spending two minutes on a call.

## 1. Submit a question

```
POST /lowcode/c2d/query/async
```

Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | Yes | Natural language |
| `project_alias` | string[] | Yes | Module aliases; `[]` searches all modules |
| `model` | string | Yes | `composer-2.5` (intelligent, preferred) or `auto` |
| `repo_type` | string | No | `erp` (default) |
| `multi_workspace` | boolean | No | `true` (default) |
| `manual_rule_ids` | number[] | No | `[]` |
| `session_id` | number | No | Existing `conversation_id`, for follow-ups |

```bash
curl -X POST https://erpbackendpro.maids.cc/lowcode/c2d/query/async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ASK_THE_CODE_TOKEN" \
  -H "pageCode: lc_conversation" \
  -d '{
    "question": "Which tables store per-maid salary deductions?",
    "project_alias": ["erp/magnamedia-payroll-management"],
    "model": "composer-2.5",
    "repo_type": "erp",
    "multi_workspace": true,
    "manual_rule_ids": []
  }'
```

Response:

```json
{
  "success": false,
  "request_id": 340000000243493,
  "message": "Workflow task queued for execution (task_id: ...)",
  "data": { "conversation_id": 45522 }
}
```

**`success` is `false` even on success.** The request succeeded if `data.conversation_id`
is present. Save both `conversation_id` (for the poll URL) and `request_id` (to identify
your own answer in a multi-turn conversation).

## 2. Poll for the answer

```
GET /lowcode/c2d/session/{conversation_id}/messages?page=0&size=20
```

```bash
curl -s "https://erpbackendpro.maids.cc/lowcode/c2d/session/45522/messages?page=0&size=20" \
  -H "Authorization: Bearer $ASK_THE_CODE_TOKEN" \
  -H "pageCode: lc_conversation"
```

Response (newest first):

```json
{
  "page": 0, "size": 20, "total_elements": 2, "total_pages": 1,
  "messages": [
    {
      "id": 237073,
      "role": "assistant",
      "content": "This ERP module is the company's payroll management system: ...",
      "request_status": 2,
      "request_id": 340000000243493,
      "created_at": "2026-09-02 14:55:02",
      "feedback": "NONE"
    },
    {
      "id": 237072,
      "role": "human",
      "content": "What is this ERP module about?",
      "request_status": "",
      "request_id": 340000000243493
    }
  ]
}
```

The answer is ready when a message has `role: "assistant"` **and** `request_status: 2`.
The answer text is Markdown in `content`.

## Polling rules

| Condition | Action |
| --- | --- |
| Assistant message with `request_status == 2` | Stop; read `content` |
| `content` contains "Cannot use this model" | Stop; retry with `model: "auto"` |
| 180 seconds elapsed with no completed answer | Stop; report timeout |

Interval: 2 seconds. Max wait: 180 seconds. A verified real answer took **118 seconds** —
budget for that and do not treat a slow response as a failure.

## Gotchas that cost time

- **Pretty-printed JSON.** Responses come back with spaces around colons
  (`"request_status" : 2`). Naive `grep '"request_status":2'` never matches. Parse JSON
  properly rather than grepping — this exact bug produced a false "still waiting" loop
  against an answer that was already complete.
- **`request_status` is `""` on human messages**, not `0`. Filter on `role == "assistant"`
  before reading it.
- **Follow-ups share a conversation**, so several assistant messages accumulate. Match on
  your own `request_id` to read the right one.
- **A missing table in the answer is not proof of absence.** Adjustment, override,
  correction, and reversal tables are frequently omitted unless asked for by name.

## 3. Follow-up question

Same POST, plus `session_id` set to the previous `conversation_id`. Poll the same
conversation again.

```bash
python3 ask_the_code.py -q "Now give me the join keys between those tables." \
  -m erp/magnamedia-payroll-management -s 45522
```

## Scope reminder

Answers describe the **ERP operational codebase and its database**. They say nothing about
what exists in Snowflake. Confirming a table here means the Snowflake team has a named
ingestion source — it does not mean the data is queryable in Snowflake today.
