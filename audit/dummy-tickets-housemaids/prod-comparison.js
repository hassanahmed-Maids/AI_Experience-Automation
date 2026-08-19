'use strict';
/* Ports the PRODUCTION 'Classify Dummy Tickets' logic verbatim (workflow
   FXrhGBJUnGYgrs9R, node "Classify Dummy Tickets") and runs the spec's five
   test cases through it, so the rebuild's diff is measured, not asserted. */
const { scoreCase } = require('./scorer.js');

// ---- production logic, copied unchanged ----
function outcomeLabel(t){ return (t.ticketOutcome && t.ticketOutcome.label) || ''; }
function tcur(t){ const c=t.currency; if(!c) return ''; if(typeof c==='string') return c; return c.name||c.label||c.code||''; }
function normalizeDummy(t){ return {
  status:t.status||'', outcome:outcomeLabel(t),
  amount:Number(t.amount)||0,
  amount_in_aed:(typeof t.amountInAED==='number'&&!isNaN(t.amountInAED))?t.amountInAED:null,
  currency:tcur(t) }; }
function classifyDummy(d){
  const o=(d.outcome||'').toString().trim().toLowerCase();
  const s=(d.status||'').toString().trim().toLowerCase();
  if(o.includes('refunded')||s.includes('refunded')) return 'refunded';
  if(o.includes('lost')||s.includes('lost')||o.includes('fail')||s.includes('fail')) return 'financial_loss';
  if(o.includes('used')||s.includes('used')) return 'used_review';
  if(!o&&!s) return 'pending';
  return 'pending'; }
const ORDER={financial_loss:0,used_review:1,pending:2,refunded:3};
function toAed(d,rates){
  if(d.amount_in_aed!=null) return {amount_aed:d.amount_in_aed,exchange_rate_missing:false};
  const c=(d.currency||'AED').toString().toUpperCase();
  if(c==='AED'||c==='') return {amount_aed:d.amount,exchange_rate_missing:false};
  if(rates[c]!=null) return {amount_aed:d.amount*Number(rates[c]),exchange_rate_missing:false};
  return {amount_aed:null,exchange_rate_missing:true}; }
function productionClassify(tickets, rates={}){
  const dummy=tickets.filter(t=>String(t.ticketType||'').toUpperCase()==='DUMMY').map(normalizeDummy);
  let kind,rep=null,bestKind=null;
  if(dummy.length===0) kind='applicant_not_found';
  else { for(const d of dummy){ const k=classifyDummy(d); if(rep===null||ORDER[k]<ORDER[bestKind]){rep=d;bestKind=k;} } kind=bestKind; }
  const conv=rep?toAed(rep,rates):{amount_aed:null,exchange_rate_missing:false};
  return { kind, is_flagged: kind!=='refunded', amount_aed: conv.amount_aed, dummy_ticket_count: dummy.length };
}

// ---- fixtures (same as test-cases.js) ----
const T=(o)=>({id:o.id,ticketType:o.type??'DUMMY',status:o.status??'',
  ticketOutcome:o.outcome?{label:o.outcome}:undefined,
  amountInAED:o.aed===undefined?'':o.aed, amount:o.face,
  currency:o.cur?{name:o.cur}:'', requestRefundOn:o.refundOn??'',
  requestRefundAutomaticallyType:o.autoType??''});

const CASES=[
 {n:'TC1 · 1508067  single Lost',run:'2026-08-19',want:'finding',t:[
   T({id:4261989,status:'REFUND_FAILED',outcome:'Lost',aed:4674.74,face:4675,cur:'AED'})]},
 {n:'TC2 · 1697770  both refunded',run:'2026-08-19',want:'clean',t:[
   T({id:5384011,status:'REFUNDED',outcome:'Refunded',aed:4835,face:4835,cur:'AED',refundOn:'2026-05-21 00:00:00',autoType:'TwentyFourHoursBeforeDepartureTime'}),
   T({id:5335411,status:'REFUNDED',outcome:'Refunded',aed:3600,face:3600,cur:'AED',refundOn:'2026-06-02 20:25:00',autoType:'CustomTime'})]},
 {n:'TC3 · 1846842  refunded on schedule',run:'2026-08-19',want:'clean',t:[
   T({id:5297353,status:'REFUNDED',outcome:'Refunded',aed:3604.69,face:3569,cur:'SAR',refundOn:'2026-06-03 00:00:00',autoType:'CustomTime'}),
   T({id:5192074,status:'REFUNDED',outcome:'Refunded',aed:4547,face:4547,cur:'AED',refundOn:'2026-05-08 00:00:00',autoType:'CustomTime'})]},
 {n:'TC4 · 1535511  not-yet-due + zero',run:'2026-06-04',want:'pending',t:[
   T({id:5303581,status:'PENDING_REFUND',aed:4640,face:4640,cur:'AED',refundOn:'2026-06-15 00:00:00',autoType:'CustomTime'}),
   T({id:5303553,status:'CANCELED',aed:'',cur:''})]},
 {n:'TC5 · 1473519  loss behind refunds',run:'2026-08-19',want:'finding',t:[
   T({id:9000001,status:'REFUNDED',outcome:'Refunded',aed:3600,face:3600,cur:'AED'}),
   T({id:9000002,status:'REFUNDED',outcome:'Refunded',aed:290.53,face:291,cur:'AED'}),
   T({id:9000003,status:'CANCELED',aed:'',cur:''}),
   T({id:9000004,status:'REFUND_FAILED',outcome:'Lost',aed:4773.53,face:4774,cur:'AED'})]},
];

// PORTAL state, per production's "Aggregate Results" node:
//   is_flagged (kind !== 'refunded')  ->  new_state 'red_flag'   (published as a red)
//   kind === 'refunded'               ->  no case emitted        (silent pass)
// So production has NO pending state at all: a not-yet-due refund is published RED.
function productionPortalState(p){ return p.is_flagged ? 'red_flag' : 'clean'; }
function rebuiltPortalState(r){
  return { finding:'red_flag', clean:'clean', pending:'pending', verifier:'verifier' }[r.state] || r.state; }

console.log('\n  case                                  spec wants   PRODUCTION portal   REBUILT portal   prod ok?');
console.log('  ' + '-'.repeat(94));
let prodFail=0;
for(const c of CASES){
  const p=productionClassify(c.t);
  const r=scoreCase({id:1,reachable:200,tickets:c.t},{run_date:c.run,repeat_threshold:null});
  const pState=productionPortalState(p), rState=rebuiltPortalState(r);
  const wantState={finding:'red_flag',clean:'clean',pending:'pending'}[c.want];
  const ok=pState===wantState?'yes':'NO  <<';
  if(ok!=='yes') prodFail++;
  console.log('  '+c.n.padEnd(38)+wantState.padEnd(13)+(pState+' ('+p.kind+')').padEnd(20)+rState.padEnd(17)+ok);
}
console.log(`\n  production fails ${prodFail} of ${CASES.length} spec test cases at the portal level.`);

console.log('\n  What production publishes for each live status (no gate 50/90/100 exists):');
for(const s of ['REFUNDED','REFUND_FAILED','REFUND_SENT_TO_PAYERS','PENDING_REFUND','ISSUED','CANCELED','REQUESTED']){
  const k=classifyDummy({status:s,outcome:''});
  const flagged=k!=='refunded';
  console.log(`    ${s.padEnd(24)} -> ${k.padEnd(16)} ${flagged?'PUBLISHED RED':'silent pass'}`);
}

console.log('\n  Zero-amount CANCELED-only case (the 154-case slice):');
const zc=[T({id:1,status:'CANCELED',aed:'',cur:''})];
const zp=productionClassify(zc), zr=scoreCase({id:1,reachable:200,tickets:zc},{run_date:'2026-08-19',repeat_threshold:null});
console.log(`    production -> ${productionPortalState(zp)} (${zp.kind}), amount_aed=${zp.amount_aed}`);
console.log(`    rebuilt    -> ${rebuiltPortalState(zr)} (${zr.verdict}), exposure=${zr.exposure_aed}`);

console.log('\n  Unreachable applicant (ERP 500, applicant 132244):');
const up=productionClassify([]);
const ur=scoreCase({id:132244,reachable:500,tickets:[]},{run_date:'2026-08-19',repeat_threshold:null});
console.log(`    production -> ${productionPortalState(up)} (${up.kind})  <- an outage published as a red flag about a person`);
console.log(`    rebuilt    -> ${rebuiltPortalState(ur)} (${ur.verdict})`);
