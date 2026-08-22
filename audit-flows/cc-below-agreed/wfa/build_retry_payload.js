// Build Retry Payload (WF-A) - the ERP lease is held by another audit, so this run goes round
// again rather than blocking or failing.
//
// WHY NOT BLOCK. n8n cancels an execution 2400s after it starts, and the kill is SILENT: status
// "canceled", nothing thrown, no error rail, no callback (measured 2026-08-20, execution 95598).
// A full CC Below Agreed run already takes ~26 minutes, so a blocking wait would eat most of the
// remaining budget and then vanish. Re-invoking keeps every execution's clock short.
//
// IT MUST RESEND THE ORIGINAL PAYLOAD, not Validate Inputs' output. That node checks a shared
// secret and an allowlisted callback_url and then DROPS them - by design, they are credentials -
// so a retry rebuilt from its output would fail its own validation on the next attempt. The raw
// payload is recovered from whichever entry actually ran.
//
// $('Webhook') THROWS in any execution where the webhook did not run, which is every retry, so
// the reference is wrapped rather than tested. This is the same trigger-reference trap recorded
// in CC Price Stage 1 and MV Monthly Payment Stage 4.
let payload = null;
try { payload = $('Webhook').first().json.body; } catch (e) { }
if (!payload) { try { payload = $('Retry Entry').first().json; } catch (e) { } }
if (!payload || typeof payload !== 'object') {
  throw new Error('WF-A: the ERP lease is held and this run should re-queue, but neither the ' +
    'webhook body nor a retry payload could be read - so there is nothing to re-send. Refusing ' +
    'to invent one: a retry built from Validate Inputs\' output would be missing the shared ' +
    'secret and the callback_url and would fail its own validation.');
}

// run_id is NOT minted here and does not need pinning: Validate Inputs REQUIRES it in the
// payload (it is in the `required` list) and never generates one, so resending the payload
// resends the same run - and therefore keeps the same queue ticket and its place in line.
const lease = $input.first().json || {};
const attempt = Number(payload._lease_attempt || 0) + 1;
const firstAt = String(payload._lease_first_attempt_at || '') || new Date().toISOString();
const body = Object.assign({}, payload, {
  _lease_attempt: attempt,
  _lease_first_attempt_at: firstAt
});

console.log(JSON.stringify({ stage: 'wfa_lease_requeue', run_id: payload.run_id || null,
  attempt: attempt,
  waiting_for_minutes: Math.round((Date.now() - new Date(firstAt).getTime()) / 60000),
  queue_position: lease.queue_position, waiters_ahead: lease.waiters_ahead,
  holder_run_id: lease.holder_run_id, holder_check_id: lease.holder_check_id,
  note: 'ERP lease held by another audit - re-invoking WF-A rather than blocking. No ERP call ' +
        'has been made by this attempt, so a queued run costs ERP nothing however long it waits.' }));

return [{ json: body }];
