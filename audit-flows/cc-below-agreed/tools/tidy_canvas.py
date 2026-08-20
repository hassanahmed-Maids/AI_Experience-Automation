#!/usr/bin/env python3
"""
tidy_canvas.py - lay an n8n workflow out cleanly WITHOUT changing what it does.

WHY THIS IS NOT COSMETIC. With `executionOrder: v1`, n8n runs equally-ready branches in
POSITION order - top to bottom, then left to right. Position is behaviour. On 2026-08-19 that
cost this project a production defect: WF-A's `Respond 200` sat at y=-144, below the five sweep
starters, so it executed 6th - after ~30 minutes of ERP sweeps - and every caller got a
Cloudflare 524 instead of its acknowledgement. Moving one coordinate fixed it.

So a "tidy the canvas" pass is a behaviour-changing operation unless it is constrained, and the
constraint is this:

    for every node that fans out to several targets, the ORDER those targets execute in must be
    identical before and after the move.

The script therefore:
  1. reads the CURRENT execution order of every fan-out, by sorting targets on (y, x);
  2. turns each fan-out into ordering constraints (a must sort before b);
  3. assigns y-slots by topological sort over those constraints, so every constraint holds;
  4. assigns x by topological RANK, so the flow reads left to right;
  5. RE-DERIVES every fan-out's order from the new coordinates and asserts it matches the old.

Step 5 is the point. If it fails, the layout is rejected and nothing is emitted - a tidy that
cannot prove it preserved order is worth less than a messy canvas that works.

USAGE
  python3 tools/tidy_canvas.py <workflow.json> [--emit]
    (no flag) report the plan and the verification result
    --emit    also print setNodePosition operations as JSON, ready for update_workflow

Sticky notes are NEVER moved. They are not executed, they carry the human commentary, and their
placement is deliberate; repositioning them mechanically would scramble the annotations that make
these flows readable in the first place.
"""
import json, sys
from collections import defaultdict, deque

COL, ROW = 300, 140          # horizontal gap between ranks, vertical gap between slots
STICKY = 'n8n-nodes-base.stickyNote'

def load(path):
    d = json.load(open(path))
    w = d['workflow'] if 'workflow' in d else d
    return w

def exec_nodes(w):
    return [n for n in w['nodes'] if n['type'] != STICKY]

def fanouts(w, names):
    """source -> ordered list of targets, as n8n would run them TODAY."""
    pos = {n['name']: n['position'] for n in w['nodes']}
    out = {}
    for src, c in (w.get('connections') or {}).items():
        if src not in names: continue
        tgts = []
        for br in (c.get('main') or []):
            for l in (br or []):
                if l['node'] in names and l['node'] not in tgts:
                    tgts.append(l['node'])
        if len(tgts) > 1:
            # n8n v1: equally-ready nodes run sorted by y, then x
            out[src] = sorted(tgts, key=lambda t: (pos[t][1], pos[t][0]))
    return out

def ranks(w, names):
    """longest-path rank from any node with no inbound edge."""
    succ = defaultdict(list); indeg = {n: 0 for n in names}
    for src, c in (w.get('connections') or {}).items():
        if src not in names: continue
        for br in (c.get('main') or []):
            for l in (br or []):
                if l['node'] in names:
                    succ[src].append(l['node']); indeg[l['node']] += 1
    q = deque([n for n in names if indeg[n] == 0]); rank = {n: 0 for n in names}
    seen = dict(indeg)
    while q:
        n = q.popleft()
        for m in succ[n]:
            rank[m] = max(rank[m], rank[n] + 1)
            seen[m] -= 1
            if seen[m] == 0: q.append(m)
    return rank

def slots(names, constraints):
    """
    y-slot per node. Longest-path over the constraint DAG, so every 'a before b' holds, then
    collisions inside a rank are pushed down to the next free slot.

    Longest-path rather than a plain topological index because a plain index gives every node
    its own row - a 60-node flow becomes a 60-row staircase, which satisfies the constraints and
    is unreadable. Longest-path collapses everything unconstrained onto row 0 and only pushes a
    node down when something actually has to sit above it, which is what makes the error rail
    settle at the bottom and the happy path run straight across the top.
    """
    succ = defaultdict(list); indeg = {n: 0 for n in names}
    for a, b in constraints:
        succ[a].append(b); indeg[b] += 1
    q = deque([n for n in names if indeg[n] == 0]); slot = {n: 0 for n in names}
    seen = dict(indeg)
    while q:
        n = q.popleft()
        for m in succ[n]:
            slot[m] = max(slot[m], slot[n] + 1)
            seen[m] -= 1
            if seen[m] == 0: q.append(m)
    if any(v > 0 for v in seen.values()):
        raise SystemExit('ordering constraints are cyclic - cannot lay out safely')
    return slot

def deoverlap(newpos, rank):
    """
    Two nodes in the same rank at the same slot would sit on top of each other. Push the later
    one down to the next free slot in THAT rank only. Nodes sharing a slot are by construction
    unconstrained relative to each other, so moving one down cannot break a fan-out - but the
    caller verifies that anyway rather than trusting this paragraph.
    """
    byrank = defaultdict(list)
    for n, (x, y) in newpos.items():
        byrank[rank[n]].append(n)
    for r, members in byrank.items():
        taken = set()
        for n in sorted(members, key=lambda m: (newpos[m][1], m)):
            y = newpos[n][1]
            while y in taken:
                y += ROW
            taken.add(y)
            newpos[n][1] = y
    return newpos

def plan(w):
    names = [n['name'] for n in exec_nodes(w)]
    nameset = set(names)
    fo_before = fanouts(w, nameset)
    cons = []
    for src, tgts in fo_before.items():
        for a, b in zip(tgts, tgts[1:]):
            cons.append((a, b))
    slot = slots(names, cons)
    rk = ranks(w, nameset)
    newpos = {n: [rk[n] * COL, slot[n] * ROW] for n in names}
    newpos = deoverlap(newpos, rk)
    # AI SUB-NODES DO NOT TRAVEL ON `main`. A language model or output parser attaches to its
    # agent through an ai_* connection, so the main-graph rank puts it at column 0 - which on
    # WF-A left the Anthropic model and the Verdict Schema 9,000px away from the agent they
    # belong to. Tuck each one under its consumer instead. They are not part of any main
    # fan-out, so this cannot affect execution order, and the verify step below still runs.
    subs = {}
    for src, c in (w.get('connections') or {}).items():
        if src not in newpos: continue
        for ctype, branches in c.items():
            if ctype == 'main': continue
            for br in (branches or []):
                for l in (br or []):
                    if l['node'] in newpos:
                        subs.setdefault(l['node'], []).append(src)
    for consumer, kids in subs.items():
        cx, cy = newpos[consumer]
        for i, k in enumerate(sorted(kids)):
            newpos[k] = [cx + (i - (len(kids) - 1) / 2) * COL, cy + ROW * 2]
    # VERIFY: re-derive every fan-out's order from the new coordinates
    bad = []
    for src, before in fo_before.items():
        after = sorted(before, key=lambda t: (newpos[t][1], newpos[t][0]))
        if after != before:
            bad.append((src, before, after))
    return newpos, fo_before, bad, rk

def main():
    path = sys.argv[1]
    emit = '--emit' in sys.argv
    w = load(path)
    newpos, fo, bad, rk = plan(w)
    print(f"{w['name']}")
    print(f"  executable nodes : {len(newpos)}   sticky notes: {len(w['nodes']) - len(newpos)} (never moved)")
    print(f"  ranks (columns)  : {max(rk.values()) + 1}")
    print(f"  fan-outs to hold : {len(fo)}")
    for src, tgts in sorted(fo.items()):
        print(f"      {src} -> {len(tgts)} targets: {', '.join(tgts[:4])}{' ...' if len(tgts) > 4 else ''}")
    if bad:
        print("  VERIFY: FAILED - execution order would change. Nothing emitted.")
        for src, b, a in bad:
            print(f"      {src}\n        before: {b}\n        after : {a}")
        sys.exit(1)
    print("  VERIFY: every fan-out keeps its exact execution order")
    if emit:
        ops = [{"type": "setNodePosition", "nodeName": n, "position": [int(round(p[0])), int(round(p[1]))]} for n, p in sorted(newpos.items())]
        print(json.dumps(ops))

if __name__ == '__main__':
    main()
