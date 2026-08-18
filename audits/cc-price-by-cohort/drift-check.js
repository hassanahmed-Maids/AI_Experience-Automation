// Proves the =TODAY() drift on the card's trailing windows cannot change a
// verdict. The live sheet's final window end date moves every day; if the
// scorer treated it as a hard bound, every contract would fall out of the card
// the day after capture. Re-runs the pinned cases against a card whose trailing
// end dates have been advanced, and against one where they are blank entirely.
const { score } = require('./scorer');
const base = require('./card.json');
const AS_OF = { asOfMs: Date.UTC(2026, 7, 17) };

const cases = [
  { l: 'ethiopian livein under', c: { contract_id: 1, maid_nationality: 'Ethiopian', live_out: false, contract_start_date: '2025-01-19', agreed_monthly_rate: 2604, additional_discount: '', credit_note_discount: '', live_in_out_logs: [] } },
  { l: 'filipina liveout under',  c: { contract_id: 2, maid_nationality: 'Filipina', live_out: true, contract_start_date: '2026-08-14', agreed_monthly_rate: 1575, additional_discount: '', credit_note_discount: '', live_in_out_logs: [] } },
  { l: 'grandfathered clearance', c: { contract_id: 3, maid_nationality: 'Filipina', live_out: false, contract_start_date: '2018-11-01', agreed_monthly_rate: 4301, additional_discount: '', credit_note_discount: '', live_in_out_logs: [] } },
  { l: 'priced correctly today',  c: { contract_id: 4, maid_nationality: 'Filipina', live_out: false, contract_start_date: '2026-01-01', agreed_monthly_rate: 4714.5, additional_discount: '', credit_note_discount: '', live_in_out_logs: [] } },
];

function variant(name, fn) {
  const card = JSON.parse(JSON.stringify(base)).map(fn);
  const out = [];
  for (const t of cases) { const r = score(t.c, card, AS_OF); out.push(t.l + '=' + r.state + '/' + r.verdict + '/' + r.gap_aed); }
  return { name, sig: out.join(' | ') };
}

const v = [
  variant('pinned (end 8/17/2026)', (w) => w),
  variant('drifted (end 8/18/2026)', (w) => (w.end === '8/17/2026' ? Object.assign({}, w, { end: '8/18/2026' }) : w)),
  variant('drifted +1y',            (w) => (w.end === '8/17/2026' ? Object.assign({}, w, { end: '8/17/2027' }) : w)),
  variant('trailing end blank',     (w) => (w.end === '8/17/2026' ? Object.assign({}, w, { end: '' }) : w)),
  // Float noise the live sheet actually returns (4150.650000000001).
  variant('live float noise',       (w) => (w.price_inc_vat === 4150.65 ? Object.assign({}, w, { price_inc_vat: 4150.650000000001 }) : w)),
];

for (const x of v) console.log(x.name.padEnd(26), x.sig);
const same = v.every((x) => x.sig === v[0].sig);
console.log('\nall variants agree with the pinned card:', same);
process.exit(same ? 0 : 1);
