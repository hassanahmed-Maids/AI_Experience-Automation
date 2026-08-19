import { workflow, node, trigger, splitInBatches, nextBatch, sticky, expr } from '@n8n/workflow-sdk';

const ERP = 'https://erpbackendpro.maids.cc';

const chunkIn = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Chunk In',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: { values: [
        { name: 'runId', type: 'string' },
        { name: 'auditedMonth', type: 'string' },
        { name: 'bearer', type: 'string' },
        { name: 'token', type: 'string' },
        { name: 'device', type: 'string' },
        { name: 'populationSample', type: 'boolean' },
        { name: 'contracts', type: 'array' },
      ] },
    },
  },
  output: [{ runId: 'run-x', auditedMonth: '2026-07', bearer: 'Bearer x', token: 'x', device: '1', populationSample: true, contracts: [] }],
});

const fanOut = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fan Out Contracts',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const inp = $input.first().json;\nconst list = Array.isArray(inp.contracts) ? inp.contracts : [];\nif (!inp.auditedMonth || !/^\\d{4}-\\d{2}$/.test(String(inp.auditedMonth))) {\n  throw new Error('auditedMonth must be YYYY-MM');\n}\nif (!inp.bearer || !inp.token || !inp.device) {\n  throw new Error('ERP credentials missing from the run payload - the flow holds no ERP credential of its own');\n}\nreturn list.map(function (c) { return { json: c }; });",
    },
  },
  output: [{ contractId: 1099709, clientId: 469560, vip: false, vVip: false, startOfContract: '2026-06-26 09:18:52', dateOfTermination: '', scheduledDateOfTermination: '', status: 'ACTIVE' }],
});

const eachContract = splitInBatches({
  version: 3,
  config: { name: 'Each Contract', parameters: { batchSize: 1 } },
});

const readLedger = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Read Payment Ledger',
    parameters: {
      method: 'POST',
      url: ERP + '/accounting/payments/page/advancesearch?page=0&size=1000&sort=',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'PaymentReport' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr("{{ $('Chunk In').first().json.bearer }}") },
        { name: 'cookie', value: expr("{{ 'authTokenProduction=' + $('Chunk In').first().json.token + '; deviceIdProduction=' + $('Chunk In').first().json.device }}") },
      ] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify([{ property: "contract.id", operation: "=", value: String($json.contractId) }]) }}'),
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 500 } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
        timeout: 60000,
      },
    },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  },
  output: [{ statusCode: 200, body: { content: [], totalElements: 0 } }],
});

const readDetails = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Read Contract Details',
    parameters: {
      method: 'POST',
      url: expr("{{ '" + ERP + "/clientmgmt/client/get-client-details/' + $('Each Contract').item.json.clientId + '?type=CONTRACT_DETAILS&contractId=' + $('Each Contract').item.json.contractId }}"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [
        { name: 'pagecode', value: 'ClientSummary' },
        { name: 'accept', value: 'application/json, text/plain, */*' },
        { name: 'origin', value: 'https://erp.maids.cc' },
        { name: 'referer', value: 'https://erp.maids.cc/' },
        { name: 'authorization', value: expr("{{ $('Chunk In').first().json.bearer }}") },
        { name: 'cookie', value: expr("{{ 'authTokenProduction=' + $('Chunk In').first().json.token + '; deviceIdProduction=' + $('Chunk In').first().json.device }}") },
      ] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '{}',
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 500 } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
        timeout: 60000,
      },
    },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  },
  output: [{ statusCode: 200, body: { currentPayment: { amountValue: 1638 } } }],
});
