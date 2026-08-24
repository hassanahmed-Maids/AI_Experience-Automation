/**
 * verdict_test.js - a run that could not LOOK must never report a pass.
 *
 * WHY THIS FILE EXISTS. Execution 100409 (2026-08-24) reported overall 'pass', result 'pass',
 * findings 0 - with 399 of 399 applicants erp_unreachable. It had not read a single applicant's
 * tickets. `overall` was computed from findings alone, and a check that COULD NOT LOOK produces
 * the same zero as a check that looked and found nothing.
 *
 * The fixtures below are the three states that must stay distinguishable.
 *   node tools/offline/verdict_test.js
 */
const V = (findings, unreachable) => {
  const evidenceComplete = unreachable === 0;
  return {
    overall: findings > 0 ? 'fail' : (evidenceComplete ? 'pass' : 'incomplete'),
    result:  findings > 0 ? 'fail' : (evidenceComplete ? 'pass' : 'error'),
    evidence_complete: evidenceComplete,
  };
};

let pass = 0, fail = 0;
const ok = (c, label, detail) => c ? (pass++, console.log('ok   ' + label))
                                   : (fail++, console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')));

// 1. THE REAL SHAPE OF 100409 - the case that produced the false clean.
const r = V(0, 399);
ok(r.overall !== 'pass', '399 of 399 unreachable is NOT a pass', JSON.stringify(r));
ok(r.overall === 'incomplete', 'it is reported as incomplete', JSON.stringify(r));
ok(r.result === 'error', 'and the PORTAL is told error, so it cannot record a clean month', r.result);
ok(r.evidence_complete === false, 'evidence_complete is false', String(r.evidence_complete));

// 2. A genuinely clean month.
const c = V(0, 0);
ok(c.overall === 'pass' && c.result === 'pass' && c.evidence_complete === true,
   'zero findings with everything readable is still a pass - the fix must not cry wolf',
   JSON.stringify(c));

// 3. A real finding.
const f = V(3, 0);
ok(f.overall === 'fail' && f.result === 'fail', 'findings on a complete run fail', JSON.stringify(f));

// 4. A real finding on a PARTIAL run. The finding is real and must still be reported as a fail -
//    withholding it because the run was partial would bury a confirmed loss. But completeness is
//    still reported separately, so nobody reads 'fail' as 'we checked everything'.
const fp = V(3, 12);
ok(fp.overall === 'fail', 'a finding on a partial run is still a fail', JSON.stringify(fp));
ok(fp.evidence_complete === false,
   'and the partiality is still visible next to it', JSON.stringify(fp));

// 5. ONE unreachable entity is enough. Gate 2 aborts on a single missing population row; the
//    evidence layer holds the same line rather than picking a tolerance out of the air.
const one = V(0, 1);
ok(one.overall === 'incomplete', 'a single unreadable entity is enough to withhold a pass',
   JSON.stringify(one));

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
