#!/usr/bin/env python3
"""
erp_load_check.py - refuse to ship an audit flow that can hurt ERP.

ERP was taken down three times by audit traffic. The cause was never a single reckless node; it
was that a per-item HTTP node's pacing is invisible at build time and only becomes load when the
population is large. Every per-item node in cc-below-agreed was set to 15 concurrent / 500 ms =
30 req/s - three times the ceiling the build method already documented - and nobody chose 15. It
was cloned forward from a sibling, exactly the way the Cases sheet target was.

So the pacing is checked mechanically, against ERP-LOAD-POLICY.md, before anything is published.

  python3 tools/erp_load_check.py <workflow.json> [more.json ...]

Exit 1 if any live ERP node violates the policy. Disabled nodes are reported as warnings, not
failures - they cannot make a call today, but they can be re-enabled by someone who does not
know why they were off.

WHAT IT CANNOT SEE, said plainly so nobody reads a green run as full coverage:
  - how MANY items reach a node. Concurrency is capped here; total call VOLUME is the
    pre-flight budget gate's job, at runtime, because only the run knows the cohort size.
  - whether a Code node makes its own HTTP calls. It cannot; n8n Code nodes have no fetch.
  - what ERP actually tolerates. These numbers are a policy, not a measurement.
"""
import json, sys

# --- ERP-LOAD-POLICY.md section 1 -------------------------------------------------------
MAX_CONCURRENCY   = 2       # batching.batch.batchSize
MIN_BATCH_MS      = 500     # batching.batch.batchInterval
MIN_PAGE_MS       = 250     # pagination.requestInterval
MAX_TIMEOUT_MS    = 120000  # anything longer is a stuck request holding a slot
ERP_HOSTS         = ('erpbackendpro.maids.cc', 'erp.maids.cc')

def is_erp(node):
    p = node.get('parameters') or {}
    url = str(p.get('url') or '')
    return any(h in url for h in ERP_HOSTS)

def is_per_item(node):
    """
    Does this node fire ONCE PER INPUT ITEM, or once for the whole run?

    It matters because the two are paced by different settings, and applying the wrong rule is
    how a checker earns a reputation for crying wolf - after which nobody reads it, which is
    worse than not having one.

      per-item  -> URL/query/body interpolates `$json`, so the node fans out over the items it
                   is handed. Paced by batching.batch (batchSize / batchInterval). This is the
                   dangerous class: 5,632 candidates x 2 calls at 15 concurrent is the traffic
                   that took ERP down.
      run-level -> references only named nodes ($('Read Payment Window')), so it fires once and
                   any paging is sequential. Paced by pagination.requestInterval. batchSize on
                   these is irrelevant, and failing them for it is noise.
    """
    blob = json.dumps(node.get('parameters') or {})
    return '$json' in blob

def num(v):
    """A pacing number, or None if it is not one this tool can compare.

    n8n lets any of these fields hold an EXPRESSION - the stored value is then a string that
    starts with '=' and whose real value is only known at runtime. Comparing that to an int
    raises TypeError in Python 3, so a single expression-valued batchInterval used to CRASH this
    checker rather than report anything. A crash is the worst failure mode available here: the
    run that crashes is the run nobody gets a verdict from.

    So: parse what is parseable, and hand back None for the rest. None is already the "this is
    not set" case every caller handles, and unreadable_pacing() below says out loud which fields
    could not be read, so an expression is reported rather than silently treated as absent.
    """
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def unreadable_pacing(n):
    """Names the pacing fields whose value is an expression rather than a literal."""
    p = n.get('parameters') or {}
    o = p.get('options') or {}
    b = ((o.get('batching') or {}).get('batch') or {})
    pg = ((o.get('pagination') or {}).get('pagination') or {})
    out = []
    for label, val in (('batchSize', b.get('batchSize')), ('batchInterval', b.get('batchInterval')),
                       ('requestInterval', pg.get('requestInterval')), ('maxRequests', pg.get('maxRequests')),
                       ('timeout', o.get('timeout'))):
        if val is not None and num(val) is None:
            out.append('%s=%r' % (label, val))
    return out

def check_node(w, n):
    """returns (failures, warnings) as lists of strings"""
    p = n.get('parameters') or {}
    o = p.get('options') or {}
    b = ((o.get('batching') or {}).get('batch') or {})
    pg = ((o.get('pagination') or {}).get('pagination') or {})
    f, warn = [], []
    per_item = is_per_item(n)

    # AN EXPRESSION IS NOT A CEILING. A pacing field set to "={{ ... }}" is caller-tunable, and
    # section 1 is a policy ceiling rather than a preference - a rate a caller can set is a rate
    # a caller can set wrong. It is also unreadable here, so it would otherwise pass by accident.
    expr = unreadable_pacing(n)
    if expr:
        f.append('pacing set by EXPRESSION, not a literal: ' + ', '.join(expr) +
                 '. This tool cannot check a value that only exists at runtime, and a ceiling a '
                 'caller can override is not a ceiling. Use a literal.')

    if per_item:
        conc = num(b.get('batchSize'))
        bi = num(b.get('batchInterval'))
        if conc is None:
            f.append('per-item node with no batchSize - every input item fires at once')
        elif conc == -1:
            f.append('per-item node with batchSize -1 (all items in ONE batch) - unbounded concurrency')
        elif conc > MAX_CONCURRENCY:
            rate = conc / ((bi or 1) / 1000.0)
            f.append('per-item node at batchSize %s / %sms = %.0f req/s, over the %d req/s ceiling'
                     % (conc, bi, rate, MAX_CONCURRENCY * 1000 // MIN_BATCH_MS))
        if bi is None or bi < MIN_BATCH_MS:
            f.append('per-item node with batchInterval %s, below the %dms minimum' % (bi, MIN_BATCH_MS))
    else:
        # run-level: batching is inert, but say so rather than silently skipping it
        rl_conc = num(b.get('batchSize'))
        if rl_conc not in (None, -1) and rl_conc > MAX_CONCURRENCY:
            warn.append('batchSize %s on a run-level node - inert today, but it would bite if this '
                        'node were ever fed many items' % rl_conc)

    if pg:
        ri = num(pg.get('requestInterval'))
        if ri is None or ri < MIN_PAGE_MS:
            f.append('paginated with requestInterval %s - below the %dms minimum, so pages fire '
                     'back to back' % (ri, MIN_PAGE_MS))
        if not num(pg.get('maxRequests')):
            f.append('paginated with no maxRequests - a walk that never terminates has no bound')

    t = num(o.get('timeout'))
    if t is None:
        f.append('no timeout - a hung ERP call holds its slot for ever')
    elif t > MAX_TIMEOUT_MS:
        warn.append('timeout %sms is above the usual %sms' % (t, MAX_TIMEOUT_MS))

    if n.get('onError') is None:
        warn.append('no onError set - a failure will not reach the error rail')
    return f, warn

def main(paths):
    total_fail = 0
    for path in paths:
        d = json.load(open(path)); w = d['workflow'] if 'workflow' in d else d
        # exports/ also holds MANIFEST.json, which is a coverage contract and not a workflow.
        # This used to crash on it with a bare KeyError the moment the manifest was added to that
        # directory - and a checker that dies on an unexpected file is a checker that reports
        # nothing about the files it could have read.
        if not isinstance(w, dict) or 'nodes' not in w:
            print('=' * 78)
            print('%s\n  not a workflow export (no "nodes") - skipped' % path)
            continue
        nodes = [n for n in w['nodes'] if n.get('type') == 'n8n-nodes-base.httpRequest' and is_erp(n)]
        print('=' * 78)
        print('%s   (%d ERP node%s)' % (w.get('name', path), len(nodes), '' if len(nodes) == 1 else 's'))
        if not nodes:
            print('  no ERP HTTP nodes')
            continue
        for n in sorted(nodes, key=lambda x: x['name']):
            f, warn = check_node(w, n)
            state = ' [DISABLED]' if n.get('disabled') else ''
            if not f and not warn:
                print('  ok   %s%s' % (n['name'], state))
                continue
            for m in f:
                if n.get('disabled'):
                    print('  warn %s%s\n         %s' % (n['name'], state, m))
                else:
                    print('  FAIL %s\n         %s' % (n['name'], m)); total_fail += 1
            for m in warn:
                print('  warn %s%s\n         %s' % (n['name'], state, m))
    print('=' * 78)
    print('%d policy violation%s on live nodes' % (total_fail, '' if total_fail == 1 else 's'))
    return 1 if total_fail else 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1:]))
