// caller_verdict_gate.js - the EXACT expression body of WF-E's `Caller Passed a Verdict?` IF node.
//
// It is mirrored here as a file, and not only as a string inside the workflow JSON, for one
// reason: it is the node that decides whether WF-E trusts its caller or probes for itself, and
// an IF node's condition is the one piece of logic in this flow that `offline/enrich_test.js`
// could not otherwise execute. The test loads this file, strips these comments, and runs the
// expression against a fake `$()` for every input a caller can produce - the three known
// verdicts, absent, null, empty, wrong case, padded, a number, an object, and a word that is
// not a verdict at all. Whoever edits the deployed node must edit this file in the same breath;
// the repo-vs-deployed diff in the report is what proves they still agree.
//
// TRUE  -> Apply Caller Verdict    (WF-A already probed this run; do not probe again)
// FALSE -> Probe Replacements Grant (probe once for this chunk, exactly as before)
//
// THE FALLBACK IS THE POINT. WF-E is callable standalone and by older callers that know nothing
// about this field. Anything that is not one of the three known verdicts - missing, empty, null,
// misspelt, a boolean, a number - routes to WF-E's own probe and the flow behaves exactly as it
// did on 2026-08-24. There is deliberately no fourth meaning and no default verdict: an
// unrecognised value must never be interpreted, only distrusted.
['granted', 'denied', 'inconclusive'].indexOf(String((($('When Called').first().json || {}).replacements_grant) || '').trim().toLowerCase()) !== -1
