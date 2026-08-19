// The append nodes reporting success is not evidence anything landed - the same
// assumption hid a total Data Table write failure on 2026-08-18. Column A of
// both tabs is read back and this run's rows are counted.
const summary = $("Reconcile + Aggregate").first().json;
const runId = String(summary.run_id);
// Recounted from the Cases rows rather than from the builder node's output, so
// this is an independent check and still works on a run with zero findings,
// where the builder never executes.
let expectedFindings = 0;
for (const i of $("Read Cases For Run").all()) {
  const r = i.json;
  if (!r || !r.run_id) continue;
  if (String(r.scope || "") !== "in_scope") continue;
  if (String(r.state || "") === "green") continue;
  expectedFindings++;
}

const res = $input.first().json;
const ranges = (res.body && res.body.valueRanges) || [];
const counts = {};
for (const vr of ranges) {
  const tab = String(vr.range || "").split("!")[0].replace(/[']/g, "");
  let n = 0;
  for (const row of (vr.values || [])) { if (String(row[0]) === runId) n++; }
  counts[tab] = n;
}

const problems = [];
if (counts["Audit Runs"] !== 1) {
  problems.push("the Audit Runs tab holds " + counts["Audit Runs"] + " rows for this run, expected exactly 1");
}
if (counts["Audit Findings"] !== expectedFindings) {
  problems.push("the Audit Findings tab holds " + counts["Audit Findings"] + " rows for this run, expected " + expectedFindings);
}
if (problems.length) {
  throw new Error("SHEET WRITE NOT CONFIRMED: " + problems.join("; ") + ". The run summary exists in the Runs data table but the spreadsheet does not match it - treat the sheet as stale.");
}

return [{ json: {
  run_id: runId,
  audit_month: summary.audit_month,
  overall: summary.overall,
  sheet: "https://docs.google.com/spreadsheets/d/1F0cKdaxm9Ct701N5dMpyUQW1-KiiiN8eZgb725GXolE",
  audit_runs_rows_written: counts["Audit Runs"],
  audit_findings_rows_written: counts["Audit Findings"],
  in_scope: summary.in_scope,
  out_of_scope: summary.out_of_scope,
  green: summary.green,
  red: summary.red,
  pending: summary.pending,
  gap_total_aed: summary.gap_total_aed,
} }];
