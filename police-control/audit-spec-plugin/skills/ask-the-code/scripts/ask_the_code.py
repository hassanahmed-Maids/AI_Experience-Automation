#!/usr/bin/env python3
"""
Ask the Code — ERP codebase Q&A client for the maids.cc Low-Code Platform.

Submits a question to the LCP async endpoint, polls until the answer is ready,
and prints the answer as Markdown. Pure standard library — no dependencies.

Usage
-----
  export ASK_THE_CODE_TOKEN="<bearer jwt>"

  # Ask one module
  python3 ask_the_code.py \
      -q "What are the native table names storing maid salary deductions?" \
      -m erp/magnamedia-payroll-management

  # Ask several modules
  python3 ask_the_code.py -q "..." -m erp/magnamedia-payroll-management,erp/magnamedia-accounting

  # Ask ALL modules (slower, broader)
  python3 ask_the_code.py -q "..." --all-modules

  # Follow-up in the same conversation
  python3 ask_the_code.py -q "Give me the column names too." -m erp/magnamedia-payroll-management -s 45522

Exit codes
----------
  0  answer returned
  2  bad usage / missing token
  3  submit failed
  4  timed out waiting for the answer
  5  model refused (retry with --model auto)
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "https://erpbackendpro.maids.cc"
SUBMIT_PATH = "/lowcode/c2d/query/async"
POLL_PATH = "/lowcode/c2d/session/{conversation_id}/messages?page=0&size=20"

POLL_INTERVAL_SECONDS = 2
MAX_WAIT_SECONDS = 180
STATUS_READY = 2


def build_headers(token):
    """Authorization + pageCode are required. secc-ch-ua-platform is accepted but
    not enforced by the backend as of the last verification; sent when provided."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
        "pageCode": "lc_conversation",
    }
    platform = os.environ.get("ASK_THE_CODE_PLATFORM")
    if platform:
        headers["secc-ch-ua-platform"] = platform
    return headers


def token_expiry_note(token):
    """Decode the JWT payload (no verification) to warn about an expired token early."""
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return None
    exp = payload.get("exp")
    user = payload.get("user", "?")
    if not exp:
        return "token user=%s (no exp claim)" % user
    remaining = int(exp) - int(time.time())
    if remaining <= 0:
        return "TOKEN EXPIRED %d minutes ago (user=%s) — ask for a fresh one" % (
            abs(remaining) // 60,
            user,
        )
    return "token user=%s, valid for %d more minutes" % (user, remaining // 60)


def request_json(url, headers, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.status
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        return {"_error": body}, err.code
    except Exception as err:  # network-level
        return {"_error": str(err)}, 0


def submit(question, modules, model, session_id, headers):
    payload = {
        "question": question,
        "project_alias": modules,
        "model": model,
        "repo_type": "erp",
        "multi_workspace": True,
        "manual_rule_ids": [],
    }
    if session_id:
        payload["session_id"] = int(session_id)

    body, status = request_json(BASE_URL + SUBMIT_PATH, headers, payload)

    # NOTE: the backend returns "success": false even on a successfully queued
    # request. The real signal is the presence of data.conversation_id.
    conversation_id = (body.get("data") or {}).get("conversation_id")
    if not conversation_id:
        sys.stderr.write("Submit failed (HTTP %s): %s\n" % (status, json.dumps(body)[:800]))
        sys.exit(3)
    return conversation_id, body.get("request_id")


def poll(conversation_id, request_id, headers, verbose):
    url = BASE_URL + POLL_PATH.format(conversation_id=conversation_id)
    deadline = time.time() + MAX_WAIT_SECONDS
    attempt = 0

    while time.time() < deadline:
        attempt += 1
        body, status = request_json(url, headers)
        if "_error" in body:
            sys.stderr.write("Poll error (HTTP %s): %s\n" % (status, body["_error"][:400]))
        for message in body.get("messages", []):
            if message.get("role") != "assistant":
                continue
            # Match our own request when we know it; a follow-up reuses the
            # conversation so several assistant messages can be present.
            if request_id and message.get("request_id") != request_id:
                continue
            content = message.get("content") or ""
            if "Cannot use this model" in content:
                sys.stderr.write("Model refused. Retry with --model auto\n")
                sys.exit(5)
            if message.get("request_status") == STATUS_READY:
                return content
        if verbose:
            sys.stderr.write("  ... waiting (%ds elapsed)\n"
                             % int(MAX_WAIT_SECONDS - (deadline - time.time())))
        time.sleep(POLL_INTERVAL_SECONDS)

    sys.stderr.write("Timed out after %ds with no completed answer.\n" % MAX_WAIT_SECONDS)
    sys.exit(4)


def main():
    parser = argparse.ArgumentParser(
        description="Ask a question about the maids.cc ERP codebase.")
    parser.add_argument("-q", "--question", required=True)
    parser.add_argument("-m", "--modules", default="",
                        help="Comma-separated project_alias values. See module-registry.md")
    parser.add_argument("--all-modules", action="store_true",
                        help="Search every module (sends project_alias: [])")
    parser.add_argument("--model", default="composer-2.5",
                        help='Model: "composer-2.5" (default, intelligent) or "auto"')
    parser.add_argument("-s", "--session-id", default=None,
                        help="Existing conversation_id, for a follow-up question")
    parser.add_argument("-t", "--token", default=None,
                        help="Bearer token (defaults to $ASK_THE_CODE_TOKEN)")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()

    token = args.token or os.environ.get("ASK_THE_CODE_TOKEN", "")
    if not token:
        sys.stderr.write(
            "No token. Set ASK_THE_CODE_TOKEN or pass --token.\n"
            "Get one from the ERP Low-Code Platform session; they expire within hours.\n")
        sys.exit(2)
    token = token.replace("Bearer ", "").strip()

    if args.all_modules:
        modules = []
    else:
        modules = [m.strip() for m in args.modules.split(",") if m.strip()]
        if not modules:
            sys.stderr.write("Pass -m <project_alias> or --all-modules.\n")
            sys.exit(2)

    verbose = not args.quiet
    if verbose:
        note = token_expiry_note(token)
        if note:
            sys.stderr.write("[%s]\n" % note)
        sys.stderr.write("Submitting to %s ...\n"
                         % ("ALL modules" if not modules else ", ".join(modules)))

    headers = build_headers(token)
    conversation_id, request_id = submit(
        args.question, modules, args.model, args.session_id, headers)

    if verbose:
        sys.stderr.write("conversation_id=%s request_id=%s — polling\n"
                         % (conversation_id, request_id))

    answer = poll(conversation_id, request_id, headers, verbose)

    print(answer)
    if verbose:
        sys.stderr.write("\n[follow up with: -s %s]\n" % conversation_id)


if __name__ == "__main__":
    main()
