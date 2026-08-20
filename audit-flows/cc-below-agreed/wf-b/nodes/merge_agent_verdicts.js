// Merge Agent Verdicts - reconcile the two branches into one verdict per case.
// CLONED from the sibling. The pairing logic, the judge-the-payload rule, the
// unreviewed fallback and the pairing-integrity assertion are SKELETON and
// unchanged. Added for this check: FOUR verdicts instead of three, the
// quoted-amount precondition on any Finding, and `finding_reason` set on the case.
//
// Every case leaves here as exactly one of three `decided_by` values:
//   deterministic - Build Evidence Bundle already settled it (nothing quotable
//                   exists anywhere to read). Skipped the model; carries
//                   why_no_model.
//   model         - genuinely ambiguous, judged by the verifier.
//   unreviewed    - routed to the verifier, came back unusable (errored item,
//                   missing item, or no valid verdict). Carries a safe default
//                   verdict and why_no_model, and is counted in `unreviewed`.
//                   NEVER report one of these as a model judgement.
//
// The verifier only ever saw the non-deterministic bundles, in order, so its Nth
// output belongs to the Nth non-deterministic bundle. Walking the bundles and
// advancing a separate cursor is what keeps that pairing correct across the gate.
// The verifier may not have executed at all - hence the try/catch.
//
// VERIFIER_NODE must name the node that actually emits verdicts. On the sibling it
// moved three times, and every time it moved this constant had to move with it: if
// it names a node that did not run, the read below THROWS, the catch swallows it,
// agentOuts is empty, and every verdict is silently discarded while the run still
// reports a completed review. Change this string whenever the verifier changes.
const VERIFIER_NODE = 'Verify Candidates';

// THE ONLY VERDICTS THAT EXIST. Anything else did not come from a working model,
// whatever the item looks like. Mirrors the enum in the Verdict Schema node - if
// you change one, change the other.
//
// FOUR, NOT THREE, and the extra one is not a nicety: the two finding reasons must
// stay separate because they need different follow-up from different teams.
//   Agent Finding - Under-billed  we asked LESS than the contract says. Accounting
//                                 billed the wrong number; the client paid what we
//                                 asked. Fixing it is a billing correction.
//   Agent Finding - Underpaid     we asked the contract rate and LESS arrived. The
//                                 client owes the difference; it is a collection.
// Same money, opposite owners. The scorer cannot tell them apart - only what we
// actually quoted can - which is why the precondition below is enforced in code.
const VALID_VERDICTS = [
  'Agent Justified',
  'Agent Candidate - Auditor Review Required',
  'Agent Finding - Under-billed',
  'Agent Finding - Underpaid'
];
const FALLBACK_VERDICT = 'Agent Candidate - Auditor Review Required';
const FINDING_VERDICTS = ['Agent Finding - Under-billed', 'Agent Finding - Underpaid'];
// The verdict -> finding_reason mapping. The display words (Underpaid /
// Under-billed / Paid in full or not owed / In flight / Can't tell) are still
// PROPOSED and not signed off by the owner - do not harden this further until they
// are.
const FINDING_REASON = {
  'Agent Finding - Under-billed': 'Under-billed',
  'Agent Finding - Underpaid': 'Underpaid'
};

const validated = $('Validate Inputs').first().json;
const bundles = $('Build Evidence Bundle').all().map(function (i) { return i.json; });

let agentOuts = [];
try {
  agentOuts = $(VERIFIER_NODE).all().map(function (i) { return i.json; });
} catch (e) {
  agentOuts = [];   // every case was deterministic; the verifier never ran
}

function s(v) { return v === null || v === undefined ? '' : String(v); }

// THE QUOTED AMOUNT IS THE PRECONDITION FOR A FINDING, so it is read from the
// resolver BY NODE NAME rather than trusted to have been copied into the bundle.
// If the bundle carries it, that wins (it is the object the model actually saw);
// otherwise the resolver's own output is joined on case_key. A case that appears
// in neither has NO quoted amount, and that is treated as "not resolved" - never
// as "resolved to nothing".
const quotedByKey = {};
try {
  for (const it of $('Resolve Quoted Amounts').all()) {
    const j = it.json || {};
    if (j.case_key && j.quoted) quotedByKey[s(j.case_key)] = j.quoted;
  }
} catch (e) { /* the resolver may be bypassed on a re-run of the verifier alone */ }

function quotedFor(b) {
  if (b && b.quoted) return b.quoted;
  if (b && b.facts && b.facts.quoted) return b.facts.quoted;
  return quotedByKey[s(b && b.case_key)] || {};
}
// Resolved means: a quote was found AND the message read did not fail. Either flag
// set means we do not know what we told this client, and gate 14's honest limit
// applies - no quote at all is NOT evidence that nothing was quoted. It can equally
// mean the message predates the log window, went by a channel this endpoint does
// not carry, or used a template the baked lookup does not know.
function quoteResolved(q) {
  return !!q && q.no_quote_found !== true && q.read_failed !== true;
}

// Derive the agent-review endpoint BEFORE doing any work: if it cannot be derived,
// posting the verdicts anywhere else would misfile them (ta-callback would reject
// them as a duplicate results post, or worse). Throwing here hands the failure to
// the error rail, which emails it. The main results callback has already succeeded
// on this same URL by the time this node runs, so this only fires on a genuinely
// malformed caller.
const cbUrl = String(validated.callback_url || '');
if (cbUrl.indexOf('/ta-callback/') === -1) {
  throw new Error('Cannot derive the agent-review endpoint: callback_url does not contain ' +
    '"/ta-callback/" (got "' + cbUrl.slice(0, 120) + '"). Refusing to post verdicts to a guessed URL.');
}
const reviewUrl = cbUrl.replace('/ta-callback/', '/ta-agent-review/');

const nowIso = new Date().toISOString();
const cases = [];
const tally = {};
const findingReasonTally = {};
let cursor = 0, byModel = 0, byCode = 0, missingModelOutputs = 0;
let modelRouted = 0;                  // bundles SENT to the verifier
let findingsCapped = 0;               // Findings refused for want of a quoted amount
const unreviewedKeys = [];            // routed, but came back without a usable verdict
const cappedKeys = [];                // Finding downgraded to candidate in code
const verifierErrors = [];            // distinct error strings, for the run summary

for (const b of bundles) {
  if (!b || !b.case_key) continue;

  let verdict, confidence, reasoning, evidence, decidedBy, whyNoModel;
  let evidenceClass = '';
  let findingCapped = false;

  const q = quotedFor(b);
  const resolved = quoteResolved(q);
  const facts = b.facts || {};

  if (b.preset_verdict) {
    evidenceClass = b.preset_evidence_class || '';
    decidedBy  = 'deterministic';
    whyNoModel = b.why_no_model || null;
    verdict    = b.preset_verdict;
    confidence = 'high';           // arithmetic or a proven absence, not a judgement
    reasoning  = whyNoModel || 'Decided in code without the model.';
    evidence   = Array.isArray(b.evidence) ? b.evidence : [];
    byCode++;
  } else {
    modelRouted++;
    const raw = agentOuts[cursor++];

    // JUDGE THE PAYLOAD, NOT THE SLOT. The verifier runs with
    // onError: continueRegularOutput, which emits one item per input item even
    // when the model call died - a failure arrives as a PRESENT item carrying
    // {error: "..."}, never as a gap. So testing `!raw` alone only catches a
    // SHORT array, which is the rarer failure.
    //   Sibling execution 77248 (2026-08-06): Gemini's free-tier quota (20 req/min,
    //   shared project) killed 4 of 7 items. All 7 arrived, 4 of them as
    //   {"error":"The service is receiving too many requests from you"}. The old
    //   `!raw` test passed them straight through: decided_by:'model',
    //   reasoning:'', evidence back-filled from the bundle, while
    //   missing_model_outputs stayed 0 and pairing_ok stayed true. Four
    //   unreviewed cases were indistinguishable from three real verdicts.
    const v = (raw && (raw.output || raw)) || {};
    const itemErr = (raw && raw.error != null)
      ? String((raw.error && raw.error.message) || raw.error).slice(0, 300)
      : '';
    const verdictIn = typeof v.verdict === 'string' ? v.verdict.trim() : '';
    const verdictOk = VALID_VERDICTS.indexOf(verdictIn) !== -1;

    if (!raw || itemErr || !verdictOk) {
      // Not reviewed. Say so on the case, in the counters, and in the reasoning
      // a human will actually read.
      missingModelOutputs++;
      unreviewedKeys.push(b.case_key);
      if (itemErr && verifierErrors.indexOf(itemErr) === -1) verifierErrors.push(itemErr);

      whyNoModel = itemErr
        ? 'verifier errored on this case: ' + itemErr
        : (!raw
            ? 'no model output arrived (expected item ' + cursor + ' of ' +
              agentOuts.length + ' received)'
            : 'model returned an item with no valid verdict (got "' +
              (verdictIn || typeof v.verdict) + '")');

      decidedBy  = 'unreviewed';
      verdict    = FALLBACK_VERDICT;   // fails CLOSED - a human still has to look
      confidence = 'none';
      reasoning  = 'NOT REVIEWED - ' + whyNoModel + '. No model judgement was made on ' +
                   'this case; the verdict is a safe default, not a finding. Re-run the ' +
                   'verifier for this case before treating it as reviewed.';
      evidence   = Array.isArray(b.evidence) ? b.evidence : [];
    } else {
      decidedBy  = 'model';
      whyNoModel = null;
      verdict    = verdictIn;
      evidenceClass = typeof v.evidence_class === 'string' ? v.evidence_class.trim() : '';

      // TWO HARD STOPS, ENFORCED IN CODE RATHER THAN TRUSTED TO THE PROMPT.
      //
      // 1. Only JUSTIFIED may clear a candidate. Any other class arriving paired
      //    with 'Agent Justified' is a model that ignored its instructions, and a
      //    clearance is the one outcome we cannot take back.
      // FAILS CLOSED ON A MISSING CLASS (fixed 2026-08-19). The condition used to read
      // `evidenceClass && evidenceClass !== 'JUSTIFIED'`, so an ABSENT evidence_class made the
      // guard falsy and the clearance went through. Measured: evidence_class 'EXPLAINED' and
      // 'AMBIGUOUS' were capped, but omitting the field entirely returned 'Agent Justified'.
      // The output parser marks the field required, so it should not go missing - but this
      // node's own comment says these stops are "enforced in code rather than trusted to the
      // prompt", and a guard that depends on the parser is trusting the prompt. A clearance is
      // the one outcome that cannot be taken back, so an unstated class must not clear.
      //
      // OPEN, AND DELIBERATELY NOT DECIDED HERE: 'JUSTIFIED' is not a member of the Verdict
      // Schema's evidence_class enum at all - that enum is UNDER_BILLED / UNDERPAID /
      // EXPLAINED / AMBIGUOUS / NO QUOTE / UNRESOLVED, and its clearing class is EXPLAINED.
      // So this cap downgrades EVERY schema-valid 'Agent Justified' and that verdict is
      // currently unreachable through the model path. That is fail-safe - it over-reviews,
      // it never clears wrongly - but it means the model can never clear a candidate and
      // every justified case reaches an auditor. Whether EXPLAINED should clear is a
      // BUSINESS decision (it would start clearing cases that today go to a human), so it is
      // flagged for the owner rather than changed here.
      if (verdict === 'Agent Justified' && evidenceClass !== 'JUSTIFIED') {
        verdict = FALLBACK_VERDICT;
        whyNoModel = 'model returned "Agent Justified" with evidence_class "' +
          (evidenceClass || '(none supplied)') +
          '" - only JUSTIFIED may clear a candidate, so the verdict was capped in code';
      }
      // 2. NO FINDING WITHOUT A RESOLVED QUOTED AMOUNT. This is the rule that
      //    keeps the whole check honest. The stored rate is not reliably what was
      //    billed, so the ONLY thing that can separate Under-billed from Underpaid
      //    is what we actually quoted to this client. If no quote resolved
      //    (no_quote_found) or the message read failed (read_failed), then either
      //    finding is a guess dressed as arithmetic - so it is capped at
      //    "Auditor Review Required" and the reason is recorded on the case rather
      //    than dropped.
      if (FINDING_VERDICTS.indexOf(verdict) !== -1 && !resolved) {
        const why = q && q.read_failed === true
          ? 'the client message read FAILED for this case, so we cannot see what we quoted'
          : 'no quoted amount resolved for this case (no_quote_found) - which is not evidence that ' +
            'nothing was quoted: the message may predate the log window, may have gone by a channel ' +
            'this endpoint does not carry, or may use a template the baked lookup does not know';
        whyNoModel = 'model returned "' + verdict + '" but ' + why +
          ' - capped in code to "' + FALLBACK_VERDICT + '", because only the quoted amount can ' +
          'separate Under-billed from Underpaid';
        verdict = FALLBACK_VERDICT;
        findingCapped = true;
        findingsCapped++;
        cappedKeys.push(b.case_key);
      }

      confidence = String(v.confidence || 'low');
      reasoning  = String(v.reasoning || '');
      // Prefer the model's cited evidence; fall back to what we handed it so a row
      // is never left with no link at all.
      evidence   = (Array.isArray(v.evidence) && v.evidence.length)
                   ? v.evidence
                   : (Array.isArray(b.evidence) ? b.evidence : []);
      byModel++;
    }
  }

  // finding_reason is set HERE and nowhere else. The scorer leaves it empty on
  // purpose: it has no way to tell the two apart. A cleared or still-provisional
  // case keeps it empty - an empty finding_reason means "nothing established",
  // never "nothing wrong".
  const findingReason = FINDING_REASON[verdict] || '';
  if (findingReason) findingReasonTally[findingReason] = (findingReasonTally[findingReason] || 0) + 1;

  tally[verdict] = (tally[verdict] || 0) + 1;

  cases.push({
    case_key: b.case_key,
    // Set on the CASE as well as inside agent_review, because the portal, the
    // Cases tab and the Verdicts tab all read it and only one of them sees the
    // agent_review object.
    finding_reason: findingReason,
    agent_review: {
      verdict: verdict,
      finding_reason: findingReason,
      confidence: confidence,
      reasoning: reasoning,
      evidence: evidence,
      decided_by: decidedBy,
      why_no_model: whyNoModel,
      review_reason: s(facts.review_reason) || 'below_agreed_amount',
      evidence_class: evidenceClass,
      // The money the verdict rests on, carried through so the Verdicts tab does
      // not have to re-join the case to show it.
      expected: facts.expected === undefined ? null : facts.expected,
      actual: facts.actual === undefined ? null : facts.actual,
      shortfall: facts.shortfall === undefined ? null : facts.shortfall,
      persistence_verdict: s(facts.persistence_verdict),
      comments_read: Number(facts.comments_read) || 0,
      messages_seen: Number(facts.messages_seen) || 0,
      quoted: q || {},
      quotes_seen: Array.isArray(q && q.quotes) ? q.quotes.length : 0,
      quote_resolved: resolved,
      finding_capped: findingCapped,
      reviewed_at: nowIso
    }
  });
}

// Pairing integrity: the model path is positional, so the only acceptable
// relationship is exactly one verifier output per bundle ROUTED to the verifier.
// This must compare against modelRouted, not byModel - byModel counts only the
// items that came back usable, so comparing to it would report pairing_ok false on
// every quota-degraded run and hide the real pairing question.
const pairingOk = agentOuts.length === modelRouted;

// A run where the model answered nothing it was asked is not a review. Callers
// should treat this as "verifier unavailable", not as a set of verdicts.
const verifierDown = modelRouted > 0 && byModel === 0;

console.log(JSON.stringify({ stage: 'merge_agent_verdicts', reviewed: cases.length,
  by_model: byModel, by_code: byCode, model_routed: modelRouted,
  model_outputs_seen: agentOuts.length, unreviewed: missingModelOutputs,
  pairing_ok: pairingOk, verifier_down: verifierDown,
  findings_capped_for_no_quote: findingsCapped, capped_case_keys: cappedKeys.slice(0, 50),
  finding_reasons: findingReasonTally,
  verifier_errors: verifierErrors, tally: tally,
  note: 'a verdict of "Agent Finding - *" is only accepted where the quoted amount resolved. Everything ' +
        'else is a candidate, and an empty finding_reason means nothing was established - not that ' +
        'nothing is wrong.' }));

return [{ json: {
  check_id: validated.check_id,
  run_id: validated.run_id,
  callback_url: reviewUrl,
  reviewed: cases.length,
  decided_by_model: byModel,
  decided_in_code: byCode,
  // Routed to the verifier but not actually judged by it. `missing_model_outputs`
  // keeps its old name for the existing callback contract, but its meaning is
  // "no USABLE verdict" rather than only "no item at all".
  unreviewed: missingModelOutputs,
  missing_model_outputs: missingModelOutputs,
  unreviewed_case_keys: unreviewedKeys,
  findings_capped_for_no_quote: findingsCapped,
  capped_case_keys: cappedKeys,
  finding_reasons: findingReasonTally,
  verifier_errors: verifierErrors,
  verifier_down: verifierDown,
  model_routed: modelRouted,
  pairing_ok: pairingOk,
  tally: tally,
  cases: cases,
  completed_at: nowIso
}}];

