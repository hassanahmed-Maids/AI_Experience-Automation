#!/usr/bin/env node
// Produce the PRODUCTION export of an audit flow from its staging workflow JSON.
//
//   node strip-erp-lease.mjs <staging-workflow.json> [--out prod.json]
//
// The ERP lease nodes (Acquire / Release / Release-on-error) are a STAGING construct: they
// serialise ERP access while several people run checks by hand. Production runs on a monthly
// schedule, one flow at a time, and must not carry them. Ruling 2026-08-30.
//
// THIS IS AN EXPORT-TIME TRANSFORM, NOT A WORKFLOW EDIT. Deleting the lease nodes from the
// staging workflow would remove the very protection that testing needs — the 2026-08-19
// clientmgmt 503 is what the leases exist to prevent. Staging keeps them; the artifact attached
// to the deployment ticket does not.
//
// Lease nodes are mid-chain, so removal is a BRIDGE: every inbound edge is re-pointed at every
// target of the lease node's main output 0. The lease node's own error output (index 1) simply
// goes away with it — there is no lease left to fail.

import { readFileSync, writeFileSync } from 'node:fs';

const LEASE = /lease/i;

function load(p) {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return raw.workflow ?? raw;
}

// Every node reachable from the trigger(s), following main connections.
function reachable(wf) {
  const conns = wf.connections ?? {};
  const nodes = wf.nodes ?? [];
  const isTrigger = (n) => /Trigger$|trigger$|webhook$/i.test(n.type) || /scheduleTrigger|manualTrigger|executeWorkflowTrigger|errorTrigger|\.webhook$/i.test(n.type);
  const seen = new Set();
  const stack = nodes.filter(isTrigger).map((n) => n.name);
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const out of conns[cur]?.main ?? []) {
      for (const l of out ?? []) stack.push(l.node);
    }
  }
  return seen;
}

function strip(wf) {
  const conns = structuredClone(wf.connections ?? {});
  const leases = (wf.nodes ?? []).filter((n) => LEASE.test(n.name)).map((n) => n.name);
  const bridges = [];

  for (const L of leases) {
    // Targets of the lease's SUCCESS output only. Its error output dies with it.
    const successors = (conns[L]?.main?.[0] ?? []).map((l) => ({ ...l }));

    for (const [src, c] of Object.entries(conns)) {
      if (src === L) continue;
      for (const out of c.main ?? []) {
        if (!out) continue;
        const idx = out.findIndex((l) => l.node === L);
        if (idx === -1) continue;
        out.splice(idx, 1);                       // drop the edge into the lease
        for (const s of successors) {
          if (!out.some((l) => l.node === s.node && l.index === s.index)) {
            out.push({ ...s });                   // re-point at what the lease fed
            bridges.push(`${src} -> ${s.node}`);
          }
        }
      }
    }
    delete conns[L];
  }

  const nodes = (wf.nodes ?? []).filter((n) => !LEASE.test(n.name));
  return { ...wf, nodes, connections: conns, __leases: leases, __bridges: bridges };
}

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('usage: strip-erp-lease.mjs <workflow.json> [--out prod.json]'); process.exit(1); }

const before = load(file);
const after = strip(before);

const rBefore = reachable(before);
const rAfter = reachable(after);
const lost = [...rBefore].filter((n) => !rAfter.has(n) && !LEASE.test(n));

console.log(`workflow : ${before.name}`);
console.log(`nodes    : ${before.nodes.length} -> ${after.nodes.length}`);
console.log(`removed  : ${after.__leases.join(', ') || '(none)'}`);
console.log(`bridges  : ${after.__bridges.length}`);
for (const b of after.__bridges) console.log(`           ${b}`);
console.log(`reachable: ${rBefore.size} -> ${rAfter.size}`);

// The assertion that makes this safe to trust: removing a lease must not orphan anything else.
if (lost.length) {
  console.error(`\nFAIL — ${lost.length} node(s) became unreachable:`);
  for (const n of lost) console.error(`  ${n}`);
  process.exit(2);
}
console.log('\nOK — no node became unreachable.');

const outIdx = rest.indexOf('--out');
if (outIdx !== -1 && rest[outIdx + 1]) {
  const { __leases, __bridges, ...clean } = after;
  writeFileSync(rest[outIdx + 1], JSON.stringify(clean, null, 2));
  console.log(`written  : ${rest[outIdx + 1]}`);
}
