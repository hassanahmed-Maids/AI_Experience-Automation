// Project Status Rows (WF-S) - collapse the paged sweep to ONE item carrying only the
// fields WF-A's consumers actually read, then let this execution die with the raw copy.
//
// THE ENVELOPE SHAPE IS DELIBERATELY IDENTICAL to what the HTTP node used to emit:
// { content: [...], totalElements, totalPages }. WF-A's Verify Bulk Pulls, Build Cohort
// and Attach Month Payments all reach for `Get Payment Statuses` BY NODE NAME and read
// `page.json.content`, so returning the same shape under the same name means none of
// them changed at all. The calling node in WF-A keeps that name for the same reason.
//
// ONE ITEM, NOT ONE PER PAGE, and that is only safe because of a gate-2 change made the
// same day: the completeness proof is now the RECONCILIATION against totalElements, and
// the short-page test is a fallback that only runs when no total was declared. Under
// the previous hardcoded `content.length < 40` test, a single 43,727-row item would
// have read as a full page and gate 2 would have thrown on a complete sweep.
//
// THE PROJECTION IS DERIVED, NOT GUESSED. Every field below is one a consumer reads:
//   Attach Month Payments  id, amountOfPayment, dateOfPayment, status.value,
//                          typeOfPayment.name, methodOfPayment.label, replaced,
//                          contract.id
//   Build Cohort source B  contract.{id,status,startOfContract}, contract.client.{id,name},
//                          contract.housemaid.{id,label,nationality},
//                          contract.contractProspectType.code
// NESTING IS PRESERVED rather than flattened, so the consumers need no edit. Measured:
// 1,056 -> 489 B/row, so 44.1 MB -> 20.4 MB across 43,727 rows.
//
// DROPPED (present on the DTO, read by nobody): bankName, chequeName, chequeNumber,
// chequeWithTheBank, creationDate, dateChangedToPDP, dateChangedToReceived,
// directDebitFile, errorMessage, isInitial, note, ongoingCollectionFlows, vat,
// vatPaidByClient, and contract.{contractType,isProRated,paidEndDate}.
// contract.dateOfTermination is NOT dropped - it was never there. A payment-row stub
// carries no termination date, which is exactly why Build Cohort dates cancelled stubs
// from the terminated sweep's index instead.
const pages = $input.all();

let rows = [];
let declaredTotal = null, declaredPages = null, pagesWalked = 0, rawRows = 0;

for (const p of pages) {
  const b = p.json || {};
  const body = b.body !== undefined ? b.body : b;
  if (!Array.isArray(body.content)) {
    // An ERP error body must not read as an empty sweep. Zero rows is the one failure
    // gate 2 cannot tell from a quiet month, so it is refused here instead.
    if (body.status || body.message || body.error || body.path) {
      throw new Error('WF-S: advancesearch returned an error body instead of rows - status=' +
        (body.status || '?') + ' message=' + String(body.message || body.error || '?').slice(0, 200));
    }
    throw new Error('WF-S: a sweep page had no `content` array. keys=' + Object.keys(body).join(','));
  }
  pagesWalked++;
  rawRows += body.content.length;
  const t = Number(body.totalElements);
  if (Number.isFinite(t) && t > 0) declaredTotal = Math.max(declaredTotal === null ? 0 : declaredTotal, t);
  const tp = Number(body.totalPages);
  if (Number.isFinite(tp) && tp > 0) declaredPages = Math.max(declaredPages === null ? 0 : declaredPages, tp);

  for (const r of body.content) {
    const c = r.contract || {};
    const cl = c.client || {};
    const hm = c.housemaid || {};
    const pt = c.contractProspectType || {};
    const st = r.status || {};
    const ty = r.typeOfPayment || {};
    const me = r.methodOfPayment || {};
    rows.push({
      id: r.id,
      amountOfPayment: r.amountOfPayment,
      dateOfPayment: r.dateOfPayment,
      // status.value, NEVER status.label - the screen shows PDP where the API returns PDC.
      status: { value: st.value },
      // typeOfPayment.NAME - there is no label or value on this DTO, and name matches
      // the bulk feed's paymentType vocabulary exactly, so one allowlist serves both.
      typeOfPayment: { name: ty.name, code: ty.code },
      methodOfPayment: { label: me.label, value: me.value },
      replaced: r.replaced === true,
      contract: {
        id: c.id,
        status: c.status,
        startOfContract: c.startOfContract,
        client: { id: cl.id, name: cl.name },
        housemaid: { id: hm.id, label: hm.label, nationality: hm.nationality },
        contractProspectType: { code: pt.code }
      }
    });
  }
}

// COMPLETENESS IS PROVEN HERE TOO, not only in WF-A. If this workflow returns a short
// sweep, WF-A sees a projection that looks perfectly well-formed - so the check belongs
// on both sides of the boundary. The drift allowance matches gate 2's.
const DRIFT = 25;
if (declaredTotal !== null && rows.length < declaredTotal - DRIFT) {
  throw new Error('WF-S: collected ' + rows.length + ' status rows against a declared totalElements of ' +
    declaredTotal + ' (short by ' + (declaredTotal - rows.length) + '). One dropped page at size 2000 is ' +
    '2,000 rows, far outside the ' + DRIFT + '-row allowance for concurrent change, so this is a ' +
    'truncated walk. Raise maxRequests on the sweep node rather than passing a short projection ' +
    'to WF-A, which cannot tell the difference.');
}
if (rows.length === 0) {
  throw new Error('WF-S: the status sweep returned ZERO rows. It is the only source of status.value ' +
    'and of the cohort second half. A quiet month is not a thing here - three months of CC payments ' +
    'ran 43,727 rows when measured.');
}

console.log(JSON.stringify({ stage: 'wfs_project_status_rows',
  pages_walked: pagesWalked, raw_rows: rawRows, projected_rows: rows.length,
  declared_total: declaredTotal, declared_pages: declaredPages,
  note: 'returning ONE item shaped like the HTTP node it replaced, so WF-A consumers are unchanged. ' +
        'The raw rows die with this execution - that is the entire point.' }));

return [{ json: {
  content: rows,
  totalElements: declaredTotal === null ? rows.length : declaredTotal,
  totalPages: declaredPages === null ? 1 : declaredPages,
  // Provenance, so a reader of WF-A's execution can see the rows were projected rather
  // than wondering why the DTO looks thin.
  _projected_by: 'CC Below Agreed - 0-Sweep Statuses',
  _pages_walked: pagesWalked,
  _raw_rows: rawRows
} }];
