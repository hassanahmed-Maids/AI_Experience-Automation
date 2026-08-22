#!/usr/bin/env python3
"""Emit the embeddable ERP-breaker block from the canonical tools/erp_breaker.js.

n8n has no shared-code mechanism, so the breaker has to be PASTED into every projection node
that sees a batch of ERP responses. Pasting by hand is how the 15-concurrency setting got into
every node of every flow and stayed there: a copy nobody could tell had drifted. So the copies
are generated, and tools/erp_compliance.py re-generates the block and compares it byte-for-byte
against what is deployed. A drifted copy is a finding, not a matter of opinion.

Usage:  python3 tools/build_breaker_embed.py [--call-site plan|chunk|messages|loop|pages]
                                            [--source-node "Read Chunk"] > block.js

--source-node names the node that stamps `erp_t0` and carries `run_id`, because it is not
called "Read Chunk" in every flow.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'erp_breaker.js')

MARK_BEGIN = '// ===================== ERP CIRCUIT BREAKER (ERP-LOAD-POLICY.md §5) ====================='
MARK_END   = '// =================== END ERP CIRCUIT BREAKER ==================='

def core():
    s = open(SRC, encoding='utf-8').read()
    # Everything from the first const to just before the CommonJS export. The header comment is
    # dropped from the embed (it is long, and the canonical file is one path away) except for
    # the two lines that a reader of the NODE needs in front of them.
    start = s.index('const ERP_BREAKER_DEFAULTS')
    end = s.index('module.exports')
    body = s[start:end].rstrip()
    return body

CALL_SITES = {
 'plan': """
// --- call site: the PLAN phase of this chunk ------------------------------------------------
// `responses` above is one item per candidate, in input order, straight from Fetch Contract Plan.
// A trip here stops this chunk's SECOND phase before it fires, which is 750 calls not made -
// the only mid-chunk saving available, because the HTTP node returns only when its last request
// is done and nothing of ours runs before then.
erpBreakerGuard({
  phase: 'Project Plan (WF-E)',
  key: 'plan',
  responses: responses,
  callsMade: responses.length,
  minCallsForBaseline: 200
});
""",
 'loop': """
// --- call site: a BATCHED LOOP, accumulated across iterations -------------------------------
// This flow reads its population in batches of 5 inside a splitInBatches loop, so this node sees
// only 5 responses per turn. Judged one turn at a time the breaker would be nearly blind: the
// rate rule needs 20 samples and would never fire at all, and "5 consecutive" would mean "this
// entire batch", which is both too sensitive and too late.
//
// So the responses are accumulated across every iteration so far, using .all(0, runIndex) to
// reach earlier runs of each node. The sample grows as the chunk proceeds, which is what makes
// the rate rule meaningful; the elapsed clock is cumulative from the stamp, so ms/call is a
// running mean over the whole chunk rather than a noisy per-batch figure.
function erpBreakerAllRuns(nodeName) {
  const out = [];
  for (let i = 0; i < 5000; i++) {
    let items;
    try { items = $(nodeName).all(0, i); } catch (e) { break; }
    if (!items || !items.length) break;
    for (const it of items) out.push(it.json);
  }
  return out;
}
const _erpBreakerResponses = ERP_BREAKER_LOOP_NODES.reduce(function (acc, n) {
  return acc.concat(erpBreakerAllRuns(n)); }, []);

erpBreakerGuard({
  phase: ERP_BREAKER_PHASE,
  key: 'loop',
  responses: _erpBreakerResponses,
  callsMade: _erpBreakerResponses.length,
  minCallsForBaseline: 200
});
""",
 'messages': """
// --- call site: BOTH message reads of this batch --------------------------------------------
// The two ERP nodes fan out over the same candidates and land in a Merge, so the batch to judge
// is both of them together: a WhatsApp read that is fine and an SMS read that is failing is a
// failing ERP, and judging them apart would halve the consecutive count on each side and let a
// full outage sit under the threshold twice.
erpBreakerGuard({
  phase: 'Resolve Quoted Amounts (WF-B)',
  key: 'messages',
  responses: waResp.concat(smsResp),
  callsMade: waResp.length + smsResp.length,
  minCallsForBaseline: 200
});
""",
 'pages': """
// --- call site: a PAGED SWEEP that enumerates its own pages ---------------------------------
// One item per page, straight from the population fetch, in page order.
//
// BE HONEST ABOUT WHAT CAN FIRE HERE, because a breaker that looks present and cannot speak is
// worse than none. A population sweep is ~12 pages, so of the three detectors:
//   - consecutive (5)     CAN fire. Five pages failing in a row is ERP falling over, and this
//                         is the last gate before the per-entity phase spends ~16,000 calls.
//   - rate (>=20 samples) CANNOT. Twelve responses never reach the minimum, by design: a
//                         quarter of twelve is three, and three bad pages is not a diagnosis.
//   - latency (3x)        CANNOT. The baseline is only ever taken from a batch of >=200 calls,
//                         so a 12-call sweep neither sets one nor is measured against one.
//
// AND IT DOES NOT CHANGE WHETHER THIS RUN STOPS. The guard below this block already refuses on
// a single malformed page, which is stricter than five. What the breaker changes is WHAT THE
// OPERATOR IS TOLD: the shape check reports "expected a bare array... the account lacks the
// grant", which is the wrong diagnosis to hand someone while ERP is on fire, and it counts auth
// separately so a dead token is never reported as degradation. Per section 5 the message is the
// thing anyone actually reads at the moment a run dies.
//
// It must therefore run BEFORE the shape check, or the shape check throws first and this never
// speaks.
erpBreakerGuard({
  phase: ERP_BREAKER_PHASE,
  key: 'pages',
  responses: responses,
  callsMade: responses.length,
  minCallsForBaseline: 200
});
""",
 'chunk': """
// --- call site: the WHOLE CHUNK ---------------------------------------------------------
// Measured from Read Chunk's stamp, so this covers BOTH phases and is divided by both phases'
// calls. It is a chunk mean, not a replacements mean, and it is named that way on purpose: the
// two HTTP nodes cannot be timed apart without a stamp between them, and adding a field to
// every delta to carry one would cross the WF-E boundary for the sake of a number.
erpBreakerGuard({
  phase: 'Project Replacements (WF-E)',
  key: 'chunk',
  responses: responses,
  callsMade: responses.length * 2,
  minCallsForBaseline: 200
});
"""
}

GUARD = """
// --- the guard: reads the run's baseline, decides, logs, and throws if tripped ---------------
//
// THE BASELINE HAS TO SURVIVE BETWEEN CHUNKS, and it cannot travel in the payload: WF-A builds
// every chunk item up front and hands them to Execute Workflow in `each` mode, so there is no
// point at which WF-A can put chunk N's measurement into chunk N+1's input. n8n's per-workflow
// static data is the only carrier left. It is saved at the end of an execution and is NOT
// written for manual test runs, so the baseline can legitimately be absent - which is why an
// absent baseline disables the latency check rather than defaulting it, and why every batch
// logs `baseline_carried`. A latency check that silently never fires is the false-clearance
// shape this project keeps finding; this one announces itself in the log chain instead.
function erpBreakerStatic() {
  try { return $getWorkflowStaticData('global') || {}; } catch (e) { return null; }
}
function erpBreakerGuard(opts) {
  const src = $('Read Chunk').first().json || {};
  const runId = String(src.run_id || '');
  const t0 = Number(src.erp_t0);
  const elapsed = Number.isFinite(t0) && t0 > 0 ? Date.now() - t0 : null;

  const sd = erpBreakerStatic();
  // A new run must not inherit the previous run's baseline: ERP at 9am and ERP at 9pm are not
  // the same server, and comparing across runs would trip on the time of day.
  if (sd && sd.erp_breaker_run !== runId) { sd.erp_breaker_run = runId; sd.erp_breaker_baseline = {}; }
  const base = (sd && sd.erp_breaker_baseline) || {};

  const v = erpBreakerEvaluate({
    phase: opts.phase, responses: opts.responses,
    elapsedMs: elapsed, callsMade: opts.callsMade,
    baselineMsPerCall: base[opts.key]
  });

  console.log(JSON.stringify({ stage: 'erp_breaker', phase: opts.phase, key: opts.key,
    run_id: runId || null, chunk_index: src.chunk_index === undefined ? null : src.chunk_index,
    total: v.total, counts: v.counts, degraded_rate: v.degraded_rate,
    consecutive_max: v.consecutive_max, ms_per_call: v.ms_per_call,
    baseline_ms_per_call: v.baseline_ms_per_call, baseline_carried: v.baseline_carried,
    latency_multiple: v.latency_multiple, tripped: v.trip ? v.trip.code : null,
    static_data_available: sd !== null,
    note: 'ERP-LOAD-POLICY.md §5. auth failures are counted but are NOT degradation - the ' +
          'permanent 401 on every replacement call would otherwise trip this on call five of ' +
          'every run ever fired' }));

  if (v.trip) throw new Error(erpBreakerMessage(v, opts.phase, runId));

  // The baseline is set from the first batch BIG enough to mean anything. A canary chunk of 50
  // amortises fixed overhead over 50 calls and reads slower per call than a chunk of 750, so
  // taking the baseline from it would inflate the threshold and make the breaker LESS sensitive
  // for the rest of the run - a safety check quietly weakened by the safety measure in front
  // of it.
  if (sd && !base[opts.key] && v.ms_per_call && opts.callsMade >= (opts.minCallsForBaseline || 200)) {
    base[opts.key] = v.ms_per_call;
    sd.erp_breaker_baseline = base;
    console.log(JSON.stringify({ stage: 'erp_breaker_baseline_set', key: opts.key,
      ms_per_call: v.ms_per_call, calls: opts.callsMade, run_id: runId || null }));
  }
}
"""

def block(call_site, source_node='Read Chunk'):
    parts = [MARK_BEGIN,
      '// GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js',
      '// Re-generate with: python3 audit-flows/tools/build_breaker_embed.py --call-site ' + call_site +
      (' --source-node "' + source_node + '"' if source_node != 'Read Chunk' else ''),
      '//',
      '// Pacing (§1) bounds requests per second. The pre-flight gate (§3) bounds how many there',
      '// are. Neither notices that ERP has ALREADY STARTED FAILING and keeps feeding it the',
      '// remaining ten thousand calls. This does. Aborting loses a run; not aborting loses ERP.',
      core(), GUARD.strip().replace("$('Read Chunk')", "$('" + source_node + "')"),
      CALL_SITES[call_site].strip(), MARK_END]
    return '\n'.join(parts) + '\n'

if __name__ == '__main__':
    cs = 'plan'
    if '--call-site' in sys.argv:
        cs = sys.argv[sys.argv.index('--call-site') + 1]
    sn = 'Read Chunk'
    if '--source-node' in sys.argv:
        sn = sys.argv[sys.argv.index('--source-node') + 1]
    sys.stdout.write(block(cs, sn))
