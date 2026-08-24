// The residue only. Everything settleable from structured fields was settled by a gate; this picks
// out the two shapes that genuinely need a person's words read.
//
// Runs AFTER the results callback and after the workbook writes by design: the reds are already
// visible as provisional, so a slow or failing model cannot delay or cost them.
//
//   RULE 1 (Order 120) - a dummy ticket with outcome 'Used'. Did the record explain the travel?
//   RULE 2 (Order 130) - a finding. Does the record claim the refund happened outside ERP?
//
// THE WRITTEN RECORD IS RE-READ FROM THE 0-FETCH OUTPUT, NOT FROM THE SCORED TICKET.
// scoreTicket rebuilds each ticket from a base object carrying only the seven scoring fields, so
// the notes do not survive it. Reading them from the scored ticket produced an empty record on
// EVERY case and the model answered NO_TEXT to a question it had been starved of - including a
// ticket whose note ran to 152 characters. Sourcing them here also keeps staff-written text out
// of the portal payload and out of the workbook, which is where it belongs.
const scored = $('Score Cases').first().json || {};
const validated = scored.validated || $('Validate Inputs').first().json;
const cases = scored.cases || [];

// applicant_id -> ticket_id -> the projected ticket, notes included
const notesByApplicant = {};
try {
  for (const it of $('Fetch Tickets (0-Fetch)').all()) {
    const f = it.json || {};
    if (f.applicant_id === undefined) continue;
    const byTicket = {};
    for (const t of (f.tickets || [])) byTicket[String(t.id)] = t;
    notesByApplicant[String(f.applicant_id)] = byTicket;
  }
} catch (e) {
  throw new Error('Verifier: could not read the enrichment output to recover the written record (' +
    e.message + '). Refusing to ask the model to judge an empty record - it would answer NO_TEXT ' +
    'and that would look like an honest absence.');
}

function withRecord(applicantId, t) {
  const src = (notesByApplicant[String(applicantId)] || {})[String(t.id)] || {};
  const notes = src.notes || {};
  return Object.assign({}, t, {
    notes: notes,
    has_written_record: Object.keys(notes).length > 0,
    from_code: src.from_code || '', to_code: src.to_code || '',
    refund_in: src.refund_in || ''
  });
}

const out = [];
let withText = 0, withoutText = 0, notFoundInEnrichment = 0;

for (const c of cases) {
  if (c.infrastructure) continue;                 // an outage has no written record to read
  const used = (c.tickets || []).filter(function (t) { return t.verdict === 'used_review'; })
    .map(function (t) { return withRecord(c.applicant_id, t); });
  const findings = (c.tickets || []).filter(function (t) {
    return t.verdict === 'financial_loss' || t.verdict === 'refund_overdue';
  }).map(function (t) { return withRecord(c.applicant_id, t); });

  if (!used.length && !findings.length) continue;

  for (const t of used.concat(findings)) {
    const known = (notesByApplicant[String(c.applicant_id)] || {})[String(t.id)];
    if (!known) notFoundInEnrichment++;
    else if (t.has_written_record) withText++; else withoutText++;
  }

  out.push({ json: {
    case_key: c.case_key,
    applicant_id: c.applicant_id,
    money_verdict: c.verdict,
    money_state: c.state,
    rule_1_tickets: used,
    rule_2_tickets: findings,
    erp_token: validated.erp_token,
    erp_device_id: validated.erp_device_id,
    erp_is_auth: validated.erp_is_auth
  }});
}

// A ticket the enrichment step never returned cannot be judged on its record. Fail loud rather
// than let it read as a clean absence.
if (notFoundInEnrichment > 0) {
  throw new Error('Verifier: ' + notFoundInEnrichment + ' ticket(s) selected for review were not ' +
    'found in the enrichment output, so their written record cannot be recovered. Refusing to ask ' +
    'the model to judge them - NO_TEXT would be indistinguishable from a real absence.');
}

// Surfaced so a future silent drop shows up as a number rather than as unanimous NO_TEXT.
if (out.length) {
  out[0].json.__record_stats = { tickets_with_written_record: withText,
    tickets_without_written_record: withoutText };
}

// ---- NEVER RETURN NOTHING. ------------------------------------------------------------------
// ERP-COMPLIANCE: empty-exit-ok - guarded here, and this is the guard.
//
// `out` is empty whenever no case needs a person's words read, which is the NORMAL outcome of a
// clean month. An n8n node that returns zero items does not fail: it stops its branch, and every
// node after it is simply never executed. Release ERP Lease used to be the last node of that
// branch, so a clean run finished `success` with the ERP lease still held and the next audit
// queued behind a holder that had already exited. Measured on execution 100409, 2026-08-24.
//
// So the empty case is now an ITEM rather than an absence, and `Any verifier work?` reads it and
// routes straight to the release. Emptiness has to be made VISIBLE before anything can react to
// it - that is the whole reason this block exists, and it is why the sibling sentinels upstream
// (_empty, _seed_only, _no_population) were written the same way.
if (!out.length) {
  console.log(JSON.stringify({ stage: 'select_for_verifier', verifier_cases: 0,
    note: 'no case needs the written record read. Emitting a sentinel rather than nothing, so ' +
          'the branch survives as far as Release ERP Lease.' }));
  return [{ json: { _no_verifier_work: true,
                    erp_token: validated.erp_token,
                    erp_device_id: validated.erp_device_id,
                    erp_is_auth: validated.erp_is_auth } }];
}
return out;