// Offline suite for Validate Inputs - the security block only. This node is the ONLY thing
// between an internet POST and eleven authenticated ERP reads, so every branch that decides
// "this caller may proceed" is asserted here rather than reasoned about.
//
// Added 2026-08-19 with the dual-secret change. The reason the secret is a SET and not a
// literal: rotating it into an httpHeaderAuth credential needs three coordinated changes
// (credential, portal SR_WEBHOOK_SECRET, this file) and with one literal there is no
// ordering that avoids an outage. The tests below pin the rotation behaviour so the set
// cannot be quietly collapsed back to a single value.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Validate_Inputs.js'), 'utf8');

const GOOD_CB = 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' +
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const GOOD_BEARER = 'Bearer eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';

function run(src, headers, payload) {
  const logs = [];
  const item = { json: { headers: headers, body: payload } };
  // The node reaches for the URL constructor nowhere, and that is load-bearing: n8n's Code
  // sandbox does not expose it, and an earlier version threw on every request because it
  // did. Shadow it away so a reintroduced `new URL(...)` fails here rather than in prod.
  const fn = new Function('$input', 'console', 'URL',
    '"use strict";\n' + src);
  const out = fn({ first: () => item, all: () => [item] }, { log: m => logs.push(m) }, undefined);
  return { json: out[0].json,
           log: logs.map(x => { try { return JSON.parse(x) } catch (e) { return {} } }).pop() || {} };
}
function body(extra) {
  return Object.assign({
    check_id: 'cc-below-agreed', run_id: 'r-1', callback_url: GOOD_CB,
    audit_window: { kind: 'month', year: 2026, month: 7 }, params: { erp_auth: { bearer: GOOD_BEARER } }
  }, extra || {});
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

// The set as it stands today, read out of the source so the test cannot drift from it.
// Scanned out of the source so the test cannot drift from the real set - but COMMENTED-OUT
// entries are excluded, because the rotation template line is a comment and picking it up
// would have the suite assert that a placeholder secret is accepted.
const SLOTS = SRC.split(String.fromCharCode(10))
  .filter(l => l.indexOf('//') === -1 || l.indexOf('{ slot:') < l.indexOf('//'))
  .map(l => /\{ slot: '([a-z]+)', value: '([^']*)' \}/.exec(l))
  .filter(Boolean)
  .map(m => ({ slot: m[1], value: m[2] }));
ok(SLOTS.length >= 1, 'at least one accepted secret slot is defined', 'found ' + SLOTS.length);
ok(SLOTS.some(s => s.slot === 'live'), 'the live slot exists and is named live');

// ---- the accepting path -------------------------------------------------------------
for (const sl of SLOTS) {
  const r = run(SRC, { 'x-sr-webhook-secret': sl.value }, body());
  ok(r.json._error === false, 'a caller presenting the "' + sl.slot + '" secret is accepted',
     r.json.message);
  ok(r.json.webhook_secret_slot === sl.slot,
     'the validated payload records which slot matched (' + sl.slot + ')');
  ok(r.log.secret_slot_matched === sl.slot,
     'the log names the matched slot, which is what makes a rotation verifiable');
}
// THE VALUE MUST NEVER BE LOGGED. This is asserted rather than trusted, because the log
// line lands in the stored execution record and the whole point of the rotation is that
// reading the record does not hand you the secret.
{
  const r = run(SRC, { 'x-sr-webhook-secret': SLOTS[0].value }, body());
  const dumped = JSON.stringify(r.log) + JSON.stringify(r.json);
  ok(dumped.indexOf(SLOTS[0].value) === -1 || SLOTS[0].value.length < 3,
     'the secret VALUE appears in neither the log line nor the validated payload');
}

// ---- the rejecting paths ------------------------------------------------------------
const rejects = [
  ['no header at all', {}],
  ['an empty header', { 'x-sr-webhook-secret': '' }],
  ['a wrong secret', { 'x-sr-webhook-secret': 'not-the-secret' }],
  ['a PREFIX of the real secret', { 'x-sr-webhook-secret': SLOTS[0].value.slice(0, -1) }],
  ['the real secret with a suffix', { 'x-sr-webhook-secret': SLOTS[0].value + 'x' }],
  ['a case-changed secret', { 'x-sr-webhook-secret': SLOTS[0].value.toLowerCase() === SLOTS[0].value
      ? SLOTS[0].value.toUpperCase() : SLOTS[0].value.toLowerCase() }]
];
for (const [label, hdrs] of rejects) {
  const r = run(SRC, hdrs, body());
  ok(r.json._error === true && r.json.message === 'unauthorized',
     'rejected: ' + label + ' - and the message says only "unauthorized"', r.json.message);
  ok(r.json._silent === true,
     '  ...and stays silent, so the one rejection an anonymous caller can trigger at will ' +
     'is not a mail-bomb aimed at a colleague');
  ok(r.json.callback_url === '',
     '  ...and does not echo the callback_url it was asked to trust');
}
// Header case is normalised by n8n but read defensively, so a case-preserving proxy in
// front of it cannot bypass the check by sending a differently-cased header NAME.
{
  const r = run(SRC, { 'X-SR-Webhook-Secret': SLOTS[0].value }, body());
  ok(r.json._error === false, 'a differently-cased header NAME is still read (not bypassed)');
}

// ---- callback_url: the exfiltration guard, which the secret does not replace ---------
const badCallbacks = [
  ['an attacker-owned host', 'https://evil.example.com/functions/v1/ta-callback/' + 'a'.repeat(64)],
  ['the userinfo trick', 'https://nnbyjbdbigcpoqtsczlz.supabase.co@evil.example.com/ta-callback/' + 'a'.repeat(64)],
  ['plaintext http downgrade', GOOD_CB.replace('https://', 'http://')],
  ['a query string appended after the token', GOOD_CB + '?x=1'],
  ['a short token', 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/abc'],
  ['path traversal off the callback route', GOOD_CB.replace('/ta-callback/', '/ta-callback/../')]
];
for (const [label, cb] of badCallbacks) {
  const r = run(SRC, { 'x-sr-webhook-secret': SLOTS[0].value }, body({ callback_url: cb }));
  ok(r.json._error === true, 'callback_url rejected: ' + label,
     'ACCEPTED it - the audit would be couriered to that host');
}
ok(run(SRC, { 'x-sr-webhook-secret': SLOTS[0].value }, body()).json._error === false,
   'the real portal callback_url is still accepted (the guard is not simply refusing all)');

// ---- the bearer shape check ----------------------------------------------------------
const badBearers = [
  ['missing entirely', undefined],
  ['no Bearer prefix', 'eyJhbGciOiJIUzUxMiJ9.e30.sig'],
  ['a CRLF header-injection attempt', GOOD_BEARER + '\r\nx-injected: 1'],
  ['a bare newline', GOOD_BEARER + '\nx: 1']
];
for (const [label, bearer] of badBearers) {
  const p = body({ params: bearer === undefined ? {} : { erp_auth: { bearer: bearer } } });
  const r = run(SRC, { 'x-sr-webhook-secret': SLOTS[0].value }, p);
  ok(r.json._error === true, 'bearer rejected: ' + label,
     'ACCEPTED it - that value is interpolated into eleven authorization headers');
}

console.log('\n' + pass + '/' + (pass + fail) + ' assertions behaved as specified');
process.exit(fail ? 1 : 0);
