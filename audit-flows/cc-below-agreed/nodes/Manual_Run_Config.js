// Manual Run Config - the manual entry point.
//
// NOTE ON THE WINDOW: this check needs THREE months, not one - gate 18's
// persistence test is what removes 88% of the freeze false positives, and ERP
// stores no freeze date to do it any other way. The three windows are derived in
// Validate Inputs from the single audited month set below, so only ONE month is
// configured here and the two before it follow.
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
// PASTE A FRESH ERP TOKEN INTO ERP_BEARER BELOW BEFORE THE FIRST MANUAL RUN.
// It is the value after 'Bearer ' in the Authorization header of any logged-in
// erp.maids.cc request, and it must keep the 'Bearer ' prefix here.
//
// It is DELIBERATELY LEFT EMPTY. ERP tokens last 24h, so a baked one is stale
// within the day, and anything pasted here is a plaintext secret readable by
// anyone with access to this n8n project and written into every execution's data.
// Clear it again once the run is done.
//
// THE DURABLE FIX is a stored httpBearerAuth credential on the ERP nodes instead
// of a caller-supplied token. That needs a UI click, and it is the same open item
// the golden flow and the sibling check both carry.
// ===========================================================================
const ERP_BEARER = 'Bearer eyJhbGciOiJIUzUxMiJ9.eyJ1c2VyIjoiQWJkdWxsYWhhIiwiZGV2aWNlIjoiMTc4MzI1NzI0MDA1OCIsImlhdCI6MTc4NzA0NDU4NCwiZXhwIjoxNzg3MDkwNDAwfQ.ZjOfQpaIkY5C33b9mMdFPb7NvvvY9w3oEBN4AkvsskugrfEFH_rkTKW0nqA9hGDt4RBuZZyBJBaH9WvOUMnfcA';

// WHICH MONTH. Default is the LAST COMPLETE month, because the current month is
// still being collected and would report every contract that simply has not been
// billed yet as a finding.
//
// To audit a specific month, set AUDIT_YEAR / AUDIT_MONTH. Remember the ERP
// limits enforced in Validate Inputs: the window is one calendar month and the
// from-date must be within the last 6 months.
const AUDIT_YEAR = null;    // e.g. 2026
const AUDIT_MONTH = null;   // e.g. 7 for July

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

console.log(JSON.stringify({ stage: 'manual_run_config', run_id: runId,
  audit_window: year + '-' + String(month).padStart(2, '0'),
  delivery: 'google_sheets (portal callbacks disabled)',
  token: 'must be pasted into ERP_BEARER in this node' }));

return [{ json: {
  // Shaped like the webhook item: Validate Inputs reads incoming.body first.
  headers: { 'x-sr-webhook-secret': 'LAWP' },
  body: {
    check_id: 'manual-cc-below-agreed',
    run_id: runId,
    callback_url: callbackUrl,
    contract_version: 1,
    audit_window: { kind: 'month', year: year, month: month },
    params: {
      erp_auth: { bearer: ERP_BEARER },
      previous_cases: [],
      trigger: 'manual',
      delivery: 'google_sheets'
    }
  }
} }];

