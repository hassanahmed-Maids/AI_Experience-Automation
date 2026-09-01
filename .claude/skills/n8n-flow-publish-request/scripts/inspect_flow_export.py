#!/usr/bin/env python3
"""Read an n8n flow export and report the artifacts an SD publish request needs.

The SD template asks for the trigger and schedule, inputs, outputs, APIs used,
credential names and an executions-per-day estimate. All of that is already in
the export the ticket has to attach anyway, so read it from there rather than
asking someone to recite it from memory.

Flags shared sub-workflow dependencies, which block filing: NF deploys the
workflow on its own, so a call into another project's flow does not travel with
the export.

Prints credential NAMES only. If anything token-shaped is embedded in the export
it is reported by location, never by value - a secret belongs in a credential,
and certainly not in a Jira ticket.

Usage: inspect_flow_export.py <export.json>
"""
import json
import re
import sys
from collections import Counter, OrderedDict

TRIGGER_HINTS = ('trigger', 'webhook', 'cron', 'interval', 'formtrigger', 'chattrigger')
# Long unbroken high-entropy runs and JWTs. Deliberately loose: a false positive
# costs a glance, a false negative puts a live token in a Jira ticket.
SECRET_RE = re.compile(r'(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]{8,})'
                       r'|([A-Za-z0-9_\-+/=]{40,})')
SECRET_KEY_RE = re.compile(r'(token|secret|password|passwd|apikey|api_key|bearer|'
                           r'authorization|private_key|client_secret)', re.I)


def load(path):
    with open(path, 'r', encoding='utf-8') as fh:
        doc = json.load(fh)
    # Exports come as a bare workflow, a {"workflow": {...}} envelope, or a list.
    if isinstance(doc, list):
        doc = doc[0]
    if isinstance(doc, dict) and 'workflow' in doc and 'nodes' not in doc:
        doc = doc['workflow']
    if 'nodes' not in doc:
        sys.exit('Not an n8n workflow export: no "nodes" key.')
    return doc


def short_type(node):
    return node.get('type', '').split('.')[-1]


def describe_schedule(node):
    """Turn a schedule trigger's parameters into something a reviewer can read."""
    rule = (node.get('parameters') or {}).get('rule') or {}
    out = []
    for interval in rule.get('interval') or []:
        if 'cronExpression' in interval:
            out.append('cron ' + str(interval['cronExpression']))
        else:
            field = interval.get('field', '?')
            bits = [f'every {field}']
            for k in ('triggerAtHour', 'triggerAtMinute', 'triggerAtDay', 'triggerAtDayOfMonth'):
                if k in interval:
                    bits.append(f'{k}={interval[k]}')
            out.append(' '.join(bits))
    return '; '.join(out) or 'no rule set'


def runs_per_day(schedules):
    """A rough starting figure. The user confirms it; the point is not to leave it blank."""
    total = 0.0
    for s in schedules:
        s = s.lower()
        if 'every minute' in s:
            total += 1440
        elif 'every hour' in s:
            total += 24
        elif 'every day' in s or 'triggerathour' in s:
            total += 1
        elif 'every week' in s:
            total += 1 / 7
        elif 'every month' in s:
            total += 1 / 30
        elif s.startswith('cron'):
            expr = s.replace('cron', '').strip().split()
            if len(expr) >= 5:
                if expr[1] == '*':
                    total += 24
                elif expr[2] != '*' or expr[4] != '*':
                    total += 1 / 30 if expr[2] != '*' else 1 / 7
                else:
                    total += 1
    return total


def scan_secrets(doc):
    """Locate embedded secrets by path, never by value."""
    hits = []

    def walk(obj, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f'{path}.{k}')
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f'{path}[{i}]')
        elif isinstance(obj, str):
            # An n8n expression referencing a credential is fine; a literal is not.
            if obj.startswith('=') or '$credentials' in obj:
                return
            if SECRET_RE.search(obj) and (SECRET_KEY_RE.search(path) or obj.startswith('eyJ')):
                hits.append((path, len(obj)))

    walk(doc.get('nodes', []), 'nodes')
    return hits


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    doc = load(sys.argv[1])
    nodes = doc.get('nodes', [])

    print(f'Flow:   {doc.get("name", "(unnamed)")}')
    print(f'Nodes:  {len(nodes)}   active: {doc.get("active", "unknown")}')
    print()

    # --- Trigger & Schedule ---
    print('== Trigger & Schedule ==')
    schedules, triggers = [], []
    for n in nodes:
        t = short_type(n).lower()
        if any(h in t for h in TRIGGER_HINTS):
            label = f'{n.get("name")} ({short_type(n)})'
            if n.get('disabled'):
                label += '  [DISABLED]'
            if 'schedule' in t or 'cron' in t or 'interval' in t:
                sched = describe_schedule(n)
                schedules.append(sched)
                label += f' -> {sched}'
            if 'webhook' in t:
                p = (n.get('parameters') or {})
                label += f' -> {p.get("httpMethod", "GET")} /{p.get("path", "?")}'
            triggers.append(label)
    for t in triggers or ['(none found - manual only)']:
        print('  ' + t)
    est = runs_per_day(schedules)
    print(f'\n  Estimated executions/day from schedules: {est:.2f}'
          f'{"  (sub-1 means it runs less than daily)" if 0 < est < 1 else ""}')
    print('  Confirm this with the user - webhook and manual runs are not counted here.')
    print()

    # --- Credentials (names only) ---
    print('== Credentials used (names as they appear in n8n) ==')
    creds = OrderedDict()
    for n in nodes:
        for ctype, c in (n.get('credentials') or {}).items():
            creds.setdefault((ctype, c.get('name', '?')), []).append(n.get('name'))
    if creds:
        for (ctype, cname), used_by in creds.items():
            print(f'  {cname}  [{ctype}]  <- {", ".join(used_by)}')
    else:
        print('  (none - the flow holds no stored credential)')
    print()

    # --- APIs used ---
    print('== Outbound HTTP calls ==')
    calls = Counter()
    for n in nodes:
        if short_type(n) == 'httpRequest':
            p = n.get('parameters') or {}
            url = str(p.get('url', '?'))
            method = str(p.get('method', 'GET'))
            calls[f'{method:6s} {url}'] += 1
    if calls:
        for call, count in calls.most_common():
            print(f'  {call}' + (f'   (x{count} nodes)' if count > 1 else ''))
        print('\n  State the read/write character of each - reviewers weigh writes far')
        print('  more heavily than reads.')
    else:
        print('  (none)')
    print()

    # --- Inputs / outputs / sub-workflows ---
    print('== Other systems touched (inputs, outputs, sub-workflows) ==')
    interesting = Counter()
    for n in nodes:
        t = short_type(n)
        if t in ('httpRequest', 'code', 'set', 'if', 'switch', 'merge',
                 'splitInBatches', 'noOp', 'stickyNote') or any(
                     h in t.lower() for h in TRIGGER_HINTS):
            continue
        interesting[t] += 1
    for t, count in interesting.most_common():
        print(f'  {t}  x{count}')
    if not interesting:
        print('  (none beyond logic nodes)')
    print()

    # --- Shared dependencies: a blocker, not a footnote ---
    subs = []
    for n in nodes:
        if 'executeworkflow' in short_type(n).lower():
            wid = ((n.get('parameters') or {}).get('workflowId') or {})
            wid = wid.get('value') if isinstance(wid, dict) else wid
            subs.append((n.get('name'), wid))
    print('== Shared sub-workflow dependencies ==')
    if subs:
        print('  BLOCKER. NF deploys this workflow alone - a sub-workflow in another')
        print('  project does not travel with the export. Rewire around these and')
        print('  delete them before filing:')
        for name, wid in subs:
            note = '  <- the shared ERP lease' if wid == '9gVijqvtLVEhQZXz' else ''
            print(f'    {name}  -> workflow {wid}{note}')
    else:
        print('  none - the flow is self-contained')
    print()

    # --- Secrets ---
    hits = scan_secrets(doc)
    print('== Secret scan ==')
    if hits:
        print('  EMBEDDED SECRET-SHAPED VALUES FOUND. Do not attach this export or put')
        print('  these anywhere in Jira until they are moved into n8n credentials:')
        for path, length in hits:
            print(f'    {path}  ({length} chars - value withheld)')
    else:
        print('  clean - no literal token-shaped values found in node parameters')


if __name__ == '__main__':
    main()
