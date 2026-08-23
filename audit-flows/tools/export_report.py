#!/usr/bin/env python3
"""
export_report.py - a compact fingerprint of an export, for checking a transcription.

WHY THIS EXISTS. Some flows can only be exported by hand: the n8n MCP returns a workflow inline
rather than to a file, and no n8n API credential exists in this environment, so a small workflow
gets copied by a human (or a model) rather than downloaded. A hand-copied export is a NEW way for
the checker to lie - not stale, but wrong - and `--all` would report it green either way.

So a transcription is checked three ways, and this tool is the first:

  1. this report, diffed by eye against the live fetch. It prints only the fields a verdict
     actually turns on - node name, type, onError, disabled, the ERP pacing numbers, the
     connection edges, and whether each ERP-COMPLIANCE tag is present - which is ~30 lines a
     flow instead of 30 KB, and 30 structured lines can honestly be read.
  2. `--check-js`, which extracts every Code node body and runs `node --check` over it. Most
     transcription damage is not valid JavaScript.
  3. the breaker byte-compare in erp_compliance.py, which fails on a corrupted breaker block
     whether the corruption came from drift or from a typo.

None of the three proves the bytes match. They bound what an undetected error can be: something
that is valid JS, leaves every structural field intact, is outside the breaker block, and does
not touch a compliance tag. Provenance is recorded per flow in exports/MANIFEST.json so a green
run says which flows rest on a copy.

  python3 tools/export_report.py exports/x.json [more.json ...]
  python3 tools/export_report.py --check-js exports/x.json
"""
import json, sys, os, subprocess, tempfile, hashlib

TAGS = ('ERP-COMPLIANCE: budget-gate-in-caller', 'ERP-COMPLIANCE: lease-held-by-caller',
        'ERP-COMPLIANCE: no-breaker-because', 'ERP-COMPLIANCE: lease-released-downstream')
ERP_HOSTS = ('erpbackendpro.maids.cc', 'erp.maids.cc')

def load(path):
    d = json.load(open(path))
    return d.get('workflow', d)

def code_of(n):
    return str((n.get('parameters') or {}).get('jsCode') or '')

def report(path):
    w = load(path)
    nodes = w.get('nodes') or []
    print('=' * 78)
    print('%s   id=%s   %d nodes' % (w.get('name'), w.get('id'), len(nodes)))
    print('  active=%s  activeVersionId=%s' % (w.get('active'), w.get('activeVersionId')))
    for n in sorted(nodes, key=lambda x: x.get('name') or ''):
        t = (n.get('type') or '').split('.')[-1]
        bits = []
        if n.get('onError'):        bits.append('onError=' + n['onError'])
        if n.get('disabled'):       bits.append('DISABLED')
        if n.get('alwaysOutputData'): bits.append('alwaysOutput')
        p = n.get('parameters') or {}
        url = str(p.get('url') or '')
        if any(h in url for h in ERP_HOSTS):
            o = p.get('options') or {}
            b = ((o.get('batching') or {}).get('batch') or {})
            pg = ((o.get('pagination') or {}).get('pagination') or {})
            bits.append('ERP batch=%s/%sms timeout=%s' %
                        (b.get('batchSize'), b.get('batchInterval'), o.get('timeout')))
            if pg:
                bits.append('page ri=%s max=%s' % (pg.get('requestInterval'), pg.get('maxRequests')))
        js = code_of(n)
        if js:
            bits.append('js %dch sha=%s' % (len(js), hashlib.sha256(js.encode()).hexdigest()[:8]))
        blob = json.dumps(p) + ' ' + str(n.get('notes') or '')
        for tag in TAGS:
            if tag in blob:
                bits.append('[' + tag.split(': ')[1] + ']')
        mode = ((p.get('workflowInputs') or {}).get('value') or {}).get('mode')
        if mode in ('acquire', 'release'):
            bits.append('lease=' + mode)
        print('  %-34s %-26s %s' % (n.get('name'), t, '  '.join(bits)))
    conns = w.get('connections') or {}
    edges = 0
    print('  -- connections --')
    for src in sorted(conns):
        for i, grp in enumerate(conns[src].get('main') or []):
            tgts = [c.get('node') for c in (grp or [])]
            edges += len(tgts)
            if tgts:
                print('  %-34s out%d -> %s' % (src, i, ', '.join(tgts)))
    print('  %d edge(s), %d group(s)' % (edges, len(w.get('nodeGroups') or [])))

def check_js(path):
    w = load(path)
    bad = 0
    for n in w.get('nodes') or []:
        js = code_of(n)
        if not js:
            continue
        # A Code node body is not a module and may use n8n globals, so only SYNTAX is checked.
        # n8n runs the body inside an ASYNC function, so top-level `await` is legal there and
        # `node --check` on the bare body would reject it. Wrapping reproduces n8n's own frame -
        # without it this reported BAD JS on a correctly transcribed node ('Fetch All-Time for
        # Flagged', 2026-08-23), which is a false alarm on the one signal that guards a hand
        # transcription. The wrapper adds one line, so reported line numbers are offset by 1.
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
            f.write('(async function () {\n' + js + '\n});\n'); p = f.name
        try:
            r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        finally:
            os.unlink(p)
        if r.returncode:
            bad += 1
            first = (r.stderr.strip().splitlines() or [''])
            print('  BAD JS  %s: %s' % (n.get('name'), ' / '.join(first[:4])[:300]))
        else:
            print('  ok js   %s (%d chars)' % (n.get('name'), len(js)))
    return bad

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    if args[0] == '--check-js':
        total = 0
        for p in args[1:]:
            print('=' * 78); print(p)
            total += check_js(p)
        print('=' * 78)
        print('%d node body/bodies failed `node --check`' % total)
        sys.exit(1 if total else 0)
    for p in args:
        report(p)
