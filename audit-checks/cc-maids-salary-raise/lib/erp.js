'use strict';
/**
 * Shared ERP call helper for the probe scripts.
 *
 * Credentials are read from the repo-root `.env` ONLY (project rule: "Secrets live in .env
 * only. Never paste tokens/passwords into prompts, agent files, or docs."). Nothing here writes
 * a token to disk, to a log, or to a stored n8n credential — the built flow takes the operator's
 * token as a runtime payload per run and holds no ERP credential of its own.
 *
 * Pacing: 2.0 s serial, per the standing instruction of 2026-08-20. This is the endpoint class
 * that got the ERP account disabled in June 2026.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'erpbackendpro.maids.cc';
const PACE_MS = 2000;

function loadEnv() {
  const p = path.resolve(__dirname, '../../../.env');
  const out = {};
  if (!fs.existsSync(p)) throw new Error('.env not found at repo root — nothing was sent.');
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const ENV = loadEnv();
const BEARER = ENV.ERP_BEARER || '';
const DEVICE = ENV.ERP_DEVICE_ID || '';

if (!/^Bearer\s+\S+/.test(BEARER) || !/^\d+$/.test(DEVICE)) {
  throw new Error('ERP_BEARER / ERP_DEVICE_ID missing or malformed in .env — nothing was sent.');
}

/**
 * Decode locally so an expired token is NAMED as expired rather than reported as a server error.
 * A dead token produces the 498-inside-500 shape, not a 401.
 */
function assertTokenLive() {
  const claims = JSON.parse(Buffer.from(BEARER.replace(/^Bearer\s+/, '').split('.')[1], 'base64').toString('utf8'));
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new Error('That token is expired (exp ' + new Date(claims.exp * 1000).toISOString() + '). Nothing was sent.');
  }
  if (claims.device && String(claims.device) !== DEVICE) {
    throw new Error('ERP_DEVICE_ID does not match the bearer device claim. Nothing was sent.');
  }
  return { user: claims.user, exp: new Date(claims.exp * 1000).toISOString() };
}

function call(method, path_, pagecode, body) {
  return new Promise(res => {
    const p = body === undefined ? null : JSON.stringify(body);
    const r = https.request({
      host: BASE, path: path_, method,
      headers: Object.assign({
        pagecode,
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        origin: 'https://erp.maids.cc',
        referer: 'https://erp.maids.cc/',
        authorization: BEARER,
        cookie: 'authTokenProduction=' + BEARER.replace(/^Bearer\s+/, '') + '; deviceIdProduction=' + DEVICE
      }, p ? { 'content-length': Buffer.byteLength(p) } : {})
    }, x => {
      let d = '';
      x.on('data', c => d += c);
      x.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) {}
        res({ status: x.statusCode, dm: x.headers.developermessage || null, body: j, raw: d.slice(0, 300) });
      });
    });
    r.on('error', e => res({ status: 0, error: e.message }));
    r.setTimeout(90000, () => { r.destroy(); res({ status: 0, error: 'timeout' }); });
    if (p) r.write(p);
    r.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms === undefined ? PACE_MS : ms));

/** Reports SHAPE only — key paths, counts, types. Never a value. */
function shape(v, depth) {
  const d = depth === undefined ? 0 : depth;
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array[' + v.length + ']' + (v.length && d < 2 ? '<' + shape(v[0], d + 1) + '>' : '');
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (d >= 2) return 'object{' + keys.length + ' keys}';
    return '{' + keys.slice(0, 14).map(k => k + ':' + shape(v[k], d + 1)).join(', ') +
           (keys.length > 14 ? ', ...+' + (keys.length - 14) : '') + '}';
  }
  return typeof v;
}

module.exports = { BASE, PACE_MS, call, sleep, shape, assertTokenLive };
