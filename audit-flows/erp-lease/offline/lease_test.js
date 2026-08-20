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
const RESULT = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'return_lease_result.js'), 'utf8');

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
function ticket(o) {
  const now = Date.now();
  return Object.assign({ ticket_key: 'other-run', check_id: 'cc-non-received', state: 'waiting',
    operator: '', enqueued_at_ms: now - 60000, last_seen_ms: now - 5000, enqueued_at_iso: '' }, o);
}
function run(mode, opts) {
  const o = opts || {};
  const req = { mode: mode, run_id: o.runId || 'me', check_id: o.checkId || 'cc-below-agreed',
                ignore_lease: o.ignore === true, max_wait_ms: o.maxWaitMs,
                operator: o.operator };
  const rows = o.row === null ? [] : [{ json: o.row || row({}) }];
  const nodes = { 'Read Lease Request': [{ json: req }],
                  'Get Queue': (o.queue || []).map(function (t) { return { json: t }; }) };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')'); return { all: () => nodes[n], first: () => nodes[n][0] }; };
  const logs = [];
  const out = new Function('$input', '$', 'console', SRC)(
    { all: () => rows, first: () => rows[0] }, $, { log: m => logs.push(m) });
  return { json: (out || [])[0] ? out[0].json : null,
           log: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }).pop() || {} };
}

// Runs Return Lease Result against a chosen READ-BACK row, which is the whole point: the node
// has to behave differently depending on what the store says AFTER the write, not what this run
// intended to write.
function verify(mode, decidedJson, readBackRow, runId) {
  const req = { mode: mode, run_id: runId || 'me', check_id: 'cc-below-agreed', ignore_lease: false };
  const nodes = { 'Read Lease Request': [{ json: req }], 'Decide Lease': [{ json: decidedJson }] };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')'); return { all: () => nodes[n], first: () => nodes[n][0] }; };
  const back = readBackRow === null ? [] : [{ json: readBackRow }];
  const logs = [];
  const out = new Function('$input', '$', 'console', RESULT)(
    { all: () => back, first: () => back[0] }, $, { log: m => logs.push(m) });
  return { json: (out || [])[0] ? out[0].json : null,
           logs: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }) };
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

console.log('\n--- queueing: the reason the lease exists ---');
// A held lease no longer THROWS. Throwing was correct but useless: the honest response to
// "someone else is using ERP" is to wait, not to make a person re-fire by hand later.
r = run('acquire', {});
ok(r.json._action === 'queue' && r.json._proceed === false,
   'a lease held by another audit QUEUES the second one instead of refusing it', r.json._action);
ok(r.json._write === false && r.json.holder_run_id === 'other-run',
   'a queued run does not touch the lease row at all');
ok(r.json._ticket_state === 'waiting' && r.json._ticket_key === 'me',
   'a queued run takes a ticket so its place in line is recorded');
ok(r.json._queue_position === 1,
   'with no other waiters it is first in line, and will get the lease when the holder releases');

console.log('\n--- a crashed run must not block the queue for ever ---');
r = run('acquire', { row: row({ acquired_at_ms: Date.now() - 4 * HOUR }) });
ok(r.json._action === 'acquire' && /STALE/.test(r.json._reason),
   'a lease older than 3 hours is taken over automatically', r.json._reason);
ok(/two audits are now hitting ERP together/.test(r.json._reason),
   'the takeover names its own risk rather than presenting itself as safe');
// The boundary matters: too eager and a live audit gets trampled, too slow and a crash blocks
// the queue past the point anyone waits.
r = run('acquire', { row: row({ acquired_at_ms: Date.now() - 2 * HOUR }) });
ok(r.json._action === 'queue',
   'a 2-hour-old lease is NOT yet stale - the second run queues rather than trampling a live audit');

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

console.log('\n--- the queue is a queue, not a scramble ---');
// Polling alone is not a queue. Without ordering, whoever polls in the instant after a release
// wins, so a run that has waited twenty minutes can lose to one that arrived a second ago -
// repeatedly. These pin the ordering.
{
  const now = Date.now();
  const older = ticket({ ticket_key: 'run-A', enqueued_at_ms: now - 600000, last_seen_ms: now - 1000 });

  // Lease FREE but someone asked first: taking it here is how a queue turns back into a scramble.
  let q = run('acquire', { row: row({ state: 'free', holder_run_id: '' }), queue: [older],
                           runId: 'run-B' });
  ok(q.json._action === 'queue' && q.json._waiters_ahead === 1,
     'a free lease is NOT taken by a run that is second in line');
  ok(/ahead of this one/.test(q.json._reason) && /run-A/.test(q.json._reason),
     'and it says who it is waiting behind');

  // The head of the queue takes it. run-A needs its OWN ticket here: a run with no ticket is
  // arriving for the first time and enqueues at now, so it is legitimately behind anyone already
  // waiting. Getting that wrong in the fixture is what this comment is for - the first version of
  // this test gave run-A no ticket and then expected it to be first.
  q = run('acquire', { row: row({ state: 'free', holder_run_id: '' }),
                       queue: [ticket({ ticket_key: 'run-A', enqueued_at_ms: now - 600000, last_seen_ms: now - 1000 }),
                               ticket({ ticket_key: 'run-B', enqueued_at_ms: now - 1000 })],
                       runId: 'run-A' });
  ok(q.json._action === 'acquire' && q.json._proceed === true,
     'the run that asked FIRST gets the free lease');
  ok(q.json._ticket_state === 'done',
     'and its ticket is settled in the same write, so no path grants the lease and leaves the ticket waiting');
}
{
  // A ticket that has stopped polling belongs to a run that is gone. Without this, one crashed
  // waiter blocks every later audit for ever - the queue would develop the exact failure the
  // lease's own staleness rule exists to prevent.
  const now = Date.now();
  const dead = ticket({ ticket_key: 'run-dead', enqueued_at_ms: now - 900000, last_seen_ms: now - 600000 });
  const q = run('acquire', { row: row({ state: 'free', holder_run_id: '' }), queue: [dead], runId: 'me' });
  ok(q.json._action === 'acquire',
     'a waiter that stopped polling is ignored for ordering, so a dead run cannot block the queue');
}
{
  // Re-stamping enqueued_at_ms on every poll would send a waiting run to the back of its own
  // queue on each tick. That is a starvation bug that only appears under contention - which is
  // the only time it matters.
  const now = Date.now();
  const mineOld = ticket({ ticket_key: 'me', enqueued_at_ms: now - 900000, last_seen_ms: now - 1000 });
  const rival = ticket({ ticket_key: 'run-Z', enqueued_at_ms: now - 300000, last_seen_ms: now - 1000 });
  const q = run('acquire', { row: row({ state: 'free', holder_run_id: '' }),
                             queue: [mineOld, rival], runId: 'me' });
  ok(q.json._action === 'acquire',
     'a run keeps its original place across polls rather than going to the back of its own queue');
  ok(q.json._ticket_enqueued_at_ms === mineOld.enqueued_at_ms,
     'the ticket carries the time this run FIRST asked, not the time of the latest poll');
}
{
  // Two runs enqueued in the same millisecond must still agree on which is first, or both take
  // the lease and the queue has produced the collision it exists to prevent.
  const now = Date.now();
  // BOTH runs need a ticket at the SAME millisecond, or there is no tie to break. The first
  // version of this test gave zzz-run no ticket, so it enqueued at `now`, lost on time alone,
  // and the assertion passed without the tie-break ever running - caught by mutating the
  // tie-break to a no-op and watching this test stay green.
  const same = now - 60000;
  const tieA = ticket({ ticket_key: 'aaa-run', enqueued_at_ms: same, last_seen_ms: now - 1000 });
  const tieZ = ticket({ ticket_key: 'zzz-run', enqueued_at_ms: same, last_seen_ms: now - 1000 });
  const qz = run('acquire', { row: row({ state: 'free', holder_run_id: '' }), queue: [tieA, tieZ],
                              runId: 'zzz-run' });
  const qa = run('acquire', { row: row({ state: 'free', holder_run_id: '' }), queue: [tieA, tieZ],
                              runId: 'aaa-run' });
  ok(qz.json._action === 'queue' && qa.json._action === 'acquire',
     'an exact tie on enqueue time is broken deterministically - exactly one of the two proceeds');
}
{
  // The override exists to escape a lease that should not be there. Making it wait its turn
  // behind the queue it is trying to escape would defeat it.
  const now = Date.now();
  const ahead = ticket({ ticket_key: 'run-A', enqueued_at_ms: now - 600000, last_seen_ms: now - 1000 });
  const q = run('acquire', { queue: [ahead], runId: 'me', ignore: true });
  ok(q.json._action === 'acquire' && /OVERRIDE/.test(q.json._reason),
     'the override deliberately jumps the queue - that is what it is for');
}

console.log('\n--- fair share between operators ---');
// Several people share this workspace. Plain FIFO is unfair the moment one of them queues more
// than one run: fire three audits and the next person waits three full holds - 45-90 minutes
// each - through no fault of their own.
{
  const now = Date.now();
  // Hassan fires H1 H2 H3, THEN Abdullah fires A1. Under plain FIFO Abdullah is fourth.
  const H1 = ticket({ ticket_key: 'H1', operator: 'hassan', enqueued_at_ms: now - 40000, last_seen_ms: now - 1000 });
  const H2 = ticket({ ticket_key: 'H2', operator: 'hassan', enqueued_at_ms: now - 30000, last_seen_ms: now - 1000 });
  const H3 = ticket({ ticket_key: 'H3', operator: 'hassan', enqueued_at_ms: now - 20000, last_seen_ms: now - 1000 });
  const A1 = ticket({ ticket_key: 'A1', operator: 'abdullah', enqueued_at_ms: now - 10000, last_seen_ms: now - 1000 });
  const all = [H1, H2, H3, A1];
  const free = row({ state: 'free', holder_run_id: '' });

  function pos(runId, operator) {
    return run('acquire', { row: free, queue: all, runId: runId, operator: operator }).json._queue_position;
  }
  ok(pos('H1', 'hassan') === 1, 'the first run to ask is still first', pos('H1', 'hassan'));
  ok(pos('A1', 'abdullah') === 2,
     'the SECOND operator is second even though he queued fourth - one person cannot monopolise by firing several',
     pos('A1', 'abdullah'));
  ok(pos('H2', 'hassan') === 3 && pos('H3', 'hassan') === 4,
     'and that operator keeps FIFO order within his own runs');

  // Round-robin between operators, FIFO within one. Turning it on must not change anything for
  // a queue that has only one operator in it - that is what makes it safe.
  const onlyHassan = [H1, H2, H3];
  const p1 = run('acquire', { row: free, queue: onlyHassan, runId: 'H1', operator: 'hassan' }).json._queue_position;
  const p3 = run('acquire', { row: free, queue: onlyHassan, runId: 'H3', operator: 'hassan' }).json._queue_position;
  ok(p1 === 1 && p3 === 3,
     'with one operator waiting it behaves exactly like plain FIFO');
}
{
  // A caller that passes no operator must lose nothing it had. Every run becomes its own
  // operator, every round is 0, and the order is plain arrival order.
  const now = Date.now();
  const older = ticket({ ticket_key: 'first-run', enqueued_at_ms: now - 60000, last_seen_ms: now - 1000 });
  const q = run('acquire', { row: row({ state: 'free', holder_run_id: '' }), queue: [older], runId: 'later-run' });
  ok(q.json._action === 'queue',
     'no operator passed means plain FIFO, so nothing regresses for a caller that does not know about this');

  // A BLANK OPERATOR MUST MEAN "its own operator", not "everyone shares one bucket". The two
  // read identically until anonymous runs compete with a named one, which is why the first
  // version of this test could not tell them apart - it had only one anonymous waiter, and
  // mutating the fallback to a shared 'default' left it green.
  //
  //   blank1 (t0), blank2 (t1), hassan H1 (t2)
  //     own-operator  -> blank1, blank2, H1     (all round 0, plain arrival order)
  //     shared bucket -> blank1, H1, blank2     (blank2 pushed into round 1 behind a later run)
  const b1 = ticket({ ticket_key: 'blank1', operator: '', enqueued_at_ms: now - 30000, last_seen_ms: now - 1000 });
  const b2 = ticket({ ticket_key: 'blank2', operator: '', enqueued_at_ms: now - 20000, last_seen_ms: now - 1000 });
  const h1 = ticket({ ticket_key: 'H1', operator: 'hassan', enqueued_at_ms: now - 10000, last_seen_ms: now - 1000 });
  const mixed = [b1, b2, h1];
  const free = row({ state: 'free', holder_run_id: '' });
  const posB2 = run('acquire', { row: free, queue: mixed, runId: 'blank2' }).json._queue_position;
  const posH1 = run('acquire', { row: free, queue: mixed, runId: 'H1', operator: 'hassan' }).json._queue_position;
  ok(posB2 === 2 && posH1 === 3,
     'two runs with no operator are two operators, not one shared bucket - neither is pushed behind a later arrival',
     'blank2=' + posB2 + ' H1=' + posH1);
}

console.log('\n--- the lease must never be the reason a run fails ---');
{
  const now = Date.now();
  // Four hours in the queue. There is no default limit, so it is still waiting: a run that has
  // done nothing wrong must not be killed by the mechanism that exists to protect ERP.
  const veryOld = ticket({ ticket_key: 'me', enqueued_at_ms: now - 4 * HOUR, last_seen_ms: now - 1000 });
  const patient = run('acquire', { queue: [veryOld], runId: 'me' });
  ok(patient.json._action === 'queue',
     'a run that has queued for four hours is STILL waiting - the queue has no default timeout');
  ok(patient.json._max_wait_ms === Infinity,
     'and it reports that it has no limit rather than a large one');

  // A caller that would genuinely rather fail fast can still ask for a limit.
  throwsWith(() => run('acquire', { queue: [veryOld], runId: 'me', maxWaitMs: 60 * 60000 }),
    'an explicitly requested limit is still honoured',
    'QUEUE TIMED OUT', 'THIS CALLER ASKED FOR A LIMIT');

  // The limit is opt-in, so the message must not read as though the system chose it.
  let msg = '';
  try { run('acquire', { queue: [veryOld], runId: 'me', maxWaitMs: 60 * 60000 }); }
  catch (e) { msg = e.message; }
  ok(/no default limit/.test(msg) && /Drop it to wait indefinitely/.test(msg),
     'and it says the limit was the caller\'s choice, not the system giving up');
}

console.log('\n--- the read-back: acquire is three nodes, so it is not atomic ---');
// Get Lease Row -> Decide Lease -> Write Lease. Two audits starting in the same instant can
// both read "free", both decide acquire, and both write - last write wins and BOTH proceed
// believing they are alone. There is no compare-and-swap on the Data Table, so the write is
// checked after the fact instead.
{
  const decidedAcquire = { lease_key: 'erp', state: 'held', holder_run_id: 'me',
    holder_check_id: 'cc-below-agreed', acquired_at_iso: '', acquired_at_ms: Date.now(),
    _action: 'acquire', _reason: 'lease was free', _write: true };

  const won = verify('acquire', decidedAcquire, row({ state: 'held', holder_run_id: 'me' }), 'me');
  ok(won.json && won.json.granted === true && won.json.verified === true,
     'the run whose id is in the row after the settle proceeds');
  ok(won.json.holder_run_id === 'me',
     'the CONFIRMED row is reported, not the one we intended to write');

  throwsWith(() => verify('acquire', decidedAcquire, row({ state: 'held', holder_run_id: 'other-run' }), 'me'),
    'the run that lost the race refuses, instead of two audits both believing they are alone',
    'LOST THE RACE', 'other-run');
  throwsWith(() => verify('acquire', decidedAcquire, row({ state: 'held', holder_run_id: 'other-run' }), 'me'),
    'and it is told not to release what it does not hold',
    'must not release');

  // Exactly one winner falls out of the store holding exactly one holder_run_id: the two runs
  // do not have to agree with each other, they only have to agree with the row.
  const a = () => verify('acquire', decidedAcquire, row({ state: 'held', holder_run_id: 'run-A' }), 'run-A');
  let bThrew = false;
  try { verify('acquire', decidedAcquire, row({ state: 'held', holder_run_id: 'run-A' }), 'run-B'); }
  catch (e) { bThrew = true; }
  ok(a().json.granted === true && bThrew,
     'of two runs reading the same row back, exactly one proceeds and one dies');

  throwsWith(() => verify('acquire', decidedAcquire, null, 'me'),
    'a row that vanished between write and read-back stops the run rather than being guessed at',
    'read back NOTHING');
}
{
  const decidedRelease = { lease_key: 'erp', state: 'free', holder_run_id: '', holder_check_id: '',
    acquired_at_iso: '', acquired_at_ms: 0, _action: 'release', _reason: 'released by its holder',
    _write: true };
  const freed = verify('release', decidedRelease, row({ state: 'free', holder_run_id: '' }), 'me');
  ok(freed.json && freed.json.state === 'free' && freed.json.granted === false,
     'a release that landed reports the lease free');

  throwsWith(() => verify('release', decidedRelease, row({ state: 'held', holder_run_id: 'me' }), 'me'),
    'a release that did NOT land throws - otherwise the next audit is blocked for three hours by a finished run',
    'did not land');

  // Someone else acquiring in the settle window is legitimate, not a failure: we released, they
  // took it. Treating that as an error would make every busy handover look like a defect.
  const handedOver = verify('release', decidedRelease, row({ state: 'held', holder_run_id: 'next-run' }), 'me');
  ok(handedOver.json && handedOver.json.holder_run_id === 'next-run',
     'another run acquiring during the settle window is a handover, not a fault');
}
{
  // The no-op is the branch that already had one silent-steal bug in it. The read-back is a
  // second, independent chance to catch the same class of defect.
  const decidedNoop = { lease_key: 'erp', state: 'held', holder_run_id: 'other-run',
    holder_check_id: 'cc-non-received', acquired_at_iso: '', acquired_at_ms: Date.now() - 60000,
    _action: 'noop', _reason: 'lease is held by run other-run, not by this run', _write: false };
  const nooped = verify('release', decidedNoop, row({ state: 'held', holder_run_id: 'other-run' }), 'me');
  ok(nooped.json && nooped.json.action === 'noop' && nooped.json.holder_run_id === 'other-run',
     'a no-op release reads back the other run still holding it');

  throwsWith(() => verify('release', decidedNoop, row({ state: 'held', holder_run_id: 'me' }), 'me'),
    'a no-op that wrote US into the row is caught by the read-back too, not just by Decide Lease',
    'no-op', 'silently steals');
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
