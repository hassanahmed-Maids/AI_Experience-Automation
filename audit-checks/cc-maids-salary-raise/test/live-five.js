'use strict';
/**
 * Phase 6, step 2 — LIVE, SMALL.
 *
 * Assembles the five spec test maids from real ERP reads and runs the deterministic scorer over
 * them, then checks the result against what the spec says each case should do.
 *
 * OUTPUT HYGIENE. This prints verdicts, rule attributions, counts and booleans. It prints NO
 * salary, no allowance, no delta, no name and no contact detail. Per-maid figures are written to
 * work/ (gitignored) — that file is the case store stand-in, and it is where amounts belong.
 * Where a figure has to be checked, it is checked HERE in code and reported as pass/fail.
 *
 * Pacing 2.0 s serial. ~7 calls per maid worst case.
 */
const fs = require('fs');
const path = require('path');
const { call, sleep, assertTokenLive } = require('../lib/erp');
const S = require('../lib/scorer');

// Audited month, overridable: `node test/live-five.js "Jun 2026"`.
const AUDITED_MONTH = process.argv[2] || 'Jul 2026';
const MONTH_END = (function () {
  const k = require('../lib/scorer').monthKey(AUDITED_MONTH);
  const [y, m] = k.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();
})();
const PC = {
  profile: 'HousemaidDetails',
  rule: 'HousemaidsPayrollList',
  history: 'HousemaidsPayrollList',                // NOT HousemaidsPayrollHistory — see docs
  docs: 'HousemaidDocuments',
  complaints: 'HousemaidComplaints'
};

// The five, with what the spec says each should do. Deterministically all five are expected to
// ROUTE (the approved base is prose, so only the verifier can settle them); the final column is
// the verdict the verifier is expected to reach.
const FIVE = [
  { id: 3978,  det: 'candidate', final: 'finding', via: 'verifier ❼', note: '96 complaints, zero raise To-dos' },
  { id: 44770, det: 'candidate', final: 'clean',   via: 'verifier ❽', note: 'To-do 228006 approves a non-standard base' },
  { id: 65604, det: 'candidate', final: 'clean',   via: 'verifier ❽', note: 'approved base misread as final during rebuild' },
  { id: 10907, det: 'candidate', final: 'pending', via: 'verifier ❾', note: 'three raise To-dos, none reconciles' },
  { id: 11964, det: 'candidate', final: 'finding', via: 'verifier ❹', note: 'a third renewal raise beyond a cap of two' }
];

async function sweepComplaints(id) {
  // The evidence sweep MUST reconcile: the list defaults to size=20 and maid 3978 has 96, so
  // reading page 0 and concluding "no approval exists" is a false absence in the direction that
  // condemns. Walk to totalElements and assert.
  const seen = new Set();
  let total = null, page = 0, pages = 0;
  while (page < 30) {
    const r = await call('GET', '/complaints/complaint/limited/housemaid/' + id + '?page=' + page + '&size=20', PC.complaints);
    pages++;
    if (r.status !== 200 || !r.body) return { reconciled: false, pulled: seen.size, total_elements: total, pages, http: r.status };
    if (total === null) total = r.body.totalElements;
    const content = r.body.content || [];
    for (const c of content) seen.add(c.id);
    if (content.length === 0 || seen.size >= total) break;
    page++;
    await sleep();
  }
  return { reconciled: total !== null && seen.size === total, pulled: seen.size, total_elements: total, pages };
}

(async () => {
  const t = assertTokenLive();
  console.log('token: user claim present=' + Boolean(t.user) + ', exp ' + t.exp);
  console.log('audited month: ' + AUDITED_MONTH + '\n');

  const rulingsCk = S.rulingsChecksum(S.RULINGS);
  console.log('rulings checksum asserted before scoring: ' + rulingsCk + '\n');

  const store = [];
  let calls = 0;
  let detOk = 0, detBad = 0;

  for (const tc of FIVE) {
    const id = tc.id;

    const prof = await call('GET', '/staffmgmt/housemaid/getHousemaidInfo/' + id, PC.profile); calls++; await sleep();
    const rule = await call('GET', '/payroll/salaryrules/getruleofhousemaid/' + id, PC.rule); calls++; await sleep();
    const hist = await call('GET', '/payroll/HousemaidPayroll/' + id + '/getHistoryLog?monthsCount=18', PC.history); calls++; await sleep();
    const docs = await call('GET', '/visa/renewRequest/housemaidProfile/documents/' + id, PC.docs); calls++; await sleep();
    const sweep = await sweepComplaints(id); calls += sweep.pages; await sleep();

    const p = prof.body || {};
    const noRule = rule.status === 400 && /No Rule is found/i.test(JSON.stringify(rule.body || {}));

    const maid = {
      maid_id: id,
      payroll_month: AUDITED_MONTH,
      month_end_iso: MONTH_END,
      // filterHousemaids is the ONLY place the CC/MV distinction is available; the profile's
      // housemaidType reads 'Freedom Operator'/'Normal', which is a recruitment channel. These
      // five are known CC from the spec, so the population type is asserted rather than read.
      payroll_type: 'MAID_CC',
      nationality: p.nationality || null,
      live_out: (p.liveOut === true || p.liveOut === false) ? p.liveOut : null,
      salary_rule_details: Array.isArray(rule.body) ? rule.body : null,
      salary_rule_no_rule_found: noRule,
      salary_rule_conflict: false,
      renew_requests: Array.isArray(docs.body) ? docs.body : [],
      renew_requests_unreadable: docs.status !== 200,
      payroll_history: Array.isArray(hist.body) ? hist.body : [],
      evidence_sweep: sweep
    };

    let det;
    try { det = S.scoreMaid(maid); }
    catch (e) { det = { verdict: 'THREW', settled_by: '-', reason: e.message, trace: [], gaps: [] }; }

    const match = det.verdict === tc.det;
    if (match) detOk++; else detBad++;

    // ---- console: verdicts, rules, counts, booleans. NO amounts. ----
    console.log((match ? '  ✓ ' : '  ✗ ') + 'maid ' + id);
    console.log('      nationality tag renewal_raise present : ' +
                (S.readRenewalRaise((maid.nationality || {}).tags) !== null));
    console.log('      living status readable                : ' + (maid.live_out !== null) +
                (maid.live_out !== null ? '  (live_out=' + maid.live_out + ')' : ''));
    console.log('      salary rule components read           : ' +
                (maid.salary_rule_details ? maid.salary_rule_details.length : 0) +
                (noRule ? '  [No Rule is found!]' : ''));
    console.log('      payroll rows read                     : ' + maid.payroll_history.length +
                '   audited month present: ' +
                (S.readPaidForMonth(maid.payroll_history, AUDITED_MONTH).paid !== null));
    console.log('      renew requests read                   : ' + maid.renew_requests.length +
                '   qualifying renewals: ' + det.renewals_counted);
    console.log('      evidence sweep reconciled             : ' + sweep.reconciled +
                '  (' + sweep.pulled + '/' + sweep.total_elements + ' over ' + sweep.pages + ' page(s))');
    console.log('      paid ABOVE her allowance              : ' +
                (typeof det.paid_vs_allowed === 'number' ? det.paid_vs_allowed > 0 : 'n/a'));
    console.log('      capped out on renewal raises          : ' + Boolean(det.capped_out));
    console.log('      deterministic verdict                 : ' + det.verdict +
                '  (' + det.settled_by + ')   expected ' + tc.det);
    if (det.gaps && det.gaps.length) console.log('      gaps                                  : ' + det.gaps.length +
                ' (' + (det.gaps_blocking || []).length + ' blocking)');
    console.log('      then expected via ' + tc.via + ' -> ' + tc.final + '   [' + tc.note + ']');
    console.log('');

    // ---- case store: the amounts live HERE, not in chat or logs ----
    store.push({
      case_key: det.case_key, maid_id: id, payroll_month: AUDITED_MONTH,
      verdict: det.verdict, settled_by: det.settled_by, reason: det.reason,
      base: det.base, allowed: det.allowed, paid_vs_allowed: det.paid_vs_allowed,
      renewals_counted: det.renewals_counted, capped_out: det.capped_out,
      recurring_addition: det.recurring_addition,
      evidence_sweep: sweep, gaps: det.gaps, gaps_blocking: det.gaps_blocking,
      trace: det.trace,
      expected_det: tc.det, expected_final: tc.final, expected_via: tc.via
    });
  }

  const dir = path.resolve(__dirname, '../../../work/cc-maids-salary-raise');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'live-five-' + AUDITED_MONTH.replace(' ', '-') + '.json');
  fs.writeFileSync(out, JSON.stringify({ audited_month: AUDITED_MONTH, rulings_checksum: rulingsCk,
                                         generated_at: new Date().toISOString(), cases: store }, null, 2));

  console.log('='.repeat(78));
  console.log('  deterministic stage: ' + detOk + ' of ' + FIVE.length + ' as the spec expects' +
              (detBad ? '  (' + detBad + ' MISMATCH)' : ''));
  console.log('  ERP calls made: ' + calls);
  console.log('  per-maid figures written to work/ (gitignored) — not to this console');
  console.log('='.repeat(78));
})();
