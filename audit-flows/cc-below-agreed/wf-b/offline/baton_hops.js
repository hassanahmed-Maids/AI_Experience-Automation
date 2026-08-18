// Multi-hop test for WF-B's batching harness: Validate Inputs -> Select Candidates
// -> Prepare Handoff, run repeatedly the way the self-call actually runs it.
// The bug this exists to catch: a stale has_more riding INSIDE the baton stays true
// on the final hop, so WF-B self-calls with zero candidates instead of routing to
// WF-C - and its own Validate Inputs then refuses, losing the run's verdicts.
const fs=require('fs'), path=require('path');
const A=path.join(__dirname,'..','nodes');
const VI=fs.readFileSync(path.join(A,'validate_inputs.js'),'utf8');
const SC=fs.readFileSync(path.join(A,'select_candidates.js'),'utf8');
const PH=fs.readFileSync(path.join(A,'prepare_handoff.js'),'utf8');

function run(src, nodes, inputItems){
  const $=(n)=>{ if(!(n in nodes)) throw new Error('unexpected $('+n+')');
    const a=nodes[n]; return {all:()=>a, first:()=>a[0]}; };
  const $input={ all:()=>inputItems, first:()=>inputItems[0] };
  const logs=[];
  const out=new Function('$input','$','console',src)($input,$,{log:m=>logs.push(m)});
  return {out, logs:logs.map(l=>{try{return JSON.parse(l)}catch(e){return {}}})};
}

const W=[{key:'2026-07',from:'2026-07-01',to:'2026-07-31'},
         {key:'2026-06',from:'2026-06-01',to:'2026-06-30'},
         {key:'2026-05',from:'2026-05-01',to:'2026-05-31'}];
function candidates(n){ const a=[]; for(let i=0;i<n;i++)
  a.push({case_key:'c'+i+':2026-07', contract_id:'10'+i, client_id:'20'+i}); return a; }

function baton(cands, size){ return {
  kind:'cc-below-agreed-baton', v:1, run_id:'r1', check_id:'chk',
  callback_url:'https://x/functions/v1/ta-callback/'+'0'.repeat(64),
  audit_month:'2026-07', range_start:'2026-07-01', range_end:'2026-07-31',
  persistence_windows:W, bearer:'Bearer test.token.value',
  candidates:cands, candidates_total:cands.length, batch_index:0, batch_size:size,
  stats:{}, verdicts:{processed:0, by_verdict:{}} }; }

// ---- the full hop loop -----------------------------------------------------
const TOTAL=7, SIZE=3;
let b=baton(candidates(TOTAL), SIZE);
let hop=0, seen=[], selfCalls=0, finishes=0, fail=null;
while (hop < 10) {
  hop++;
  const vi=run(VI,{},[{json:b}]);
  const validated=vi.out[0].json;
  const nodes={'Validate Inputs':[{json:validated}]};
  const sc=run(SC,nodes,[]);
  const batch=sc.out.map(i=>i.json);
  seen.push(batch.length);
  // stand in for the verify half: one verdict per case in this batch
  const merged={reviewed:batch.length, tally:{'Agent Finding - Under-billed':batch.length}, unreviewed:0};
  nodes['Merge Agent Verdicts']=[{json:merged}];
  const ph=run(PH,nodes,[]);
  const next=ph.out[0].json;
  if (next.has_more===true) { selfCalls++; b=next; }
  else { finishes++; b=next; break; }
}
console.log('batches sliced      :', seen.join(' + '), '=', seen.reduce((a,c)=>a+c,0), 'of', TOTAL);
console.log('self-calls / finishes:', selfCalls, '/', finishes);
console.log('final has_more       :', b.has_more);
console.log('final candidates left:', b.candidates.length);
console.log('verdicts accumulated :', JSON.stringify(b.verdicts));
console.log('has_more inside baton:', Object.prototype.hasOwnProperty.call(b,'has_more') ? 'present (assigned outside, expected)' : 'absent');

const checks=[
  ['every candidate sliced exactly once', seen.reduce((a,c)=>a+c,0)===TOTAL],
  ['no zero-length batch was ever sliced', seen.every(x=>x>0)],
  ['hop count is ceil(total/size)', seen.length===Math.ceil(TOTAL/SIZE)],
  ['exactly one finish, no extra self-call', finishes===1 && selfCalls===Math.ceil(TOTAL/SIZE)-1],
  ['final hop reports has_more false', b.has_more===false],
  ['tally accumulated across all hops', (b.verdicts.by_verdict['Agent Finding - Under-billed']||0)===TOTAL],
  ['processed count equals total', b.verdicts.processed===TOTAL],
];
let bad=0;
for (const [name,ok] of checks){ if(!ok) bad++; console.log((ok?'PASS  ':'FAIL  ')+name); }

// ---- the guard: a zero-candidate baton must be REFUSED, not run -------------
try {
  run(VI,{},[{json:baton([],SIZE)}]);
  console.log('FAIL  zero-candidate baton was accepted'); bad++;
} catch(e){ console.log('PASS  zero-candidate baton refused: '+e.message.slice(0,58)+'...'); }
// ---- a missing bearer must be refused (else every read 401s silently) -------
try {
  const nb=baton(candidates(2),SIZE); nb.bearer='';
  run(VI,{},[{json:nb}]);
  console.log('FAIL  baton with no bearer was accepted'); bad++;
} catch(e){ console.log('PASS  baton with no bearer refused'); }
// ---- another check's baton must not be accepted -----------------------------
try {
  const nb=baton(candidates(2),SIZE); nb.kind='cc-nonreceived-baton';
  run(VI,{},[{json:nb}]);
  console.log('FAIL  sibling check baton was accepted'); bad++;
} catch(e){ console.log('PASS  another check\'s baton refused'); }
// ---- missing persistence_windows must be refused ---------------------------
try {
  const nb=baton(candidates(2),SIZE); nb.persistence_windows=[];
  run(VI,{},[{json:nb}]);
  console.log('FAIL  baton with no windows was accepted'); bad++;
} catch(e){ console.log('PASS  baton with no persistence_windows refused'); }

console.log(bad===0 ? '\n==== all checks passed ====' : '\n==== '+bad+' FAILED ====');
