#!/usr/bin/env python3
"""
seam_check.py - static checks across DEPLOYED n8n workflow JSON.

WHY THIS EXISTS. Execution 94122 (2026-08-19) was stopped by a guard after scoring
1 case per batch instead of 100. The cause was not logic: `Stamp Display Bands` read
its wire as one-item-per-case while its upstream emits ONE ENVELOPE item. It passed
11 green offline suites because the harness hand-built that node's input, modelling a
wiring the deployed graph does not have.

The lesson generalises: after a refactor MOVES nodes between workflows, the defects
live at the seams - and neither the offline suites (which supply their own fixtures)
nor a green execution status can see them. These two checks read the DEPLOYED graph
and need no ERP token and no run.

  CHECK 1  dangling $('Name') references
           A Code node that calls $('X') where X is not a node in the SAME workflow.
           n8n throws at runtime - unless the call sits in a try/catch, in which case
           the guard is silently dead and looks healthy forever. That is exactly what
           had happened to Build Runs Log's zero-cases fallback, which named
           'Compute Case States' after that node moved into WF-T.

  CHECK 2  envelope/per-item wire mismatches
           Upstream emits `[{json:{...}}]` (one envelope) while downstream does
           `$input.all().map(i => i.json)` (expects one item per record), or vice
           versa. This is the 94122 bug's shape.

USAGE
  Export each workflow's JSON (n8n MCP get_workflow_details, or the UI's Download),
  then:  python3 tools/seam_check.py wfa.json wft.json wfb.json ...
  Exit code 1 if any dangling reference is found.

READ THE OUTPUT, DO NOT AUTOMATE ON IT. Check 2 is a heuristic and has known false
positives, all of them legitimate patterns:
  - trigger nodes (executeWorkflowTrigger/webhook) emit ONE item, so a downstream
    $input.first() is correct;
  - the ERROR output of any node emits one error item, so error-rail nodes reading
    $input.first() are correct;
  - a $('Name') reference inside a COMMENT is not a reference (comments are stripped
    per-line, but a block comment containing $('X') can still slip through).
Check 1 is exact and its hits are real.
"""
import json, re, sys

TRIGGERS = ('executeWorkflowTrigger', 'webhook', 'manualTrigger', 'errorTrigger')

def strip_comments(code):
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
    return re.sub(r'//.*', '', code)

def out_shape(node):
    t = node.get('type', '')
    if any(t.endswith(x) for x in TRIGGERS):
        return 'single', 'trigger emits one item'
    if t == 'n8n-nodes-base.code':
        code = strip_comments(node.get('parameters', {}).get('jsCode', ''))
        m = list(re.finditer(r'\breturn\b', code))
        if not m:
            return '?', 'no return'
        tail = code[m[-1].start():]
        if re.match(r'return\s*\[\s*\{\s*json\s*:', tail):
            return 'envelope', 'return [{json:...}]'
        if re.search(r'return\s+[\w$.]+\.map\(', tail):
            return 'per-item', 'return X.map(...)'
        return '?', re.sub(r'\s+', ' ', tail[:60])
    if t == 'n8n-nodes-base.googleSheets':
        return 'per-item', 'one item per appended row'
    return '?', t.replace('n8n-nodes-base.', '')

def in_expect(node):
    if node.get('type') != 'n8n-nodes-base.code':
        return None, None
    code = strip_comments(node.get('parameters', {}).get('jsCode', ''))
    if re.search(r'\$input\.all\(\)', code):
        return 'per-item', '$input.all()'
    if re.search(r'\$input\.first\(\)', code):
        return 'envelope', '$input.first()'
    return 'ignores-wire', 'reads only $(named) nodes'

def main(paths):
    dangling = 0
    for p in paths:
        d = json.load(open(p))
        w = d.get('workflow', d)
        # exports/ also holds MANIFEST.json, a coverage contract and not a workflow. This used to
        # die on it with a bare KeyError, so one non-workflow file in the directory took down every
        # verdict in the run - the identical bug erp_load_check.py had, from the identical cause.
        # The `or d` also accepts a bare workflow object, which is how some exports are shaped.
        if not isinstance(w, dict) or 'nodes' not in w:
            print('=' * 70)
            print('%s\n  not a workflow export (no "nodes") - skipped' % p)
            continue
        nodes = {n['name']: n for n in w['nodes']}
        conns = w.get('connections', {})
        print('=' * 70)
        print(f"{w['name']}   ({p})")

        print('  -- check 1: dangling $(\'Name\') references')
        hits = 0
        for n in w['nodes']:
            if n['type'] != 'n8n-nodes-base.code':
                continue
            code = strip_comments(n['parameters'].get('jsCode', ''))
            for ref in sorted(set(re.findall(r"\$\('([^']+)'\)", code))):
                if ref not in nodes:
                    print(f"     !! {n['name']} -> $('{ref}')  NOT A NODE IN THIS WORKFLOW")
                    hits += 1; dangling += 1
        if not hits:
            print('     ok')

        print('  -- check 2: envelope / per-item wire mismatches (heuristic)')
        hits = 0
        for src, c in conns.items():
            if src not in nodes:
                continue
            for bi, branch in enumerate(c.get('main', []) or []):
                for link in (branch or []):
                    tgt = link['node']
                    if tgt not in nodes:
                        continue
                    os_, od = out_shape(nodes[src])
                    ie, idd = in_expect(nodes[tgt])
                    if ie in (None, 'ignores-wire'):
                        continue
                    if bi > 0:
                        continue  # branch >0 is usually an error/false output: one item
                    if os_ == 'envelope' and ie == 'per-item':
                        print(f"     !! {src} [{od}] -> {tgt} [{idd}]  ENVELOPE INTO PER-ITEM")
                        hits += 1
                    elif os_ == 'per-item' and ie == 'envelope':
                        print(f"     ?  {src} [{od}] -> {tgt} [{idd}]  per-item into first()")
                        hits += 1
        if not hits:
            print('     ok')
    print('=' * 70)
    print(f"dangling references: {dangling}")
    return 1 if dangling else 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1:]))
