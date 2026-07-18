# Ask-the-Code API (ERP code-LLM)

The ONLY source of truth for how templates are sent. The ERP codebase is NOT available locally — all code questions go through this API. Credentials live in `.env` (`ERP_AUTH_TOKEN`, `ERP_SECC_PLATFORM`) — never hardcode them in prompts or agent files.

Base URL: `https://erpbackendpro.maids.cc`

## Flow (submit → poll → read)

1. **Submit** — `POST /lowcode/c2d/query/async` with the question. Response contains `request_id` and `data.conversation_id`. NOTE: `success` may be `false` even on success — the request succeeded iff `data.conversation_id` is present.
2. **Poll** — `GET /lowcode/c2d/session/{conversation_id}/messages?page=0&size=20` every 2s. Answer ready when an assistant message has `request_status = 2` and matching `request_id`. Messages are newest-first. `scripts/ask-code.sh` waits up to **600s** by default (override: `ASK_CODE_TIMEOUT=<seconds>`); heavyweight multi-template questions can take >3 min — prefer smaller focused questions, and if a call times out the conversation KEEPS processing server-side: re-poll the same conversation_id later instead of re-asking.
3. **Read** — answer is Markdown in `content`.

## Headers (both calls)

```
Authorization: $ERP_AUTH_TOKEN        (already includes "Bearer ")
secc-ch-ua-platform: $ERP_SECC_PLATFORM
pageCode: lc_conversation
Content-Type: application/json       (submit only)
```

## Submit body

```json
{
  "question": "...",
  "project_alias": ["erp/magnamedia-payroll-management"],
  "model": "composer-2.5",
  "repo_type": "erp",
  "multi_workspace": true,
  "manual_rule_ids": [],
  "session_id": 18154
}
```

- `model`: always use `"claude-opus-4-8-high"` (valid even though the guide only lists `composer-2.5`/`auto`). If an assistant message contains "Cannot use this model" → retry with `model: "auto"`.
- `project_alias: []` = search ALL modules.
- `session_id` (optional) = continue an existing conversation (multi-turn follow-ups). Poll the same `conversation_id`.

## Module targeting strategy

The xlsx `Module` column is a HINT of unknown accuracy. Strategy: start the interrogation by validating it — ask which module actually defines/sends the template. If the hinted module comes up empty or incomplete, widen to `[]` (all modules).

## Out-of-scope templates

Templates sent from n8n flows, or not found in the ERP code at all, are DISMISSED from the automated pipeline → write them to a manual-review list for Moe. Do not attempt to interrogate or translate them.

## Example curls

Submit:
```bash
curl -X POST https://erpbackendpro.maids.cc/lowcode/c2d/query/async \
  -H "Content-Type: application/json" \
  -H "Authorization: $ERP_AUTH_TOKEN" \
  -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
  -H "pageCode: lc_conversation" \
  -d '{"question":"How does X work?","project_alias":[],"model":"composer-2.5","repo_type":"erp","multi_workspace":true,"manual_rule_ids":[]}'
```

Poll:
```bash
curl -s "https://erpbackendpro.maids.cc/lowcode/c2d/session/CONV_ID/messages?page=0&size=20" \
  -H "Authorization: $ERP_AUTH_TOKEN" \
  -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
  -H "pageCode: lc_conversation"
```

## Modules (project_alias values)

ERP (Java/Spring):
| Module | alias |
|---|---|
| Accounting | erp/magnamedia-accounting |
| Admin | erp/magnamedia-admin |
| AI Analytics | erp/ai-analytics |
| Chat AI | erp/chatai |
| Chat CC | erp/chatcc |
| Client Management | erp/magnamedia-client-management |
| Complaints | erp/magnamedia-complaints |
| Freedom Operator | erp/magnamedia-freedom-operator |
| Housemaid Management | erp/magnamedia-housemaid-management |
| Low Code Platform | erp/low-code-platform |
| Payroll Management | erp/magnamedia-payroll-management |
| Public | erp/magnamedia-public |
| Recruitment | erp/magnamedia-recruitment |
| Reporting | erp/magnamedia-reporting |
| Sales | erp/magnamedia-prospects |
| Visa | erp/magnamedia-visa-processing |
| Yaya Bot | yaya-bot |

n8n workflows: `n8n-flows/prod_analysis`, `prod_automation`, `prod_broadcast`, `prod_delighters`, `prod_maidsat`, `prod_main`, `prod_resolvers`, `prod_sales`, `staging_main`

External projects: `external-projects/liveout-webapp`, `contractidchecker`, `mmm`, `chatbot-llm-usage-dashboard`, `notifiers-bot`, `promoter-app`, `carely`, `part-time-cleaners`

## Verified behavior (tested 2026-07-02)

- Single question round-trip works end to end via `scripts/ask-code.sh` (submit → poll → Markdown answer with class names + line numbers).
- `model: "claude-opus-4-8-high"` is accepted.
- **Parallelism: at least 3 simultaneous conversations complete successfully.** Safe default: run up to 3 in parallel (one per template), each in its own session.
- Answers cite real code locations (e.g. `MessageTemplateCode` line 580) — demand citations in every question.
- The xlsx `Module` hint proved accurate in the first test (visa → `erp/magnamedia-visa-processing`), but keep validating per template.
- **Module-visibility hazard (2026-07-03, hit twice):** a session may silently NOT see a module (e.g. `magnamedia-complaints`) and confidently return "template doesn't exist / is dead" — this produced wrong verdicts twice on the Replacement-Handover cluster. Even `project_alias: []` (all modules) once claimed complaints was unavailable. Rule: **never accept a negative ("not found/dead") verdict unless the session was explicitly pinned to the module that plausibly owns the code**; re-ask with the specific alias before believing a negative.
- **Session note (2026-07-03):** the submit endpoint returns a NEW `conversation_id` on every call even when you pass `session_id` — conversation *context is still retained* (follow-ups work), but do not assume the printed SESSION_ID equals the one you sent. Track by the request you made, not by matching the returned id.

## Local code snapshot — FALLBACK ONLY (governance, 2026-07-10)
A read-only ERP code snapshot may exist at `~/Desktop/magnamedia` (a checkout that is months old). Use it **only** when this ask-code API is down, and treat it as a hint, not truth. **The live ask-code API is always the source of truth.** On any snapshot-vs-live disagreement, live wins — do NOT reconcile to the snapshot. Verified example (2026-07-10): `MaidVisaJ2MessageService.isWithinReminderThreshold` was `diff >= 0 && diff < threshold` in the snapshot but `diff < threshold` live — opposite after-the-date behavior; live was authoritative. When the API is down, state findings as "per an older local snapshot, pending live confirmation."
