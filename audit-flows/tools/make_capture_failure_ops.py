#!/usr/bin/env python3
"""
make_capture_failure_ops.py - generate the update_workflow ops that un-mute an error rail.

WHY THIS IS A TOOL AND NOT NINE HAND EDITS. `Release Lease (error)` is an Execute Sub-workflow
node, and those REPLACE their input item with the sub-workflow's return value. Every rail in this
repo ran `failing node -> Release Lease (error) -> Fail Loudly` with Fail Loudly reading $input, so
the only message any of them could produce was 'FAILED at "unknown node": unknown error'. Twelve of
thirteen flows had it (2026-08-23).

The fix is identical in every flow - insert a capture node ahead of the release, re-point every
error output at it, and change one read in the terminal - which is exactly the kind of repetition
that goes wrong when it is done nine times by hand. Doing it here also means the NEXT flow that
grows a rail gets the same shape from the same file.

  python3 tools/make_capture_failure_ops.py exports/ccprice-stage1.json > ops.json
  python3 tools/make_capture_failure_ops.py --all              # report what it would touch

The Fail Loudly rewrite is textual and DELIBERATELY NARROW: it replaces the exact
`const item = $input.first().json || {};` preamble that every one of these terminals shares, and
REFUSES a flow whose terminal does not match rather than guessing at a body it does not recognise.
A tool that half-edits a re-throw node is worse than one that declines to.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAPTURE = os.path.join(HERE, 'erp_capture_failure.js')

RELEASE = 'Release Lease (error)'
CAPTURE_NODE = 'Capture Failure'
TERMINAL = 'Fail Loudly'

# The preamble every mute terminal shares, and what it becomes. Both halves are matched exactly:
# `$input` is what makes the node mute, and the replacement is what the three already-fixed flows
# deployed, so a flow fixed by this tool is byte-identical in this region to one fixed by hand.
OLD_READ = """const item = $input.first().json || {};"""

def load(path):
    o = json.load(open(path))
    return o.get('workflow', o)

def node_by_name(w, name):
    for n in w.get('nodes') or []:
        if n.get('name') == name:
            return n
    return None

def rail_feeders(w):
    """Every (source, output index) that currently feeds the release node."""
    out = []
    for src, spec in (w.get('connections') or {}).items():
        for i, group in enumerate(spec.get('main') or []):
            for c in group or []:
                if c.get('node') == RELEASE:
                    out.append((src, i))
    return sorted(out)

def terminal_bypassers(w):
    """Error outputs wired STRAIGHT to the terminal, skipping the release node entirely.

    Found 2026-08-23, immediately after deploying the first flow: CC Below Agreed 3-Deliver wires
    `Release ERP Lease`'s own error output directly at `Fail Loudly`. That path never went through
    the lease call, so reading $input there was CORRECT - it carried the real error. Re-pointing
    the terminal at Capture Failure without also re-pointing this edge would have turned a working
    path into one reporting "unknown node", which is the exact bug being fixed, introduced by the
    fix. Three of the nine flows had such an edge.

    So these feeders are rerouted too: everything that can reach the terminal goes through the
    capture node, and the terminal has exactly one way in.
    """
    out = []
    for src, spec in (w.get('connections') or {}).items():
        if src in (RELEASE, CAPTURE_NODE):
            continue
        for i, group in enumerate(spec.get('main') or []):
            for c in group or []:
                if c.get('node') == TERMINAL:
                    out.append((src, i))
    return sorted(out)

def capture_position(w):
    """Left of the release node, on its row - so the rail still reads left to right on the canvas."""
    rel = node_by_name(w, RELEASE)
    pos = (rel or {}).get('position') or [0, 0]
    return [pos[0] - 240, pos[1]]

def rewrite_terminal(body):
    """Return the un-muted terminal body, or None if this is not a shape we recognise."""
    # The whole error-derivation block, from the $input read through the last local it defines.
    # These terminals already call their locals `msg` and `failedNode`, which is what the
    # replacement binds - so nothing downstream of the block needs rewriting, and a flow fixed here
    # is byte-identical in this region to the three that were fixed by hand.
    m = re.search(re.escape(OLD_READ) + r'.*?\bconst failedNode = String\([^\n]*\n', body, re.S)
    if not m:
        return None
    replacement = ("let msg = 'unknown error', failedNode = 'unknown node';\n"
                   "try {\n"
                   "  const f = ($('" + CAPTURE_NODE + "').first().json || {})._failure || {};\n"
                   "  if (f.message) msg = String(f.message);\n"
                   "  if (f.node) failedNode = String(f.node);\n"
                   "} catch (e) { }\n")
    out = body[:m.start()] + replacement + body[m.end():]
    # Refuse if the swap left an error still coming off $input - the thing being fixed.
    if re.search(r'(?:const|let|var)\s+(\w+)\s*=\s*\$input\.first\(\)\.json', out):
        for mm in re.finditer(r'(?:const|let|var)\s+(\w+)\s*=\s*\$input\.first\(\)\.json', out):
            ident = mm.group(1)
            for f in ('.error', '.message', '.node'):
                if re.search(r'\b' + re.escape(ident) + re.escape(f) + r'\b', out):
                    return None
    return out

def ops_for(path):
    w = load(path)
    if node_by_name(w, CAPTURE_NODE):
        return None, '%s already has a %s node' % (w['id'], CAPTURE_NODE)
    if not node_by_name(w, RELEASE) or not node_by_name(w, TERMINAL):
        return None, '%s has no %s / %s pair - not a rail this tool understands' % (
            w['id'], RELEASE, TERMINAL)
    feeders = rail_feeders(w) + terminal_bypassers(w)
    if not feeders:
        return None, '%s: nothing feeds %s' % (w['id'], RELEASE)
    if feeders == [(CAPTURE_NODE, 0)]:
        return None, '%s is already captured' % w['id']

    body = node_by_name(w, TERMINAL)['parameters'].get('jsCode') or ''
    new_body = rewrite_terminal(body)
    if new_body is None:
        return None, ('%s: "%s" does not match the known mute shape. REFUSING - a half-edited '
                      're-throw node is worse than an unedited one. Fix it by hand.' % (w['id'], TERMINAL))

    ops = [{'type': 'addNode', 'node': {
        'name': CAPTURE_NODE, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
        'position': capture_position(w),
        'parameters': {'jsCode': open(CAPTURE).read()}}}]
    bypass = set(terminal_bypassers(w))
    for src, idx in feeders:
        old_target = TERMINAL if (src, idx) in bypass else RELEASE
        ops.append({'type': 'removeConnection', 'source': src, 'target': old_target, 'sourceIndex': idx})
        ops.append({'type': 'addConnection', 'source': src, 'target': CAPTURE_NODE, 'sourceIndex': idx})
    ops.append({'type': 'addConnection', 'source': CAPTURE_NODE, 'target': RELEASE})
    ops.append({'type': 'updateNodeParameters', 'nodeName': TERMINAL,
                'parameters': {'jsCode': new_body}})
    return ops, '%s %-44s %d feeder(s), %d ops' % (w['id'], w['name'][:44], len(feeders), len(ops))

def main(argv):
    if not argv:
        print(__doc__.strip()); return 2
    if argv[0] == '--all':
        import glob
        bad = 0
        for p in sorted(glob.glob(os.path.join(ROOT, 'exports', '*.json'))):
            try:
                ops, msg = ops_for(p)
            except Exception as e:
                continue
            if ops:
                print('WOULD FIX  ' + msg)
            elif 'REFUSING' in msg:
                print('REFUSE     ' + msg); bad += 1
        return 1 if bad else 0
    ops, msg = ops_for(argv[0])
    if ops is None:
        sys.stderr.write(msg + '\n'); return 1
    sys.stderr.write(msg + '\n')
    print(json.dumps(ops, indent=1, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
