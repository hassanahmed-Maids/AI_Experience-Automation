'use strict';

const { tests, S } = require('./test_cases');

let pass = 0;
const failures = [];

function check(cond, msg, bag) { if (!cond) bag.push(msg); }

for (let i = 0; i < tests.length; i++) {
  const tc = tests[i];
  const errs = [];
  let out;
  try {
    out = S.scoreRun(tc.input);
  } catch (e) {
    failures.push({ name: tc.name, errs: ['THREW: ' + (e && e.stack ? e.stack.split('\n')[0] : String(e))] });
    continue;
  }
  const e = tc.expect;
  const cs = out.cases;

  if (e.noCases) {
    check(cs.length === 0, 'expected 0 cases, got ' + cs.length, errs);
    if (e.excludedCount !== undefined) {
      check(out.excluded.length === e.excludedCount,
        'expected ' + e.excludedCount + ' excluded, got ' + out.excluded.length, errs);
    }
  } else if (e.multi) {
    for (let j = 0; j < e.multi.length; j++) {
      const want = e.multi[j];
      let found = null;
      for (let k = 0; k < cs.length; k++) if (String(cs[k].txn_id) === String(want.txn)) found = cs[k];
      if (!found) { check(false, 'no case for txn ' + want.txn, errs); continue; }
      check(found.verdict === want.verdict,
        'txn ' + want.txn + ': expected ' + want.verdict + ', got ' + found.verdict, errs);
    }
  } else if (e.noneAre) {
    for (let j = 0; j < cs.length; j++) {
      check(cs[j].verdict !== e.noneAre,
        'txn ' + cs[j].txn_id + ' should not be ' + e.noneAre + ' (label ' + cs[j].verdict_label + ')', errs);
    }
  } else if (e.anyIs) {
    let hit = false;
    for (let j = 0; j < cs.length; j++) {
      if (cs[j].verdict === e.anyIs && (!e.anyLabel || cs[j].verdict_label === e.anyLabel)) hit = true;
    }
    check(hit, 'expected some case to be ' + e.anyIs + (e.anyLabel ? ' / ' + e.anyLabel : ''), errs);
  } else if (e.totalFindingAed !== undefined) {
    check(out.run.total_finding_aed === e.totalFindingAed,
      'expected total finding ' + e.totalFindingAed + ', got ' + out.run.total_finding_aed, errs);
    if (e.findingCount !== undefined) {
      check(out.run.n_findings === e.findingCount,
        'expected ' + e.findingCount + ' findings, got ' + out.run.n_findings, errs);
    }
  } else {
    // single-case expectations
    let c = cs[0];
    if (e.ownerTxn !== undefined) {
      for (let k = 0; k < cs.length; k++) if (String(cs[k].txn_id) === String(e.ownerTxn)) c = cs[k];
    }
    if (!c) { check(false, 'no case produced', errs); }
    else {
      if (e.verdict) check(c.verdict === e.verdict, 'expected verdict ' + e.verdict + ', got ' + c.verdict, errs);
      if (e.label) check(c.verdict_label === e.label, 'expected label "' + e.label + '", got "' + c.verdict_label + '"', errs);
      if (e.finding_aed !== undefined) check(c.finding_aed === e.finding_aed, 'expected finding ' + e.finding_aed + ', got ' + c.finding_aed, errs);
      if (e.fired) check(c.rules_fired.indexOf(e.fired) !== -1, 'expected rule ' + e.fired + ' to fire; fired ' + c.rules_fired.join(','), errs);
      if (e.reasonHas) {
        let hit = false;
        for (let k = 0; k < c.reasons.length; k++) if (String(c.reasons[k]).indexOf(e.reasonHas) !== -1) hit = true;
        check(hit, 'expected a reason containing "' + e.reasonHas + '"; got ' + JSON.stringify(c.reasons), errs);
      }
    }
  }

  if (errs.length === 0) pass += 1; else failures.push({ name: tc.name, errs: errs });
}

console.log('ILOE scorer — offline test results');
console.log('==================================');
console.log('passed ' + pass + ' / ' + tests.length);
if (failures.length) {
  console.log('');
  for (let i = 0; i < failures.length; i++) {
    console.log('FAIL: ' + failures[i].name);
    for (let j = 0; j < failures[i].errs.length; j++) console.log('      - ' + failures[i].errs[j]);
  }
  process.exitCode = 1;
} else {
  console.log('all green');
}
