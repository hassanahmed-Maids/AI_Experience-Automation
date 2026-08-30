#!/usr/bin/env node
// Extract the auto-derivable sections of a prod-deployment ticket from a saved n8n
// workflow JSON (the payload `get_workflow_details detailLevel:"full"` returns).
//
//   node extract-flow-facts.mjs <workflow.json> [more.json ...]
//
// Emits Markdown for: Inputs & data sources, Trigger & schedule, Attachments,
// Credentials used, and the load facts for "Expected number of executions per day".
// It never invents a number: anything it cannot read is printed as a TODO the human fills.

import { readFileSync } from 'node:fs';

const BANNED = [
  '/clientmgmt/contract/search/page',
  '/accounting/payments/page/advancesearch',
  '/accounting/transactions/page/advancesearchNew',
  '/accounting/visarequestexpense/advanceSearch/page',
  '/payroll/HousemaidPayroll/filterHousemaids',
  '/staffmgmt/housemaid/all',
  '/payroll/salaryrules/advancesearch/page',
  '/staffmgmt/housemaid/getMaidInInitialMedicalScreen',
  '/complaints/complaint/page/client',
];

// A page envelope in the response is what makes a route paginated — the path alone is
// necessary, not sufficient (2026-08-25 ban doc). Flag both signals separately.
const PAGEY = /(\?|&)page=|\/page\/|[?&]size=|advancesearch/i;

function load(p) {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return raw.workflow ?? raw;
}

function urlOf(node) {
  const u = node.parameters?.url;
  if (typeof u === 'string') return u;
  if (u && typeof u === 'object') return JSON.stringify(u);
  return '';
}

function methodOf(node) {
  return (node.parameters?.method || 'GET').toUpperCase();
}

// Strip query strings and n8n expressions so two calls to the same endpoint collapse.
function normalise(url) {
  return String(url)
    .replace(/^=/, '')
    .replace(/\{\{[^}]*\}\}/g, '{expr}')
    .split('?')[0]
    .trim();
}

const wfs = process.argv.slice(2).map((p) => ({ path: p, wf: load(p) }));
if (!wfs.length) {
  console.error('usage: extract-flow-facts.mjs <workflow.json> [...]');
  process.exit(1);
}

const endpoints = new Map(); // inbound reads: normalised url -> {method, raw, nodes:[], banned, pagey}
const outbound = new Map();  // writes/callbacks whose URL is an expression, not a fixed host
const creds = new Map();     // "name|type" -> count
const triggers = [];
const settings = [];
let totalNodes = 0;

for (const { wf } of wfs) {
  const nodes = wf.nodes ?? [];
  totalNodes += nodes.length;
  settings.push({
    name: wf.name,
    id: wf.id,
    active: wf.active,
    timezone: wf.settings?.timezone,
    timeout: wf.settings?.executionTimeout,
    nodeCount: nodes.length,
  });

  for (const n of nodes) {
    const t = n.type || '';

    if (/scheduleTrigger|cron/i.test(t)) {
      triggers.push({ kind: 'schedule', node: n.name, rule: JSON.stringify(n.parameters?.rule ?? n.parameters ?? {}) });
    } else if (/respondToWebhook/i.test(t)) {
      // a responder, not a trigger — skip
    } else if (/webhook/i.test(t)) {
      triggers.push({ kind: 'webhook', node: n.name, path: n.parameters?.path, method: n.parameters?.httpMethod });
    } else if (/executeWorkflowTrigger/i.test(t)) {
      triggers.push({ kind: 'sub-workflow', node: n.name });
    }

    if (/httpRequest/i.test(t)) {
      const raw = urlOf(n);
      const key = normalise(raw);
      if (!key) continue;
      // A URL that is entirely an expression is a caller-supplied destination — an OUTPUT
      // (a callback), never a data source. Listing it under Inputs misreads the flow.
      const bucket = key.startsWith('{expr}') ? outbound : endpoints;
      const e = bucket.get(key) ?? {
        method: methodOf(n), raw, nodes: [],
        banned: BANNED.some((b) => key.includes(b)),
        pagey: PAGEY.test(raw),
      };
      e.nodes.push(n.name);
      bucket.set(key, e);
    }

    for (const [type, c] of Object.entries(n.credentials ?? {})) {
      const key = `${c.name ?? '(unnamed)'}|${type}`;
      creds.set(key, (creds.get(key) ?? 0) + 1);
    }
  }
}

const out = [];
out.push('<!-- AUTO-DERIVED from the workflow JSON by extract-flow-facts.mjs. Verify before posting. -->\n');

out.push('## Trigger & schedule\n');
if (!triggers.length) out.push('TODO — no trigger node found.\n');
for (const t of triggers) {
  if (t.kind === 'schedule') out.push(`- **Scheduled** — node \`${t.node}\`, rule \`${t.rule}\``);
  else if (t.kind === 'webhook') out.push(`- **Webhook** — node \`${t.node}\`, \`${t.method ?? 'POST'} /${t.path ?? '?'}\` ⚠ INBOUND ENDPOINT: say what authenticates it`);
  else out.push(`- **Called as a sub-workflow** — node \`${t.node}\``);
}
const tz = settings.find((s) => s.timezone)?.timezone;
out.push(tz ? `\nTimezone: \`${tz}\`.\n` : '\nTODO — no workflow timezone set; state which one the schedule means.\n');

out.push('## Inputs & data sources\n');
out.push(`${endpoints.size} distinct endpoints across ${totalNodes} nodes.\n`);
out.push('| Method | Endpoint | Purpose |');
out.push('| --- | --- | --- |');
for (const [url, e] of endpoints) {
  out.push(`| ${e.method} | ${url} | TODO — ${e.nodes.length} node(s): ${e.nodes.join(', ')} |`);
}

const banned = [...endpoints].filter(([, e]) => e.banned);
const pagey = [...endpoints].filter(([, e]) => e.pagey && !e.banned);
out.push('\n### Known route exceptions\n');
if (banned.length) {
  out.push('On the 2026-08-25 dead-end route ban — **must be disclosed, not omitted**:\n');
  for (const [url] of banned) out.push(`- \`${url}\` — TODO: alternative, or the ERP-team ask`);
} else {
  out.push('No endpoint matched the ban list.');
}
if (pagey.length) {
  out.push('\nNot on the ban list but **paginated-looking** — a `content`/`totalElements` envelope in the');
  out.push('live response makes it a page endpoint whatever it is called. Check each:\n');
  for (const [url] of pagey) out.push(`- \`${url}\``);
}

out.push('\n## Outputs & recipients\n');
if (outbound.size) {
  out.push('Caller-supplied destinations (the URL is an expression, resolved at run time):\n');
  for (const [, e] of outbound) out.push(`- ${e.method} → node(s): ${e.nodes.join(', ')} — TODO: name the allowlist that constrains it`);
  out.push('');
}
out.push('TODO — sheet, notification e-mail, failure alert, and what is NOT written back.\n');

out.push('\n## Expected number of executions per day\n');
out.push('TODO — rate. Per-run load must come from a REAL run, not an estimate:\n');
out.push(`- ~N ERP requests (${endpoints.size} distinct endpoints wired)`);
out.push('- N Google Sheets API calls · N Gmail sends · N Anthropic calls · N seconds wall clock\n');
for (const s of settings) {
  const mins = s.timeout ? `${Math.round(s.timeout / 60)}-minute` : 'TODO';
  out.push(`- \`${s.name}\` (${s.nodeCount} nodes): execution ceiling ${mins}${s.timeout ? '' : ' — none set'}`);
}
out.push('\nTODO — throttle: concurrency and interval.');

out.push('\n## Attachments\n');
for (const s of settings) {
  out.push(`- n8n flow export: "${s.name}.json" (${s.nodeCount} nodes) — attach`);
}
for (const s of settings) {
  out.push(`- n8n workflow link: https://sami-team.app.n8n.cloud/workflow/${s.id}${s.active ? '  ⚠ PUBLISHED (active)' : ''}`);
}

out.push('\n## Credentials used\n');
out.push('Names as they appear in the n8n credential dropdown. No secrets in this ticket or in the export.\n');
out.push('| Credential name | Type | Used by |');
out.push('| --- | --- | --- |');
if (!creds.size) out.push('| TODO | | no credentials found on any node |');
const hasErpCred = [...creds.keys()].some((k) => /erp/i.test(k));
const erpNodes = [...endpoints].filter(([u]) => u.includes('erpbackendpro')).length;
for (const [key, n] of [...creds].sort((a, b) => b[1] - a[1])) {
  const [name, type] = key.split('|');
  out.push(`| ${name} | ${type} | ${n} node${n === 1 ? '' : 's'} |`);
}

if (erpNodes && !hasErpCred) {
  out.push('\n> **No stored ERP credential, and ERP endpoints are wired.** This flow takes its token');
  out.push('> per run in the request payload rather than holding one. Say so in the ticket — otherwise');
  out.push('> it reads as a missing credential rather than a deliberate design.');
}

console.log(out.join('\n'));
