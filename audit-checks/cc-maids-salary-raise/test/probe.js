#!/usr/bin/env node
'use strict';
/**
 * Phase 2 probe harness — one probe per surface the check needs, before any logic runs live.
 *
 * Usage:   ERP_BEARER='Bearer eyJ...' ERP_DEVICE_ID='12345' node test/probe.js
 *
 * The token is taken from the ENVIRONMENT and is never written to disk, never logged, and never
 * placed in a stored credential. Nothing in this file prints an amount, a name or a contact
 * detail — when confirming a field exists it reports the KEY PATH, never the value.
 *
 * Pacing: production ERP. Serial, 2.0 s between calls per the standing instruction of 2026-08-20.
 * This is the endpoint class that got the ERP account disabled in June 2026.
 */

const https = require('https');
const BASE = 'erpbackendpro.maids.cc';
const BEARER = process.env.ERP_BEARER || '';
const DEVICE = process.env.ERP_DEVICE_ID || '';
const PACE_MS = 2000;

if (!/^Bearer\s+\S+/.test(BEARER) || !/^\d+$/.test(DEVICE)) {
  console.error('Set ERP_BEARER ("Bearer eyJ...") and ERP_DEVICE_ID (numeric). Nothing was sent.');
  process.exit(2);
}

// Decode the token locally so an expired one is named as expired rather than reported as a
// server error. A dead token produces the 498-inside-500 shape, NOT a 401.
try {
  const claims = JSON.parse(Buffer.from(BEARER.replace(/^Bearer\s+/, '').split('.')[1], 'base64').toString('utf8'));
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    console.error('That token is expired (exp ' + new Date(claims.exp * 1000).toISOString() + '). Nothing was sent.');
    process.exit(2);
  }
  if (claims.device && String(claims.device) !== DEVICE) {
    console.error('ERP_DEVICE_ID does not match the bearer\'s device claim. Nothing was sent.');
    process.exit(2);
  }
  console.log('token: valid, acting user claim present=' + Boolean(claims.user) +
              ', exp ' + new Date(claims.exp * 1000).toISOString());
} catch (e) {
  console.error('Bearer is not a decodable JWT. Nothing was sent.');
  process.exit(2);
}

function call(method, path, pagecode, body) {
  return new Promise(resolve => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      host: BASE, path, method,
      headers: Object.assign({
        pagecode,
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        origin: 'https://erp.maids.cc',
        referer: 'https://erp.maids.cc/',
        authorization: BEARER,
        cookie: 'authTokenProduction=' + BEARER.replace(/^Bearer\s+/, '') + '; deviceIdProduction=' + DEVICE
      }, payload ? { 'content-length': Buffer.byteLength(payload) } : {})
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch (e) { /* keep null */ }
        resolve({
          status: res.statusCode,
          developermessage: res.headers.developermessage || res.headers.developerMessage || null,
          body: parsed,
          raw_len: d.length
        });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.setTimeout(90000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Classify a failure into one of the three denial shapes — they need different asks of different owners. */
function classify(r) {
  if (r.status === 0) return 'TRANSPORT (' + r.error + ')';
  if (r.status >= 200 && r.status < 300) return 'OK';
  const dm = String(r.developermessage || '');
  const bodyMsg = JSON.stringify(r.body || {}).slice(0, 200);
  if (r.status === 500 && /498/.test(bodyMsg)) return 'DEAD TOKEN (498-inside-500)';
  if (r.status === 401 && /INSUFFICIENT_PERMISSIONS/i.test(dm + bodyMsg)) return 'INSUFFICIENT_PERMISSIONS (role-gated)';
  if (r.status === 401 && /SecurityException/i.test(dm + bodyMsg)) return 'SecurityException (wrong pagecode?)';
  if (r.status === 401) return 'HTTP 401 — undifferentiated; check developermessage';
  if (r.status === 400) return 'HTTP 400 (may be a real answer, e.g. "No Rule is found!")';
  return 'HTTP ' + r.status;
}

/** Reports SHAPE only — key paths, counts, types. Never a value. */
function shape(v, depth) {
  const d = depth === undefined ? 0 : depth;
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array[' + v.length + ']' + (v.length && d < 2 ? '<' + shape(v[0], d + 1) + '>' : '');
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (d >= 2) return 'object{' + keys.length + ' keys}';
    return '{' + keys.slice(0, 14).map(k => k + ':' + shape(v[k], d + 1)).join(', ') +
           (keys.length > 14 ? ', …+' + (keys.length - 14) : '') + '}';
  }
  return typeof v;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Known-good ids from the spec's own verified test cases.
const TEST_MAID = 3978;

const PROBES = [
  { name: 'population (CC only, size=40, page 0)', method: 'POST', pagecode: 'HousemaidsPayrollList',
    path: '/payroll/HousemaidPayroll/filterHousemaids?page=0&size=40',
    body: { maidPayrollTypes: ['MAID_CC'] },
    blocker: true, why: 'no population = no run' },

  { name: 'population — WRONG pagecode control', method: 'POST', pagecode: 'HousemaidList',
    path: '/payroll/HousemaidPayroll/filterHousemaids?page=0&size=40',
    body: { maidPayrollTypes: ['MAID_CC'] },
    blocker: false, why: 'separates a wrong pagecode from a missing permission — both return 401' },

  { name: 'salary rule for one maid', method: 'GET', pagecode: 'HousemaidsPayrollList',
    path: '/payroll/salaryrules/getruleofhousemaid/' + TEST_MAID,
    blocker: true, why: 'the per-maid standard; a 400 "No Rule is found!" is a REAL answer' },

  { name: 'salary rule — documented-wrong pagecode control', method: 'GET', pagecode: 'payroll_salary-rules-management',
    path: '/payroll/salaryrules/getruleofhousemaid/' + TEST_MAID,
    blocker: false, why: 'the variable row says this 401s here and looks like a dead token' },

  { name: 'payroll history (12 months)', method: 'GET', pagecode: 'HousemaidsPayrollHistory',
    path: '/payroll/HousemaidPayroll/' + TEST_MAID + '/getHistoryLog?monthsCount=12',
    blocker: true, why: 'the paid figure for the audited month' },

  { name: 'maid profile (nationality tags, liveOut)', method: 'GET', pagecode: 'HousemaidDetails',
    path: '/staffmgmt/housemaid/getHousemaidInfo/' + TEST_MAID,
    blocker: true, why: 'renewal_raise tag and living status' },

  { name: 'renew-request documents (renewal count)', method: 'GET', pagecode: 'HousemaidDocuments',
    path: '/visa/renewRequest/housemaidProfile/documents/' + TEST_MAID,
    blocker: true, why: 'r-visa upload dates — the renewal count' },

  { name: 'complaints for one maid (evidence sweep, page 0)', method: 'GET', pagecode: 'HousemaidComplaints',
    path: '/complaints/complaint/limited/housemaid/' + TEST_MAID + '?page=0&size=20',
    blocker: true, why: 'the evidence sweep; defaults to size=20 and this maid has 96' },

  { name: 'renew request raiseApproved (corroboration only)', method: 'GET', pagecode: 'VisaProcessingPage',
    path: '/visa/renewRequest/housemaid/' + TEST_MAID,
    blocker: false, why: 'empty on 14 of 14 — corroborates when present, never clears when absent' },

  { name: 'the bulk route the spec asks for (expected 401)', method: 'GET', pagecode: 'HousemaidsPayrollList',
    path: '/payroll/payrollAuditTodo/getMaidsSalariesOverNationalitiesTodo/1',
    blocker: false, why: 'role-gated; would collapse the whole fan-out if granted' }
];

(async () => {
  const results = [];
  for (const p of PROBES) {
    const r = await call(p.method, p.path, p.pagecode, p.body);
    const verdict = classify(r);
    results.push({ p, r, verdict });
    console.log('\n─ ' + p.name);
    console.log('  ' + p.method + ' ' + p.path.split('?')[0] + '   pagecode=' + p.pagecode);
    console.log('  → ' + r.status + '  ' + verdict);
    if (r.developermessage) console.log('  developermessage: ' + String(r.developermessage).slice(0, 160));
    if (r.body) {
      console.log('  shape: ' + shape(r.body).slice(0, 700));
      if (r.body && typeof r.body.totalElements === 'number') {
        console.log('  totalElements: ' + r.body.totalElements +
                    '  content: ' + (Array.isArray(r.body.content) ? r.body.content.length : 'n/a'));
      }
    }
    await sleep(PACE_MS);
  }

  console.log('\n' + '='.repeat(78));
  console.log('SURFACE'.padEnd(46) + 'STATUS'.padEnd(8) + 'BLOCKER');
  console.log('='.repeat(78));
  for (const x of results) {
    console.log(x.p.name.slice(0, 45).padEnd(46) +
                String(x.r.status).padEnd(8) +
                (x.verdict === 'OK' ? '—' : (x.p.blocker ? 'YES — no run without it' : 'no — degrades only')));
  }
  const blocked = results.filter(x => x.verdict !== 'OK' && x.p.blocker &&
                                      !/No Rule is found/i.test(JSON.stringify(x.r.body || {})));
  console.log('\n' + (blocked.length
    ? blocked.length + ' BLOCKING surface(s) unreadable — the check cannot run as specced.'
    : 'All blocking surfaces readable.'));
})();
