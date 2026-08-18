// Join Enrichment (WF-A) - put the chunked deltas back onto the cases, and emit the
// complete enriched case exactly once.
//
// THIS IS THE ASSEMBLY POINT, inherited from the old `Attach Replacements`. The two
// enrichment stages now live inside WF-E and return deltas per candidate; this joins them
// to the case scalars BY case_key and hands `Merge Streams` the same item shape it has
// always received, so `Compute Case States` is untouched.
//
// JOINED BY KEY, NOT BY POSITION, and that is a deliberate change from what it replaces.
// Inside one chunk WF-E still pairs positionally - it can, because the HTTP nodes there run
// alwaysOutputData with onError continueRegularOutput and so emit one item per input item.
// Across chunks there is no position to trust: chunk 3's third delta is not the third case.
// So the join is explicit, and a case with no delta is a hard error rather than a case that
// quietly reaches the scorer with no rate.
const cases = $('Needs enrichment?').all(0).map(function (i) { return i.json; });
const returned = $input.all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

const byKey = {};
let deltaCount = 0, duplicates = 0;
const chunksSeen = [];
for (const r of returned) {
  const list = Array.isArray(r.enriched) ? r.enriched : null;
  if (!list) {
    throw new Error('Join Enrichment: a WF-E return carried no `enriched` array (keys=' +
      Object.keys(r || {}).join(',') + '). Without it these cases have no rate and no maid history, ' +
      'and scoring them would compare payments against nothing.');
  }
  chunksSeen.push(r._chunk_index === undefined ? null : r._chunk_index);
  for (const d of list) {
    const k = s(d.case_key);
    if (byKey[k]) duplicates++;
    byKey[k] = d;
    deltaCount++;
  }
}

// EVERY CANDIDATE MUST HAVE COME BACK. A missing delta is the failure mode that matters
// here: the case would reach the scorer with no `plan`, `expected` would read as unknown,
// and the contract would be quietly routed to a human as CANNOT TELL instead of scored -
// a silent loss of coverage that no later gate can notice.
const missing = [];
for (const c of cases) if (!byKey[s(c.case_key)]) missing.push(s(c.case_key));
if (missing.length > 0) {
  throw new Error('Join Enrichment: ' + missing.length + ' of ' + cases.length + ' candidates came ' +
    'back with no enrichment delta (first few: ' + missing.slice(0, 5).join(', ') + '). A chunk ' +
    'failed or returned short. Refusing to score cases whose contract rate was never read - they ' +
    'would present as CANNOT TELL and look like a judgment rather than a lost chunk.');
}
if (duplicates > 0) {
  throw new Error('Join Enrichment: ' + duplicates + ' case_key(s) appeared in more than one chunk. ' +
    'Chunks must partition the candidates; an overlap means one case would be scored twice and ' +
    'reported twice.');
}

let planFailures = 0, replFailures = 0, replDenied = 0;
const out = cases.map(function (c) {
  const d = byKey[s(c.case_key)];
  if (d.plan && d.plan.fetch_failed === true) planFailures++;
  if (d.replacements_meta && d.replacements_meta.fetch_failed === true) replFailures++;
  if (d.replacements_meta && d.replacements_meta.permission_denied === true) replDenied++;
  return { json: Object.assign({}, c, {
    plan: d.plan,
    replacements: Array.isArray(d.replacements) ? d.replacements : [],
    replacements_meta: d.replacements_meta || null
  }) };
});

console.log(JSON.stringify({ stage: 'join_enrichment', cases: out.length,
  deltas_received: deltaCount, chunks: chunksSeen.length, chunk_indexes: chunksSeen,
  plan_fetch_failures: planFailures, replacement_fetch_failures: replFailures,
  replacement_permission_denied: replDenied,
  note: 'joined by case_key across chunks - position means nothing between sub-executions. ' +
        'Emits the same shape the old Attach Replacements did, so the scorer is unchanged.' }));

return out;
