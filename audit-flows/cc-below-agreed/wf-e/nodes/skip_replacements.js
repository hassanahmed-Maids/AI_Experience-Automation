// Skip Replacements (WF-E) - the phase was NOT run, so say so for every contract, in the exact
// shape Project Replacements would have returned.
//
// THIS NODE IS THE CORRECTNESS CRUX OF THE PROBE, and it has exactly one way to go wrong.
// Today a denied account produces ~5,632 real 401s, `_replacement_permission_denied` counts
// them, and gate 7 reports coverage as CAPPED off that count. If skipping the calls also
// dropped that count to zero, a capped run would start reading as a complete one - which is the
// false-clean shape (execution 100409) this repo spent a day eliminating. Trading 5,632 wasted
// requests for a false all-clear is a bad deal, and it is not the deal being made here.
//
// So the rule this node exists to keep: THE DECLARED COUNT EQUALS THE NUMBER OF CONTRACTS THAT
// WERE NOT ATTEMPTED. Not zero, not the number of calls made (which is zero), not a flag - the
// same number a fully denied run reports today. A run that skips 750 contracts is indistinguish-
// able downstream from a run that asked 750 times and was refused 750 times, and that is the
// point: the only thing that changed is the load on ERP, not what the audit knows.
//
// WHAT DOWNSTREAM READS, and why each field is what it is:
//   replacements_meta.fetch_failed=true   Compute Case States' coveredDays() returns
//                                         {known:false, why:'replacement_fetch_failed'} on it,
//                                         so gate 7 marks coverage unknown and routes the case
//                                         to a human. An empty maid history with fetch_failed
//                                         FALSE would score as "no maid change" and clear cases
//                                         nobody looked at - the exact inversion to avoid.
//   replacements_meta.permission_denied   counted by Join Enrichment into
//                                         replacement_permission_denied on the run log.
//   replacements_meta.token_dead=false    a skip is never a dead token; a dead token throws in
//                                         Restore Chunk Items before this node is reached.
//   replacements: []                      the same empty array a refused call produces.
//
// `not_attempted` and the `_replacement_phase_skipped` / `_replacement_skip` fields are ADDITIVE
// and nothing downstream reads them: Join Enrichment reads only `enriched` and `_chunk_index`,
// coveredDays reads only fetch_failed and truncated. They exist so a person reading a case or a
// run log can tell "we were refused" from "we did not ask" - a distinction the counters
// deliberately do NOT make, because the audit's knowledge is identical either way.
const planDeltas = $('Project Plan').all().map(function (i) { return i.json; });
const routed = $input.all().map(function (i) { return i.json; });

// EVERY CONTRACT IN THIS CHUNK IS ACCOUNTED FOR, or this refuses to emit. The IF above routes on
// a flag that is identical on every item, so a partial route is impossible by construction -
// which is exactly why it is checked. A short stream here would under-declare the gap, and an
// under-declared gap is the false-clean failure this node exists to prevent.
if (routed.length !== planDeltas.length) {
  throw new Error('Skip Replacements: ' + routed.length + ' items were routed down the skip ' +
    'path but this chunk holds ' + planDeltas.length + ' candidates. The declared permission ' +
    'gap must cover every contract that was not attempted, and a short stream would report ' +
    'fewer uncovered contracts than there are - which reads downstream as coverage this run ' +
    'never had. Refusing to emit a partial declaration.');
}
if (planDeltas.length === 0) {
  throw new Error('Skip Replacements: no candidates in this chunk. Read Chunk refuses an empty ' +
    'chunk, so an empty stream here is a wiring fault, and emitting nothing would delete this ' +
    'chunk from the caller entirely - Join Enrichment would then fail every case for a missing ' +
    'delta rather than reporting a permission gap.');
}

const probe = (routed[0] && routed[0]._replacement_probe) || {};
// UNMARKED is charged to the whole chunk from the ONE probe, because the one probe is all the
// evidence there is. A bare 401/403 with no INSUFFICIENT_PERMISSIONS marker is still read as a
// denial - that is the measured shape of this route - but it is counted separately so a change
// in ERP's error vocabulary surfaces as this number rising rather than as silence.
const unmarked = probe.marked === false ? planDeltas.length : 0;

const enriched = planDeltas.map(function (d) {
  return {
    case_key: d.case_key,
    contract_id: d.contract_id,
    client_id: d.client_id,
    plan: d.plan,
    replacements: [],
    replacements_meta: {
      fetch_failed: true,
      permission_denied: true,
      token_dead: false,
      rows: 0,
      declared_total: null,
      truncated: null,
      // Additive. "We did not ask" rather than "we asked and were refused" - same knowledge,
      // different load on ERP, and a reader should not have to guess which happened.
      not_attempted: true
    }
  };
});

if (enriched.length !== planDeltas.length) {
  throw new Error('Skip Replacements: returning ' + enriched.length + ' deltas for ' +
    planDeltas.length + ' candidates. The caller cannot distinguish a missing delta from an ' +
    'unsent candidate.');
}

console.log(JSON.stringify({ stage: 'wfe_skip_replacements',
  candidates: enriched.length,
  replacement_fetch_failures: enriched.length,
  permission_denied: enriched.length,
  permission_denied_unmarked: unmarked,
  token_dead: 0, other_failures: 0,
  probe_verdict: probe.verdict || null, probe_http_code: probe.http_code === undefined ? null : probe.http_code,
  replacement_calls_made: 0,
  replacement_calls_avoided: enriched.length,
  note: 'THE PHASE WAS SKIPPED, NOT PASSED. The ClientReplacement grant probe was refused, so ' +
        'no replacement call was made for any of these ' + enriched.length + ' contracts and ' +
        'the gap is declared for all of them - the same count a fully refused run reports. ' +
        'Coverage for these cases is UNKNOWN, never clean.' }));

return [{ json: {
  enriched: enriched,
  _projected_by: 'CC Below Agreed - 0-Enrich Candidates',
  _candidates: enriched.length,
  _plan_fetch_failures: planDeltas.filter(function (d) {
    return d.plan && d.plan.fetch_failed === true; }).length,
  // The three counters WF-A reads. Every one of them carries the same number a fully denied
  // chunk carries today: the gap is the same size whether it was measured 750 times or once.
  _replacement_fetch_failures: enriched.length,
  _replacement_permission_denied: enriched.length,
  _replacement_permission_denied_unmarked: unmarked,
  _replacement_other_failures: 0,
  // Additive, and nothing downstream reads them - see the header.
  _replacement_phase_skipped: true,
  _replacement_skip: { reason: 'clientreplacement_grant_probe_denied',
                       probe_verdict: probe.verdict || null,
                       probe_http_code: probe.http_code === undefined ? null : probe.http_code,
                       calls_avoided: enriched.length },
  _chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index
} }];
