// Attach Month Payments, tested against ADVANCESEARCH-SHAPED rows.
//
// The bug this exists to catch: the status row's type sits at typeOfPayment.NAME, the
// code read .label/.value, so `type` was '' on every advancesearch row. Because a
// status row OVERRIDES the bulk row for the same payment_id, the correctly-typed bulk
// row was discarded too - so monthly_net collapsed toward zero, the money moved into
// other_received, and refunds went undetected. That destroys the monthly-vs-other
// split gate 8 depends on and can CLEAR a contract whose monthly was never paid.
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','nodes','Attach_Month_Payments.js'),'utf8');

const W=[{key:'2026-07',from:'2026-07-01',to:'2026-07-31',node:'Get Month Payments'},
         {key:'2026-06',from:'2026-06-01',to:'2026-06-30',node:'Get Payments (M-1)'},
         {key:'2026-05',from:'2026-05-01',to:'2026-05-31',node:'Get Payments (M-2)'}];

// a bulk row: flat, paymentType is a plain string
function bulk(id,type,amt,date){ return {paymentId:id,paymentType:type,paymentAmount:amt,paymentDate:date,
  contractID:'900001',contractType:'CC',paymentMethod:'Card'}; }
// an advancesearch row: the REAL shape - typeOfPayment{code,id,name}, methodOfPayment{label,value},
// status{label,value}, amountOfPayment, dateOfPayment, nested contract
function adv(id,name,amt,date,status){ return {id:id,amountOfPayment:amt,dateOfPayment:date,
  status:{label:status==='RECEIVED'?'Received':status,value:status},
  typeOfPayment:{code:name.toLowerCase().replace(/[^a-z]+/g,'_'),id:1,name:name},
  methodOfPayment:{label:'Card',value:'CARD'}, replaced:false,
  contract:{id:'900001',status:'ACTIVE',startOfContract:'2025-01-01',
            client:{id:'5',name:'REDACTED'},housemaid:{id:'7',label:'REDACTED'},
            contractProspectType:{code:'maids.cc_prospect'}}}; }

function run(bulkRows,advRows){
  const validated={persistence_windows:W,audit_month:'2026-07',
    range_start:'2026-07-01',range_end:'2026-07-31',params:{}};
  const nodes={'Validate Inputs':[{json:validated}],
    'Get Month Payments':[{json:{payments:bulkRows}}],
    'Get Payments (M-1)':[{json:{payments:[]}}],
    'Get Payments (M-2)':[{json:{payments:[]}}],
    'Get Payment Statuses':[{json:{content:advRows,totalElements:advRows.length,totalPages:1}}]};
  const $=(n)=>{ if(!(n in nodes)) throw new Error('unexpected $('+n+')');
    const a=nodes[n]; return {all:()=>a, first:()=>a[0]}; };
  const cohort=[{json:{case_key:'900001:2026-07',contract_id:'900001',client_id:'5'}}];
  const $input={all:()=>cohort};
  const out=new Function('$input','$','console',SRC)($input,$,{log:()=>{}});
  return out[0].json.months['2026-07'];
}
function show(label,m,expect){
  const got={monthly:m.monthly_net,other:m.other_received,refundMp:m.refund_mp_reversing,inflight:m.in_flight};
  const ok=Object.keys(expect).every(k=>got[k]===expect[k]);
  console.log((ok?'PASS  ':'FAIL  ')+label);
  console.log('        expected '+JSON.stringify(expect));
  console.log('        got      '+JSON.stringify(got));
  return ok;
}
let bad=0;
// 1. THE CORE CASE: the same Monthly Payment in BOTH sweeps. The status row overrides
//    the bulk row, so if its type is lost the money leaves monthly_net entirely.
if(!show('Monthly Payment in both sweeps (status overrides bulk)',
  run([bulk(1,'Monthly Payment',5000,'2026-07-05')],
      [adv(1,'Monthly Payment',5000,'2026-07-05','RECEIVED')]),
  {monthly:5000,other:0})) bad++;

// 2. a non-monthly charge must land in other_received, NOT in monthly_net
if(!show('non-monthly charge stays in other_received',
  run([bulk(2,'Service charge',2200,'2026-07-06')],
      [adv(2,'Service charge',2200,'2026-07-06','RECEIVED')]),
  {monthly:0,other:2200})) bad++;

// 3. an MP-reversing refund must be DETECTED and netted off monthly
if(!show('MP-reversing refund detected and netted',
  run([bulk(3,'Monthly Payment',10000,'2026-07-05'),bulk(4,'MP refunded to the client',5000,'2026-07-20')],
      [adv(3,'Monthly Payment',10000,'2026-07-05','RECEIVED'),
       adv(4,'MP refunded to the client',5000,'2026-07-20','RECEIVED')]),
  {monthly:5000,refundMp:5000})) bad++;

// 4. the split case: monthly + a second charge, both preserved separately so the
//    scorer's gap-completion can judge it
if(!show('split collection keeps monthly and other SEPARATE',
  run([bulk(5,'Monthly Payment',2252,'2026-07-05'),bulk(6,'Service charge',2200,'2026-07-05')],
      [adv(5,'Monthly Payment',2252,'2026-07-05','RECEIVED'),
       adv(6,'Service charge',2200,'2026-07-05','RECEIVED')]),
  {monthly:2252,other:2200})) bad++;

// 5. the OVERRIDE MUST STILL WORK: a bulk row whose advancesearch status is DELETED
//    must stop counting. This is why status overrides bulk in the first place.
if(!show('DELETED status removes a bulk-received row',
  run([bulk(7,'Monthly Payment',5000,'2026-07-05')],
      [adv(7,'Monthly Payment',5000,'2026-07-05','DELETED')]),
  {monthly:0,other:0})) bad++;

// 6. in-flight (PRE_PDP) must be counted as in_flight, never as received
if(!show('PRE_PDP counted as in flight, not received',
  run([], [adv(8,'Monthly Payment',305,'2026-07-05','PRE_PDP')]),
  {monthly:0,other:0,inflight:305})) bad++;

console.log(bad===0 ? '\n==== all '+6+' checks passed ====' : '\n==== '+bad+' FAILED ====');
