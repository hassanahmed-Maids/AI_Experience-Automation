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

print('\n' + ('FAILED %d / %d' % (FAILN, PASS + FAILN) if FAILN else 'all %d passed' % PASS))
sys.exit(1 if FAILN else 0)
