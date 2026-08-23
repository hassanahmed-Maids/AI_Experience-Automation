// Attach Identity — MV Overstay Fines (v1). Mode: Run Once for Each Item.
//
// gate 3 — identity resolution before ANYTHING else. This runs before any status,
// fine or payment is read, because every later call is keyed on what it produces.
//
// `overstay_txn_maid_id` = housemaids[0].housemaid.id   (.label is a name, display only)
// `overstay_txn_contract_id` = housemaids[0].contractId
//
// NEVER resolve a maid from the transaction `description`, even though it contains
// her name. NEVER join a transaction to a fine by amount, by date, or by name —
// that already produced a false link during the build: txn 2076380 (+450) was
// attributed to maid 65071, who also had a 450 fine, when it belongs to maid 84087.
//
// The top-level contractId and clientId on this same payload are EMPTY STRINGS and
// clients[] / contracts[] are empty arrays — measured on 30 of 30 detail payloads,
// 2026-08-12. Only the nested housemaids[0] fields are populated. The client is
// reached through the contract, never directly off the transaction.
const fetched = $input.item.json;
const carry = $('Split Transactions').item.json;

const out = Object.assign({}, carry);

// `Get Transaction Detail` runs with onError: continueRegularOutput as of 2026-08-23, so that
// `Judge Detail Batch` can COUNT its failures (ERP-LOAD-POLICY.md §5 — a breaker fed only the
// successes reports a healthy ERP while it burns). A read that FAILED therefore arrives here as
// an item carrying `error` instead of a transaction payload.
//
// It must not fall through into the housemaids[] check below. Both outcomes route to review, so
// nothing would be scored wrongly — but one says the payload carried no person and the other
// says we never saw the payload, and a reviewer opening the case needs to know which. The
// original text ("Transaction detail returned no housemaids[] entry") would have been a false
// statement about a call that never returned anything.
if (fetched && fetched.error !== undefined && fetched.error !== null &&
    !Array.isArray(fetched.housemaids)) {
  const e = fetched.error;
  out.maid_id = '';
  out.contract_id = '';
  out.maid_name = '';
  out.identity_resolved = false;
  out.enrich_blocked = 'detail_unreadable';
  out.enrich_blocked_text = 'GET /accounting/transactions/{id} did not return a transaction: ' +
    String((e && e.message) || e).slice(0, 300) + ' — the read FAILED and the case is routed to ' +
    'review. This is NOT the same as a transaction with no housemaids[] entry, and neither is ' +
    'ever scored as clean.';
  return { json: out };
}

const hms = (fetched && Array.isArray(fetched.housemaids)) ? fetched.housemaids : null;

if (!hms || hms.length === 0) {
  // gate 3 Default Value: absent or empty housemaids[] routes to review
  // UNATTRIBUTED. It is emitted, not dropped — but it must NOT reach the fines or
  // payments calls, because interpolating an empty id into a URL path makes ERP
  // answer 400 on the path segment and kills the whole run.
  out.maid_id = '';
  out.contract_id = '';
  out.maid_name = '';
  out.identity_resolved = false;
  out.enrich_blocked = 'unattributed';
  out.enrich_blocked_text = 'Transaction detail returned no housemaids[] entry, so the fine ' +
    'cannot be attributed to a person. Routed to review unattributed. The description free text ' +
    'contains a name and was deliberately not used.';
  return { json: out };
}

const h0 = hms[0] || {};
const maid = h0.housemaid || {};
const maidId = (maid.id === '' || maid.id === null || maid.id === undefined) ? '' : String(maid.id);
const contractId = (h0.contractId === '' || h0.contractId === null || h0.contractId === undefined)
  ? '' : String(h0.contractId);

out.maid_id = maidId;
out.maid_name = String(maid.label || '');
out.contract_id = contractId;
out.housemaids_len = hms.length;
out.top_contract_id_empty = (fetched.contractId === '' || fetched.contractId === undefined);
out.top_client_id_empty = (fetched.clientId === '' || fetched.clientId === undefined);

if (!maidId) {
  out.identity_resolved = false;
  out.enrich_blocked = 'unattributed';
  out.enrich_blocked_text = 'housemaids[0].housemaid.id is empty — no authoritative link from ' +
    'the transaction to a person. Routed to review unattributed.';
  return { json: out };
}

if (!contractId) {
  // overstay_txn_contract_id Default Value: empty routes to review; without it
  // recovery cannot be checked and MUST NOT be assumed zero.
  out.identity_resolved = false;
  out.enrich_blocked = 'contract_id_missing';
  out.enrich_blocked_text = 'housemaids[0].contractId is empty, so recovery cannot be checked. ' +
    'Routed to review — recovery is never assumed to be zero.';
  return { json: out };
}

out.identity_resolved = true;
return { json: out };
