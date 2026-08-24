// Pass the swept population through to the budget gate.
//
// WHAT THIS NODE USED TO DO, and why it no longer does it. It emitted ONLY the rows whose
// applicant id could not be parsed from the description, because those were the rows that
// still needed a per-transaction DETAIL call. That call has been DELETED (probed 2026-08-24:
// GET /accounting/transactions/{id} is not a mapped route, and the endpoint that IS mapped
// returns the same projection this sweep already has - see ENDPOINT-FINDING.md). There is no
// second source of identity any more, so there is nothing to select FOR.
//
// It also had a sentinel: when nothing needed resolving it re-read the first transaction so
// the chain stayed linear and could not double-execute. That sentinel cost one redundant ERP
// call per run and is gone with the call it protected.
//
// WHAT IT DOES NOW, and why the node still exists. It hands the FULL population to the budget
// gate. That matters: the gate costs `entities x calls-per-transaction`, and it counts its
// input. Feeding it only the unresolved subset - one row in the reference window - made it
// budget for one transaction while the run went on to make calls for all 137. The gate was
// measuring the wrong thing, and nobody noticed because the thing it was protecting never ran.
//
// The empty/seed sentinels are passed through untouched so the chain still reaches the scorer:
// returning zero items would skip every downstream node and the run would end silently having
// audited nothing.
const rows = $input.all().map(function (i) { return i.json; });
const real = rows.filter(function (r) {
  return r && !r._empty && !r._seed_only && r.transaction_id !== undefined;
});

if (real.length === 0) {
  return rows.length ? [{ json: Object.assign({}, rows[0], { _no_population: true }) }]
                     : [{ json: { _no_population: true } }];
}

console.log(JSON.stringify({ stage: 'select_population',
  transactions: real.length,
  with_applicant_id: real.filter(function (r) { return r.parsed_applicant_id !== null; }).length,
  housemaid_charges: real.filter(function (r) { return r.is_housemaid_charge; }).length,
  note: 'the per-transaction detail call was deleted 2026-08-24; identity now comes off the ' +
        'swept row or not at all' }));

return real.map(function (r) { return { json: r }; });
