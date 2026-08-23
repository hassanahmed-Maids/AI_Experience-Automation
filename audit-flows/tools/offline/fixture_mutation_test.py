#!/usr/bin/env python3
"""
fixture_mutation_test.py - prove the MV graph fixtures are worth running.

A fixture that PASSES tells you nothing on its own: a fixture with the relevant fields simply
missing also passes. So every property the MV re-audit fixed gets broken here, one at a time, and
the checker has to notice. If a mutant survives, the fixture is not testing what it claims to.

  python3 tools/offline/fixture_mutation_test.py

What this does NOT prove, said plainly: the fixtures are hand-transcribed from the live drafts, so
this checks the CHECKER against the flow as described, not the flow as deployed. Only a real
export does that. See tools/offline/fixtures/README.md.
"""
import json, subprocess, sys, tempfile, os

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
CHECKER = os.path.join(os.path.dirname(HERE), 'erp_compliance.py')

def run(w):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(w, f); p = f.name
    try:
        r = subprocess.run([sys.executable, CHECKER, p], capture_output=True, text=True)
        return r.stdout + r.stderr
    finally:
        os.unlink(p)

def node(w, name):
    return next(n for n in w['nodes'] if n['name'] == name)

RESULTS = []
def mut(label, fixture, fn):
    w = json.load(open(os.path.join(FIX, fixture)))
    fn(w)
    RESULTS.append((label, 'FAIL' in run(w)))

def baseline(fixture):
    w = json.load(open(os.path.join(FIX, fixture)))
    out = run(w)
    RESULTS.append(('BASELINE clean: ' + fixture, 'FAIL' not in out))

def kill_rail(w):
    w['nodes'] = [n for n in w['nodes'] if n['name'] not in ('Release Lease (error)', 'Fail Loudly')]
    for n in w['nodes']:
        n.pop('onError', None)
    for v in w['connections'].values():
        v['main'] = [g for g in v['main'] if not any(c['node'] == 'Release Lease (error)' for c in g)]
    w['connections'].pop('Release Lease (error)', None)

def kill_gate(w):
    w['nodes'] = [n for n in w['nodes'] if n['name'] != 'ERP Budget Gate']
    w['connections']['Read Findings'] = {'main': [[{'node': 'Read WhatsApp Log'}],
                                                  [{'node': 'Release Lease (error)'}]]}
    w['connections'].pop('ERP Budget Gate', None)

for f in ('mv-stage0-graph.json', 'mv-stage1-graph.json', 'mv-stage2-graph.json',
          'mv-stage4-graph.json', 'ccprice-stage3-graph.json'):
    baseline(f)

# §1 - the pacing that was DECLARED in a sticky note and not implemented, on both flows that had it
mut('stage0: batchInterval removed from Fetch Population Page', 'mv-stage0-graph.json',
    lambda w: node(w, 'Fetch Population Page')['parameters']['options']['batching']['batch'].pop('batchInterval'))
mut('stage4: batchInterval removed from Read WhatsApp Log', 'mv-stage4-graph.json',
    lambda w: node(w, 'Read WhatsApp Log')['parameters']['options']['batching']['batch'].pop('batchInterval'))

# §5 - each breaker exemption, in the node it has to live in
mut('stage0: no-breaker-because stripped from Project Group', 'mv-stage0-graph.json',
    lambda w: node(w, 'Project Group')['parameters'].__setitem__('jsCode', '// projects the group\n'))
mut('stage1: no-breaker-because stripped from Check Access And Plan Cohorts', 'mv-stage1-graph.json',
    lambda w: node(w, 'Check Access And Plan Cohorts')['parameters'].__setitem__('jsCode', 'throw new Error("x");\n'))
mut('stage2: no-breaker-because stripped from Score Contract Month', 'mv-stage2-graph.json',
    lambda w: node(w, 'Score Contract Month').pop('notes'))
mut('stage4: breaker and declaration stripped from Assemble Evidence', 'mv-stage4-graph.json',
    lambda w: node(w, 'Assemble Evidence')['parameters'].__setitem__('jsCode', '// assembles evidence\n'))

# §4 - the error rail, both halves: does it exist, and does it re-throw
mut('stage1: error rail removed entirely', 'mv-stage1-graph.json', kill_rail)
mut('stage4: error rail removed entirely', 'mv-stage4-graph.json', kill_rail)
mut('stage1: Fail Loudly stops throwing', 'mv-stage1-graph.json',
    lambda w: node(w, 'Fail Loudly')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))
mut('stage4: Fail Loudly stops throwing', 'mv-stage4-graph.json',
    lambda w: node(w, 'Fail Loudly')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))

# §3 - the gate the fixture found, on the entry point nobody had costed
mut('stage4: budget gate removed', 'mv-stage4-graph.json', kill_gate)

bad = 0
for label, ok in RESULTS:
    print(('ok   ' if ok else 'MISS ') + label)
    if not ok:
        bad += 1
print()
print('%d/%d' % (len(RESULTS) - bad, len(RESULTS)) +
      (' - a mutant SURVIVED, so the fixture is not testing what it claims' if bad else ' passed'))
sys.exit(1 if bad else 0)
