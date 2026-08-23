#!/usr/bin/env python3
"""How long a full pass over every audit costs, at the pacing that is actually deployed.

WHY THIS EXISTS. "4 req/s" is a ceiling on SCHEDULING and not a prediction of wall-clock, and
nobody had the wall-clock number for the estate. Two things make the naive `calls / 4` wrong:

1. n8n's batching sends `batchSize` requests, WAITS FOR THEM, then sleeps `batchInterval` before
   the next batch. So the achieved rate is

       batchSize / (mean_latency + batchInterval / 1000)

   not batchSize / interval. At 2 in flight / 500 ms with 1 s calls that is 1.33 req/s, a third
   of the ceiling. Quoting the ceiling would understate every duration here by ~3x.

2. A check is not one rate. Its sweep and its per-entity phases are different nodes with
   different pacing and wildly different call counts - MV walks 575 pages at 1 req/s and then
   makes 46,000 detail calls at a different rate, and the first version of this tool applied the
   sweep's rate to all 47,000 calls and reported 13 hours instead of ~10. Phases are costed
   separately and summed.

AND THE LEASE MAKES THE TOTAL A SUM, NOT A MAX. Section 4 allows one audit at a time instance-
wide, so a full pass over every check is the sum of their durations plus queueing. That is the
number that decides whether these can all run overnight.

Rates are read from the DEPLOYED exports, so this cannot drift from the flows the way a figure
typed into a document does. Call counts are each flow's own documented worst case, cited per
phase. LATENCY IS THE DOMINANT UNKNOWN: only one route has ever been measured (~16 s per 100-row
page, ERP-LOAD-POLICY.md), so the table is printed across a band rather than pretending to one
number.

    python3 tools/erp_runtime_estimate.py [--latency 1.0]
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORTS = os.path.join(os.path.dirname(HERE), 'exports')
EXEC_CEILING_S = 2400   # ERP-LOAD-POLICY.md: this instance cancels an execution at 2400 s

# (export stem, node name, calls, why that count)
CHECKS = [
 ('CC Below Agreed Amount', [
   ('wfpop-sweep-population', 'Sweep Active Population',   135, '~5,405 rows at size 40'),
   ('wfs-sweep-statuses',     'Sweep Payment Statuses',     60, 'maxRequests 60, node comment'),
   ('wfe-enrich',             'Fetch Contract Plan',      5632, '5,612 contracts, node comment'),
   ('wfe-enrich',             'Fetch Replacements',       5632, 'the other half of the 11,264'),
   ('wfb-verify',             'Get Messages (WhatsApp)',   400, 'node comment: ~400 contracts verified'),
 ], False),
 ('CC Price by Cohort', [
   ('ccprice-stage1', 'Get Population (dynamic API)',   12, '~5,400 contracts at size 500'),
   ('ccprice-stage2', 'Get Contract Details',         5400, '~5,400 contracts, node comment'),
   ('ccprice-stage2', 'Get LiveInOut Logs',           5400, 'one per contract'),
   ('ccprice-stage2', 'Get Active CPT',               5400, 'one per contract'),
 ], True),
 ('MV Monthly Payment', [
   ('mv-stage0-sweep-population', 'Fetch Population Page',  575, '~23,000 contracts at 40 rows'),
   ('mv-stage2-score-chunk',      'Read Payment Ledger',  23000, '~23,000 contracts, node comment'),
   ('mv-stage2-score-chunk',      'Read Contract Details',23000, 'the other half of the ~47,000'),
   ('mv-stage4-verify',           'Read WhatsApp Log',      500, '2 calls per finding; 250 findings assumed'),
 ], True),
 ('Applicant Real Ticket', [
   ('realticket-audit-check', 'Get Population Pages',    10, '387 rows at size 40'),
   ('realticket-audit-check', 'Get Transaction Detail', 387, 'node comment: 387 rows'),
   ('realticket-audit-check', 'Get Flight Tickets',     261, 'node comment: 261 applicants'),
   ('realticket-audit-check', 'Get All-Time Reversals', 100, 'red tickets only; upper bound'),
 ], False),
 ('Dummy Tickets (Housemaids)', [
   ('dummy-stage1-score',        'Get Dummy Ticket Transactions', 25, '605 applicants at size 25'),
   ('dummy-stage1-score',        'Get Transaction Detail',       605, 'node comment: 605 applicants'),
   ('dummy-stage0-fetch-tickets','Get Hustler Tickets',          605, 'one per applicant'),
   ('dummy-stage1-score',        'Get All-Time Refunds',         605, 'verifier cases; upper bound'),
 ], True),
 ('Terminated Housemaid Tickets', [
   ('terminated-hm-stage1-score',         'Get FT29 Transactions',   3, '98 transactions at size 40'),
   ('terminated-hm-stage1-score',         'Get Transaction Detail',  98, 'node comment: 98 July rows'),
   ('terminated-hm-stage0-fetch-profiles','Get Housemaid Info',      80, 'node comment: 80 maids'),
   ('terminated-hm-stage1-score',         'Get All-Time Reversals',   5, 'reversal refs only'),
 ], False),
]

def pacing(stem, node_name):
    """(batchSize, batchInterval_ms) as DEPLOYED, or None for a node that is not per-item paced."""
    p = os.path.join(EXPORTS, stem + '.json')
    d = json.load(open(p))
    w = d.get('workflow', d)
    for n in w.get('nodes') or []:
        if n.get('name') != node_name:
            continue
        o = (n.get('parameters') or {}).get('options') or {}
        b = ((o.get('batching') or {}).get('batch') or {})
        bs, bi = b.get('batchSize'), b.get('batchInterval')
        pg = ((o.get('pagination') or {}).get('pagination') or {})
        ri = pg.get('requestInterval')
        if isinstance(bs, int) and bs > 0 and isinstance(bi, int):
            return bs, bi
        if isinstance(ri, int):
            return 1, ri            # a paginated walk is sequential, one page per interval
        return 1, 0
    raise SystemExit('node not found in %s: %s' % (stem, node_name))

def phase_seconds(calls, bs, bi_ms, latency_s):
    """n8n waits for the batch, THEN sleeps the interval. Cycle = latency + interval."""
    batches = -(-calls // bs)                     # ceil
    return batches * (latency_s + bi_ms / 1000.0)

def hms(s):
    s = int(round(s)); h, m = s // 3600, (s % 3600) // 60
    return ('%dh%02dm' % (h, m)) if h else ('%dm%02ds' % (m, s % 60))

def run(latency_s, verbose):
    total = 0.0
    for name, phases, upper in CHECKS:
        dur = 0.0
        lines = []
        for stem, node, calls, why in phases:
            bs, bi = pacing(stem, node)
            s = phase_seconds(calls, bs, bi, latency_s)
            dur += s
            lines.append('    %-32s %6d calls  %d/%-4dms  %8s   (%s)' % (node, calls, bs, bi, hms(s), why))
        total += dur
        if verbose:
            print('%-30s %10s%s' % (name, hms(dur), '  *upper bound' if upper else ''))
            for l in lines: print(l)
            if dur > EXEC_CEILING_S:
                print('    ^ exceeds the %ds execution ceiling: must run as a fire-and-forget chain '
                      'of stages, which is how CC Below Agreed and CC Price are already built.' % EXEC_CEILING_S)
            print()
    return total

if __name__ == '__main__':
    band = [0.3, 1.0, 2.0]
    if '--latency' in sys.argv:
        band = [float(sys.argv[sys.argv.index('--latency') + 1])]
    print('Per-phase detail at %.1f s mean ERP latency' % band[len(band)//2])
    print('=' * 92)
    run(band[len(band)//2], True)
    print('Sensitivity - the lease serialises every check, so these are SUMS')
    print('=' * 92)
    print('%-24s %s' % ('mean ERP latency', '  '.join('%5.1f s' % l for l in band)))
    totals = [run(l, False) for l in band]
    print('%-24s %s' % ('full pass over all six', '  '.join('%7s' % hms(t) for t in totals)))
    print()
    print('Latency is the dominant unknown: only one route has been measured (~16 s per 100-row')
    print('page). At 16 s the population walks alone would take many hours - see ERP-LOAD-POLICY.md.')
