// Settle (ERP Lease) - wait long enough for a competing write to land before reading back.
//
// WHY A DELIBERATE PAUSE EXISTS IN A LOCK. Get Lease Row, Decide Lease and Write Lease are
// three separate nodes, so the lease is NOT acquired atomically. Two audits starting within
// the same instant can both read "free", both decide to acquire, and both write - last write
// wins, and both proceed believing they are alone. That is precisely the state the lease
// exists to prevent, arrived at through the lease itself.
//
// n8n's Data Table has no compare-and-swap: there is no way to say "write only if the row
// still reads free". So the check is done after the fact instead - write, wait, read back,
// and refuse if the row does not name you. That is only sound if the wait is longer than the
// window in which a competitor's write could still be in flight.
//
// 1500 ms is chosen against measurement, not taste: on this instance Get Lease Row and Write
// Lease each complete in ~90 ms (executions 95315-95321), so a competitor's whole
// read-decide-write span is well under 300 ms. 1500 ms is more than five times that, and it
// is paid ONCE per run against an audit that takes 45-90 minutes.
//
// WHAT THIS STILL DOES NOT MAKE IT. This is a cooperative lease, not a mutex, and the wait
// narrows the race rather than eliminating it - a competitor stalled longer than the settle
// window would still be missed. The honest statement of the guarantee is "two audits starting
// more than about a second apart cannot both proceed", which covers the real failure mode:
// two people starting runs minutes apart.
//
// THE ONE THING NOT TO DO HERE is skip the wait when the action was a refusal or a no-op.
// Every path writes, so every path reads back; a verify that runs on some paths and not
// others is a verify nobody can reason about at 2am.
const SETTLE_MS = 1500;
const items = $input.all();

console.log(JSON.stringify({ stage: 'erp_lease_settle', wait_ms: SETTLE_MS,
  note: 'pausing before the read-back, because acquire is three nodes and therefore not atomic' }));

// Returned as a promise rather than awaited at the top level, so this body stays valid under
// a plain parser and can be checked the same way as every other node file here.
return new Promise(function (resolve) {
  setTimeout(function () { resolve(items); }, SETTLE_MS);
});
