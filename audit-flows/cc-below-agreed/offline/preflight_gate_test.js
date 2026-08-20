// The ERP pre-flight budget gate, tested against the REAL Chunk Candidates body.
//
// WHY THIS SUITE EXISTS. ERP was taken down three times by audit traffic. Pacing
// (tools/erp_load_check.py) bounds requests per SECOND; it does nothing about how MANY there
// are. A flow paced perfectly at 4 req/s still makes ~13,400 calls against a 5,632-contract
// cohort, and that is the actual failure: a flow tested on ten contracts behaves identically
// on five thousand, and nothing in between makes the multiplier visible.
//
// The gate is the control that refuses. Because it REFUSES rather than trims, it is also the
// control most likely to be quietly softened by someone in a hurry - so its two properties are
// pinned here: it throws with both numbers, and it never returns a shortened cohort.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'wf-e', 'wfa', 'chunk_candidates.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

function run(nCandidates, params, gate2) {
  const validated = Object.assign({ run_id: 'r-gate-test', params: params || {} }, {});
  validated.params = Object.assign({ erp_auth: { bearer: 'Bearer x' } }, params || {});
  const items = [];
  for (let i = 0; i < nCandidates; i++) {
    items.push({ json: { case_key: i + ':2026-07', contract_id: String(i), client_id: 'c' + i } });
  }
  const nodes = {
    'Validate Inputs': [{ json: validated }],
    'Verify Bulk Pulls': [{ json: { _gate2: gate2 === undefined
        ? { population_pages: 136, status_pages: 22 } : gate2 } }]
  };
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    return { all: () => nodes[n], first: () => nodes[n][0] };
  };
  const logs = [];
  const out = new Function('$input', '$', 'console', SRC)(
    { all: () => items, first: () => items[0] }, $, { log: m => logs.push(m) });
  const parsed = logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } });
  return { out: out || [], gate: parsed.filter(l => l.stage === 'erp_preflight_gate')[0] || {},
           highVolume: parsed.filter(l => l.stage === 'erp_preflight_high_volume')[0] || null,
           chunkLog: parsed.filter(l => l.stage === 'chunk_candidates')[0] || {} };
}
function throwsWith(fn, label, ...needles) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    const missing = needles.filter(n => e.message.indexOf(String(n)) === -1);
    if (missing.length) { fail++; console.log('FAIL ' + label + '\n       -> message lacked: ' + missing.join(', ')); }
    else { pass++; console.log('ok   ' + label); }
  }
}

console.log('--- within budget: the run proceeds and nothing is trimmed ---');
const R = run(400);
ok(R.gate.within_budget === true, 'a 400-candidate cohort fits the default 2,000-call budget',
   'projected ' + R.gate.projected_total);
// 136 population pages + 22 status pages + the 3 payment windows = 161 sweep calls already
// spent, then the cohort twice over: this phase's 2 per entity and WF-B's 2 per candidate.
ok(R.gate.projected_total === (136 + 22 + 3) + 400 * 2 + 400 * 2,
   'projection = measured sweeps (136+22+3 windows) + cohort x per-entity + cohort x downstream',
   String(R.gate.projected_total));
const delivered = R.out.reduce((n, c) => n + c.json.cases.length, 0);
ok(delivered === 400, 'every candidate reaches a chunk - the gate never trims the cohort',
   delivered + ' of 400');

console.log('\n--- over budget: it refuses, and says exactly what it refused ---');
throwsWith(() => run(2000), 'a 2,000-candidate cohort is refused against the default budget',
  'PRE-FLIGHT GATE', '8161', '2000', 'cohort_cap', 'erp_call_budget');
throwsWith(() => run(2000), 'the refusal states the ERP minutes it would have cost', 'minutes of ERP time');
throwsWith(() => run(2000), 'the refusal refuses to auto-trim, and says why',
  'NOT trimmed automatically');

console.log('\n--- the budget is a deliberate act, not a default to drift past ---');
const big = run(2000, { erp_call_budget: 20000 });
ok(big.gate.within_budget === true && big.gate.budget_source === 'params.erp_call_budget',
   'an explicit erp_call_budget lets a real audit through and records that it was explicit',
   big.gate.budget_source);
ok(run(400).gate.budget_source.indexOf('default') === 0,
   'an unspecified run is recorded as running on the default budget');
// A run over the threshold that is ALSO over budget: the refusal must name the policy rule.
throwsWith(() => run(8000, { erp_call_budget: 20000 }),
  'above the 15,000 sign-off threshold the refusal names the policy requirement',
  '15000', 'recorded');
// And a run over the threshold that is ALLOWED must still announce itself, which is the case
// the threshold most needs to mark and the one it used to say nothing about.
const loud = run(8000, { erp_call_budget: 40000 });
ok(loud.highVolume && loud.highVolume.allowed === true && loud.highVolume.projected_total === 32161,
   'a high-volume run that IS within budget still logs itself for the record',
   JSON.stringify(loud.highVolume || null));

console.log('\n--- it prefers what the run MEASURED over the built-in estimate ---');
const measured = run(10, { }, { population_pages: 500, status_pages: 100 });
ok(measured.gate.sweep_calls_spent === 603,
   'sweep cost is read from gate 2 pages actually walked, not a constant',
   String(measured.gate.sweep_calls_spent));
const noGate2 = run(10, {}, {});
ok(noGate2.gate.sweep_calls_spent === 185,
   'when gate 2 reports nothing, it falls back to the documented estimate rather than zero',
   String(noGate2.gate.sweep_calls_spent));

console.log('\n--- an empty cohort is not a budget failure ---');
const none = run(0);
ok(none.out.length === 0, 'a cohort of zero returns no chunks and does not throw');

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
