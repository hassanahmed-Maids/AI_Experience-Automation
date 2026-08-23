"""The error-rail rule in erp_compliance.py, tested against synthetic flows.

WHY THIS FILE EXISTS. The rule it covers was added because the checker was GREEN on a flow that
stranded the ERP lease on every failure (CC Price Stage 1, run selfreq-test-2, 2026-08-20). A
rule written in response to a silent miss is exactly the kind that must not itself miss silently,
so each case below is paired with the mutation that should break it - run with --mutate.
"""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import erp_compliance as C

PASS = FAILN = 0
def ok(cond, label, detail=''):
    global PASS, FAILN
    if cond: PASS += 1; print('ok   ' + label)
    else: FAILN += 1; print('FAIL ' + label + (('\n       -> ' + detail) if detail else ''))

LEASE = C.LEASE_WORKFLOW_ID

def lease_node(name, mode, on_error=None):
    n = {'name': name, 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.3,
         'parameters': {'workflowId': {'__rl': True, 'mode': 'id', 'value': LEASE},
                        'workflowInputs': {'value': {'mode': mode, 'run_id': 'x', 'check_id': 'c'}}}}
    if on_error: n['onError'] = on_error
    return n

def erp_http(name, on_error=None):
    n = {'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
         'parameters': {'url': 'https://erpbackendpro.maids.cc/clientmgmt/contract/search/page',
                        'options': {'batching': {'batch': {'batchSize': 2, 'batchInterval': 500}},
                                    'timeout': 60000}}}
    if on_error: n['onError'] = on_error
    return n

def per_item_erp(name, on_error=None):
    """An ERP node that fans out PER ITEM - the shape the sub-workflow lease rule keys on.

    The rule only speaks about a sub-workflow when the flow actually has a per-item fan-out,
    which is what makes a caller-held lease load-bearing rather than a formality. erp_http()
    interpolates nothing, so it is run-level and the rule stays silent on it.
    """
    n = per_item_url(name)
    if on_error: n['onError'] = on_error
    return n

def per_item_url(name):
    return {'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
            'parameters': {'url': '=https://erpbackendpro.maids.cc/clientmgmt/contract/{{ $json.id }}',
                           'options': {'batching': {'batch': {'batchSize': 2, 'batchInterval': 500}},
                                       'timeout': 60000}}}

def flow(nodes, connections, name='fixture'):
    return {'name': name, 'nodes': nodes, 'connections': connections}

def base(**kw):
    """An entry flow that acquires the lease, calls ERP, and hands off downstream."""
    err = kw.get('err_on', 'Call ERP')
    nodes = [
        {'name': 'Run (webhook)', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'parameters': {}},
        lease_node('Acquire', 'acquire'),
        erp_http('Call ERP', on_error='continueErrorOutput' if err == 'Call ERP' else None),
        {'name': 'Handoff', 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.3,
         'parameters': {'workflowId': {'__rl': True, 'mode': 'id', 'value': 'someOtherWf'},
                        'options': {'waitForSubWorkflow': False}},
         'notes': C.EXEMPT['release'] + ' - Stage 3 releases it.'},
    ]
    conns = {'Run (webhook)': {'main': [[{'node': 'Acquire'}]]},
             'Acquire': {'main': [[{'node': 'Call ERP'}]]},
             'Call ERP': {'main': [[{'node': 'Handoff'}]]}}
    return nodes, conns

CANON = C.canonical_breaker_core()
def audit(nodes, conns):
    f, w, n = C.audit(flow(nodes, conns), CANON)
    return ' | '.join(f), ' | '.join(w), ' | '.join(n)

print('--- the miss this rule was written for ---')
nodes, conns = base()
nodes[2].pop('onError', None)
f, w, n = audit(nodes, conns)
ok('NO ERROR-PATH LEASE RELEASE' in f,
   'a flow that acquires and declares lease-released-downstream but has no error rail FAILS', f[:200])
ok('SUCCESS-path release only' in f,
   'and the message says the downstream exemption does not cover the error path')

print('\n--- an error rail that releases but finishes quietly ---')
nodes, conns = base()
nodes.append(lease_node('Release (error)', 'release'))
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
f, w, n = audit(nodes, conns)
ok('NEVER RE-THROWS' in f,
   'releasing on the error rail and then running off the end FAILS - n8n reports that as success', f[:160])

# The realistic version of that mistake is not an empty rail - it is someone adding a "log the
# failure" Code node and stopping there, which reads as handled and is not.
nodes, conns = base()
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Log Failure', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'console.log(JSON.stringify({stage: "failed"}));\nreturn $input.all();'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Log Failure'}]]}
f, w, n = audit(nodes, conns)
ok('NEVER RE-THROWS' in f,
   'a rail that logs the failure instead of throwing still FAILS - logging is not failing', f[:160])

print('\n--- the shape that is actually correct ---')
nodes, conns = base()
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Fail Loudly', 'type': 'n8n-nodes-base.stopAndError', 'typeVersion': 1,
              'parameters': {'errorMessage': 'run failed'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Fail Loudly'}]]}
f, w, n = audit(nodes, conns)
ok('ERROR-PATH' not in f and 'RE-THROWS' not in f,
   'release on the error output, then Stop and Error, passes', f[:160])
ok('error rail releases the lease and re-throws' in n, 'and it is reported as such')

print('\n--- a Code node that throws counts as re-throwing ---')
nodes, conns = base()
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("stage 1 failed: " + $json.error);'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok('RE-THROWS' not in f and 'ERROR-PATH' not in f, 'a Code node containing throw ends the rail', f[:160])

print('\n--- an Error Trigger rail is recognised too ---')
nodes, conns = base()
nodes[2].pop('onError', None)
nodes.append({'name': 'On Failure', 'type': 'n8n-nodes-base.errorTrigger', 'typeVersion': 1, 'parameters': {}})
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Fail Loudly', 'type': 'n8n-nodes-base.stopAndError', 'typeVersion': 1,
              'parameters': {'errorMessage': 'x'}})
conns['On Failure'] = {'main': [[{'node': 'Release (error)'}]]}
conns['Release (error)'] = {'main': [[{'node': 'Fail Loudly'}]]}
f, w, n = audit(nodes, conns)
ok('ERROR-PATH' not in f, 'an in-flow Error Trigger satisfies the rule', f[:160])

print('\n--- what the tool refuses to guess at ---')
# An IF has true/false BEFORE its error output, so index 1 is the FALSE branch, not the error
# one. Reading it as the error rail would pass a flow whose false branch happens to release.
nodes, conns = base()
nodes[2].pop('onError', None)
nodes.append({'name': 'Branch', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2,
              'parameters': {}, 'onError': 'continueErrorOutput'})
nodes.append(lease_node('Release (error)', 'release'))
conns['Call ERP']['main'] = [[{'node': 'Branch'}]]
conns['Branch'] = {'main': [[{'node': 'Handoff'}], [{'node': 'Release (error)'}]]}
f, w, n = audit(nodes, conns)
ok('will not read' in w and 'Branch' in w,
   'an error output on an IF is reported as unreadable rather than guessed at', w[:200])
ok('NO ERROR-PATH LEASE RELEASE' in f,
   'and the flow still FAILS - an unreadable rail is not a satisfied one', f[:160])

print('\n--- the release must be on the ERROR path, not merely present ---')
nodes, conns = base()
nodes[2].pop('onError', None)
nodes.append(lease_node('Release (success)', 'release'))
conns['Handoff'] = {'main': [[{'node': 'Release (success)'}]]}
f, w, n = audit(nodes, conns)
ok('NO ERROR-PATH LEASE RELEASE' in f,
   'a release wired only on the success path does not satisfy the error rule', f[:160])

print('\n--- an error release must not stand in for the success one ---')
# THIS IS A REGRESSION TEST FOR THIS FILE'S OWN FIRST VERSION. The error rule was added while the
# success check still asked only "does the word release appear anywhere in a lease node?" - so
# adding the error rail SATISFIED the success check, and a flow that had lost its
# lease-released-downstream declaration went green. The two questions are independent and are
# now asked independently.
nodes, conns = base()
nodes[3].pop('notes', None)          # drop the lease-released-downstream declaration
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("failed");'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok('NEVER RELEASED ON SUCCESS' in f,
   'an error-rail release does not satisfy the success path', f[:200])
ok('on the ERROR rail and never runs when the flow succeeds' in f,
   'and the message names the release it is refusing to count')

print('\n--- both paths covered, declared honestly ---')
nodes, conns = base()
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("failed");'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok(not [x for x in f.split(' | ') if x.startswith('§4')],
   'downstream declaration for success + a real error rail passes §4', f[:200])
ok('released downstream on success' in n and 'error rail releases' in n,
   'and both paths are reported separately, not as one green tick')

print('\n--- a stage that RELEASES owns the lease, whoever called it ---')
# CC Price Stage 3. It releases in its LAST node, so every failure ahead of that - including its
# own designed DELIVERY REFUSED on a short case set - left the lease held. The checker called it
# a PASS for weeks because it only ever examined entry flows.
nodes, conns = base()
nodes[0] = {'name': 'Receive Baton', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
            'typeVersion': 1.2, 'parameters': {}}
nodes = [n for n in nodes if n['name'] != 'Acquire']
nodes.append(lease_node('Release ERP Lease', 'release'))
conns = {'Receive Baton': {'main': [[{'node': 'Call ERP'}]]},
         'Call ERP': {'main': [[{'node': 'Handoff'}]]},
         'Handoff': {'main': [[{'node': 'Release ERP Lease'}]]}}
f, w, n = audit(nodes, conns)
ok('NO ERROR-PATH LEASE RELEASE' in f,
   'a sub-workflow that releases on success but has no error rail FAILS', f[:200])
ok('This stage OWNS the lease release' in f,
   'and the message says why it is responsible rather than quoting the entry-flow rule')

print('\n--- the same stage, with a rail ---')
nodes.append(lease_node('Release Lease (error)', 'release'))
nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("failed");'}})
nodes[[i for i, x in enumerate(nodes) if x['name'] == 'Call ERP'][0]]['onError'] = 'continueErrorOutput'
conns['Call ERP']['main'].append([{'node': 'Release Lease (error)'}])
conns['Release Lease (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok('§4' not in f, 'adding the error rail clears it', f[:200])
ok('this stage releases the lease on success' in n and 'error rail releases' in n,
   'and both paths are reported')

print('\n--- a middle stage of a fire-and-forget chain gets a WARNING, not a failure ---')
# CC Price Stage 2. Whether its death actually strands the lease depends on whether ITS caller
# waited, and that is not visible in this flow's export. Guessing either way would be the
# crying-wolf failure that made the byte-compare drift check useless, so it warns and says so.
nodes, conns = base()
nodes[0] = {'name': 'Receive Baton', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
            'typeVersion': 1.2, 'parameters': {}}
nodes = [n for n in nodes if n['name'] != 'Acquire']
nodes[1]['notes'] = C.EXEMPT['lease'] + ' - Stage 1 acquires and Stage 3 releases.'
conns = {'Receive Baton': {'main': [[{'node': 'Call ERP'}]]},
         'Call ERP': {'main': [[{'node': 'Handoff'}]]}}
f, w, n = audit(nodes, conns)
ok('middle link in a fire-and-forget chain' in w,
   'a mid-chain stage holding someone else\'s lease is warned about', w[:200])
ok('cannot see whether your caller waits' in w,
   'and the warning states the limit of what the tool can know')
ok('§4' not in f, 'but it is not failed, because the caller may well handle it', f[:160])

print('\n--- a mid-chain stage that builds a rail is held to the same standard ---')
nodes, conns = base()
nodes[0] = {'name': 'Receive Baton', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
            'typeVersion': 1.2, 'parameters': {}}
nodes = [n for n in nodes if n['name'] != 'Acquire']
nodes[1]['notes'] = C.EXEMPT['lease'] + ' - Stage 1 acquires and Stage 3 releases.'
nodes[1]['onError'] = 'continueErrorOutput'
nodes.append(lease_node('Release Lease (error)', 'release'))
conns = {'Receive Baton': {'main': [[{'node': 'Call ERP'}]]},
         'Call ERP': {'main': [[{'node': 'Handoff'}], [{'node': 'Release Lease (error)'}]]}}
f, w, n = audit(nodes, conns)
ok('NEVER RE-THROWS' in f,
   'a rail added voluntarily by a middle stage must still re-throw', f[:160])
ok('middle link in a fire-and-forget chain' not in w,
   'and it is no longer warned about as uncovered')

nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("failed");'}})
conns['Release Lease (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok('§4' not in f and 'error rail releases the lease and re-throws' in n,
   'and once it does, the stage is reported as covered', (f + ' // ' + n)[:200])

print('\n--- ...but only when the hand-off is actually fire-and-forget ---')
# A stage that launches the next one SYNCHRONOUSLY does not end before the chain does: its
# failure propagates up to whoever is waiting, and one error rail at the entry covers the whole
# chain. Warning here would be noise, and noise is how a checker stops being read.
nodes, conns = base()
nodes[0] = {'name': 'Receive Baton', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
            'typeVersion': 1.2, 'parameters': {}}
nodes = [n for n in nodes if n['name'] != 'Acquire']
nodes[1]['notes'] = C.EXEMPT['lease'] + ' - Stage 1 acquires and Stage 3 releases.'
nodes[2]['parameters']['options'] = {'waitForSubWorkflow': True}
conns = {'Receive Baton': {'main': [[{'node': 'Call ERP'}]]},
         'Call ERP': {'main': [[{'node': 'Handoff'}]]}}
f, w, n = audit(nodes, conns)
ok('middle link in a fire-and-forget chain' not in w,
   'a synchronous hand-off draws no mid-chain warning', w[:200])

print('\n--- the breaker exemption is NODE-scoped, not flow-scoped ---')
# It was flow-scoped, and that meant one "no-breaker-because" anywhere silenced the requirement
# for EVERY projection node in the flow. Two ERP nodes, one legitimately unjudgeable and one not,
# and the tool reported green for both. A blind spot inside the tool that finds blind spots.
def two_erp_flow(exempt_in=None, breaker_in=()):
    BEGIN = C.BREAKER_BEGIN + ' ==\n' + CANON + '\n// --- call site\n' + C.BREAKER_END
    def proj(name):
        js = BEGIN if name in breaker_in else '// projection\n'
        if name == exempt_in:
            js += "\n// " + C.EXEMPT['breaker'] + " one response cannot reach any threshold.\n"
        return {'name': name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                'parameters': {'jsCode': js}}
    nodes = [
        {'name': 'Run (webhook)', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'parameters': {}},
        lease_node('Acquire', 'acquire'), lease_node('Release', 'release'),
        erp_http('Count One'), erp_http('Fetch Pages'),
        proj('Read Count'), proj('Read Pages'),
    ]
    conns = {'Run (webhook)': {'main': [[{'node': 'Acquire'}]]},
             'Acquire': {'main': [[{'node': 'Count One'}]]},
             'Count One': {'main': [[{'node': 'Read Count'}]]},
             'Read Count': {'main': [[{'node': 'Fetch Pages'}]]},
             'Fetch Pages': {'main': [[{'node': 'Read Pages'}]]}}
    return nodes, conns

f, w, n = audit(*two_erp_flow())
ok(f.count('NO CIRCUIT BREAKER') == 2, 'both projection nodes are flagged when neither is covered', f[:120])

f, w, n = audit(*two_erp_flow(exempt_in='Read Count'))
ok('NO CIRCUIT BREAKER in "Read Pages"' in f,
   'a declaration in ONE node does not silence the other', f[:200])
ok('exempted' in n and 'Read Count' in n, 'and the declared node is reported as exempt, not failed')

f, w, n = audit(*two_erp_flow(exempt_in='Read Count', breaker_in=('Read Pages',)))
ok('NO CIRCUIT BREAKER' not in f,
   'declaring one and embedding the other clears §5', f[:200])

print('\n--- a node is judged by its CALL, not by its prose ---')
# FOUND ON WF-A, 2026-08-22. Its acquire carries a note explaining why it does NOT release
# ("lease-released-downstream - WF-C releases it... Releasing here would free it while WF-B is
# still reading"). The word "release" is in there, the success check was a substring scan over
# the whole node, and so the ACQUIRE was counted as the success release - a checker satisfied by
# a comment stating the exact opposite of the truth.
nodes, conns = base()
acq = [n for n in nodes if n['name'] == 'Acquire'][0]
acq['notes'] = (C.EXEMPT['release'] + ' - the LAST stage releases it. Releasing here would free '
                'the lease while the next stage is still calling ERP.')
nodes[3].pop('notes', None)          # move the declaration onto the acquire, off the handoff
nodes.append(lease_node('Release (error)', 'release'))
nodes.append({'name': 'Rethrow', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': 'throw new Error("failed");'}})
conns['Call ERP']['main'].append([{'node': 'Release (error)'}])
conns['Release (error)'] = {'main': [[{'node': 'Rethrow'}]]}
f, w, n = audit(nodes, conns)
ok('lease released downstream on success' in n,
   'an acquire whose NOTE mentions releasing is not mistaken for a release', (f + ' // ' + n)[:220])
ok('lease released on success (Acquire' not in n,
   'and it is certainly not reported as the success release')

print('\n--- mode is read from the call even when the prose disagrees ---')
nodes, conns = base()
liar = lease_node('Acquire', 'acquire')
liar['notes'] = 'this node does not release anything, ever'
nodes = [liar if x['name'] == 'Acquire' else x for x in nodes]
f, w, n = audit(nodes, conns)
ok('no call passes mode "acquire"' not in f,
   'an acquire is still recognised as an acquire', f[:160])

print('\n--- a lease call whose mode cannot be read is reported, never guessed ---')
nodes, conns = base()
murky = lease_node('Acquire', 'acquire')
# a caller that builds mode dynamically: the tool must say it cannot tell, not pick one
murky['parameters']['workflowInputs']['value']['mode'] = "={{ $json.wanted_mode }}"
murky['notes'] = 'this call will release the lease when the run ends'
nodes = [murky if x['name'] == 'Acquire' else x for x in nodes]
f, w, n = audit(nodes, conns)
ok('do not pass a literal' in w and 'Acquire' in w,
   'an unreadable mode is warned about', w[:200])
ok('no call passes mode "acquire"' in f,
   'and it counts as NO acquire rather than being guessed from the note that says "release"', f[:200])

print('\n--- a flow that calls the lease but never acquires ---')
nodes, conns = base()
nodes = [x for x in nodes if x['name'] != 'Acquire']
nodes.append(lease_node('Release Only', 'release'))
conns['Run (webhook)'] = {'main': [[{'node': 'Call ERP'}]]}
conns['Handoff'] = {'main': [[{'node': 'Release Only'}]]}
f, w, n = audit(nodes, conns)
ok('no call passes mode "acquire"' in f,
   'releasing without ever acquiring is a failure', f[:200])

print('\n--- a disabled node cannot fail its pacing, but is not ignored either ---')
nodes, conns = base()
bad = erp_http('Old Chain (disabled)')
bad['parameters']['url'] = '=https://erpbackendpro.maids.cc/clientmgmt/client/smsLog/{{ $json.client_id }}'
bad['parameters']['options']['batching'] = {'batch': {'batchSize': 15, 'batchInterval': 500}}
bad['disabled'] = True
nodes.append(bad)
conns['Handoff'] = {'main': [[{'node': 'Old Chain (disabled)'}]]}
f, w, n = audit(nodes, conns)
ok('30 req/s' not in f,
   'a disabled node at 30 req/s does not FAIL the flow - it makes no requests', f[:200])
ok('DISABLED node "Old Chain (disabled)"' in w and '30 req/s' in w,
   'but it is warned about, by name, with the rate', w[:220])

nodes2, conns2 = base()
bad2 = erp_http('Live Chain')
bad2['parameters']['url'] = '=https://erpbackendpro.maids.cc/clientmgmt/client/smsLog/{{ $json.client_id }}'
bad2['parameters']['options']['batching'] = {'batch': {'batchSize': 15, 'batchInterval': 500}}
nodes2.append(bad2)
conns2['Handoff'] = {'main': [[{'node': 'Live Chain'}]]}
f2, w2, n2 = audit(nodes2, conns2)
ok('30 req/s' in f2 and 'DISABLED' not in f2,
   'the same node ENABLED fails, so the exemption is disabled-only',
   [x for x in f2.split(' | ') if 'req/s' in x][:1] or f2[:160])

print('\n--- a pacing value set by EXPRESSION is reported, not crashed on ---')
# THE BUG THIS PINS. check_node compared batchInterval to an int directly, so a field holding an
# n8n expression ("={{ ... }}") raised TypeError and took the WHOLE checker down - every flow in
# the run lost its verdict because one node had a tunable interval. Found 2026-08-23 while
# considering making MV Stage 0's interval caller-tunable.
nodes3, conns3 = base()
ex = erp_http('Tunable Pacing')
ex['parameters']['url'] = '=https://erpbackendpro.maids.cc/clientmgmt/client/smsLog/{{ $json.client_id }}'
ex['parameters']['options']['batching'] = {'batch': {
    'batchSize': 2, 'batchInterval': "={{ $('Sweep In').first().json.pacingMs }}"}}
nodes3.append(ex)
conns3['Handoff'] = {'main': [[{'node': 'Tunable Pacing'}]]}
try:
    f3, w3, n3 = audit(nodes3, conns3)
    crashed = None
except Exception as e:
    f3 = w3 = n3 = ''
    crashed = repr(e)
ok(crashed is None, 'an expression-valued batchInterval does not crash the checker', crashed)
ok('pacing set by EXPRESSION' in f3 and 'batchInterval' in f3,
   'it FAILS instead: a ceiling a caller can override is not a ceiling', f3[:200])

print('\n--- a rail with a blind spot says so, instead of reading as complete ---')
# WF-B, 2026-08-23: the rail covered every Code and Execute-Workflow node and NOT the LLM Agent -
# the node in that flow most likely to fail on any given run. The checker printed "error rail
# releases the lease and re-throws" and stopped, so reading its output was enough to believe the
# lease was covered. The gap was deliberate and documented in an n8n version description, which is
# not a place anyone reads.
def railed(extra_nodes=None, extra_conns=None):
    nodes, conns = base()
    nodes.append(lease_node('Release Lease (error)', 'release'))
    nodes.append({'name': 'Fail Loudly', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                  'parameters': {'jsCode': 'throw new Error("dead");'}})
    conns['Call ERP'] = {'main': [[{'node': 'Handoff'}], [{'node': 'Release Lease (error)'}]]}
    conns['Release Lease (error)'] = {'main': [[{'node': 'Fail Loudly'}]]}
    for n in (extra_nodes or []):
        nodes.append(n)
    for k, v in (extra_conns or {}).items():
        conns[k] = v
    return nodes, conns

n1, c1 = railed()
f1, w1, nt1 = audit(n1, c1)
ok('error rail releases the lease and re-throws' in nt1,
   'the baseline railed flow is recognised as railed', nt1[:160])
ok('CANNOT reach it' not in w1,
   'and with no multi-output node on the main path it reports no blind spot', w1[:200])

MERGE = {'name': 'Join Streams', 'type': 'n8n-nodes-base.merge', 'typeVersion': 3, 'parameters': {}}
n2, c2 = railed([MERGE], {'Handoff': {'main': [[{'node': 'Join Streams'}]]}})
f2, w2, nt2 = audit(n2, c2)
ok('CANNOT reach it' in w2 and 'Join Streams' in w2,
   'a Merge on the main path IS named as a blind spot', w2[:200])
ok('FAIL' not in f2 and 'error rail releases the lease' in nt2,
   'and it is a WARNING, not a failure - the unwired node is the lesser evil', f2[:160])

# A sub-node hangs off an ai_* connection, never main. Listing it triples the warning and adds
# nothing, because its failure surfaces through the node it is attached to.
SUB = {'name': 'Anthropic Chat Model', 'type': '@n8n/n8n-nodes-langchain.lmChatAnthropic',
       'typeVersion': 1.5, 'parameters': {}}
n3, c3 = railed([MERGE, SUB], {'Handoff': {'main': [[{'node': 'Join Streams'}]]},
                               'Anthropic Chat Model': {'ai_languageModel': [[{'node': 'Join Streams'}]]}})
f3, w3, nt3 = audit(n3, c3)
ok('Anthropic Chat Model' not in w3,
   'a sub-node reached only by an ai_* connection is NOT named - that was the first version crying wolf',
   w3[:200])

MERGE_OK = dict(MERGE); MERGE_OK['onError'] = 'continueRegularOutput'
n4, c4 = railed([MERGE_OK], {'Handoff': {'main': [[{'node': 'Join Streams'}]]}})
f4, w4, nt4 = audit(n4, c4)
ok('CANNOT reach it' not in w4,
   'a node that sets onError is no longer a blind spot', w4[:200])

n5, c5 = railed([MERGE], {'Handoff': {'main': [[{'node': 'Join Streams'}]]}})
for n in n5:
    if n['name'] in ('Release Lease (error)', 'Fail Loudly'):
        n['_drop'] = True
n5 = [n for n in n5 if not n.get('_drop')]
c5['Call ERP'] = {'main': [[{'node': 'Handoff'}]]}
c5.pop('Release Lease (error)', None)
for n in n5:
    n.pop('onError', None)
f5, w5, nt5 = audit(n5, c5)
ok('NO ERROR-PATH LEASE RELEASE' in f5 and 'CANNOT reach it' not in w5,
   'a flow with NO rail fails on that and is not also told about blind spots', f5[:120])

# --- a lease call is a CALL, not a mention -------------------------------------------------
# 2026-08-23: a sub-workflow's `ERP-COMPLIANCE: lease-held-by-caller` declaration has to name the
# lease workflow id to be worth reading, and naming it made a Code node and a sticky note get
# reported as lease calls with an unreadable mode. Writing down which lease you depend on must
# never make you look like you are taking it - the same prose-vs-call confusion lease_mode()
# already documents, one level up.
DECLARER = {'name': 'Expand Chunk', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
            'parameters': {'jsCode': '// ERP-COMPLIANCE: lease-held-by-caller - the parent takes '
                                     + LEASE + ' before its first ERP call.\nreturn $input.all();'}}
STICKY = {'name': 'Note', 'type': 'n8n-nodes-base.stickyNote', 'typeVersion': 1,
          'parameters': {'content': 'The caller holds ' + LEASE + ' for the whole run.'}}
f6, w6, nt6 = audit(
    [{'name': 'Called by Parent', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
      'typeVersion': 1.1, 'parameters': {}},
     DECLARER, STICKY, per_item_erp('Call ERP', 'continueRegularOutput')],
    {'Called by Parent': {'main': [[{'node': 'Expand Chunk'}]]},
     'Expand Chunk': {'main': [[{'node': 'Call ERP'}]]}})
ok('do not pass a literal' not in w6,
   'a Code node quoting the lease id in a declaration is NOT reported as a lease call', w6[:200])
ok('lease-held-by-caller' in nt6,
   'and the declaration it carries is still read as the exemption', nt6[:200])

# --- a manual-only flow is an entry point ---------------------------------------------------
# 2026-08-23: §4 is guarded by `if is_entry ... elif is_subworkflow`, and is_entry was webhook or
# schedule only. A flow whose ONLY trigger is Run Manually matched neither, so its entire lease
# block was skipped in silence - and CC Non Received's parent, which acquires the lease and
# reaches ERP through 14 nodes, was audited with §4 never looked at. Manual counts as an entry
# only when there is no executeWorkflowTrigger, because sub-workflows keep a Run Manually beside
# their real trigger for testing.
MANUAL = {'name': 'Run Manually', 'type': 'n8n-nodes-base.manualTrigger', 'typeVersion': 1,
          'parameters': {}}
f7, w7, nt7 = audit(
    [MANUAL, per_item_erp('Call ERP', 'continueRegularOutput')],
    {'Run Manually': {'main': [[{'node': 'Call ERP'}]]}})
ok('NO ERP LEASE' in f7,
   'a manual-only flow that reaches ERP is checked for the lease, not skipped', f7[:140])

SUBTRIG = {'name': 'Called by Parent', 'type': 'n8n-nodes-base.executeWorkflowTrigger',
           'typeVersion': 1.1, 'parameters': {}}
f8, w8, nt8 = audit(
    [SUBTRIG, MANUAL, DECLARER, per_item_erp('Call ERP', 'continueRegularOutput')],
    {'Called by Parent': {'main': [[{'node': 'Expand Chunk'}]]},
     'Expand Chunk': {'main': [[{'node': 'Call ERP'}]]}})
ok('NO ERP LEASE' not in f8 and 'lease-held-by-caller' in nt8,
   'a sub-workflow with a Run Manually beside its real trigger is still a sub-workflow',
   (f8 + ' | ' + nt8)[:180])

# --- a rail can release, re-throw, and still be mute -----------------------------------------
# 2026-08-23: twelve of thirteen flows ran `failing node -> Release Lease (error) -> Fail Loudly`,
# and Fail Loudly read $input. Release Lease (error) is an Execute Sub-workflow node, which does
# not pass its input through - it REPLACES the item with the sub-workflow's return value. So the
# only message any of those rails could produce was 'FAILED at "unknown node": unknown error'.
# Every check passed, because releasing and re-throwing was all §4 asked about. These cases pin
# the difference between a rail that is safe and one that can also say what happened.
def rail_flow(terminal_body, via_lease=True):
    n, c = base()
    n.append(lease_node('Release Lease (error)', 'release'))
    n.append({'name': 'Fail Loudly', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': terminal_body}})
    if via_lease:
        c['Call ERP']['main'].append([{'node': 'Release Lease (error)'}])
        c['Release Lease (error)'] = {'main': [[{'node': 'Fail Loudly'}]]}
    else:
        # The fix: a Code node FIRST, before the lease call, so the error survives the release.
        n.append({'name': 'Capture Failure', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                  'parameters': {'jsCode': 'return [{ json: { _failure: $input.first().json } }];'}})
        c['Call ERP']['main'].append([{'node': 'Capture Failure'}])
        c['Capture Failure'] = {'main': [[{'node': 'Release Lease (error)'}]]}
        c['Release Lease (error)'] = {'main': [[{'node': 'Fail Loudly'}]]}
    return n, c

BAD = "const e = $input.first().json.error;\nthrow new Error('FAILED: ' + e);"
GOOD = ("const f = $('Capture Failure').first().json._failure || {};\n"
        "throw new Error('FAILED: ' + f.message);")

f9, w9, nt9 = audit(*rail_flow(BAD))
ok('the rail re-throws from "Fail Loudly", but that node reads $input' in f9,
   'a rail terminal that reads $input through the lease call FAILS', f9[:160])
ok('error rail releases the lease and re-throws' in nt9,
   'and it is still credited with releasing and re-throwing - the bug is the diagnostic, not safety',
   nt9[:160])

f10, w10, nt10 = audit(*rail_flow(GOOD, via_lease=False))
ok('reads $input' not in f10,
   'the Capture-Failure-first shape passes', f10[:200])

# The mutation that must break the rule: state the fix in a COMMENT while still reading $input.
# rail_reads_the_failure fired on all three flows it had just been used to fix, because each one
# now explains itself with the sentence "NOT FROM $input" - a rule that reads prose cannot tell an
# explanation from an instruction, so the body is stripped of comments before it is searched.
COMMENTED = ("// READ THE FAILURE FROM Capture Failure, NOT FROM $input - the lease call eats it.\n"
             + BAD)
f11, _, _ = audit(*rail_flow(COMMENTED))
ok('reads $input' in f11,
   'a comment saying "not from $input" does not excuse a body that still reads it', f11[:160])

COMMENT_ONLY = ("// This used to read $input, which the lease call replaces. It no longer does.\n"
                + GOOD)
f12, _, _ = audit(*rail_flow(COMMENT_ONLY, via_lease=False))
ok('reads $input' not in f12,
   'and a comment MENTIONING $input in a body that does not read it is not a failure', f12[:160])

# --- the breaker judges a BATCH, so the walk must not follow error outputs -------------------
# Adding Capture Failure to the rail put a Code node directly on the ERP node's error output, and
# §5 promptly demanded a circuit breaker in it. A breaker there is meaningless: an error output
# carries one failure, never the batch of responses the three thresholds are computed over. The
# walk follows output 0 only.
n13, c13 = rail_flow(GOOD, via_lease=False)
f13, w13, nt13 = audit(n13, c13)
ok('NO CIRCUIT BREAKER in "Capture Failure"' not in f13,
   'the breaker is not demanded in a node that only ever sees the error output', f13[:200])

# --- a baked credential is a failure, and a description of one is not --------------------------
# 2026-08-23: two OTHER users' signed ERP tokens were hardcoded in `Manual Run Config` nodes, one of
# them in the LIVE parent, and committed to git. Both expired weeks earlier, so no live exposure -
# but both nodes ALREADY said not to do it, one of them three lines above the populated constant.
# Prose is not enforcement. These cases pin the line between a real credential and text about one.
def cred_flow(body):
    n, c = base()
    n.append({'name': 'Manual Run Config', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'parameters': {'jsCode': body}})
    c['Manual Run Config'] = {'main': [[{'node': 'Acquire'}]]}
    return n, c

REAL = ("eyJhbGciOiJIUzUxMiJ9.eyJ1c2VyIjoiU29tZS5Vc2VyIiwiZXhwIjoxNzg3NTIyNDAwfQ."
        "PCpCAGZH6E6kSCk08pmqxhs2f8h5FcS1yPwHYu55VMDmJqbiYZv9IYqEzhCw7THAXc5JQaF4SP2HKG8jHg")

f14, _, _ = audit(*cred_flow("const ERP_BEARER = 'Bearer " + REAL + "';\nreturn $input.all();"))
ok('BAKED CREDENTIAL in "Manual Run Config"' in f14,
   'a real signed token hardcoded in a node FAILS', f14[:140])

# The exact shape that shipped: the node says the field must be empty, and it is not.
COMMENTED = ("// It is DELIBERATELY LEFT EMPTY. Clear it again once the run is done.\n"
             "const ERP_BEARER = 'Bearer " + REAL + "';\nreturn $input.all();")
f15, _, _ = audit(*cred_flow(COMMENTED))
ok('BAKED CREDENTIAL' in f15,
   'a comment saying the field is empty does not excuse a populated one - the shipped shape',
   f15[:140])

f16, _, _ = audit(*cred_flow("const ERP_BEARER = '';   // paste a Bearer eyJ... token here\n"
                             "return $input.all();"))
ok('BAKED CREDENTIAL' not in f16,
   'the cleared field, with a comment describing the token format, passes', f16[:200])

# A token in a NOTE or a sticky is the same exposure as one in code - the rule reads the whole node.
n17, c17 = base()
n17.append({'name': 'Call ERP 2', 'type': 'n8n-nodes-base.noOp', 'typeVersion': 1, 'parameters': {},
            'notes': 'Run it with Bearer ' + REAL})
f17, _, _ = audit(n17, c17)
ok('BAKED CREDENTIAL in "Call ERP 2"' in f17,
   'a token pasted into a node NOTE fails too, not just one in code', f17[:140])

# Not issuer-specific: any three-segment signed token is a credential.
OTHER = ("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0."
         "dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE")
f18, _, _ = audit(*cred_flow("const KEY = '" + OTHER + "';\nreturn $input.all();"))
ok('BAKED CREDENTIAL' in f18,
   'a non-ERP signed token (supabase-shaped) fails the same way', f18[:140])

# --- the mute-rail rule, narrowed twice by flows it got wrong ---------------------------------
# Both narrowings are real. (1) Looking for the bare string '$input' called CC Overstay Fines
# broken - the best-built rail in the repo, which already had this fix under the name
# `Build Error Callback` and touches $input only for the lease's own action/state. (2) Relaxing it
# to "reads any upstream rail node by name" then excused CC Below Agreed 2-Verify, which IS mute:
# every terminal here reads $('Validate Inputs') for the run_id and Validate Inputs is on the rail.
# What separates them is where the ERROR comes from, and that is what the rule asks now.
LEASE_OUT = ("const item = $input.first().json || {};\n"          # the lease's own return value
             "const act = String(item.action || '');\n"
             "const f = ($('Capture Failure').first().json || {})._failure || {};\n"
             "throw new Error('FAILED at ' + f.node + ': ' + f.message + ' lease=' + act);")
f19, _, nt19 = audit(*rail_flow(LEASE_OUT, via_lease=False))
ok('reads $input' not in f19,
   'a terminal that reads $input for the LEASE result and the error by name passes - the CC '
   'Overstay Fines shape', f19[:200])

INCIDENTAL_NAMED = ("const item = $input.first().json || {};\n"   # error DOES come from $input
                    "const msg = String(item.error && item.error.message);\n"
                    "const r = $('Validate Inputs').first().json.run_id;\n"   # named, but only run_id
                    "throw new Error('FAILED: ' + msg + ' run ' + r);")
f20, _, _ = audit(*rail_flow(INCIDENTAL_NAMED))
ok('reads $input' in f20,
   'reading SOME upstream node by name does not excuse an error still taken from $input - the '
   'CC Below Agreed 2-Verify shape', f20[:200])

NO_LOCAL = "throw new Error('FAILED: ' + $input.first().json.error.message);"
f21, _, _ = audit(*rail_flow(NO_LOCAL))
ok('reads $input' in f21,
   'the same bug written without a local variable is still the bug', f21[:160])

print('\n' + ('FAILED %d / %d' % (FAILN, PASS + FAILN) if FAILN else 'all %d passed' % PASS))
sys.exit(1 if FAILN else 0)
