#!/usr/bin/env bash
# poll-ask-code.sh — recover answers for ask-the-code conversations that were
# already submitted, by polling their conversation_ids.
#
# Why this exists: ask-code.sh aborts if a poll request fails at the network
# level (seen in remote sessions: "curl: (35) Recv failure: Connection reset by
# peer", reproducibly when 3 conversations poll in parallel). The SUBMIT had
# already succeeded, and per docs/code-llm-api.md the conversation keeps
# processing server-side — so the answer is not lost, only the poller is. This
# reconnects to a conversation and retries through transient resets.
#
# Usage:
#   ./scripts/poll-ask-code.sh 44653 44654 44655            # print to stdout
#   ./scripts/poll-ask-code.sh --out-dir DIR 44653 44654    # write <id>.md per answer
#   ./scripts/poll-ask-code.sh --map work/x/raw/map.txt     # "id<TAB>filepath" per line
#
# Polls all given conversations concurrently-but-serially (one HTTP request at a
# time, round-robin), which is what avoids the resets. Exits 0 once every
# conversation has produced an answer, 2 on deadline with some still pending.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$DIR/.env" ]]; then
  set -a; source "$DIR/.env"; set +a
fi
if [[ -z "${ERP_AUTH_TOKEN:-}" ]]; then
  echo "poll-ask-code.sh: ERP_AUTH_TOKEN is not set (see .env.example)." >&2
  exit 3
fi

BASE="https://erpbackendpro.maids.cc"
DEADLINE_SECS="${ASK_CODE_TIMEOUT:-1800}"
OUT_DIR=""
MAP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --map)     MAP_FILE="$2"; shift 2 ;;
    *)         break ;;
  esac
done

declare -A DEST=()
IDS=()
if [[ -n "$MAP_FILE" ]]; then
  while IFS=$'\t' read -r id path; do
    [[ -z "${id:-}" ]] && continue
    IDS+=("$id"); DEST["$id"]="$path"
  done <"$MAP_FILE"
else
  for id in "$@"; do
    IDS+=("$id")
    [[ -n "$OUT_DIR" ]] && DEST["$id"]="$OUT_DIR/$id.md"
  done
fi
(( ${#IDS[@]} == 0 )) && { echo "usage: poll-ask-code.sh [--out-dir DIR|--map FILE] CONV_ID..." >&2; exit 1; }
[[ -n "$OUT_DIR" ]] && mkdir -p "$OUT_DIR"

# One page fetch. --retry-all-errors rides out the connection resets that killed
# ask-code.sh's own poll loop; --max-time bounds a hung connection.
fetch_page() {
  curl -sS --max-time 90 \
    --retry 6 --retry-delay 3 --retry-all-errors \
    "$BASE/lowcode/c2d/session/$1/messages?page=0&size=8" \
    -H "Authorization: $ERP_AUTH_TOKEN" \
    -H "secc-ch-ua-platform: ${ERP_SECC_PLATFORM:-}" \
    -H "pageCode: lc_conversation"
}

# Newest completed assistant message in the page. We do NOT filter on request_id:
# the caller reconnecting to a conversation generally no longer has it, and a
# freshly-submitted conversation holds exactly one assistant turn.
extract_answer() {
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for m in d.get("messages", []):
    if m.get("role") == "assistant" and m.get("request_status") == 2:
        c = (m.get("content") or "").strip()
        if c:
            print(c)
            break
'
}

declare -A DONE=()
END=$(( $(date +%s) + DEADLINE_SECS ))

while (( $(date +%s) < END )); do
  pending=0
  for id in "${IDS[@]}"; do
    [[ -n "${DONE[$id]:-}" ]] && continue
    answer="$(fetch_page "$id" | extract_answer)"
    if [[ -n "$answer" ]]; then
      DONE["$id"]=1
      if [[ -n "${DEST[$id]:-}" ]]; then
        mkdir -p "$(dirname "${DEST[$id]}")"
        printf '%s\n' "$answer" >>"${DEST[$id]}"
        echo "  ✓ $id → ${DEST[$id]} ($(wc -c <"${DEST[$id]}") bytes)" >&2
      else
        echo "===== conversation $id ====="
        printf '%s\n' "$answer"
      fi
    else
      (( pending++ ))
    fi
  done
  (( pending == 0 )) && { echo "all ${#IDS[@]} conversation(s) answered" >&2; exit 0; }
  echo "  … $pending of ${#IDS[@]} still processing" >&2
  sleep 15
done

echo "DEADLINE (${DEADLINE_SECS}s): still pending —" >&2
for id in "${IDS[@]}"; do [[ -z "${DONE[$id]:-}" ]] && echo "  $id" >&2; done
exit 2
