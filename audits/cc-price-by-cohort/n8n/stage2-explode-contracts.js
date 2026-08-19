// Processes ONE chunk of the population. The instance kills executions at
// 2400s and a full pass measures ~93 min, so the run is split across
// executions rather than truncated inside one.
//
// 1200, not 1500: adding the third ERP call (getActiveCptInfo, measured 0.81s
// mean over 5 samples on 2026-08-19) moved a batch of five from ~4.36s to
// ~5.17s, which would have put a 1500-contract chunk at ~26 min against a
// 40-min kill. 1200 restores the headroom at ~21 min.
const b = $input.first().json;
const ch = (b.params && b.params.chunk) || {};
const size = Number(ch.size || 1200);
const offset = Number(ch.offset || 0);
const all = b.contracts || [];
const slice = all.slice(offset, offset + size);
const out = [];
for (const c of slice) {
  if (!c.contract_id || !c.client_id) continue;
  out.push({ json: {
    contract_id: String(c.contract_id),
    client_id: String(c.client_id),
    live_out_inline: c.live_out === undefined ? null : c.live_out,
    start_inline: c.contract_start_date === undefined ? null : c.contract_start_date,
    nationality_inline: c.maid_nationality === undefined ? null : c.maid_nationality,
    // Decides whether the contract was active for the whole audit month.
    scheduled_termination_inline: c.scheduled_termination === undefined ? null : c.scheduled_termination
  } });
}
return out;
