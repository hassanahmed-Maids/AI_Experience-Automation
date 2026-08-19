// Project Population Rows (WF-Pop) - keep the eleven fields the cohort builder reads,
// drop the seven it does not, and return ONE ITEM PER PAGE.
//
// ONE ITEM PER PAGE IS LOAD-BEARING, and it is the difference between this and the other
// staged sweeps. Gate 2 proves the population walk terminated by checking that the LAST
// page came back SHORT (fewer than the route's 40-row cap, Verify Bulk Pulls line ~138):
// a walk that ended on a full page hit the request cap instead of the end of the data, and
// a truncated cohort is a false green by omission. Collapsing the sweep to a single
// 5,405-row item - which is what WF-S does for statuses - would make that test read
// 5,405 >= 40 and throw on a COMPLETE sweep. So page boundaries are preserved and gate 2
// needs no edit at all. Build Cohort's terminated branch likewise proves the read happened
// by finding at least one page carrying a clients.content array, which only survives if
// pages stay pages.
//
// THE PROJECTION IS DERIVED FROM Build Cohort, field by field (sources A and C):
//   id                           the cohort key (source C reads r.id too)
//   contractProspectType.code    the CC vs MV filter - MaidVisa has its own check
//   startOfContract              coversMonth(); NEVER contractStartDate, which exists
//                                nowhere, and never sourced from the plan read, where it
//                                came back NULL on all three pro-rate test contracts
//   scheduledDateOfTermination / dateOfTermination   the other half of coversMonth(), and
//                                the whole point of the terminated walk - they build the
//                                termination index that dates cancelled payment stubs
//   status                       contract_status
//   liveOut + housemaid.liveOut  live-out rates run ~AED 1,600/month higher, and BLANK IS
//                                NOT FALSE - reading a blank as live-in manufactures
//                                findings against clients who are paying correctly
//   client.id / client.name      case identity
//   housemaid.id / .label / .name / .nationality   case identity (label is the populated
//                                one on this route; name and nationality are read by
//                                Build Cohort as fallbacks and carried for that reason)
//
// DROPPED, read by nobody: clientComplaints, clientReplacments, maidComplaints,
// deletedFromApp, longTermPackage, visaRenewalDeclined, and workerSalaryMonthlyTip - the
// maid's SALARY, which is the field this projection exists for. client.spouseName,
// client.city, client.blocked and client.lastBlockLog go with them: a block-log tree per
// row, none of it read, all of it retained.
const pages = $input.all();
const req = $('Read Population Request').first().json;
const mode = req.mode;

let out = [];
let rawRows = 0, pagesWalked = 0, declaredTotal = null, salaryFieldsDropped = 0;
let lastPageSize = null, emptyPages = 0;

function pick(r) {
  const cl = r.client || {};
  const hm = r.housemaid || {};
  const pt = r.contractProspectType || {};
  return {
    id: r.id !== undefined ? r.id : r.contractId,
    status: r.status,
    startOfContract: r.startOfContract,
    scheduledDateOfTermination: r.scheduledDateOfTermination,
    dateOfTermination: r.dateOfTermination,
    liveOut: r.liveOut,
    client: { id: cl.id, name: cl.name },
    housemaid: { id: hm.id, label: hm.label, name: hm.name, nationality: hm.nationality,
                 liveOut: hm.liveOut },
    contractProspectType: { code: pt.code }
  };
}

for (const p of pages) {
  const b = p.json || {};
  // The active walk runs with fullResponse true and the terminated walk without it, so the
  // body is one level down on one and at the top on the other. Both shapes are handled
  // rather than normalised upstream, because changing either HTTP node's response options
  // would change its retry and error behaviour, and those are tuned per walk.
  const body = b.body !== undefined ? b.body : b;
  const wrapper = body && body.clients ? body.clients : null;
  const rows = wrapper && Array.isArray(wrapper.content) ? wrapper.content : null;
  if (!rows) {
    // An ERP error body must not read as an empty page. A short population is a false green
    // by omission, so it is refused here where the raw response is still visible.
    if (body && (body.status || body.message || body.error || body.path)) {
      throw new Error('WF-Pop (' + mode + '): contract/search/page returned an error body instead ' +
        'of contracts - status=' + (body.status || '?') + ' message=' +
        String(body.message || body.error || '?').slice(0, 200) + '. A 401 here means the token; a ' +
        '500 with SecurityException means the account is not granted the surface.');
    }
    throw new Error('WF-Pop (' + mode + '): a page carried no clients.content array. keys=' +
      Object.keys(body || {}).join(','));
  }
  pagesWalked++;
  rawRows += rows.length;
  lastPageSize = rows.length;
  if (rows.length === 0) emptyPages++;
  const t = Number(body.total);
  // Take the LARGEST total seen: the book moves during a 136-page walk and a mid-walk
  // insertion must not shrink the target gate 2 reconciles against.
  if (Number.isFinite(t) && t > 0) declaredTotal = Math.max(declaredTotal === null ? 0 : declaredTotal, t);
  for (const r of rows) {
    if (r && r.workerSalaryMonthlyTip !== undefined && r.workerSalaryMonthlyTip !== null &&
        r.workerSalaryMonthlyTip !== '') {
      salaryFieldsDropped++;
    }
  }
  // The envelope keeps clients.content and total under the same names, because
  // Verify Bulk Pulls and Build Cohort both read exactly those. clients.totalPages,
  // clients.last and clients.size are deliberately NOT carried: all three lie on this
  // route (totalPages is currentPage+1, last is true on every page, size echoes the size
  // asked for while the server never returns more than 40 rows) and passing them on would
  // invite someone downstream to trust them.
  out.push({ json: {
    clients: { content: rows.map(pick) },
    total: Number.isFinite(t) && t > 0 ? t : (declaredTotal === null ? rows.length : declaredTotal),
    _projected_by: 'CC Below Agreed - 0-Sweep Population',
    _mode: mode,
    _page: pagesWalked - 1,
    _raw_rows_this_page: rows.length
  } });
}

// ZERO ROWS MEANS DIFFERENT THINGS IN THE TWO MODES, and collapsing them would be the
// expensive mistake in both directions.
if (mode === 'active' && rawRows === 0) {
  throw new Error('WF-Pop (active): the population sweep returned ZERO rows. The CC book has been ' +
    'independently measured at 5,202 (2026-08-13), 5,393 (2026-08-18) and 5,405 (2026-08-19), so ' +
    'zero is an access or filter failure, never a real state.');
}
if (mode === 'terminated' && pagesWalked === 0) {
  // A month with no terminations at all is improbable (628 CC in July 2026) but not
  // impossible, and it must not crash the run - Build Cohort tolerates zero terminated
  // rows and only insists that the READ HAPPENED, which it proves by finding a page
  // carrying a clients.content array. Returning nothing here would strip that proof and
  // make a quiet month indistinguishable from a failed sweep, so one empty envelope is
  // emitted deliberately. Reaching this line at all means the HTTP node produced no page
  // object either, which is why it is logged as loudly as an error would be.
  console.log(JSON.stringify({ stage: 'wfpop_project_rows', mode: mode, pages_walked: 0,
    rows: 0, emitted: 'one synthetic empty envelope',
    warning: 'the terminated walk produced NO page objects. Build Cohort would otherwise throw ' +
             'on a missing envelope. Verify this month really had no terminations before ' +
             'trusting any run that logs this.' }));
  return [{ json: {
    clients: { content: [] }, total: 0,
    _projected_by: 'CC Below Agreed - 0-Sweep Population',
    _mode: mode, _page: 0, _raw_rows_this_page: 0, _synthetic_empty_envelope: true
  } }];
}

console.log(JSON.stringify({ stage: 'wfpop_project_rows', mode: mode,
  pages_walked: pagesWalked, rows: rawRows, declared_total: declaredTotal,
  last_page_size: lastPageSize,
  last_page_short: lastPageSize !== null && lastPageSize < 40,
  empty_pages: emptyPages,
  salary_fields_dropped: salaryFieldsDropped,
  note: 'ONE ITEM PER PAGE so gate 2 short-last-page terminator still works. The maid salary ' +
        'field is dropped here and never reaches WF-A or its execution record.' }));

return out;
