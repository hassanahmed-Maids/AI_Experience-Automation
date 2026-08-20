// ONE source of truth for both ways in, because there are now two: the webhook a human POSTs
// to, and this flow re-invoking ITSELF while it waits for the ERP lease.
//
// WHY DOWNSTREAM NODES MUST REFERENCE THIS AND NEVER A TRIGGER. $('Run (webhook)') throws in
// any execution where that node did not run - so on every retry. The same trap is documented
// in MV Monthly Payment Stage 4. Anything that needs the request body reads it from here.
//
// WHY THE RUN RE-INVOKES ITSELF AT ALL. n8n cancels an execution 2400s after it starts, and a
// run parked waiting for the lease is killed at the first resume past that line with status
// "canceled" rather than "error" - it throws nothing and simply disappears (measured
// 2026-08-20, execution 95598). Blocking therefore caps the wait at 40 minutes AND makes the
// failure invisible. Re-invoking keeps every execution short, so the ceiling never applies and
// the wait is genuinely unbounded.
const raw = $input.first().json || {};

// A webhook payload is wrapped in `body`; a sub-workflow input is not. Structural, rather than
// a flag someone can forget to pass.
const fromWebhook = raw.body !== undefined && raw.body !== null;
const body = raw.body || raw;

const attempt = Number(body._lease_attempt) || 0;
const firstAt = String(body._lease_first_attempt_at || '') || new Date().toISOString();
const waitedMin = Math.round((Date.now() - new Date(firstAt).getTime()) / 60000);

console.log(JSON.stringify({ stage: 'ccprice_entry', from_webhook: fromWebhook,
  lease_attempt: attempt, first_attempt_at: firstAt, waiting_for_minutes: waitedMin,
  run_id: (body.params || {}).run_id || null,
  note: attempt > 0
    ? 'this is a RETRY - the run is queued behind another audit and re-invoking itself rather than blocking'
    : 'first attempt' }));

return [{ json: {
  body: Object.assign({}, body, {
    _lease_attempt: attempt,
    _lease_first_attempt_at: firstAt
  }),
  from_webhook: fromWebhook,
  lease_attempt: attempt,
  first_attempt_at: firstAt,
  waiting_for_minutes: waitedMin
} }];
