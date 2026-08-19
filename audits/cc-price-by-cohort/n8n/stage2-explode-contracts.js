// Processes ONE chunk of the population. The instance kills executions at
// 2400s and a full pass measures ~93 min, so the run is split across
// executions rather than truncated inside one.
//
// 1000, not 1500. Adding the third ERP call (getActiveCptInfo) was expected to
// cost ~0.81s per contract of ERP time, but the number that matters is the one
// measured end to end: the 2026-08-19 smoke did 60 contracts in 107s, which is
// 1.78s per contract once Write Cases and the 500ms pace are counted. At that
// rate 1500 contracts is ~44 min - PAST the instance's 2400s kill - and even
// 1200 is ~36 min, an 11% margin. 1000 lands at ~30 min, which leaves room for
// an ERP slow patch without losing a chunk.
const b = $input.first().json;
const ch = (b.params && b.params.chunk) || {};
const size = Number(ch.size || 1000);
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
