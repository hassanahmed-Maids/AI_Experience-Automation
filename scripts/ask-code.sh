#!/usr/bin/env bash
# ask-code.sh — submit a question to the ERP ask-the-code LLM and wait for the answer.
#
# Usage:
#   ./scripts/ask-code.sh "How is template X sent?"                          # all modules
#   ./scripts/ask-code.sh "..." 'erp/magnamedia-visa-processing'             # one module
#   ./scripts/ask-code.sh "..." 'erp/a,erp/b'                                # several modules
#   ./scripts/ask-code.sh "..." '' 18154                                     # follow-up in session 18154
#
# Prints the Markdown answer to stdout. Prints "SESSION_ID: <id>" as the first
# line so callers can continue the conversation.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$DIR/.env"; set +a

QUESTION="${1:?usage: ask-code.sh QUESTION [alias1,alias2|''] [session_id]}"
ALIASES="${2:-}"
SESSION_ID="${3:-}"

BASE="https://erpbackendpro.maids.cc"
MODEL="claude-opus-4-8-high"

if [[ -n "$ALIASES" ]]; then
  ALIAS_JSON=$(printf '%s' "$ALIASES" | python3 -c 'import json,sys; print(json.dumps([a.strip() for a in sys.stdin.read().split(",") if a.strip()]))')
else
  ALIAS_JSON="[]"
fi

BODY=$(python3 - "$QUESTION" "$ALIAS_JSON" "$MODEL" "$SESSION_ID" <<'PY'
import json, sys
q, aliases, model, session = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], sys.argv[4]
body = {"question": q, "project_alias": aliases, "model": model,
        "repo_type": "erp", "multi_workspace": True, "manual_rule_ids": []}
if session:
    body["session_id"] = int(session)
print(json.dumps(body))
PY
)

SUBMIT=$(curl -sS --max-time 120 -X POST "$BASE/lowcode/c2d/query/async" \
  -H "Content-Type: application/json" \
  -H "Authorization: $ERP_AUTH_TOKEN" \
  -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
  -H "pageCode: lc_conversation" \
  -d "$BODY")

CONV_ID=$(printf '%s' "$SUBMIT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("data",{}).get("conversation_id",""))' 2>/dev/null || true)
REQ_ID=$(printf '%s' "$SUBMIT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("request_id",""))' 2>/dev/null || true)

if [[ -z "$CONV_ID" ]]; then
  echo "SUBMIT FAILED. Raw response:" >&2
  printf '%s\n' "$SUBMIT" >&2
  exit 1
fi
echo "SESSION_ID: $CONV_ID"

DEADLINE=$(( $(date +%s) + ${ASK_CODE_TIMEOUT:-600} ))
while (( $(date +%s) < DEADLINE )); do
  sleep 2
  PAGE=$(curl -sS --max-time 60 "$BASE/lowcode/c2d/session/$CONV_ID/messages?page=0&size=8" \
    -H "Authorization: $ERP_AUTH_TOKEN" \
    -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
    -H "pageCode: lc_conversation")
  ANSWER=$(printf '%s' "$PAGE" | python3 -c '
import json, sys
req = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for m in d.get("messages", []):
    if m.get("role") == "assistant" and m.get("request_status") == 2 and str(m.get("request_id")) == req:
        print(m.get("content", ""))
        break
' "$REQ_ID")
  if [[ -n "$ANSWER" ]]; then
    printf '%s\n' "$ANSWER"
    exit 0
  fi
done

echo "TIMEOUT after 180s. conversation_id=$CONV_ID request_id=$REQ_ID — poll manually." >&2
exit 2
