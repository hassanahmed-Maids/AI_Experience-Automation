'use strict';
/**
 * Emits the n8n Score node body from score-core.js.
 *
 * The node gets the SAME code the tests run, inlined, plus a thin harness that reads
 * n8n's inputs and writes n8n's output. Nothing about scoring lives only in n8n.
 */
const fs = require('fs');
const path = require('path');


const core = fs.readFileSync(path.join(__dirname, 'score-core.js'), 'utf8');

const HARNESS = `
// ======================= n8n HARNESS (generated - do not edit here) ==================
// Everything above is score-core.js verbatim. Regenerate with: node build-node.js
const pop = $input.first().json;
const cfg = $("Assert Config Checksum").first().json;

// Rule 11 and G-ATTACH both read the per-purpose config. Without it there is no gate that
// can conclude anything, so a run that lost the config has nothing to score.
if (cfg.config_ok === false) {
  throw new Error("REFUSING TO SCORE: " + cfg.config_denied +
    " | Rule 11 and G-ATTACH both need the per-purpose config. The population read is reported" +
    " above so you can see how far access extends, but no verdict is reachable without it.");
}

const setup = cfg.setup || [];
const rows = pop.rows || [];

// Re-check the partition before scoring against it, the same way the config is checksummed.
const part = assertPartition();
if (part.purposes !== 41 || part.duplicates.length) {
  throw new Error("Purpose partition failed its own check: " + part.purposes +
    " purposes, duplicates " + JSON.stringify(part.duplicates) + ". Refusing to route on a broken table.");
}

// ONLY the staff-note candidates cross into the case record. Not iban, not eid, not
// accountName, not the amount - the population read fetches those and no audit needs them.
const NOTE_KEYS = ["notes", "managerNotes", "description", "rejectionNotes"];

const cases = rows.map(function (r) {
  const c = scoreRefundWithGroups(r, setup, {});
  const src = {};
  for (const k of NOTE_KEYS) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) src[k] = v;
  }
  c.source_row = src;
  return c;
});

if (cases.length !== rows.length) {
  throw new Error("Scored " + cases.length + " cases against a population of " + rows.length + ". Refusing to summarise.");
}

function countBy(v) { return cases.filter(function (c) { return c.verdict === v; }).length; }
const counts = { scored: cases.length, findings: countBy("finding"), pending: countBy("pending"), clean: countBy("clean") };

// Group spread and note-key coverage: KEY NAMES AND COUNTS ONLY, never values.
const byGroup = {};
const byNoteKey = {};
cases.forEach(function (c) {
  const g = c.group || "(unrouted)";
  byGroup[g] = (byGroup[g] || 0) + 1;
  const keys = Object.keys(c.source_row || {});
  const k = keys.length ? keys[0] : "(none)";
  byNoteKey[k] = (byNoteKey[k] || 0) + 1;
});
console.log(JSON.stringify({ stage: "score", counts: counts, by_group: byGroup, note_key_coverage: byNoteKey }));

return [{ json: { cases: cases, counts: counts, by_group: byGroup, note_key_coverage: byNoteKey } }];
`;

const out = core + HARNESS;
fs.writeFileSync(path.join(__dirname, 'dist', 'score-node.js'), out);
console.log('dist/score-node.js  ' + out.split('\n').length + ' lines, ' + out.length + ' chars');
