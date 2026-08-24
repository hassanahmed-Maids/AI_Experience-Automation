// GATE 20 - 'Identity comes from the applicants array, never from a name.'
//
// TWO SOURCES, in this order:
//   1. 'Applicant ID - N' parsed from the transaction description on the SEARCH row.
//      Present on 136 of 137 rows, and matched applicants[0].applicant.id on 6 of 6
//      sampled rows with zero disagreements (probed 2026-08-19). This is what keeps the
//      run inside its call budget.
//   2. 'Maid Profile ID - N', parsed into parsed_housemaid_id, which identifies a HOUSEMAID
//      charge and is deliberately NOT a member of this population.
//
// THERE IS NO LONGER A DETAIL CALL, and this is the node that used to depend on it. Probed
// 2026-08-24: GET /accounting/transactions/{id} is not a mapped route (401 /
// API_NOT_FOUND_FOR_PAGE), and advancesearchNew - the endpoint that IS mapped - returns the
// same projection the sweep already receives. So the fallback this node was written around
// could never have fired. See ENDPOINT-FINDING.md.
//
// The old note recorded that there is NO top-level 'applicant' key on the detail payload
// (0 of 7 sampled rows) and that the 2026-05 Drive spec's path returns null on every row.
// Both still worth knowing if anyone reaches for that payload again: it is not reachable.
//
// NEVER resolve identity by name. Two applicants sharing a name would merge into one case,
// hiding one of them entirely.
const validated = $('Validate Inputs').first().json;

const rows = $('Verify Population').all().map(function (i) { return i.json; })
  .filter(function (r) { return r && !r._empty && !r._seed_only && r.transaction_id !== undefined; });

let gate2 = null;
try {
  const vp = $('Verify Population').all().map(function (i) { return i.json; });
  for (const v of vp) { if (v && v.__gate2) { gate2 = v.__gate2; break; } }
} catch (e) {}

const byApplicant = new Map();
const unattributable = [];
const housemaidCharges = [];
let txSeen = 0, viaParse = 0;

for (const r of rows) {
  txSeen++;
  const txInfo = { id: r.transaction_id, date: r.transaction_date || null, card: r.card || '' };

  let applicantId = r.parsed_applicant_id;
  if (applicantId !== null && applicantId !== undefined) {
    viaParse++;
  } else if (r.is_housemaid_charge) {
    // A HOUSEMAID charge sitting in the dummy-ticket expense. It resolves a housemaid, not an
    // applicant, so this applicant-scoped check cannot own it - one case is one APPLICANT.
    // Recorded and declared rather than dropped, and NOT sent to the verifier, who would have
    // no question to answer. Measured: 1 of 137 rows (transactionType HOUSEMAID, description
    // prefixed 'Maid -', carrying 'Maid Profile ID - N').
    //
    // THE HOUSEMAID ID IS CARRIED BUT NOT USED AS A CASE KEY. Writing it into applicantId
    // would push a housemaid id through an applicant-scoped ticket fetch and score another
    // person's tickets as this case - a wrong answer that looks like a right one, which is
    // the single failure this check family exists to prevent.
    //
    // NOT COVERED BY THE SPEC - see SPEC-FINDINGS. Whether it belongs to Terminated
    // Housemaids Tickets or nowhere is an owner call.
    housemaidCharges.push(Object.assign({}, txInfo,
      { housemaid_id: r.parsed_housemaid_id === undefined ? null : r.parsed_housemaid_id }));
    continue;
  } else {
    applicantId = null;
  }

  if (applicantId === null || applicantId === undefined) { unattributable.push(txInfo); continue; }

  const key = String(applicantId);
  if (!byApplicant.has(key)) {
    byApplicant.set(key, { applicant_id: applicantId, in_window_transactions: [], seeded: false });
  }
  byApplicant.get(key).in_window_transactions.push(txInfo);
}

// Carried-over open cases are re-read REGARDLESS of the window (ACP Order 5). A manual
// green is portal-owned and sticky - never re-audited here.
let seeded = 0;
for (const p of (validated.previous_cases || [])) {
  if (p.state !== 'red_flag') continue;
  const key = String(p.case_key);
  if (byApplicant.has(key)) continue;
  byApplicant.set(key, { applicant_id: p.case_key, in_window_transactions: [], seeded: true });
  seeded++;
}

const applicants = Array.from(byApplicant.values());
const run_totals = {
  transactions_processed: txSeen,
  transactions_unattributable: unattributable.length,
  housemaid_charges_out_of_scope: housemaidCharges.length,
  applicant_id_via_description_parse: viaParse,
  // Kept in the summary at zero on purpose: a reader who remembers the detail call should
  // see that it is gone, not find the field silently missing.
  applicant_id_via_detail_call: 0,
  unique_applicants: applicants.length,
  carried_over_seeded: seeded,
  gate2: gate2
};

if (applicants.length === 0) {
  return [{ json: { _no_applicants: true, run_totals: run_totals } }];
}

// CHUNK for the sub-workflow. The parent must never hold the raw applicant trees - the
// sibling CC chain had one sweep return 44.1 MB into its caller. 0-Fetch returns only the
// twelve fields the gates read.
const CHUNK = 25;
const chunks = [];
for (let i = 0; i < applicants.length; i += CHUNK) chunks.push(applicants.slice(i, i + CHUNK));

return chunks.map(function (chunk, idx) {
  const row = {
    chunk_index: idx, chunk_total: chunks.length,
    applicant_ids: chunk.map(function (a) { return a.applicant_id; }),
    erp_token: validated.erp_token,
    erp_device_id: validated.erp_device_id,
    erp_is_auth: validated.erp_is_auth,
    __applicants: chunk
  };
  if (idx === 0) {
    row.__run_totals = run_totals;
    row.__unattributable = unattributable;
    row.__housemaid_charges = housemaidCharges;
  }
  return { json: row };
});