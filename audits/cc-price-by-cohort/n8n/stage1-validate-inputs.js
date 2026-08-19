const raw = $input.first().json || {};
const body = raw.body || raw;
const auth = body.erp_auth || {};
const errors = [];
const bearer = String(auth.bearer || "").trim();
const deviceId = String(auth.device_id || "").trim();
if (!/^Bearer\s+\S+/.test(bearer)) errors.push("erp_auth.bearer missing");
if (!/^\d+$/.test(deviceId)) errors.push("erp_auth.device_id missing");
let tokenUser = null;
if (errors.length === 0) {
  try {
    const seg = bearer.replace(/^Bearer\s+/, "").split(".")[1];
    const claims = JSON.parse(Buffer.from(seg, "base64").toString("utf8"));
    tokenUser = claims.user || null;
    if (claims.device && String(claims.device) !== deviceId) errors.push("device_id does not match the bearer device claim");
    if (claims.exp && Number(claims.exp) * 1000 < Date.now()) errors.push("bearer has expired");
  } catch (e) { errors.push("bearer is not a decodable JWT"); }
}
const p = body.params || {};
const runId = String(p.run_id || ("run-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)));
const smoke = p.smoke === true;
const ch = p.chunk || {};

// AUDIT MONTH. The check asks "was this contract priced correctly during month
// M?", never "is it priced correctly right now?" - the latter reads whatever
// payment period happens to be current and produced nine withdrawn findings on
// 2026-08-18.
//
// The default is the LAST COMPLETED month, and the current month is rejected
// outright: on the 18th you cannot say whether this month was billed correctly,
// because the month has not finished.
const requestedMonth = String(p.audit_month === undefined || p.audit_month === null ? "" : p.audit_month).trim();
let auditMonth = requestedMonth;
if (auditMonth === "") {
  const d = new Date();
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth() - 1;
  if (mo < 0) { mo = 11; y -= 1; }
  auditMonth = y + "-" + String(mo + 1).padStart(2, "0");
}
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(auditMonth)) {
  errors.push("params.audit_month must be YYYY-MM, got: " + auditMonth);
} else {
  const y = Number(auditMonth.slice(0, 4));
  const mo = Number(auditMonth.slice(5, 7));
  // First instant of the following month. Anything at or after it means the
  // audit month is over.
  if (Date.now() < Date.UTC(y, mo, 1)) {
    errors.push("audit_month " + auditMonth + " has not finished yet - a month can only be audited once it is complete");
  }
}

return [{ json: { ok: errors.length === 0, errors: errors, params: {
  run_id: runId,
  check_id: (smoke ? "SMOKE-" : "") + "manual-cc-price-by-cohort",
  check_name: "CC Client Paying According to Price by Type / Nationality / Start Date",
  smoke: smoke,
  started_at: new Date().toISOString(),
  audit_month: auditMonth,
  audit_month_defaulted: requestedMonth === "",
  chunk: { offset: 0, size: Number(ch.size || 1500), max_chunks: Number(ch.max_chunks || 0) },
  population: { abort_below: Number(p.abort_below === undefined ? 4600 : p.abort_below), warn_below: Number(p.warn_below === undefined ? 4900 : p.warn_below), max_divergence_pct: Number(p.max_divergence_pct === undefined ? 1 : p.max_divergence_pct), warn_only: p.warn_only === true },
  erp_auth: { bearer: bearer, token_bare: bearer.replace(/^Bearer\s+/, ""), device_id: deviceId, acting_user: tokenUser }
} } }];
