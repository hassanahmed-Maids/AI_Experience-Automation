// Collects the three per-contract ERP payloads into one object per contract and
// hands them to Score Batch. It deliberately does NOT decide the nationality any
// more - that decision moved into the scorer (resolveNationality), where it is
// covered by assertions instead of living untested in a node body.
//
// The third call, Get Active CPT, is what makes a maid-less contract scoreable.
// Verified on the live population 2026-08-19: all 292 blank-nationality rows are
// blank because NO MAID is attached, and the active payment term keeps its own
// housemaid link, so the term still knows the nationality the contract was
// priced for. See erp-nationality-fallback.md.
const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const row = $("Batch of 5").all()[i].json;
  const det = $("Get Contract Details").all()[i].json;
  const logs = $("Get LiveInOut Logs").all()[i].json;
  const cpt = items[i].json;

  // getActiveCptInfo answers 200 with a PARTIAL object when the contract has
  // zero or more than one active term - LCP confirmed the controller swallows
  // the BusinessException, so the cpt keys are simply absent rather than an
  // error. A 200 with no nationality is therefore "no single active term", not
  // "no switch", and it must not read as a clean comparison.
  const body = (cpt && cpt.body) || {};
  const cptNat = body.nationality === undefined || body.nationality === null ? "" : String(body.nationality).trim();
  const cptStatus = cpt && cpt.statusCode !== undefined ? cpt.statusCode : null;

  out.push({ json: {
    row: row,
    details_status: det.statusCode === undefined ? null : det.statusCode,
    details: det.body === undefined ? null : det.body,
    logs_status: logs.statusCode === undefined ? null : logs.statusCode,
    logs: logs.body === undefined ? null : logs.body,
    cpt_status: cptStatus === 200 && cptNat === "" ? 204 : cptStatus,
    cpt_nationality: cptNat,
    // Kept for the reviewer: ERP's own idea of the monthly amount and of the
    // living axis, both independent of the Google-Sheet card.
    cpt_type: body.type === undefined ? null : body.type,
    cpt_name: body.cptName === undefined ? null : body.cptName
  } });
}
return out;
