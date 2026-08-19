// Join Enrichment (WF-T) - one item per case in this batch.
//
// THE NAME, AGAIN, IS LOAD-BEARING. Guards reads $('Join Enrichment').all() to build its
// plan-delta map by case_key (gate 35 needs monthly_schedule_starts), and Compute Case
// States reads $input.all(). Emitting the batch here, under this name, satisfies both
// without editing either - the same reason WF-A's own Join Enrichment kept its name when
// the enrichment moved into WF-E.
//
// NOTHING IS PROJECTED OUT HERE, and that is deliberate. The obvious optimisation is to
// pass the scorer only the fields it reads, and it was measured and rejected: the scorer
// trio reads nearly every field an assembled case carries (checked field by field against
// all 41 node bodies on 2026-08-19), so an allow-list would save little and would fail
// DANGEROUSLY - a field left off reads as undefined and moves a verdict silently, with no
// error anywhere. The batch boundary is what bounds memory here, not a projection.
const incoming = $('When Called').first().json || {};
const cases = Array.isArray(incoming.cases) ? incoming.cases : [];

const seen = {};
let dupes = 0, keyless = 0;
for (const c of cases) {
  const k = c && c.case_key !== undefined && c.case_key !== null ? String(c.case_key) : '';
  if (!k) { keyless++; continue; }
  if (seen[k]) dupes++;
  seen[k] = true;
}
// A duplicate case_key inside one batch would be scored twice, reported twice and counted
// twice in the run totals. The chunker partitions by index so it cannot happen by accident,
// which is exactly why it is checked here rather than assumed.
if (dupes > 0) {
  throw new Error('WF-T: ' + dupes + ' duplicate case_key(s) in one batch of ' + cases.length +
    '. Chunk Cases partitions the cohort, so an overlap is a chunker fault - and a case scored ' +
    'twice appears twice on the Cases tab and twice in the run total.');
}
if (keyless > 0) {
  throw new Error('WF-T: ' + keyless + ' case(s) in this batch have no case_key. Guards joins ' +
    'its plan deltas by that key, so a keyless case would be scored with NO plan - expected ' +
    'unknown, routed to a human as "cannot tell", looking like a judgment rather than a bug.');
}

console.log(JSON.stringify({ stage: 'wft_join_enrichment', cases: cases.length,
  note: 'one item per case; no projection - the scorer reads nearly every field and an ' +
        'allow-list would fail silently' }));

return cases.map(function (c) { return { json: c }; });
