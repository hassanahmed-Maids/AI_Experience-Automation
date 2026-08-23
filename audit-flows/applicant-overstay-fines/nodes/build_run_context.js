// Build Run Context — runOnceForAllItems.
//
// The check page answers "How is it triggered? — Manual only", so there is no
// webhook, no shared secret and no callback-origin allowlist to get wrong.  That
// is deliberate: the MV build cloned Travel Assist's `Validate Inputs` byte for
// byte and inherited a callback path and secret belonging to a different check,
// which it then had to report as an open gap.  A check with one door does not
// need an intake adapter.
//
// Everything downstream reads its constants from HERE, and every constant on this
// page is the CC one.  Never import a value from MV Overstay Fines: that check is
// AED 300 recovered from the CLIENT on expense 1677, this one is AED 200 put on
// the MAID'S LOAN on expense 1589, and the two share a workbook.

const WINDOW_FROM = '2026-03-01';   // edit these two to move the run window
const WINDOW_TO   = '2026-08-30';

// ERP-LOAD-POLICY.md §3. The pre-flight gate needs a budget and there is no webhook to carry
// one, so the knob lives here with the other two things an operator edits before a run. 2000 is
// the policy default, kept deliberately rather than pre-raised: the gate projects the WORST case
// (every case reaching the verifier band, up to 74 complaint threads each), so a wide window
// will refuse to start and say by how much. Raising this number is the recorded human decision
// §7 asks for — make it here, in the flow, where the next reader can see what was chosen.
const ERP_CALL_BUDGET = 2000;

const now = new Date().toISOString();

return [{
  json: {
    check_id: 'cc-overstay-fines',
    check_name: 'CC Overstay Fines',
    run_id: 'manual-' + WINDOW_FROM.slice(0, 7) + '-' + now.slice(11, 19).replace(/:/g, ''),
    trigger: 'manual',
    started_at: now,
    window_from: WINDOW_FROM,
    window_to: WINDOW_TO,

    // Named `params` so the gate reads it under the same key every other flow in this repo uses
    // (`params.erp_call_budget`), even though this check has no request body to put it in.
    params: {
      erp_call_budget: ERP_CALL_BUDGET
    },

    // Declared delivery targets.  Each one is wired as its OWN branch off the
    // node that produces the data — never chained behind another.  On the MV
    // build the whole post-verifier band sat behind `delivery.portal === true`
    // while the runner declared portal:false, so every AI verdict was discarded
    // and the review email, chained behind the portal callback, never fired.
    delivery: {
      portal: false,        // no portal callback path has been issued for this check
      data_tables: true,    // Cases / Runs / Verdicts
      workbook: false,      // produced outside the flow from the Cases table
      email: false,         // the check page answers Email = no
      runs_log: true
    },

    // Inert placeholder.  No reachable node posts to it while delivery.portal is
    // false; it exists so the payload shape is stable, not so something can be
    // fired at it by accident.
    callback_url: '',

    constants: {
      expense_id: 1589,
      expense_name: 'NEW - CC Housemaids - Change of Status Application',
      base: 575.65,          // cc_change_of_status_base — CC's OWN measurement
      threshold: 200,        // strict > ; a TRIGGER, not a deductible
      day_rate: 50,
      loan_type: 'OVERSTAY_FINES_FEES'
    }
  }
}];
