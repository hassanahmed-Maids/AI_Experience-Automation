// Attach Fines — MV Overstay Fines (v1). Mode: Run Once for Each Item.
//
// GET /visa/overstay-fines/housemaid/{maid_id} returns a LIST, not an object.
//
// This node only NORMALISES. It does not decide: the placeholder filter (gate 5),
// the days x 50 reconciliation (gate 6), the waiver (gate 9) and the threshold
// (gate 7) all belong to `Compute Case States`, in the order the policy page lists
// them. Splitting the decisions across two nodes is how a gate ends up running out
// of order without anyone being able to see it.
//
// `overstayFinesStatus` and `datePaid` are captured for context and are NEVER
// gated on. Measured live 2026-08-12: `datePaid` is empty on every fine read, and
// `overstayFinesStatus` tracks the WAIVER (Pending 24 / Partially Waived 2 / Fully
// Waived 2), not the collection — maid 137261 is paid in full and still reads
// `Pending`. Gating on either would close real findings.
//
// `housemaid.phoneNumber` arrives already masked as '***' and is dropped anyway:
// this check handles sensitive data, and phone numbers never reach a case, a run
// summary, the portal or an email.
const fetched = $input.item.json;
const carry = $('Attach Identity').item.json;
const out = Object.assign({}, carry);

// The failed-read branch, kept separate from the shape branch below so the review note names
// the real cause. `fullResponse` is on, so a success always carries `body`; an n8n error item
// carries `error` and no body at all.
if (fetched && fetched.error !== undefined && fetched.error !== null &&
    !Array.isArray(fetched.body)) {
  const e = fetched.error;
  out.fines = [];
  out.fines_read = false;
  out.enrich_blocked = 'fines_unread';
  out.enrich_blocked_text = 'The OS-fines read FAILED: ' +
    String((e && e.message) || e).slice(0, 300) + ' — routed to review. A read that did not ' +
    'happen is never verifier rule 15 ("no fine on her OS tab"), which is a real finding, and ' +
    'is never clean.';
  return { json: out };
}

// `Get Overstay Fines` runs with onError: continueRegularOutput as of 2026-08-23. This comment
// used to say the node ran with continueErrorOutput and that a failed read "goes down the error
// rail rather than arriving here". That is no longer true, and a stale sentence about error
// routing is the kind that makes the next reader stop checking the parameter. The node was
// changed so `Judge Fines Batch` can COUNT its failures (ERP-LOAD-POLICY.md §5): routing them
// away would leave the breaker counting successes only, and a breaker that cannot see a failure
// is worse than none because its green gets quoted.
//
// So two different things can arrive here now: a read that FAILED, carrying `error`, and the
// older case of a successful call that returned something other than a list. Unread is not the
// same as absent and must stay distinguishable: an empty list is verifier rule 15 (a real
// finding), whereas an unread or unreadable response is a review item.
//
// `.body` IS THE LIVE SHAPE and must stay first. The endpoint returns a BARE JSON
// array, and n8n's HTTP Request node splits a top-level array into one item per
// element — so this node used to receive a single fine OBJECT, the list guard
// below fired, and all 29 cases of run 85011 landed `fines_unreadable`. Two
// quieter consequences were worse than the block: a maid with NO fines produced
// zero items and vanished from the run entirely (maids 17542 and 84087 did), and
// a maid with two fines produced two (test case 130141). `Get Overstay Fines` now
// sets fullResponse, so the array arrives nested under `body` and there is no
// top-level array to split — exactly one item per maid for 0, 1 or N fines.
// The bare-array branch is kept: it is the shape if fullResponse is ever removed.
let rows = null;
if (fetched && Array.isArray(fetched.body)) rows = fetched.body;
else if (Array.isArray(fetched)) rows = fetched;
else if (fetched && Array.isArray(fetched.data)) rows = fetched.data;
else if (fetched && Array.isArray(fetched.content)) rows = fetched.content;

if (rows === null) {
  const isEmptyObject = fetched && typeof fetched === 'object' && Object.keys(fetched).length === 0;
  if (isEmptyObject) {
    // n8n renders an empty JSON array response as {} on some response formats.
    // Treat it as an empty list: that is rule 15, not an unreadable payload.
    out.fines = [];
    out.fines_read = true;
    return { json: out };
  }
  out.fines = [];
  out.fines_read = false;
  out.enrich_blocked = 'fines_unreadable';
  out.enrich_blocked_text = 'The OS-fines endpoint did not return a list. keys=' +
    Object.keys(fetched || {}).join(',') + ' — routed to review. An unreadable response is NOT ' +
    'the same as "no fine on her OS tab" and must not be scored as either clean or unexplained.';
  return { json: out };
}

out.fines_read = true;
out.fines = rows.map(function (f) {
  const hm = f.housemaid || {};
  return {
    fine_id: f.id === undefined ? '' : String(f.id),
    gross: f.originalOverstayFees,          // overstay_fine_gross — context ONLY
    net: f.overstayFineAmount,              // overstay_fine_net  — THE EXPECTATION
    reduced: f.reducedAmount,               // '' when there is no waiver
    days: f.numOfOverstayDays,
    reduction_reason: f.reductionReason,     // OBJECT {id,label} when waived, '' when not
    fines_status_context: f.overstayFinesStatus || '',   // never gated on
    date_paid_context: f.datePaid || '',                 // never gated on; empty on every read
    housemaid_type: hm.housemaidType || ''   // 'MaidVisa' on every row measured
  };
});
out.fines_count_raw = out.fines.length;

return { json: out };
