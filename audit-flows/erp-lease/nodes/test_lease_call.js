// MANUAL TEST HARNESS. Not part of the lease - the real entry point is `When Called`.
// Sub-workflow triggers cannot be fired directly, so this exists to exercise the lease by
// hand from the canvas.
//
// THE DEFAULT BELOW IS DELIBERATELY INERT: a release from a run id no audit will ever use is
// always a no-op, whatever state the lease is in. Clicking `Test workflow` can therefore
// never take the lease from a running audit, nor free one so a second audit starts alongside
// it. Edit these constants to test a path, then put them back.
//
//   acquire / a fresh run id      -> grants, or QUEUES if another audit holds it
//   acquire / the current holder  -> re-acquires (idempotent, for retries)
//   release / the current holder  -> frees it, and the head of the queue picks it up
//   release / anyone else         -> no-op, and says whose it is
//
// A QUEUED CALL DOES NOT RETURN UNTIL IT WINS OR TIMES OUT. Testing the queue by hand means
// firing one run, leaving it running, then firing the release from a second execution - which
// is how 95530 / 95531 / 95532 were run.
//
// What CANNOT be exercised from here is the lost-race branch: it needs the row to change
// between Write Lease and Verify Lease Row, which one manual click cannot produce. That
// branch is pinned offline instead - offline/lease_test.js.
const TEST_MODE = 'release';                       // 'acquire' | 'release'
const TEST_RUN_ID = 'manual-harness-inert';        // matches no real run, so release is a no-op
const TEST_CHECK_ID = 'manual-harness';
const TEST_IGNORE = false;                         // true = override a held lease, jumps the queue
const TEST_MAX_WAIT_MS = 120000;                   // how long an acquire will queue before giving up

console.log(JSON.stringify({ stage: 'erp_lease_manual_test', mode: TEST_MODE, run_id: TEST_RUN_ID }));
return [{ json: { mode: TEST_MODE, run_id: TEST_RUN_ID, check_id: TEST_CHECK_ID, ignore_lease: TEST_IGNORE, max_wait_ms: TEST_MAX_WAIT_MS } }];
