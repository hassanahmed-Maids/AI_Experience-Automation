// GATE 2 (ACP Order 5) - 'Never trust an absence before pulled == totalElements.'
//
// FAILS CLOSED, and this is the single most important node in the flow.
//
// THE TRAP IS LIVE ON THIS ENDPOINT, confirmed by probe 2026-08-19: the envelope carries
// BOTH keys, and
//     total: ""        (empty STRING)
//     totalElements: 137  (number)
// The sibling CC flow preferred `total`:
//     const declared = (b.total != null) ? b.total : b.totalElements;
//     if (collected < Number(declared)) throw ...
// '' != null is TRUE so it never fell through; Number('') is 0; the test became 24000 < 0.
// It truncated at 24,000 of 29,772 rows, ERP returns newest-first so the 5,772 dropped were
// the OLDEST, and the run reported SUCCESS while publishing thousands of false reds.
//
// Therefore, here:
//   * assert on totalElements, NEVER on total.
//   * a declared total that is null, '' or non-numeric ABORTS THE RUN. Never coerced,
//     never defaulted, never compared.
//   * a row count is never proof of completeness on its own.
//
// The flow this replaces has NO assertion here at all.
const validated = $('Validate Inputs').first().json;

const pages = $input.all().map(function (i) { return i.json; });
if (!pages.length) {
  throw new Error('GATE 2: the population sweep returned no pages at all. Refusing to score an empty cohort.');
}

let declared = null, collected = 0, pageCount = 0, sawEnvelope = false;
const transactions = [];

for (const raw of pages) {
  let page = raw || {};
  if (Array.isArray(page)) page = page[0] || {};
  pageCount++;
  if (page.content === undefined) {
    if (page.totalElements === 0 || page.empty === true) { sawEnvelope = true; declared = 0; continue; }
    throw new Error('GATE 2: ERP page envelope has no content key. First 300 chars: ' +
      JSON.stringify(page).slice(0, 300));
  }
  sawEnvelope = true;
  if (declared === null) declared = page.totalElements;   // NEVER page.total - it is ''
  const rows = Array.isArray(page.content) ? page.content : [];
  collected += rows.length;
  for (const tx of rows) transactions.push(tx);
}

if (!sawEnvelope) throw new Error('GATE 2: no recognisable page envelope in the sweep response.');

// THE LITERAL ASSERTION. Note the ORDER: the type is checked BEFORE any arithmetic, so an
// empty string can never quietly become 0.
if (declared === null || declared === '' || typeof declared !== 'number' || !Number.isFinite(declared)) {
  throw new Error('GATE 2: ERP declared totalElements as ' + JSON.stringify(declared) + ' (type ' +
    (typeof declared) + '). A non-numeric declared total ABORTS the run - it is never coerced. ' +
    'This is the exact shape that truncated the sibling CC sweep and published thousands of ' +
    'false reds on a successful-looking run.');
}
if (collected !== declared) {
  throw new Error('GATE 2: pulled ' + collected + ' of ' + declared + ' declared transactions across ' +
    pageCount + ' page(s). A partial walk silently drops applicants who exist, so an absence cannot ' +
    'be trusted. Refusing to score.');
}

// Independent guard on the filter itself. The population is expense 492 ONLY; 137 is the
// REAL-ticket expense and belongs to Applicant Real Ticket. With no filter this sweep
// returns every transaction in the window and every later gate would still pass.
// Measured 2026-08-19: 137 of 137 rows were expense 492 / FT 78.
let wrongExpense = 0;
for (const tx of transactions) {
  const eid = tx && tx.expense && tx.expense.id;
  if (eid !== undefined && eid !== null && Number(eid) !== 492) wrongExpense++;
}
if (wrongExpense > 0) {
  throw new Error('GATE 2: ' + wrongExpense + ' of ' + collected + ' rows are not expense 492. The run ' +
    'aborts rather than widening - a dropped or wrong expense filter audits the wrong population ' +
    'with every later gate still passing.');
}

// A transaction with no date cannot be assigned to a window. Abort rather than guess, and
// NEVER fall back to creationDate or pnlValueDate - all three keys exist on every row and
// they disagree. Measured 2026-08-19: 0 of 137 rows had a null date.
let nullDate = 0;
for (const tx of transactions) { if (!tx || !tx.date) nullDate++; }
if (nullDate > 0) {
  throw new Error('GATE 2: ' + nullDate + ' row(s) carry no transaction date, so they cannot be ' +
    'assigned to the audit window. Aborting rather than falling back to creationDate or ' +
    'pnlValueDate, which exist on every row and disagree with date.');
}

// ---- IDENTITY COMES OFF THIS ROW. THERE IS NO SECOND SOURCE. -------------------------
// 136 of 137 rows carry 'Applicant ID - N' in the description, and the parsed id matched
// applicants[0].applicant.id on 6 of 6 sampled rows with ZERO disagreements (2026-08-19).
//
// The 137th row was sent to a per-transaction DETAIL call. That call has now been DELETED,
// and the reason is worth keeping. Probed 2026-08-24:
//   * GET /accounting/transactions/{id} IS NOT A ROUTE. ERP answers 401 with
//     developerMessage API_NOT_FOUND_FOR_PAGE while the same token gets 200 elsewhere in
//     the same second. Ask-the-code confirms TransactionsController declares no
//     @GetMapping("/{id}") (conversation 44674). The pageCode-to-route whitelist lives in
//     the FRONTEND repo, which is why no amount of backend reading found this.
//   * The endpoint that DOES exist - advancesearchNew - returns the same projection DTO
//     this sweep already receives. There is no richer view of a transaction under this
//     pageCode, so the detail call was redundant even had the URL been right.
// So this check's per-entity phase had never once completed, through three compliance
// passes, because every one of them read the flow and none of them ran it.
//
// The policy of ACP Order 20 is untouched: the id still comes from a STRUCTURED source and
// is NEVER resolved from a name. The ticketing card is on this row too (fromBucket).
const ID_RE = /Applicant\s*ID\s*[-–:]\s*(\d+)/i;

// 'Maid Profile ID - N' is the housemaid equivalent, and it is parsed into its OWN field.
// It must NEVER be written to parsed_applicant_id: one case is one APPLICANT, the downstream
// ticket fetch is applicant-scoped, and a housemaid id pushed through it would return another
// person's tickets and score them as this case. Recorded so the row is visible and
// attributable; routed to housemaidCharges by Resolve Applicants, not into the population.
const MAID_ID_RE = /Maid\s*Profile\s*ID\s*[-–:]\s*(\d+)/i;

const gate2 = { declared: declared, collected: collected, pages: pageCount,
  wrong_expense: 0, null_dates: 0 };
const prevReds = (validated.previous_cases || []).filter(function (p) { return p.state === 'red_flag'; });

// No in-window transactions AND nothing carried over: a genuine, PROVEN pass.
if (transactions.length === 0 && prevReds.length === 0) {
  return [{ json: { _empty: true, __gate2: gate2 } }];
}
// No in-window transactions but open cases exist - emit a seed sentinel so the run still
// reaches applicant resolution, which seeds and re-reads them.
if (transactions.length === 0) {
  return [{ json: { _seed_only: true, __gate2: gate2 } }];
}

let parsed = 0, maidRows = 0, unattributable = 0;
const out = transactions.map(function (tx) {
  const desc = String(tx.description || '');
  const m = desc.match(ID_RE);
  const pid = m ? parseInt(m[1], 10) : null;
  const mm = desc.match(MAID_ID_RE);
  const hid = mm ? parseInt(mm[1], 10) : null;
  // 'Maid -' rows are housemaid charges in the dummy bucket: they resolve a housemaid,
  // not an applicant, so this applicant-scoped check cannot own them. Recorded, not dropped.
  const prefix = /Maid\s*-/i.test(desc) ? 'Maid' : (/Applicant\s*-/i.test(desc) ? 'Applicant' : 'other');
  const isMaid = prefix === 'Maid' || hid !== null;
  if (pid !== null) parsed++;
  else if (isMaid) maidRows++;
  else unattributable++;
  return { json: {
    transaction_id: tx.id,
    transaction_date: tx.date,
    expense_id: tx.expense && tx.expense.id,
    parsed_applicant_id: pid,
    parsed_housemaid_id: hid,
    is_housemaid_charge: isMaid,
    desc_prefix: prefix,
    transaction_type: tx.transactionType || null,
    card: (tx.fromBucket && tx.fromBucket.name) || ''
  }};
});

gate2.applicant_id_parsed_from_description = parsed;
gate2.housemaid_charges_out_of_scope = maidRows;
// Rows that are neither a parsable applicant nor a recognisable housemaid charge. There is
// no second source to fall back on any more, so these are a DECLARED GAP, not a to-do:
// Resolve Applicants records them as unattributable and the run reports them.
gate2.unattributable_rows = unattributable;
out[0].json.__gate2 = gate2;
return out;