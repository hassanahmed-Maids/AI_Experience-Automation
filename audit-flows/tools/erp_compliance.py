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

def _excerpt(blob, tag):
    """The declaration itself, one line of it, for printing back at the reader."""
    i = blob.index(tag)
    line = blob[i:i + 160]
    # Split on BOTH a real newline and an escaped one: the tag turns up in raw jsCode (real
    # newlines) and in the JSON dump of parameters (escaped), and handling only the escaped
    # form made multi-line declarations bleed into the next comment line when printed.
    for sep in ('\n', '\\n'):
        line = line.split(sep)[0]
    return line.strip()

def has_exempt_node(n, kind):
    """Is the declaration in THIS node?

    §5's exemption has to be node-scoped and the others do not, which is not a stylistic
    preference. "This flow's budget gate lives in its caller" is a claim about the flow, so
    anywhere in the flow is the right place to say it. "This node needs no breaker" is a claim
    about ONE node, and while it was looked up flow-wide a single declaration silenced the
    requirement for every projection node in the flow - so removing a real breaker somewhere
    else would have kept reporting green. That is the shape of blind spot this tool exists to
    remove, and it was sitting inside the tool.
    """
    tag = EXEMPT[kind]
    blob = code_of(n) + ' ' + all_text(n)
    return _excerpt(blob, tag) if tag in blob else None

def has_exempt(w, kind):
    """Is the declaration anywhere in the flow? For claims that are ABOUT the whole flow."""
    for n in w.get('nodes') or []:
        found = has_exempt_node(n, kind)
        if found:
            return found
    return None

def downstream(w, name, only_index=None):
    """Every node this one feeds. only_index=0 restricts it to the SUCCESS output.

    Output 0 is the success path; any higher index is an error output. Which one you want depends
    on the question: §4 walks the error outputs BECAUSE it is looking for the rail, and §5 must
    not, because a breaker judges a BATCH of responses and an error output carries one failure.
    """
    conns = (w.get('connections') or {}).get(name) or {}
    out = []
    for i, group in enumerate(conns.get('main') or []):
        if only_index is not None and i != only_index:
            continue
        for c in group or []:
            out.append(c.get('node'))
    return out

def upstream(w, name):
    """Every node that feeds this one, on any output. Used to see what precedes a rail node."""
    out = []
    for src, spec in (w.get('connections') or {}).items():
        for group in spec.get('main') or []:
            for c in group or []:
                if c.get('node') == name:
                    out.append(src)
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
    seen, found, frontier = set(), [], list(downstream(w, start, only_index=0))
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
                nxt.extend(downstream(w, name, only_index=0))
        frontier = nxt
    return found

# Nodes whose ONLY main output is the success path, so an added error output is index 1.
# Deliberately a list of what this tool can reason about rather than a guess at the rest: an IF
# has true/false before its error output and a Switch has N of them, so "the last output is the
# error one" is wrong for exactly the nodes where being wrong is silent.
SINGLE_OUTPUT = ('n8n-nodes-base.httpRequest', 'n8n-nodes-base.code', 'n8n-nodes-base.set',
                 'n8n-nodes-base.executeWorkflow', 'n8n-nodes-base.dataTable',
                 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.noOp', 'n8n-nodes-base.wait',
                 'n8n-nodes-base.respondToWebhook')

def lease_mode(n):
    """acquire / release / None, read from the CALL, not from the node's prose.

    This was a substring scan over the whole node - parameters and notes together - and it was
    wrong in the way that matters: WF-A's acquire carries a note explaining WHY it does not
    release ("lease-released-downstream - WF-C releases it... Releasing here would free it while
    WF-B is still reading"), so the word "release" appears, and the success-path check counted
    the ACQUIRE as the release. A checker that can be satisfied by a comment saying the exact
    opposite of the truth is worse than no checker.

    The mode is a parameter of the Execute Sub-workflow call, so read it there and NOWHERE else.
    There is deliberately no text fallback: guessing the mode from surrounding text is the bug,
    and a narrower guess is still a guess. A call whose mode is not statically one of the two
    words returns None and is REPORTED as unreadable, because "this tool cannot tell what this
    call does" is a useful thing to say and "it is probably a release" is not.
    """
    p = n.get('parameters') or {}
    val = ((p.get('workflowInputs') or {}).get('value') or {})
    m = str(val.get('mode') or '').strip().lower()
    return m if m in ('acquire', 'release') else None

def error_reachable(w):
    """Every node reachable from an ERROR path, and the nodes this tool could not reason about.

    An error rail in n8n is one of two things: a node set to `continueErrorOutput`, whose extra
    main output carries the failure, or an Error Trigger node. Both are walked forward through
    ALL outputs, because once you are on the error rail everything after it is too.

    The index matters and getting it wrong would be silent. For a node with one normal output the
    error output is index 1. For an IF (true/false) it is 2 and for a Switch it depends on how
    many branches were configured - so those are NOT guessed at. They are returned separately and
    reported, because a checker that quietly mis-reads a branch is worse than one that says it
    cannot read it.
    """
    origins, unreadable = [], []
    for n in w.get('nodes') or []:
        name = n.get('name')
        if n.get('type') == 'n8n-nodes-base.errorTrigger':
            origins.append((name, 0))
        elif n.get('onError') == 'continueErrorOutput':
            if n.get('type') in SINGLE_OUTPUT:
                origins.append((name, 1))
            else:
                unreadable.append(name)

    seen, frontier = set(), []
    for name, idx in origins:
        groups = ((w.get('connections') or {}).get(name) or {}).get('main') or []
        if len(groups) > idx:
            frontier.extend(c.get('node') for c in (groups[idx] or []))
    while frontier:
        nxt = []
        for name in frontier:
            if not name or name in seen:
                continue
            seen.add(name)
            nxt.extend(downstream(w, name))
        frontier = nxt
    return seen, unreadable

def rail_rethrows(w, reachable):
    """Does the error rail end in a failure, or does it quietly finish?

    This is not a nicety. n8n marks an execution SUCCESS if it runs off the end of an error
    output, so a rail that releases the lease and stops turns a failed audit into one the run log
    reports as fine - the single worst outcome available here, because it is the one nobody looks
    at again.
    """
    for name in reachable:
        n = node_by_name(w, name)
        if not n:
            continue
        if n.get('type') == 'n8n-nodes-base.stopAndError':
            return True
        if n.get('type') == 'n8n-nodes-base.code' and 'throw ' in code_of(n):
            return True
    return False

def code_without_comments(body):
    """The code, minus // line comments and /* */ blocks.

    Needed because the rules below look for what a node DOES, and in this project the nodes carry
    long comments about what they used to do. rail_reads_the_failure fired on all three flows it
    had just been used to FIX, because each one now carries the sentence "READ THE FAILURE FROM
    Capture Failure, NOT FROM $input" - a rule that reads prose cannot tell an explanation from an
    instruction. String literals are left alone: they are not comments, and a $input inside one is
    not something this file needs to reason about.
    """
    out, i, n = [], 0, len(body)
    while i < n:
        c = body[i]
        if c == '/' and i + 1 < n and body[i + 1] == '/':
            j = body.find('\n', i)
            i = n if j < 0 else j
        elif c == '/' and i + 1 < n and body[i + 1] == '*':
            j = body.find('*/', i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)

def rail_reads_the_failure(w, reachable):
    """Can the rail's re-throwing node still SAY what went wrong?

    A rail that releases the lease and re-throws is safe and can still be useless. On 2026-08-23
    every rail in this project but one ran `failing node -> Release Lease (error) -> Fail Loudly`,
    and Release Lease (error) is an Execute Sub-workflow node with waitForSubWorkflow: true - which
    does not pass its input through, it REPLACES the item with whatever the sub-workflow returned.
    So Fail Loudly's `$input` held the lease's answer, not the error, and every message those rails
    could ever produce was 'FAILED at "unknown node": unknown error'.

    Twelve of thirteen flows had it. Nothing caught it, because every §4 check asked whether the
    rail RELEASES and RE-THROWS - both of which it did. Nobody had seen the output because no rail
    in this project has yet fired.

    The fix is a Capture Failure node placed FIRST on the rail, before the lease call, with the
    terminal node reading it by name. So the rule is: a re-throwing rail node fed through an
    Execute Sub-workflow node must not read $input, because at that point $input is not the error.
    """
    bad = []
    for name in reachable:
        n = node_by_name(w, name)
        if not n or n.get('type') != 'n8n-nodes-base.code':
            continue
        body = code_without_comments(code_of(n))
        if 'throw ' not in body or '$input' not in body:
            continue
        eaten = [p for p in upstream(w, name)
                 if p in reachable
                 and (node_by_name(w, p) or {}).get('type') == 'n8n-nodes-base.executeWorkflow']
        if eaten:
            bad.append((name, eaten))
    return bad

def rail_blind_spots(w):
    """Nodes that can kill the run but whose failure cannot be routed to the error rail.

    A flow can have a correct, re-throwing error rail and still lose the lease, because the rail
    can only be hung off nodes whose error output is at a known index. Everything else - a Merge,
    an IF, a Switch, an LLM Agent - is left unwired ON PURPOSE, since guessing the index is silent
    when wrong. That is the right call and it leaves a real hole, and until now nothing named the
    hole: erp_compliance.py printed "error rail releases the lease and re-throws" and stopped.

    WF-B is the case in point. Its rail is complete across every Code and Execute-Workflow node,
    and `Verify Candidates` - the LLM agent, the node in that flow MOST likely to fail on any given
    run - is not on it. The flow passed, the note explaining why lived only in an n8n version
    description, and reading the checker's output was enough to believe the lease was covered.

    Only reported for flows that HAVE a rail: a flow with no rail already fails, and adding a
    second message about its blind spots would bury the one that matters.
    """
    conns = w.get('connections') or {}
    # MAIN-PATH ONLY. An Agent's model and output-parser hang off it by ai_languageModel /
    # ai_outputParser connections, never `main`; listing them alongside the Agent triples the
    # warning and says nothing extra, because their failure surfaces THROUGH the Agent. The first
    # version of this check did list them, which is the crying-wolf failure this file has been
    # bitten by four times - so the filter is here rather than in the reader's head.
    on_main = set()
    for src, spec in conns.items():
        groups = spec.get('main') or []
        if groups:
            on_main.add(src)
        for g in groups:
            for c in (g or []):
                on_main.add(c.get('node'))

    skip = ('n8n-nodes-base.stickyNote', 'n8n-nodes-base.errorTrigger')
    triggerish = ('Trigger', 'trigger', 'webhook')
    out = []
    for n in w.get('nodes') or []:
        t = n.get('type') or ''
        if t in skip or t in SINGLE_OUTPUT or n.get('disabled'):
            continue
        if any(k in t for k in triggerish):
            continue
        if n.get('onError') or n.get('name') not in on_main:
            continue
        out.append(n.get('name'))
    return out

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
    # A MANUAL-ONLY FLOW IS AN ENTRY POINT TOO, and leaving it out was a hole big enough to drive
    # a whole check through: §4 is guarded by `if is_entry ... elif is_subworkflow`, so a flow
    # whose only trigger is Run Manually matched NEITHER and its entire lease block was skipped
    # in silence. CC Non Received's parent - which acquires the lease, reaches ERP through 14
    # nodes and hands off fire-and-forget - was audited today and the tool never looked at its
    # §4 at all. A human happened to check it by hand; nothing made that happen.
    #
    # Manual counts only when there is no executeWorkflowTrigger, because most sub-workflows keep
    # a Run Manually beside their real trigger for testing, and those are sub-workflows.
    is_entry = (any(t in triggers for t in ('n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger'))
                or ('n8n-nodes-base.manualTrigger' in triggers and not is_subworkflow))

    # ---- §1/§2: the numbers on each node -------------------------------------------------
    # A DISABLED NODE MAKES NO REQUESTS, so its pacing cannot fail: reporting it as a FAIL is the
    # crying-wolf failure this tool has already been bitten by twice. WF-A carries the entire
    # pre-split verification chain disabled in place - two ERP nodes still at batchSize 15 /
    # 500ms = 30 req/s, left behind when the work moved to WF-B - and failing on them would make
    # a compliant flow permanently red.
    #
    # But silence is wrong too. Those nodes are one click from live at three times the documented
    # ceiling, and "nobody chose 15" is exactly how it spread in the first place. So: warn, name
    # them as disabled, and say what re-enabling one would cost.
    for n in erp_nodes:
        f, wn = pacing.check_node(w, n)
        if n.get('disabled'):
            for m in f + wn:
                warns.append('§1/§2 DISABLED node "' + n.get('name') + '": ' + m +
                  '. It cannot reach ERP while disabled, so this is not a failure - but it is one '
                  'click from live at that rate. Fix the numbers or delete the node.')
        else:
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
                # NODE-scoped, not flow-scoped. See has_exempt_node.
                ex = has_exempt_node(d, 'breaker')
                if ex:
                    notes.append('§5 breaker in "' + dname + '": exempted -> ' + ex)
                else:
                    fails.append('§5 NO CIRCUIT BREAKER in "' + dname + '", which reads the batch from '
                      '"' + src.get('name') + '". That node already sees every response and is the only '
                      'place that can tell ERP has started failing. Generate it: python3 '
                      'tools/build_breaker_embed.py --call-site plan --source-node "<the node that '
                      'stamps run_id and erp_t0>". If this node genuinely cannot be judged - a batch '
                      'of ONE response reaches none of the three thresholds - put ' + EXEMPT['breaker'] +
                      ' IN THIS NODE saying which threshold cannot fire and what stops the run instead.')
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

    # ---- §4: the lease -----------------------------------------------------------------
    # NOT "on the entry flow" any more, which is how this section used to be titled and was the
    # reason it missed two of the three CC Price stages. The entry flow ACQUIRES, but the lease
    # is held by the RUN across a whole fire-and-forget chain, so a middle stage dying strands it
    # just as thoroughly - and Stage 3, which owns the release and performs it in its LAST node,
    # stranded the lease on every one of its own designed refusals. Both reported PASS.
    def is_lease_call(n):
        """A lease call is an Execute Sub-workflow node POINTING AT the lease workflow.

        It used to be "any node whose text contains the lease id", and that is the same mistake
        lease_mode() documents one level up: identifying a call by prose rather than by being a
        call. It bit on 2026-08-23, when a sub-workflow's `ERP-COMPLIANCE: lease-held-by-caller`
        declaration - which has to name the lease id to be worth reading - made a Code node and a
        sticky note get reported as lease calls with an unreadable mode. Writing down which lease
        you depend on should never make you look like you are taking it.
        """
        if n.get('type') != 'n8n-nodes-base.executeWorkflow':
            return False
        wid = ((n.get('parameters') or {}).get('workflowId') or {})
        if isinstance(wid, dict):
            return str(wid.get('value') or '') == LEASE_WORKFLOW_ID
        return str(wid) == LEASE_WORKFLOW_ID

    calls_erp = bool(erp_nodes) or any(
        not is_lease_call(n) and n.get('type') == 'n8n-nodes-base.executeWorkflow'
        for n in nodes)
    lease_nodes = [n for n in nodes if is_lease_call(n)]
    acquires = [n for n in lease_nodes if lease_mode(n) == 'acquire']

    reachable, unreadable = error_reachable(w)
    releases = [n for n in lease_nodes if lease_mode(n) == 'release']
    unreadable_mode = [n.get('name') for n in lease_nodes if lease_mode(n) is None]
    if unreadable_mode:
        warns.append('§4 these lease calls do not pass a literal "acquire" or "release" mode, so '
          'this tool cannot tell what they do: ' + ', '.join(unreadable_mode) + '. It will not '
          'guess - reading the mode out of the surrounding text is exactly how an ACQUIRE whose '
          'note explained why it does not release got counted as the release. Set mode to a '
          'literal in the call, or check this flow by hand.')
    ok_release = [n.get('name') for n in releases if n.get('name') not in reachable]
    err_release = [n.get('name') for n in releases if n.get('name') in reachable]

    def check_error_rail(why):
        """The error-path release, for any flow that can strand the lease. `why` says which."""
        if unreadable:
            warns.append('§4 these nodes carry an error output this tool will not read: ' +
              ', '.join(unreadable) + '. An IF has true/false before its error output and a '
              'Switch has as many as it has branches, so "the last one is the error output" '
              'is wrong for exactly the nodes where being wrong is invisible. Route the error '
              'rail off a single-output node instead, or check this one by hand.')
        if not err_release:
            fails.append('§4 NO ERROR-PATH LEASE RELEASE. ' + why + ' - so every way this flow can FAIL '
              'leaves the lease held by a run that no longer exists: a 3-hour hole in the queue, cleared '
              'only by the staleness backstop. Measured 2026-08-20: run selfreq-test-2 died at Get '
              'Population and stranded it exactly this way. Set onError continueErrorOutput on the '
              'single-output nodes, route them to a release, and re-throw. ' +
              ('NOTE: ' + EXEMPT['release'] + ' excuses the SUCCESS-path release only - the stage that '
               'releases downstream never runs when this one fails.' if has_exempt(w, 'release') else ''))
        elif not rail_rethrows(w, reachable):
            fails.append('§4 the error rail releases the lease (' + ', '.join(err_release) + ') but '
              'NEVER RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error '
              'output, so this turns a failed audit into one the run log reports as fine - which is '
              'worse than the stranded lease it was added to fix, because nobody looks at it again. '
              'End the rail in a Stop and Error, or a Code node that throws.')
        else:
            notes.append('§4 error rail releases the lease and re-throws (' + ', '.join(err_release) + ')')
            for name, eaten in rail_reads_the_failure(w, reachable):
                fails.append('§4 the rail re-throws from "' + name + '", but that node reads $input '
                  'and is fed by ' + ', '.join('"' + e + '"' for e in eaten) + ' - an Execute '
                  'Sub-workflow node, which does NOT pass its input through. It REPLACES the item '
                  'with whatever the sub-workflow returned, so $input here holds the lease\'s answer '
                  'and not the error. This rail is safe and mute: it releases and re-throws, and the '
                  'only message it can ever produce is "unknown node / unknown error". Twelve of '
                  'thirteen flows had exactly this on 2026-08-23 and every check passed, because '
                  'releasing and re-throwing was all anyone asked about. Put a Code node FIRST on '
                  'the rail - before the lease call - that reads the error off $input and returns '
                  'it, and read it here by name: $(\'Capture Failure\').first().json._failure.')
            blind = rail_blind_spots(w)
            if blind:
                warns.append('§4 the error rail exists, but these node(s) can kill the run and their '
                  'failure CANNOT reach it: ' + ', '.join(blind) + '. They are not single-output '
                  'types, so the rail cannot be hung off them without guessing which output index '
                  'carries the error - and guessing wrong is silent, which is why they were left '
                  'unwired rather than wired on a hunch. This is a WARNING and not a failure: the '
                  'unwired node is the lesser evil. But a rail with a named blind spot is worth more '
                  'than one that reads as complete, which is exactly how WF-B was misread on '
                  '2026-08-23 - the flow passed, the gap was real, and nothing said so. Close it by '
                  'setting continueRegularOutput so the failure flows on as an item to a node that '
                  'fails closed, or by verifying the error-output index for that node type.')

    if is_entry and calls_erp:
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
            if not acquires:
                fails.append('§4 the lease workflow is called but no call passes mode "acquire".')

            # THE TWO PATHS ARE CHECKED SEPARATELY, and conflating them is how this tool was
            # green on a flow that stranded the lease on every failure. "A release node exists
            # somewhere in the flow" answers neither question: a success release says nothing
            # about what happens when the run dies, and - as this file's own first version of
            # the error rule proved - an ERROR release will happily satisfy a naive success
            # check, hiding a missing hand-off declaration behind the fix for a different bug.
            #
            # A FIRE-AND-FORGET CHAIN CANNOT RELEASE WHERE IT ACQUIRED. CC Price launches its
            # next stage without waiting and then ends, so the acquiring flow is gone long
            # before the run is. The lease is held by the RUN - a row keyed on run_id - not by
            # an execution, so the release belongs in the last stage. Reporting that as
            # "never released" would be wrong AND would push someone to add a release that
            # frees the lease while the run is still hammering ERP.
            if not ok_release:
                ex = has_exempt(w, 'release')
                if ex:
                    notes.append('§4 lease released downstream on success -> ' + ex)
                else:
                    fails.append('§4 the lease is acquired and NEVER RELEASED ON SUCCESS. The staleness '
                      'rule will free it after 3 hours, which means a 3-hour hole in the queue after every '
                      'run. If a later stage releases it - which is right for a fire-and-forget chain, '
                      'where the acquiring execution ends before the run does - say so here with: ' +
                      EXEMPT['release'] +
                      ((' | This flow releases at "' + ', '.join(err_release) + '", but that is on the '
                        'ERROR rail and never runs when the flow succeeds.') if err_release else ''))
            else:
                notes.append('§4 lease released on success (' + ', '.join(ok_release) + ')')

            check_error_rail('This flow ACQUIRES the ERP lease')

    elif is_subworkflow:
        # A STAGE THAT RELEASES IS UNAMBIGUOUSLY RESPONSIBLE FOR THE LEASE, whoever called it and
        # whether or not they waited: if it dies before its release runs, there is by definition
        # no later stage to do it. Stage 3 is the case in point - it releases in its LAST node,
        # so its own designed refusal (DELIVERY REFUSED on a short case set) blocked the queue
        # every single time, and this tool called it a PASS.
        if ok_release:
            notes.append('§4 this stage releases the lease on success (' + ', '.join(ok_release) + ')')
            check_error_rail('This stage OWNS the lease release')
        else:
            ex = has_exempt(w, 'lease')
            if per_item:
                notes.append('§4 lease: sub-workflow, held by the caller' + (' -> ' + ex if ex else
                  ' (undeclared - add "' + EXEMPT['lease'] + '" so the claim is visible in the flow)'))
                if not ex:
                    warns.append('§4 this sub-workflow relies on its caller holding the lease but does not say '
                      'so anywhere. Add the declaration; the next person to call it will not know.')

            # A MIDDLE STAGE OF A FIRE-AND-FORGET CHAIN. It launches the next link and ends, so
            # if it dies the chain dies with it and whatever stage was going to release never
            # runs. This is a WARNING and not a failure on purpose: whether the lease is actually
            # stranded depends on how THIS flow's caller invoked it, and that is not visible in
            # this flow's export. Guessing either way would be a checker nobody can trust - the
            # crying-wolf failure that made the byte-compare drift check useless.
            fire_and_forget = [n.get('name') for n in nodes
                               if n.get('type') == 'n8n-nodes-base.executeWorkflow'
                               and LEASE_WORKFLOW_ID not in all_text(n)
                               and '"waitForSubWorkflow": false' in json.dumps(n.get('parameters') or {})]
            if err_release:
                # It built a rail without being asked to. Check it properly - a rail that
                # releases and does not re-throw is worse than none - and report it, so the
                # reader can see the stage is covered rather than inferring it from silence.
                check_error_rail('This stage holds a lease it does not release on success')
            elif (ex or per_item) and fire_and_forget:
                warns.append('§4 this stage is a middle link in a fire-and-forget chain (' +
                  ', '.join(fire_and_forget) + ' launches the next stage without waiting) and it holds a '
                  'lease it does not release. If it dies, the chain stops and the stage that WOULD have '
                  'released never runs. This tool cannot see whether your caller waits for you - if it '
                  'does, its own error rail covers you and this is noise; if it does not, add an '
                  'error-path release here. CC Price Stage 2 was the second case.')

    return fails, warns, notes

def check_manifest(d, paths):
    """Name the flows --all is NOT looking at.

    THE FAILURE THIS EXISTS FOR. --all globs a directory, so it audits whatever happens to be in
    it and then prints "all N flows comply". WF-E and WF-B were never exported, so for four days
    --all reported green while neither flow had a circuit breaker deployed at all. A green that
    covers an unknown subset is worse than a red, because it gets quoted.

    So the set of flows that MUST be audited is declared, and a missing export is a FAILURE that
    names the flow rather than silence that flatters the result.
    """
    mpath = os.path.join(d, 'MANIFEST.json')
    if not os.path.exists(mpath):
        print('\nNO MANIFEST at ' + mpath + ' - so this run audited whatever happened to be in '
              'the directory and cannot tell you what it missed. Add one.')
        return True
    manifest = json.load(open(mpath, encoding='utf-8'))['flows']
    seen = set()
    for p in paths:
        try:
            seen.add(str(load(p).get('id') or ''))
        except Exception:
            pass
    missing = [f for f in manifest if f['id'] not in seen]
    extra = seen - {f['id'] for f in manifest} - {''}
    print('\n--- manifest coverage: %d of %d flows audited ---' % (len(manifest) - len(missing), len(manifest)))
    for f in missing:
        tag = 'NOT AUDITED' if not f.get('audited_by_hand') else 'no export '
        print('  %s  %-52s %s%s' % (tag, f['name'], f['id'],
              '' if f.get('live') else '   (draft, not published)'))
        if f.get('audited_by_hand'):
            # A hand audit is a real result and saying "NOT AUDITED" would understate it - but it
            # is a snapshot, not a check that can be re-run, so it never counts as coverage.
            print('               hand-audited: ' + f['audited_by_hand'])
    for e in sorted(extra):
        print('  not in the manifest: ' + e + ' - add it, or the next person will not know '
              'whether it was meant to be covered')
    if missing:
        never = [f for f in missing if not f.get('audited_by_hand')]
        print('\n%d flow(s) in the manifest have no export here, so --all cannot re-check them '
              'when a rule or the canonical breaker changes. %d of those have never been audited '
              'at all.' % (len(missing), len(never)))
    return bool(missing)

def main(paths):
    canon = canonical_breaker_core()
    bad = 0
    skipped = []
    for p in paths:
        w = load(p)
        # NOT EVERY .json IN exports/ IS A WORKFLOW. The coverage contracts live there too -
        # MANIFEST.json, instance-listing.json, instance-register.json, provenance-sweep.json -
        # and auditing one produced a cheerful "=== PASS instance-register.json", a green verdict
        # on a file with no nodes to be compliant about. A checker that reports PASS on something
        # it did not check is the exact currency this project has spent all day devaluing.
        if not isinstance(w, dict) or 'nodes' not in w:
            print('\n--- skipped ' + os.path.basename(p) + ': not a workflow export (no "nodes")')
            skipped.append(p)
            continue
        name = w.get('name') or os.path.basename(p)
        fails, warns, notes = audit(w, canon)
        status = 'FAIL' if fails else ('WARN' if warns else 'PASS')
        print('\n=== ' + status + '  ' + name + '  (' + os.path.basename(p) + ') ===')
        for n in notes: print('  ok   ' + n)
        for wn in warns: print('  warn ' + wn)
        for f in fails: print('  FAIL ' + f)
        if fails: bad += 1
    audited = len(paths) - len(skipped)
    print('\n' + ('%d of %d flow(s) fail ERP-LOAD-POLICY.md' % (bad, audited) if bad
                  else 'all %d flow(s) comply with ERP-LOAD-POLICY.md' % audited))
    return 1 if bad else 0

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    if args[0] == '--all':
        d = args[1] if len(args) > 1 else os.path.join(os.path.dirname(HERE), 'exports')
        args = sorted(f for f in glob.glob(os.path.join(d, '*.json'))
                      if os.path.basename(f) != 'MANIFEST.json')
        if not args:
            print('no workflow exports in ' + d + ' - export them with the n8n MCP first '
                  '(get_workflow_details), one JSON per flow.'); sys.exit(2)
        rc = main(args)
        missing = check_manifest(d, args)
        sys.exit(1 if missing else rc)
    sys.exit(main(args))
