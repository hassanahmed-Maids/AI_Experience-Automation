import fs from 'fs';
const body = fs.readFileSync(process.argv[2], 'utf8');
const run = new Function('$json', '$', body);

// Mimics the n8n Code node env for runOnceForEachItem.
function mk(row, { startDate = '2024-03-15', throwOnLookup = false } = {}) {
  const $ = (name) => {
    if (throwOnLookup) throw new Error('no paired item');
    if (name === 'Fan Out Contracts') return { item: { json: { contractId: 1, clientId: 9, startOfContract: startDate } } };
    if (name === 'Read Contract Details') return { item: { json: { body: { contractStartDate: startDate } } } };
    throw new Error('unexpected node ' + name);
  };
  return run(row, $).json;
}

const base = { gate: '6', state: 'clean', verdict: 'OK', gap: 0, expected_known: true,
               expected_total: 3000, paid_total: 3000, target_month: '2026-07', caps: '' };
const R = (o) => Object.assign({}, base, o);

const cases = [
  // --- D5: scope vs review queue ---
  ['gate 1 not-an-MV-contract  -> out of scope',
   R({ gate: '1', state: 'pending', verdict: 'Awaiting reviewer', expected_known: false, expected_total: 0, paid_total: 0 }),
   {}, r => r.state === 'out_of_scope' && r.verdict === 'Out of scope' && r.gap === 0],
  ['gate 2 month outside life  -> out of scope',
   R({ gate: '2', state: 'pending', verdict: 'Awaiting reviewer', expected_known: false, expected_total: 0, paid_total: 0 }),
   {}, r => r.state === 'out_of_scope' && r.verdict === 'Out of scope'],
  ['gate surface ERP unreadable-> STAYS in the reviewer queue',
   R({ gate: 'surface', state: 'pending', verdict: 'Awaiting reviewer', expected_known: false, expected_total: 0, paid_total: 0 }),
   {}, r => r.state === 'pending' && r.verdict === 'Awaiting reviewer'],
  ['gate 5 pre-collected unreadable -> STAYS in the reviewer queue',
   R({ gate: '5', state: 'pending', verdict: 'Awaiting reviewer', expected_known: false, expected_total: 0, paid_total: 0 }),
   {}, r => r.state === 'pending'],
  ['gate 4 no-rows-no-expectation   -> STAYS in the reviewer queue',
   R({ gate: '4', state: 'pending', verdict: 'Awaiting reviewer', expected_known: false, expected_total: 0, paid_total: 0 }),
   {}, r => r.state === 'pending'],

  // --- D6: the gap that was never assigned ---
  ['gate 6 clean, OVERPAID      -> signed negative gap (was 0)',
   R({ expected_total: 3000, paid_total: 3200 }), {}, r => r.gap === -200],
  ['gate 6 clean, paid exactly  -> gap 0',
   R({ expected_total: 3000, paid_total: 3000 }), {}, r => r.gap === 0],
  ['gate 6 clean, START month partial -> gap NOT invented',
   R({ gate: '6', expected_total: 3000, paid_total: 1000, target_month: '2024-03' }),
   { startDate: '2024-03-15' }, r => r.gap === 0],
  ['gate 7 clean by chain, START month -> gap NOT invented',
   R({ gate: '7', expected_total: 3000, paid_total: 500, target_month: '2024-03' }),
   { startDate: '2024-03-15' }, r => r.gap === 0],
  ['gate 8 red, nothing paid   -> gap unchanged at the owed amount',
   R({ gate: '8', state: 'finding', verdict: 'Red Flag', gap: 3000, expected_total: 3000, paid_total: 0 }),
   {}, r => r.gap === 3000],
  ['gate 17 red, short         -> gap 500',
   R({ gate: '17', state: 'finding', verdict: 'Red Flag', gap: 500, expected_total: 3000, paid_total: 2500 }),
   {}, r => r.gap === 500],
  ['gate 15 pending in-flight  -> real gap now shown (was 0)',
   R({ gate: '15', state: 'pending', verdict: 'Still in flight', expected_total: 3000, paid_total: 1000 }),
   {}, r => r.gap === 2000],
  ['expected unknown           -> gap untouched',
   R({ expected_known: false, expected_total: 0, paid_total: 1000, gap: 0 }), {}, r => r.gap === 0],
  ['rounding: .1 + .2 style    -> 2 dp, no float dust',
   R({ expected_total: 3000.1, paid_total: 2999.9 }), {}, r => r.gap === 0.2],
  ['paired-item lookup throws  -> gap left as scored AND said so',
   R({ expected_total: 3000, paid_total: 3200, gap: 0 }), { throwOnLookup: true },
   r => r.gap === 0 && /could not resolve the contract start month/.test(r.caps)],
  ['out-of-scope + start month -> both rules coexist',
   R({ gate: '2', state: 'pending', expected_known: true, expected_total: 3000, paid_total: 100, target_month: '2024-03' }),
   { startDate: '2024-03-15' }, r => r.state === 'out_of_scope' && r.gap === 0],
];

let pass = 0, fail = 0;
for (const [name, row, opts, check] of cases) {
  let got, ok = false, err = null;
  try { got = mk(row, opts); ok = check(got); } catch (e) { err = e.message; }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (err ? ('  [threw: ' + err + ']') : ('  -> state=' + got.state + ' verdict=' + got.verdict + ' gap=' + got.gap))); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
