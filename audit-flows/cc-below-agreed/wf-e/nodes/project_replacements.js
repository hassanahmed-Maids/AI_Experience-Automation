// Project Replacements + Return (WF-E) - the COVERAGE side, then collapse the whole chunk
// to ONE item and let this execution die with the raw bodies.
//
// LIFTED FROM WF-A's `Attach Replacements`, minus the assembly. That node was also the
// point where the two enrichment deltas were joined back onto the full case; here the join
// happens in WF-A's `Join Enrichment`, because the full cases must not cross this boundary
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

let failed = 0, truncated = 0, denied = 0, withRows = 0;
const enriched = planDeltas.map(function (d, i) {
  const resp = responses[i] || {};
  const rows = Array.isArray(resp.content) ? resp.content : [];
  const fetchFailed = !Array.isArray(resp.content) &&
    !!(resp.error || resp.status || resp.message || resp.path);
  if (fetchFailed) failed++;
  // The 401 is the KNOWN state of this route on this account, not a surprise, and it is
  // counted separately so a permission grant landing shows up as this number falling to
  // zero rather than as a silent change in verdicts.
  const deniedHere = fetchFailed && (String(resp.status) === '401' ||
    String(resp.error || '').toLowerCase().indexOf('unauthor') !== -1);
  if (deniedHere) denied++;
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
      rows: rows.length,
      declared_total: declaredUsable ? Number(declared) : null,
      // This endpoint DOES carry a real totalElements, so a short read is visible here -
      // unlike the payment sweep. A truncated walk would hide a maid change and move a
      // verdict, so it is flagged rather than assumed complete.
      truncated: isTruncated
    }
  };
});

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
  _chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index
} }];
