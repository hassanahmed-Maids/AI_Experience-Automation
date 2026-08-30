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
      jsCode: "__PLACEHOLDER__jsCode#1"
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
      jsCode: "__PLACEHOLDER__jsCode#2"
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
      jsCode: "__PLACEHOLDER__jsCode#3"
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
      jsCode: "__PLACEHOLDER__jsCode#4"
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
      jsCode: "__PLACEHOLDER__jsCode#5"
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
      jsCode: "__PLACEHOLDER__jsCode#6"
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
      jsCode: "__PLACEHOLDER__jsCode#7"
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
      jsCode: "__PLACEHOLDER__jsCode#8"
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
        conditions: [{ leftValue: expr('{{ $json._empty }}'), operator: { type: 'boolean', operation: 'notTrue', singleValue: true } }],
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
      jsCode: "__PLACEHOLDER__jsCode#9"
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
        conditions: [{ leftValue: expr('{{ $json._no_extra }}'), operator: { type: 'boolean', operation: 'notTrue', singleValue: true } }],
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
      jsCode: "__PLACEHOLDER__jsCode#10"
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
      jsCode: "__PLACEHOLDER__jsCode#11"
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
        conditions: [{ leftValue: expr('{{ $json._no_threads }}'), operator: { type: 'boolean', operation: 'notTrue', singleValue: true } }],
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
      jsCode: "__PLACEHOLDER__jsCode#12"
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
      jsCode: "__PLACEHOLDER__jsCode#13"
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
      jsCode: "__PLACEHOLDER__jsCode#14"
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
        conditions: [{ leftValue: expr('{{ $json._none }}'), operator: { type: 'boolean', operation: 'notTrue', singleValue: true } }],
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
        systemMessage: "__PLACEHOLDER__systemMessage#1"
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
      jsCode: "__PLACEHOLDER__jsCode#15"
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
      jsCode: "__PLACEHOLDER__jsCode#16"
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
      jsCode: "__PLACEHOLDER__jsCode#17"
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
      jsCode: "__PLACEHOLDER__jsCode#18"
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
      jsCode: "__PLACEHOLDER__jsCode#19"
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
      jsCode: "__PLACEHOLDER__jsCode#20"
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
      jsCode: "__PLACEHOLDER__jsCode#21"
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
      jsCode: "__PLACEHOLDER__jsCode#22"
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
