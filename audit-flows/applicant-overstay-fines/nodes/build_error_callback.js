// Build Error Callback — runOnceForAllItems.
//
// THE HEAD OF THE ERROR RAIL. Reached from the error output of every single-output node on the
// main path — the cohort sweep, `Acquire ERP Lease`, every Code node between the lease acquire
// and `Write Run`, and the three table writes — and from the workflow-level Error Trigger.
//
// It runs FIRST on the rail, before the lease is handed back, and that order is the whole reason
// the rail is shaped this way: an Execute Sub-workflow node replaces the item it is given with
// the sub-workflow's return value, so anything reading the failure has to read it before
// `Release Lease (error)` runs. The rail is therefore
//   failing node -> Build Error Callback -> Build Error Run Row -> Release Lease (error)
//                -> Fail Loudly (re-throws)
// with the callback and the failure draft hanging off this node as their own branches.
//
// ERP-COMPLIANCE: no-breaker-because this node reads ERROR ITEMS, not a batch of ERP responses.
// It is the first Code node downstream of `Get CC Change of Status Transactions`' error output,
// which is why §5 asks about it. That output carries exactly ONE item — the pager stops at the
// first page that fails — so consecutive_failures (needs 5) and degraded_rate (needs >= 20)
// cannot fire, and latency has no earlier batch of the same key in the same run to compare
// against. Judging a batch of one is the case ERP-LOAD-POLICY.md §5 names as the legitimate
// exemption. What stops the run instead is this rail itself: it records the failure, releases
// the ERP lease and re-throws at `Fail Loudly`, so the run cannot continue calling a failing ERP.
// The per-entity fan-outs are judged properly, by `Judge Detail/Fines/Loans/Complaints/Threads
// Batch`, each of which sits on its ERP node's REGULAR output precisely so failures reach a
// counter instead of being routed here.
//
// It does NOT end the run quietly.  On the MV build the error rail caught an ERP
// failure, drafted an alert and exited cleanly, so n8n recorded `status: success`
// for a run that audited nothing — and because `Build Run Row` sat downstream of
// the case payload, a failed run wrote NO Runs row at all, from the log whose
// stated purpose is "there is always a record that it ran".  Here the rail writes
// a Runs row first and then deliberately fails the execution.

const items = $input.all();
let run = { run_id: 'unknown', check_id: 'cc-overstay-fines', check_name: 'CC Overstay Fines',
            window_from: '', window_to: '', trigger: 'manual', callback_url: '' };
try { run = Object.assign(run, $('Build Run Context').first().json); } catch (e) { /* crash before intake */ }

const seen = {};
const errors = [];

// WHICH node failed.  An HTTP node's error item does NOT carry its own name in
// the payload — the first live error test of this rail reported node "unknown",
// which is useless in an alert.  n8n exposes the sender as `$prevNode`, and that
// is the only place the name actually is.
let prevNodeName = '';
try { prevNodeName = ($prevNode && $prevNode.name) || ''; } catch (e) { prevNodeName = ''; }

for (const it of items) {
  const j = it.json || {};
  // Two shapes: an HTTP node's error output, and the Error Trigger's execution
  // envelope.  Classify on the STATUS CODE first where there is one — the message
  // text is the least reliable thing in an error.
  const err = j.error || (j.execution || {}).error || j;
  const status = j.statusCode || (err && (err.httpCode || err.status)) || null;
  const node = (j.node && j.node.name) || (err && err.node && err.node.name) ||
               (j.execution || {}).lastNodeExecuted || prevNodeName || 'unknown';
  const message = (err && (err.message || err.description)) || j.message || 'unknown error';

  let code = 'erp_error';
  const st = String(status || '');
  if (st === '401' || /token|unauthor/i.test(message)) code = 'erp_auth';
  else if (st === '403') code = 'erp_permission';
  else if (st === '404') code = 'erp_not_found';
  else if (st === '429') code = 'erp_rate_limited';
  else if (st.charAt(0) === '5') code = 'erp_server';
  else if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) code = 'erp_timeout';
  else if (/paired item/i.test(message)) code = 'item_linking';

  const key = code + '|' + node;
  if (seen[key]) { seen[key].occurrences++; continue; }
  const rec = { code, node, status: status || null, message: String(message).slice(0, 500), occurrences: 1 };
  seen[key] = rec;
  errors.push(rec);
}

if (errors.length === 0) {
  errors.push({ code: 'unknown', node: 'unknown', status: null, message: 'The error rail fired with no readable error payload.', occurrences: 1 });
}

const primary = errors[0];

return [{
  json: {
    result: 'error',
    check_id: run.check_id,
    check_name: run.check_name,
    run_id: run.run_id,
    window_from: run.window_from,
    window_to: run.window_to,
    trigger: run.trigger,
    callback_url: run.callback_url,
    delivery: run.delivery || { portal: false, data_tables: true },
    error: primary,
    errors,
    failed_at: new Date().toISOString(),
    // Read straight from the owner if it got that far. An error before the cohort
    // walk leaves this empty, which is the honest answer.
    population: (function () {
      try { return $('Verify Cohort Pull').first().json.population; } catch (e) { return {}; }
    })()
  },
  pairedItem: { item: 0 }
}];
