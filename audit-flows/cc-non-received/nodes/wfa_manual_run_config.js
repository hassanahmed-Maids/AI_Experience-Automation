// Manual Run Config - the manual entry point.
//
// WHY IT FEEDS Validate Inputs INSTEAD OF REPLACING IT:
// every ERP node in this flow reads its bearer from
// $('Validate Inputs').first().json.params.erp_auth.bearer, and the scorer, the
// runs log and the report all read the window from that same node. A manual path
// that bypassed it would have to re-implement the window derivation, the token
// shape check and the callback allowlist - three things that already exist and
// are skeleton. So this node builds a payload shaped exactly like the webhook
// body and hands it to the SAME Validate Inputs. Nothing downstream can tell the
// difference, and there is one validation path, not two.
//
// ============================== READ THIS ==================================
// THE TOKEN BELOW IS A PLAINTEXT SECRET SITTING IN A SHARED TEAM PROJECT.
// Anyone with read access to the Adeeb project in n8n can see it, and it is
// also written into the data of every execution that uses it.
//
// A token pasted here on 2026-08-15 was still here on 2026-08-23, in this flow and
// in the repo, eight days after it expired. The note below said to clear it; the
// value said otherwise, and the value is what gets read. CHECK THE EXPIRY AGAINST
// THE CLOCK BEFORE RUNNING - execution 88247 was launched against an already-dead
// token, every ERP call 401'd and the run died in 4.7 seconds on the error rail.
// That is gate 2 failing closed correctly, but it cost a launch.
//
// CLEAR IT once the run is done: set ERP_BEARER back to '' below.
// THE DURABLE FIX is an httpHeaderAuth / httpBearerAuth credential on the ERP
// nodes instead of a caller-supplied token, which needs a UI click and is the
// same open item the golden flow carries.
// ===========================================================================
const ERP_BEARER = '';   // CLEARED 2026-08-23. A real signed token sat here, in git and in
                         // the deployed flow. The guard below refuses the run when it is
                         // empty, which is the behaviour you want - paste, run, clear.

// WHICH MONTH. Default is the LAST COMPLETE month, because the current month is
// still being collected and would report every contract that simply has not been
// billed yet as a finding.
//
// To audit a specific month, set AUDIT_YEAR / AUDIT_MONTH. Remember the ERP
// limits enforced in Validate Inputs: the window is one calendar month and the
// from-date must be within the last 6 months.
const AUDIT_YEAR = null;    // e.g. 2026
const AUDIT_MONTH = null;   // e.g. 7 for July

// ===================== SMOKE TEST WINDOW - NOT AN AUDIT =====================
// Set to a 'YYYY-MM-DD' pair to run a NARROW date_range instead of a whole month.
// THIS IS A PIPELINE TEST AND ITS OUTPUT IS NEVER A RESULT. A contract that bills
// on the 20th looks unpaid in a window that ends on the 7th, so a narrow window
// manufactures findings by construction.
//
// REVERTED 2026-08-15 after execution 88465: narrowing the window was the WRONG
// lever. A short window makes more contracts look unpaid, which GROWS the evidence
// leg - 88465 ran 11.4 MB at 21 minutes and 142.6 MB by the crash, the largest of
// any run. The cap now lives in Select Red Cases, where the volume actually is.
const SMOKE_FROM = null;
const SMOKE_TO   = null;
// ===========================================================================

const now = new Date();
let year = AUDIT_YEAR, month = AUDIT_MONTH;
if (!year || !month) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  year = d.getUTCFullYear();
  month = d.getUTCMonth() + 1;
}

function uuid() {
  // Not cryptographic - it only has to be unique enough to key one run.
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' +
         s.slice(16, 20) + '-' + s.slice(20);
}

if (!ERP_BEARER || ERP_BEARER.indexOf('Bearer ') !== 0) {
  throw new Error('Manual Run Config has no ERP token. Paste a fresh one into ERP_BEARER in this ' +
    'node (they expire after 24h), or wire the ERP nodes to a stored credential. Refusing to run ' +
    'an audit that would 401 on every call and report the whole book as unpaid.');
}

// The callback_url is REQUIRED by Validate Inputs and is checked against the
// portal origin allowlist. On a manual run nothing is posted to it: the three
// callback nodes are DISABLED and the results go to Google Sheets instead. It is
// supplied only so the shared validation passes, and it is a real allowlisted
// origin rather than a made-up host so the allowlist is never weakened.
const callbackUrl = 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' +
  new Array(64).fill('0').join('');

const runId = uuid();

const smoke = !!(SMOKE_FROM && SMOKE_TO);
const auditWindow = smoke
  ? { kind: 'date_range', from: SMOKE_FROM, to: SMOKE_TO }
  : { kind: 'month', year: year, month: month };

console.log(JSON.stringify({ stage: 'manual_run_config', run_id: runId,
  audit_window: smoke ? (SMOKE_FROM + '..' + SMOKE_TO + ' SMOKE TEST - NOT AN AUDIT')
                      : (year + '-' + String(month).padStart(2, '0')),
  delivery: 'google_sheets (portal callbacks disabled)',
  // Read the expiry out of the token that is actually in use. The previous version
  // logged a hardcoded date, so once the token was replaced the log asserted an
  // expiry belonging to a token that was no longer there.
  token_expires: (function () {
    try {
      const c = JSON.parse(Buffer.from(ERP_BEARER.slice(7).split('.')[1], 'base64').toString());
      return new Date(c.exp * 1000).toISOString();
    } catch (e) { return 'unreadable'; }
  })() }));

return [{ json: {
  // Shaped like the webhook item: Validate Inputs reads incoming.body first.
  headers: { 'x-sr-webhook-secret': 'LAWP' },
  body: {
    // The check_id carries the smoke marker so a test run can never be mistaken
    // for an audit in the runs log or the Sheets tabs.
    check_id: smoke ? 'SMOKE-manual-cc-non-received' : 'manual-cc-non-received',
    run_id: runId,
    callback_url: callbackUrl,
    contract_version: 1,
    audit_window: auditWindow,
    params: {
      erp_auth: { bearer: ERP_BEARER },
      previous_cases: [],
      trigger: 'manual',
      delivery: 'google_sheets'
    }
  }
} }];
