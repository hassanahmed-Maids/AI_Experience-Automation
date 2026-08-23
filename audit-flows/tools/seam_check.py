#!/usr/bin/env python3
"""
seam_check.py - find $('Node Name') references that point at nothing.

THE FAILURE THIS EXISTS FOR. A Code node calling $('X') where X is not a node in the same
workflow throws at runtime - UNLESS the call sits in a try/catch, in which case the guard is
silently dead and looks healthy forever. `Build Runs Log` in WF-A named $('Compute Case States')
for months after that node moved into WF-T: the reference could only ever throw, the catch
swallowed it, and the zero-cases guard it protects was absent for exactly the scenario it was
written for. Nothing anywhere reported it, because a dead try/catch is indistinguishable from a
healthy one.

  python3 tools/seam_check.py exports/*.json

Exit 1 if any live node carries a dangling reference.

A reference INSIDE a try/catch is the dangerous case, not the safe one, so it is reported at the
same severity and labelled - the catch is what hides it.

SCOPE, said plainly. VALIDATION.md describes this tool as applying TWO checks; only check 1
(dangling references) is implemented here. Check 2 - envelope / per-item wire mismatches, where a
node emitting one item per entity feeds one expecting a single envelope - is NOT implemented, and
this file is the record of that rather than a silent gap. The tool was cited in VALIDATION.md
before it existed at all (found 2026-08-23, the same way tools/verify_order.py was found missing
on 2026-08-22); check 1 is written here because it is the one that caught a real defect.

Reads DEPLOYED workflow JSON, like the other checkers - the question is what the live graph does,
and the repo does not hold that. See exports/README.md.
"""
import json, re, sys, os

REF = re.compile(r"\$\(\s*(['\"])(.*?)\1\s*\)")

def strip_comments(src):
    """Blank out // and /* */ comments, preserving length and newlines.

    WITHOUT THIS THE TOOL CRIES WOLF, and a checker nobody trusts is worse than none - this repo
    has been bitten by that three times. The very comment that DOCUMENTS the dangling reference
    quotes it ("$('Compute Case States') could only ever throw here"), and the comment describing
    this tool quotes $('name'). Scanning raw source reported both as live defects on a workflow
    that had just been fixed.

    Characters are replaced with spaces rather than removed so match offsets still line up with
    the original, which is what in_try() reads.

    LIMITATION, stated rather than hidden: this is a string-aware scanner, not a JS parser. It
    tracks ' " and ` literals and their backslash escapes, but it does not know regex literals -
    so a regex containing a literal // or /* would be mistaken for a comment start. No node in
    this repo has one; if that ever changes, this is the line that breaks.
    """
    out = list(src)
    i, n = 0, len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            if c == '\\':
                i += 2; continue
            if c == quote:
                quote = None
            i += 1; continue
        if c in ('"', "'", '`'):
            quote = c; i += 1; continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                out[i] = ' '; i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            while i < n and not (src[i] == '*' and i + 1 < n and src[i + 1] == '/'):
                if src[i] != '\n':
                    out[i] = ' '
                i += 1
            for _ in range(2):
                if i < n:
                    out[i] = ' '; i += 1
            continue
        i += 1
    return ''.join(out)

def load(path):
    d = json.load(open(path))
    return d.get('workflow', d)

def bodies(n):
    """Every string in this node's parameters that could carry a $('...') reference."""
    p = n.get('parameters') or {}
    out = []
    def walk(v):
        if isinstance(v, str):
            out.append(strip_comments(v))
        elif isinstance(v, dict):
            for x in v.values(): walk(x)
        elif isinstance(v, list):
            for x in v: walk(x)
    walk(p)
    return out

def in_try(body, idx):
    """Is the reference at idx inside a try block? Crude but honest: counts try/catch keywords
    before it. A false 'yes' only changes the label, never whether it is reported."""
    head = body[:idx]
    return head.count('try {') > head.count('catch (')

def check(path):
    w = load(path)
    names = {n.get('name') for n in (w.get('nodes') or [])}
    hits = []
    for n in w.get('nodes') or []:
        if n.get('type') == 'n8n-nodes-base.stickyNote':
            continue
        for body in bodies(n):
            for m in REF.finditer(body):
                target = m.group(2)
                if target in names:
                    continue
                hits.append((n.get('name'), n.get('disabled') is True, target,
                             in_try(body, m.start())))
    print('=' * 78)
    print('%s   (%d nodes)' % (w.get('name') or path, len(names)))
    live = 0
    seen = set()
    for node, disabled, target, guarded in hits:
        key = (node, target)
        if key in seen:
            continue
        seen.add(key)
        tag = 'DISABLED node' if disabled else 'DANGLING'
        if not disabled:
            live += 1
        print('  %-9s %s -> $(%r) names no node in this workflow%s'
              % (tag, node, target, '  [inside try/catch - SILENTLY dead]' if guarded else ''))
    if not hits:
        print('  ok   every $(...) reference resolves')
    return live

if __name__ == '__main__':
    paths = sys.argv[1:]
    if not paths:
        print(__doc__); sys.exit(2)
    total = 0
    for p in paths:
        if os.path.basename(p) == 'MANIFEST.json':
            continue
        total += check(p)
    print('=' * 78)
    print('%d dangling reference(s) on live nodes' % total)
    sys.exit(1 if total else 0)
