// Read Lease Request (ERP Lease) - take what the lease needs and refuse a call
// that cannot be reasoned about.
//
// This workflow is called by every audit, so its input is the one thing it cannot assume.
// A missing run_id is the dangerous one: the lease is keyed on WHO holds it, and a blank
// holder makes "did I acquire this?" and "did somebody else?" the same question - which is
// exactly the ambiguity the release guard depends on being able to answer.
const incoming = $input.first().json || {};

const mode = String(incoming.mode === null || incoming.mode === undefined ? '' : incoming.mode).trim();
const runId = String(incoming.run_id === null || incoming.run_id === undefined ? '' : incoming.run_id).trim();
const checkId = String(incoming.check_id === null || incoming.check_id === undefined ? '' : incoming.check_id).trim();

// OPERATOR is optional and is a short workspace handle - never an email address or anything
// else that identifies a person outside this workspace, because it is written to the queue
// table and printed in the run log. Absent, the caller simply gets plain FIFO.
const operator = String(incoming.operator === null || incoming.operator === undefined ? '' : incoming.operator).trim().slice(0, 40);

if (mode !== 'acquire' && mode !== 'release') {
  throw new Error('ERP Lease: mode must be "acquire" or "release", got "' + mode + '". Guessing ' +
    'acquire would block the queue; guessing release would free a lease held by someone else.');
}
if (!runId) {
  throw new Error('ERP Lease: no run_id was passed. The lease records WHO holds it, and every ' +
    'later decision - is this mine to release, is the holder still alive - reads that field. A ' +
    'blank holder makes those questions unanswerable, so the call is refused here.');
}
if (!checkId) {
  throw new Error('ERP Lease: no check_id was passed. When a run is refused the message names ' +
    'which audit is holding the lease, and "" is not an answer anyone can act on.');
}

// NO_WAIT turns the queue inside out. Normally a blocked run parks inside this workflow and
// polls until it wins - which is fine until it collides with n8n's 2400s execution ceiling:
// measured 2026-08-20, a queued run was CANCELED at the first resume past the limit, with
// status "canceled" rather than "error", so it threw nothing and simply vanished.
//
// With no_wait the lease answers immediately - granted, or queued with a position - and the
// CALLER decides what to do. An entry flow re-invokes itself and exits, so no execution ever
// waits long and the ceiling stops mattering. The ticket persists across those re-invocations,
// so a run keeps its place in the queue rather than going to the back each time.
const noWait = incoming.no_wait === true;

// max_wait_ms IS PASSED THROUGH RAW, deliberately. The When Called trigger declares it as a
// NUMBER field, and n8n fills a declared-but-unsent number with 0 rather than leaving it
// absent - so "the caller said nothing" and "the caller asked for a zero-millisecond limit"
// arrive here identically. Decide Lease is the only place that can tell them apart, and it
// does (see maxWaitMs there). Coercing it here would destroy the distinction before it got
// the chance. Measured 2026-08-20: execution 95750 died with "limit 0 minutes" because an
// older Decide Lease treated the 0 as a real limit.
console.log(JSON.stringify({ stage: 'erp_lease_request', mode: mode, run_id: runId,
  check_id: checkId, operator: operator || null, ignore_lease: incoming.ignore_lease === true,
  no_wait: noWait,
  max_wait_ms: Number(incoming.max_wait_ms) || null,
  note: 'ERP-LOAD-POLICY.md section 4 - one audit against ERP at a time; a blocked run queues, ' +
        'round-robin between operators and FIFO within one' }));

// EVERY FIELD DECIDE LEASE READS MUST BE ON THIS OBJECT. It reads req.operator, req.no_wait and
// req.max_wait_ms from here, and an omission is silent: a dropped operator degrades fair-share
// to plain FIFO and a dropped no_wait sends the caller into the polling loop it asked to skip.
// Both were live for a time on 2026-08-20 because this projection lagged behind Decide Lease.
return [{ json: { mode: mode, run_id: runId, check_id: checkId, operator: operator,
                  ignore_lease: incoming.ignore_lease === true,
                  no_wait: noWait,
                  max_wait_ms: incoming.max_wait_ms } }];
