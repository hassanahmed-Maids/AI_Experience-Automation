// The lease is held by another audit, so this run goes round again rather than blocking.
//
// PINNING run_id IS THE WHOLE TRICK. Validate Inputs mints a run_id when the payload does not
// carry one, so a retry that did not pin it would arrive as a BRAND NEW run: a new queue
// ticket, enqueued now, at the back of the line - and a run could retry for ever while newer
// arrivals overtook it every time. Pinning it means the ticket persists, keeps its original
// enqueued_at_ms, and the run holds its place across as many attempts as it takes.
//
// It also carries first_attempt_at, so the log says how long this run has actually been
// waiting rather than how long this execution has been alive.
const lease = $input.first().json;
const entry = $('Normalize Entry').first().json;
const validated = $('Validate Inputs').first().json.params;

const attempt = Number(entry.lease_attempt || 0) + 1;
const body = Object.assign({}, entry.body);
body.params = Object.assign({}, body.params || {}, { run_id: validated.run_id });
body._lease_attempt = attempt;
body._lease_first_attempt_at = entry.first_attempt_at;

console.log(JSON.stringify({ stage: 'ccprice_lease_requeue', run_id: validated.run_id,
  attempt: attempt, waiting_for_minutes: entry.waiting_for_minutes,
  queue_position: lease.queue_position, waiters_ahead: lease.waiters_ahead,
  holder_run_id: lease.holder_run_id, holder_check_id: lease.holder_check_id,
  note: 'ERP lease held by another audit - re-invoking this flow rather than blocking. n8n ' +
        'cancels an execution 2400s after it starts and does it silently, so waiting inside one ' +
        'execution caps the wait at 40 minutes and hides the failure. This way the wait is ' +
        'unbounded and every attempt is on the record.' }));

return [{ json: body }];
