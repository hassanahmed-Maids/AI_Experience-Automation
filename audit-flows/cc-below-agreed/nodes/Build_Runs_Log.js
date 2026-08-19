// Build Runs Log - the DURABLE record of the run, built and posted BEFORE any
// display target.
//
// Same rule as the sibling: the spec declares two targets - the Security Room
// portal and the runs log - and orders the durable write FIRST, so a failing
// display callback cannot cost the run its record. This node sits on its own
// branch and runs ahead of Build Case Payload.
//
// OPEN ITEM, DELIBERATELY NOT GUESSED (cloned verbatim from the sibling): the
// runs-log endpoint is not documented anywhere I can read, and inventing a URL
// would either 404 in silence or POST audit data to a guessed host. So:
//   * if the caller supplies params.runs_log_url, it is validated against the
//     SAME origin allowlist the results callback uses and posted to;
//   * if it does not, the run continues and the results payload says
//     runs_log: "not_configured" - visible in the portal rather than silently
//     absent.
// Never post the run record anywhere the results callback would not be allowed
// to go.
//
// THE ONE THING THIS RECORD MUST NEVER SAY IS "FINDINGS". This check's scorer
// cannot produce one: currentPayment.amountValue is the CONTRACTUAL rate and is
// not reliably what was billed (measured 4,715 / 4,715 / 5,712 stored against
// 2,100 / 2,100 / 3,360 actually billed and paid, and BOTH numbers were sent to
// the same client in writing). Every red from Compute Case States is a
// PROVISIONAL CANDIDATE carrying requires_verifier: true. The vocabulary in this
// record is therefore candidates / inconclusive / in flight / paid in full, and
// the word "finding" appears only where the verifier has filled finding_reason.
const validated = $('Validate Inputs').first().json;
const WINDOWS = validated.persistence_windows || [];

// Cases normally arrive on this node's own input (the scorer emits one item
// holding the whole array). The fallback reads the scorer BY NODE NAME because a
// re-wire that drops an intermediate node must not silently produce a run record
// with zero cases - which would look exactly like a clean month.
const input = $input.first().json || {};
let cases = Array.isArray(input.cases) ? input.cases : [];
if (!cases.length) {
  try {
    const scored = $('Compute Case States').first().json;
    if (scored && Array.isArray(scored.cases)) cases = scored.cases;
  } catch (e) { /* the scorer is upstream of this node on every wiring; ignore */ }
}

const gate2 = (function () {
  try { return $('Verify Bulk Pulls').first().json._gate2 || {}; } catch (e) { return {}; }
})();

// THE SIBLING'S COHORT READ DOES NOT TRANSFER. It does
// `$('Build Cohort').first().json` and reads .cohort / .from_both off it - but
// Build Cohort returns ONE ITEM PER CONTRACT and logs its stats to the console
// only, so first().json is a contract row and every cohort figure there lands as
// null. (That is a latent bug in the sibling's own record, not a difference in
// this check.) The counts below are re-derived from the items themselves, which
// is the only source that cannot go stale.
const cohortItems = (function () {
  try { return $('Build Cohort').all().map(function (i) { return i.json || {}; }); } catch (e) { return []; }
})();
function sourcesOf(c) { return Array.isArray(c.sources) ? c.sources : []; }
const cohortStats = {
  contracts: cohortItems.length,
  from_population_only: cohortItems.filter(function (c) {
    return sourcesOf(c).length === 1 && sourcesOf(c)[0] === 'population_route'; }).length,
  from_payment_stub_only: cohortItems.filter(function (c) {
    return sourcesOf(c).length === 1 && sourcesOf(c)[0] === 'payment_stub'; }).length,
  from_both: cohortItems.filter(function (c) { return sourcesOf(c).length === 2; }).length,
  maidless_kept: cohortItems.filter(function (c) { return !c.maid_id; }).length,
  live_out_unknown: cohortItems.filter(function (c) { return c.maid_live_out === null; }).length
};

// ---------------------------------------------- was the cohort capped, and how
// Build Cohort stamps pipeline_test / cohort_cap / cohort_before_cap onto every
// case. Read from the ITEMS, not from a console log: on run 90669 the cap had no
// observable effect anywhere a reader could reach, because the only record of it
// was a console line inside an execution too large to retrieve.
const capFacts = (function () {
  const first = cohortItems[0] || {};
  const capped = first.pipeline_test === true;
  return {
    pipeline_test: capped,
    cohort_cap: first.cohort_cap === undefined ? null : first.cohort_cap,
    cohort_before_cap: first.cohort_before_cap === undefined ? null : first.cohort_before_cap,
    coverage: (capped && first.cohort_before_cap)
      ? Math.round(cohortItems.length / Number(first.cohort_before_cap) * 1000) / 10 + '% of the eligible cohort'
      : '100% of the eligible cohort'
  };
})();

// ------------------------------------------------------- FOOTPRINT SELF-REPORT
// The run measures its own retained data and puts the number in its own output.
//
// WHY THIS EXISTS: executions 89604 and 90669 both grew past the point where the
// REST API can serve their data - above roughly 10 MB n8n returns the record in
// flatted form and a single-node fetch fails - so the ONE number needed to size
// the memory problem was unreadable precisely when it mattered. Three crashes and
// two long runs were spent inferring it. A diagnosis that depends on retrieving
// the execution record fails exactly when the execution is in trouble, so the run
// reports its own footprint instead.
//
// ESTIMATED, NOT EXACT, AND DELIBERATELY SO: JSON.stringify over the sweeps would
// allocate tens of megabytes inside a node whose whole purpose is to warn about
// memory. Row counts are exact; per-row size is sampled from the first row. Good
// to a few percent and costs nothing.
function estimate(nodeName, rowsOf) {
  try {
    const items = $(nodeName).all();
    let rows = 0, sampleRow = 0;
    for (const it of items) {
      const arr = rowsOf(it.json || {});
      const list = Array.isArray(arr) ? arr : [];
      rows += list.length;
      if (!sampleRow && list.length) { try { sampleRow = JSON.stringify(list[0]).length; } catch (e) { sampleRow = 0; } }
    }
    return { items: items.length, rows: rows, sample_row_bytes: sampleRow,
      est_bytes: rows * sampleRow + items.length * 200 };
  } catch (e) { return { items: 0, rows: 0, sample_row_bytes: 0, est_bytes: 0, note: 'did not execute' }; }
}
// Per-contract enrichment: one whole payload per item, so size the item itself.
function estimateItems(nodeName) {
  try {
    const items = $(nodeName).all();
    let sample = 0;
    if (items.length) { try { sample = JSON.stringify(items[0].json).length; } catch (e) { sample = 0; } }
    return { items: items.length, sample_item_bytes: sample, est_bytes: items.length * sample };
  } catch (e) { return { items: 0, sample_item_bytes: 0, est_bytes: 0, note: 'did not execute' }; }
}
const fp = {
  population: estimate('Get CC Contract Population', function (j) {
    return j && j.body !== undefined ? j.body : j; }),
  payments_m: estimate('Get Month Payments', function (j) { return j.payments; }),
  payments_m1: estimate('Get Payments (M-1)', function (j) { return j.payments; }),
  payments_m2: estimate('Get Payments (M-2)', function (j) { return j.payments; }),
  payment_statuses: estimate('Get Payment Statuses', function (j) { return j.content; }),
  contract_plan: estimateItems('Get Contract Plan'),
  replacements: estimateItems('Get Replacements'),
  messages_whatsapp: estimateItems('Get Messages (WhatsApp)'),
  messages_sms: estimateItems('Get Messages (SMS)')
};
let fpTotal = 0;
for (const k of Object.keys(fp)) { fpTotal += Number(fp[k].est_bytes) || 0; }
const footprint = {
  by_node: fp,
  est_total_bytes: fpTotal,
  est_total_mb: Math.round(fpTotal / 1048576 * 10) / 10,
  healthy_reference_mb: '44 - 61',
  kill_band_mb: '100.6 - 142.6',
  verdict: fpTotal / 1048576 > 100 ? 'IN THE KILL BAND - this run was lucky to finish; reduce retention before the next one'
    : (fpTotal / 1048576 > 61 ? 'ABOVE the healthy reference band - reduce retention'
    : 'inside the healthy reference band'),
  method: 'exact row counts, per-row size sampled from the first row. Estimated on purpose: ' +
    'stringifying the sweeps to measure them would allocate the very megabytes being warned about.',
  note: 'the sweeps are retained by their HTTP nodes for the life of the execution regardless of what ' +
    'any downstream node does with them, so a downstream filter reduces what is USED and not what is ' +
    'HELD. Only fetching less - or fetching inside a Code node that returns reduced rows - reduces this.'
};

const CALLBACK_ORIGIN_ALLOWLIST = [
  'https://security-room-n8n-callback-proxy.hassan-ahmed-e4c.workers.dev',
  'https://nnbyjbdbigcpoqtsczlz.supabase.co'
];

function splitHttpsUrl(raw) {
  const str = String(raw || '');
  if (/[^\x21-\x7e]/.test(str)) return null;
  if (str.indexOf('\\') !== -1) return null;
  const m = /^(https:\/\/[^/?#@]+)(\/[^?#]*)$/.exec(str);
  if (!m) return null;
  if (m[2].indexOf('..') !== -1) return null;
  return { origin: m[1], path: m[2] };
}

const params = validated.params || {};
const requested = String(params.runs_log_url || '');
let runsLogUrl = '', runsLogState = 'not_configured';
if (requested) {
  const parsed = splitHttpsUrl(requested);
  if (parsed && CALLBACK_ORIGIN_ALLOWLIST.indexOf(parsed.origin) !== -1) {
    runsLogUrl = requested;
    runsLogState = 'configured';
  } else {
    // A runs-log URL outside the allowlist is refused, not silently ignored:
    // somebody asked this workflow to courier the run record somewhere new.
    runsLogState = 'rejected_not_allowlisted';
  }
}

function s(v) { return v === null || v === undefined ? '' : String(v); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// ---------------------------------------------------------------- the banding
// ONE classification, defined here and stamped onto every case as
// `display_band`, so the portal report, the Cases tab and this record cannot
// drift apart. Build Case Payload and Build Sheet Rows prefer the stamped value
// and only recompute if this node did not run.
//
//   not_in_scope  nothing arrived at all -> that is the SIBLING check's finding
//   inconclusive  the money question cannot be answered from what we can read:
//                 expected unknown, the scorer fell through, the quoted amount
//                 could not be resolved, or a green that still needs a human
//                 (unrecognised refund, unknown coverage). "Can't tell".
//   in_flight     PRE_PDP / PDC would cover the gap
//   paid_in_full  inside the AED 5.00 tolerance, overpaid, or not owed
//   candidate     short against the contract rate - PROVISIONAL, never a finding
function bandOf(c) {
  if (c.skip_computation === true) return 'carried';
  if (c.reason_code === 'out_of_scope_nothing_received') return 'not_in_scope';
  const cm = c.computed || {};
  const q = c.quoted || null;
  const quotedUnresolved = !!q && (q.no_quote_found === true || q.read_failed === true);
  if (cm.expected_known === false || c.reason_code === 'unscored' || quotedUnresolved) return 'inconclusive';
  if (c.new_state === 'pending_flag') return 'in_flight';
  if (c.new_state === 'green_flag' || c.new_state === 'green_flag_manual') {
    return c.requires_verifier === true ? 'inconclusive' : 'paid_in_full';
  }
  return 'candidate';
}
for (const c of cases) { c.display_band = bandOf(c); }

const scored = cases.filter(function (k) { return !k.skip_computation; });
const bands = {};
for (const c of cases) { bands[c.display_band] = (bands[c.display_band] || 0) + 1; }
function band(name) { return Number(bands[name]) || 0; }

function reasonTally(list) {
  const out = {};
  for (const k of list) { const code = k.reason_code || 'unknown'; out[code] = (out[code] || 0) + 1; }
  return out;
}

// Candidate money. Only cases with a READABLE expectation contribute - an
// unknown expectation has no verified shortfall, and adding it as zero would
// understate the exposure while looking precise.
const candidates = cases.filter(function (k) { return k.display_band === 'candidate'; });
const candidateAed = n2(candidates.reduce(function (t, k) {
  const cm = k.computed || {};
  return t + (cm.expected_known === false ? 0 : (Number(cm.shortfall) || 0));
}, 0));

// STALENESS IS A FIRST-CLASS RUN FACT, not a footnote. The quoted-amount lookup
// is a BAKED snapshot of the template store (this n8n instance has no Snowflake
// credential and smsContent is empty on every WhatsApp row), so a stale bake
// silently turns candidates into inconclusive cases instead of failing. Both the
// pull date and the count of templates the resolver could not recognise are
// carried here so a reader can see the bake ageing.
const quotedCases = cases.filter(function (k) { return !!k.quoted; });
const lookupPulledOn = quotedCases.length ? s(quotedCases[0].quoted.lookup_pulled_on) : '';
const templatesKnown = quotedCases.length ? (Number(quotedCases[0].quoted.templates_known) || 0) : 0;
const unknownTemplateNames = {};
for (const k of quotedCases) {
  const fams = Array.isArray(k.quoted.families_seen) ? k.quoted.families_seen : [];
  for (const f of fams) { if (f === 'unknown') unknownTemplateNames[f] = 1; }
}
const quotedReadFailed = quotedCases.filter(function (k) { return k.quoted.read_failed === true; }).length;
const quotedNoQuote = quotedCases.filter(function (k) { return k.quoted.no_quote_found === true; }).length;
// The resolver logs its own unknown-template map to the console; what survives
// onto the case is whether a quote was resolvable at all. Both are reported, and
// the count below is the one the Run Summary tab shows.
const unknownTemplateCount = quotedNoQuote + Object.keys(unknownTemplateNames).length;

// SENSITIVE DATA. Company policy: individual figures, phone numbers and message
// bodies never appear in a run summary - counts, flags and totals only, with
// per-case detail kept behind the case. This record therefore carries NO client
// names, NO contract ids and NO per-case amounts. The quoted amounts this check
// reads come out of the client message log, which makes the rule tighter here
// than on the sibling, not looser: not one quoted figure and not one template
// body may appear below.
const record = {
  check: 'CC Monthly Payments Below Agreed Amount',
  spec_version: 'v1 (DRAFT)',
  flow_version: 'generated v1 (DRAFT)',
  check_id: validated.check_id,
  run_id: validated.run_id,
  audit_month: validated.audit_month,
  window: { from: validated.range_start, to: validated.range_end },
  triggered: 'manual',
  started_from: 'security_room_webhook',

  // A CAPPED RUN SAYS SO IN ITS OWN FIRST FIELDS. It writes into the same sheet as
  // a real audit, so a reader must not have to infer coverage from a count.
  pipeline_test: capFacts.pipeline_test,
  publishable: !capFacts.pipeline_test,
  coverage: capFacts.coverage,
  cohort_cap: capFacts.cohort_cap,
  cohort_before_cap: capFacts.cohort_before_cap,

  footprint: footprint,

  // The three persistence windows. Gate 18 (Order 128) is what makes this check
  // survivable without freeze data - ERP stores no freeze date anywhere - so
  // which three months were actually read is part of the record, not a detail.
  persistence_windows: WINDOWS.map(function (w) {
    return { key: w.key, from: w.from, to: w.to, node: w.node };
  }),
  persistence_note: 'a wrong rate persists across months, a light month does not. Measured Jun-Aug ' +
    '2026: a single-month test flags 17 frozen contracts, the three-month test cuts it to 2 (88% ' +
    'fewer) using no freeze field at all.',

  cohort: {
    contracts: cohortStats.contracts,
    from_population_only: cohortStats.from_population_only,
    from_payment_stub_only: cohortStats.from_payment_stub_only,
    from_both: cohortStats.from_both,
    maidless_kept: cohortStats.maidless_kept,
    live_out_unknown: cohortStats.live_out_unknown,
    pipeline_test: capFacts.pipeline_test,
    cohort_cap: capFacts.cohort_cap,
    cohort_before_cap: capFacts.cohort_before_cap,
    note: 'the population route returns only contracts ACTIVE NOW, so contracts that terminated inside ' +
      'the audited month arrive solely from the payment rows\' contract stub. A 40-row sample ran 23 ' +
      'CANCELLED to 17 ACTIVE - the hidden half is mostly cancelled contracts.'
  },

  completeness: {
    population_rows: gate2.population_rows === undefined ? null : gate2.population_rows,
    population_pages: gate2.population_pages === undefined ? null : gate2.population_pages,
    // The floor is an INDEPENDENT guard, never lowered to match a run. Measured
    // 5,202 contracts on 2026-08-13; the floor sits at 4,600. A caller may raise
    // it and may not lower it (enforced in Verify Bulk Pulls).
    population_floor: gate2.population_floor === undefined ? null : gate2.population_floor,
    population_reconciled: gate2.population_reconciled === undefined ? null : gate2.population_reconciled,
    population_note: gate2.population_note ||
      'the dynamic population route applies .getContent() and strips totalElements and totalPages, so ' +
      'there is nothing to reconcile against - completeness rests on the short-page terminator plus ' +
      'the floor. Declared unreconciled, not assumed complete.',
    payment_rows_per_window: gate2.payment_rows_per_window || null,
    status_rows: gate2.status_rows === undefined ? null : gate2.status_rows,
    status_pages: gate2.status_pages === undefined ? null : gate2.status_pages,
    status_sweep_reconciled: gate2.status_sweep_reconciled === undefined ? null : gate2.status_sweep_reconciled,
    status_sweep_note: gate2.status_sweep_note ||
      'advancesearch returns no top-level total and its nested totalElements caps at 40, so a short ' +
      'walk passes in silence. Declared unreconciled and terminated on a short page.',
    // BOTH SWEEPS ARE UNRECONCILED, AND THAT IS SAID OUT LOUD. Neither endpoint
    // exposes a countable total, so neither can be proven complete from its own
    // response - the guards are a terminator and a floor, which is a mitigation
    // and not a reconciliation. Gate 2 stays Pending Technical until the ERP team
    // makes the population route countable (owner: Hassan).
    both_sweeps_reconciled: false
  },

  results: {
    cases: cases.length,
    scored: scored.length,
    carried: cases.length - scored.length,
    // CANDIDATES, NOT FINDINGS. Nothing in this block may be read as a finding:
    // finding_reason is the verifier's to fill, and it is empty on everything the
    // scorer emits.
    candidates_provisional: band('candidate'),
    inconclusive_cant_tell: band('inconclusive'),
    in_flight: band('in_flight'),
    paid_in_full_or_not_owed: band('paid_in_full'),
    out_of_scope_nothing_received: band('not_in_scope'),
    requires_verifier: cases.filter(function (k) { return k.requires_verifier === true; }).length,
    reason_codes: reasonTally(scored),
    total_candidate_shortfall_aed: candidateAed,
    // Verifier outcomes, present only on runs where the verdicts were merged back
    // in before this node. Empty is "not yet verified", never "nothing found".
    finding_reasons: cases.reduce(function (a, k) {
      const fr = s(k.finding_reason);
      if (fr) a[fr] = (a[fr] || 0) + 1;
      return a;
    }, {})
  },

  // Evidence-quality counters. These are the run facts that decide how much of
  // the candidate list is even answerable.
  evidence: {
    template_lookup_pulled_on: lookupPulledOn,
    templates_in_lookup: templatesKnown,
    unknown_or_unresolved_templates: unknownTemplateCount,
    candidates_with_no_quote_found: quotedNoQuote,
    candidates_with_message_read_failure: quotedReadFailed,
    staleness_note: 'the quoted-amount lookup is a BAKED snapshot of the ERP template store. A stale ' +
      'bake does not fail - it silently makes cases inconclusive, which is why the pull date and the ' +
      'unknown-template count are reported on every run.',
    // Gate 4 as written would double-credit the discount, so the code does not
    // subtract it and flags the disagreement on the case. How many cases carry
    // that flag is a run fact the owner has to rule on.
    gate4_departure_cases: cases.filter(function (k) {
      return !!(k.metadata && k.metadata.gate4_departure);
    }).length,
    // PAYMENT_ITEM_DISCOUNT lives in Snowflake and this n8n instance has no
    // Snowflake credential, so it is recorded UNAVAILABLE, never zero.
    snowflake_item_discount_unavailable_cases: cases.filter(function (k) {
      return /^UNAVAILABLE/.test(s(k.metadata && k.metadata.snowflake_item_discount));
    }).length
  },

  // RUN 1 IS BIG BY DESIGN, and the record has to say so or the first reader will
  // treat the candidate count as an incident.
  run1_expectation: 'Run 1 is EXPECTED to be large: 108 contracts are stably under-billed at roughly ' +
    'AED 64,000 a month, and the 2025 exception register clears NONE of them - the owner ruled on ' +
    '2026-08-13 that run 1 starts from a CLEAN SLATE, because 100 of the register\'s 311 rows have no ' +
    'approver, no owner and no expiry. Gate 125 is therefore INERT on this run, and run 1\'s reviewed ' +
    'output becomes the register that runs 2+ clear against.',
  residue_bounds: 'Of the ~984 measured July 2026 shortfalls, the residue that survives every gate is ' +
    'bounded at roughly 1 (strict reading) to ~40 (lenient reading). ~984 is a CANDIDATE count and must ' +
    'never be reported as findings.',

  caveats: [
    'THE SCORER CANNOT PRODUCE A FINDING. currentPayment.amountValue is the contractual rate and is ' +
    'NOT reliably what was billed - measured 4,715/4,715/5,712 stored against 2,100/2,100/3,360 billed ' +
    'and paid, both sent to the same client in writing days apart. Every red is a provisional candidate.',
    'The two finding reasons stay SEPARATE: Underpaid (the client paid less than we asked) and ' +
    'Under-billed (we asked less than the contract says). Same money, different teams. Only the quoted ' +
    'amount can tell them apart, so finding_reason is the verifier\'s field, never the scorer\'s.',
    'Tolerance is AED 5.00 ABSOLUTE and never a percentage. VAT-inclusive throughout: agreed x 1.05 ' +
    'matches 0 of 5,612 contracts, so VAT is never added.',
    'Gate 60 (freeze) CANNOT clear anything: ERP stores no freeze date, and a currently-frozen test was ' +
    'a proven 4-of-4 false positive on the largest July shortfalls. Persistence is the mitigation.',
    'Gate 4 as written double-credits the discount; the code does not subtract it and flags ' +
    'gate4_departure on the case for a ruling. Snowflake PAYMENT_ITEM_DISCOUNT is unavailable, not zero.',
    'Gate 13\'s rule text still says a 0.50 tolerance; the settled value is 5.00 (2026-08-13). The rule ' +
    'row needs correcting - the stale constant is neither honoured nor silently dropped.',
    'Neither the population sweep nor the payment-status sweep can be reconciled against a declared ' +
    'total, so both are declared unreconciled. Gate 2 is Pending Technical.',
    'Verdict display names (Underpaid / Under-billed / Paid in full-not owed / In flight / Can\'t tell) ' +
    'are still PROPOSED and not signed off by the owner.'
  ],
  completed_at: new Date().toISOString()
};

if (capFacts.pipeline_test) {
  record.caveats.unshift('PIPELINE TEST - NOT AN AUDIT. The cohort was capped at ' + capFacts.cohort_cap +
    ' of ' + capFacts.cohort_before_cap + ' eligible contract-months (' + capFacts.coverage + '). ' +
    'Coverage is incomplete BY DESIGN and no count, total or candidate list from this run is publishable.');
}

console.log(JSON.stringify({ stage: 'runs_log', state: runsLogState,
  pipeline_test: capFacts.pipeline_test, footprint_mb: footprint.est_total_mb, record: record }));

// A Code node in "run once for all items" mode MUST return.
return [{ json: {
  runs_log_url: runsLogUrl,
  runs_log_state: runsLogState,
  post_runs_log: runsLogState === 'configured',
  check_id: validated.check_id,
  run_id: validated.run_id,
  callback_url: validated.callback_url,
  record: record,
  cases: cases
} }];
