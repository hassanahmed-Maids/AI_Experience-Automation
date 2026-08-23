#!/usr/bin/env python3
"""
export_mutation_test.py - prove `erp_compliance.py --all` would notice.

A green run tells you nothing on its own: a checker that silently stopped looking is also green.
So every property the MV re-audit fixed gets broken here, one at a time, against the REAL export,
and the checker has to fail. If a mutant survives, the check that was supposed to protect that
property is not doing it.

  python3 tools/offline/export_mutation_test.py

Runs against exports/, which is gitignored and refreshed from n8n - the same precondition `--all`
has. With no exports present it says so and exits 0 rather than pretending to have run; take fresh
exports first (see exports/README.md).

This replaced a set of hand-built graph fixtures under tools/offline/fixtures/. Those existed only
because the flows could not be exported at all; once real exports existed, keeping both would have
meant two descriptions of the same flow and one of them going stale unnoticed. Mutating the real
export is strictly better - it tests the checker against the structure that is actually deployed.
"""
import json, subprocess, sys, tempfile, os

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
EXPORTS = os.path.join(os.path.dirname(TOOLS), 'exports')
CHECKER = os.path.join(TOOLS, 'erp_compliance.py')

def path(slug):
    return os.path.join(EXPORTS, slug)

def run(w):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({'workflow': w}, f); p = f.name
    try:
        r = subprocess.run([sys.executable, CHECKER, p], capture_output=True, text=True)
        return r.stdout + r.stderr
    finally:
        os.unlink(p)

def node(w, name):
    return next(n for n in w['nodes'] if n.get('name') == name)

RESULTS = []

def load(slug):
    d = json.load(open(path(slug)))
    return d.get('workflow', d)

def baseline(slug):
    RESULTS.append(('BASELINE clean: ' + slug, 'FAIL' not in run(load(slug))))

def mut(label, slug, fn):
    w = load(slug)
    fn(w)
    RESULTS.append((label, 'FAIL' in run(w)))

def kill_rail(w):
    w['nodes'] = [n for n in w['nodes'] if n.get('name') not in ('Release Lease (error)', 'Fail Loudly')]
    for n in w['nodes']:
        n.pop('onError', None)
    for v in w['connections'].values():
        v['main'] = [g for g in (v.get('main') or []) if g and not any(c['node'] == 'Release Lease (error)' for c in g)]
    w['connections'].pop('Release Lease (error)', None)

FLOWS = ['mv-stage0-sweep-population.json', 'mv-stage1-population.json', 'mv-stage2-score-chunk.json',
         'mv-stage3-deliver.json', 'mv-stage4-verify.json', 'ccprice-stage3.json',
         'wfpop-sweep-population.json', 'wfp-sweep-payments.json', 'wfs-sweep-statuses.json',
         'wfc-deliver.json']

missing = [f for f in FLOWS if not os.path.exists(path(f))]
if missing:
    print('SKIPPED - no exports on disk for: ' + ', '.join(missing))
    print('Take fresh exports first; see exports/README.md. Not pretending to have run.')
    sys.exit(0)

for f in FLOWS:
    baseline(f)

# §1 - the pacing that was DECLARED in a sticky note and not implemented, on both flows that had it
mut('mv0: batchInterval removed from Fetch Population Page', 'mv-stage0-sweep-population.json',
    lambda w: node(w, 'Fetch Population Page')['parameters']['options']['batching']['batch'].pop('batchInterval'))
mut('mv4: batchInterval removed from Read WhatsApp Log', 'mv-stage4-verify.json',
    lambda w: node(w, 'Read WhatsApp Log')['parameters']['options']['batching']['batch'].pop('batchInterval'))
mut('mv2: pacing loosened back to 15 concurrent', 'mv-stage2-score-chunk.json',
    lambda w: node(w, 'Read Payment Ledger')['parameters']['options']['batching']['batch'].__setitem__('batchSize', 15))

# §5 - each breaker exemption, in the node it has to live in
mut('mv0: no-breaker-because stripped from Project Group', 'mv-stage0-sweep-population.json',
    lambda w: node(w, 'Project Group')['parameters'].__setitem__('jsCode', '// projects the group\n'))
mut('mv1: no-breaker-because stripped from Check Access And Plan Cohorts', 'mv-stage1-population.json',
    lambda w: node(w, 'Check Access And Plan Cohorts')['parameters'].__setitem__('jsCode', 'throw new Error("x");\n'))
mut('mv2: no-breaker-because stripped from Score Contract Month', 'mv-stage2-score-chunk.json',
    lambda w: node(w, 'Score Contract Month')['parameters'].pop('notes'))
mut('mv4: breaker and declaration stripped from Assemble Evidence', 'mv-stage4-verify.json',
    lambda w: node(w, 'Assemble Evidence')['parameters'].__setitem__('jsCode', '// assembles evidence\n'))
mut('wfpop: no-breaker-because stripped from Project Population Rows', 'wfpop-sweep-population.json',
    lambda w: node(w, 'Project Population Rows')['parameters'].__setitem__('jsCode', '// projects rows\n'))
mut('wfs: no-breaker-because stripped from Project Status Rows', 'wfs-sweep-statuses.json',
    lambda w: node(w, 'Project Status Rows')['parameters'].__setitem__('jsCode', '// projects rows\n'))
mut('wfp: no-breaker-because stripped from Project CC Payments', 'wfp-sweep-payments.json',
    lambda w: node(w, 'Project CC Payments')['parameters'].__setitem__('jsCode', '// projects payments\n'))

# §4 - the error rail, both halves: does it exist, and does it re-throw
mut('mv1: error rail removed entirely', 'mv-stage1-population.json', kill_rail)
mut('mv4: error rail removed entirely', 'mv-stage4-verify.json', kill_rail)
mut('ccprice3: error rail removed entirely', 'ccprice-stage3.json', kill_rail)
mut('wfc: error rail removed entirely', 'wfc-deliver.json', kill_rail)
mut('mv1: Fail Loudly stops throwing', 'mv-stage1-population.json',
    lambda w: node(w, 'Fail Loudly')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))
mut('mv4: Fail Loudly stops throwing', 'mv-stage4-verify.json',
    lambda w: node(w, 'Fail Loudly')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))
mut('ccprice3: Fail Loudly stops throwing', 'ccprice-stage3.json',
    lambda w: node(w, 'Fail Loudly')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))

# §3 - the gate the fixture found, on the entry point nobody had costed
def kill_gate(w):
    w['nodes'] = [n for n in w['nodes'] if n.get('name') != 'ERP Budget Gate']
    w['connections']['Read Findings'] = {'main': [[{'node': 'Read WhatsApp Log'}],
                                                  [{'node': 'Release Lease (error)'}]]}
    w['connections'].pop('ERP Budget Gate', None)
mut('mv4: budget gate removed', 'mv-stage4-verify.json', kill_gate)
mut('mv1: budget gate marker removed', 'mv-stage1-population.json',
    lambda w: node(w, 'ERP Budget Gate')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))
mut('mv2: budget-gate-in-caller stripped from Fan Out Contracts', 'mv-stage2-score-chunk.json',
    lambda w: node(w, 'Fan Out Contracts')['parameters'].__setitem__('jsCode', 'return $input.all();\n'))

bad = 0
for label, ok in RESULTS:
    print(('ok   ' if ok else 'MISS ') + label)
    if not ok:
        bad += 1
print()
print('%d/%d' % (len(RESULTS) - bad, len(RESULTS)) +
      (' - a mutant SURVIVED, so the property it broke is not actually checked' if bad else ' passed'))
sys.exit(1 if bad else 0)
