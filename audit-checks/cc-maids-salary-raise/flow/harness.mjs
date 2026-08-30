// Runs the DEPLOYED Code bodies (bodies.json) offline, in a fake n8n context.
//
// WHY THIS EXISTS. The 115-assertion suite in ../test/ exercises ../lib/, which is a MIRROR of
// the deployed logic, not the deployed logic itself. Two bugs shipped straight through it:
//
//   1. Adjudicate composed with det.allowed while Score Deterministic emits det.allowed_aed.
//      paid and raisePer went NaN, every comparison fell through, and a maid whose evidence
//      composes EXACTLY to what she was paid was recorded PENDING instead of CLEAN - silently,
//      because NaN serialises to null and pending reads like an honest cannot-tell. The mirror
//      never caught it because ../lib/scorer.js and ../lib/adjudicate.js agree on `allowed`
//      between themselves; the deployed pair disagreed at exactly that seam.
//
//   2. All four branch gates used operator "notTrue", which n8n does not implement, so every
//      gate sent the happy path down the EMPTY branch. A full run scored nobody, wrote a run
//      row reading candidates 0 / findings 0, and reported success.
//
// Both are contract bugs BETWEEN nodes, which is the one class a per-node unit test cannot see.
import fs from 'node:fs';
import vm from 'node:vm';

const BODIES = JSON.parse(fs.readFileSync(new URL('./bodies.json', import.meta.url), 'utf8'));
const MAP = JSON.parse(fs.readFileSync(new URL('./body-map.json', import.meta.url), 'utf8'));

const byNode = {};
for (const [key, m] of Object.entries(MAP)) if (m.param === 'jsCode') byNode[m.node] = BODIES[key];

// Minimal n8n runtime: $(), $input, $json, console.log.
export function runNode(name, { input = [], nodes = {} }) {
  const body = byNode[name];
  if (!body) throw new Error('no deployed body for node: ' + name);
  const wrap = (items) => ({
    all: () => items,
    first: () => items[0],
    get item() { return items[0]; }
  });
  const ctx = {
    $: (n) => {
      if (!(n in nodes)) throw new Error('node "' + n + '" is unexecuted (referenced by ' + name + ')');
      return wrap(nodes[n]);
    },
    $input: wrap(input),
    $json: input.length ? input[0].json : {},
    console: { log: () => {} },
    Buffer, Date, Math, JSON, Number, String, Object, Array, Map, Set, RegExp, Error, isNaN, parseInt, parseFloat
  };
  vm.createContext(ctx);
  return new vm.Script('(function(){' + body + '})()').runInContext(ctx);
}
export { byNode };
