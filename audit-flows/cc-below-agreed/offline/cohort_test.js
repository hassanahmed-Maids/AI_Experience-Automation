// Test the patched Build Cohort SOURCE A parser against the REAL contract/search/page
// response captured live on 2026-08-18, plus the dynamic route's flat shape, plus the
// failure shapes. Only source A is exercised; sources B/C are stubbed empty except the
// envelope source C requires.
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','nodes','Build_Cohort.js'),'utf8');
const real=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture_active_pop.json'),'utf8'));

function run(popPages, label){
  const validated={audit_month:'2026-07',range_start:'2026-07-01',range_end:'2026-07-31',
    persistence_windows:[{key:'2026-07',from:'2026-07-01',to:'2026-07-31'}]};
  const nodes={
    'Validate Inputs':[{json:validated}],
    'Get CC Contract Population':popPages,
    // source C must return a readable envelope or the node refuses (by design)
    'Get Terminated Contracts':[{json:{clients:{content:[]}}}],
    'Get Payment Statuses':[{json:{content:[]}}],
    'Get Month Payments':[{json:{payments:[]}}],
  };
  const $=(n)=>{ if(!(n in nodes)) throw new Error('unexpected $('+n+')');
    const a=nodes[n]; return {all:()=>a, first:()=>a[0]}; };
  const logs=[];
  const out=new Function('$input','$','console',SRC)({all:()=>[]},$,{log:m=>logs.push(m)});
  const summary=JSON.parse(logs[logs.length-1]);
  console.log('--- '+label);
  console.log('    cohort items: '+out.length+
    '  | pop rows: '+(summary.population_rows!==undefined?summary.population_rows:summary.pop_rows||'?'));
  console.log('    log: '+JSON.stringify(summary).slice(0,300));
  return {out,summary};
}

// 1. the REAL nested response, one page
run([{json:real}], 'REAL contract/search/page page (live capture)');

// 2. wrapped in fullResponse form, as n8n delivers it when fullResponse:true
run([{json:{body:real}}], 'same page under fullResponse {body:...}');

// 3. the dynamic route's flat camelCase shape - must still parse (grant restored)
const flat=[{contractId:'900001',clientId:'5',clientName:'X',maidId:'7',maidName:'Y',
  maidLiveOut:true,contractStatus:'ACTIVE',startDate:'2025-03-01',scheduledDateOfTermination:null}];
run([{json:{body:flat}}], 'dynamic route flat shape (grant restored)');

// 4. an MV row alongside a GOOD row: the MV one must drop, the good one survive
const good=real.clients.content[0];
const mv=JSON.parse(JSON.stringify(real));
mv.clients.content=[good, Object.assign({},good,{id:'999901',
  contractProspectType:{code:'maidvisa.ae_prospect'}})];
{const r=run([{json:mv}],'MV row beside a good row -> MV dropped, good kept');
 console.log('    ASSERT cohort==1 && dropped.mv==1 :',
   r.out.length===1 && r.summary.dropped && r.summary.dropped.mv===1 ? 'PASS' : 'FAIL '+JSON.stringify(r.summary.dropped));}

// 5. a row with no start date must be HELD - never dropped, never audited
const ns=JSON.parse(JSON.stringify(real));
ns.clients.content=[good, Object.assign({},good,{id:'999902',startOfContract:null})];
{const r=run([{json:ns}],'missing start date beside a good row -> held');
 const held=r.summary.held_for_human!==undefined?r.summary.held_for_human:r.summary.held;
 console.log('    ASSERT cohort==1 && held==1 :',
   r.out.length===1 && held===1 ? 'PASS' : 'FAIL cohort='+r.out.length+' held='+JSON.stringify(held));}

// 6. size=100 echoed while only 40 rows arrive - the trap that would audit 40% of the book.
// The parser must count what ARRIVED (40), never what the envelope claims.
const lying=JSON.parse(JSON.stringify(real));
lying.clients.size=100; lying.clients.totalPages=1; lying.clients.last=true;
{const r=run([{json:lying}],'envelope claims size=100/totalPages=1/last=true');
 console.log('    ASSERT counted 40 actual rows, not the claim :',
   r.summary.population_rows_seen===40 ? 'PASS' : 'FAIL '+r.summary.population_rows_seen);}

// 7. an ERP error body instead of contracts must NOT yield a quiet empty cohort
try{ run([{json:{status:500,message:'SecurityException: Access denied.'}}],'ERP error body instead of contracts');
     console.log('    FAIL - did not refuse'); }
catch(e){ console.log('--- ERP error body instead of contracts');
          console.log('    THREW, which is correct: '+e.message.slice(0,88)); }
