// Read Payment Window (WF-P) - take ONE month's window from the caller and refuse
// anything that would sweep the wrong month quietly.
//
// WHY THIS WORKFLOW EXISTS. n8n retains every node's output for the life of an
// execution, so WF-A could not release the bulk payment sweeps however much it trimmed
// downstream - the raw rows sit in the HTTP node's output until the run ends. Measured
// 2026-08-18 on the real July pull: 33,213 rows, 6.06 MB, 182 B/row; three windows =
// ~18.2 MB. Running each sweep in a SUB-EXECUTION is the only thing that frees it.
//
// WHAT THE PROJECTION ACTUALLY SAVES, stated honestly: NOTHING per row. This DTO carries
// exactly seven fields (contractID, contractType, paymentAmount, paymentDate, paymentId,
// paymentMethod, paymentType) and Attach Month Payments reads ALL SEVEN. There is no fat
// to trim. The entire saving is the CC FILTER: 6,774 of 33,213 July rows are CC (20.4%),
// and the other 79.6% are MV rows that Attach Month Payments discards on its first line
// anyway. So ~18.2 MB of retention becomes ~3.8 MB, and the MV rows die here with this
// execution instead of being carried through WF-A to be thrown away at the end.
//
// ONE WINDOW PER CALL, not three. The bulk endpoint caps at a 31-day window (HTTP 400
// beyond it), so the three windows were always three calls; keeping that shape means
// each of WF-A's three caller nodes maps its own from/to and the per-window node names
// the consumers reach for BY NAME survive untouched.
const incoming = $input.first().json || {};

const bearer = incoming.bearer || '';
const from = incoming.from || '';
const to = incoming.to || '';
const monthKey = incoming.month_key || '';

if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('WF-P: no usable bearer was passed in. The call would 401 and return zero rows, ' +
    'which gate 2 cannot tell from a quiet month. Refusing rather than returning an empty sweep.');
}
// A yyyy-mm-dd test written out longhand rather than as a regex: this body is shipped
// into an n8n Code node as a string, and a backslash class is exactly the thing that
// gets eaten in transit and silently passes every date.
function isYmd(v) {
  const t = String(v === null || v === undefined ? '' : v);
  if (t.length !== 10 || t[4] !== '-' || t[7] !== '-') return false;
  const digits = t.slice(0, 4) + t.slice(5, 7) + t.slice(8, 10);
  for (let i = 0; i < digits.length; i++) {
    if (digits[i] < '0' || digits[i] > '9') return false;
  }
  return true;
}
if (!isYmd(from) || !isYmd(to)) {
  throw new Error('WF-P: from/to must be yyyy-mm-dd, got from="' + from + '" to="' + to + '". ' +
    'An empty or malformed date is HTTP 400 on this route, and an out-of-range one silently ' +
    'sweeps the wrong month.');
}
if (from > to) {
  throw new Error('WF-P: impossible window ' + from + ' .. ' + to + '.');
}
// The 31-day cap is enforced upstream in WF-A's Validate Inputs, and again here because
// this workflow can be called by anything and a 400 mid-sweep is indistinguishable from
// an access failure by the time WF-A sees it.
const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
if (days > 31) {
  throw new Error('WF-P: window ' + from + ' .. ' + to + ' spans ' + days + ' days. ' +
    'getReceivedClientsPayments caps at 31 and answers HTTP 400 beyond it - that is exactly why ' +
    'three separate windows exist instead of one 92-day range.');
}

console.log(JSON.stringify({ stage: 'wfp_read_window', month_key: monthKey, from: from, to: to,
  days: days, run_id: incoming.run_id || null,
  note: 'one 31-day-or-less window per call; the CC filter happens after the pull' }));

return [{ json: { bearer: bearer, from: from, to: to, month_key: monthKey,
                  run_id: incoming.run_id || null } }];
