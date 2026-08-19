// Project Replacements + Return (WF-E) - the COVERAGE side, then collapse the whole chunk
// to ONE item and let this execution die with the raw bodies.
//
// LIFTED FROM WF-A's Attach Replacements, minus the assembly. That node was also the
// point where the two enrichment deltas were joined back onto the full case; here the join
// happens in WF-A's Join Enrichment, because the full cases must not cross this boundary
// twice. What crosses is the DELTA per candidate - plan + replacements - which is what the
// scorer actually reads.
//
// NO RECORDS FOR A CONTRACT IS NOT "no maid was ever placed". It far more often means the
// contract simply never had a change - the original maid is still there and coverage starts
// at the contract's own tag date. So this records an absence of RECORDS, and gate 7 decides
// what that means.
//
// GATE 7 also carries the same-day rule: on 1054346 the outgoing maid left 12:28 and the
// incoming arrived 13:35 the SAME DAY (26 Jun), so July was fully covered even though the
// contract's tag date reads 2026-08-03. A same-day swap is not a coverage gap, and the tag
// date does not answer the coverage question at all.
const planDeltas = $('Project Plan').all().map(function (i) { return i.json; });
const responses = $input.all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

if (responses.length !== planDeltas.length) {
  throw new Error('Project Replacements: ' + responses.length + ' replacement responses for ' +
    planDeltas.length + ' candidates. Positional pairing is broken, so a case would be given ' +
    'another contract\'s maid history - refusing to guess which.');
}

// ---------------------------------------------------------------------------------------
// CLASSIFYING A FAILED CALL, because the previous version of this could not.
//
// THE BUG THIS REPLACES: the old detector tested String(resp.status) === '401' and searched
// String(resp.error) for 'unauthor'. n8n's continueRegularOutput does NOT hand back the HTTP
// body on a failure - it hands back an ERROR OBJECT - so resp.status was undefined and
// String(resp.error) rendered '[object Object]'. The counter therefore read 0 while all 750
// replacement calls were failing, and a counter that reports zero for both "the grant landed"
// and "every call is denied" is worse than no counter at all: it was the number I would have
// used to say the permission had been granted.
//
// THREE OUTCOMES, NOT ONE, and separating them is the point:
//   permission_denied  401/403 + INSUFFICIENT_PERMISSIONS. The KNOWN steady state of
//                      /complaints/replacement on this account (probes #6 and #13). Coverage
//                      is read from what remains; gate 7 decides what an absence means.
//   token_dead         UNAUTHORIZED <LOGOUT> / UNAUTHENTICATED, or the 498-inside-500 shape.
//                      A DIFFERENT ANIMAL ENTIRELY: the token died mid-run, so every read
//                      after it is empty, and empty reads score as "no maid change" and
//                      "no discount" - which clears cases that should not clear. This one
//                      throws.
//   other              anything else. Counted, never interpreted.
function httpCodeOf(o) {
  const e = o.error && typeof o.error === 'object' ? o.error : {};
  const ctx = e.context && typeof e.context === 'object' ? e.context : {};
  const cands = [o.status, o.statusCode, o.httpCode, o.code,
                 e.httpCode, e.status, e.statusCode, e.code, ctx.httpCode];
  for (let i = 0; i < cands.length; i++) {
    const n = Number(cands[i]);
    if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
  }
  return null;
}
// JSON.stringify, not String(): the marker lives in a nested message/description and String()
// flattens the whole object to '[object Object]', which is exactly how this went wrong before.
// Bounded, because an n8n error carries a stack.
function failureText(o) {
  let t = '';
  try { t = JSON.stringify(o) || ''; } catch (err) { t = String(o); }
  return t.slice(0, 4000).toLowerCase();
}
function isTokenDead(text) {
  return text.indexOf('logout') !== -1 || text.indexOf('unauthenticated') !== -1 ||
         text.indexOf('498') !== -1 || text.indexOf('token has expired') !== -1 ||
         text.indexOf('jwt expired') !== -1;
}
function isPermissionDenied(code, text) {
  if (text.indexOf('insufficient_permissions') !== -1) return true;
  if (text.indexOf('securityexception') !== -1 || text.indexOf('access denied') !== -1) return true;
  // A bare 401/403 with no ERP marker at all: treat as a denial rather than a dead token,
  // because that is the measured shape of this route, but it is counted as UNMARKED so a
  // change in ERP's error vocabulary shows up as this number rising instead of as silence.
  return (code === 401 || code === 403);
}

let failed = 0, truncated = 0, denied = 0, withRows = 0;
let tokenDead = 0, otherFail = 0, unmarkedDenial = 0;
const failureSamples = [];
const enriched = planDeltas.map(function (d, i) {
  const resp = responses[i] || {};
  const rows = Array.isArray(resp.content) ? resp.content : [];
  const fetchFailed = !Array.isArray(resp.content) &&
    !!(resp.error || resp.status || resp.message || resp.path);
  if (fetchFailed) failed++;
  // The 401 is the KNOWN state of this route on this account, not a surprise, and it is
  // counted separately so a permission grant landing shows up as this number falling to
  // zero rather than as a silent change in verdicts.
  let deniedHere = false, deadHere = false;
  if (fetchFailed) {
    const code = httpCodeOf(resp);
    const text = failureText(resp);
    deadHere = isTokenDead(text);
    deniedHere = !deadHere && isPermissionDenied(code, text);
    if (deadHere) tokenDead++;
    else if (deniedHere) {
      denied++;
      if (text.indexOf('insufficient_permissions') === -1) unmarkedDenial++;
    } else otherFail++;
    // A bounded sample of the raw shapes, so the next person debugging this reads what ERP
    // and n8n actually sent instead of inferring it from a counter. No ids, no amounts.
    if (failureSamples.length < 3) failureSamples.push(text.slice(0, 220));
  }
  if (rows.length > 0) withRows++;

  const declared = Object.prototype.hasOwnProperty.call(resp, 'totalElements') ? resp.totalElements : null;
  const declaredUsable = declared !== null && declared !== '' && Number.isFinite(Number(declared));
  const isTruncated = declaredUsable ? rows.length < Number(declared) : null;
  if (isTruncated === true) truncated++;

  return {
    case_key: d.case_key,
    contract_id: d.contract_id,
    client_id: d.client_id,
    plan: d.plan,
    replacements: rows.map(function (r) {
      // oldHousemaid / newHousemaid are an object {id,label} OR an EMPTY STRING.
      // newHousemaid === "" means the maid left with NO SUCCESSOR - the signal gate 7 turns
      // on - so a truthiness or null check must handle it explicitly.
      function maid(v) {
        if (v && typeof v === 'object') return { id: s(v.id), label: s(v.label) };
        return { id: '', label: '', empty: true };
      }
      return {
        // ERP's own docs spell this field two ways; read both rather than silently getting
        // an empty date and dropping the event from the timeline.
        date: s(r.replacementDate || r.replacmentDate).slice(0, 10),
        old_housemaid: maid(r.oldHousemaid),
        new_housemaid: maid(r.newHousemaid),
        old_days_with_client: Number.isFinite(Number(r.oldHousemaidDaysSpentWithClient))
          ? Number(r.oldHousemaidDaysSpentWithClient) : null,
        reason: s(r.replacementReason),
        done: r.done === true
      };
    }),
    replacements_meta: {
      fetch_failed: fetchFailed,
      permission_denied: deniedHere,
      token_dead: deadHere,
      rows: rows.length,
      declared_total: declaredUsable ? Number(declared) : null,
      // This endpoint DOES carry a real totalElements, so a short read is visible here -
      // unlike the payment sweep. A truncated walk would hide a maid change and move a
      // verdict, so it is flagged rather than assumed complete.
      truncated: isTruncated
    }
  };
});

// A DEAD TOKEN IS NOT A DATA STATE. Every read after the token dies comes back empty, and
// an empty replacement history reads as "the original maid is still there" - which closes
// gate 7's coverage question in the client's favour on cases nobody actually looked at. So
// this throws rather than returning a chunk of confidently unenriched cases. A permission
// denial does NOT throw: it is the known steady state and gate 7 is built for it.
if (tokenDead > 0) {
  throw new Error('WF-E: ' + tokenDead + ' of ' + responses.length + ' replacement reads came back ' +
    'as a DEAD TOKEN (logout / unauthenticated / 498), not a permission denial. Every read after ' +
    'a token dies is empty, and an empty maid history scores as "no change" - so this chunk would ' +
    'clear cases nobody read. Re-issue the bearer and re-run. Sample: ' +
    (failureSamples[0] || '(none captured)'));
}

// EVERY CANDIDATE COMES BACK, including the ones whose calls failed. A chunk that returned
// fewer deltas than it was given would leave WF-A holding cases with no enrichment and no
// way to tell that from a case that was never sent - which is how a contract gets scored
// against a rate nobody read.
if (enriched.length !== planDeltas.length) {
  throw new Error('WF-E: returning ' + enriched.length + ' deltas for ' + planDeltas.length +
    ' candidates. The caller cannot distinguish a missing delta from an unsent candidate.');
}

console.log(JSON.stringify({ stage: 'wfe_project_replacements', candidates: enriched.length,
  replacement_fetch_failures: failed, permission_denied: denied,
  permission_denied_unmarked: unmarkedDenial, token_dead: tokenDead, other_failures: otherFail,
  failure_samples: failureSamples,
  with_replacement_rows: withRows, truncated_histories: truncated,
  note: 'ONE item out; the raw plan and replacement bodies die with this sub-execution, ' +
        'which is the entire point of the workflow' }));

return [{ json: {
  enriched: enriched,
  _projected_by: 'CC Below Agreed - 0-Enrich Candidates',
  _candidates: enriched.length,
  _plan_fetch_failures: $('Project Plan').all().filter(function (i) {
    return i.json.plan && i.json.plan.fetch_failed === true; }).length,
  _replacement_fetch_failures: failed,
  _replacement_permission_denied: denied,
  _replacement_permission_denied_unmarked: unmarkedDenial,
  _replacement_other_failures: otherFail,
  _chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index
} }];
