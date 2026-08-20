// The ERP lease, tested against the real Decide Lease body.
//
// The lease is what stops two audits hitting ERP at once. Per-flow pacing bounds ONE flow to
// 4 req/s and says nothing about two; VALIDATION.md §19 records two audits crashing in the
// same instance within ten minutes, which at the settings of the time was 60 req/s arriving
// from a system that believed it was being careful.
//
// Three behaviours are load-bearing and each is pinned below:
//   - a held lease REFUSES a second audit (that is the whole point);
//   - a crashed run cannot block the queue for ever (staleness takeover);
//   - a run can never release a lease it does not hold (silent double-start).
// The third is the subtle one. Releasing someone else's lease fails silently: the other audit
// keeps running, the lease reads free, and the NEXT audit starts alongside it.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'decide_lease.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}
function throwsWith(fn, label, ...needles) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    const miss = needles.filter(n => e.message.indexOf(String(n)) === -1);
    if (miss.length) { fail++; console.log('FAIL ' + label + '\n       -> message lacked: ' + miss.join(', ')); }
    else { pass++; console.log('ok   ' + label); }
  }
}

const HOUR = 3600000;
function row(o) {
  return Object.assign({ lease_key: 'erp', state: 'held', holder_run_id: 'other-run',
    holder_check_id: 'cc-non-received', acquired_at_iso: '', acquired_at_ms: Date.now() - 60000 }, o);
}
function run(mode, opts) {
  const o = opts || {};
  const req = { mode: mode, run_id: o.runId || 'me', check_id: o.checkId || 'cc-below-agreed',
                ignore_lease: o.ignore === true };
  const rows = o.row === null ? [] : [{ json: o.row || row({}) }];
  const nodes = { 'Read Lease Request': [{ json: req }] };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')'); return { all: () => nodes[n], first: () => nodes[n][0] }; };
  const logs = [];
  const out = new Function('$input', '$', 'console', SRC)(
    { all: () => rows, first: () => rows[0] }, $, { log: m => logs.push(m) });
  return { json: (out || [])[0] ? out[0].json : null,
           log: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }).pop() || {} };
}

console.log('--- acquiring ---');
let r = run('acquire', { row: null });
ok(r.json._action === 'acquire' && r.json.state === 'held' && r.json.holder_run_id === 'me',
   'a first-ever acquire takes the lease', r.json._action);
r = run('acquire', { row: row({ state: 'free', holder_run_id: '' }) });
ok(r.json._action === 'acquire', 'a free lease is acquired');
r = run('acquire', { row: row({ holder_run_id: 'me' }) });
ok(r.json._action === 'acquire' && /idempotent/.test(r.json._reason),
   'the SAME run re-acquiring is idempotent, so a retry cannot deadlock against itself');

console.log('\n--- refusing: the reason the lease exists ---');
throwsWith(() => run('acquire', {}),
  'a lease held by another audit REFUSES the second one',
  'ERP LEASE HELD', 'cc-non-received', 'other-run', 'ignore_erp_lease');
throwsWith(() => run('acquire', {}),
  'the refusal explains WHY two audits are the problem', '4 req/s', '§4');

console.log('\n--- a crashed run must not block the queue for ever ---');
r = run('acquire', { row: row({ acquired_at_ms: Date.now() - 4 * HOUR }) });
ok(r.json._action === 'acquire' && /STALE/.test(r.json._reason),
   'a lease older than 3 hours is taken over automatically', r.json._reason);
ok(/two audits are now hitting ERP together/.test(r.json._reason),
   'the takeover names its own risk rather than presenting itself as safe');
// The boundary matters: too eager and a live audit gets trampled, too slow and a crash blocks
// the queue past the point anyone waits.
throwsWith(() => run('acquire', { row: row({ acquired_at_ms: Date.now() - 2 * HOUR }) }),
  'a 2-hour-old lease is NOT yet stale and is still refused', 'ERP LEASE HELD');

console.log('\n--- the override is allowed, and recorded ---');
r = run('acquire', { ignore: true });
ok(r.json._action === 'acquire' && /OVERRIDE/.test(r.json._reason),
   'params.ignore_erp_lease takes a held lease');
ok(r.log.override_used === true,
   'the override is flagged in the log line, so a run that used it can be found afterwards');
ok(/indistinguishable/.test(r.json._reason),
   'the override records that a stuck lease and a live audit look identical from here');

console.log('\n--- releasing: never free a lease you do not hold ---');
r = run('release', { row: row({ holder_run_id: 'me' }) });
ok(r.json._action === 'release' && r.json.state === 'free' && r.json.holder_run_id === '',
   'the holder releases its own lease');
r = run('release', { row: row({ holder_run_id: 'someone-else' }) });
ok(r.json._action === 'noop' && r.json._write === false,
   'releasing ANOTHER run\'s lease is a no-op - this is the silent double-start guard',
   r.json._action);
ok(/refusing to release a lease held by another run/.test(r.json._reason),
   'and it says why, rather than looking like a successful release');
// THE BUG THIS PINS: the first version of Decide Lease returned the standard payload for
// every action, so this no-op wrote THIS run's id into holder_run_id - the refusal message was
// right and the write underneath it stole the lease anyway.
ok(r.json.holder_run_id === 'someone-else' && r.json.state === 'held',
   'a no-op release echoes the row back UNCHANGED, so the write underneath cannot steal it',
   r.json.holder_run_id + '/' + r.json.state);
r = run('release', { row: row({ state: 'free', holder_run_id: '' }) });
ok(r.json._action === 'noop', 'releasing an already-free lease is a no-op');
r = run('release', { row: null });
ok(r.json._action === 'noop', 'releasing when no lease row exists is a no-op');

console.log('\n--- an unrecognised mode is refused, not guessed ---');
throwsWith(() => run('maybe', {}), 'mode must be acquire or release',
  'mode must be', 'no default');

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
