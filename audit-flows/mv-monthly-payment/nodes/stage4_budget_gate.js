// ERP PRE-FLIGHT BUDGET GATE - ERP-LOAD-POLICY.md §3.
// Canonical copy: audit-flows/tools/erp_preflight_gate.js.
//
// WHY STAGE 4 NEEDS ITS OWN. Section 3 was satisfied for this flow by Stage 1, whose gate already
// charges 1 downstream call per contract as "Stage 4 worst case". That covers the Stage 1 path
// and nothing else. The RE-VERIFY WEBHOOK is a second, independent entry point: it reads every
// finding for a runId straight from the case store and makes two ERP calls per finding, with
// nobody having costed it. A month with 3,000 findings is 6,000 uncontrolled ERP calls behind one
// POST. That is the same shape as the missing lease on this entry point, found in the 2026-08-20
// audit and fixed then - the budget half was missed because the flow reads as a sub-workflow.
//
// SO THE GATE IS PATH-DEPENDENT, and says which path it is on rather than pretending both are the
// same. ERP-COMPLIANCE: budget-gate-in-caller applies to the SUB-WORKFLOW path only - on that path
// Stage 1's ERP Budget Gate has already projected this cost with the full population in hand, and
// refusing again here would re-litigate a decision taken with better information.
//
// IT HARD-FAILS AND DOES NOT TRIM, like every other gate in this family: a partial verifier run
// that looks complete is worse than a refused one, because an unverified finding and a verified
// one are indistinguishable once the run reports done.
const ERP_CALLS_PER_FINDING = 2;   // WhatsApp message log + complaints, one each
const DEFAULT_BUDGET = 2000;       // ~1,000 findings on the standalone path

const findings = $input.all();
const inp = $('Verify In').first().json;
const viaWebhook = inp.viaWebhook === true;
const projected = findings.length * ERP_CALLS_PER_FINDING;

const body = (function () {
  try { return $('Re-verify Webhook').first().json.body || {}; } catch (e) { return {}; }
})();
const asked = Number(body.erp_call_budget);
const budget = Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_BUDGET;

console.log(JSON.stringify({ stage: 'erp_preflight_gate', flow: 'mvmp_stage4',
  run_id: String(inp.runId || ''), via_webhook: viaWebhook,
  findings: findings.length, projected_total: projected,
  budget: viaWebhook ? budget : null,
  budget_source: !viaWebhook ? 'caller (Stage 1 ERP Budget Gate)'
    : (Number.isFinite(asked) && asked > 0 ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')') }));

if (viaWebhook && projected > budget) {
  throw new Error(
    'ERP CALL BUDGET EXCEEDED: this re-verify projects ' + projected + ' ERP calls against a budget of ' +
    budget + '. Refusing to start. | ' + findings.length + ' finding(s) x ' + ERP_CALLS_PER_FINDING +
    ' reads = ' + projected + '. | It is NOT trimmed to fit: a verifier run that covers some of the ' +
    'findings and reports done is worse than one that refuses, because a finding nobody verified ' +
    'and one that survived verification look identical afterwards. | Re-verify a narrower run - ' +
    'runId is the whole selector, so score a slice and re-verify that - or raise ' +
    'params.erp_call_budget deliberately.');
}

// Pass the findings through untouched.
return $input.all();
