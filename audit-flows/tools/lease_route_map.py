#!/usr/bin/env python3
"""Print, for one flow, the route from its LAST ERP call to its lease release.

The companion to lease_release_check.py. That one says a flow can finish without releasing;
this one shows the shape you need in order to fix it: which node makes the last ERP call,
which breaker judges it, and what sits between there and the release.

The fix pattern this exists to serve:
  1. hang Release ERP Lease off the LAST ERP call's breaker as a dead-end parallel branch,
     so no delivery step sits between the last ERP call and the release (and the hold is
     shorter, which section 4 wants anyway);
  2. alwaysOutputData + an IF bypass for any origin still on the route whose empty case is
     a legitimate outcome;
  3. a written ruling for any origin that is non-empty by construction.

A dead-end PARALLEL branch, not a serial one: Release ERP Lease is an Execute Sub-workflow
with waitForSubWorkflow, so it REPLACES the item with the lease's own output. Putting it in
line would hand the next node the lease payload instead of the data - the same mistake that
made every error rail in this repo say "unknown error" for twelve flows.
"""
import json, os, sys

ERP_HOST = 'erpbackendpro.maids.cc'
SUBFLOW = 'n8n-nodes-base.executeWorkflow'


def load(p):
    d = json.load(open(p))
    return d.get('workflow', d)


def main(paths):
    for p in paths:
        w = load(p)
        nodes = {n['name']: n for n in w['nodes']}
        conns = w.get('connections', {})

        def succ(n, i=0):
            outs = (conns.get(n, {}) or {}).get('main', []) or []
            return [c['node'] for c in (outs[i] if i < len(outs) else [] or [])] if outs else []

        erp = [n['name'] for n in w['nodes']
               if ERP_HOST in json.dumps(n.get('parameters', {}))]
        rel = [n for n in nodes if nodes[n].get('type') == SUBFLOW
               and 'elease' in n and 'error' not in n.lower()]
        acq = [n for n in nodes if nodes[n].get('type') == SUBFLOW and 'cquire' in n]

        print('=' * 78)
        print('%s   (%s)' % (os.path.basename(p), w.get('id', '?')))
        print('  acquire : %s' % (', '.join(acq) or '(none)'))
        print('  release : %s' % (', '.join(rel) or '(none)'))
        print('  ERP calls, and what judges each:')
        for e in erp:
            print('      %-30s -> %s' % (e, ', '.join(succ(e)) or '(terminal)'))
        for r in rel:
            print('  currently fed by:')
            for src, o in conns.items():
                for outs in (o or {}).values():
                    for idx, lst in enumerate(outs or []):
                        if any(c['node'] == r for c in (lst or [])):
                            print('      %s [out %d]' % (src, idx))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
