// VERBATIM copy of the "Summarise" node body from flow ABNaSxxRV6vzQTNi,
// wrapped for offline exercise. Source of truth: edit here, re-sync the node.
//
// Its whole job is to refuse to publish numbers it cannot stand behind.

'use strict';

function summarise(scored, storeRows) {
  const s = scored;
  const readBack = storeRows.filter(function (i) { return i.json && i.json.run_id === s.run_id; });
  const rowsInStore = readBack.length;
  const reconciles = (rowsInStore === s.cases_total);

  if (!reconciles) {
    throw new Error('ABORT before reporting: scored ' + s.cases_total + ' cases but the store holds '
      + rowsInStore + ' for run ' + s.run_id + '.');
  }

  const tally = { findings: 0, route_to_verifier: 0, pending: 0, clean: 0 };
  for (const i of readBack) {
    const v = i.json.verdict;
    if (v === 'finding') tally.findings++;
    else if (v === 'route to verifier') tally.route_to_verifier++;
    else if (v === 'pending') tally.pending++;
    else if (v === 'clean') tally.clean++;
  }
  const tallyAgrees = tally.findings === s.findings && tally.route_to_verifier === s.route_to_verifier
    && tally.pending === s.pending && tally.clean === s.clean;
  if (!tallyAgrees) {
    throw new Error('ABORT before reporting: the verdict tally read back from the store does not match'
      + ' the tally that was scored. Store says ' + JSON.stringify(tally) + '.');
  }

  return {
    run_id: s.run_id,
    cases_total: s.cases_total,
    case_rows_read_back: rowsInStore,
    case_store_reconciles: reconciles,
    verdicts: tally,
    status: s.status,
    DECLARED_GAPS: s.declared_gaps.split(' || ')
  };
}

module.exports = { summarise };
