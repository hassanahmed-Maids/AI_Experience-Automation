#!/usr/bin/env bash
# ask-code-poll.sh — re-attach to an ask-the-code session and print its latest answer.
#
# WHY THIS EXISTS: ask-code.sh submits the question and then polls in the same process.
# If the poll loop dies (curl 35 / connection reset — seen twice on 2026-09-09) the
# QUESTION IS STILL QUEUED SERVER-SIDE and the answer is lost to the caller. Re-running
# ask-code.sh would ask it again and burn another run. This re-attaches instead.
#
# Usage:  ./scripts/ask-code-poll.sh 46024 [timeout_seconds]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$DIR/.env"; set +a

CONV_ID="${1:?usage: ask-code-poll.sh SESSION_ID [timeout_seconds]}"
BASE="https://erpbackendpro.maids.cc"
DEADLINE=$(( $(date +%s) + ${2:-600} ))

while (( $(date +%s) < DEADLINE )); do
  PAGE=$(curl -sS --max-time 60 --retry 3 --retry-all-errors --retry-delay 3 \
    "$BASE/lowcode/c2d/session/$CONV_ID/messages?page=0&size=8" \
    -H "Authorization: $ERP_AUTH_TOKEN" \
    -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
    -H "pageCode: lc_conversation" 2>/dev/null) || { sleep 5; continue; }

  ANSWER=$(printf '%s' "$PAGE" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
# newest COMPLETED assistant message in the session; no request_id needed, so this
# works even when the submitting process died before recording one.
best = None
for m in d.get("messages", []):
    if m.get("role") == "assistant" and m.get("request_status") == 2 and m.get("content"):
        if best is None or (m.get("id") or 0) > (best.get("id") or 0):
            best = m
if best:
    print(best["content"])
')
  if [[ -n "$ANSWER" ]]; then printf '%s\n' "$ANSWER"; exit 0; fi
  sleep 5
done

echo "STILL PENDING for session $CONV_ID — re-run this script, the question is queued." >&2
exit 2
