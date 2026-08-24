// Classify Grant Probe (WF-A) - read the ONE ClientReplacement grant probe for the WHOLE RUN,
// then hand the chunks back with the verdict stamped on each of them.
//
// WHY THERE IS A PROBE IN WF-A AT ALL, when WF-E already has one. `Fetch Replacements` inside
// WF-E calls GET /complaints/replacement/page/contract/{id} under pagecode ClientReplacement,
// once per candidate. On an operator whose ERP identity lacks that grant, EVERY one of those
// calls returns 401 INSUFFICIENT_PERMISSIONS - ~5,632 refused requests per run on the real July
// cohort. The denial is ACCOUNT-scoped, not check-scoped: the same route returns 200 on another
// operator's token (PROBE-RESULTS correction 2). WF-E's own probe already cut that to one call
// per CHUNK, because a WF-E execution handles one chunk and separate executions share no memory.
// This node is the last hop: WF-A runs once per RUN, so probing here and passing the verdict
// down makes it ONE refused call for the whole run instead of one per chunk.
//
// BE HONEST ABOUT THE SIZE OF THIS. At the deployed chunk size of 750 a 5,632-candidate cohort
// is 8 chunks, so this saves SEVEN refused calls out of ~11,264 - about 0.06% of the run. It is
// worth doing only because it is cheap and total: after it, a denied run makes exactly one call
// that was known to fail before it was sent, and that is the smallest number available.
//
// THE VERDICT IS THREE-WAY AND IT CROSSES THE BOUNDARY AS A VERDICT, NOT AS A BOOLEAN:
//   granted       the probe returned a replacement page -> WF-E runs the phase, as before.
//   denied        401/403 with no dead-token marker -> WF-E skips the phase and DECLARES the gap
//                 for every contract it did not attempt (Skip Replacements). Never "clean".
//   inconclusive  a 5xx, a timeout, a 404, anything else -> WF-E RUNS THE PHASE ANYWAY. A
//                 transient must never be allowed to mean "no grant": one bad second would
//                 otherwise convert a whole RUN - not just a chunk - into declared non-coverage.
//                 Falling through costs calls and loses nothing; the real batches are then judged
//                 by Project Replacements' own breaker, chunk by chunk, as they always were.
// Collapsing this to a boolean is the one shape that must not happen: `false` would have to mean
// both "refused" and "we could not tell", and those have opposite safe answers.
//
// A DEAD TOKEN THROWS HERE. Every read after a token dies is empty, and an empty maid history
// scores downstream as "no maid change" - so continuing would clear cases nobody read, and
// reporting it as a permission gap would name the wrong problem for a state the flow already
// knows how to describe. It also fails EARLY, before the ~11,264-call enrichment phase, which is
// the whole point of finding out once.
//
// THE REGRESSION THIS BUYS, STATED RATHER THAN BURIED. WF-E's per-chunk probe re-detected a
// grant REVOKED MID-RUN: the chunk in flight made its refused calls, and every chunk after it
// skipped. Probing once per run loses that. If the grant is revoked after this node has answered
// `granted`, WF-E is told `granted` for every remaining chunk, `Fetch Replacements` 401s through
// all of them, `Project Replacements` counts them denied and the gap is still declared - so the
// audit's knowledge is unchanged and nothing reads as falsely clean - but the refused calls are
// made. The bound is therefore THE REST OF THE RUN (worst case ~5,632 refused calls, i.e. what
// this flow did on every denied run until 2026-08-24), not one chunk. That is a real widening of
// the blast radius on a rare event, traded for seven calls on the everyday one, and
// `Project Replacements`' `config: { authWall: false }` opt-out is what allows it to run on
// rather than kill the run. See wf-e/README.md - the trade is written down there so it can be
// reversed by whoever disagrees: WF-E still probes for itself whenever this verdict is absent,
// so removing the two fields from `Enrich Candidates (WF-E)` restores the per-chunk behaviour
// exactly, with no other change.
//
// ERP-COMPLIANCE: no-breaker-because this node reads a batch of ONE probe response and not one of
// the breaker's four thresholds can fire on it - maxConsecutive is 5, rateMinSamples is 20,
// authWallMinSamples is 5, and the latency rule needs a baseline taken from a batch of at least
// 200 calls. A breaker here could only ever return "nothing tripped", which is the false-clearance
// shape this repo removes rather than adds. What stops the run instead: a dead token throws in
// this node, and a degrading ERP is judged by WF-E's own breakers on every plan and replacement
// batch that follows - an inconclusive probe deliberately falls through to exactly those.
const chunks = $('Chunk Candidates').all().map(function (i) { return i.json; });
const probes = $input.all().map(function (i) { return i.json; });

// ZERO CHUNKS IS LEGITIMATE HERE, and this is the one place WF-A and WF-E genuinely differ.
// WF-E's Read Chunk refuses an empty chunk, so its Restore Chunk Items throws on an empty
// stream. In WF-A, zero chunks means every contract in the cohort received nothing in the
// audited month - gate 1 closed the whole cohort out, Chunk Candidates says so and returns [],
// and the enrichment branch is meant to stop. Returning [] reproduces exactly that.
if (chunks.length === 0) {
  console.log(JSON.stringify({ stage: 'wfa_classify_grant_probe', chunks: 0,
    note: 'no chunks to enrich, so there is nothing to pass a grant verdict to. This is the ' +
          'legitimate empty state Chunk Candidates already reported, not a failure.' }));
  return [];
}
// ONE probe, or executeOnce has been lost on the node above - at which point it fans out over
// every chunk and makes one refused call per chunk again, silently undoing this node's entire
// reason to exist. The calls are already spent by the time anything of ours runs, so the only
// thing left worth doing is refusing to let the regression pass unnoticed.
if (probes.length !== 1) {
  throw new Error('Classify Grant Probe: expected exactly ONE probe response and got ' +
    probes.length + '. The Probe Replacements Grant node must run with executeOnce: true - ' +
    'without it the probe fans out over every chunk, which is the per-chunk cost this node ' +
    'exists to remove. Re-enable executeOnce on that node.');
}
const resp = probes[0] || {};

// Classification, lifted VERBATIM from WF-E's Restore Chunk Items so the two nodes cannot
// disagree about what a refusal is. If one of these changes, change both.
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

const fetchFailed = !Array.isArray(resp.content) &&
  !!(resp.error || resp.status || resp.message || resp.path);

let verdict = 'granted', httpCode = null, marked = true, sample = '';
if (fetchFailed) {
  httpCode = httpCodeOf(resp);
  const text = failureText(resp);
  sample = text.slice(0, 220);
  if (isTokenDead(text)) {
    throw new Error('WF-A: the ClientReplacement grant probe came back as a DEAD TOKEN ' +
      '(logout / unauthenticated / 498), not a permission denial. Every ERP read after a token ' +
      'dies is empty, and an empty maid history scores as "no maid change" - so continuing would ' +
      'clear cases nobody read, and passing a denial down would report a permission gap that is ' +
      'not the problem. Re-issue the bearer and re-run; this fails before the enrichment phase ' +
      'rather than 11,264 calls into it. Sample: ' + sample);
  }
  if (isPermissionDenied(httpCode, text)) {
    verdict = 'denied';
    // UNMARKED means the refusal carried no INSUFFICIENT_PERMISSIONS marker - a bare 401/403. It
    // is still read as a denial, because that is the measured shape of this route, but it is
    // carried down to WF-E so a change in ERP's error vocabulary shows up as a number rather
    // than as silence. Skip Replacements charges the whole chunk to this flag.
    marked = text.indexOf('insufficient_permissions') !== -1;
  } else {
    verdict = 'inconclusive';
  }
}

const perChunk = chunks.map(function (c) {
  return Array.isArray(c.cases) ? c.cases.length : 0;
}).reduce(function (a, b) { return a + b; }, 0);

console.log(JSON.stringify({ stage: 'wfa_classify_grant_probe',
  run_id: chunks[0] && chunks[0].run_id ? chunks[0].run_id : null,
  probe_verdict: verdict, probe_http_code: httpCode, probe_marked: marked,
  probe_sample: sample || null,
  chunks: chunks.length, candidates: perChunk,
  replacement_calls_this_run_will_make: verdict === 'denied' ? 0 : perChunk,
  replacement_calls_avoided: verdict === 'denied' ? perChunk : 0,
  wfe_probes_avoided: chunks.length,
  note: 'ONE call asked whether this account holds ClientReplacement, for the whole run. Denied ' +
        'means WF-E skips the phase and DECLARES the gap for all ' + perChunk + ' contracts, NOT ' +
        'that they were checked and found clean. Inconclusive deliberately runs the phase anyway ' +
        '- a transient must never read as a missing grant. WF-E falls back to its own per-chunk ' +
        'probe whenever this verdict is absent or unrecognised, so an older caller is unchanged.' }));

// The two fields that cross the boundary. `replacements_grant` is the CONTRACT - WF-E routes on
// it and on nothing else. `replacements_grant_probe` is DIAGNOSTIC ONLY: it carries the http code
// and the INSUFFICIENT_PERMISSIONS marker so that _replacement_permission_denied_unmarked keeps
// meaning what it means today, and WF-E defaults it safely when it is missing.
return chunks.map(function (c) {
  return { json: Object.assign({}, c, {
    replacements_grant: verdict,
    replacements_grant_probe: { http_code: httpCode, marked: marked, source: 'wf-a-run-probe' }
  }) };
});