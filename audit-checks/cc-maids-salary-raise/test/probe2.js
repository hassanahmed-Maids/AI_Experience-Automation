'use strict';
/**
 * Phase 2, round two. Narrows the round-one denials: is the refusal the PAGECODE or the
 * PERMISSION, how wide is it, and what the population row actually carries.
 * Token from the environment. Reports key paths and counts only, never values.
 */
const https=require('https');
const BASE='erpbackendpro.maids.cc';
const BEARER=process.env.ERP_BEARER, DEVICE=process.env.ERP_DEVICE_ID;
function call(method,path,pagecode,body){return new Promise(res=>{
 const p=body===undefined?null:JSON.stringify(body);
 const r=https.request({host:BASE,path,method,headers:Object.assign({pagecode,accept:'application/json, text/plain, */*','content-type':'application/json',origin:'https://erp.maids.cc',referer:'https://erp.maids.cc/',authorization:BEARER,cookie:'authTokenProduction='+BEARER.replace(/^Bearer /,'')+'; deviceIdProduction='+DEVICE},p?{'content-length':Buffer.byteLength(p)}:{})},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{let j=null;try{j=JSON.parse(d)}catch(e){}res({status:x.statusCode,dm:x.headers.developermessage||null,body:j})})});
 r.on('error',e=>res({status:0,error:e.message}));r.setTimeout(90000,()=>{r.destroy();res({status:0,error:'timeout'})});
 if(p)r.write(p);r.end();});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M=3978;
(async()=>{
 console.log('### A. getHistoryLog across pagecodes — the pagecode or the permission?');
 for(const pc of ['HousemaidsPayrollHistory','HousemaidsPayrollList','HousemaidDetails','HousemaidPayroll','payroll_housemaid-payroll','HousemaidsPayrollLoans','StaffPayrollPayroll']){
   const r=await call('GET','/payroll/HousemaidPayroll/'+M+'/getHistoryLog?monthsCount=12',pc);
   console.log('  '+pc.padEnd(32)+' -> '+r.status+'  '+(r.dm||''));
   await sleep(2000);
 }
 console.log('\n### B. Sibling payroll routes — how wide is the denial?');
 for(const x of [
   ['/payroll/loans/getHousemaidLoans/'+M,'HousemaidsPayrollLoans','loans (payroll, per-maid)'],
   ['/payroll/salaryrules/advancesearch/page?page=0&size=5','payroll_salary-rules-management','salary rules list']
 ]){
   const r=await call('GET',x[0],x[1]);
   console.log('  '+x[2].padEnd(38)+' -> '+r.status+'  '+(r.dm||''));
   await sleep(2000);
 }
 console.log('\n### C. Population row contents and the real CC count');
 const pop=await call('POST','/payroll/HousemaidPayroll/filterHousemaids?page=0&size=40','HousemaidsPayrollList',{maidPayrollTypes:['MAID_CC']});
 const row=(pop.body&&pop.body.content&&pop.body.content[0])||{};
 console.log('  row keys: '+Object.keys(row).join(', '));
 console.log('  basicSalary inline: '+Object.prototype.hasOwnProperty.call(row,'basicSalary'));
 console.log('  nationality inline: '+Object.prototype.hasOwnProperty.call(row,'nationality'));
 console.log('  status inline: '+Object.prototype.hasOwnProperty.call(row,'status'));
 console.log('  MAID_CC unfiltered totalElements: '+(pop.body||{}).totalElements);
 const st={}; for(const r of (pop.body&&pop.body.content)||[]) st[r.status]=(st[r.status]||0)+1;
 console.log('  statuses on page 0: '+JSON.stringify(st));
 await sleep(2000);
 console.log('\n### D. Does a status filter narrow it? (spec says 7,752 non-terminated)');
 for(const s of [['WITH_CLIENT'],['WITH_CLIENT','TRACKED','AVAILABLE','LANDED_IN_DUBAI','PENDING_FOR_DISCIPLINE','ON_VACATION']]){
   const r=await call('POST','/payroll/HousemaidPayroll/filterHousemaids?page=0&size=40','HousemaidsPayrollList',{maidPayrollTypes:['MAID_CC'],status:s});
   console.log('  status='+JSON.stringify(s).slice(0,64)+' -> '+r.status+'  total='+((r.body||{}).totalElements));
   await sleep(2000);
 }
})();
