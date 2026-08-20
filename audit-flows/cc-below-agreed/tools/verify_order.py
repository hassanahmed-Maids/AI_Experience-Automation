#!/usr/bin/env python3
"""
verify_order.py - prove a canvas tidy did not change what the workflow does.

Takes the BEFORE and AFTER exports of the same workflow and compares, for every fan-out, the
order n8n would run the targets in: equally-ready branches execute sorted by (y, x) under
executionOrder v1. Any difference is a behaviour change wearing a layout change's clothes.

  python3 tools/verify_order.py before.json after.json
"""
import json, sys

STICKY = 'n8n-nodes-base.stickyNote'

def orders(path):
    d = json.load(open(path)); w = d['workflow'] if 'workflow' in d else d
    pos = {n['name']: n['position'] for n in w['nodes'] if n['type'] != STICKY}
    out = {}
    for src, c in (w.get('connections') or {}).items():
        if src not in pos: continue
        for bi, br in enumerate(c.get('main') or []):
            tg = [l['node'] for l in (br or []) if l['node'] in pos]
            if len(tg) > 1:
                out[f'{src}#{bi}'] = sorted(set(tg), key=lambda t: (pos[t][1], pos[t][0]))
    # also the cross-branch view: all targets of a node, however branched
    for src, c in (w.get('connections') or {}).items():
        if src not in pos: continue
        tg = []
        for br in (c.get('main') or []):
            for l in (br or []):
                if l['node'] in pos and l['node'] not in tg: tg.append(l['node'])
        if len(tg) > 1:
            out[f'{src}#all'] = sorted(tg, key=lambda t: (pos[t][1], pos[t][0]))
    return out, w['name']

a, na = orders(sys.argv[1])
b, nb = orders(sys.argv[2])
print(f'{na}')
keys = sorted(set(a) | set(b))
bad = 0
for k in keys:
    if a.get(k) != b.get(k):
        bad += 1
        print(f'  CHANGED  {k}\n     before: {a.get(k)}\n     after : {b.get(k)}')
print(f'  {len(keys)} fan-out orderings compared, {bad} changed')
sys.exit(1 if bad else 0)
