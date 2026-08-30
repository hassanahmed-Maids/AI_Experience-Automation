/**
 * Deploy in two verifiable pieces.
 *
 * Piece A (this script): a SKELETON of the workflow - every node, version, position, HTTP config,
 * sticky and connection exactly as verified, but with each Code body and the agent system message
 * replaced by a short placeholder. Small enough to transmit reliably in one call.
 *
 * Piece B: the real bodies, installed by name via update_workflow, then read back and diffed
 * against this repo file so the deployment is PROVEN byte-exact rather than assumed.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('workflow.sdk.js', 'utf8');
const bodies = {};
let out = '';
let i = 0;

// Every body is now written as: jsCode: 'line'\n + '\n' + 'line' ...
// Find each, evaluate it to recover the exact string, and swap in a placeholder.
function extract(marker, key) {
  let o = '';
  let idx = 0;
  let n = 0;
  const s = key === 'jsCode' ? out || src : out;
  const input = out || src;
  o = '';
  idx = 0;
  while (true) {
    const at = input.indexOf(marker, idx);
    if (at === -1) { o += input.slice(idx); break; }
    o += input.slice(idx, at);
    // the expression runs until the line that is not a continuation
    let end = at + marker.length;
    let depth = 0;
    // walk forward to the end of the concatenation expression: it ends at a newline whose next
    // non-space char is '}' or a property name - simplest robust rule: consume while the next
    // non-space chars start with "+ '"
    let cursor = input.indexOf('\n', end);
    while (cursor !== -1) {
      const nextLine = input.slice(cursor + 1);
      const trimmed = nextLine.replace(/^[ \t]*/, '');
      if (trimmed.startsWith("+ '")) { cursor = input.indexOf('\n', cursor + 1); continue; }
      break;
    }
    end = cursor === -1 ? input.length : cursor;
    const exprSrc = input.slice(at + marker.length, end);
    const value = vm.runInNewContext('(' + exprSrc + ')');
    n++;
    const id = key + '#' + n;
    bodies[id] = value;
    o += marker + JSON.stringify('__PLACEHOLDER__' + id);
    idx = end;
  }
  return o;
}

out = extract("jsCode: ", 'jsCode');
out = extract("systemMessage: ", 'systemMessage');

fs.writeFileSync('skeleton.sdk.js', out);
fs.writeFileSync('bodies.json', JSON.stringify(bodies, null, 2));
console.log('skeleton chars: ' + out.length);
console.log('bodies extracted: ' + Object.keys(bodies).length);
console.log('bodies total chars: ' + Object.values(bodies).reduce((a, b) => a + b.length, 0));
