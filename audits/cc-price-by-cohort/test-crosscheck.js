// Assertions for the ERP price-card cross-check, run offline against fixtures
// shaped like the real getconfigs response (probe execution 93413).
//
// The node is an n8n Code body, so it is exercised by supplying fake $input /
// $() rather than by importing it - the same trick as the parity harness, and it
// means these assertions cover the SHIPPED text.
const fs = require('fs');
const card = require('./card.json');

const SRC = fs.readFileSync('./n8n/stage1-crosscheck-erp-card.js', 'utf8');

// --- fixture builders ------------------------------------------------------
const cfg = function (nationality, type, pkg, monthly, opts) {
  const o = opts || {};
  return {
    id: o.id === undefined ? Math.floor(monthly * 1000 + nationality.length) : o.id,
    nationality: { id: 1, code: nationality.toLowerCase(), label: nationality },
    contractProspectType: { id: 1650, code: o.prospect || 'maids.cc_prospect', label: o.prospectLabel || 'Maids.cc' },
    type: { value: type, label: type },
    packageType: pkg ? { value: pkg, label: pkg } : '',
    isRemote: false,
    default: o.isDefault === undefined ? true : o.isDefault,
    disabled: o.disabled === true,
    monthlyPayment: monthly,
  };
};

// The real matrix, reduced to what the comparison touches.
const AGREEING = [
  cfg('Filipina', 'LONG_TERM', 'NORMAL_LONG_TERM', 4715, { id: 11277 }),
  cfg('Ethiopian', 'LONG_TERM', 'NORMAL_LONG_TERM', 3129, { id: 3 }),
  cfg('Kenyan', 'LONG_TERM', 'NORMAL_LONG_TERM', 3129, { id: 78662 }),
  cfg('Filipina', 'LIVE_OUT', 'NORMAL_LONG_TERM', 5712, { id: 24838 }),
  cfg('Kenyan', 'LIVE_OUT', 'NORMAL_LONG_TERM', 4127, { id: 24817 }),
  // Noise that must be excluded, all real shapes from the probe.
  cfg('Filipina', 'SHORT_TERM', '', 4133, { id: 10 }),
  cfg('Filipina', 'LONG_TERM', 'RENEWAL', 4301, { id: 80 }),
  cfg('Filipina', 'LONG_TERM', 'TEMPORARY_PACKAGE', 2625, { id: 59 }),
  cfg('Ethiopian', 'LONG_TERM', 'PROBATION_PACKAGE', 2415, { id: 73 }),
  cfg('Filipina', 'LONG_TERM', 'NORMAL_LONG_TERM', 9999, { id: 991, prospect: 'maidvisa.ae_prospect', prospectLabel: 'maids.cc/VisaServices' }),
  cfg('Filipina', 'LONG_TERM', 'NORMAL_LONG_TERM', 8888, { id: 992, isDefault: false }),
  cfg('Filipina', 'LONG_TERM', 'NORMAL_LONG_TERM', 7777, { id: 993, disabled: true }),
];

const page = function (items, total, status) {
  return { json: { statusCode: status === undefined ? 200 : status, body: { content: items, totalElements: total === undefined ? items.length : total } } };
};

function run(pages, params) {
  const parseCardOut = { json: { params: params || {}, price_card: { windows: card, windows_parsed: card.length, cohorts: 5, checksum_ok: true } } };
  const fn = new Function('$input', '$', SRC + '\n//# sourceURL=crosscheck');
  return fn(
    { all: function () { return pages; }, first: function () { return pages[0]; } },
    function (name) {
      if (name === 'Parse + Assert Card') return { first: function () { return parseCardOut; } };
      throw new Error('unexpected node reference: ' + name);
    }
  );
}

let pass = 0, fail = 0;
const failures = [];
function check(label, fn, expect) {
  let got;
  try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = typeof got === 'string' ? got : JSON.stringify(got);
  const e = typeof expect === 'string' ? expect : JSON.stringify(expect);
  const ok = typeof expect === 'function' ? expect(got) : g === e;
  if (ok) { pass++; return; }
  fail++;
  failures.push('  ' + label + '\n     expected ' + (typeof expect === 'function' ? '(predicate)' : e) + '\n     actual   ' + g);
}
const cc = function (r) { return r[0].json.erp_cross_check; };

// === the happy path ========================================================
check('all five cohorts agree',
  function () { const x = cc(run([page(AGREEING)])); return [x.cohorts_compared, x.cohorts_agreeing, x.novel_divergences.length]; },
  [5, 5, 0]);

check('the card and params are passed through for the next node',
  function () { const r = run([page(AGREEING)], { run_id: 'X' }); return [r[0].json.params.run_id, r[0].json.price_card.checksum_ok]; },
  ['X', true]);

check('MV rows, non-default rows and disabled rows are all excluded',
  // If any leaked in, a cohort would carry 9999 / 8888 / 7777.
  function () {
    const x = cc(run([page(AGREEING)]));
    const all = [];
    for (const r of x.results) for (const p of r.erp_prices) all.push(p);
    return all.sort(function (a, b) { return a - b; });
  },
  [3129, 3129, 4127, 4715, 5712]);

check('SHORT_TERM and the package variants are excluded',
  function () {
    const x = cc(run([page(AGREEING)]));
    const f = x.results.filter(function (r) { return r.cohort === 'livein:Filipina'; })[0];
    return f.erp_prices;
  },
  [4715]);

// === the known divergence ==================================================
const WITH_ETH_2919 = AGREEING.map(function (r) {
  if (r.id === 3) { const c = JSON.parse(JSON.stringify(r)); c.monthlyPayment = 2919; return c; }
  return r;
});

check('the known Ethiopian divergence is reported as ACCEPTED, not novel',
  function () { const x = cc(run([page(WITH_ETH_2919)])); return [x.novel_divergences.length, x.accepted_divergences.length]; },
  [0, 1]);

check('and it does NOT abort even in abort mode',
  function () { const x = cc(run([page(WITH_ETH_2919)], { card_crosscheck: 'abort' })); return x.cohorts_agreeing; },
  4);

check('the note names the open divergence rather than claiming agreement',
  function () { return /known open divergence/.test(cc(run([page(WITH_ETH_2919)])).note); },
  function (v) { return v === true; });

// === a NEW divergence ======================================================
const WITH_NEW = AGREEING.map(function (r) {
  if (r.id === 11277) { const c = JSON.parse(JSON.stringify(r)); c.monthlyPayment = 4000; return c; }
  return r;
});

check('a previously unseen divergence is NOVEL',
  function () { const x = cc(run([page(WITH_NEW)])); return x.novel_divergences.length; }, 1);

check('warn mode (the default) declares it and lets the run proceed',
  function () { const x = cc(run([page(WITH_NEW)])); return [x.mode, /DECLARED/.test(x.note)]; },
  ['warn', true]);

check('abort mode stops the run and says why',
  function () { return run([page(WITH_NEW)], { card_crosscheck: 'abort' }); },
  function (v) { return typeof v === 'string' && v.indexOf('THREW: PRICE CARD DISAGREES WITH ERP') === 0 && v.indexOf('livein:Filipina') !== -1; });

check('an Ethiopian divergence at the WRONG amount is novel, not waved through',
  function () {
    const rows = AGREEING.map(function (r) {
      if (r.id === 3) { const c = JSON.parse(JSON.stringify(r)); c.monthlyPayment = 2500; return c; }
      return r;
    });
    return cc(run([page(rows)])).novel_divergences.length;
  },
  1);

// === completeness ==========================================================
check('a short read is a problem and marks ERP unreadable',
  function () { const x = cc(run([page(AGREEING, 1026)])); return [x.readable, x.problems.length]; },
  [false, 1]);

check('an unreadable ERP NEVER aborts, even in abort mode - the card still stands',
  function () { const x = cc(run([page(AGREEING, 1026)], { card_crosscheck: 'abort' })); return x.readable; },
  false);

check('a non-200 page is recorded with its status',
  function () { const x = cc(run([page([], undefined, 503)])); return [x.readable, /HTTP 503/.test(x.problems[0])]; },
  [false, true]);

check('duplicate ids across pages are dropped, not double counted',
  function () { const x = cc(run([page(AGREEING, 12), page(AGREEING, 12)])); return [x.config_rows_read, x.duplicates_dropped]; },
  [12, 12]);

// === the bucket-approximation finding ======================================
const WITH_BUCKET_SPREAD = AGREEING.concat([
  cfg('Indian', 'LONG_TERM', 'NORMAL_LONG_TERM', 3675, { id: 63492 }),
  cfg('Nepali', 'LONG_TERM', 'NORMAL_LONG_TERM', 4190, { id: 11278 }),
  cfg('Cameroonian', 'LONG_TERM', 'NORMAL_LONG_TERM', 2100, { id: 79057 }),
]);

check('nationalities ERP prices ABOVE the card bucket are flagged as under-reporting',
  function () {
    const x = cc(run([page(WITH_BUCKET_SPREAD)]));
    return x.bucket_mismatches.filter(function (m) { return m.nationality === 'Indian'; })[0].direction;
  },
  'erp_higher_check_under_reports');

check('nationalities ERP prices BELOW the card bucket are flagged as false reds',
  function () {
    const x = cc(run([page(WITH_BUCKET_SPREAD)]));
    return x.bucket_mismatches.filter(function (m) { return m.nationality === 'Cameroonian'; })[0].direction;
  },
  'erp_lower_check_false_reds');

check('a spread within one bucket does not by itself count as a cohort divergence',
  // livein:Other still contains 3129, which is the card's price, so the cohort agrees.
  function () {
    const x = cc(run([page(WITH_BUCKET_SPREAD)]));
    const o = x.results.filter(function (r) { return r.cohort === 'livein:Other'; })[0];
    return [o.agrees, o.erp_prices.length];
  },
  [true, 4]);

check('two enabled default configs for one nationality are reported as a conflict',
  function () {
    const rows = AGREEING.concat([cfg('Cameroonian', 'LONG_TERM', 'NORMAL_LONG_TERM', 3129, { id: 19 }),
                                 cfg('Cameroonian', 'LONG_TERM', 'NORMAL_LONG_TERM', 2100, { id: 79057 })]);
    const x = cc(run([page(rows)]));
    return x.duplicate_default_configs.filter(function (c) { return c.nationality === 'Cameroonian'; }).length;
  },
  1);

// === the card's current window ============================================
check('the CURRENT window is the latest-start one, not the one covering today',
  // The card's trailing windows carry =TODAY() end dates; picking by coverage
  // would break the moment the sheet is recalculated on a different day.
  function () {
    const x = cc(run([page(AGREEING)]));
    const f = x.results.filter(function (r) { return r.cohort === 'livein:Filipina'; })[0];
    return [f.card_window_start, f.card_price];
  },
  ['9/15/2025', 4714.5]);

console.log(failures.length ? failures.join('\n\n') + '\n' : '');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
