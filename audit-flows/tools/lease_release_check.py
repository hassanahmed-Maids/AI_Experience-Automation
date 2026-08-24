#!/usr/bin/env python3
"""Does every SUCCESS path actually reach the lease release?

WHY THIS EXISTS. Execution 100409 (Dummy Tickets HM, 2026-08-24) finished with status
**success** and left the ERP lease held. The next audit queued behind a dead holder and
timed out. Nothing was broken in the usual sense: the release node existed, it was wired,
and every checker in this repo was green.

An n8n node that returns ZERO ITEMS does not fail. It stops its branch, and every node
after it is simply never executed. `Release ERP Lease` was the last node of the delivery
tail, so any node in that tail that legitimately went empty silently deleted the release.
Two of them go empty as a NORMAL outcome - no portal rows, nobody needing the verifier -
which means the lease leaked on every CLEAN run. The runs that released it were the ones
that happened to have findings, which is why a live smoke test, three compliance passes and
an endurance run all missed it.

So this asks the question the other checkers do not: not "is there a release node" but
"can the run get there". It walks the SUCCESS route from acquire to release and names every
node on it that can emit nothing.

WHAT IT DOES NOT DO. It cannot prove a Code node is non-empty - that is the halting problem
wearing a hat. It reports what a reader must then rule on, and a node ruled safe is marked
so IN THE FLOW with an ERP-COMPLIANCE tag, not in a list here that would rot. Silence from
this tool means "no unreviewed empty exits", never "proven reachable".
"""
import json, os, re, sys, glob

CODE      = 'n8n-nodes-base.code'
SUBFLOW   = 'n8n-nodes-base.executeWorkflow'
# Nodes that CANNOT take a sentinel item: giving them one buys a junk ERP call or a junk
# spreadsheet row. An empty exit whose successor is one of these needs an IF bypass, not a
# passthrough flag.
INTOLERANT = ('n8n-nodes-base.httpRequest', 'n8n-nodes-base.googleSheets')
# Node types that can themselves emit zero items regardless of their code.
EMPTY_CAPABLE_TYPES = ('n8n-nodes-base.filter', 'n8n-nodes-base.splitOut',
                       'n8n-nodes-base.dataTable', 'n8n-nodes-base.removeDuplicates')

# A node may be RULED reachable-or-harmless in the flow itself. The tag lives next to the
# code it excuses, so it cannot drift away from it.
RULING = re.compile(r'ERP-COMPLIANCE:\s*empty-exit-ok', re.I)


def strip_noise(js):
    """Remove comments and string bodies so brace counting cannot be fooled by either."""
    out, i, n = [], 0, len(js)
    while i < n:
        c = js[i]
        if c == '/' and i + 1 < n and js[i + 1] == '/':
            while i < n and js[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and js[i + 1] == '*':
            j = js.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in '\'"`':
            q, i = c, i + 1
            while i < n and js[i] != q:
                i += 2 if js[i] == '\\' else 1
            i += 1
            out.append('""')
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def top_level_returns(js):
    """The returns that are the NODE's output - not the ones inside its helper functions.

    Brace depth alone is the wrong measure: `if (!rows.length) return [];` sits inside a
    block but is absolutely a node return, while `return text.indexOf(s) !== -1` inside a
    helper is not. So this counts FUNCTION depth - a stack entry is pushed only for a brace
    that opens a function or arrow body - and reports returns at depth 0.

    Getting this wrong is not cosmetic. The first version counted every `return` in the file
    and reported fourteen empty exits in one flow, all but two of them lines inside helpers.
    A checker nobody believes is worse than no checker, so the parsing has to earn the alarm.
    """
    js = strip_noise(js)
    stack, fn_pending, res, i, n = [], False, [], 0, len(js)
    word = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
    while i < n:
        m = word.match(js, i)
        if m:
            w = m.group(0)
            if w == 'function':
                fn_pending = True
            elif w == 'return' and not any(stack):
                j = js.find(';', i)
                res.append(js[i + 6: j if j > 0 else n].strip())
            i = m.end()
            continue
        if js.startswith('=>', i):
            fn_pending = True
            i += 2
            continue
        if js[i] == '{':
            stack.append(fn_pending)
            fn_pending = False
            i += 1
            continue
        if js[i] == '}':
            if stack:
                stack.pop()
            i += 1
            continue
        i += 1
    return res


def code_of(n):
    return (n.get('parameters') or {}).get('jsCode', '') or ''


def can_emit_nothing(n):
    """Conservative in ONE direction only: a return whose emptiness cannot be ruled out from
    the text is reported. A return of an array LITERAL with at least one element is the only
    shape treated as guaranteed non-empty."""
    t = n.get('type')
    if t in EMPTY_CAPABLE_TYPES:
        return 'ORIGINATES: node type can return zero rows'
    if t != CODE:
        return None
    rets = top_level_returns(code_of(n))
    if not rets:
        return None
    for r in rets:
        if re.match(r'^\[\s*\]$', r):
            return 'ORIGINATES: has an explicit `return []`'
    for r in rets:
        if r.startswith('[') and r[1:].lstrip().startswith('{'):
            continue        # literal, at least one item
        if r.startswith('new Promise'):
            continue        # the settle idiom - resolves whatever came in
        short = re.sub(r'\s+', ' ', r.replace('\n', ' '))
        short = short[:52] + ('...' if len(short) > 52 else '')
        # A node that hands its input straight back, or maps over it one-for-one, cannot make a
        # stream empty that was not empty already. It PROPAGATES. Saying so is not a technicality:
        # the fix belongs at whichever node ORIGINATES the emptiness, and a report that treats
        # every passthrough breaker as a defect buries the two nodes that actually are one.
        if re.match(r'^\$input\.all\(\)$|^items$', r.strip()):
            return 'PROPAGATES: hands its input straight back'
        if re.match(r'^[A-Za-z_$][\w$.]*(\(\))?\.map\(', r.strip()):
            return 'PROPAGATES: maps one-for-one over its input'
        return 'ORIGINATES: returns `%s` - non-empty only if its source was' % short
    return None


def load(path):
    d = json.load(open(path))
    return d.get('workflow', d)


def analyse(w):
    nodes = {n['name']: n for n in w['nodes']}
    conns = w.get('connections', {})

    def succ(name, idx=0):
        outs = (conns.get(name, {}) or {}).get('main', []) or []
        if idx >= len(outs) or not outs[idx]:
            return []
        return [c['node'] for c in outs[idx]]

    rev = {}
    for src, o in conns.items():
        for outs in (o or {}).values():
            for idx, lst in enumerate(outs or []):
                for c in (lst or []):
                    rev.setdefault(c['node'], []).append((src, idx))

    releases = [n for n in nodes
                if nodes[n].get('type') == SUBFLOW
                and 'elease' in n and 'error' not in n.lower()]
    if not releases:
        return None

    findings = []
    for rel in releases:
        # Walk BACKWARDS from the release along SUCCESS edges only (index 0). An error-output
        # edge is a different rail and is checked elsewhere.
        # WHICH EDGES COUNT AS SUCCESS. For a Code or HTTP node output 1 is the ERROR rail -
        # a different mechanism, checked elsewhere, and walking it here would report the
        # whole error path as a route to the release. For an IF or a Switch output 1 is just
        # the other branch, every bit as much a success path as output 0. Reading the OUTPUT
        # INDEX without asking what kind of node it came from is how the mute-rail rule got
        # this wrong three times.
        BRANCHERS = ('n8n-nodes-base.if', 'n8n-nodes-base.switch', 'n8n-nodes-base.filter')
        seen, frontier, route = set(), [rel], []
        while frontier:
            cur = frontier.pop()
            for src, idx in rev.get(cur, []):
                if (src, idx) in seen:
                    continue
                if idx != 0 and nodes.get(src, {}).get('type') not in BRANCHERS:
                    continue
                seen.add((src, idx))
                route.append(src)
                frontier.append(src)
        for name in route:
            n = nodes[name]
            why = can_emit_nothing(n)
            if not why:
                continue
            if RULING.search(json.dumps(n)):
                continue
            nxt = succ(name)
            nxt_t = [nodes[m].get('type', '?') for m in nxt if m in nodes]
            findings.append({
                'release': rel, 'node': name, 'type': n.get('type'), 'why': why,
                'successors': nxt,
                'blocked_by_intolerant': any(t in INTOLERANT for t in nxt_t),
            })
    return findings


def main(paths):
    """FAILS ON ORIGINS ONLY, and that is the whole design of this checker.

    A node that hands its input straight back cannot make a stream empty that was not empty
    already. Fix every ORIGIN so it emits a sentinel instead of nothing, and the sentinel
    flows through the propagators to the release on its own. Failing on propagators too
    would put forty nodes in front of a reader to hide the three that matter - and a report
    nobody finishes reading protects nothing.

    Propagators are still PRINTED, because when an origin is fixed the sentinel has to
    survive them, and that is the list of nodes it must survive.
    """
    bad = 0
    for p in sorted(paths):
        try:
            w = load(p)
        except Exception as e:
            print('%-36s UNREADABLE: %s' % (os.path.basename(p), e))
            bad += 1
            continue
        if 'nodes' not in w:
            continue
        res = analyse(w)
        if res is None:
            continue                      # flow holds no lease - nothing to reach
        label = '%s (%s)' % (os.path.basename(p), w.get('id', '?'))
        origins = [f for f in res if f['why'].startswith('ORIGINATES')]
        carriers = [f for f in res if not f['why'].startswith('ORIGINATES')]
        if not origins:
            print('PASS  %s' % label)
            if carriers:
                print('        (%d passthrough node(s) on the route - a sentinel must survive '
                      'them: %s)' % (len(carriers), ', '.join(f['node'] for f in carriers)))
            continue
        bad += 1
        print('FAIL  %s' % label)
        for f in origins:
            mark = 'IF-BYPASS' if f['blocked_by_intolerant'] else 'sentinel'
            print('        %-28s %s' % (f['node'], f['why'].split(': ', 1)[1]))
            print('        %-28s -> %s   [needs: %s]'
                  % ('', ', '.join(f['successors']) or '(terminal)', mark))
        if carriers:
            print('        carries-only: %s' % ', '.join(f['node'] for f in carriers))
    print()
    print('%d flow(s) can reach a success end WITHOUT releasing the ERP lease.' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    args = sys.argv[1:] or sorted(glob.glob(os.path.join(os.path.dirname(__file__),
                                                         '..', 'exports', '*.json')))
    sys.exit(main(args))
