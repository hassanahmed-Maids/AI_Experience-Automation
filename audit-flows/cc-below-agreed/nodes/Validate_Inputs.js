// Validate Inputs - CC Monthly Payments Below Agreed Amount (v1)
//
// CLONED from the Travel Assist golden (LM7ofq89VWXiLRU0) with TWO added blocks,
// both marked below: the ERP window limits, and the three persistence windows
// gate 18 needs. Everything else -
// the secret check, the callback_url allowlist, the bearer shape check, the
// window derivation - is skeleton and must not be re-derived per check.
//
// The /ta-callback/ path shape is DELIBERATELY unchanged: it is the portal's
// callback route for every check, not a Travel-Assist-specific path, and
// Merge Agent Verdicts derives the agent-review URL from it by substitution.
//
// --- golden header follows, unedited ---
// Validate Inputs - Travel Assist Payments Audit (v4)
//
// SOURCE OF TRUTH: E:/Claude Code/n8n/travel_assist/validate_inputs.js
//
// CHANGES vs v3 (2026-08-06) - SECURITY HARDENING. Three holes, all reachable
// from the open internet because the Webhook node has no authentication of its
// own (`options: {}`), and this node is the only thing standing between a POST
// and eleven authenticated ERP reads:
//
//   1. EXFILTRATION VIA callback_url (the serious one). `callback_url` was
//      accepted verbatim and later POSTed to with the ENTIRE audit - client
//      names, contract ids, maid names, every payment figure - and again with
//      the AI verdicts. Anyone who could reach the webhook could name their own
//      host and have this workflow courier the audit to it. It is now checked
//      against an ORIGIN ALLOWLIST plus the exact `/ta-callback/<64-hex>` path
//      shape. Nothing else can receive this data, whatever the caller asks for.
//      (`Merge Agent Verdicts` derives the agent-review URL from this same
//      value, so allowlisting here covers both callbacks.)
//
//   2. THE SHARED SECRET WAS SENT BUT NEVER CHECKED. `ta-trigger-run` has been
//      sending `X-SR-Webhook-Secret` on every call - confirmed live in the
//      request headers of execution 77442 - and nothing in this workflow ever
//      looked at it. It is now required. That turns "anyone who knows the URL"
//      into "anyone who knows the URL AND the secret".
//      NOT A REAL SECRET AGAINST AN INSIDER: it travels in plaintext, appears
//      in every execution's data, and is compared against a constant below, so
//      anyone with read access to this n8n project can see it. It exists to
//      keep strangers out, not colleagues. Rotating it to a random value in an
//      `httpHeaderAuth` credential on the Webhook node is STILL the open item -
//      that needs a UI click (the n8n API can neither create a credential nor
//      attach one) and a matching change to the portal's SR_WEBHOOK_SECRET, in
//      that order. What changed 2026-08-19: the expected value is now a SET of
//      named slots rather than one literal, so that rotation no longer has an
//      ordering in which the audit silently stops running. See
//      ACCEPTED_WEBHOOK_SECRETS below and RUNBOOK-trigger.md for the sequence.
//
//   3. HEADER INJECTION VIA THE BEARER TOKEN. `params.erp_auth.bearer` is
//      interpolated straight into the `authorization` header of eleven HTTP
//      nodes. A value containing CR/LF could smuggle extra headers into those
//      requests. It is now shape-checked (`Bearer <JWT>`, no control chars).
//
// CHANGES vs v2 (2026-08-06):
//   ERP auth is supplied by the CALLER again. ta-trigger-run now reads the
//   token belonging to the triggering user from the portal `erp_credentials`
//   table and sends it as params.erp_auth.bearer (it already carries the
//   'Bearer ' prefix), and the 11 ERP nodes read it from there instead of the
//   shared "ERP Hassan Prod" credential.
//
//   The token is validated HERE because every ERP node depends on it: without
//   this check a missing token fails eleven nodes one at a time on an
//   unresolvable expression, which is both noisy and hard to read. Tokens in
//   erp_credentials expire after 24h, so a missing or stale one is a NORMAL,
//   expected rejection - the caller re-saves the token and triggers again.
//
// CHANGES vs v1 (2026-08-05):
//   `auth` (the old auth.erp.token shape) is no longer required. An `auth`
//   object from an older caller is accepted and ignored, so a stale Security
//   Room deploy degrades gracefully instead of hard-failing.

const incoming = $input.first().json || {};
const payload = incoming.body || incoming || {};
const headers = incoming.headers || {};

// ---------------------------------------------------------------- security ---
// Header names arrive lowercased from n8n's webhook node; read defensively
// anyway so a proxy that preserves case cannot bypass the check.
function header(name) {
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === want) return String(headers[k] || '');
  }
  return '';
}

// Length-independent compare. Not a defence against a real timing attack over
// the internet (jitter swamps it), but it costs nothing and stops the trivial
// prefix-probing case.
function safeEqual(a, b) {
  const A = String(a), B = String(b);
  let diff = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    diff |= (A.charCodeAt(i) || 0) ^ (B.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// THE ACCEPTED SECRETS, AS A SET, AND THE SET IS THE POINT.
//
// Rotating this into an httpHeaderAuth credential on the Webhook node needs three changes
// in three different places - the credential, the portal's SR_WEBHOOK_SECRET, and this
// value - and with a single literal there is NO ordering that avoids an outage: change the
// portal first and every call is rejected here; change here first and every call is
// rejected by the portal's old value. The audit silently stops running and the only
// evidence is 'unauthorized' rejections in the execution list.
//
// So the check takes a SET. Rotation becomes: (1) add the new secret to this array and
// publish, (2) create the credential and switch the portal, (3) confirm from the
// secret_slot_matched log line below that live traffic is arriving on the new slot, (4)
// remove the old entry. No window in which both sides disagree.
//
// Slot names are logged, VALUES ARE NEVER LOGGED. 'live' is the value the portal has been
// sending all along (see header comment #2).
const ACCEPTED_WEBHOOK_SECRETS = [
  { slot: 'live', value: 'LAWP' }
  // { slot: 'rotating', value: '<the new random value>' }   <- step 1 of a rotation
];

// Only these origins may receive the audit results. Both are real: the
// Cloudflare Worker proxy the portal normally uses, and the direct Supabase
// functions host it falls back to when CALLBACK_BASE_URL is unset.
const CALLBACK_ORIGIN_ALLOWLIST = [
  'https://security-room-n8n-callback-proxy.hassan-ahmed-e4c.workers.dev',
  'https://nnbyjbdbigcpoqtsczlz.supabase.co'
];
// `Merge Agent Verdicts` requires '/ta-callback/' in this URL to derive the
// agent-review endpoint, and the token is 32 random bytes hex-encoded.
const CALLBACK_PATH_RE = /^(?:\/functions\/v1)?\/ta-callback\/[0-9a-f]{64}$/;

// Split an https URL into [origin, path] WITHOUT the global `URL` constructor.
//
// This is not stylistic. n8n's Code sandbox does not expose `URL`, so the first
// version of this guard - which called `new URL(callback_url)` inside a
// try/catch - threw on EVERY request and rejected every caller, including the
// portal. It looked like a working allowlist in offline tests and in the three
// live attack probes; it was actually a total outage of the audit, and only a
// probe with a VALID callback_url exposed it (the guard fired for the wrong
// reason). Hence: parse with a regex, and prove the parser survives `URL` being
// undefined - security.test.mjs runs this file with the global shadowed away.
//
// The pattern is deliberately strict rather than lenient:
//   [^/?#@]+  host cannot contain '@', so `https://allowed.host@evil.com/...`
//             (userinfo trick) cannot borrow an allowlisted origin
//   no '?'/'#' in the path group, so nothing can be appended after the token
//   https only - a plaintext downgrade of an allowed host is not an allowed host
function splitHttpsUrl(raw) {
  const s = String(raw || '');
  // Control characters, whitespace and backslashes have no business in a URL we
  // are about to POST client payment data to.
  if (/[^\x21-\x7e]/.test(s)) return null;   // printable ASCII only
  if (s.indexOf('\\') !== -1) return null;
  const m = /^(https:\/\/[^/?#@]+)(\/[^?#]*)$/.exec(s);
  if (!m) return null;
  if (m[2].indexOf('..') !== -1) return null;   // no traversal off the callback route
  return { origin: m[1], path: m[2] };
}

function reject(message, extra) {
  return [{ json: Object.assign({
    _error: true,
    message: message,
    check_id:     payload.check_id     || '',
    run_id:       payload.run_id       || '',
    // Deliberately NOT echoing the caller's callback_url on a rejection: on the
    // paths that reject for security reasons it is exactly the value we refuse
    // to trust, and Build Error Callback would POST to it.
    callback_url: ''
  }, extra || {})}];
}

const providedSecret = header('x-sr-webhook-secret');
// EVERY slot is compared, and the loop does not break early: bailing out on the first match
// would make the number of comparisons depend on which slot matched, which is the timing
// leak safeEqual exists to avoid. matchedSlot is assigned, not returned.
let matchedSlot = '';
for (let i = 0; i < ACCEPTED_WEBHOOK_SECRETS.length; i++) {
  const cand = ACCEPTED_WEBHOOK_SECRETS[i];
  if (providedSecret && safeEqual(providedSecret, cand.value)) matchedSlot = cand.slot;
}
if (!matchedSlot) {
  // Terse on purpose - do not tell an unauthenticated caller which part failed.
  //
  // `_silent` suppresses the failure EMAIL for this branch only, and that is a
  // deliberate trade, not laziness: this is the one rejection an anonymous
  // caller can trigger at will, so alerting on it hands anyone who finds the
  // URL a mail-bomb aimed at Abdullah's inbox. The rejection is still recorded
  // in the n8n execution list, which is where you go to see whether someone is
  // knocking. Every other rejection below still emails, because reaching those
  // requires knowing the secret - that is a colleague or a leak, both worth
  // waking up for.
  return reject('unauthorized', { _silent: true });
}

const required = ['check_id', 'run_id', 'callback_url', 'audit_window'];
const missing = required.filter(k =>
  payload[k] === undefined || payload[k] === null || payload[k] === ''
);
if (missing.length) {
  return [{ json: {
    _error: true,
    message: 'Missing required field(s): ' + missing.join(', '),
    check_id:     payload.check_id     || '',
    run_id:       payload.run_id       || '',
    callback_url: payload.callback_url || ''
  }}];
}

// ----- callback_url: WHERE the audit is allowed to be sent -----
// Checked before anything else touches ERP, because this single field decides
// who receives every figure this run produces.
const cbRaw = String(payload.callback_url || '');
const cbUrl = splitHttpsUrl(cbRaw);
if (!cbUrl ||
    CALLBACK_ORIGIN_ALLOWLIST.indexOf(cbUrl.origin) === -1 ||
    !CALLBACK_PATH_RE.test(cbUrl.path)) {
  return reject('callback_url is not an approved Security Room callback endpoint. ' +
    'This audit will only post results to a known host on the exact ' +
    '/ta-callback/<token> path - refusing to send client payment data anywhere else.');
}

const w = payload.audit_window;
if (!w || typeof w !== 'object' || !w.kind) {
  return [{ json: { _error: true, message: 'audit_window missing or malformed',
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}

// ----- ERP token (caller-supplied) -----
const erpAuth = (payload.params && payload.params.erp_auth) || {};
const bearer = typeof erpAuth.bearer === 'string' ? erpAuth.bearer.trim() : '';
if (!bearer) {
  return [{ json: { _error: true,
    message: 'params.erp_auth.bearer is required - every ERP call in this audit ' +
             'authenticates with the caller-supplied token. In the Security Room it comes ' +
             'from the saved ERP credentials of the triggering user; if it is missing or has ' +
             'expired (they last 24h), re-save the token and trigger the run again.',
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}
// Shape check, not a validity check: this string is interpolated into the
// `authorization` header of eleven HTTP nodes, so a CR/LF in it could append
// attacker-chosen headers to authenticated ERP requests. ERP itself decides
// whether the token is good.
if (!/^Bearer [A-Za-z0-9._~+/=-]+$/.test(bearer)) {
  return reject('params.erp_auth.bearer is malformed - expected "Bearer <token>" ' +
    'with no whitespace or control characters. Re-save the ERP token in the portal.');
}

function pad(n) { return String(n).padStart(2, '0'); }
let range_start, range_end, audit_month;

if (w.kind === 'month') {
  const year = parseInt(w.year, 10), month = parseInt(w.month, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [{ json: { _error: true, message: 'audit_window.month invalid: ' + JSON.stringify(w),
      check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
  }
  range_start = year + '-' + pad(month) + '-01';
  range_end   = year + '-' + pad(month) + '-' + pad(new Date(year, month, 0).getDate());
  audit_month = year + '-' + pad(month);
} else if (w.kind === 'date_range') {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(w.from || '') || !re.test(w.to || '') || w.to < w.from) {
    return [{ json: { _error: true, message: 'audit_window date_range invalid',
      check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
  }
  range_start = w.from;
  range_end   = w.to;
  audit_month = w.from.slice(0, 7);
} else {
  return [{ json: { _error: true, message: 'audit_window.kind unsupported: ' + w.kind,
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}

// ---------------------------------------------------------------- CC check ---
// ENDPOINT WINDOW LIMITS - the only edit to this skeleton node, and it belongs
// here because it is the one rejection that must reach the caller as a 400.
//
// The ACTUAL side of this check reads /accounting/payments/getReceivedClientsPayments,
// which enforces BOTH limits below with HTTP 400 - not silent truncation:
//   * the window may not exceed 31 days
//   * from-date must be within the last 6 months
// Month seven is unreachable at any price; that is a Jira ask, not a retry.
// Without this block the run answers 200, fires the bulk pulls, and dies on the
// error rail for a reason the caller cannot see.
function daysInclusive(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
}
const spanDays = daysInclusive(range_start, range_end);
if (!Number.isFinite(spanDays) || spanDays < 1 || spanDays > 31) {
  return [{ json: { _error: true,
    message: 'audit window must be 1-31 days (got ' + spanDays + '): the ERP received-payments ' +
             'endpoint rejects anything longer with HTTP 400. Audit one calendar month per run.',
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}
const sixMonthFloor = new Date();
sixMonthFloor.setUTCMonth(sixMonthFloor.getUTCMonth() - 6);
const floorStr = sixMonthFloor.toISOString().slice(0, 10);
if (range_start < floorStr) {
  return [{ json: { _error: true,
    message: 'audit window starts ' + range_start + ', earlier than the ERP 6-month floor (' +
             floorStr + '). The received-payments endpoint returns HTTP 400 before that date, so ' +
             'the month cannot be audited from this source at all - raise it with the ERP team ' +
             'rather than re-running.',
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}

// ------------------------------------------------- CC Below Agreed Amount ---
// THE THREE PERSISTENCE WINDOWS. Gate 18 (Order 128) is what makes this check
// survivable without freeze data: a wrong rate persists across months, a light
// month does not. Measured Jun-Aug 2026, a single-month test flags 17 frozen
// contracts and the persistence test cuts that to 2 - an 88% reduction using no
// freeze field at all, which matters because ERP stores NO freeze date anywhere.
//
// So the run needs three months, and the payments endpoint caps at a 31-day
// window, which is why they are derived here as three explicit windows rather
// than one long range. Index 0 is ALWAYS the audited month; 1 and 2 are the two
// before it, most recent first.
//
// The 6-month floor is checked against the OLDEST window, not the audited one -
// auditing July needs May, and May is what would 400 first.
function monthWindow(y, m) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { key: y + '-' + pad(m), from: y + '-' + pad(m) + '-01', to: y + '-' + pad(m) + '-' + pad(last) };
}
const auditY = Number(audit_month.slice(0, 4));
const auditM = Number(audit_month.slice(5, 7));
const persistence_windows = [];
for (let back = 0; back < 3; back++) {
  const d = new Date(Date.UTC(auditY, auditM - 1 - back, 1));
  const w = monthWindow(d.getUTCFullYear(), d.getUTCMonth() + 1);
  w.node = back === 0 ? 'Get Month Payments'
                      : (back === 1 ? 'Get Payments (M-1)' : 'Get Payments (M-2)');
  persistence_windows.push(w);
}
const oldestFrom = persistence_windows[persistence_windows.length - 1].from;
const floor6 = new Date();
floor6.setUTCMonth(floor6.getUTCMonth() - 6);
const floor6Str = floor6.toISOString().slice(0, 10);
if (oldestFrom < floor6Str) {
  return [{ json: { _error: true,
    message: 'the persistence window reaches back to ' + oldestFrom + ', earlier than the ERP ' +
      '6-month floor (' + floor6Str + '). The received-payments endpoint returns HTTP 400 before ' +
      'that date, so gate 18 cannot be evaluated for ' + audit_month + ' - and without it the freeze ' +
      'false positives return (17 flagged where 2 are real). Audit a more recent month, or raise ' +
      'the window limit with the ERP team.',
    check_id: payload.check_id, run_id: payload.run_id, callback_url: payload.callback_url }}];
}

const previous_cases = Array.isArray(payload.params && payload.params.previous_cases)
  ? payload.params.previous_cases
  : [];

// The SLOT, never the value. This one line is what makes a credential rotation verifiable:
// after the portal is switched, a run logging secret_slot_matched 'rotating' proves live
// traffic is on the new secret, and only then is the old slot safe to delete. Without it,
// removing the old entry is a guess that fails the next time the check is triggered.
console.log(JSON.stringify({ stage: 'validate_inputs', secret_slot_matched: matchedSlot,
  accepted_slots: ACCEPTED_WEBHOOK_SECRETS.map(function (c) { return c.slot; }),
  audit_month: audit_month, range_start: range_start, range_end: range_end,
  note: 'slot names only - the secret value is never logged, and it must never be added ' +
        'here even temporarily: every log line lands in the stored execution record.' }));

return [{ json: {
  _error: false,
  check_id:     payload.check_id,
  run_id:       payload.run_id,
  callback_url: payload.callback_url,
  audit_window: w,
  audit_month, range_start, range_end,
  persistence_windows,
  range_start_dt: range_start + ' 00:00:00',
  range_end_dt:   range_end + ' 23:59:00',
  auth_mode:    'caller_payload:params.erp_auth.bearer',
  webhook_secret_slot: matchedSlot,
  params:       payload.params || {},
  previous_cases
}}];
