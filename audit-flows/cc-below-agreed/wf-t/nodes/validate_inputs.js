// Validate Inputs (WF-T) - the run context, under the name the lifted bodies already read.
//
// THE NAME IS THE POINT, and it is not a trick. Compute Case States, Guards and Build Sheet
// Rows each open with $('Validate Inputs').first().json and read persistence_windows,
// audit_month, range_start/range_end, run_id and params off it. Inside WF-T this node IS the
// validated run context - the same object WF-A's Validate Inputs produced, passed in whole -
// so keeping the name let all three bodies be lifted BYTE-IDENTICAL. A renamed node would
// have meant editing 930 lines of tested scoring logic to relocate it, which is how a
// refactor changes a verdict.
//
// It re-validates rather than trusting, because this workflow can be called by anything and
// a missing window silently scores the wrong month.
const incoming = $input.first().json || {};
const validated = incoming.validated || {};
const cases = Array.isArray(incoming.cases) ? incoming.cases : null;

if (!cases) {
  throw new Error('WF-T: no cases array was passed in. An empty batch is not a state this ' +
    'workflow can have - the caller chunks a known cohort, so a missing array is a wiring or ' +
    'mapping fault, and returning zero scored cases would read downstream as a quiet month.');
}
if (cases.length === 0) {
  throw new Error('WF-T: an EMPTY batch was passed in. Chunk Cases never emits one, so this is ' +
    'a fault rather than a small month; scoring nothing and reporting success is the failure ' +
    'this refuses.');
}
const windows = Array.isArray(validated.persistence_windows) ? validated.persistence_windows : [];
if (windows.length !== 3) {
  throw new Error('WF-T: validated.persistence_windows has ' + windows.length + ' entries, ' +
    'expected 3. Gate 18 (persistence) is what cuts the freeze false positives from 17 to 2, ' +
    'and with the wrong number of windows it silently stops discriminating.');
}
if (!validated.audit_month || !validated.range_start || !validated.range_end) {
  throw new Error('WF-T: validated is missing audit_month/range_start/range_end. Every gate ' +
    'that asks "in the audited month?" would answer against undefined.');
}

console.log(JSON.stringify({ stage: 'wft_validate_inputs',
  batch_index: incoming.batch_index === undefined ? null : incoming.batch_index,
  batch_count: incoming.batch_count === undefined ? null : incoming.batch_count,
  cases_in_batch: cases.length, audit_month: validated.audit_month,
  windows: windows.map(function (w) { return w.key; }),
  note: 'named Validate Inputs so the three lifted bodies read it unchanged' }));

return [{ json: validated }];
