'use strict';
/**
 * Emits the n8n Score node body from score-core.js.
 *
 * The node gets the SAME code the tests run, inlined, plus a thin harness that reads
 * n8n's inputs and writes n8n's output. Nothing about scoring lives only in n8n.
 */
const fs = require('fs');
const path = require('path');



/**
 * Line-based comment strip for the DEPLOYED body only.
 *
 * The rationale comments are the most valuable part of this code and they stay in
 * score-core.js, which is what gets reviewed. The n8n node carries a pointer and the
 * core's SHA-256 instead, so it can still be byte-compared against the repo - which is
 * the actual point of the house rule about verbose generated nodes, and a checksum does
 * it more cheaply than 30 KB of prose nobody re-reads in a node editor.
 *
 * Line-based on purpose: the regex attempt at this swallowed most of the file, because
 * an optional doc-comment group will happily match from an arbitrary earlier point.
 */
function stripComments(code) {
  const out = [];
  let inBlock = false;
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (t.endsWith('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.endsWith('*/')) inBlock = true; continue; }
    if (t.startsWith('//')) continue;
    out.push(line);
  }
  // Collapse runs of blank lines.
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}


/**
 * Drop functions the n8n harness never reaches, by BRACE MATCHING rather than regex.
 *
 * The regex attempt at this swallowed most of the file: an optional doc-comment group
 * will happily begin matching at an arbitrary earlier point and lazily expand. Counting
 * braces from the `function name(` line is boring and correct.
 */
function dropFunctions(code, names) {
  const lines = code.split('\n');
  const out = [];
  let skipping = false;
  let depth = 0;
  for (const line of lines) {
    if (skipping) {
      depth += (line.split('{').length - 1) - (line.split('}').length - 1);
      if (depth <= 0) skipping = false;
      continue;
    }
    const m = line.match(/^function\s+(\w+)\s*\(/);
    if (m && names.indexOf(m[1]) !== -1) {
      depth = (line.split('{').length - 1) - (line.split('}').length - 1);
      if (depth > 0) skipping = true;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

let core = fs.readFileSync(path.join(__dirname, 'score-core.js'), 'utf8');

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

// Offline-only helpers stay in score-core.js where the tests use them; the node body
// carries only what its harness calls.
core = dropFunctions(core, ['scoreRefund', 'inPopulation', 'exceeds', 'quarterlyTotal']);
core = core.split('\n').filter(function (l) { return !/^const TOLERANCE_AED = /.test(l); }).join('\n');
core = core.replace(/\nif \(typeof module !== 'undefined'[\s\S]*$/, '\n');
const crypto = require('crypto');
const coreSha = crypto.createHash('sha256').update(core).digest('hex');
const banner =
  '// GENERATED - do not edit here. Source: audit-flows/client-refunds/score-core.js\n' +
  '// Regenerate: node build-node.js   |   Verify: node parity.test.js\n' +
  '// score-core.js sha256: ' + coreSha + '\n' +
  '// Comments are stripped here and live in the source file. Every rule this implements\n' +
  '// is cited there by its spec numeral, with the measurement that justified it.\n\n';
const out = banner + stripComments(core) + stripComments(HARNESS);
fs.writeFileSync(path.join(__dirname, 'dist', 'score-node.js'), out);
console.log('dist/score-node.js  ' + out.split('\n').length + ' lines, ' + out.length + ' chars');
