// Build Error Callback (v4)
//
// v1 silently SWALLOWED real ERP failures. Proven live in execution 76767: an ERP
// 498 "Access Token is missing or malformed" produced
//   {result:'ok', _suppressed:true, _reason:'no upstream error signal'}
// twice, and the run reported success with no callback at all. Two causes:
//   1. n8n's HTTP error item has NO `error.message`. The text lives in
//      `error.error` as a JSON *string*, alongside error.statusCode,
//      error.response.status and isAxiosError. v1 only read error.message.
//   2. `_error` is FALSE on those items - Validate Inputs sets `_error:false` and
//      the field flows downstream - so `first._error === true` could never fire,
//      and v1 read that as evidence there was no error.
//
// Classification is driven by STATUS CODE first and substring matching last.
// v1's `msg.includes('5') && msg.includes('0')` matched any message containing a
// 5 and a 0, so seven-digit contract ids tripped it and `timeout` was unreachable.
//
// DEDUPE (v3): the bulk pulls run in PARALLEL, so several branches can fail at the
// same instant and this node gets triggered once per failing branch. Execution
// 76796 sent TWO error callbacks for one run - and would now send two alert emails.
// Only the first run emits; later runs return nothing, so Error Gate stays empty
// and neither the callback nor the email fires twice.
//
// CONTEXT RECOVERY (v4): execution 77172 emitted check_id/run_id/callback_url all
// EMPTY, so `Callback - Error` failed with "URL parameter cannot be empty" and the
// Security Room was never told the run had died - it would sit on "running" for
// ever. Cause: context came only from `$('Validate Inputs').first()`, which THROWS
// when n8n cannot trace paired-item lineage back from an arbitrary failed node.
// The empty catch swallowed that, and every remaining fallback read the HTTP error
// item, which of course carries no run identifiers. v4 therefore tries several
// INDEPENDENT accessors and accepts only a candidate that actually carries a
// callback_url - losing the callback URL is the one failure that makes this whole
// node pointless.
if ($runIndex > 0) {
  console.log(JSON.stringify({ stage: 'build_error_callback',
    suppressed_duplicate: true, run_index: $runIndex }));
  return [];
}

function tryGet(fn) {
  try {
    const v = fn();
    return (v && typeof v === 'object') ? v : null;
  } catch (e) { return null; }
}
function hasUrl(o) { return !!(o && typeof o.callback_url === 'string' && o.callback_url.trim()); }

const candidates = [
  tryGet(function () { return $('Validate Inputs').first().json; }),
  tryGet(function () { return $('Validate Inputs').all()[0].json; }),
  tryGet(function () { const j = $('Webhook').first().json; return j.body || j; }),
  tryGet(function () { const j = $('Webhook').all()[0].json; return j.body || j; })
];
let ctx = null;
for (let i = 0; i < candidates.length; i++) {
  if (hasUrl(candidates[i])) { ctx = candidates[i]; break; }
}
if (!ctx) { for (let i = 0; i < candidates.length; i++) { if (candidates[i]) { ctx = candidates[i]; break; } } }
ctx = ctx || {};

const first = $input.first().json || {};
const err = (first.error && typeof first.error === 'object') ? first.error : {};

function firstString() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

const raw = firstString(err.message, err.error, first.message,
                        typeof first.error === 'string' ? first.error : '');
let parsed = null;
if (raw && raw.charAt(0) === '{') {
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
}
const erpMessage = parsed ? firstString(parsed.message, parsed.error) : '';
const upstreamMsg = firstString(erpMessage, raw,
                                first._error === true ? 'input validation failed' : '');
const status = num(parsed && parsed.status)
            || num(err.statusCode)
            || num(err.response && err.response.status)
            || num(first.status)
            || null;

const hasRealError = !!(
  upstreamMsg || status ||
  first._error === true ||
  err.name || err.stack || err.isAxiosError === true ||
  Object.keys(err).length > 0
);
if (!hasRealError) {
  return [{ json: { result: 'ok', _suppressed: true, _reason: 'no upstream error signal' } }];
}

const msg = String(upstreamMsg).toLowerCase();
let code = 'internal';
if (first._error === true && !status) {
  code = 'validation';
} else if (status === 401 || status === 403 || status === 498 ||
           msg.indexOf('access token') !== -1 || msg.indexOf('logout') !== -1 ||
           msg.indexOf('unauthorized') !== -1 || msg.indexOf('unauthorised') !== -1) {
  code = 'erp_auth_expired';
} else if (msg.indexOf('timeout') !== -1 || msg.indexOf('etimedout') !== -1 ||
           msg.indexOf('econnaborted') !== -1 || msg.indexOf('econnreset') !== -1) {
  code = 'timeout';
} else if (status && status >= 500) {
  code = 'erp_unavailable';
} else if (status && status >= 400) {
  code = 'erp_rejected';
}

const detail = status ? ('HTTP ' + status + ' - ' + (upstreamMsg || 'no message'))
                      : (upstreamMsg || 'Unknown error');

const check_id     = firstString(ctx.check_id,     first.check_id,     first.body && first.body.check_id);
const run_id       = firstString(ctx.run_id,       first.run_id,       first.body && first.body.run_id);
const callback_url = firstString(ctx.callback_url, first.callback_url, first.body && first.body.callback_url);

// Loud, because a silent version of this is what execution 77172 did.
if (!callback_url) {
  console.log(JSON.stringify({ stage: 'build_error_callback',
    context_recovery_failed: true,
    note: 'no callback_url could be recovered - the portal cannot be notified of this failure' }));
}

return [{ json: {
  check_id: check_id,
  run_id: run_id,
  callback_url: callback_url,
  result: 'error',
  error: {
    code: code,
    message: detail,
    status: status,
    retryable: code === 'erp_unavailable' || code === 'timeout'
  },
  notes: 'Audit did not complete.',
  completed_at: new Date().toISOString()
}}];

