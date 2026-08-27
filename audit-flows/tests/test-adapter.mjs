import fs from 'fs';
const run = new Function('$json', fs.readFileSync(process.argv[2],'utf8'));

// Replays the scorer's own guard verbatim, so each case is judged by its real downstream effect.
const scorerSees = (out) => {
  const led = out || {};
  const ledStatus = led.statusCode === undefined ? null : led.statusCode;
  const ledBody = led.body || {};
  const rows2 = Array.isArray(ledBody.content) ? ledBody.content : [];
  const totalEl = ledBody.totalElements;
  return { rows: rows2.length, complete: ledStatus === 200 && typeof totalEl === 'number' && rows2.length === totalEl };
};
// Replays Chunk Summary's classifier, to prove the breaker can still see a dead session.
const breakerSees = (out) => {
  const j = out || {}, st = j.statusCode;
  const txt = typeof j.body === 'string' ? j.body : JSON.stringify(j.body || '');
  if (st === 200) return 'ok';
  if (st === 502 || st === 503 || st === 504) return 'unavailable';
  if (/<LOGOUT>|UNAUTHENTICATED/i.test(txt)) return 'sessionInactive';
  if (typeof st === 'number' && st >= 500 && /498|malformed|Access Token/i.test(txt)) return 'sessionInactive';
  if (st === 401 || st === 403) return 'denied';
  return 'other';
};
const P = [{id:1},{id:2},{id:3}];
const cases = [
  ['200 + bare list (the expected new shape)', {statusCode:200, body:P},
    r => r.ledgerShape==='list' && scorerSees(r).rows===3 && scorerSees(r).complete===true],
  ['200 + empty list (contract with no payments)', {statusCode:200, body:[]},
    r => scorerSees(r).rows===0 && scorerSees(r).complete===true],
  ['200 + page envelope, consistent (route still pages)', {statusCode:200, body:{content:P,totalElements:3}},
    r => r.ledgerShape==='page-envelope' && scorerSees(r).complete===true],
  ['200 + page envelope, TRUNCATED -> guard must still catch it', {statusCode:200, body:{content:P,totalElements:9}},
    r => scorerSees(r).complete===false],
  ['200 + {payments:[...]}', {statusCode:200, body:{payments:P}},
    r => r.ledgerShape==='list-under-payments' && scorerSees(r).complete===true],
  ['200 + shape nobody predicted -> never a silent pass', {statusCode:200, body:{weird:true}},
    r => r.ledgerShape==='unrecognised' && scorerSees(r).complete===false],
  ['401 + <LOGOUT> -> breaker MUST still see a dead session', {statusCode:401, body:'UNAUTHORIZED <LOGOUT>'},
    r => breakerSees(r)==='sessionInactive' && scorerSees(r).complete===false],
  ['500 + Access Token malformed -> dead session', {statusCode:500, body:'Access Token is missing or malformed <LOGOUT>'},
    r => breakerSees(r)==='sessionInactive'],
  ['403 plain -> denied (permission gap, e.g. payments,search missing)', {statusCode:403, body:'forbidden'},
    r => breakerSees(r)==='denied' && scorerSees(r).complete===false],
  ['503 -> module unavailable', {statusCode:503, body:'<html>503</html>'},
    r => breakerSees(r)==='unavailable'],
];
let pass=0, fail=0;
for (const [name, input, check] of cases) {
  let out, ok=false, err=null;
  try { out = run(input).json; ok = check(out); } catch(e){ err=e.message; }
  const s = out ? scorerSees(out) : {};
  if (ok) { pass++; console.log('  PASS  '+name); }
  else { fail++; console.log('  FAIL  '+name+(err?('  [threw '+err+']'):('  -> shape='+out.ledgerShape+' rows='+s.rows+' complete='+s.complete+' breaker='+breakerSees(out)))); }
}
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
