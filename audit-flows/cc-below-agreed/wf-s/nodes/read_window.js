// Read Sweep Window (WF-S) - unpack what the status sweep needs and nothing else.
//
// WHY THIS WORKFLOW EXISTS. n8n retains every node's output for the life of an
// execution, so WF-A could not release the status sweep no matter what it trimmed
// downstream. Measured 2026-08-18: the raw sweep is 1,056 B/row over 43,727 rows =
// 44.1 MB, the largest single item of retention in the run and 57% of ~77 MB total,
// against a measured healthy band of 44-61 MB and a kill band of 100.6-142.6 MB.
// Execution 92433 crashed at 22m35s carrying it.
//
// Running the sweep in a SUB-EXECUTION is the only thing that actually frees it: this
// workflow holds the raw rows, projects them, returns the projection, and DIES with
// the raw copy. WF-A keeps ~20.4 MB instead of 44.1.
//
// The caller passes its whole validated payload, so this node takes only the two
// things the sweep needs and refuses loudly rather than sweeping a wrong window.
const incoming = $input.first().json || {};
const params = incoming.params || {};
const windows = incoming.persistence_windows;

const bearer = (params.erp_auth && params.erp_auth.bearer) || '';
if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('WF-S: no usable bearer on the incoming payload. Every page would 401 and the ' +
    'projection would return zero rows, which gate 2 cannot distinguish from a quiet month. Refusing.');
}
if (!Array.isArray(windows) || windows.length !== 3) {
  throw new Error('WF-S: expected three persistence windows, got ' +
    (Array.isArray(windows) ? windows.length : typeof windows) + '. The status sweep spans the WHOLE ' +
    'window - oldest.from to newest.to - because gate 18 needs the prior months statuses too.');
}

// The sweep spans window[2].from (oldest) to window[0].to (audited month end). Index 0
// is ALWAYS the audited month, so this is deliberately not windows[0].from.
const from = windows[2].from;
const to = windows[0].to;
if (!from || !to || from > to) {
  throw new Error('WF-S: derived an impossible range ' + from + ' .. ' + to + '.');
}

console.log(JSON.stringify({ stage: 'wfs_read_window', from: from, to: to,
  run_id: incoming.run_id || null,
  note: 'sweeping the full three-month span in one query, at size 2000' }));

return [{ json: { bearer: bearer, from: from, to: to, run_id: incoming.run_id || null } }];
