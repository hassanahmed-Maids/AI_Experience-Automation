// Offline mirror of Stage 2's "Chunk Summary" circuit breaker (n8n CopNHNsXUzFO59bW).
//
// The breaker exists because a full month is ~23,000 contracts x 2 ERP reads sustained for
// hours. Without it, an ERP that starts refusing gets called for the whole run and every
// contract it touched is filed as "awaiting reviewer" - which reads, in the case store, exactly
// like work that was done. A trip costs one chunk of wasted calls.
//
// Keep this file and the n8n node in step. This copy is the one with tests.

function classify(items) {
  const c = { total: 0, ok: 0, unavailable: 0, tokenDead: 0, denied: 0, other: 0 };
  for (const it of items) {
    const j = (it && it.json) || {};
    const st = j.statusCode;
    const txt = typeof j.body === 'string' ? j.body : JSON.stringify(j.body || '');
    c.total++;
    if (st === 200) { c.ok++; continue; }
    if (st === 502 || st === 503 || st === 504) { c.unavailable++; continue; }
    if (typeof st === 'number' && st >= 500 && /498|malformed|Access Token/i.test(txt)) { c.tokenDead++; continue; }
    if (st === 401 || st === 403) { c.denied++; continue; }
    c.other++;
  }
  return c;
}

// Returns null when the chunk may proceed, or { code, message } when the run must stop.
function trip({ scored, persisted, det, led }) {
  if (scored.length > 0 && persisted === 0) {
    return { code: 'CASE_ROWS_LOST', message: 'scored ' + scored.length + ' and none reached the Cases table' };
  }
  // SESSION_INACTIVE, not "token dead": the same JWT starts working again the moment the operator
  // logs back in (proven 2026-08-19 - an identical token went 498 <LOGOUT> then 200 within hours).
  // Still trips on the FIRST read, because grinding through a slice with no live session is pure
  // waste, but the operator's action is "log back in or re-token", not "discard this token".
  const dead = det.tokenDead + led.tokenDead;
  if (dead > 0) return { code: 'ERP_SESSION_INACTIVE', message: dead + ' read(s) returned the 498-inside-5xx shape' };

  const down = det.unavailable + led.unavailable;
  if (down >= 3) return { code: 'ERP_MODULE_UNAVAILABLE', message: down + ' read(s) came back 5xx-unavailable' };

  const denied = det.denied + led.denied;
  if (denied >= 3) return { code: 'ERP_ACCESS_DENIED', message: denied + ' read(s) refused with 401/403' };

  const surfaceFail = scored.filter((r) => r.gate === 'surface').length;
  if (scored.length >= 5 && surfaceFail / scored.length >= 0.4) {
    return { code: 'ERP_SURFACE_STORM', message: surfaceFail + ' of ' + scored.length + ' unreadable' };
  }
  return null;
}

module.exports = { classify, trip };

// Offline mirror of Stage 1's "Check Access And Plan Cohorts" denial advice (n8n IKRXhIco1mwxrcPq).
// This is the FIRST thing an operator reads when a run refuses to start, so the shapes have to be
// named correctly: re-tokening a 503 does nothing, and a 498 <LOGOUT> is a session that is not
// active rather than a token that must be thrown away.
function denialAdvice(status, body) {
  const txt = typeof body === 'string' ? body : JSON.stringify(body || '');
  if (status === 401) return 'ACCESS_DENIED';
  if (status === 503) return 'MODULE_UNAVAILABLE';
  if (status && status >= 500) {
    if (/498|malformed|Access Token/i.test(txt)) return 'SESSION_INACTIVE';
    if (/SecurityException/.test(txt)) return 'EXECUTOR_UNAUTHORISED';
    return 'SERVER_FAULT';
  }
  return 'UNEXPECTED';
}

module.exports.denialAdvice = denialAdvice;
