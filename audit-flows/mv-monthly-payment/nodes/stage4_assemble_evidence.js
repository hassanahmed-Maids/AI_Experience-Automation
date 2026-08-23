// ----- BESPOKE ERP CIRCUIT BREAKER (section 5) -------------------------------------------
// ERP-COMPLIANCE: no-breaker-because the GENERATED block does not fit here; this is a bespoke
// one, deliberately not using the canonical markers so the byte-compare does not claim it drifted.
//
// Stage 4 had NO breaker at all - the one stage of this check that did not. That is the worst
// place for the gap, because Stage 4 is the only stage whose failure mode is silent: when the
// ERP refuses every read, Apply Verifier Rules marks each finding "evidence incomplete", blocks
// it from the PIL, and the run completes reporting work it did not do. A whole month of findings
// comes back "awaiting reviewer" and nothing says the reason was an outage.
//
// It is bespoke rather than the generated block for the same reason as Stage 2's Chunk Summary:
// the denial SHAPES need different human actions, and a run that is dying should say which.
// Thresholds match Stage 2 so an operator reads one vocabulary across the check.
//
// It runs on the FIRST item only, and it runs here rather than later because everything after
// this node costs money or writes rows: Judge Staff Explanation is a model call per finding and
// Update Case With Verdict rewrites the case store. The ERP reads themselves are already spent -
// a per-item HTTP node completes every call before any of our code runs - so what this saves is
// the model spend and the false verdicts, not the requests.
//
// KNOWN GAP, recorded rather than papered over: no latency signal. Same as Stage 0 and Stage 2.
let breakerItemIndex = 0;
try { breakerItemIndex = $itemIndex; } catch (e) { breakerItemIndex = 0; }
if (breakerItemIndex === 0) {
  const classify = function (items) {
    const c = { total: 0, ok: 0, unavailable: 0, sessionInactive: 0, denied: 0, other: 0 };
    for (const it of items) {
      const j = (it && it.json) || {};
      const st = j.statusCode;
      const txt = typeof j.body === 'string' ? j.body : JSON.stringify(j.body || '');
      c.total++;
      if (st === 200) { c.ok++; continue; }
      if (st === 502 || st === 503 || st === 504) { c.unavailable++; continue; }
      // The dropped-session marker is tested BEFORE the plain 401/403 branch: a dead ERP session
      // wears both a 401 and a 5xx, and reading the status class first sends the operator off to
      // request a permission they already hold. Probed 2026-08-19 11:33Z and 14:42Z.
      if (/<LOGOUT>|UNAUTHENTICATED/i.test(txt)) { c.sessionInactive++; continue; }
      if (typeof st === 'number' && st >= 500 && /498|malformed|Access Token/i.test(txt)) { c.sessionInactive++; continue; }
      if (st === 401 || st === 403) { c.denied++; continue; }
      c.other++;
    }
    return c;
  };
  const wa = classify($('Read WhatsApp Log').all());
  const co = classify($('Read Complaints').all());
  const reads = wa.total + co.total;
  const bad = (wa.total - wa.ok) + (co.total - co.ok);

  const inactive = wa.sessionInactive + co.sessionInactive;
  if (inactive > 0) {
    throw new Error('ERP_SESSION_INACTIVE: ' + inactive + ' verifier read(s) came back with the ' +
      'dropped-session marker (<LOGOUT> / UNAUTHENTICATED, as either 401 or 5xx-498). The ERP ' +
      'session behind this token is not active. This is NOT a permission problem - the same token ' +
      'works again once the operator logs back in. Restore the session or supply a fresh token, ' +
      'then re-run the verifier alone via the mv-monthly-payment-verify webhook. Trips on the ' +
      'first occurrence because a run with no live session cannot read any evidence.');
  }
  const down = wa.unavailable + co.unavailable;
  if (down >= 3) {
    throw new Error('ERP_MODULE_UNAVAILABLE: ' + wa.unavailable + ' message-log and ' +
      co.unavailable + ' complaints read(s) came back 5xx-unavailable. Stopping rather than ' +
      'marking every finding evidence-incomplete and reporting the run as done. Confirm the ' +
      'module is healthy before re-running. Do NOT re-token for this shape, it is not auth.');
  }
  const denied = wa.denied + co.denied;
  if (denied >= 3) {
    throw new Error('ERP_ACCESS_DENIED: ' + denied + ' verifier read(s) were refused 401/403 ' +
      'WITHOUT the dropped-session marker. Read the developermessage header: PAGE_CODE_MISSING ' +
      'or API_NOT_FOUND_FOR_PAGE means the request is wrong; an absent one means a real ' +
      'permission gap, which is a finding to report, not something to route around.');
  }
  if (reads >= 10 && bad / reads >= 0.4) {
    throw new Error('ERP_SURFACE_STORM: ' + bad + ' of ' + reads + ' verifier reads failed. ' +
      'whatsapp=' + JSON.stringify(wa) + ' complaints=' + JSON.stringify(co) + '. Stopping ' +
      'rather than blocking a whole month of findings from the PIL for a reason that looks like ' +
      'a verdict and is actually an outage.');
  }
}
// ----- END BESPOKE ERP CIRCUIT BREAKER ---------------------------------------------------

const inp = $('Verify In').first().json;
const c = $('Read Findings').item.json;
const msg = $('Read WhatsApp Log').item.json || {};
const cmp = $json || {};

// ---- Verifier rule 3 (Order 280): what counts as a follow-up ----------------------------
// WhatsApp is the only channel carrying sentDate, and the only one that can satisfy all three
// of the rule's tests. SMS rows have creationDate and no sentDate at all.
const DELIVERED = ['DELIVERED', 'READ', 'RESPONDED'];
const CHASE = [/bounced.*payment|payment.*bounced/i, /payment_for_approval_request/i,
  /dd_messaging_setup.*bounced/i, /collection|overdue|unpaid|outstanding|arrears/i,
  /payment.*reminder|reminder.*payment/i];
// MV_PAYMENT_RECEIVED_NOTIFICATION contains PAYMENT but is a RECEIPT. Counting it as chasing
// suppresses the very finding it should leave standing - same shape as counting marketing.
const NOT_CHASE = [/received|confirmation|receipt|thank/i,
  /broadcast|campaign|pre_sale|returning_clients|win_?back/i, /otp|birthday|medical|vat/i];

const msgOk = msg.statusCode === 200;
const msgRows = msgOk ? (((msg.body || {}).content) || []) : [];
let lastFollowup = null;
let chaseCount = 0;
for (const r of msgRows) {
  const name = String((r && r.templateName) || '');
  const status = String((r && r.deliveryStatus) || '');
  const sent = r && r.sentDate;
  if (!sent) continue;
  if (DELIVERED.indexOf(status) === -1) continue;
  if (/^\d+$/.test(name.trim())) continue;
  let excluded = false;
  for (const p of NOT_CHASE) { if (p.test(name)) { excluded = true; break; } }
  if (excluded) continue;
  let isChase = false;
  for (const p of CHASE) { if (p.test(name)) { isChase = true; break; } }
  if (!isChase) continue;
  chaseCount++;
  const d = String(sent).slice(0, 10);
  if (!lastFollowup || d > lastFollowup) lastFollowup = d;
}

// SENSITIVE: only the DATE leaves the message log. Message content and phone numbers never
// reach the case, the run summary, or the model below.

// ---- Verifier rule 1 (Order 260): read what staff actually wrote ------------------------
// NEVER conclude from `summary` - it is auto-generated compression and is frequently blank.
// The real text is initialDescription plus managerNotes.
const cmpOk = cmp.statusCode === 200;
const cmpRows = cmpOk ? (((cmp.body || {}).content) || []) : [];
const notes = [];
for (const r of cmpRows) {
  const parts = [];
  if (r.initialDescription) parts.push(String(r.initialDescription));
  if (r.managerNotes) parts.push('MANAGER NOTES: ' + String(r.managerNotes));
  if (r.resolutionDetails) parts.push('RESOLUTION: ' + String(r.resolutionDetails));
  if (!parts.length) continue;
  notes.push({
    id: String(r.id),
    date: String(r.complaintDate || r.creationDate || '').slice(0, 10),
    category: String((r.category && r.category.name) || r.primaryType || ''),
    text: parts.join(' — ').slice(0, 1500),
  });
}

const evidenceComplete = msgOk && cmpOk;

return { json: {
  run_id: c.run_id,
  case_key: c.case_key,
  contract_id: c.contract_id,
  client_id: c.client_id,
  target_month: c.target_month,
  gap: c.gap,
  refund_present: c.refund_present === true,
  auditedMonth: inp.auditedMonth,
  messagesRead: msgOk,
  messageRows: msgRows.length,
  complaintsRead: cmpOk,
  complaintRows: cmpRows.length,
  notesForModel: notes,
  hasNotes: notes.length > 0,
  lastFollowupDate: lastFollowup,
  qualifyingChases: chaseCount,
  evidenceComplete: evidenceComplete,
  modelPrompt: notes.length
    ? ('MONTH UNDER TEST: ' + String(c.target_month) + '\nAMOUNT UNPAID (AED): ' + String(c.gap) + '\n\nSTAFF-WRITTEN RECORDS:\n' + notes.map(function (n, i) { return '[' + n.id + '] date ' + n.date + ' category ' + n.category + '\n' + n.text; }).join('\n\n'))
    : 'NO STAFF-WRITTEN RECORDS FOUND',
} };
