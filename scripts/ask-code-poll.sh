#!/usr/bin/env bash
# ask-code-poll.sh — fetch the answer for an existing ask-the-code session.
#
#   ./scripts/ask-code-poll.sh 44267
#
# Exists because ask-code.sh polls under `set -e`: one transient network error
# (curl 35 "Connection reset by peer") kills the wait even though the answer is
# still being computed server-side, losing an expensive question. This poller
# treats a failed request as "not ready yet" and keeps going.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$DIR/.env"; set +a

CONV_ID="${1:?usage: ask-code-poll.sh SESSION_ID [timeout_seconds]}"
TIMEOUT="${2:-600}"
BASE="https://erpbackendpro.maids.cc"

DEADLINE=$(( $(date +%s) + TIMEOUT ))
ATTEMPTS=0
ERRORS=0
while (( $(date +%s) < DEADLINE )); do
  ATTEMPTS=$((ATTEMPTS + 1))
  PAGE=$(curl -sS --max-time 60 "$BASE/lowcode/c2d/session/$CONV_ID/messages?page=0&size=8" \
    -H "Authorization: $ERP_AUTH_TOKEN" \
    -H "secc-ch-ua-platform: $ERP_SECC_PLATFORM" \
    -H "pageCode: lc_conversation" 2>/dev/null) || { ERRORS=$((ERRORS + 1)); sleep 5; continue; }

  ANSWER=$(printf '%s' "$PAGE" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
# Newest completed assistant message wins. No request_id filter: a resumed poll
# does not have it, and a session opened for one question has one answer.
best = None
for m in d.get("messages", []):
    if m.get("role") == "assistant" and m.get("request_status") == 2 and m.get("content"):
        if best is None or (m.get("id") or 0) > (best.get("id") or 0):
            best = m
if best:
    print(best["content"])
') || true

  if [[ -n "${ANSWER:-}" ]]; then
    printf '%s\n' "$ANSWER"
    echo "" >&2
    echo "(session $CONV_ID, $ATTEMPTS polls, $ERRORS transient errors tolerated)" >&2
    exit 0
  fi
  sleep 3
done

echo "STILL NOT READY after ${TIMEOUT}s. session=$CONV_ID — re-run this poller." >&2
exit 2
