// Read Population Request (WF-Pop) - take the bearer and the mode, and refuse to sweep
// without either.
//
// WHY THIS WORKFLOW EXISTS, and the memory case for it is WEAK - say so plainly rather
// than let the pattern imply otherwise. Measured 2026-08-19 on a real page: population
// rows are 904 B/row MINIFIED, so the active sweep is 4.66 MB, and the projection below
// takes it to ~351 B/row = 1.81 MB. That is ~2.85 MB against a tail that peaks near
// 98 MB. As a memory fix it is noise. An earlier 9.2 MB figure for this sweep was
// computed from a pretty-printed probe file and was ~2x high.
//
// THE REAL REASON IS THE SALARY FIELD. Every row of contract/search/page carries
// workerSalaryMonthlyTip - the HOUSEMAID'S SALARY - and nothing in this check reads it.
// Unstaged, it sits in WF-A's retained rows for the whole run AND in the stored execution
// record, where anyone with project access can read ~6,350 salaries at leisure. The
// projection drops it, with six other unread fields.
//
// BOTH POPULATION WALKS GO THROUGH HERE, which is the whole point: WF-A pulled the ACTIVE
// book (Get CC Contract Population, ~5,405 rows) and the contracts TERMINATED in the
// window (Get Terminated Contracts, ~949) from the SAME route with the same DTO. Staging
// only the active one would have left 949 salaries in the execution record and called the
// job done. One sub-workflow, two modes, exact per-mode request parameters preserved
// downstream.
const incoming = $input.first().json || {};
const bearer = incoming.bearer || '';
const mode = String(incoming.mode === null || incoming.mode === undefined ? '' : incoming.mode);
const rangeStart = incoming.range_start || '';

if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('WF-Pop: no usable bearer was passed in. Every page would 401 and the sweep would ' +
    'return zero rows - which gate 2 reads as a cohort bug, but only after the run has spent ' +
    'sixteen minutes getting there. Refusing now.');
}
if (mode !== 'active' && mode !== 'terminated') {
  throw new Error('WF-Pop: mode must be "active" or "terminated", got "' + mode + '". There is no ' +
    'default: the two walks use different status filters (ACTIVE vs FILTER_CANCELED) against the ' +
    'same URL, and guessing one silently substitutes a different population.');
}

// A yyyy-mm-dd test written longhand rather than as a regex, for the same reason as WF-P:
// this body is shipped into a Code node as a string and a backslash class is exactly what
// gets eaten in transit, leaving a check that passes everything.
function isYmd(v) {
  const t = String(v === null || v === undefined ? '' : v);
  if (t.length !== 10 || t[4] !== '-' || t[7] !== '-') return false;
  const digits = t.slice(0, 4) + t.slice(5, 7) + t.slice(8, 10);
  for (let i = 0; i < digits.length; i++) {
    if (digits[i] < '0' || digits[i] > '9') return false;
  }
  return true;
}
// The terminated walk filters dateOfTermination BETWEEN range_start and 2099-12-31. An
// empty range_start does not fail - ERP happily accepts " 00:00:00" and returns a
// different, wider set - so it is refused here. That set would look like a fuller
// population, which is the failure that never announces itself.
if (mode === 'terminated' && !isYmd(rangeStart)) {
  throw new Error('WF-Pop: terminated mode needs range_start as yyyy-mm-dd, got "' + rangeStart +
    '". ERP accepts a malformed date on extraFilters and answers with a DIFFERENT population ' +
    'rather than an error, so this cannot be allowed through.');
}

console.log(JSON.stringify({ stage: 'wfpop_read_request', mode: mode,
  run_id: incoming.run_id || null, range_start: mode === 'terminated' ? rangeStart : null,
  note: 'contract/search/page, pagecode ClientList, 40 rows per page (the server caps there ' +
        'however large a size you ask for); one item returned per page' }));

return [{ json: { bearer: bearer, mode: mode, range_start: rangeStart,
                  run_id: incoming.run_id || null } }];
