// Gate 2 (Verify Bulk Pulls) population block, tested against the real envelope
// and against every way a short walk can try to pass.
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','nodes','Verify_Bulk_Pulls.js'),'utf8');
const real=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture_active_pop.json'),'utf8'));
const TOTAL=real.total;

function page(n,total){ // a synthetic page of n rows declaring `total`
  const rows=[]; for(let i=0;i<n;i++) rows.push({id:'c'+i,startOfContract:'2025-01-01',
    client:{id:'1',name:'x'},housemaid:{id:'2',label:'y'},status:'ACTIVE',
    contractProspectType:{code:'maids.cc_prospect'}});
  return {json:{clients:{content:rows,size:100,totalPages:1,last:true},total:total}};
}
function walk(nPages,lastSize,total){ const a=[];
  for(let i=0;i<nPages-1;i++) a.push(page(40,total)); a.push(page(lastSize,total)); return a; }

function run(popPages,label){
  const validated={audit_month:'2026-07',range_start:'2026-07-01',range_end:'2026-07-31',
    params:{},persistence_windows:[{key:'2026-07',from:'2026-07-01',to:'2026-07-31',node:'Get Month Payments'},
      {key:'2026-06',from:'2026-06-01',to:'2026-06-30',node:'Get Payments (M-1)'},
      {key:'2026-05',from:'2026-05-01',to:'2026-05-31',node:'Get Payments (M-2)'}]};
  const pay=[{json:{payments:[{contractID:'c0',contractType:'CC',paymentAmount:1,paymentDate:'2026-07-05',paymentType:'Monthly Payment',paymentId:1}]}}];
  const nodes={'Validate Inputs':[{json:validated}],'Get CC Contract Population':popPages,
    'Get Month Payments':pay,'Get Payments (M-1)':pay,'Get Payments (M-2)':pay,
    'Get Payment Statuses':[{json:{content:[{id:1}],totalElements:1,totalPages:1,last:true}}],
    'Get Terminated Contracts':[{json:{clients:{content:[]},total:0}}]};
  const $=(n)=>{ if(!(n in nodes)) throw new Error('unexpected $('+n+')');
    const a=nodes[n]; return {all:()=>a, first:()=>a[0]}; };
  const logs=[];
  try{
    new Function('$input','$','console',SRC)({all:()=>[]},$,{log:m=>logs.push(m)});
    console.log('PASSED GATE  '+label);
    const l=logs.map(x=>{try{return JSON.parse(x)}catch(e){return{}}}).pop()||{};
    return {ok:true,log:l};
  }catch(e){
    console.log('BLOCKED      '+label+'\n               -> '+e.message.split('.')[0].slice(0,110));
    return {ok:false,msg:e.message};
  }
}
const full=Math.ceil(TOTAL/40);
console.log('declared total='+TOTAL+', so a complete walk is '+full+' pages (last page '+(TOTAL-40*(full-1))+' rows)\n');
run(walk(full, TOTAL-40*(full-1), TOTAL), 'complete walk, last page short  <- MUST PASS');
run(walk(full-1, 40, TOTAL),            'walk ends on a FULL page (hit maxRequests)  <- must block');
run(walk(54, 40, TOTAL),                'trusted size=100 -> 54 pages x 40 = 2,160 rows  <- must block');
run([{json:{clients:{content:real.clients.content,size:100,totalPages:1,last:true},total:TOTAL}}],
                                         'ONE page, envelope says last=true  <- must block');
run(walk(full, TOTAL-40*(full-1), TOTAL+10), 'total grew 10 mid-walk (concurrent change)  <- MUST PASS');
run(walk(full, TOTAL-40*(full-1), TOTAL+200),'declared 200 higher than collected  <- must block');
run([{json:{status:500,message:'SecurityException: Access denied.'}}], 'ERP error body  <- must block');
