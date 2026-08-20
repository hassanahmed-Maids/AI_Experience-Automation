// Build Verdict Rows - one row per verified case, for the Verifier Verdicts tab.
//
// This replaces the agent-review callback on a manual run. The verdicts arrive
// AFTER the case rows are written, which mirrors the portal design: candidates are
// visible first and explicitly provisional, then the verifier's reading lands
// beside them. Join the two tabs on case_key.
//
// `decided_by` is the column to read first:
//   deterministic - settled in code, no model call (nothing quotable existed to
//                   read, or the bundle already resolved it)
//   model         - genuinely judged
//   unreviewed    - routed to the verifier and came back unusable. The verdict is
//                   a SAFE DEFAULT, not a finding, and reasoning starts
//                   "NOT REVIEWED". Never report one of these as a judgement.
//
// `finding_reason` is the column that decides WHO ACTS. Underpaid goes to
// collections (the client paid less than we asked); Under-billed goes to
// accounting (we asked less than the contract says). Same money, different teams,
// and only the quoted amount can tell them apart - which is why a Finding verdict
// is refused in code when no quoted amount resolved (see Merge Agent Verdicts).
const merged = $input.first().json;
const validated = $('Validate Inputs').first().json;
const cases = Array.isArray(merged.cases) ? merged.cases : [];

function s(v) { return v === null || v === undefined ? '' : String(v); }
function amt(v) { return v === null || v === undefined ? '' : Math.round((Number(v) || 0) * 100) / 100; }

const rows = cases.map(function (c) {
  const a = c.agent_review || {};
  const q = a.quoted || {};
  const evidence = Array.isArray(a.evidence) ? a.evidence : [];
  return {
    json: {
      case_key: s(c.case_key),
      run_id: s(validated.run_id),
      audit_month: s(validated.audit_month),
      verdict: s(a.verdict),
      // Underpaid | Under-billed | '' (nothing established). Set from the verdict
      // in Merge Agent Verdicts, never by the scorer.
      finding_reason: s(c.finding_reason || a.finding_reason),
      evidence_class: s(a.evidence_class),
      decided_by: s(a.decided_by),
      confidence: s(a.confidence),
      // Only 'Agent Justified' may clear a candidate, and that is enforced in code
      // in Merge Agent Verdicts - this column is here so a reviewer can see it
      // held. Note the word: it downgrades a CANDIDATE, because there was never a
      // finding here for the scorer to give away.
      downgrades_the_candidate: a.verdict === 'Agent Justified' ? 'YES' : '',
      reasoning: s(a.reasoning),
      why_no_model: s(a.why_no_model),
      review_reason: s(a.review_reason),

      // The money the verdict rests on.
      expected_aed: amt(a.expected),
      actual_aed: amt(a.actual),
      shortfall_aed: amt(a.shortfall),
      // THE TWO QUOTED AMOUNTS, and which family each came from. contract-rate
      // quoted comes from acc_cc_client_paying_via_cc_monthly_reminder_* (it
      // quotes the contract's stored rate); requested quoted comes from
      // acc_cc_client_online_reminder_* (it quotes what accounting actually asked
      // for). On one verified contract those two said 4,715 and 2,100 days apart.
      // Amounts and family names only - no message body reaches this tab.
      quoted_contract_rate_aed: amt(q.contract_rate_quoted),
      quoted_contract_rate_family: q.contract_rate_quoted === null || q.contract_rate_quoted === undefined
        ? '' : 'quotes_contract_rate',
      quoted_requested_aed: amt(q.requested_quoted),
      quoted_requested_family: q.requested_quoted === null || q.requested_quoted === undefined
        ? '' : 'quotes_requested_amount',
      quoted_families_seen: (Array.isArray(q.families_seen) ? q.families_seen : []).join(' | '),
      quoted_count: Number(a.quotes_seen) || 0,
      quoted_no_quote_found: q.no_quote_found === true ? 'YES' : '',
      quoted_read_failed: q.read_failed === true ? 'YES' : '',
      quoted_lookup_pulled_on: s(q.lookup_pulled_on),
      // Set when a Finding verdict was CAPPED because no quoted amount resolved.
      // A capped verdict is not a softened finding - it is the absence of the one
      // piece of evidence that could have made it one.
      finding_capped_for_no_quote: a.finding_capped === true ? 'YES' : '',

      persistence_verdict: s(a.persistence_verdict),
      comments_read: Number(a.comments_read) || 0,
      messages_seen: Number(a.messages_seen) || 0,
      // Links the model actually relied on. Quotes are deliberately NOT written
      // here: they are staff- and template-written client message text, and this
      // tab is not the place for a message body.
      evidence_links: evidence.map(function (e) { return s(e.link); }).filter(Boolean).join(' | '),
      evidence_kinds: evidence.map(function (e) { return s(e.kind); }).filter(Boolean).join(' | '),
      reviewed_at: s(a.reviewed_at),
      written_at: new Date().toISOString()
    }
  };
});

console.log(JSON.stringify({ stage: 'build_verdict_rows', rows: rows.length,
  by_model: merged.decided_by_model, in_code: merged.decided_in_code,
  unreviewed: merged.unreviewed, pairing_ok: merged.pairing_ok,
  verifier_down: merged.verifier_down, findings_capped: merged.findings_capped_for_no_quote,
  tally: merged.tally }));

// No candidates to verify is a legitimate outcome (a clean month), and it must not
// fail the run - but the Sheets node cannot write zero items, so end the branch
// here.
if (rows.length === 0) {
  console.log(JSON.stringify({ stage: 'build_verdict_rows',
    note: 'no cases reached the verifier - nothing to write to the Verifier Verdicts tab' }));
  return [];
}

return rows;

