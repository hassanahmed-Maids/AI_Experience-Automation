// Restore Chunk Items (WF-E) - read the ONE grant probe, then hand this chunk's items back.
//
// WHY THERE IS A PROBE AT ALL. `Fetch Replacements` calls
// GET /complaints/replacement/page/contract/{id} under pagecode ClientReplacement, once per
// candidate. On an operator whose ERP identity lacks that grant, EVERY one of those calls
// returns 401 INSUFFICIENT_PERMISSIONS - measured on the real July cohort that is ~5,632
// refused requests per run, every one of them known to be refused before it is sent. The
// denial is ACCOUNT-scoped, not check-scoped: the same route returns 200 on another operator's
// token (PROBE-RESULTS correction 2), so this is a real permission gap and not a flow bug -
// but rediscovering it 5,632 times a run is indefensible load on production ERP.
//
// So the grant is asked about ONCE per sub-execution, and the answer decides whether the phase
// runs at all. A WF-E execution handles one chunk, and separate executions share no memory, so
// "once per run" is not available from inside this workflow: at the default chunk size of 750
// a 5,632-candidate cohort is a 50-candidate canary plus eight chunks = NINE executions, so
// this turns ~5,632 refused calls into NINE. Collapsing those nine into one needs WF-A to probe
// and pass a flag down, which is a change to WF-A and is not made here.
//
// WHY IT ALSO HANDS THE ITEMS BACK. `Fetch Replacements` fans out over its input, one call per
// item, reading $json.contract_id. The probe node above runs `executeOnce`, so it emits ONE
// item - and one item reaching Fetch Replacements would enrich one contract instead of 750,
// silently. This node therefore re-emits `$('Project Plan').all()`, which is this repo's
// existing idiom for the same problem (`Project Replacements` reads its plan deltas exactly
// that way today, and `Join Enrichment` reads `$('Needs enrichment?').all(0)`), with the
// probe's verdict attached to every item so the IF below can route on it.
//
// THE VERDICT IS THREE-WAY, NOT TWO-WAY, and the third value is the one that keeps this safe:
//   granted       the probe came back with a replacement page -> run the phase, exactly as before.
//   denied        401/403 with no dead-token marker -> skip the phase, and DECLARE the gap for
//                 every contract that was not attempted (see Skip Replacements).
//   inconclusive  a 5xx, a timeout, a 404, anything else -> RUN THE PHASE ANYWAY. A transient
//                 must never be allowed to mean "no grant": that would silently convert one bad
//                 second into a whole chunk reported as uncovered. Falling through costs calls
//                 and loses nothing, and the real batch is then judged by Project Replacements'
//                 own breaker - which is the node that is built to judge a batch.
//
// A DEAD TOKEN THROWS, and does not read as a denial. `Project Replacements` already refuses to
// return a chunk whose reads came back logged-out, because an empty maid history scores as "no
// maid change" and clears cases nobody looked at. Classifying <LOGOUT> as "no grant" here would
// route that same run down the skip path and report a permission gap instead of a dead session -
// a wrong diagnosis for a state the flow already knows how to name.
//
// ERP-COMPLIANCE: no-breaker-because this node reads a batch of ONE probe response and not one
// of the breaker's four thresholds can fire on it - maxConsecutive is 5, rateMinSamples is 20,
// authWallMinSamples is 5, and the latency rule needs a per-key baseline taken from a batch of
// at least 200 calls. A breaker here could only ever return "nothing tripped", which is the
// false-clearance shape this repo keeps removing rather than adding. What stops the run instead:
// a dead token throws in this node; a degraded ERP is judged by `Project Plan`'s breaker on the
// batch immediately before this one and by `Project Replacements`' breaker on the batch after,
// and an inconclusive probe deliberately falls through to that second batch rather than being
// treated as an answer.
const planItems = $('Project Plan').all().map(function (i) { return i.json; });
const probes = $input.all().map(function (i) { return i.json; });

if (planItems.length === 0) {
  throw new Error('Restore Chunk Items: Project Plan returned no items, so there is nothing to ' +
    'restore. Read Chunk refuses an empty chunk, so this cannot be a legitimate empty run - ' +
    'refusing rather than emitting an empty stream, which would silently delete the replacement ' +
    'phase and every delta this chunk owes its caller.');
}
// ONE probe, or something is wrong with the node above. `executeOnce` is what makes this a
// single call; if it is ever lost, this node receives one probe response per candidate - which
// is exactly the ~5,632 refused requests the probe exists to remove, made silently. Loud beats
// silent: the calls are already spent by the time anything of ours runs, so the only thing left
// worth doing is refusing to let the regression pass unnoticed.
if (probes.length !== 1) {
  throw new Error('Restore Chunk Items: expected exactly ONE probe response and got ' +
    probes.length + '. The Probe Replacements Grant node must run with executeOnce: true - ' +
    'without it the probe fans out over every candidate and makes the whole phase of refused ' +
    'calls this design exists to avoid. Re-enable executeOnce on that node.');
}
const resp = probes[0] || {};

// Classification, lifted verbatim from Project Replacements so the two nodes cannot disagree
// about what a refusal is. If one of these changes, change both.
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
  return (code === 401 || code === 403);
}

// The same success test Project Replacements uses on every response: a real page carries a
// `content` array. Anything without one that also carries an error shape is a failed call.
const fetchFailed = !Array.isArray(resp.content) &&
  !!(resp.error || resp.status || resp.message || resp.path);

let verdict = 'granted', httpCode = null, marked = true, sample = '';
if (fetchFailed) {
  httpCode = httpCodeOf(resp);
  const text = failureText(resp);
  sample = text.slice(0, 220);
  if (isTokenDead(text)) {
    throw new Error('WF-E: the ClientReplacement grant probe came back as a DEAD TOKEN ' +
      '(logout / unauthenticated / 498), not a permission denial. Every read after a token dies ' +
      'is empty, and an empty maid history scores as "no maid change" - so continuing would ' +
      'clear cases nobody read, and skipping the phase would report a permission gap that is ' +
      'not the problem. Re-issue the bearer and re-run. Sample: ' + sample);
  }
  if (isPermissionDenied(httpCode, text)) {
    verdict = 'denied';
    // UNMARKED means the refusal carried no INSUFFICIENT_PERMISSIONS marker - a bare 401/403.
    // It is still read as a denial, because that is the measured shape of this route, but it is
    // carried forward so a change in ERP's error vocabulary shows up as a number rather than as
    // silence. Skip Replacements charges the whole chunk to this flag.
    marked = text.indexOf('insufficient_permissions') !== -1;
  } else {
    // NOT an answer. See the three-way note in the header: a transient must not be allowed to
    // mean "no grant", so the phase runs and the real batch gets judged properly.
    verdict = 'inconclusive';
  }
}

const granted = verdict !== 'denied';
const probe = { verdict: verdict, http_code: httpCode, marked: marked };

console.log(JSON.stringify({ stage: 'wfe_restore_chunk_items',
  chunk_index: $('Read Chunk').first().json.chunk_index === undefined
    ? null : $('Read Chunk').first().json.chunk_index,
  run_id: $('Read Chunk').first().json.run_id || null,
  probe_verdict: verdict, probe_http_code: httpCode, probe_marked: marked,
  probe_sample: sample || null,
  replacements_granted: granted, candidates_restored: planItems.length,
  replacement_calls_this_chunk_will_make: granted ? planItems.length : 0,
  replacement_calls_avoided: granted ? 0 : planItems.length,
  note: 'ONE call asked whether this account holds ClientReplacement. Denied means the phase is ' +
        'skipped and the gap is declared for all ' + planItems.length + ' contracts, NOT that ' +
        'they were checked and found clean. Inconclusive deliberately runs the phase anyway - a ' +
        'transient must never read as a missing grant.' }));

return planItems.map(function (d) {
  return { json: Object.assign({}, d, {
    _replacements_granted: granted,
    _replacement_probe: probe
  }) };
});
