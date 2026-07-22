---
# ─────────────────────────────────────────────────────────────────────────────
# AUDIT CHECK SKILL — STANDARD TEMPLATE  (v1.0)
# Police & Control Dept. · maids.cc
#
# One file = one audit check. The agent (Claude) reads this skill at runtime to:
#   1. trigger the check's n8n flow on schedule,
#   2. receive the flow's red flags, and
#   3. investigate each red flag against the ERP to decide whether it is a
#      GENUINE issue or a LEGITIMATE exception — the reasoning a human used to do.
#
# The flow does the deterministic maths. This skill does the judgement.
# Fill every field. Leave nothing as "TODO" in a published skill.
# ─────────────────────────────────────────────────────────────────────────────

id: <machine_id>                 # stable slug, e.g. same-day-recruitment-fee
name: <Human Readable Name>
version: 0.1.0                    # bump on any logic change; see Change Log
status: draft                    # draft | in_review | active | deprecated
owner: <name / squad>            # who owns the rules in this file
manual_source: <person/role>     # the auditor whose knowledge this encodes

# ── The flow this skill drives ───────────────────────────────────────────────
flow:
  workflow_name: <n8n workflow name>
  webhook_method: POST
  webhook_path: <path>           # e.g. same-day-recruitment-fee-audit
  webhook_url: <full url or {{BASE}}/webhook/<path>>
  response_mode: async_callback  # flow returns 200 immediately, POSTs results to callback_url

# ── When the agent runs this check ───────────────────────────────────────────
schedule:
  cron: <cron or plain english>  # e.g. "0 6 1 * *"  (06:00 on the 1st, Asia/Dubai)
  timezone: Asia/Dubai
  default_window: <how to derive audit_window at run time, e.g. "previous calendar month">

# ── Request the agent sends to the flow (trigger contract) ───────────────────
# Mirror the flow's Validate-Inputs requirements EXACTLY. Anything the flow
# rejects as missing/invalid belongs here.
trigger_payload:
  required: [check_id, run_id, callback_url, audit_window, auth]
  audit_window: '{ "kind": "month", "year": <yyyy>, "month": <1-12> }  OR  { "kind": "date_range", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }'
  auth: '{ "erp": { "token": "Bearer <jwt>", "device_id": "<optional; else decoded from jwt>" } }'
  params: <check-specific params object — list each one and its meaning below>

# ── What the flow returns (result contract) ──────────────────────────────────
# The agent consumes result_data.checks[].red_flags[]. Every red flag is one
# work item. reason_code selects which investigation playbook to run.
result_contract:
  callback_fields: [check_id, run_id, result, result_data, warnings, notes, completed_at]
  work_items_path: result_data.checks[0].red_flags   # array of red flags to investigate
  work_item_key: reason_code                          # drives the playbook selection

# ── Verdict the agent must emit per red flag (output contract) ───────────────
# This is what the portal ingests. Keep it identical across all skills.
verdict_schema:
  per_flag:
    contract_id: <string>
    reason_code: <string>          # echoed from the flow
    verdict: <confirmed | exception | needs_human>
    exception_type: <string|null>  # which legitimate exception, if verdict=exception
    confidence: <0.0 - 1.0>
    evidence: [<{source, query, finding} objects>]   # what was checked + what was found
    reasoning: <short natural-language justification>
    checked_at: <ISO timestamp>
  run_rollup:
    total_red_flags: <int>
    confirmed: <int>
    dismissed_as_exception: <int>
    escalated_to_human: <int>

# ── Guardrails ───────────────────────────────────────────────────────────────
guardrails:
  min_confidence_to_auto_dismiss: 0.85   # below this -> needs_human
  never_auto_dismiss: []                 # reason_codes that ALWAYS go to a human
  on_missing_data: needs_human           # if ERP data is incomplete/ambiguous
  on_erp_error: escalate                 # never guess through an ERP failure
---

# <Human Readable Name>

## 1. Purpose
<One short paragraph: what this check verifies, and why a miss matters (money at
risk, compliance, etc.). Plain language — an auditor should recognise it instantly.>

## 2. How the automated flow decides a red flag
<2–4 sentences describing the deterministic rule the flow applies, so the agent
knows what has ALREADY been checked and must not re-litigate. Link to the reason
code catalogue below.>

## 3. Reason code catalogue
Every value `reason_code` can take, in plain terms. `Exception possible?` tells
the agent whether this code is ever worth investigating or is always a hard fail.

| reason_code | What it means | Exception possible? |
|---|---|---|
| <code> | <plain meaning> | <yes / no> |

## 4. ERP access reference
How the agent reads the ERP during investigation (same auth the flow uses).

- **Auth:** `Authorization: Bearer <jwt>` + cookie `deviceIdProduction=<device>; authTokenProduction=<jwt>` (device is decoded from the JWT `device` claim; falls back to `auth.erp.device_id`).
- **Entities & endpoints used by this check:**
  | Entity | Endpoint (method) | Key fields the agent reads |
  |---|---|---|
  | <e.g. Payments> | `POST <url>` | <fields> |
- **Deep link (for evidence links):** `<url pattern with {id}>`

## 5. Investigation playbook  ← the heart of the skill
Use whichever of the two shapes fits the check:

- **Per-reason_code** (below): when each flag reason needs its own distinct
  hypotheses. Good for checks where the reason narrows what to look for.
- **Unified pipeline**: when the agent re-derives the truth from the ERP the
  same way regardless of entry reason (pull the real data → classify with a
  first-match-wins resolver → look for explanations only for the "real miss"
  cases). Preferred when the flow's reason is just an entry point the agent can
  overturn. See the SDRF skill for a worked unified pipeline.

For **each** `reason_code` that can be investigated, define:
**Hypotheses** (legitimate reasons the flag might not be real) → **Evidence to
gather** (exact ERP lookup + field per hypothesis) → **Decision rule** (when to
CONFIRM, DISMISS as exception, or ESCALATE).

### reason_code: `<code>`
- **Genuine-issue meaning:** <what it means if no exception is found>
- **Legitimate exceptions to test:**
  1. **<exception_type>** — <when this applies>.
     - *Evidence:* <which entity/endpoint/field to check, and what value proves it>.
  2. **<exception_type>** — …
- **Decision rule:**
  - DISMISS as `exception` (type X) when: <precise condition + confidence ≥ threshold>.
  - CONFIRM the red flag when: <no exception evidence found>.
  - ESCALATE (`needs_human`) when: <ambiguous / conflicting / data missing>.

<Repeat one block per reason_code.>

## 6. Escalation & guardrails
<Restate anything beyond the frontmatter guardrails: reason codes that must
always reach a human regardless of evidence, monetary thresholds that force
review, known ERP quirks that make certain findings unreliable, etc.>

## 7. Audit trail
Every verdict MUST record: the red flag, each ERP query run and its raw finding,
the exception matched (if any), the confidence, the reasoning, and the timestamp.
Nothing is dismissed without traceable evidence.

## 8. Change log
| version | date | author | change |
|---|---|---|---|
| 0.1.0 | <date> | <author> | Initial draft. |
