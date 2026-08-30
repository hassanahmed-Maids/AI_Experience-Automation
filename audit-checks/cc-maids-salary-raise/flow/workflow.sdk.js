import { workflow, node, trigger, sticky, newCredential, ifElse, merge, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const ERP = 'https://erpbackendpro.maids.cc';
const LEASE_WF = '9gVijqvtLVEhQZXz';
const DT_CASES = '6dDcPx0SoPow4OC3';
const DT_VERDICTS = 'qfVi9FWTD6VdVnXB';
const DT_RUNS = 'nV9rHBRbNaxcXHS7';

const FULL_RESPONSE = { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: 120000 };
const PACED = { batching: { batch: { batchSize: 1, batchInterval: 2000 } }, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: 120000 };

const runWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Run (webhook)',
    parameters: { httpMethod: 'POST', path: 'cc-maids-salary-raise', responseMode: 'responseNode', options: {} },
    position: [-560, 0]
  },
  output: [{ headers: {}, body: {} }]
});

const runManually = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Manually', position: [-560, 220] },
  output: [{}]
});

const validateInputs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Inputs',
    position: [-340, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const raw = $input.first().json || {};'
        + '\n' + ''
        + '\n' + '// Provenance is read from raw.headers, never raw.body: n8n always builds the webhook'
        + '\n' + '// envelope and sets headers itself, so a caller cannot remove it, while a literal null body'
        + '\n' + '// makes raw.body vanish - which would skip the check on the exact path that needs it.'
        + '\n' + 'const viaHttp = raw.headers !== null && typeof raw.headers === "object";'
        + '\n' + 'function webhookHeader(name) {'
        + '\n' + '  const want = name.toLowerCase(); const h = raw.headers || {};'
        + '\n' + '  for (const k of Object.keys(h)) { if (k.toLowerCase() === want) return String(h[k] || ""); }'
        + '\n' + '  return "";'
        + '\n' + '}'
        + '\n' + 'function safeEqual(a, b) {'
        + '\n' + '  const A = String(a), B = String(b); let diff = A.length ^ B.length;'
        + '\n' + '  for (let i = 0; i < Math.max(A.length, B.length); i++) diff |= (A.charCodeAt(i) || 0) ^ (B.charCodeAt(i) || 0);'
        + '\n' + '  return diff === 0;'
        + '\n' + '}'
        + '\n' + '// A SET, so a rotation has an ordering that avoids an outage. Slot names are logged; values never are.'
        + '\n' + 'const ACCEPTED = ['
        + '\n' + '  { slot: "live", value: "LAWP" },'
        + '\n' + '  { slot: "rotating", value: "OAhz0nSVf3rtx7oSquAK-8xJrlUYdfKERWV217qpk40" }'
        + '\n' + '];'
        + '\n' + 'let secretSlot = "";'
        + '\n' + 'if (viaHttp) {'
        + '\n' + '  const provided = webhookHeader("x-sr-webhook-secret");'
        + '\n' + '  let matched = "";'
        + '\n' + '  for (let i = 0; i < ACCEPTED.length; i++) { if (provided && safeEqual(provided, ACCEPTED[i].value)) matched = ACCEPTED[i].slot; }'
        + '\n' + '  if (!matched) throw new Error("unauthorized");'
        + '\n' + '  secretSlot = matched;'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const body = raw.body || raw;'
        + '\n' + 'const auth = body.erp_auth || {};'
        + '\n' + 'const errors = [];'
        + '\n' + 'const bearer = String(auth.bearer || "").trim();'
        + '\n' + 'const deviceId = String(auth.device_id || "").trim();'
        + '\n' + 'if (!/^Bearer\\s+\\S+/.test(bearer)) errors.push("erp_auth.bearer missing");'
        + '\n' + 'if (!/^\\d+$/.test(deviceId)) errors.push("erp_auth.device_id missing");'
        + '\n' + ''
        + '\n' + '// Decode locally so an EXPIRED TOKEN is named as expired. A dead ERP token produces the'
        + '\n' + '// 498-inside-500 shape, not a 401, and reporting that as a server fault wastes an hour.'
        + '\n' + 'let tokenUser = null;'
        + '\n' + 'if (errors.length === 0) {'
        + '\n' + '  try {'
        + '\n' + '    const claims = JSON.parse(Buffer.from(bearer.replace(/^Bearer\\s+/, "").split(".")[1], "base64").toString("utf8"));'
        + '\n' + '    tokenUser = claims.user || null;'
        + '\n' + '    if (claims.device && String(claims.device) !== deviceId) errors.push("device_id does not match the bearer device claim");'
        + '\n' + '    if (claims.exp && Number(claims.exp) * 1000 < Date.now()) errors.push("bearer has expired");'
        + '\n' + '  } catch (e) { errors.push("bearer is not a decodable JWT"); }'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const p = body.params || {};'
        + '\n' + 'const smoke = p.smoke === true;'
        + '\n' + ''
        + '\n' + '// The audited month. ERP hands formattedPayrollMonth back as "MMM YYYY" (confirmed live'
        + '\n' + '// 2026-08-30), so that is the canonical form here too.'
        + '\n' + 'const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];'
        + '\n' + 'function lastCompleteMonth() {'
        + '\n' + '  const d = new Date(); let y = d.getUTCFullYear(); let m = d.getUTCMonth() - 1;'
        + '\n' + '  if (m < 0) { m = 11; y -= 1; }'
        + '\n' + '  return ABBR[m] + " " + y;'
        + '\n' + '}'
        + '\n' + 'const auditedMonth = String(p.audited_month || lastCompleteMonth()).trim();'
        + '\n' + 'if (!/^[A-Za-z]{3}\\s+\\d{4}$/.test(auditedMonth)) errors.push("params.audited_month must be \\"MMM YYYY\\", e.g. \\"Jul 2026\\"; got: " + auditedMonth);'
        + '\n' + 'function monthKey(s) {'
        + '\n' + '  const m = /^([A-Za-z]{3})\\s+(\\d{4})$/.exec(String(s).trim());'
        + '\n' + '  if (!m) return null;'
        + '\n' + '  const i = ABBR.indexOf(m[1].slice(0,1).toUpperCase() + m[1].slice(1,3).toLowerCase());'
        + '\n' + '  if (i < 0) return null;'
        + '\n' + '  return m[2] + "-" + String(i + 1).padStart(2, "0");'
        + '\n' + '}'
        + '\n' + 'const mk = monthKey(auditedMonth);'
        + '\n' + 'if (auditedMonth && !mk) errors.push("params.audited_month names no real month: " + auditedMonth);'
        + '\n' + ''
        + '\n' + '// A period can only be audited once it is complete.'
        + '\n' + 'if (mk) {'
        + '\n' + '  const nowKey = new Date().toISOString().slice(0, 7);'
        + '\n' + '  if (mk >= nowKey) errors.push("audited_month " + auditedMonth + " is the current month or later - a period can only be audited once it is complete");'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + '// BACK-AUDIT SAFETY. Candidate narrowing uses the population row\'s basicSalary, which is'
        + '\n' + '// TODAY\'s figure, not the audited month\'s. Sound for a current-month run; UNSOUND for a'
        + '\n' + '// back-audit, where a maid paid high then and reduced since is filtered out before anyone'
        + '\n' + '// looks at her - a false clearance. So a back-audit must either turn narrowing off (and pay'
        + '\n' + '// the full budget) or say explicitly that it accepts the risk.'
        + '\n' + 'const nowMk = new Date().toISOString().slice(0, 7);'
        + '\n' + 'function monthsBetween(a, b) {'
        + '\n' + '  const A = a.split("-").map(Number); const B = b.split("-").map(Number);'
        + '\n' + '  return (B[0] - A[0]) * 12 + (B[1] - A[1]);'
        + '\n' + '}'
        + '\n' + 'const backAudit = mk ? monthsBetween(mk, nowMk) > 1 : false;'
        + '\n' + 'const narrowingAsked = p.narrowing !== false;'
        + '\n' + 'if (backAudit && narrowingAsked && p.accept_back_audit_narrowing !== true) {'
        + '\n' + '  errors.push("audited_month " + auditedMonth + " is a BACK-AUDIT and narrowing is on. The narrowing floor is compared against TODAY\'s salary, so a maid paid above entitlement in that month and reduced since would be filtered out before she is ever scored - a false clearance. Set params.narrowing=false (and raise erp_call_budget), or set params.accept_back_audit_narrowing=true to proceed with the gap declared on the run.");'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const cohortStatus = String(p.cohort_status || "WITH_CLIENT").trim();'
        + '\n' + 'if (!/^[A-Z_]+$/.test(cohortStatus)) errors.push("params.cohort_status must be a single ERP status constant, e.g. WITH_CLIENT. The filter takes ONE STRING - an array is silently ignored and returns the whole unfiltered population.");'
        + '\n' + ''
        + '\n' + 'const runId = String(p.run_id || ("manual-" + (mk || "unknown") + "-" + new Date().toISOString().slice(11, 19).replace(/:/g, "")));'
        + '\n' + ''
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_validate_inputs", run_id: runId, via_http: viaHttp,'
        + '\n' + '  secret_slot_matched: secretSlot, audited_month: auditedMonth, back_audit: backAudit,'
        + '\n' + '  note: "slot names only - the secret value is never logged and must never be added here." }));'
        + '\n' + ''
        + '\n' + 'return [{ json: { ok: errors.length === 0, errors: errors, params: {'
        + '\n' + '  run_id: runId,'
        + '\n' + '  check_id: (smoke ? "SMOKE-" : "") + "cc-maids-salary-raise",'
        + '\n' + '  check_name: "CC Maids Salary Raise",'
        + '\n' + '  trigger: viaHttp ? "webhook" : "manual",'
        + '\n' + '  smoke: smoke,'
        + '\n' + '  started_at: new Date().toISOString(),'
        + '\n' + '  audited_month: auditedMonth,'
        + '\n' + '  audited_month_key: mk,'
        + '\n' + '  back_audit: backAudit,'
        + '\n' + '  cohort_status: cohortStatus,'
        + '\n' + '  narrowing: narrowingAsked,'
        + '\n' + '  accept_back_audit_narrowing: p.accept_back_audit_narrowing === true,'
        + '\n' + '  max_candidates: Number(p.max_candidates || (smoke ? 5 : 0)),'
        + '\n' + '  only_maids: Array.isArray(p.only_maids) ? p.only_maids.map(String) : [],'
        + '\n' + '  erp_call_budget: Number(p.erp_call_budget || 500),'
        + '\n' + '  page_size: 40,'
        + '\n' + '  history_months: Number(p.history_months || 18),'
        + '\n' + '  complaint_page_size: 20,'
        + '\n' + '  erp_auth: { bearer: bearer, token_bare: bearer.replace(/^Bearer\\s+/, ""), device_id: deviceId, acting_user: tokenUser }'
        + '\n' + '} } }];'
    }
  },
  output: [{ ok: true, errors: [], params: { run_id: 'manual-2026-07-000000' } }]
});

const inputsOk = ifElse({
  version: 2.3,
  config: {
    name: 'Inputs OK?',
    position: [-120, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.ok }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const respond400 = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond 400',
    position: [100, 220],
    parameters: { respondWith: 'json', responseCode: 400, responseBody: expr('{{ JSON.stringify({ ok: false, errors: $json.errors }) }}'), options: {} }
  },
  output: [{}]
});

const respond200 = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond 200 (accepted)',
    position: [100, -140],
    parameters: { respondWith: 'json', responseCode: 200, responseBody: expr('{{ JSON.stringify({ ok: true, run_id: $json.params.run_id, note: "accepted - draft run, results land in the Data Tables" }) }}'), options: {} }
  },
  output: [{}]
});

const assertRulings = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assert Rulings',
    position: [100, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// REFERENCE DATA, ASSERTED BY CHECKSUM BEFORE ANYTHING IS SCORED.'
        + '\n' + '// Both constants are RULINGS a human maintains - ERP publishes neither, and nothing upstream'
        + '\n' + '// changes them for us when policy moves. Their variable rows say the run must STOP if one is'
        + '\n' + '// missing: an absent lifetime cap makes the allowance unbounded and clears EVERY finding.'
        + '\n' + 'const RULINGS = {'
        + '\n' + '  renewal_raise_lifetime_cap: 2,'
        + '\n' + '  ruled_cohort_level: { "Filipina|live_out": 3200, "Ethiopian|live_in": 1500 }'
        + '\n' + '};'
        + '\n' + ''
        + '\n' + '// Narrowing floors: the LOWEST allowance a maid of this nationality could have, across both'
        + '\n' + '// living statuses. Anyone paid at or below her nationality floor cannot be above ANY'
        + '\n' + '// allowance, because renewal raises only ever add. A nationality with no floor here is NOT'
        + '\n' + '// narrowed - every one of its maids becomes a candidate, and the budget gate then forces the'
        + '\n' + '// operator to scope the run rather than letting an unpriced cohort through unexamined.'
        + '\n' + 'const NARROWING_FLOORS = { "Filipina": 2000, "Ethiopian": 1200 };'
        + '\n' + ''
        + '\n' + 'const cap = RULINGS.renewal_raise_lifetime_cap;'
        + '\n' + 'if (!Number.isInteger(cap) || cap < 0) throw new Error("RULING MISSING: renewal_raise_lifetime_cap. An absent cap makes the allowance unbounded and clears every finding. Run stopped; nothing was scored.");'
        + '\n' + 'const lvl = RULINGS.ruled_cohort_level;'
        + '\n' + 'if (!lvl || typeof lvl !== "object" || Object.keys(lvl).length === 0) throw new Error("RULING MISSING: ruled_cohort_level. Run stopped; nothing was scored.");'
        + '\n' + 'const keys = Object.keys(lvl).sort();'
        + '\n' + 'for (const k of keys) { if (!(Number.isFinite(lvl[k]) && lvl[k] > 0)) throw new Error("RULING INVALID: ruled_cohort_level[" + k + "]. Run stopped."); }'
        + '\n' + ''
        + '\n' + 'const parts = keys.map(function (k) { return k + "=" + lvl[k]; });'
        + '\n' + 'const checksum = "cap=" + cap + ";" + parts.join(",") + ";n=" + keys.length;'
        + '\n' + 'const EXPECTED = "cap=2;Ethiopian|live_in=1500,Filipina|live_out=3200;n=2";'
        + '\n' + 'if (checksum !== EXPECTED) {'
        + '\n' + '  throw new Error("RULINGS CHECKSUM MISMATCH. Expected " + EXPECTED + " but got " + checksum + ". A ruling was edited without the checksum being updated - that is exactly the silent change this assert exists to catch. Run stopped; nothing was scored.");'
        + '\n' + '}'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_rulings", checksum: checksum }));'
        + '\n' + ''
        + '\n' + 'const params = $json.params;'
        + '\n' + 'return [{ json: { params: params, rulings: RULINGS, narrowing_floors: NARROWING_FLOORS, rulings_checksum: checksum } }];'
    }
  },
  output: [{ params: {}, rulings: {}, rulings_checksum: 'cap=2;...' }]
});

const acquireLease = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Acquire ERP Lease',
    position: [320, 0],
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: LEASE_WF },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          mode: 'acquire',
          run_id: expr('{{ $("Validate Inputs").first().json.params.run_id }}'),
          check_id: 'cc-maids-salary-raise',
          ignore_lease: expr('{{ $("Validate Inputs").first().json.params.ignore_erp_lease === true }}'),
          max_wait_ms: 600000
        },
        matchingColumns: [],
        schema: [
          { id: 'mode', displayName: 'mode', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'check_id', displayName: 'check_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'ignore_lease', displayName: 'ignore_lease', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'max_wait_ms', displayName: 'max_wait_ms', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: true }
    }
  },
  output: [{ granted: true }]
});

const getPopulationCount = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Population Count',
    position: [540, 0],
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: expr('{{ "' + ERP + '/payroll/HousemaidPayroll/filterHousemaids?page=0&size=" + $("Assert Rulings").first().json.params.page_size }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ maidPayrollTypes: ["MAID_CC"], status: $("Assert Rulings").first().json.params.cohort_status }) }}'),
      options: FULL_RESPONSE
    }
  },
  output: [{ statusCode: 200, body: { totalElements: 5611, content: [] } }]
});

const buildPageList = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Page List',
    position: [760, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const r = $input.first().json || {};'
        + '\n' + 'if (r.statusCode !== 200) throw new Error("POPULATION COUNT FAILED: HTTP " + r.statusCode + " " + JSON.stringify((r.body || {})).slice(0, 300) + ". Never audit a population you could not count. Run stopped; nothing was scored.");'
        + '\n' + 'const b = r.body || {};'
        + '\n' + 'const total = Number(b.totalElements);'
        + '\n' + 'if (!Number.isFinite(total)) throw new Error("POPULATION COUNT UNPROVABLE: the envelope carried no totalElements. Run stopped.");'
        + '\n' + 'if (total === 0) throw new Error("THE COHORT RETURNED ZERO MAIDS. An empty result is a broken filter, never \\"no findings\\". Run stopped.");'
        + '\n' + ''
        + '\n' + '// THE FILTER FALL-THROUGH GUARD, and it is the most important assert in this flow.'
        + '\n' + '// Probed live 2026-08-30: an unrecognised filter KEY or the wrong value SHAPE returns HTTP'
        + '\n' + '// 200 and the ENTIRE unfiltered population - 80,621 CC maids instead of 5,611 - with no'
        + '\n' + '// error of any kind. The status filter takes ONE STRING; every array form is silently'
        + '\n' + '// ignored. A run that quietly audits 80,621 maids is both a wrong answer and an ERP load'
        + '\n' + '// incident, and this is the endpoint class that got the ERP account disabled in June 2026.'
        + '\n' + 'const UNFILTERED_FLOOR = 60000;'
        + '\n' + 'if (total >= UNFILTERED_FLOOR) {'
        + '\n' + '  throw new Error("STATUS FILTER DID NOT APPLY: the count came back as " + total + ", which is the unfiltered CC population, not the \\"" + params.cohort_status + "\\" cohort. The filter takes a single STRING; an array is silently ignored. Run stopped; nothing was scored and no fan-out was issued.");'
        + '\n' + '}'
        + '\n' + 'const rows = Array.isArray(b.content) ? b.content : [];'
        + '\n' + 'const foreignStatus = [];'
        + '\n' + 'for (const row of rows) { if (row.status && row.status !== params.cohort_status && foreignStatus.indexOf(row.status) === -1) foreignStatus.push(row.status); }'
        + '\n' + 'if (foreignStatus.length) {'
        + '\n' + '  throw new Error("STATUS FILTER DID NOT APPLY: page 0 carried statuses " + JSON.stringify(foreignStatus) + " while the run asked for " + params.cohort_status + ". Run stopped.");'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + '// Page at size=40 and never larger. ERP offsets by page x size while a page returns at most'
        + '\n' + '// 40 rows, so size=50 requests offsets 0-39 then 50-99 and SILENTLY NEVER ASKS FOR 40-49.'
        + '\n' + 'const SIZE = params.page_size;'
        + '\n' + 'if (SIZE !== 40) throw new Error("PAGE SIZE MUST BE 40. ERP offsets by page x size while a page returns at most 40 rows, so any larger size silently skips whole ranges of maids.");'
        + '\n' + 'const pages = Math.ceil(total / SIZE);'
        + '\n' + ''
        + '\n' + 'const items = [];'
        + '\n' + 'for (let i = 0; i < pages; i++) items.push({ json: { page: i, pages_expected: pages, total_expected: total, run_id: params.run_id } });'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_page_plan", run_id: params.run_id, total_expected: total, pages_expected: pages, cohort_status: params.cohort_status }));'
        + '\n' + 'return items;'
    }
  },
  output: [{ page: 0, pages_expected: 141, total_expected: 5611, run_id: 'r' }]
});

const budgetGate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'ERP Budget Gate',
    position: [980, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// ERP PRE-FLIGHT BUDGET GATE. The last point before any fan-out.'
        + '\n' + '//'
        + '\n' + '// Pacing bounds requests per SECOND. It does not bound how many there are. A check tested on'
        + '\n' + '// one cohort behaves identically on ten, and nothing in between makes the cost visible before'
        + '\n' + '// the calls go out. This gate HARD-FAILS; it never trims the population to fit, because a run'
        + '\n' + '// that completes with incomplete coverage is a partial audit that looks complete - the single'
        + '\n' + '// failure this whole check family exists to avoid.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const plan = $input.first().json;'
        + '\n' + 'const sweepCalls = Number(plan.pages_expected) || $input.all().length;'
        + '\n' + 'const population = Number(plan.total_expected) || 0;'
        + '\n' + ''
        + '\n' + '// Measured 2026-08-30, not estimated: 32 ERP calls for 5 maids end to end.'
        + '\n' + '// Per candidate: profile + salary rule + payroll history + renew docs = 4, plus the evidence'
        + '\n' + '// sweep, which is paged at 20 and dominates - one test maid has 96 complaints (5 pages).'
        + '\n' + '// Plus the comment threads: verifier rule 80 requires the thread, not just the description,'
        + '\n' + '// because the thread is the only place a refusal is recorded. Only complaints with'
        + '\n' + '// commentCount > 0 are fetched, but that is still the largest single cost per candidate.'
        + '\n' + 'const CALLS_PER_CANDIDATE = 4 + 3 + 6;'
        + '\n' + 'const budget = params.erp_call_budget > 0 ? params.erp_call_budget : 500;'
        + '\n' + ''
        + '\n' + '// Candidates are unknown until the population is narrowed, so the WORST CASE is budgeted:'
        + '\n' + '// every maid a candidate. A budget that assumes the happy case is not a budget. If narrowing'
        + '\n' + '// is off, that worst case is the real case.'
        + '\n' + 'const worstCandidates = params.max_candidates > 0 ? Math.min(params.max_candidates, population) : population;'
        + '\n' + '// The MV_TO_CC cohort is a subset of the population, so its sweep is at worst the same number'
        + '\n' + '// of pages. Budgeted at the worst case rather than guessed lower.'
        + '\n' + 'const switcherSweep = sweepCalls;'
        + '\n' + 'const projected = sweepCalls + switcherSweep + worstCandidates * CALLS_PER_CANDIDATE;'
        + '\n' + ''
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_budget_gate", run_id: params.run_id, population: population,'
        + '\n' + '  sweep_calls: sweepCalls, switcher_sweep: switcherSweep, worst_candidates: worstCandidates,'
        + '\n' + '  projected_total: projected, budget: budget }));'
        + '\n' + ''
        + '\n' + 'if (projected > budget) {'
        + '\n' + '  throw new Error("ERP BUDGET EXCEEDED before any fan-out: this run projects " + projected + " calls against a budget of " + budget + " (population " + population + " on status " + params.cohort_status + ", " + sweepCalls + " sweep pages, up to " + worstCandidates + " candidates at " + CALLS_PER_CANDIDATE + " calls each). The run was STOPPED rather than trimmed - a trimmed population produces an audit that looks complete and is not. Scope the cohort tighter, set params.max_candidates, or raise params.erp_call_budget deliberately.");'
        + '\n' + '}'
        + '\n' + 'return $input.all();'
    }
  },
  output: [{ page: 0, pages_expected: 141, total_expected: 5611 }]
});

const getPopulationPages = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Population Pages',
    position: [1200, 0],
    parameters: {
      method: 'POST',
      url: expr('{{ "' + ERP + '/payroll/HousemaidPayroll/filterHousemaids?page=" + $json.page + "&size=" + $("Assert Rulings").first().json.params.page_size }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ maidPayrollTypes: ["MAID_CC"], status: $("Assert Rulings").first().json.params.cohort_status }) }}'),
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { content: [], totalElements: 5611 } }]
});

const populationGuard = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Population Guard',
    position: [1420, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const plan = $("Build Page List").first().json;'
        + '\n' + 'const pages = $input.all();'
        + '\n' + 'const problems = [];'
        + '\n' + 'const byId = new Map();'
        + '\n' + 'let reported = null;'
        + '\n' + ''
        + '\n' + 'for (let i = 0; i < pages.length; i++) {'
        + '\n' + '  const r = pages[i].json || {};'
        + '\n' + '  if (r.statusCode !== 200) { problems.push("page " + i + " returned HTTP " + r.statusCode); continue; }'
        + '\n' + '  const b = r.body || {};'
        + '\n' + '  if (!Array.isArray(b.content)) { problems.push("page " + i + " carried no content array - the response shape changed"); continue; }'
        + '\n' + '  if (reported === null && typeof b.totalElements === "number") reported = b.totalElements;'
        + '\n' + '  if (b.content.length > params.page_size) problems.push("page " + i + " returned " + b.content.length + " rows, above the size " + params.page_size + " asked for");'
        + '\n' + '  // DEDUPE BY MAID ID. filterHousemaids is not stable under concurrent writes: a Filipina'
        + '\n' + '  // live-in walk returned 2,413 rows for 2,412 unique ids - one row appeared on two pages.'
        + '\n' + '  // The row COUNT is not trustworthy; the id set is.'
        + '\n' + '  for (const row of b.content) { if (row && row.id !== undefined && row.id !== null) byId.set(String(row.id), row); }'
        + '\n' + '}'
        + '\n' + 'if (problems.length) throw new Error("POPULATION WALK FAILED: " + problems.join("; ") + ". Never audit a truncated population. Run stopped; nothing was scored.");'
        + '\n' + ''
        + '\n' + 'const unique = byId.size;'
        + '\n' + 'if (unique === 0) throw new Error("THE POPULATION WALK RETURNED ZERO MAIDS across " + pages.length + " pages. An empty result is a broken query, never \\"no findings\\". Run stopped.");'
        + '\n' + 'if (reported === null) throw new Error("COMPLETENESS UNPROVABLE: no page reported totalElements. Run stopped; nothing was scored.");'
        + '\n' + ''
        + '\n' + '// Order 25 (12) - a walk that does not reconcile is unresolved, never clean. "Not on a page"'
        + '\n' + '// and "does not exist" are indistinguishable, and the false direction quietly clears a real'
        + '\n' + '// finding.'
        + '\n' + 'if (unique !== reported) {'
        + '\n' + '  throw new Error("POPULATION INCOMPLETE: pulled " + unique + " unique maid ids but the envelope reports " + reported + " totalElements. Run stopped; nothing was scored.");'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + '// Order 20 (2) - MaidVisa maids are excluded AT THE QUERY, never filtered out after scoring.'
        + '\n' + '// The assert catches a filter that fell through; it never silently drops a row.'
        + '\n' + 'const foreignStatus = [];'
        + '\n' + 'for (const row of byId.values()) { if (row.status && row.status !== params.cohort_status && foreignStatus.indexOf(row.status) === -1) foreignStatus.push(row.status); }'
        + '\n' + 'if (foreignStatus.length) throw new Error("FOREIGN STATUSES IN THE POPULATION: " + JSON.stringify(foreignStatus) + " while the run asked for " + params.cohort_status + ". The filter did not apply - never widen. Run stopped.");'
        + '\n' + ''
        + '\n' + 'const rows = [];'
        + '\n' + 'for (const row of byId.values()) {'
        + '\n' + '  rows.push({ maid_id: String(row.id), status: row.status, nationality_name: (row.nationality || {}).name || null,'
        + '\n' + '    nationality_id: (row.nationality || {}).id || null, basic_salary_today: Number(row.basicSalary),'
        + '\n' + '    start_date: row.start_date || row.startDate || null });'
        + '\n' + '}'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_population_guard", run_id: params.run_id, unique: unique,'
        + '\n' + '  reported: reported, reconciled: true, pages: pages.length }));'
        + '\n' + 'return [{ json: { population: rows, population_reported: reported, population_pulled: unique,'
        + '\n' + '  population_reconciled: true, pages_walked: pages.length, filter_narrowed: reported < 60000 } }];'
    }
  },
  output: [{ population: [], population_pulled: 5611, population_reconciled: true }]
});

const getSwitcherCount = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Switcher Count',
    position: [1420, 200],
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: expr('{{ "' + ERP + '/payroll/HousemaidPayroll/filterHousemaids?page=0&size=" + $("Assert Rulings").first().json.params.page_size }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ maidPayrollTypes: ["MV_TO_CC"], status: $("Assert Rulings").first().json.params.cohort_status }) }}'),
      options: FULL_RESPONSE
    }
  },
  output: [{ statusCode: 200, body: { totalElements: 1500, content: [] } }]
});

const buildSwitcherPages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Switcher Pages',
    position: [1640, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// WHY THIS SWEEP EXISTS AT ALL.'
        + '\n' + '// Order 57 (11) says an MV to CC switcher is PENDING, NEVER RED, because her renewal raise is'
        + '\n' + '// earned on 24 continuous months as CC rather than at the visa-renewal step - so looking for a'
        + '\n' + '// renewal and finding none would wrongly flag her.'
        + '\n' + '//'
        + '\n' + '// But there is NO per-maid route that exposes the distinction. getHousemaidInfo does not carry'
        + '\n' + '// oldHousemaidType, and its housemaidType reads "Normal" / "Freedom Operator", which is a'
        + '\n' + '// recruitment channel, not CC vs MV. The ONLY place the distinction exists is the REQUEST side'
        + '\n' + '// of filterHousemaids. So the switcher cohort has to be enumerated separately and intersected'
        + '\n' + '// with the candidates.'
        + '\n' + '//'
        + '\n' + '// Without this sweep Order 57 could never fire, and a switcher above her allowance would reach'
        + '\n' + '// the candidate route and could be ACCUSED - which the rule exists to forbid.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const r = $input.first().json || {};'
        + '\n' + 'if (r.statusCode !== 200) throw new Error("SWITCHER COUNT FAILED: HTTP " + r.statusCode + ". Order 57 forbids treating an MV to CC switcher as an ordinary CC maid, and without this cohort the rule cannot fire. Run stopped rather than risking a wrong accusation.");'
        + '\n' + 'const total = Number((r.body || {}).totalElements);'
        + '\n' + 'if (!Number.isFinite(total)) throw new Error("SWITCHER COUNT UNPROVABLE: no totalElements. Run stopped.");'
        + '\n' + 'if (total >= 60000) throw new Error("SWITCHER FILTER DID NOT APPLY: " + total + " looks like the unfiltered population. Run stopped.");'
        + '\n' + 'const pages = Math.ceil(total / params.page_size);'
        + '\n' + 'if (pages === 0) return [{ json: { page: 0, switcher_total: 0, _none: true } }];'
        + '\n' + 'const items = [];'
        + '\n' + 'for (let i = 0; i < pages; i++) items.push({ json: { page: i, switcher_total: total } });'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_switcher_plan", total: total, pages: pages }));'
        + '\n' + 'return items;'
    }
  },
  output: [{ page: 0, switcher_total: 1500 }]
});

const getSwitcherPages = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Switcher Pages',
    position: [1860, 200],
    parameters: {
      method: 'POST',
      url: expr('{{ "' + ERP + '/payroll/HousemaidPayroll/filterHousemaids?page=" + $json.page + "&size=" + $("Assert Rulings").first().json.params.page_size }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ maidPayrollTypes: ["MV_TO_CC"], status: $("Assert Rulings").first().json.params.cohort_status }) }}'),
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { content: [] } }]
});

const collectSwitchers = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Collect Switcher Ids',
    position: [2080, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const plan = $("Build Switcher Pages").first().json;'
        + '\n' + 'const guard = $("Population Guard").first().json;'
        + '\n' + 'const ids = [];'
        + '\n' + 'let reported = null;'
        + '\n' + 'if (!plan._none) {'
        + '\n' + '  for (const it of $input.all()) {'
        + '\n' + '    const r = it.json || {};'
        + '\n' + '    if (r.statusCode !== 200 || !r.body) throw new Error("SWITCHER WALK FAILED: HTTP " + r.statusCode + ". An incomplete switcher set is worse than none - a switcher missing from it is treated as an ordinary CC maid and can be accused, which Order 57 forbids. Run stopped.");'
        + '\n' + '    for (const row of (r.body.content || [])) { if (row && row.id !== undefined) ids.push(String(row.id)); }'
        + '\n' + '    if (reported === null && typeof r.body.totalElements === "number") reported = r.body.totalElements;'
        + '\n' + '  }'
        + '\n' + '  const unique = Array.from(new Set(ids));'
        + '\n' + '  // Same reconciliation discipline as the main walk: an unreconciled switcher set silently'
        + '\n' + '  // turns switchers back into ordinary CC maids.'
        + '\n' + '  if (reported !== null && unique.length !== reported) {'
        + '\n' + '    throw new Error("SWITCHER SET INCOMPLETE: pulled " + unique.length + " unique ids but the envelope reports " + reported + ". Run stopped; nothing was scored.");'
        + '\n' + '  }'
        + '\n' + '  console.log(JSON.stringify({ stage: "ccmsr_switchers", unique: unique.length, reported: reported }));'
        + '\n' + '  return [{ json: { switcher_ids: unique, switcher_total: reported || unique.length, population: guard.population,'
        + '\n' + '    population_reported: guard.population_reported, population_pulled: guard.population_pulled,'
        + '\n' + '    population_reconciled: guard.population_reconciled, filter_narrowed: guard.filter_narrowed } }];'
        + '\n' + '}'
        + '\n' + 'return [{ json: { switcher_ids: [], switcher_total: 0, population: guard.population,'
        + '\n' + '  population_reported: guard.population_reported, population_pulled: guard.population_pulled,'
        + '\n' + '  population_reconciled: guard.population_reconciled, filter_narrowed: guard.filter_narrowed } }];'
    }
  },
  output: [{ switcher_ids: [], population: [] }]
});

const narrowCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Narrow To Candidates',
    position: [1640, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const floors = cfg.narrowing_floors;'
        + '\n' + 'const guard = $input.first().json;'
        + '\n' + 'const pop = guard.population;'
        + '\n' + 'const switchers = new Set(guard.switcher_ids || []);'
        + '\n' + ''
        + '\n' + '// CANDIDATE NARROWING - the answer to this check\'s budget problem, and its one real risk.'
        + '\n' + '//'
        + '\n' + '// The population row already carries basicSalary inline, so the per-maid enrichment only has'
        + '\n' + '// to run on maids who COULD be over. A maid paid at or below her nationality floor cannot be'
        + '\n' + '// above any allowance, because renewal raises only ever ADD to it.'
        + '\n' + '//'
        + '\n' + '// THE RISK, stated rather than hidden: that inline figure is TODAY\'s salary, not the audited'
        + '\n' + '// month\'s. Sound for a current-month run. For a back-audit it is UNSOUND - a maid paid above'
        + '\n' + '// entitlement in the audited month and reduced since is filtered out before she is scored,'
        + '\n' + '// which is a false clearance. Validate Inputs refuses that combination unless it is declared.'
        + '\n' + '//'
        + '\n' + '// A nationality with NO floor is never narrowed: all of its maids become candidates, and the'
        + '\n' + '// budget gate then forces the operator to scope the run, rather than an unpriced cohort'
        + '\n' + '// slipping through unexamined.'
        + '\n' + 'const declaredGaps = [];'
        + '\n' + 'const unpriced = [];'
        + '\n' + 'const candidates = [];'
        + '\n' + 'let belowFloor = 0;'
        + '\n' + 'let unknownSalary = 0;'
        + '\n' + ''
        + '\n' + 'for (const m of pop) {'
        + '\n' + '  if (params.only_maids.length && params.only_maids.indexOf(m.maid_id) === -1) continue;'
        + '\n' + '  m.is_switcher = switchers.has(m.maid_id);'
        + '\n' + '  if (!params.narrowing) { candidates.push(m); continue; }'
        + '\n' + '  const floor = m.nationality_name ? floors[m.nationality_name] : undefined;'
        + '\n' + '  if (!Number.isFinite(floor)) {'
        + '\n' + '    if (m.nationality_name && unpriced.indexOf(m.nationality_name) === -1) unpriced.push(m.nationality_name);'
        + '\n' + '    candidates.push(m);'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + '  // Absent or null is UNKNOWN, never 0. A null read as zero makes an overpaid maid look'
        + '\n' + '  // compliant, which is a silent false clean on a money-out check - so she is enriched.'
        + '\n' + '  if (!Number.isFinite(m.basic_salary_today)) { unknownSalary++; candidates.push(m); continue; }'
        + '\n' + '  if (m.basic_salary_today > floor) { candidates.push(m); } else { belowFloor++; }'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'if (unpriced.length) declaredGaps.push("no narrowing floor for nationality/ies " + unpriced.join(", ") + " - every maid of those nationalities was enriched rather than narrowed");'
        + '\n' + 'if (unknownSalary) declaredGaps.push(unknownSalary + " maid(s) had no readable current salary and were enriched rather than narrowed");'
        + '\n' + 'if (params.back_audit && params.narrowing) declaredGaps.push("BACK-AUDIT WITH NARROWING: the floor was compared against today\'s salary, not the audited month\'s, so a maid paid above entitlement then and reduced since may have been filtered out before scoring. Explicitly accepted on this run.");'
        + '\n' + ''
        + '\n' + 'const capped = params.max_candidates > 0 ? candidates.slice(0, params.max_candidates) : candidates;'
        + '\n' + 'if (params.max_candidates > 0 && candidates.length > params.max_candidates) {'
        + '\n' + '  declaredGaps.push("PARTIAL COVERAGE: " + candidates.length + " candidates were found and only " + params.max_candidates + " were scored (max_candidates). This run does NOT cover the cohort.");'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_narrow", run_id: params.run_id, population: pop.length,'
        + '\n' + '  candidates: capped.length, below_floor: belowFloor, narrowing: params.narrowing, gaps: declaredGaps.length }));'
        + '\n' + ''
        + '\n' + 'const out = capped.map(function (m) {'
        + '\n' + '  return { json: { maid_id: m.maid_id, nationality_name: m.nationality_name, status: m.status,'
        + '\n' + '    basic_salary_today: m.basic_salary_today, is_switcher: m.is_switcher === true,'
        + '\n' + '    _run: { run_id: params.run_id, population_reported: guard.population_reported,'
        + '\n' + '      population_pulled: guard.population_pulled, population_reconciled: guard.population_reconciled,'
        + '\n' + '      filter_narrowed: guard.filter_narrowed, candidates_found: candidates.length,'
        + '\n' + '      switcher_total: guard.switcher_total, below_floor: belowFloor, declared_gaps: declaredGaps } } };'
        + '\n' + '});'
        + '\n' + 'if (out.length === 0) return [{ json: { _empty: true, _run: { run_id: params.run_id,'
        + '\n' + '  population_reported: guard.population_reported, population_pulled: guard.population_pulled,'
        + '\n' + '  population_reconciled: guard.population_reconciled, filter_narrowed: guard.filter_narrowed,'
        + '\n' + '  candidates_found: 0, below_floor: belowFloor, declared_gaps: declaredGaps } } }];'
        + '\n' + 'return out;'
    }
  },
  output: [{ maid_id: '3978', nationality_name: 'Filipina', basic_salary_today: 3050, is_switcher: false, _empty: false }]
});

const anyCandidates = ifElse({
  version: 2.3,
  config: {
    name: 'Any Candidates?',
    position: [1860, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json._empty === true }}'), operator: { type: 'boolean', operation: 'false', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const getProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Maid Profile',
    position: [2080, -120],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/staffmgmt/housemaid/getHousemaidInfo/" + $json.maid_id }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidDetails' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { id: 3978, nationality: { name: 'Filipina', tags: [] }, liveOut: false } }]
});

const getSalaryRule = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Salary Rule',
    position: [2300, -120],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/payroll/salaryrules/getruleofhousemaid/" + $("Narrow To Candidates").item.json.maid_id }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: [] }]
});

const getPayrollHistory = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Payroll History',
    position: [2520, -120],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/payroll/HousemaidPayroll/" + $("Narrow To Candidates").item.json.maid_id + "/getHistoryLog?monthsCount=" + $("Assert Rulings").first().json.params.history_months }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidsPayrollList' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: [] }]
});

const getRenewDocs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Renew Documents',
    position: [2740, -120],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/visa/renewRequest/housemaidProfile/documents/" + $("Narrow To Candidates").item.json.maid_id }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidDocuments' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: [] }]
});

const getComplaintsP0 = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Complaints Page 0',
    position: [2960, -120],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/complaints/complaint/limited/housemaid/" + $("Narrow To Candidates").item.json.maid_id + "?page=0&size=20" }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidComplaints' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { content: [], totalElements: 96 } }]
});

const buildSweepPages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Sweep Pages',
    position: [3180, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// THE EVIDENCE SWEEP MUST RECONCILE, and this is the direction that CONDEMNS rather than'
        + '\n' + '// clears. complaint/limited/housemaid/{id} defaults to size=20 and one test maid has 96, so'
        + '\n' + '// reading page 0 and concluding "no approval exists" is a FALSE ABSENCE - it nearly produced'
        + '\n' + '// a red on a real maid before the sweep was paged.'
        + '\n' + 'const cands = $("Narrow To Candidates").all();'
        + '\n' + 'const p0 = $input.all();'
        + '\n' + 'const extra = [];'
        + '\n' + 'for (let i = 0; i < p0.length; i++) {'
        + '\n' + '  const r = p0[i].json || {};'
        + '\n' + '  const maidId = cands[i] ? cands[i].json.maid_id : null;'
        + '\n' + '  if (!maidId) continue;'
        + '\n' + '  if (r.statusCode !== 200 || !r.body) continue;'
        + '\n' + '  const total = Number(r.body.totalElements);'
        + '\n' + '  if (!Number.isFinite(total)) continue;'
        + '\n' + '  const pages = Math.ceil(total / 20);'
        + '\n' + '  for (let pg = 1; pg < pages; pg++) extra.push({ json: { maid_id: maidId, page: pg } });'
        + '\n' + '}'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_sweep_plan", extra_pages: extra.length }));'
        + '\n' + 'if (extra.length === 0) return [{ json: { _no_extra: true } }];'
        + '\n' + 'return extra;'
    }
  },
  output: [{ maid_id: '3978', page: 1, _no_extra: false }]
});

const anyExtraPages = ifElse({
  version: 2.3,
  config: {
    name: 'Any Extra Sweep Pages?',
    position: [3400, -120],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json._no_extra === true }}'), operator: { type: 'boolean', operation: 'false', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const getSweepPages = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Extra Sweep Pages',
    position: [3620, -220],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/complaints/complaint/limited/housemaid/" + $json.maid_id + "?page=" + $json.page + "&size=20" }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidComplaints' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { content: [] } }]
});

const skipSweepPages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Extra Sweep Pages',
    position: [3620, -20],
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: '// PASSTHROUGH, NOT AN EMPTY RETURN. A node that returns [] emits zero items and n8n then'
        + '\n' + '// SKIPS every node downstream - the scorer, the verifier, the case store and the run row all'
        + '\n' + '// silently never run, and the execution still reports success. That is an empty audit that'
        + '\n' + '// looks like a completed one, which is the exact failure this check family exists to avoid.'
        + '\n' + 'return $input.all();'
    }
  },
  output: [{ _no_extra: true }]
});

const joinSweep = merge({
  version: 3.2,
  config: { name: 'Join Sweep Paths', position: [3840, -120], parameters: { mode: 'append', numberInputs: 2 } }
});

const buildThreadRequests = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Thread Requests',
    position: [3840, -320],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// THE COMMENT THREAD IS NOT OPTIONAL.'
        + '\n' + '// Verifier rule 80 says read the description AND the thread, because the thread is THE ONLY'
        + '\n' + '// PLACE A DENIAL IS RECORDED. The decisive counter-example is a real To-do that looks like an'
        + '\n' + '// approval from both its type and its description and is a REFUSAL in its thread. A verifier'
        + '\n' + '// reading descriptions alone can therefore be talked into clearing a maid whose raise was'
        + '\n' + '// explicitly refused - a false clearance produced by not reading far enough.'
        + '\n' + '//'
        + '\n' + '// commentCount is the cost control the spec itself offers: 0 means no thread exists, so the'
        + '\n' + '// call can be skipped - but the verdict then rests on the description alone and must say so.'
        + '\n' + 'const cands = $("Narrow To Candidates").all();'
        + '\n' + 'const p0 = $("Get Complaints Page 0").all();'
        + '\n' + 'const extraPlan = $("Build Sweep Pages").all();'
        + '\n' + 'const extraResp = $input.all();'
        + '\n' + ''
        + '\n' + 'const wanted = [];'
        + '\n' + 'const seen = new Set();'
        + '\n' + 'function consider(maidId, c) {'
        + '\n' + '  if (!c || c.id === undefined || c.id === null) return;'
        + '\n' + '  const n = Number(c.commentCount || 0);'
        + '\n' + '  if (!(n > 0)) return;'
        + '\n' + '  const key = String(c.id);'
        + '\n' + '  if (seen.has(key)) return;'
        + '\n' + '  seen.add(key);'
        + '\n' + '  wanted.push({ json: { maid_id: maidId, complaint_id: key } });'
        + '\n' + '}'
        + '\n' + 'for (let i = 0; i < p0.length; i++) {'
        + '\n' + '  const maidId = cands[i] ? cands[i].json.maid_id : null;'
        + '\n' + '  if (!maidId) continue;'
        + '\n' + '  const r = p0[i].json || {};'
        + '\n' + '  if (r.statusCode !== 200 || !r.body) continue;'
        + '\n' + '  for (const c of (r.body.content || [])) consider(maidId, c);'
        + '\n' + '}'
        + '\n' + 'for (let i = 0; i < extraResp.length; i++) {'
        + '\n' + '  const plan = extraPlan[i] ? extraPlan[i].json : null;'
        + '\n' + '  if (!plan || !plan.maid_id) continue;'
        + '\n' + '  const r = extraResp[i].json || {};'
        + '\n' + '  if (r.statusCode !== 200 || !r.body) continue;'
        + '\n' + '  for (const c of (r.body.content || [])) consider(plan.maid_id, c);'
        + '\n' + '}'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_thread_plan", threads_to_read: wanted.length }));'
        + '\n' + 'if (wanted.length === 0) return [{ json: { _no_threads: true } }];'
        + '\n' + 'return wanted;'
    }
  },
  output: [{ maid_id: '3978', complaint_id: '228006', _no_threads: false }]
});

const anyThreads = ifElse({
  version: 2.3,
  config: {
    name: 'Any Threads To Read?',
    position: [4060, -320],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json._no_threads === true }}'), operator: { type: 'boolean', operation: 'false', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const getThreads = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Comment Threads',
    position: [4280, -420],
    parameters: {
      method: 'GET',
      url: expr('{{ "' + ERP + '/complaints/teamComplaintUpdate/historyOfComplaint/" + $json.complaint_id }}'),
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'HousemaidComplaints' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'content-type', value: 'application/json' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr('{{ $("Validate Inputs").first().json.params.erp_auth.bearer }}') },
        { name: 'cookie', value: expr('{{ "authTokenProduction=" + $("Validate Inputs").first().json.params.erp_auth.token_bare + "; deviceIdProduction=" + $("Validate Inputs").first().json.params.erp_auth.device_id }}') }
      ] },
      options: PACED
    }
  },
  output: [{ statusCode: 200, body: { content: [] } }]
});

const noThreads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Threads To Read',
    position: [4280, -220],
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: '// PASSTHROUGH, NOT AN EMPTY RETURN - a [] here would skip the scorer and every delivery node.'
        + '\n' + 'return $input.all();'
    }
  },
  output: [{ _no_threads: true }]
});

const joinThreads = merge({
  version: 3.2,
  config: { name: 'Join Thread Paths', position: [4500, -320], parameters: { mode: 'append', numberInputs: 2 } }
});

const scoreDeterministic = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Score Deterministic',
    position: [4060, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// The 15 LIVE deterministic gates, in ACP Order sequence. Order is the COLUMN, not the'
        + '\n' + '// numeral - the numerals are citations and never change.'
        + '\n' + '//'
        + '\n' + '// THE ONE LINE THIS WHOLE NODE EXISTS TO GET RIGHT: an APPROVED BASE IS NOT A FINAL SALARY.'
        + '\n' + '// Reading an approved figure as a ceiling called one real maid "the strongest finding" when'
        + '\n' + '// she is clean, and would have produced 3 false reds out of 5 across the whole population.'
        + '\n' + '// The allowance is worked out PER MAID:  base + renewal_raise x min(renewals, lifetime cap).'
        + '\n' + '// A flat nationality ceiling was tested against the five real cases and produced two confirmed'
        + '\n' + '// false reds. Never reintroduce one.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const RULINGS = cfg.rulings;'
        + '\n' + 'const CAP = RULINGS.renewal_raise_lifetime_cap;'
        + '\n' + 'const AUDITED = params.audited_month;'
        + '\n' + 'const AUDITED_KEY = params.audited_month_key;'
        + '\n' + 'const MONTH_END = AUDITED_KEY + "-28T23:59:59Z";'
        + '\n' + ''
        + '\n' + 'const ABBR = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };'
        + '\n' + '// ERP hands formattedPayrollMonth back as "MMM YYYY" - literally "Jul 2026". Confirmed live.'
        + '\n' + '// An ISO assumption matches NO month, which reads as "not on that month\'s payroll" and drops'
        + '\n' + '// every maid out of population: a silent empty run that looks like a clean one.'
        + '\n' + 'function monthKey(s) {'
        + '\n' + '  const t = String(s || "").trim();'
        + '\n' + '  let m = /^([A-Za-z]{3,})\\s+(\\d{4})$/.exec(t);'
        + '\n' + '  if (m) { const mm = ABBR[m[1].slice(0, 3).toLowerCase()]; if (mm) return m[2] + "-" + mm; }'
        + '\n' + '  m = /^(\\d{4})-(\\d{1,2})$/.exec(t);'
        + '\n' + '  if (m) return m[1] + "-" + String(m[2]).padStart(2, "0");'
        + '\n' + '  return t;'
        + '\n' + '}'
        + '\n' + '// All four r-visa spellings. The vocabulary DRIFTED: a maid\'s 2020/2022/2024 cycles carry'
        + '\n' + '// rVisa while her 2018 cycle carries stampedRvisa / oldRvisa / rvisaApplication and no rVisa'
        + '\n' + '// at all. Matching only rVisa reads a real pre-2020 renewal as "never renewed".'
        + '\n' + 'const RVISA = ["rvisa", "stampedrvisa", "oldrvisa", "rvisaapplication"];'
        + '\n' + ''
        + '\n' + 'function readRenewalRaise(tags) {'
        + '\n' + '  // Tags are a FLAT STRING ARRAY in key:value form - parse, do not index. TAG ABSENT IS THE'
        + '\n' + '  // ANSWER (Ethiopian carries none at all), never a gap. Never hardcode 350, and never confuse'
        + '\n' + '  // renewal_raise with max_renewal_raise (400 on Filipina) - similar names, different numbers.'
        + '\n' + '  if (!Array.isArray(tags)) return null;'
        + '\n' + '  for (const raw of tags) { const m = /^renewal_raise:(\\d+)$/.exec(String(raw).trim()); if (m) return Number(m[1]); }'
        + '\n' + '  return null;'
        + '\n' + '}'
        + '\n' + 'function sumRule(details) {'
        + '\n' + '  // getTotalSalaryFromComponents(): every component EXCEPT accommodationSalary. This is NOT'
        + '\n' + '  // primarySalary - that is 1500 Filipina / 1000 Ethiopian / 600 most others, and using it'
        + '\n' + '  // re-prices every cohort and manufactures findings everywhere. Returns null, never 0:'
        + '\n' + '  // defaulting a missing standard to 0 flags everyone, to Infinity clears everyone.'
        + '\n' + '  if (!Array.isArray(details) || details.length === 0) return null;'
        + '\n' + '  let total = 0; let counted = 0;'
        + '\n' + '  for (const row of details) {'
        + '\n' + '    const label = String(((row || {}).salaryComponent || {}).label || "").trim().toLowerCase();'
        + '\n' + '    if (label === "accommodationsalary") continue;'
        + '\n' + '    const v = Number(row.value); if (!Number.isFinite(v)) continue;'
        + '\n' + '    total += v; counted++;'
        + '\n' + '  }'
        + '\n' + '  return counted === 0 ? null : total;'
        + '\n' + '}'
        + '\n' + 'function countRenewals(reqs, asOf) {'
        + '\n' + '  // Counted by the ATTACHMENT date, never the renew request\'s: across 33 sampled maids the two'
        + '\n' + '  // dates gave DIFFERENT VERDICTS on 3. ERP grants the raise at the e-Residency upload step,'
        + '\n' + '  // which is the document, so the document date is the one that matches the money.'
        + '\n' + '  // Counts DISTINCT REQUESTS, not attachments - one cycle can carry three r-visa spellings.'
        + '\n' + '  if (!Array.isArray(reqs)) return { count: 0, dates: [] };'
        + '\n' + '  const cutoff = Date.parse(asOf);'
        + '\n' + '  const dates = [];'
        + '\n' + '  for (const q of reqs) {'
        + '\n' + '    const atts = (q || {}).attachments; if (!Array.isArray(atts)) continue;'
        + '\n' + '    let earliest = null;'
        + '\n' + '    for (const a of atts) {'
        + '\n' + '      if (RVISA.indexOf(String((a || {}).tag || "").trim().toLowerCase()) === -1) continue;'
        + '\n' + '      const t = Date.parse(String(a.creationDate || "")); if (!Number.isFinite(t)) continue;'
        + '\n' + '      // A renewal uploaded AFTER the audited month cannot justify money paid before it.'
        + '\n' + '      if (Number.isFinite(cutoff) && t > cutoff) continue;'
        + '\n' + '      if (earliest === null || t < earliest) earliest = t;'
        + '\n' + '    }'
        + '\n' + '    if (earliest !== null) dates.push(new Date(earliest).toISOString().slice(0, 10));'
        + '\n' + '  }'
        + '\n' + '  dates.sort();'
        + '\n' + '  return { count: dates.length, dates: dates };'
        + '\n' + '}'
        + '\n' + 'function readPaid(history, month) {'
        + '\n' + '  // NEVER netSalary. Net = total + additions - deductions, and one maid reads 2550 in two'
        + '\n' + '  // separate months purely because a 200 addition landed while her rate never moved.'
        + '\n' + '  // No row for the audited month = OUT OF POPULATION for that month. Never zero, never clean.'
        + '\n' + '  const want = monthKey(month);'
        + '\n' + '  for (const r of (Array.isArray(history) ? history : [])) {'
        + '\n' + '    if (monthKey((r || {}).formattedPayrollMonth) !== want) continue;'
        + '\n' + '    const b = Number(r.basicSalary); const c = Number(r.companySalary);'
        + '\n' + '    const paid = Number.isFinite(b) ? b : (Number.isFinite(c) ? c : null);'
        + '\n' + '    return { paid: paid, disagree: Number.isFinite(b) && Number.isFinite(c) && b !== c };'
        + '\n' + '  }'
        + '\n' + '  return { paid: null, disagree: false };'
        + '\n' + '}'
        + '\n' + 'function detectRecurring(history) {'
        + '\n' + '  // The VPM-8374 shape (Bug, closed Won\'t Do, STILL LIVE): a maid\'s profile read 2350 while'
        + '\n' + '  // payroll computed 2000 and paid the 350 difference as a RECURRING MONTHLY ADDITION. Her'
        + '\n' + '  // total salary therefore reads exactly at standard while she is in fact paid above it.'
        + '\n' + '  // RECURRENCE IS THE DISCRIMINATOR, NOT SIZE - a 1500 airfare dwarfs a 350 raise and is a'
        + '\n' + '  // one-off. Zero-valued additions never form a run.'
        + '\n' + '  const rows = (Array.isArray(history) ? history : []).filter(function (r) { return r && r.formattedPayrollMonth; })'
        + '\n' + '    .slice().sort(function (a, b) { return monthKey(a.formattedPayrollMonth) < monthKey(b.formattedPayrollMonth) ? -1 : 1; });'
        + '\n' + '  let best = null; let amt = null; let len = 0; let months = [];'
        + '\n' + '  for (const r of rows) {'
        + '\n' + '    const v = Number(r.totalAddition || 0);'
        + '\n' + '    if (v > 0 && amt !== null && v === amt) { len++; months.push(r.formattedPayrollMonth); }'
        + '\n' + '    else if (v > 0) { amt = v; len = 1; months = [r.formattedPayrollMonth]; }'
        + '\n' + '    else { amt = null; len = 0; months = []; }'
        + '\n' + '    if (len >= 2 && (best === null || len > best.months_count)) best = { amount: amt, months_count: len };'
        + '\n' + '  }'
        + '\n' + '  return best;'
        + '\n' + '}'
        + '\n' + 'function prevailingTotal(history) {'
        + '\n' + '  // The monthly total is NOT a stable rate. Probed live across 24 months: one maid reads +350'
        + '\n' + '  // over her capped entitlement in 15 of them and BELOW it in five, with every row marked Paid,'
        + '\n' + '  // transferred, and carrying NO exclusion reason at all. So a maid whose rate is plainly above'
        + '\n' + '  // entitlement CLEARS if the run happens to audit a reduced month - a false clearance produced'
        + '\n' + '  // purely by month selection. The mode, not the max, so a one-off arrears spike is not "her'
        + '\n' + '  // rate" either.'
        + '\n' + '  const counts = new Map();'
        + '\n' + '  for (const r of (Array.isArray(history) ? history : [])) {'
        + '\n' + '    const v = Number((r || {}).basicSalary); if (!Number.isFinite(v)) continue;'
        + '\n' + '    counts.set(v, (counts.get(v) || 0) + 1);'
        + '\n' + '  }'
        + '\n' + '  if (counts.size === 0) return null;'
        + '\n' + '  let bv = null; let bn = -1;'
        + '\n' + '  for (const e of counts.entries()) { if (e[1] > bn || (e[1] === bn && e[0] > bv)) { bv = e[0]; bn = e[1]; } }'
        + '\n' + '  return { total: bv, months: bn };'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const cands = $("Narrow To Candidates").all();'
        + '\n' + 'const profiles = $("Get Maid Profile").all();'
        + '\n' + 'const rules = $("Get Salary Rule").all();'
        + '\n' + 'const hists = $("Get Payroll History").all();'
        + '\n' + 'const docs = $("Get Renew Documents").all();'
        + '\n' + 'const sweepP0 = $("Get Complaints Page 0").all();'
        + '\n' + 'const sweepExtra = $("Get Extra Sweep Pages").all();'
        + '\n' + 'const threadPlan = $("Build Thread Requests").all();'
        + '\n' + 'const threadResp = $("Get Comment Threads").all();'
        + '\n' + ''
        + '\n' + '// SCRUB BEFORE THE MODEL EVER SEES IT. Complaint threads carry maid phone numbers, and this'
        + '\n' + '// check touches salaries and staff personal data. Nothing identifying may reach the agent,'
        + '\n' + '// the execution log or the case store beyond the maid id.'
        + '\n' + 'function scrub(t) {'
        + '\n' + '  return String(t === undefined || t === null ? "" : t)'
        + '\n' + '    .replace(/<[^>]*>/g, " ")'
        + '\n' + '    .replace(/&nbsp;/g, " ")'
        + '\n' + '    .replace(/&amp;/g, "&")'
        + '\n' + '    .replace(/(?:\\+?\\d[\\d\\s().-]{7,}\\d)/g, "[PHONE REDACTED]")'
        + '\n' + '    .replace(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, "[EMAIL REDACTED]")'
        + '\n' + '    .replace(/\\s+/g, " ")'
        + '\n' + '    .trim()'
        + '\n' + '    .slice(0, 1500);'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const threadsByComplaint = new Map();'
        + '\n' + 'for (let i = 0; i < threadResp.length; i++) {'
        + '\n' + '  const plan = threadPlan[i] ? threadPlan[i].json : null;'
        + '\n' + '  if (!plan || !plan.complaint_id) continue;'
        + '\n' + '  const r = threadResp[i].json || {};'
        + '\n' + '  if (r.statusCode !== 200 || !r.body) { threadsByComplaint.set(plan.complaint_id + ":bad", true); continue; }'
        + '\n' + '  const rows = Array.isArray(r.body) ? r.body : (r.body.content || []);'
        + '\n' + '  // NEWEST-FIRST ordering is preserved deliberately: the final decision is at the TOP, and'
        + '\n' + '  // re-sorting it would bury a refusal under the request that preceded it.'
        + '\n' + '  threadsByComplaint.set(plan.complaint_id, rows.map(function (x) { return { text: scrub(x.text), at: x.creationDate || null }; }));'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + '// Group extra sweep pages by maid. Each extra request carried its maid_id, and the response'
        + '\n' + '// items come back in the same order the requests went out.'
        + '\n' + 'const extraPlan = $("Build Sweep Pages").all();'
        + '\n' + 'const extraByMaid = new Map();'
        + '\n' + 'for (let i = 0; i < sweepExtra.length; i++) {'
        + '\n' + '  const plan = extraPlan[i] ? extraPlan[i].json : null;'
        + '\n' + '  if (!plan || !plan.maid_id) continue;'
        + '\n' + '  const r = sweepExtra[i].json || {};'
        + '\n' + '  if (r.statusCode !== 200 || !r.body) { extraByMaid.set(plan.maid_id + ":bad", true); continue; }'
        + '\n' + '  const list = extraByMaid.get(plan.maid_id) || [];'
        + '\n' + '  for (const c of (r.body.content || [])) list.push(c);'
        + '\n' + '  extraByMaid.set(plan.maid_id, list);'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'const out = [];'
        + '\n' + 'for (let i = 0; i < cands.length; i++) {'
        + '\n' + '  const c = cands[i].json;'
        + '\n' + '  const maidId = c.maid_id;'
        + '\n' + '  const trace = []; const gaps = [];'
        + '\n' + '  function fired(order, num, name, detail) { trace.push({ order: order, numeral: num, name: name, detail: detail || null }); }'
        + '\n' + '  function gap(text, blocks) { gaps.push({ text: text, blocks_clean: blocks === true }); }'
        + '\n' + ''
        + '\n' + '  const prof = (profiles[i] || {}).json || {};'
        + '\n' + '  const rule = (rules[i] || {}).json || {};'
        + '\n' + '  const hist = (hists[i] || {}).json || {};'
        + '\n' + '  const doc = (docs[i] || {}).json || {};'
        + '\n' + '  const s0 = (sweepP0[i] || {}).json || {};'
        + '\n' + ''
        + '\n' + '  const p = prof.statusCode === 200 ? (prof.body || {}) : {};'
        + '\n' + '  const ruleRows = rule.statusCode === 200 && Array.isArray(rule.body) ? rule.body : null;'
        + '\n' + '  const noRule = rule.statusCode === 400 && /No Rule is found/i.test(JSON.stringify(rule.body || {}));'
        + '\n' + '  const history = hist.statusCode === 200 && Array.isArray(hist.body) ? hist.body : [];'
        + '\n' + '  const renewReqs = doc.statusCode === 200 && Array.isArray(doc.body) ? doc.body : [];'
        + '\n' + '  const renewUnreadable = doc.statusCode !== 200;'
        + '\n' + ''
        + '\n' + '  // Assemble HER evidence: every complaint swept, with its thread. This is what the verifier'
        + '\n' + '  // actually reads - without it the agent would be asked to judge prose it was never given.'
        + '\n' + '  const evidence = [];'
        + '\n' + '  let threadUnreadable = false;'
        + '\n' + '  function addComplaint(cx) {'
        + '\n' + '    if (!cx || cx.id === undefined) return;'
        + '\n' + '    const cid = String(cx.id);'
        + '\n' + '    if (threadsByComplaint.get(cid + ":bad")) threadUnreadable = true;'
        + '\n' + '    const ctype = cx.complaintType;'
        + '\n' + '    evidence.push({ complaint_id: cid,'
        + '\n' + '      // The type arrives sometimes as an object {label:...} and sometimes as a bare string -'
        + '\n' + '      // code that assumes a dict throws. It is recorded for context only; rule 80 forbids'
        + '\n' + '      // deciding from it.'
        + '\n' + '      type: ctype && typeof ctype === "object" ? (ctype.label || null) : (ctype || null),'
        + '\n' + '      description: scrub(cx.initialDescription),'
        + '\n' + '      comment_count: Number(cx.commentCount || 0),'
        + '\n' + '      thread: threadsByComplaint.get(cid) || [] });'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Evidence sweep reconciliation.'
        + '\n' + '  let sweepOk = false; let pulled = 0; let totalEl = null;'
        + '\n' + '  if (s0.statusCode === 200 && s0.body) {'
        + '\n' + '    totalEl = Number(s0.body.totalElements);'
        + '\n' + '    const ids = new Set();'
        + '\n' + '    for (const x of (s0.body.content || [])) { ids.add(x.id); addComplaint(x); }'
        + '\n' + '    for (const x of (extraByMaid.get(maidId) || [])) { ids.add(x.id); addComplaint(x); }'
        + '\n' + '    pulled = ids.size;'
        + '\n' + '    sweepOk = Number.isFinite(totalEl) && pulled === totalEl && !extraByMaid.get(maidId + ":bad");'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  function settle(order, num, name, verdict, reason, extra) {'
        + '\n' + '    fired(order, num, name, reason);'
        + '\n' + '    const base = { case_key: maidId + ":" + AUDITED_KEY, run_id: params.run_id, maid_id: maidId,'
        + '\n' + '      payroll_month: AUDITED, verdict: verdict, settled_by: "Order " + order + " " + num,'
        + '\n' + '      reason: reason, trace: trace, gaps: gaps.map(function (g) { return g.text; }),'
        + '\n' + '      gaps_blocking: gaps.filter(function (g) { return g.blocks_clean; }).map(function (g) { return g.text; }),'
        + '\n' + '      nationality: (p.nationality || {}).name || c.nationality_name || null,'
        + '\n' + '      live_out: (p.liveOut === true || p.liveOut === false) ? p.liveOut : null,'
        + '\n' + '      sweep_reconciled: sweepOk, sweep_pulled: pulled, sweep_total: totalEl,'
        + '\n' + '      evidence: evidence, threads_read: evidence.filter(function (e) { return e.thread.length > 0; }).length,'
        + '\n' + '      rulings_checksum: cfg.rulings_checksum, scored_at: new Date().toISOString(),'
        + '\n' + '      _run: c._run };'
        + '\n' + '    out.push({ json: Object.assign(base, extra || {}) });'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 10 (1) / Order 20 (2) are structural: every record was fetched BY maid id, and the'
        + '\n' + '  // population request sends maidPayrollTypes:["MAID_CC"], which compiles to'
        + '\n' + '  // housemaidType <> MAID_VISA. There is no name-matching path anywhere in this flow.'
        + '\n' + '  fired(10, "(1)", "Join by ERP maid id, never by name or MOL", "every record fetched by maid id");'
        + '\n' + '  fired(20, "(2)", "Exclude MaidVisa maids at the query, never after scoring", "population requested MAID_CC only");'
        + '\n' + ''
        + '\n' + '  // Order 25 (12) - a walk that does not reconcile is unresolved, never clean.'
        + '\n' + '  if (!sweepOk) {'
        + '\n' + '    settle(25, "(12)", "A walk that does not reconcile is unresolved, never clean", "pending",'
        + '\n' + '      "evidence sweep did not reconcile: pulled " + pulled + " of " + totalEl + " complaints. \\"Not on a page\\" and \\"does not exist\\" are indistinguishable, and the false direction condemns.");'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  const paidRead = readPaid(history, AUDITED);'
        + '\n' + '  if (paidRead.paid === null) {'
        + '\n' + '    // This is also how the OPEN paying-status question is answered without a ruling: take every'
        + '\n' + '    // maid the cohort filter returns, and let the presence of a payroll row decide who was paid.'
        + '\n' + '    settle(0, "-", "No payroll row for the audited month", "out_of_population",'
        + '\n' + '      "no payroll row for " + AUDITED + " - she was not on that month\'s payroll. Never a zero salary and never clean.");'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + '  const paid = paidRead.paid;'
        + '\n' + '  // An unreadable thread cannot be read as "nothing was said": the thread is the only place a'
        + '\n' + '  // REFUSAL is recorded, so a failed thread read removes the one signal that convicts.'
        + '\n' + '  if (threadUnreadable) gap("at least one comment thread could not be read; the thread is the ONLY place a denial is recorded, so an absent refusal cannot be relied on.", true);'
        + '\n' + '  if (paidRead.disagree) gap("basicSalary and companySalary disagree on the audited month; basicSalary used, per the spec\'s designated field. The two are NOT always identical (falsified live 2026-08-30).", false);'
        + '\n' + ''
        + '\n' + '  fired(40, "(4)", "Read the standard live from ERP, never from a spreadsheet", "salary rule read live per maid");'
        + '\n' + '  const ruleTotal = noRule ? null : sumRule(ruleRows);'
        + '\n' + ''
        + '\n' + '  // Order 42 (7) - no live standard is unresolved, never clean.'
        + '\n' + '  if (ruleTotal === null) {'
        + '\n' + '    settle(42, "(7)", "No live standard is unresolved, never clean", "pending",'
        + '\n' + '      noRule ? "salary rule returned \\"No Rule is found!\\" - a real answer meaning no standard, never \\"no ceiling applies\\"."'
        + '\n' + '             : "salary-rule components could not be summed, so the standard is unknown. Defaulting it to 0 flags everyone; to infinity clears everyone.");'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + '  if (p.liveOut !== true && p.liveOut !== false) {'
        + '\n' + '    settle(42, "(7)", "No live standard is unresolved, never clean", "pending",'
        + '\n' + '      "living status is unknown. Do not infer live-in: it picks the lower standard and manufactures an over-ceiling finding.");'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + '  if (!p.nationality || !p.nationality.name) {'
        + '\n' + '    settle(42, "(7)", "No live standard is unresolved, never clean", "pending",'
        + '\n' + '      "nationality missing, so no standard can be selected. ERP itself refuses to evaluate a salary cap without it.");'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 45 (14) - a nationality with no renewal_raise tag earns no renewal raise.'
        + '\n' + '  const rr = readRenewalRaise(p.nationality.tags);'
        + '\n' + '  const raisePer = rr === null ? 0 : rr;'
        + '\n' + '  fired(45, "(14)", "A nationality with no renewal_raise tag earns no renewal raise",'
        + '\n' + '    rr === null ? "no renewal_raise tag on " + p.nationality.name + " - her allowance is the base alone" : "renewal_raise:" + rr);'
        + '\n' + ''
        + '\n' + '  // Order 48 (16) - a ruled cohort level replaces the salary-rule total as the default base.'
        + '\n' + '  const ck = p.nationality.name + "|" + (p.liveOut ? "live_out" : "live_in");'
        + '\n' + '  const ruled = RULINGS.ruled_cohort_level[ck];'
        + '\n' + '  const hasRuled = Number.isFinite(ruled);'
        + '\n' + '  const base = hasRuled ? ruled : ruleTotal;'
        + '\n' + '  if (hasRuled) fired(48, "(16)", "A ruled cohort level replaces the salary-rule total as the default base",'
        + '\n' + '    "cohort " + ck + " carries a ruled level; renewal raises do not stack on top of it");'
        + '\n' + ''
        + '\n' + '  // Order 50 (5) - deferred to the verifier: the approved base exists ONLY as prose. There is'
        + '\n' + '  // no numeric field on Complaint at all, and raiseApproved was empty on 14 of 14 candidates.'
        + '\n' + '  fired(50, "(5)", "An approved base overrides the nationality standard", "deferred to the verifier - the approved base exists only as a sentence");'
        + '\n' + ''
        + '\n' + '  // Order 55 (9) - count renewals by r-visa document date, never by request date.'
        + '\n' + '  const rens = countRenewals(renewReqs, MONTH_END);'
        + '\n' + '  if (renewUnreadable) gap("renew-request documents were unreadable; the renewal count is a FLOOR - the true allowance can only be higher.", false);'
        + '\n' + '  fired(55, "(9)", "Count renewals by r-visa document date, never by request date", rens.count + " qualifying renewal(s)");'
        + '\n' + ''
        + '\n' + '  // Order 57 (11) - MV to CC switchers earn the raise on CC service, not on visa renewal.'
        + '\n' + '  // INTERIM until a CC-service clock is readable: such a maid is pending, NEVER red, and must'
        + '\n' + '  // not reach the candidate route on a missing renewal alone.'
        + '\n' + '  // Stamped by Narrow To Candidates from the separately enumerated MV_TO_CC cohort - there is'
        + '\n' + '  // no per-maid route that exposes this, so it cannot be read off the profile.'
        + '\n' + '  const isSwitcher = c.is_switcher === true;'
        + '\n' + '  if (isSwitcher) gap("MV to CC switcher: her raise is earned on 24 continuous months as CC and no CC-service clock is readable. Her allowance is composed as the base alone, which is a FLOOR.", false);'
        + '\n' + ''
        + '\n' + '  // Order 58 (10) - renewal raises are capped per maid for life; the cap is a RULING.'
        + '\n' + '  const counted = isSwitcher ? 0 : Math.min(rens.count, CAP);'
        + '\n' + '  const cappedOut = !isSwitcher && rens.count > CAP;'
        + '\n' + '  const raiseComponent = hasRuled ? 0 : raisePer * counted;'
        + '\n' + '  const allowed = base + raiseComponent;'
        + '\n' + '  fired(58, "(10)", "Renewal raises are capped per maid for life, and the cap is a ruling not an ERP value",'
        + '\n' + '    "allowed = " + base + " + " + raiseComponent + (cappedOut ? " (CAPPED OUT: " + rens.count + " renewals against a lifetime cap of " + CAP + ")" : ""));'
        + '\n' + ''
        + '\n' + '  const delta = paid - allowed;'
        + '\n' + '  const recurring = detectRecurring(history);'
        + '\n' + '  const prevailing = prevailingTotal(history);'
        + '\n' + '  const common = { base_aed: base, allowed_aed: allowed, paid_vs_allowed: delta,'
        + '\n' + '    renewals_counted: counted, renewals_total: rens.count, capped_out: cappedOut,'
        + '\n' + '    recurring_addition_aed: recurring ? recurring.amount : null,'
        + '\n' + '    recurring_addition_months: recurring ? recurring.months_count : null,'
        + '\n' + '    prevailing_vs_allowed: prevailing ? prevailing.total - allowed : null };'
        + '\n' + ''
        + '\n' + '  // Order 60 (6) - above the allowed amount is a CANDIDATE, not a verdict.'
        + '\n' + '  if (delta > 0) {'
        + '\n' + '    if (isSwitcher) {'
        + '\n' + '      settle(57, "(11)", "MV to CC switchers earn the renewal raise on CC service, not on visa renewal", "pending",'
        + '\n' + '        "paid above an allowance that cannot be composed for an MV to CC switcher, because no CC-service clock is readable. Pending, never red.", common);'
        + '\n' + '      continue;'
        + '\n' + '    }'
        + '\n' + '    settle(60, "(6)", "Above the allowed amount is a candidate, not a verdict", "candidate",'
        + '\n' + '      "paid above her composed allowance - a candidate for the verifier, never a verdict on its own",'
        + '\n' + '      Object.assign({ route_reason: cappedOut ? "above_allowance_and_capped_out" : "above_allowance" }, common));'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 62 (13) - a recurring identical addition routes even AT standard. Runs BEFORE the'
        + '\n' + '  // clean gate on purpose: it is the only rule that can see a maid reading exactly at standard'
        + '\n' + '  // who is nevertheless paid above it.'
        + '\n' + '  if (recurring) {'
        + '\n' + '    settle(62, "(13)", "A recurring identical addition routes to the verifier even at standard", "candidate",'
        + '\n' + '      "at or below her allowance, but " + recurring.amount + " recurs across " + recurring.months_count + " consecutive months of additions - the shape where a raise is paid through ADDITIONS while total salary reads at standard",'
        + '\n' + '      Object.assign({ route_reason: "recurring_addition_at_standard" }, common));'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Build-added guard, declared in docs/spec-deviations.md, landed on the existing catch-all'
        + '\n' + '  // rather than given a numeral of its own - inventing rule numbers is a governance act and the'
        + '\n' + '  // ACP is the only place rules live. A reduced audited month cannot show her rate is compliant.'
        + '\n' + '  if (prevailing && prevailing.total > allowed) {'
        + '\n' + '    settle(78, "(15)", "A maid no rule settled is pending, never clean", "pending",'
        + '\n' + '      "the audited month reads at or below her allowance, but her PREVAILING monthly total (the modal figure across " + prevailing.months + " of the months read) is ABOVE it. The audited month is reduced, so it cannot show her rate is compliant.",'
        + '\n' + '      Object.assign({ route_reason: "audited_month_reduced_below_prevailing_rate" }, common));'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // A gap blocks a clean ONLY if resolving it could LOWER her allowance. An unreadable renewal'
        + '\n' + '  // count and an unresolvable CC-service clock can only RAISE it, so a maid already below the'
        + '\n' + '  // floor composed without them is provably fine whatever the answer - and marking those'
        + '\n' + '  // pending would bury ~1,500 switchers every run in cases that cannot change.'
        + '\n' + '  const blocking = gaps.filter(function (g) { return g.blocks_clean; });'
        + '\n' + '  if (blocking.length > 0) {'
        + '\n' + '    settle(78, "(15)", "A maid no rule settled is pending, never clean", "pending",'
        + '\n' + '      "at or below her allowance, but the case carries an unresolved gap that could lower it: " + blocking.map(function (g) { return g.text; }).join(" | "), common);'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 65 (14) - a clean has to be PRODUCED by a rule, never assumed.'
        + '\n' + '  settle(65, "(14)", "At or below the allowed amount is clean, for that maid and month only", "clean",'
        + '\n' + '    "at or below her composed allowance, and no earlier rule routed or halted her", common);'
        + '\n' + '}'
        + '\n' + ''
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_scored", run_id: params.run_id, cases: out.length }));'
        + '\n' + 'return out;'
    }
  },
  output: [{ maid_id: '3978', verdict: 'candidate', settled_by: 'Order 60 (6)' }]
});

const selectVerifier = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select Verifier Cases',
    position: [4280, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const all = $input.all().map(function (i) { return i.json; });'
        + '\n' + 'const cands = all.filter(function (c) { return c.verdict === "candidate"; });'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_select_verifier", total: all.length, to_verify: cands.length }));'
        + '\n' + 'if (cands.length === 0) return [{ json: { _none: true } }];'
        + '\n' + 'return cands.map(function (c) { return { json: c }; });'
    }
  },
  output: [{ maid_id: '3978', verdict: 'candidate', _none: false }]
});

const anyVerifier = ifElse({
  version: 2.3,
  config: {
    name: 'Any Verifier Cases?',
    position: [4500, -120],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json._none === true }}'), operator: { type: 'boolean', operation: 'false', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const anthropicModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.5,
  config: {
    name: 'Anthropic Chat Model',
    position: [4720, 100],
    parameters: { model: { __rl: true, mode: 'list', value: 'claude-sonnet-4-5-20250929' }, options: { temperature: 0 } },
    credentials: { anthropicApi: newCredential('Anthropic') }
  }
});

const verdictSchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Reading Schema',
    position: [4900, 100],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "sweep_reconciled": true, "authorisation_found": true, "approved_amount": 2500, "approved_amount_is_base": true, "approval_denied": false, "renewal_raises_consumed_by_approval": 0, "renewals_since_approval": 1, "justification_is_cohort_wide": false, "addition_is_raise_in_disguise": null, "read_from_type_only": false, "todo_ids": ["228006"], "documented_amounts": [2500], "notes": "one line on what the evidence says" }'
    }
  }
});

const verifyAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Read The Evidence',
    position: [4780, -220],
    parameters: {
      promptType: 'define',
      text: expr('Maid id {{ $json.maid_id }}, payroll month {{ $json.payroll_month }}.\nRouted because: {{ $json.route_reason }}.\nEvidence sweep reconciled: {{ $json.sweep_reconciled }} ({{ $json.sweep_pulled }} of {{ $json.sweep_total }} complaints read).\nQualifying renewals counted: {{ $json.renewals_counted }} (total found {{ $json.renewals_total }}, capped out: {{ $json.capped_out }}).\nRecurring monthly addition detected: {{ $json.recurring_addition_aed }} across {{ $json.recurring_addition_months }} months.\n\nHer complaints and salary To-dos:\n{{ JSON.stringify($json.evidence) }}'),
      hasOutputParser: true,
      options: {
        systemMessage: 'You read prose and report WHAT THE SENTENCES SAY. You do not decide whether anyone is'
          + '\n' + 'overpaid: the arithmetic is done downstream where it is tested. Never output a verdict, a'
          + '\n' + 'recommendation, or the words finding / clean / pending.'
          + '\n' + ''
          + '\n' + 'You are reading a Company Contract maid\'s complaints and salary To-dos for one payroll'
          + '\n' + 'month. Somewhere in them there may be a sentence a human wrote authorising what she is paid.'
          + '\n' + 'There is NO structured amount field anywhere - if the authorisation exists, it is a sentence.'
          + '\n' + ''
          + '\n' + 'RULE 80 - Open the To-do; its type is not its content.'
          + '\n' + 'Read the description AND the comment thread. NEVER decide from the To-do type. A type match'
          + '\n' + 'is evidence a ticket exists, never that it authorises anything: raises appear under at least'
          + '\n' + 'seven different types, and on one real record the type is "Maid Wants To Resign" and the'
          + '\n' + 'raise inside it was DENIED. NEVER use the sibling summary field - it is auto-compression and'
          + '\n' + 'is often blank. The thread is NEWEST-FIRST, so the final decision is at the TOP. A blank'
          + '\n' + 'description with a populated thread is common; blank is not "nothing was written". An empty'
          + '\n' + 'thread means nothing was discussed, NOT that the raise was approved. If you were given only'
          + '\n' + 'types and no bodies, set read_from_type_only true and stop.'
          + '\n' + ''
          + '\n' + 'RULE 85 - An approved base is not a final salary. THE SINGLE MOST ERROR-PRONE LINE HERE.'
          + '\n' + 'Reading an approved figure as a ceiling wrongly called one maid the strongest finding when'
          + '\n' + 'she is clean, and would have produced three false reds out of five. Decide which the sentence'
          + '\n' + 'states:'
          + '\n' + '  * An approved BASE - a starting salary that was agreed; renewal raises she earns afterwards'
          + '\n' + '    still stack on top. Set approved_amount_is_base true.'
          + '\n' + '    "her ERP salary is 2000 but she was promised 2500" -> base 2500.'
          + '\n' + '    "500 salary raise, new salary should be 2500" -> base 2500.'
          + '\n' + '  * A stated FINAL salary - the sentence names the resulting figure and the raises that'
          + '\n' + '    produced it, so those raises are CONSUMED. Set approved_amount_is_base false and set'
          + '\n' + '    renewal_raises_consumed_by_approval to how many renewal raises it used up.'
          + '\n' + '    "a raise of 700 upon renewal, her salary should become 2700", where the nationality'
          + '\n' + '    renewal raise is 350 -> final 2700, 2 raises consumed.'
          + '\n' + 'If you genuinely cannot tell, set approved_amount null and describe both readings in notes.'
          + '\n' + 'That is an honest cannot-tell. Do NOT guess.'
          + '\n' + ''
          + '\n' + 'RULE 90 - A blanket cohort pattern never clears an individual.'
          + '\n' + '"Everyone in this cohort is paid this" explains a cluster and authorises nobody. Set'
          + '\n' + 'justification_is_cohort_wide true and leave approved_amount null.'
          + '\n' + ''
          + '\n' + 'RULE 105 - A persistent monthly addition is a raise in disguise.'
          + '\n' + 'Only when routed for a recurring addition. A maid can read exactly at standard while a raise'
          + '\n' + 'is paid through recurring monthly ADDITIONS. NEVER treat a one-off addition as a raise:'
          + '\n' + 'RECURRENCE IS THE DISCRIMINATOR, NOT SIZE - a 1500 airfare dwarfs a 350 raise and is a'
          + '\n' + 'one-off. Set addition_is_raise_in_disguise true, false, or null if you cannot tell.'
          + '\n' + ''
          + '\n' + 'A RECORDED REFUSAL. If the thread records the raise being REFUSED, set approval_denied true.'
          + '\n' + 'A denied raise is not an absence of authorisation - it is authorisation withheld, and she is'
          + '\n' + 'being paid it anyway. The thread is the ONLY place a denial is recorded: one real To-do looks'
          + '\n' + 'like an approval from both its type and its description and is a refusal in its thread.'
          + '\n' + ''
          + '\n' + 'NEVER infer an amount that is not written down - documented_amounts holds figures you'
          + '\n' + 'actually read. NEVER put a name, phone number or contact detail in any field: complaint'
          + '\n' + 'threads carry maid phone numbers. Identify her by maid id only.'
      }
    },
    subnodes: { model: anthropicModel, outputParser: verdictSchema }
  },
  output: [{ output: { sweep_reconciled: true, authorisation_found: false } }]
});

const mergeReadings = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge Readings',
    position: [5000, -220],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const cases = $("Select Verifier Cases").all().map(function (i) { return i.json; });'
        + '\n' + 'const reads = $input.all();'
        + '\n' + 'const out = [];'
        + '\n' + 'for (let i = 0; i < cases.length; i++) {'
        + '\n' + '  const r = (reads[i] || {}).json || {};'
        + '\n' + '  const reading = r.output || r;'
        + '\n' + '  out.push({ json: Object.assign({}, cases[i], { _reading: reading }) });'
        + '\n' + '}'
        + '\n' + 'return out;'
    }
  },
  output: [{ maid_id: '3978', _reading: {} }]
});

const noVerifier = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Verifier Needed',
    position: [5000, -20],
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: '// PASSTHROUGH, NOT AN EMPTY RETURN - see No Extra Sweep Pages. Returning [] here would skip'
        + '\n' + '// Adjudicate and every delivery node, so a run with no candidates would write no run row at'
        + '\n' + '// all and be indistinguishable in the Runs log from a run that never happened.'
        + '\n' + 'return $input.all();'
    }
  },
  output: [{ _none: true }]
});

const joinVerdicts = merge({
  version: 3.2,
  config: { name: 'Join Verdict Paths', position: [5220, -120], parameters: { mode: 'append', numberInputs: 2 } }
});

const adjudicate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Adjudicate',
    position: [5440, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// The eight LIVE verifier rules, in Order (80, 85, 90, 105, 108, 110, 112, 115).'
        + '\n' + '// The AGENT reads prose; THIS composes and decides, because "an approved base is not a final'
        + '\n' + '// salary" is the single most error-prone line in the spec and must be testable.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const CAP = cfg.rulings.renewal_raise_lifetime_cap;'
        + '\n' + 'const scored = $("Score Deterministic").all().map(function (i) { return i.json; });'
        + '\n' + 'const verified = $input.all().map(function (i) { return i.json; });'
        + '\n' + 'const byKey = new Map();'
        + '\n' + 'for (const v of verified) byKey.set(v.case_key, v);'
        + '\n' + ''
        + '\n' + 'const out = [];'
        + '\n' + 'for (const det of scored) {'
        + '\n' + '  if (det.verdict !== "candidate") { out.push({ json: det }); continue; }'
        + '\n' + '  const v = byKey.get(det.case_key);'
        + '\n' + '  // A case still holding candidate never reached a verifier verdict, and must NOT drift to'
        + '\n' + '  // clean: Order 78 (15) is explicit that anything no rule settled is pending, never clean.'
        + '\n' + '  if (!v || !v._reading) {'
        + '\n' + '    out.push({ json: Object.assign({}, det, { verdict: "pending", settled_by: "Order 78 (15)",'
        + '\n' + '      reason: "routed to the verifier but no reading came back - pending, never clean." }) });'
        + '\n' + '    continue;'
        + '\n' + '  }'
        + '\n' + '  const r = v._reading || {};'
        + '\n' + '  const trace = (det.trace || []).slice();'
        + '\n' + '  // The scorer emits allowed_aed, NOT allowed. Reading the wrong name here made paid and'
        + '\n' + '  // raisePer NaN, every comparison below false, and a CLEAN maid fell through to pending -'
        + '\n' + '  // silently, because NaN serialises to null and pending looks like an honest cannot-tell.'
        + '\n' + '  // Caught only by running the flow end to end. The guard makes a future rename LOUD.'
        + '\n' + '  const paid = det.allowed_aed + det.paid_vs_allowed;'
        + '\n' + '  const raisePer = det.renewals_counted > 0 ? (det.allowed_aed - det.base_aed) / det.renewals_counted : 0;'
        + '\n' + '  if (!Number.isFinite(paid) || !Number.isFinite(raisePer)) {'
        + '\n' + '    throw new Error("CASE CONTRACT BROKEN for " + det.case_key + ": the scorer did not supply the numeric fields Adjudicate composes with (allowed_aed, base_aed, paid_vs_allowed, renewals_counted). Run stopped rather than turning composable cases into pendings.");'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  function settle(order, num, name, verdict, reason, extra) {'
        + '\n' + '    trace.push({ order: order, numeral: num, name: name, detail: reason });'
        + '\n' + '    out.push({ json: Object.assign({}, det, { verdict: verdict, settled_by: "Verifier Order " + order + " " + num,'
        + '\n' + '      reason: reason, trace: trace, _reading: r }, extra || {}) });'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 80 (1) - a reading derived from To-do TYPES alone is worthless.'
        + '\n' + '  if (r.read_from_type_only === true) {'
        + '\n' + '    settle(80, "(1)", "Open the To-do; its type is not its content", "pending",'
        + '\n' + '      "the reading was derived from To-do TYPES without opening the description and thread. A type is evidence a ticket exists, never that it authorises anything."); continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // A recorded REFUSAL is not an absence of authorisation - it is authorisation WITHHELD.'
        + '\n' + '  if (r.approval_denied === true) {'
        + '\n' + '    settle(112, "(7)", "A reconciled sweep finding no authorisation is the finding",'
        + '\n' + '      r.sweep_reconciled === true ? "finding" : "pending",'
        + '\n' + '      r.sweep_reconciled === true ? "the thread RECORDS A REFUSAL of the raise she is being paid, and the sweep reconciled."'
        + '\n' + '        : "the thread records a refusal, but the sweep did not reconcile, so a later approval cannot be ruled out."); continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 90 (2) - a blanket cohort pattern never clears an individual.'
        + '\n' + '  if (r.justification_is_cohort_wide === true && !Number.isFinite(r.approved_amount)) {'
        + '\n' + '    settle(90, "(2)", "A blanket cohort pattern never clears an individual", "pending",'
        + '\n' + '      "the only justification offered is a cohort-wide pattern, which explains the cluster but authorises no individual. If the standard is wrong, fix the standard."); continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 105 (6) - a persistent monthly addition is a raise in disguise.'
        + '\n' + '  if (det.route_reason === "recurring_addition_at_standard") {'
        + '\n' + '    if (r.addition_is_raise_in_disguise === false) {'
        + '\n' + '      settle(105, "(6)", "A persistent monthly addition is a raise in disguise", "clean",'
        + '\n' + '        "the recurring addition is judged a benefit rather than a raise, and her total salary is at or below her allowance."); continue;'
        + '\n' + '    }'
        + '\n' + '    if (r.addition_is_raise_in_disguise !== true) {'
        + '\n' + '      settle(115, "(9)", "Evidence that neither clears nor convicts is pending", "pending",'
        + '\n' + '        "a recurring addition was detected but the verifier could not tell a raise from a benefit."); continue;'
        + '\n' + '    }'
        + '\n' + '    if (!(r.authorisation_found === true && Number.isFinite(r.approved_amount))) {'
        + '\n' + '      settle(112, "(7)", "A reconciled sweep finding no authorisation is the finding",'
        + '\n' + '        r.sweep_reconciled === true ? "finding" : "pending",'
        + '\n' + '        r.sweep_reconciled === true ? "a raise is being paid through recurring monthly additions while her total salary reads at or below standard, and a reconciled sweep found nothing authorising it."'
        + '\n' + '          : "the recurring addition is judged a raise, but the evidence sweep did not reconcile."); continue;'
        + '\n' + '    }'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  if (Number.isFinite(r.approved_amount)) {'
        + '\n' + '    const consumed = Number.isFinite(r.renewal_raises_consumed_by_approval) ? r.renewal_raises_consumed_by_approval : 0;'
        + '\n' + '    const remaining = Math.max(0, CAP - consumed);'
        + '\n' + '    const since = Number.isFinite(r.renewals_since_approval) ? r.renewals_since_approval : det.renewals_counted;'
        + '\n' + '    const applied = Math.min(since, remaining);'
        + '\n' + '    const allowedV = r.approved_amount + applied * raisePer;'
        + '\n' + ''
        + '\n' + '    // Order 108 (8) - EXACTLY. Not approximately, not close enough.'
        + '\n' + '    if (paid === allowedV) {'
        + '\n' + '      settle(108, "(8)", "Evidence that composes exactly to the paid amount clears that maid, that month", "clean",'
        + '\n' + '        "an approved figure " + (r.approved_amount_is_base === false ? "(a stated final salary)" : "(an approved base)") + ", plus " + applied + " renewal raise(s) earned since within the remaining lifetime cap of " + remaining + ", composes EXACTLY to what she was paid.",'
        + '\n' + '        { approved_amount_aed: r.approved_amount, allowed_verified_aed: allowedV }); continue;'
        + '\n' + '    }'
        + '\n' + '    // Order 110 (4) - paid above an approved figure is a reconciliation finding.'
        + '\n' + '    if (paid > allowedV) {'
        + '\n' + '      settle(110, "(4)", "Paid above an approved figure is a reconciliation finding", "finding",'
        + '\n' + '        "she is paid above the figure an approver wrote plus every raise she has earned since." + (consumed > 0 ? " The approval itself consumed " + consumed + " of her " + CAP + " lifetime renewal raises, so no further raise was available to her." : ""),'
        + '\n' + '        { approved_amount_aed: r.approved_amount, allowed_verified_aed: allowedV }); continue;'
        + '\n' + '    }'
        + '\n' + '    // Paid BELOW the composed figure: not exact, so (8) cannot clear her; and this check looks'
        + '\n' + '    // upward only, so it is not a finding either.'
        + '\n' + '    settle(115, "(9)", "Evidence that neither clears nor convicts is pending", "pending",'
        + '\n' + '      "an approved figure exists but composes ABOVE what she was actually paid, so the evidence does not reconcile on this reading.",'
        + '\n' + '      { approved_amount_aed: r.approved_amount, allowed_verified_aed: allowedV }); continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 112 (7) - THE main red, and it only holds because the sweep reconciled.'
        + '\n' + '  if (r.authorisation_found !== true) {'
        + '\n' + '    if (r.sweep_reconciled === true) {'
        + '\n' + '      settle(112, "(7)", "A reconciled sweep finding no authorisation is the finding", "finding",'
        + '\n' + '        "the evidence sweep reconciled and NOTHING anywhere authorises the excess - no approved base, no raise To-do, no complaint bearing on her pay."); continue;'
        + '\n' + '    }'
        + '\n' + '    settle(25, "(12)", "A walk that does not reconcile is unresolved, never clean", "pending",'
        + '\n' + '      "no authorisation was found, but the sweep did not reconcile - \\"not on a page\\" and \\"does not exist\\" are indistinguishable, and the false direction condemns."); continue;'
        + '\n' + '  }'
        + '\n' + ''
        + '\n' + '  // Order 115 (9) - the last verifier rule. Not a clearance and not an accusation.'
        + '\n' + '  settle(115, "(9)", "Evidence that neither clears nor convicts is pending", "pending",'
        + '\n' + '    "raise authorisations exist and are documented, but no single reading of them composes to what she was paid - the arithmetic needs a human.");'
        + '\n' + '}'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_adjudicated", cases: out.length }));'
        + '\n' + 'return out;'
    }
  },
  output: [{ maid_id: '3978', verdict: 'finding' }]
});

const buildCaseRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Case Rows',
    position: [5660, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// THE CASE STORE IS WHERE AMOUNTS BELONG. Per-maid figures, identifiers and gaps live here,'
        + '\n' + '// behind the case - never in chat, a run summary, a log or an email, which carry counts,'
        + '\n' + '// flags and totals only. A maid is identified by maid id, and her position is expressed'
        + '\n' + '// RELATIVE TO ENTITLEMENT (paid_vs_allowed), never as an absolute salary.'
        + '\n' + 'return $input.all().map(function (i) {'
        + '\n' + '  const c = i.json;'
        + '\n' + '  const r = c._reading || {};'
        + '\n' + '  return { json: {'
        + '\n' + '    case_key: c.case_key, run_id: c.run_id, maid_id: String(c.maid_id), payroll_month: c.payroll_month,'
        + '\n' + '    verdict: c.verdict, settled_by: c.settled_by, reason: String(c.reason || "").slice(0, 900),'
        + '\n' + '    route_reason: c.route_reason || null,'
        + '\n' + '    nationality: c.nationality, live_out: c.live_out,'
        + '\n' + '    base_aed: c.base_aed === undefined ? null : c.base_aed,'
        + '\n' + '    allowed_aed: c.allowed_aed === undefined ? null : c.allowed_aed,'
        + '\n' + '    paid_vs_allowed: c.paid_vs_allowed === undefined ? null : c.paid_vs_allowed,'
        + '\n' + '    prevailing_vs_allowed: c.prevailing_vs_allowed === undefined ? null : c.prevailing_vs_allowed,'
        + '\n' + '    renewals_counted: c.renewals_counted === undefined ? null : c.renewals_counted,'
        + '\n' + '    renewals_total: c.renewals_total === undefined ? null : c.renewals_total,'
        + '\n' + '    capped_out: c.capped_out === true,'
        + '\n' + '    recurring_addition_aed: c.recurring_addition_aed === undefined ? null : c.recurring_addition_aed,'
        + '\n' + '    recurring_addition_months: c.recurring_addition_months === undefined ? null : c.recurring_addition_months,'
        + '\n' + '    sweep_reconciled: c.sweep_reconciled === true, sweep_pulled: c.sweep_pulled || 0, sweep_total: c.sweep_total || 0,'
        + '\n' + '    gaps: (c.gaps || []).join(" | ").slice(0, 900),'
        + '\n' + '    gaps_blocking: (c.gaps_blocking || []).join(" | ").slice(0, 900),'
        + '\n' + '    approved_amount_aed: c.approved_amount_aed === undefined ? null : c.approved_amount_aed,'
        + '\n' + '    allowed_verified_aed: c.allowed_verified_aed === undefined ? null : c.allowed_verified_aed,'
        + '\n' + '    todo_ids: Array.isArray(r.todo_ids) ? r.todo_ids.join(",") : "",'
        + '\n' + '    rulings_checksum: c.rulings_checksum, scored_at: c.scored_at'
        + '\n' + '  } };'
        + '\n' + '});'
    }
  },
  output: [{ case_key: '3978:2026-07', verdict: 'finding' }]
});

const writeCases = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Write Cases',
    position: [5880, -120],
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: DT_CASES },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'case_key', condition: 'eq', keyValue: expr('{{ $json.case_key }}') }] },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: ['case_key'], value: {}, schema: [] },
      options: {}
    }
  },
  output: [{ id: 1 }]
});

const buildVerdictRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Verdict Rows',
    position: [6100, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const adjudicated = $("Adjudicate").all().map(function (i) { return i.json; });'
        + '\n' + 'const rows = [];'
        + '\n' + 'for (const c of adjudicated) {'
        + '\n' + '  const r = c._reading;'
        + '\n' + '  if (!r) continue;'
        + '\n' + '  rows.push({ json: {'
        + '\n' + '    run_id: c.run_id, case_key: c.case_key, maid_id: String(c.maid_id), payroll_month: c.payroll_month,'
        + '\n' + '    verifier_rule: c.settled_by, verdict: c.verdict,'
        + '\n' + '    sweep_reconciled: r.sweep_reconciled === true,'
        + '\n' + '    authorisation_found: r.authorisation_found === true,'
        + '\n' + '    approval_denied: r.approval_denied === true,'
        + '\n' + '    approved_amount_aed: Number.isFinite(r.approved_amount) ? r.approved_amount : null,'
        + '\n' + '    approved_amount_is_base: r.approved_amount_is_base !== false,'
        + '\n' + '    renewal_raises_consumed: Number.isFinite(r.renewal_raises_consumed_by_approval) ? r.renewal_raises_consumed_by_approval : 0,'
        + '\n' + '    renewals_since_approval: Number.isFinite(r.renewals_since_approval) ? r.renewals_since_approval : null,'
        + '\n' + '    addition_is_raise: r.addition_is_raise_in_disguise === true ? "raise" : (r.addition_is_raise_in_disguise === false ? "benefit" : "unknown"),'
        + '\n' + '    justification_cohort_wide: r.justification_is_cohort_wide === true,'
        + '\n' + '    read_from_type_only: r.read_from_type_only === true,'
        + '\n' + '    todo_ids: Array.isArray(r.todo_ids) ? r.todo_ids.join(",") : "",'
        + '\n' + '    notes: String(r.notes || "").slice(0, 900),'
        + '\n' + '    created_at: new Date().toISOString()'
        + '\n' + '  } });'
        + '\n' + '}'
        + '\n' + 'if (rows.length === 0) return [];'
        + '\n' + 'return rows;'
    }
  },
  output: [{ run_id: 'r', case_key: '3978:2026-07' }]
});

const writeVerdicts = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Write Verdicts',
    position: [6320, -120],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: DT_VERDICTS },
      columns: { mappingMode: 'autoMapInputData', value: {}, schema: [] },
      options: {}
    }
  },
  output: [{ id: 1 }]
});

const buildRunRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Run Row',
    position: [6540, -120],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// THE RUN SUMMARY CARRIES COUNTS, FLAGS AND TOTALS ONLY. No amount, no maid id, no name.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const cases = $("Adjudicate").all().map(function (i) { return i.json; });'
        + '\n' + 'const run = (cases[0] || {})._run || {};'
        + '\n' + 'function count(v) { return cases.filter(function (c) { return c.verdict === v; }).length; }'
        + '\n' + 'const gaps = (run.declared_gaps || []).slice();'
        + '\n' + 'const stillCandidate = count("candidate");'
        + '\n' + 'if (stillCandidate > 0) gaps.push(stillCandidate + " case(s) were still unsettled at delivery and were recorded as pending, never clean.");'
        + '\n' + 'const row = {'
        + '\n' + '  run_id: params.run_id, check_id: params.check_id, check_name: params.check_name,'
        + '\n' + '  trigger: params.trigger, status: "completed",'
        + '\n' + '  started_at: params.started_at, finished_at: new Date().toISOString(),'
        + '\n' + '  audited_month: params.audited_month,'
        + '\n' + '  cohort_nationality: "(all in cohort)", cohort_status: params.cohort_status,'
        + '\n' + '  population_reported: run.population_reported || 0, population_pulled: run.population_pulled || 0,'
        + '\n' + '  population_reconciled: run.population_reconciled === true,'
        + '\n' + '  filter_narrowed: run.filter_narrowed === true,'
        + '\n' + '  narrowing_applied: params.narrowing === true, narrowing_floor_aed: null,'
        + '\n' + '  candidates: run.candidates_found || 0,'
        + '\n' + '  out_of_population: count("out_of_population"),'
        + '\n' + '  findings: count("finding"), cleans: count("clean"), pendings: count("pending"),'
        + '\n' + '  erp_calls: null, erp_budget: params.erp_call_budget,'
        + '\n' + '  rulings_checksum: cfg.rulings_checksum,'
        + '\n' + '  back_audit: params.back_audit === true, smoke: params.smoke === true,'
        + '\n' + '  gaps_declared: gaps.join(" | ").slice(0, 900),'
        + '\n' + '  notes: "DRAFT run. Findings must not be escalated before an independent Police and Control reviewer who did not run the check has read them."'
        + '\n' + '};'
        + '\n' + 'console.log(JSON.stringify({ stage: "ccmsr_run_summary", run_id: row.run_id, findings: row.findings,'
        + '\n' + '  cleans: row.cleans, pendings: row.pendings, out_of_population: row.out_of_population, gaps: gaps.length }));'
        + '\n' + 'return [{ json: row }];'
    }
  },
  output: [{ run_id: 'r', findings: 1, cleans: 2, pendings: 2 }]
});

const writeRun = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Write Run',
    position: [6760, -120],
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: DT_RUNS },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'run_id', condition: 'eq', keyValue: expr('{{ $json.run_id }}') }] },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: ['run_id'], value: {}, schema: [] },
      options: {}
    }
  },
  output: [{ id: 1 }]
});

const releaseLease = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Release ERP Lease',
    position: [6980, -120],
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: LEASE_WF },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          mode: 'release',
          run_id: expr('{{ $("Validate Inputs").first().json.params.run_id }}'),
          check_id: 'cc-maids-salary-raise',
          ignore_lease: false
        },
        matchingColumns: [],
        schema: [
          { id: 'mode', displayName: 'mode', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'check_id', displayName: 'check_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'ignore_lease', displayName: 'ignore_lease', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: true }
    }
  },
  output: [{ released: true }]
});

const noCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Candidates',
    position: [2080, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// Zero candidates is a real, reportable outcome for a narrowed cohort - but it is only'
        + '\n' + '// meaningful because the population walk RECONCILED. An unreconciled walk never reaches here.'
        + '\n' + 'const cfg = $("Assert Rulings").first().json;'
        + '\n' + 'const params = cfg.params;'
        + '\n' + 'const run = $json._run || {};'
        + '\n' + 'return [{ json: { run_id: params.run_id, check_id: params.check_id, check_name: params.check_name,'
        + '\n' + '  trigger: params.trigger, status: "completed", started_at: params.started_at,'
        + '\n' + '  finished_at: new Date().toISOString(), audited_month: params.audited_month,'
        + '\n' + '  cohort_nationality: "(all in cohort)", cohort_status: params.cohort_status,'
        + '\n' + '  population_reported: run.population_reported || 0, population_pulled: run.population_pulled || 0,'
        + '\n' + '  population_reconciled: run.population_reconciled === true, filter_narrowed: run.filter_narrowed === true,'
        + '\n' + '  narrowing_applied: params.narrowing === true, narrowing_floor_aed: null,'
        + '\n' + '  candidates: 0, out_of_population: 0, findings: 0, cleans: 0, pendings: 0,'
        + '\n' + '  erp_calls: null, erp_budget: params.erp_call_budget, rulings_checksum: cfg.rulings_checksum,'
        + '\n' + '  back_audit: params.back_audit === true, smoke: params.smoke === true,'
        + '\n' + '  gaps_declared: (run.declared_gaps || []).join(" | ").slice(0, 900),'
        + '\n' + '  notes: "No maid in the cohort was above her nationality narrowing floor. DRAFT run." } }];'
    }
  },
  output: [{ run_id: 'r', candidates: 0 }]
});

const onCrash = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'On Workflow Crash', position: [-560, 620] },
  output: [{ execution: {}, workflow: {} }]
});

const buildErrorRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Error Run Row',
    position: [-340, 620],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: '// A CRASHED RUN MUST LEAVE A ROW. A run that vanishes looks, from the Runs log, exactly like'
        + '\n' + '// a run that found nothing - and that is the difference between "no findings" and "never ran".'
        + '\n' + 'const e = $json.execution || {};'
        + '\n' + 'let runId = "";'
        + '\n' + 'try { runId = $("Validate Inputs").first().json.params.run_id || ""; } catch (err) { runId = ""; }'
        + '\n' + 'return [{ json: {'
        + '\n' + '  run_id: runId || ("crashed-" + (e.id || new Date().toISOString())),'
        + '\n' + '  check_id: "cc-maids-salary-raise", check_name: "CC Maids Salary Raise",'
        + '\n' + '  trigger: "unknown", status: "crashed",'
        + '\n' + '  started_at: null, finished_at: new Date().toISOString(),'
        + '\n' + '  audited_month: null, cohort_nationality: null, cohort_status: null,'
        + '\n' + '  population_reported: 0, population_pulled: 0, population_reconciled: false,'
        + '\n' + '  filter_narrowed: false, narrowing_applied: false, narrowing_floor_aed: null,'
        + '\n' + '  candidates: 0, out_of_population: 0, findings: 0, cleans: 0, pendings: 0,'
        + '\n' + '  erp_calls: null, erp_budget: null, rulings_checksum: null,'
        + '\n' + '  back_audit: false, smoke: false,'
        + '\n' + '  gaps_declared: "RUN CRASHED - nothing in this run may be read as a result. No case was scored to completion.",'
        + '\n' + '  notes: String((e.error || {}).message || "unknown error").slice(0, 900)'
        + '\n' + '} }];'
    }
  },
  output: [{ run_id: 'crashed', status: 'crashed' }]
});

const writeErrorRun = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Write Run (error)',
    position: [-120, 620],
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: DT_RUNS },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'run_id', condition: 'eq', keyValue: expr('{{ $json.run_id }}') }] },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: ['run_id'], value: {}, schema: [] },
      options: {}
    }
  },
  output: [{ id: 1 }]
});

const releaseLeaseError = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Release Lease (error)',
    position: [100, 620],
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: LEASE_WF },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { mode: 'release', run_id: expr('{{ $("Build Error Run Row").first().json.run_id }}'), check_id: 'cc-maids-salary-raise', ignore_lease: false },
        matchingColumns: [],
        schema: [
          { id: 'mode', displayName: 'mode', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'check_id', displayName: 'check_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'ignore_lease', displayName: 'ignore_lease', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: true }
    }
  },
  output: [{ released: true }]
});

const noteIntake = sticky(
  '## 1 - Intake, token and rulings\n\nThe ERP token is a RUNTIME PAYLOAD. This flow holds no ERP credential of its own and never writes one: ERP logs every read under the token identity, so a finding must be attributable to whoever actually ran the check.\n\nThe token is decoded locally so an EXPIRED token is named as expired - a dead ERP token returns the 498-inside-500 shape, not a 401.\n\nRulings are asserted by CHECKSUM before anything is scored. An absent lifetime cap makes the allowance unbounded and clears every finding.',
  [validateInputs, inputsOk, assertRulings],
  { color: 4 }
);

const notePopulation = sticky(
  '## 2 - Population, proven complete\n\nTHE FILTER FALL-THROUGH IS THE TRAP HERE. Probed live 2026-08-30: a wrong filter key or value shape returns HTTP 200 and the ENTIRE unfiltered population - 80,621 CC maids instead of 5,611 - with no error. The status filter takes ONE STRING; every array form is silently ignored.\n\nPage at size=40 and never larger: ERP offsets by page x size while a page returns at most 40 rows, so size=50 silently never asks for offsets 40-49.\n\nDedupe by maid id - the walk is not stable under concurrent writes and the row count cannot be trusted.\n\nThe budget gate HARD-FAILS rather than trimming: a trimmed population produces an audit that looks complete and is not.',
  [getPopulationCount, buildPageList, budgetGate, getPopulationPages, populationGuard],
  { color: 3 }
);

const noteNarrow = sticky(
  '## 3 - Switchers, then candidate narrowing\n\nORDER 57 NEEDS ITS OWN SWEEP. An MV to CC switcher is pending, never red - her raise is earned on 24 months of CC service, not at the visa-renewal step. But NO per-maid route exposes the distinction: getHousemaidInfo does not carry oldHousemaidType, and its housemaidType is a recruitment channel. The only source is the REQUEST side of filterHousemaids, so the switcher cohort is enumerated separately and intersected with the candidates. Without it the rule could never fire and a switcher could be accused.\n\nThe population row already carries basicSalary inline, so enrichment only runs on maids who COULD be over. This is what makes the check fit its call budget at all.\n\nTHE RISK, STATED: that figure is TODAY\'s salary, not the audited month\'s. Sound for a current-month run; UNSOUND for a back-audit, where a maid paid above entitlement then and reduced since is filtered out before she is scored - a false clearance. Validate Inputs refuses that combination unless it is explicitly declared on the run.',
  [getSwitcherCount, buildSwitcherPages, getSwitcherPages, collectSwitchers, narrowCandidates, anyCandidates],
  { color: 5 }
);

const noteEnrich = sticky(
  '## 4 - Enrichment and the evidence sweep\n\nPayroll history uses pagecode HousemaidsPayrollList, NOT the documented HousemaidsPayrollHistory - that one returns INSUFFICIENT_PERMISSIONS. Permissions are per route x pagecode, so that denial is never on its own proof a surface is unreachable.\n\nThe evidence sweep MUST reconcile, and this is the direction that CONDEMNS rather than clears: the complaint list defaults to size=20 and one real maid has 96, so reading page 0 and concluding "no approval exists" is a false absence.',
  [getProfile, getSalaryRule, getPayrollHistory, getRenewDocs, getComplaintsP0, buildSweepPages, anyExtraPages, getSweepPages, joinSweep, buildThreadRequests, anyThreads, getThreads, noThreads, joinThreads],
  { color: 6 }
);

const noteGates = sticky(
  '## 5 - The gates, in ACP Order\n\nallowance = base + renewal_raise x min(renewals, lifetime cap), worked out PER MAID. A flat nationality ceiling was tested against the five real cases and produced two confirmed false reds.\n\nNever netSalary. Never primarySalary as a ceiling. accommodationSalary is excluded from the standard.\n\nThe reduced-month guard is a BUILD-ADDED guard, not an ACP rule: it lands on the existing catch-all Order 78 rather than inventing a rule number. Without it, auditing a reduced month clears a maid whose rate is plainly above entitlement.',
  [scoreDeterministic, selectVerifier, anyVerifier],
  { color: 3 }
);

const noteVerifier = sticky(
  '## 6 - The verifier reads prose; this file does the arithmetic\n\nAN APPROVED BASE IS NOT A FINAL SALARY. Reading an approved figure as a ceiling called one real maid the strongest finding when she is clean, and would have produced three false reds out of five.\n\nThe agent reports WHAT THE SENTENCES SAY. Adjudicate composes and decides, because that is the part that has to be testable.\n\nA denied raise is not an absence of authorisation - it is authorisation withheld, and the thread is the only place a denial is recorded.',
  [verifyAgent, mergeReadings, joinVerdicts, adjudicate],
  { color: 4 }
);

const noteDelivery = sticky(
  '## 7 - Delivery (DRAFT ONLY)\n\nNever published, never scheduled, never activated.\n\nAMOUNTS LIVE IN THE CASES TABLE, behind the case. The run summary and every log line carry counts, flags and totals only - no salary, no name, no contact detail. A maid is identified by maid id, and her position is expressed relative to her entitlement.\n\nFindings must not be escalated before an independent Police and Control reviewer who did not run the check has read them.',
  [buildCaseRows, writeCases, buildVerdictRows, writeVerdicts, buildRunRow, writeRun, releaseLease],
  { color: 7 }
);

const noteCrash = sticky(
  '## 8 - Crash path\n\nA crashed run MUST leave a row. A run that vanishes looks, from the Runs log, exactly like a run that found nothing - and that is the difference between "no findings" and "never ran". The ERP lease is released on this path too, or the next audit blocks forever.',
  [onCrash, buildErrorRow, writeErrorRun, releaseLeaseError],
  { color: 2 }
);

export default workflow('cc-maids-salary-raise', 'CC Maids Salary Raise — generated v1')
  .add(runWebhook)
  .to(validateInputs)
  .to(inputsOk
    .onTrue(respond200.to(assertRulings
      .to(acquireLease)
      .to(getPopulationCount)
      .to(buildPageList)
      .to(budgetGate)
      .to(getPopulationPages)
      .to(populationGuard)
      .to(getSwitcherCount)
      .to(buildSwitcherPages)
      .to(getSwitcherPages)
      .to(collectSwitchers)
      .to(narrowCandidates)
      .to(anyCandidates
        .onTrue(getProfile
          .to(getSalaryRule)
          .to(getPayrollHistory)
          .to(getRenewDocs)
          .to(getComplaintsP0)
          .to(buildSweepPages)
          .to(anyExtraPages
            .onTrue(getSweepPages.to(joinSweep.input(0)))
            .onFalse(skipSweepPages.to(joinSweep.input(1)))))
        .onFalse(noCandidates.to(writeRun)))))
    .onFalse(respond400))
  .add(runManually)
  .to(validateInputs)
  .add(joinSweep)
  .to(buildThreadRequests)
  .to(anyThreads
    .onTrue(getThreads.to(joinThreads.input(0)))
    .onFalse(noThreads.to(joinThreads.input(1))))
  .add(joinThreads)
  .to(scoreDeterministic)
  .to(selectVerifier)
  .to(anyVerifier
    .onTrue(verifyAgent.to(mergeReadings.to(joinVerdicts.input(0))))
    .onFalse(noVerifier.to(joinVerdicts.input(1))))
  .add(joinVerdicts)
  .to(adjudicate)
  .to(buildCaseRows)
  .to(writeCases)
  .to(buildVerdictRows)
  .to(writeVerdicts)
  .to(buildRunRow)
  .to(writeRun)
  .to(releaseLease)
  .add(onCrash)
  .to(buildErrorRow)
  .to(writeErrorRun)
  .to(releaseLeaseError)
  .add(noteIntake)
  .add(notePopulation)
  .add(noteNarrow)
  .add(noteEnrich)
  .add(noteGates)
  .add(noteVerifier)
  .add(noteDelivery)
  .add(noteCrash);
