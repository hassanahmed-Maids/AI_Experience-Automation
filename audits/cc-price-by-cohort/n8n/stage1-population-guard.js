const src = $("Parse + Assert Card").first().json;
const params = src.params;
const card = src.price_card;
const cfg = params.population;
const SIZE = 500;

// The dynamic API returns no `total`, so completeness cannot be self-reported.
// The independent count comes from a DIFFERENT route on purpose.
let independent = null;
try {
  const ic = $("Get Independent Count").first().json;
  const t = ic && ic.total;
  if (t !== undefined && t !== null) independent = Number(t);
} catch (e) { independent = null; }

const pages = $input.all();
const rows = [];
const problems = [];

// THREE CLASSES OF PAGE, and they have different legal row counts. Getting this
// wrong aborted run 92512 on correct data:
//   interior      (0 .. n-3)  must be exactly SIZE
//   last data     (n-2)       holds the remainder, so 1..SIZE is legal
//   probe         (n-1)       fetched past the end, must be 0
// With total 5401 and SIZE 500: pages 0-9 are 500, page 10 is 401, page 11 is 0.
const probeIdx = pages.length - 1;
const lastDataIdx = pages.length - 2;

for (let i = 0; i < pages.length; i++) {
  const body = (pages[i].json || {}).body;
  if (!Array.isArray(body)) {
    throw new Error("POPULATION SHAPE UNEXPECTED on page " + i + ": expected a bare array. A SecurityException body here means the account lacks the getactivecccontracts grant. Run stopped; no contract was scored.");
  }
  if (i === probeIdx) {
    // Rows here mean the population outgrew the independent count mid-run, so
    // this pull is short by an unknown amount.
    if (body.length !== 0) {
      problems.push("the probe page past the expected end returned " + body.length + " rows, so the population extends beyond the independent count and this pull is incomplete");
    }
  } else if (i === lastDataIdx) {
    if (body.length === 0 || body.length > SIZE) {
      problems.push("the last data page returned " + body.length + " rows, which is outside the legal 1.." + SIZE);
    }
  } else if (body.length !== SIZE) {
    // A short interior page is how the flattened-body trap manifests: HTTP 200
    // with paging silently ignored.
    problems.push("interior page " + i + " returned " + body.length + " rows instead of " + SIZE);
  }
  for (const r of body) rows.push(r);
}

const seen = {};
const contracts = [];
let dupes = 0;
for (const r of rows) {
  const id = String(r.contractId === undefined || r.contractId === null ? "" : r.contractId);
  if (!id) continue;
  if (seen[id]) { dupes++; continue; }
  seen[id] = true;
  // THIS PROJECTION IS THE PII BOUNDARY. Source rows carry clientName and
  // maidName; neither is needed to price a contract, and neither travels past
  // this line into the baton, the Cases table, or any report.
  contracts.push({
    contract_id: id,
    client_id: String(r.clientId === undefined || r.clientId === null ? "" : r.clientId),
    maid_nationality: r.maidNationality === undefined ? null : r.maidNationality,
    live_out: r.maidLiveOut === undefined ? null : r.maidLiveOut,
    contract_start_date: r.startDate === undefined ? null : r.startDate,
    // Needed to decide whether the contract was active for the WHOLE audit
    // month. A contract terminated part-way through M is out of scope for M,
    // which is what removes the pro-rating problem instead of modelling it.
    scheduled_termination: r.scheduledDateOfTermination === undefined ? null : r.scheduledDateOfTermination
  });
}

const count = contracts.length;
const delta = independent === null ? null : count - independent;
const deltaPct = (independent === null || independent === 0) ? null : Math.abs(delta) / independent * 100;

// This is the check that actually proves nothing was missed. The page-shape
// rules above catch a broken pager early with a clearer message, but the count
// reconciliation is the one that matters.
if (independent === null) {
  problems.push("no independent count available, so completeness cannot be proven");
} else if (count < independent) {
  problems.push("SHORT READ: fetched " + count + " of " + independent + " contracts (" + (independent - count) + " missing)");
} else if (deltaPct !== null && deltaPct > cfg.max_divergence_pct) {
  problems.push("population diverges from the independent count by " + deltaPct.toFixed(2) + "%");
}
if (problems.length) {
  throw new Error("POPULATION GUARD FAILED: " + problems.join("; ") + ". Run stopped; no contract was scored. Partial results are never emitted.");
}

const soft = [];
if (count < cfg.abort_below) soft.push("population " + count + " is below the abort floor " + cfg.abort_below);
const warn = count >= cfg.abort_below && count < cfg.warn_below;
if (soft.length && !cfg.warn_only) {
  throw new Error("POPULATION GUARD FAILED: " + soft.join("; ") + ". Run stopped; no contract was scored.");
}

let withNat = 0;
for (const c of contracts) { if (c.maid_nationality !== null && String(c.maid_nationality).trim() !== "") withNat++; }

return [{ json: {
  params: params,
  price_card: card,
  population: {
    count: count,
    independent_count: independent,
    delta: delta,
    delta_pct: deltaPct,
    duplicates_dropped: dupes,
    pages_fetched: pages.length,
    page_size: SIZE,
    complete: soft.length === 0 && !warn,
    guard: soft.length ? "below-floor-warn-only" : (warn ? "warn-band" : "ok"),
    guard_notes: soft.join("; "),
    source: "dynamicApi/getactivecccontracts",
    with_nationality: withNat,
    without_nationality: count - withNat
  },
  contracts: contracts
} }];
