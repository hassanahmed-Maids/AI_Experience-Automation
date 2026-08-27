import fs from 'fs';
const run = new Function('$', fs.readFileSync(process.argv[2],'utf8'));
const mk = ({cases=[], bundles=0, validated={run_id:'R-VAL'}}={}) => run((name) => {
  if (name==='Merge Verdicts') return { all: () => cases.map(j=>({json:j})) };
  if (name==='Build Evidence Bundle') return { all: () => Array.from({length:bundles},(_,i)=>({json:{case_key:'k'+i}})) };
  if (name==='Validate Inputs') return { first: () => ({json:validated}) };
  throw new Error('unexpected '+name);
})[0].json;

const dec = (mv, applied='unchanged', had=true) => ({model_verdict:mv, applied, had_written_record:had});
const C = (run_id, ds) => ({run_id, decisions:ds});

const cases = [
  ['verifier answered everything -> complete yes',
   {bundles:2, cases:[C('R1',[dec('EXPLAINED','clean_explained')]), C('R1',[dec('CLAIMED_OFF_ERP','unresolved_evidence_claimed')])]},
   r => r.verifier_complete==='yes' && r.verifier_no_answer===0 && r.run_id==='R1'],
  ['one case came back with NO_ANSWER -> complete NO',
   {bundles:2, cases:[C('R1',[dec('EXPLAINED','clean_explained')]), C('R1',[dec('NO_ANSWER')])]},
   r => r.verifier_complete==='NO' && r.verifier_no_answer===1],
  ['merge LOST a bundled case -> counted as unanswered',
   {bundles:3, cases:[C('R1',[dec('EXPLAINED','clean_explained')])]},
   r => r.verifier_no_answer===2 && r.verifier_complete==='NO'],
  ['verifier returned NOTHING at all -> the case this fix exists for',
   {bundles:5, cases:[], validated:{run_id:'R-VAL'}},
   r => r.verifier_expected===5 && r.verifier_no_answer===5 && r.verifier_complete==='NO' && r.run_id==='R-VAL'],
  ['nothing was routed -> n/a, not a false alarm',
   {bundles:0, cases:[]},
   r => r.verifier_complete==='n/a - nothing routed' && r.run_id==='R-VAL'],
  ['STARVED: records existed, nothing applied, all auditor-review',
   {bundles:2, cases:[C('R1',[dec('NO_TEXT'),dec('NO_TEXT')]), C('R1',[dec('NO_TEXT')])]},
   r => r.verifier_starved_suspected===true && r.verifier_complete==='NO'],
  ['NOT starved when the model actually applied something',
   {bundles:2, cases:[C('R1',[dec('EXPLAINED','clean_explained')]), C('R1',[dec('NO_TEXT')])]},
   r => r.verifier_starved_suspected===false],
  ['auditor_review counts NO_TEXT / UNRESOLVED / NO_ANSWER',
   {bundles:1, cases:[C('R1',[dec('NO_TEXT'),dec('UNRESOLVED'),dec('NO_ANSWER'),dec('EXPLAINED','clean_explained')])]},
   r => r.verifier_auditor_review===3],
];
let pass=0, fail=0;
for (const [name, args, check] of cases) {
  let out, ok=false, err=null;
  try { out = mk(args); ok = check(out); } catch(e){ err=e.message; }
  if (ok) { pass++; console.log('  PASS  '+name); }
  else { fail++; console.log('  FAIL  '+name+(err?('  [threw '+err+']'):('  -> '+JSON.stringify(out)))); }
}
// the refusal case
let threw=false;
try { mk({bundles:1, cases:[], validated:{}}); } catch(e){ threw=/no run_id resolved/.test(e.message); }
if (threw) { pass++; console.log('  PASS  no run_id anywhere -> refuses rather than stamping a blank key'); }
else { fail++; console.log('  FAIL  no run_id anywhere -> should have thrown'); }
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
