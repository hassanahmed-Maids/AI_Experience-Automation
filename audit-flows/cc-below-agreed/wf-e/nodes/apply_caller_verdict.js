// Apply Caller Verdict (WF-E) - the caller already probed the ClientReplacement grant for this
// whole run, so take its verdict instead of spending a call to ask the same question again.
//
// WHAT THIS REPLACES. Until now every WF-E execution made one probe call of its own: at the
// deployed chunk size of 750, a 5,632-candidate cohort is 8 sub-executions, so a denied run made
// 8 refused calls. WF-A now probes ONCE per run and passes the verdict down, and this node is
// where it lands - so a denied run makes ONE refused call, in WF-A, and none here.
//
// IT IS THE VERDICT THAT CROSSES, NOT A BOOLEAN, and the three-way semantics survive the hop
// unchanged:
//   granted       run the phase.
//   denied        skip the phase and DECLARE the gap for every contract not attempted.
//   inconclusive  RUN THE PHASE ANYWAY - a transient must never mean "no grant".
// `granted` and `inconclusive` both mean "run it", and they are still kept apart rather than
// collapsed, because the run log has to be able to say which of the two happened: one is an
// answer and the other is the absence of one.
//
// WHAT HAPPENS WHEN THE FLAG IS NOT THERE - the property that keeps this workflow callable by
// anyone. This node is only ever reached when `Caller Passed a Verdict?` has already confirmed
// the field holds one of the three known verdicts. Absent, empty, null, misspelt, a number, a
// boolean: all of them route to `Probe Replacements Grant` instead, and WF-E behaves exactly as
// it did before WF-A learned to probe. The check below therefore describes something that
// cannot happen through the canvas - which is precisely why it throws rather than guessing a
// default. A default here would be a fourth meaning for a three-way verdict.
//
// A DEAD TOKEN NEVER ARRIVES HERE AS A VERDICT. WF-A throws on one, before this run reaches its
// enrichment phase at all, for the same reason WF-E's own probe path throws on one: an empty
// maid history scores as "no maid change", so a dead session must be named as a dead session and
// not reported as a permission gap.
//
// ERP-COMPLIANCE: no-breaker-because this node makes no ERP call and reads no batch of ERP
// responses - it reads one field off the trigger payload. There is nothing here for a breaker to
// judge. The batches this chunk does make are judged where they are made: Project Plan's breaker
// on the plan batch above, and Project Replacements' on the replacement batch below.
const KNOWN = ['granted', 'denied', 'inconclusive'];

const incoming = $('When Called').first().json || {};
const raw = incoming.replacements_grant;
const verdict = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
if (KNOWN.indexOf(verdict) === -1) {
  throw new Error('Apply Caller Verdict: the caller passed "' + String(raw) + '", which is not ' +
    'one of ' + KNOWN.join(' / ') + '. This node is only reachable when Caller Passed a Verdict? ' +
    'has already confirmed the field, so reaching it with an unusable value means that IF and ' +
    'this node no longer agree - and the fix is to restore the fallback, not to invent a ' +
    'default. An unrecognised verdict must route to Probe Replacements Grant so this chunk asks ' +
    'ERP for itself; guessing "granted" would spend a whole chunk of refused calls and guessing ' +
    '"denied" would declare a permission gap nobody measured.');
}

const items = $input.all().map(function (i) { return i.json; });
const planItems = $('Project Plan').all().map(function (i) { return i.json; });
// THE WHOLE CHUNK, OR NOTHING. The IF above routes on a value that is identical for every item,
// so a partial route is impossible by construction - which is exactly why it is checked. A short
// stream here would hand Fetch Replacements fewer contracts than the chunk holds, or hand Skip
// Replacements an under-declared gap, and an under-declared gap reads downstream as coverage
// this run never had.
if (items.length !== planItems.length) {
  throw new Error('Apply Caller Verdict: ' + items.length + ' items were routed here but this ' +
    'chunk holds ' + planItems.length + ' candidates. Both paths out of Caller Passed a Verdict? ' +
    'must carry the entire chunk, because the verdict is a property of the RUN and not of any ' +
    'one contract. Refusing to emit a partial chunk.');
}
if (planItems.length === 0) {
  throw new Error('Apply Caller Verdict: no candidates in this chunk. Read Chunk refuses an ' +
    'empty chunk, so an empty stream here is a wiring fault, and emitting nothing would delete ' +
    'this chunk from the caller entirely - Join Enrichment would then fail every case for a ' +
    'missing delta rather than reporting anything about the grant.');
}

// DIAGNOSTIC ONLY, AND OPTIONAL. `replacements_grant_probe` carries the probe's http code and
// whether the refusal actually carried an INSUFFICIENT_PERMISSIONS marker, so that
// _replacement_permission_denied_unmarked keeps meaning what it means when WF-E probes for
// itself. Nothing routes on it. If a caller sends the verdict without it, the http code is
// unknown and the refusal is treated as MARKED - the measured shape of this route - and the
// stage log says the detail was absent, so the assumption is visible as a line rather than
// silently baked into a counter.
const detailRaw = incoming.replacements_grant_probe;
const detail = detailRaw && typeof detailRaw === 'object' && !Array.isArray(detailRaw)
  ? detailRaw : {};
const detailAbsent = Object.keys(detail).length === 0;
const httpCode = Number.isFinite(Number(detail.http_code)) ? Number(detail.http_code) : null;
const marked = detail.marked === false ? false : true;

const granted = verdict !== 'denied';
const probe = { verdict: verdict, http_code: httpCode, marked: marked,
                source: detail.source ? String(detail.source) : 'caller' };

console.log(JSON.stringify({ stage: 'wfe_apply_caller_verdict',
  chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index,
  run_id: $('Read Chunk').first().json.run_id || null,
  probe_verdict: verdict, probe_http_code: httpCode, probe_marked: marked,
  probe_source: probe.source, probe_detail_absent: detailAbsent,
  probed_here: false,
  replacements_granted: granted, candidates_restored: planItems.length,
  replacement_calls_this_chunk_will_make: granted ? planItems.length : 0,
  replacement_calls_avoided: granted ? 0 : planItems.length,
  probe_calls_avoided: 1,
  note: 'the caller probed the ClientReplacement grant ONCE for this run and this chunk took its ' +
        'word for it, so no probe call was made here. Denied means the phase is skipped and the ' +
        'gap is declared for all ' + planItems.length + ' contracts, NOT that they were checked ' +
        'and found clean. Inconclusive deliberately runs the phase anyway.' }));

return items.map(function (d) {
  return { json: Object.assign({}, d, {
    _replacements_granted: granted,
    _replacement_probe: probe
  }) };
});