#!/usr/bin/env python3
"""
erp_compliance.py - audit an audit flow against the WHOLE ERP load policy, not just its pacing.

  python3 tools/erp_compliance.py <workflow.json> [more.json ...]
  python3 tools/erp_compliance.py --all [dir]      # every *.json in dir (default: exports/)

Exports come from the n8n MCP (`get_workflow_details`); either the raw workflow object or the
{"workflow": {...}} wrapper is accepted.

WHY THIS EXISTS SEPARATELY FROM erp_load_check.py. That tool checks the NUMBERS on a node -
concurrency, interval, timeout. This one checks that the flow has the right SHAPE: the four
layers of ERP-LOAD-POLICY.md §7, each of which sees exactly one thing and is blind to the
others. Pacing knows the rate and nothing about the count. The gate knows the count and nothing
about whether the calls succeed. The breaker knows how ERP is answering and nothing about who
else is calling it. The lease knows who else is calling and nothing about any of the rest. A
flow can pass every number in erp_load_check.py and still take ERP down, because a second audit
started ten minutes later.

It is BOTH the pre-publish gate and the retrofit tool. Point it at an existing flow and it names
what is missing and where it belongs.

WHAT IT CANNOT SEE, said plainly so a green run is not read as more than it is:
  - whether the gate's declared ERP_CALLS_PER_ENTITY is the TRUE cost. That is a human reading
    the phase. A gate with a wrong constant passes here and under-projects at runtime.
  - whether the lease is acquired before the FIRST ERP call rather than merely present. Node
    ORDER under executionOrder v1 is decided by canvas position, and this tool reads presence,
    not geometry. Use tools/verify_order.py for that question.
  - what ERP actually tolerates. Every threshold here is a policy, not a measurement.
"""
import json, os, re, sys, subprocess, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import erp_load_check as pacing

LEASE_WORKFLOW_ID = '9gVijqvtLVEhQZXz'          # ERP-LOAD-POLICY.md §4
GATE_MARKER       = 'ERP PRE-FLIGHT BUDGET GATE'  # §3
BREAKER_BEGIN     = '// ===================== ERP CIRCUIT BREAKER'
BREAKER_END       = '// =================== END ERP CIRCUIT BREAKER'

# A flow may declare, IN A NODE, that a layer legitimately lives elsewhere. The escape hatch is
# deliberately visible: it is a line of text in the flow itself, so the next reader sees the
# claim next to the code, and this tool prints it as an accepted exemption rather than staying
# silent. A blind spot nobody can see is how the Cases sheet pointed at the wrong workbook
# through eleven green suites.
EXEMPT = {
  'gate':    'ERP-COMPLIANCE: budget-gate-in-caller',
  'lease':   'ERP-COMPLIANCE: lease-held-by-caller',
  'breaker': 'ERP-COMPLIANCE: no-breaker-because',
  'release': 'ERP-COMPLIANCE: lease-released-downstream',
}

def canonical_breaker_core():
    """The generated block's core, so a deployed copy can be compared rather than eyeballed."""
    out = subprocess.run([sys.executable, os.path.join(HERE, 'build_breaker_embed.py'),
                          '--call-site', 'plan'], capture_output=True, text=True, check=True).stdout
    start = out.index('const ERP_BREAKER_DEFAULTS')
    end = out.index('// --- call site')
    return out[start:end].strip()

def norm(s):
    """Normalise away the differences that are NOT drift, so the ones that are stand out.

    Whitespace, because a re-indent is not a change of behaviour.

    And node references: the block is generated with --source-node, so the guard reads
    $('Read Chunk') in one flow and $('Explode Contracts') in another. Comparing those
    literally reported DRIFT on every correctly parameterised copy - a checker that cries wolf
    on its own supported options, which is precisely the failure erp_load_check.py's own
    comments warn about: after a few false alarms nobody reads the output, and then it is worse
    than having no checker at all. Found by deploying a byte-perfect copy and being told it had
    drifted.
    """
    s = re.sub(r"\$\('[^']*'\)", "$(NODE)", s)
    return re.sub(r'\s+', ' ', s).strip()

def load(path):
    d = json.load(open(path, encoding='utf-8'))
    return d.get('workflow', d)

def code_of(n):
    return str((n.get('parameters') or {}).get('jsCode') or '')

def all_text(n):
    return json.dumps(n.get('parameters') or {}) + ' ' + str(n.get('notes') or '')

def has_exempt(w, kind):
    tag = EXEMPT[kind]
    for n in w.get('nodes') or []:
        blob = code_of(n) + ' ' + all_text(n)
        if tag in blob:
            i = blob.index(tag)
            return blob[i:i + 160].split('\\n')[0].strip()
    return None

def downstream(w, name):
    conns = (w.get('connections') or {}).get(name) or {}
    out = []
    for group in conns.get('main') or []:
        for c in group or []:
            out.append(c.get('node'))
    return out

# Nodes that shuffle items without reading them. A batch of ERP responses routinely passes
# through one of these before anything projects it.
PASSTHROUGH = ('n8n-nodes-base.merge', 'n8n-nodes-base.if', 'n8n-nodes-base.filter',
               'n8n-nodes-base.set', 'n8n-nodes-base.noOp', 'n8n-nodes-base.switch',
               'n8n-nodes-base.splitOut', 'n8n-nodes-base.limit', 'n8n-nodes-base.sort')

def first_code_downstream(w, start, limit=8):
    """The Code node(s) that actually read this ERP node's batch.

    NOT simply "the next node". THIS TOOL'S OWN FIRST VERSION took the direct successor and
    therefore reported WF-B as having no projection node to check at all: its two ERP nodes feed
    a Merge, and the Code node that reads the responses sits behind it. A checker with a silent
    blind spot is worse than no checker, because its green is quoted. So the walk passes through
    nodes that shuffle items without reading them, and stops at the first Code node on each path.
    """
    seen, found, frontier = set(), [], list(downstream(w, start))
    while frontier and limit > 0:
        limit -= 1
        nxt = []
        for name in frontier:
            if name in seen:
                continue
            seen.add(name)
            n = node_by_name(w, name)
            if not n:
                continue
            if n.get('type') == 'n8n-nodes-base.code':
                found.append(name)
            elif n.get('type') in PASSTHROUGH:
                nxt.extend(downstream(w, name))
        frontier = nxt
    return found

def node_by_name(w, name):
    for n in w.get('nodes') or []:
        if n.get('name') == name:
            return n
    return None

def audit(w, canon):
    """returns (failures, warnings, notes) - each a list of strings"""
    fails, warns, notes = [], [], []
    nodes = w.get('nodes') or []
    erp_nodes = [n for n in nodes if n.get('type') == 'n8n-nodes-base.httpRequest' and pacing.is_erp(n)]
    per_item = [n for n in erp_nodes if pacing.is_per_item(n) and not n.get('disabled')]
    triggers = [n.get('type') for n in nodes]
    is_subworkflow = 'n8n-nodes-base.executeWorkflowTrigger' in triggers
    is_entry = any(t in triggers for t in ('n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger'))

    # ---- §1/§2: the numbers on each node -------------------------------------------------
    for n in erp_nodes:
        f, wn = pacing.check_node(w, n)
        fails.extend(f); warns.extend(wn)

    # ---- §3: a pre-flight budget gate before the per-entity phase -------------------------
    if per_item:
        if any(GATE_MARKER in code_of(n) for n in nodes):
            notes.append('§3 budget gate present')
        else:
            ex = has_exempt(w, 'gate')
            if ex:
                notes.append('§3 budget gate: exempted in-flow -> ' + ex)
            else:
                fails.append('§3 NO PRE-FLIGHT BUDGET GATE, and this flow has ' + str(len(per_item)) +
                  ' per-item ERP node(s). Pacing bounds requests per SECOND; nothing here bounds how '
                  'MANY. Add the gate to the last Code node before the first per-entity call - copy '
                  'tools/erp_preflight_gate.js - or, if the caller already gates this cohort, say so '
                  'in that node with: ' + EXEMPT['gate'])

    # ---- §5: the breaker in every projection node that reads a batch of responses ---------
    # "Projection node" is computed, not guessed: a Code node directly downstream of an ERP
    # HTTP node is, by construction, the thing that reads that batch.
    for src in erp_nodes:
        if src.get('disabled'):
            continue
        for dname in first_code_downstream(w, src.get('name')):
            d = node_by_name(w, dname)
            body = code_of(d)
            if BREAKER_BEGIN not in body:
                ex = has_exempt(w, 'breaker')
                if ex:
                    notes.append('§5 breaker in "' + dname + '": exempted -> ' + ex)
                else:
                    fails.append('§5 NO CIRCUIT BREAKER in "' + dname + '", which reads the batch from '
                      '"' + src.get('name') + '". That node already sees every response and is the only '
                      'place that can tell ERP has started failing. Generate it: python3 '
                      'tools/build_breaker_embed.py --call-site plan')
                continue
            try:
                seg = body[body.index(BREAKER_BEGIN):body.index(BREAKER_END)]
                core = seg[seg.index('const ERP_BREAKER_DEFAULTS'):seg.index('// --- call site')].strip()
            except ValueError:
                fails.append('§5 breaker in "' + dname + '" is truncated or its markers were edited - '
                  'the block could not be extracted, so it cannot be compared to the canonical one.')
                continue
            if norm(core) != norm(canon):
                fails.append('§5 breaker in "' + dname + '" HAS DRIFTED from tools/erp_breaker.js. This '
                  'is the failure that put batchSize 15 in every node of every flow: a copy nobody could '
                  'tell had changed. Re-generate it rather than editing in place.')
            else:
                notes.append('§5 breaker present and identical to canonical in "' + dname + '"')

    # ---- §4: the lease, on the entry flow --------------------------------------------------
    calls_erp = bool(erp_nodes) or any(
        LEASE_WORKFLOW_ID not in all_text(n) and n.get('type') == 'n8n-nodes-base.executeWorkflow'
        for n in nodes)
    if is_entry and calls_erp:
        lease_nodes = [n for n in nodes if LEASE_WORKFLOW_ID in all_text(n)]
        modes = ' '.join(all_text(n) for n in lease_nodes)
        if not lease_nodes:
            ex = has_exempt(w, 'lease')
            if ex:
                notes.append('§4 lease: exempted -> ' + ex)
            else:
                fails.append('§4 NO ERP LEASE. This flow is an entry point that reaches ERP, so it must '
                  'acquire the lease (' + LEASE_WORKFLOW_ID + ') before its first ERP call and release it '
                  'on BOTH rails. Per-flow pacing bounds ONE audit; two audits running together is how '
                  'ERP was taken down before.')
        else:
            if 'acquire' not in modes:
                fails.append('§4 the lease workflow is called but no call passes mode "acquire".')
            if 'release' not in modes:
                # A FIRE-AND-FORGET CHAIN CANNOT RELEASE WHERE IT ACQUIRED. CC Price launches its
                # next stage without waiting and then ends, so the acquiring flow is gone long
                # before the run is. The lease is held by the RUN - a row keyed on run_id - not by
                # an execution, so the release belongs in the last stage. Reporting that as
                # "never released" would be wrong AND would push someone to add a release that
                # frees the lease while the run is still hammering ERP.
                ex = has_exempt(w, 'release')
                if ex:
                    notes.append('§4 lease released downstream -> ' + ex)
                else:
                    fails.append('§4 the lease is acquired and NEVER RELEASED. The staleness rule will free '
                      'it after 3 hours, which means a 3-hour hole in the queue after every run. If a later '
                      'stage releases it - which is right for a fire-and-forget chain, where the acquiring '
                      'execution ends before the run does - say so here with: ' + EXEMPT['release'])
            if 'acquire' in modes and 'release' in modes:
                notes.append('§4 lease acquired and released')
    elif is_subworkflow and per_item:
        ex = has_exempt(w, 'lease')
        notes.append('§4 lease: sub-workflow, held by the caller' + (' -> ' + ex if ex else
          ' (undeclared - add "' + EXEMPT['lease'] + '" so the claim is visible in the flow)'))
        if not ex:
            warns.append('§4 this sub-workflow relies on its caller holding the lease but does not say '
              'so anywhere. Add the declaration; the next person to call it will not know.')

    return fails, warns, notes

def main(paths):
    canon = canonical_breaker_core()
    bad = 0
    for p in paths:
        w = load(p)
        name = w.get('name') or os.path.basename(p)
        fails, warns, notes = audit(w, canon)
        status = 'FAIL' if fails else ('WARN' if warns else 'PASS')
        print('\n=== ' + status + '  ' + name + '  (' + os.path.basename(p) + ') ===')
        for n in notes: print('  ok   ' + n)
        for wn in warns: print('  warn ' + wn)
        for f in fails: print('  FAIL ' + f)
        if fails: bad += 1
    print('\n' + ('%d of %d flow(s) fail ERP-LOAD-POLICY.md' % (bad, len(paths)) if bad
                  else 'all %d flow(s) comply with ERP-LOAD-POLICY.md' % len(paths)))
    return 1 if bad else 0

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    if args[0] == '--all':
        d = args[1] if len(args) > 1 else os.path.join(os.path.dirname(HERE), 'exports')
        args = sorted(glob.glob(os.path.join(d, '*.json')))
        if not args:
            print('no workflow exports in ' + d + ' - export them with the n8n MCP first '
                  '(get_workflow_details), one JSON per flow.'); sys.exit(2)
    sys.exit(main(args))
