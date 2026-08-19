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

const scoreCase = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Score Contract Month',
    parameters: { mode: 'runOnceForAllItems', jsCode: "const COLLECTED = 'RECEIVED';\nconst MONTHLY = 'monthly_payment';\n\nconst STATUS_COLLECTED = ['RECEIVED'];\n\nconst STATUS_IN_FLIGHT = [\n  'PDC',        // post-dated cheque held, not yet due. UI label \"PDP\".\n  'PRE_PDP',    // scheduled DD or card.\n  'ADCB_PDC',   // ADCB post-dated cheque variant.\n  'DEPOSIT',    // deposited at bank, awaiting clearance.\n  'FROZEN',     // held/frozen at the bank \u2014 not settled, not dead.\n  'REQUESTED',  // requested, not yet collected.\n];\n\nconst STATUS_DEAD = [\n  'BOUNCED',                          // failed / rejected by bank.\n  'DELETED',                          // record cancelled.\n  'TEARED_UP',                        // instrument physically voided.\n  'RETURNED_TO_CLIENT',               // cheque handed back. UI \"Returned to family\".\n  'UNCOLLECTED',                      // never collected / written off.\n  'CANCELLED',\n  'CANCELLED_WAITING_CLIENT_PICKUP',\n];\n\nconst KNOWN_TYPE_CODES = [\n  'monthly_payment',                  // live\n  'monthly_payment_add_on',\n  'pre_collected_payment',            // live\n  'pre_collected_payment_no_vat',     // live\n  'transfer_fee',                     // live\n  'same_day_recruitment_fee',         // live\n  'insurance',                        // live\n  'overstay_fee',                     // live (NOT \"overstay_fine\")\n  'Urgent_visa_charges',              // live \u2014 note the mixed case\n  'non-mp-refund',                    // live \u2014 note the hyphens\n  'service_charge',                   // live\n  'oec',                              // live\n  'visa_2_years', 'wps_processing_fee', 'gcc_fee',\n  'travel_visa_lebanon', 'travel_visa_egypt', 'travel_assist_fee',\n  'second_year_insurance', 'refund',\n];\n\nconst VERDICT = {\n  CLEAN: 'clean',\n  CLEAN_VIP: 'clean-vip-exception',\n  RED: 'finding',\n  PENDING: 'pending',\n  INCONCLUSIVE: 'inconclusive',\n};\n\nconst RED_TYPE = {\n  MISSING_1ST: 'missing 1st-of-month payment',\n  MISSING_PREV: 'missing previous-month payment',\n  AMOUNT: 'payment amount mismatch',\n  BAD_TYPE: 'missing or invalid payment type',\n};\n\nfunction monthKey(d) {\n  if (d === null || d === undefined || d === '') return null;\n  const s = String(d);\n  const m = s.match(/^(\\d{4})-(\\d{2})/);\n  return m ? m[1] + '-' + m[2] : null;\n}\n\nfunction shiftMonth(mk, delta) {\n  const [y, m] = mk.split('-').map(Number);\n  const d = new Date(Date.UTC(y, m - 1 + delta, 1));\n  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');\n}\n\nfunction parseMoney(v) {\n  if (v === null || v === undefined || v === '') return null;\n  if (typeof v === 'number') return Number.isFinite(v) ? v : null;\n  const cleaned = String(v).replace(/[^0-9.\\-]/g, '');\n  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;\n  const n = Number(cleaned);\n  return Number.isFinite(n) ? n : null;\n}\n\nfunction isNum(v) {\n  return typeof v === 'number' && Number.isFinite(v);\n}\n\nfunction cmpMoney(a, b) {\n  const d = Math.round((a - b) * 100);\n  return d === 0 ? 0 : (d > 0 ? 1 : -1);\n}\n\nfunction deriveExpected(contract) {\n  const singular = parseMoney(contract && contract.currentPayment && contract.currentPayment.amountValue);\n  const rows = (contract && Array.isArray(contract.currentPayments)) ? contract.currentPayments : [];\n\n  const monthlyRows = rows.filter(function (r) {\n    const code = r && r.paymentTypeCode;\n    return code === MONTHLY || code === 'pre_collected_payment' || code === 'pre_collected_payment_no_vat';\n  });\n  const row = monthlyRows.length ? monthlyRows[0] : null;\n\n  let split = null;\n  if (row) {\n    const salary = parseMoney(row.workerSalary);\n    const fees = parseMoney(row.visaFees);\n    if (isNum(salary) && isNum(fees)) split = salary + fees;\n  }\n\n  let expected = null;\n  let source = null;\n  if (isNum(split)) {\n    expected = split;\n    source = 'currentPayments[].workerSalary + visaFees';\n  } else if (isNum(singular)) {\n    expected = singular;\n    source = 'currentPayment.amountValue';\n  }\n\n  let crossCheckOk = null;\n  if (isNum(split) && isNum(singular)) crossCheckOk = cmpMoney(split, singular) === 0;\n\n  return { expected: expected, source: source, split: split, singular: singular, crossCheckOk: crossCheckOk };\n}\n\nfunction monthInContractLife(contract, mk) {\n  const start = monthKey(contract && contract.startDate);\n  const end = monthKey(\n    (contract && contract.dateOfTermination) ||\n    (contract && contract.isScheduledForTermination ? contract.scheduledDateOfTermination : null)\n  );\n  if (start && mk < start) return { inLife: false, why: 'month precedes contract start' };\n  if (end && mk > end) return { inLife: false, why: 'month follows contract termination' };\n  return { inLife: true, isStartMonth: !!(start && start === mk) };\n}\n\nfunction resolvePreCollected(contract) {\n  const pc = contract && contract.preCollectedInfo;\n  const flag = pc ? pc.isPreCollectedSalary : undefined;\n  if (flag === undefined || flag === null) {\n    return { isPreCollected: null, unknown: true, advanceReceived: null, advanceEntries: 0 };\n  }\n  const entries = (pc && Array.isArray(pc.currentPreCollectedPayments)) ? pc.currentPreCollectedPayments : [];\n  let advance = 0;\n  for (const e of entries) {\n    if (!e || e.status !== COLLECTED) continue;\n    const amt = parseMoney(e.amount);\n    if (isNum(amt)) advance += amt;\n  }\n  return {\n    isPreCollected: flag === true,\n    unknown: false,\n    shifted: flag === true,\n    advanceReceived: entries.length ? advance : null,\n    advanceEntries: entries.length,\n  };\n}\n\nfunction monthRows(payments, mk) {\n  const all = Array.isArray(payments) ? payments : [];\n  const unassignable = [];\n  const inMonth = [];\n  for (const p of all) {\n    const code = p && p.typeOfPayment && p.typeOfPayment.code;\n    if (code !== MONTHLY) continue;\n    const dk = monthKey(p.dateOfPayment);\n    if (dk === null) { unassignable.push(p); continue; }\n    if (dk === mk) inMonth.push(p);\n  }\n  return { inMonth: inMonth, unassignable: unassignable };\n}\n\nfunction statusOf(p) {\n  return (p && p.status && p.status.value) || null;\n}\n\nfunction sumReceived(rows) {\n  let total = 0;\n  let n = 0;\n  for (const p of rows) {\n    if (statusOf(p) !== COLLECTED) continue;\n    const amt = parseMoney(p.amountOfPayment);\n    total += isNum(amt) ? amt : 0;\n    n++;\n  }\n  return { total: total, rowCount: n };\n}\n\nfunction chainSettled(rows) {\n  const failed = rows.filter(function (p) { return STATUS_DEAD.indexOf(statusOf(p)) !== -1; });\n  const replacedFlagged = failed.filter(function (p) { return p.replaced === true; });\n  if (!replacedFlagged.length) return { settled: false, hadFailedRows: failed.length > 0, replacedFlagged: 0 };\n  const successorReceived = rows.some(function (p) { return statusOf(p) === COLLECTED; });\n  return { settled: successorReceived, hadFailedRows: true, replacedFlagged: replacedFlagged.length };\n}\n\nfunction sumInFlight(rows) {\n  let total = 0;\n  const statuses = [];\n  const unknown = [];\n  for (const p of rows) {\n    const s = statusOf(p);\n    if (STATUS_COLLECTED.indexOf(s) !== -1) continue;\n    if (STATUS_DEAD.indexOf(s) !== -1) continue;\n    if (STATUS_IN_FLIGHT.indexOf(s) === -1) unknown.push(s);\n    statuses.push(s);\n    const amt = parseMoney(p.amountOfPayment);\n    total += isNum(amt) ? amt : 0;\n  }\n  return { total: total, statuses: statuses, unknownStatuses: unknown };\n}\n\nfunction badTypeRows(payments) {\n  const all = Array.isArray(payments) ? payments : [];\n  const absent = [];\n  const unrecognised = [];\n  for (const p of all) {\n    const t = p && p.typeOfPayment;\n    const code = t ? t.code : undefined;\n    if (!t || code === null || code === undefined || String(code).trim() === '') {\n      absent.push(p);\n    } else if (KNOWN_TYPE_CODES.indexOf(code) === -1) {\n      unrecognised.push(code);\n    }\n  }\n  return { absent: absent, unrecognised: Array.from(new Set(unrecognised)) };\n}\n\nfunction isVip(contract, opts) {\n  const vip = !!(contract && contract.vip);\n  const vvip = !!(contract && contract.vVip);\n  if (opts && opts.vipCountsVVip === false) return vip;\n  return vip || vvip;\n}\n\nconst MONTHLY_BUCKET = /monthly|maid'?s? salary|wps processing \\+ maid salary|service fee/i;\n\nfunction reliefCoverage(contract, contractId, gap, opts) {\n  const plan = (contract && contract.paymentPlan) || {};\n  const texts = [];\n  for (const key of ['additionalDiscount', 'creditNoteDiscount']) {\n    const raw = plan[key];\n    if (raw === null || raw === undefined || String(raw).trim() === '') continue;\n    const amt = parseMoney(String(raw).replace(/over\\s+\\d+\\s+months?/i, ''));\n    texts.push({\n      field: 'paymentPlan.' + key,\n      namesMonthlyBucket: MONTHLY_BUCKET.test(String(raw)),\n      nonZero: isNum(amt) && amt > 0,\n    });\n  }\n  const present = texts.length > 0;\n  const material = texts.filter(function (t) { return t.nonZero && t.namesMonthlyBucket; });\n\n  let noteTotal = 0;\n  let redeemed = 0;\n  if (opts && opts.useStructuredCreditNotes && Array.isArray(contract && contract.creditNotes)) {\n    for (const n of contract.creditNotes) {\n      if (!n || String(n.redeemedContractId) !== String(contractId)) continue;\n      redeemed++;\n      const amt = parseMoney(n.amount);\n      if (isNum(amt)) noteTotal += amt;\n    }\n  }\n\n  return {\n    covers: noteTotal > 0 && cmpMoney(noteTotal, gap) >= 0,\n    creditNoteTotal: noteTotal,\n    creditNotesRedeemed: redeemed,\n    reliefTextPresent: present,\n    materialMonthlyRelief: material.length > 0,\n    reliefFields: texts.map(function (t) { return t.field; }),\n    discountNeedsHuman: material.length > 0,\n  };\n}\n\nfunction refundContext(payments, mk) {\n  const all = Array.isArray(payments) ? payments : [];\n  const refunds = all.filter(function (p) {\n    const code = (p && p.typeOfPayment && p.typeOfPayment.code) || '';\n    const name = (p && p.typeOfPayment && p.typeOfPayment.name) || '';\n    if (!/refund/i.test(code) && !/refund/i.test(name)) return false;\n    const dk = monthKey(p.dateOfPayment);\n    return dk === null || dk === mk;\n  });\n  return { refundPresent: refunds.length > 0, refundCount: refunds.length };\n}\n\n/**\n * Score one contract-month. One case = one contract-month.\n */\nfunction scoreContractMonth(input) {\n  const opts = input.options || {};\n  const auditedMonth = input.auditedMonth;\n  const contract = input.contract || {};\n  const contractId = contract.id;\n  const payments = input.payments || [];\n  const evidence = input.evidence || {};\n  const floor = isNum(opts.materialityFloor) ? opts.materialityFloor : 0;\n\n  const out = {\n    contractId: contractId,\n    auditedMonth: auditedMonth,\n    gatesRun: [],\n    caps: [],\n    needsVerifier: false,\n    refundPresent: false,\n  };\n  const conclude = function (verdict, gate, reason, extra) {\n    Object.assign(out, extra || {});\n    out.verdict = verdict;\n    out.gate = gate;\n    out.reason = reason;\n    return out;\n  };\n\n  out.gatesRun.push('1');\n  if (contract.prospectTypeCode !== 'maidvisa.ae_prospect') {\n    return conclude(VERDICT.INCONCLUSIVE, '1', 'not an MV contract \u2014 out of population');\n  }\n  if (String(contract.clientId) === '24190') {\n    return conclude(VERDICT.INCONCLUSIVE, '1', 'company owner account \u2014 excluded from findings');\n  }\n\n  out.gatesRun.push('10');\n  const bad = badTypeRows(payments);\n  if (bad.absent.length) {\n    return conclude(VERDICT.RED, '10', 'payment row carries no payment type at all', {\n      redFlagType: RED_TYPE.BAD_TYPE,\n      badTypeRowCount: bad.absent.length,\n      needsVerifier: true,\n    });\n  }\n  if (bad.unrecognised.length) {\n    out.unrecognisedTypeCodes = bad.unrecognised;\n    out.needsVerifier = true;\n    out.caps.push('unrecognised payment type code(s) on the contract: ' + bad.unrecognised.join(', '));\n  }\n\n  out.gatesRun.push('5');\n  const pc = resolvePreCollected(contract);\n  if (pc.unknown) {\n    return conclude(VERDICT.INCONCLUSIVE, '5', 'is_pre_collected unreadable \u2014 halted rather than assumed false', {\n      caps: ['is_pre_collected unknown'],\n      needsVerifier: true,\n    });\n  }\n  const mk = pc.isPreCollected ? shiftMonth(auditedMonth, -1) : auditedMonth;\n  out.monthUnderTest = mk;\n  out.isPreCollected = pc.isPreCollected;\n  out.monthShifted = pc.shifted;\n  out.advanceReceived = pc.advanceReceived;\n  if (pc.isPreCollected && pc.advanceEntries === 0) {\n    out.caps.push('flagged pre-collected with no advance on record');\n    out.needsVerifier = true;\n  }\n\n  out.gatesRun.push('2');\n  const life = monthInContractLife(contract, mk);\n  if (!life.inLife) {\n    return conclude(VERDICT.INCONCLUSIVE, '2', life.why + ' \u2014 no case');\n  }\n  out.isStartMonth = !!life.isStartMonth;\n\n  out.gatesRun.push('9', '11', '12');\n  const exp = deriveExpected(contract);\n  out.expected = exp.expected;\n  out.expectedSource = exp.source;\n  if (exp.crossCheckOk === false) {\n    out.caps.push('split does not reconcile with currentPayment.amountValue');\n    out.needsVerifier = true;\n  }\n\n  const rows = monthRows(payments, mk);\n  if (rows.unassignable.length) {\n    out.caps.push(rows.unassignable.length + ' monthly row(s) carry no dateOfPayment');\n    out.needsVerifier = true;\n  }\n\n  const received = sumReceived(rows.inMonth);\n  out.received = received.total;\n  out.receivedRowCount = received.rowCount;\n\n  const refunds = refundContext(payments, mk);\n  out.refundPresent = refunds.refundPresent;\n  out.refundCount = refunds.refundCount;\n  if (refunds.refundPresent) {\n    out.needsVerifier = true;\n    out.caps.push('refund present \u2014 blocks PIL until read by a human');\n  }\n\n  const amountTestable = isNum(exp.expected) && !out.isStartMonth;\n  if (!amountTestable) {\n    out.caps.push(out.isStartMonth\n      ? 'first partial month \u2014 amount comparison suppressed, timing only'\n      : 'expected amount unknown \u2014 amount comparison suppressed');\n  }\n\n  if (isNum(exp.expected) && cmpMoney(exp.expected, floor) <= 0) {\n    return conclude(VERDICT.CLEAN, '6', 'nothing was owed for this month \u2014 no money at stake', {\n      zeroAtStake: true,\n    });\n  }\n\n  out.gatesRun.push('6');\n  if (amountTestable && cmpMoney(received.total, exp.expected) >= 0) {\n    return conclude(VERDICT.CLEAN, '6', 'month paid in full');\n  }\n\n  out.gatesRun.push('7');\n  const chain = chainSettled(rows.inMonth);\n  out.chainSettled = chain.settled;\n  if (chain.settled) {\n    if (!amountTestable) {\n      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');\n    }\n    if (cmpMoney(received.total, exp.expected) >= 0) {\n      return conclude(VERDICT.CLEAN, '7', 'month settled by replacement chain');\n    }\n  }\n\n  out.gatesRun.push('15');\n  const gapForFlight = amountTestable ? (exp.expected - received.total) : null;\n  const flight = sumInFlight(rows.inMonth);\n  out.inFlight = flight.total;\n  out.inFlightStatuses = flight.statuses;\n  if (flight.unknownStatuses && flight.unknownStatuses.length) {\n    out.unknownStatuses = flight.unknownStatuses;\n    out.needsVerifier = true;\n    out.caps.push('status value(s) outside the known enum, counted as in flight: ' + flight.unknownStatuses.join(', '));\n  }\n  if (flight.total > 0) {\n    if (gapForFlight === null) {\n      return conclude(VERDICT.PENDING, '15', 'money scheduled in-month, expectation not testable \u2014 still in flight', {\n        needsVerifier: true,\n      });\n    }\n    if (cmpMoney(flight.total, gapForFlight) >= 0) {\n      return conclude(VERDICT.PENDING, '15', 'scheduled in-month money covers the gap \u2014 not settled, not a shortfall');\n    }\n  }\n\n  const anyMoney = received.total > 0;\n\n  out.gatesRun.push('4');\n  if (!anyMoney && pc.isPreCollected === false) {\n    if (received.rowCount === 0 && rows.inMonth.length === 0 && !isNum(exp.expected)) {\n      return conclude(VERDICT.INCONCLUSIVE, '4', 'no rows and no expectation for the month', { needsVerifier: true });\n    }\n    const owed = isNum(exp.expected) ? exp.expected : null;\n    if (owed !== null && cmpMoney(owed, floor) <= 0) {\n      return conclude(VERDICT.CLEAN, '4', 'nothing was owed for this month \u2014 no money at stake', { zeroAtStake: true });\n    }\n    if (owed === null) {\n      out.caps.push('month unsettled but the owed amount could not be read');\n    }\n    return conclude(VERDICT.RED, '4', 'month owed, nothing settled it, no exception path applies', {\n      redFlagType: RED_TYPE.MISSING_1ST,\n      gap: owed,\n      needsVerifier: true,\n    });\n  }\n\n  out.gatesRun.push('8');\n  if (!anyMoney) {\n    const owed = isNum(exp.expected) ? exp.expected : null;\n    if (owed !== null && cmpMoney(owed, floor) <= 0) {\n      return conclude(VERDICT.CLEAN, '8', 'nothing was owed for this month \u2014 no money at stake', { zeroAtStake: true });\n    }\n    if (owed === null) out.caps.push('month unsettled but the owed amount could not be read');\n    return conclude(VERDICT.RED, '8', 'the month exists, the contract was live, and nothing ever settled it', {\n      redFlagType: pc.shifted ? RED_TYPE.MISSING_PREV : RED_TYPE.MISSING_1ST,\n      gap: owed,\n      needsVerifier: true,\n    });\n  }\n\n  if (!amountTestable) {\n    return conclude(VERDICT.CLEAN, '6', 'money arrived and the amount is not comparable for this month');\n  }\n\n  const gap = exp.expected - received.total;\n  out.gap = gap;\n\n  out.gatesRun.push('13');\n  if (isVip(contract, opts)) {\n    return conclude(VERDICT.CLEAN_VIP, '13', 'amount mismatch on a VIP client \u2014 closed as VIP exception', {\n      vipCountsVVip: opts.vipCountsVVip !== false,\n    });\n  }\n\n  out.gatesRun.push('14');\n  const relief = reliefCoverage(contract, contractId, gap, opts);\n  out.creditNoteTotal = relief.creditNoteTotal;\n  out.reliefTextPresent = relief.reliefTextPresent;\n  out.reliefFields = relief.reliefFields;\n  if (relief.covers) {\n    return conclude(VERDICT.CLEAN, '14', 'credit note redeemed on this contract covers the gap');\n  }\n  if (relief.discountNeedsHuman) {\n    out.needsVerifier = true;\n    out.caps.push('relief prose names the monthly bucket with a nonzero amount \u2014 duration not parsed, needs a human');\n  }\n\n  out.gatesRun.push('17');\n  if (cmpMoney(gap, floor) <= 0) {\n    return conclude(VERDICT.CLEAN, '17', 'no shortfall at stake', { zeroAtStake: true });\n  }\n  return conclude(VERDICT.RED, '17', 'money arrived for the month and is below the contract plan', {\n    redFlagType: RED_TYPE.AMOUNT,\n    needsVerifier: true,\n  });\n}\n\nconst DELIVERED_STATUSES = ['DELIVERED', 'READ', 'RESPONDED'];\n\nconst CHASE_PATTERNS = [\n  /bounced.*payment|payment.*bounced/i,\n  /payment_for_approval_request/i,\n  /dd_messaging_setup.*bounced/i,\n  /collection|overdue|unpaid|outstanding|arrears/i,\n  /payment.*reminder|reminder.*payment/i,\n];\n\nconst NOT_CHASE_PATTERNS = [\n  /received|confirmation|receipt|thank/i,\n  /broadcast|campaign|pre_sale|returning_clients|win_?back/i,\n  /otp|birthday|medical|vat/i,\n];\n\nfunction classifyFollowup(row) {\n  const name = (row && row.templateName) || '';\n  const status = (row && row.deliveryStatus) || '';\n  const sent = (row && row.sentDate) || null;\n\n  if (!sent) return { qualifies: false, why: 'no sentDate' };\n  if (DELIVERED_STATUSES.indexOf(status) === -1) {\n    return { qualifies: false, why: 'not delivered (' + (status || 'no status') + ')' };\n  }\n  if (/^\\d+$/.test(name.trim())) return { qualifies: false, why: 'unclassifiable template id' };\n  for (const p of NOT_CHASE_PATTERNS) {\n    if (p.test(name)) return { qualifies: false, why: 'not a payment chase: ' + name.slice(0, 40) };\n  }\n  for (const p of CHASE_PATTERNS) {\n    if (p.test(name)) return { qualifies: true, sentDate: sent, why: 'payment chase' };\n  }\n  return { qualifies: false, why: 'template does not ask for money' };\n}\n\nfunction lastQualifyingFollowup(rows) {\n  const list = Array.isArray(rows) ? rows : [];\n  let best = null;\n  let considered = 0;\n  for (const r of list) {\n    considered++;\n    const c = classifyFollowup(r);\n    if (!c.qualifies) continue;\n    const d = String(c.sentDate).slice(0, 10);\n    if (!best || d > best) best = d;\n  }\n  return { lastFollowupDate: best, rowsConsidered: considered };\n}\n\nfunction applyVerifier(caseOut, evidence, asOfDate) {\n  const ev = evidence || {};\n  const res = Object.assign({}, caseOut);\n  res.verifierGatesRun = [];\n\n  if (caseOut.verdict !== VERDICT.RED) return res;\n\n  if (ev.messageLogRead !== true) {\n    res.verifierGatesRun.push('4');\n    res.pilBlocked = true;\n    res.caps = (res.caps || []).concat(['message log unread \u2014 10-day rule not evaluable, PIL blocked']);\n    return res;\n  }\n\n  res.verifierGatesRun.push('2');\n  if (ev.explanationForThisMonth === true) {\n    res.verdict = VERDICT.CLEAN;\n    res.reason = 'staff-written evidence names a reason for this month';\n    res.verifierGate = '2';\n    return res;\n  }\n\n  res.verifierGatesRun.push('3');\n  const last = ev.qualifyingFollowupSentDate ? new Date(ev.qualifyingFollowupSentDate) : null;\n  const asOf = new Date(asOfDate);\n  if (last && !isNaN(last.getTime())) {\n    const days = (asOf - last) / 86400000;\n    if (days <= 10) {\n      res.verifierGatesRun.push('5');\n      res.verdict = VERDICT.PENDING;\n      res.reason = 'chased within the last 10 days \u2014 awaiting reviewer, not escalated';\n      res.verifierGate = '5';\n      return res;\n    }\n  }\n  res.verifierGatesRun.push('4');\n  res.verifierGate = '4';\n  res.reason = (res.reason || '') + '; no qualifying follow-up in the last 10 days';\n  res.pilBlocked = !!caseOut.refundPresent;\n  return res;\n}\n\n\nconst inp = $('Chunk In').first().json;\nconst c = $('Each Contract').first().json;\nconst led = $('Read Payment Ledger').first().json || {};\nconst det = $('Read Contract Details').first().json || {};\n\nconst ledStatus = led.statusCode === undefined ? null : led.statusCode;\nconst ledBody = led.body || {};\nconst rows = Array.isArray(ledBody.content) ? ledBody.content : [];\nconst totalEl = ledBody.totalElements;\nconst ledgerComplete = ledStatus === 200 && typeof totalEl === 'number' && rows.length === totalEl;\n\nconst detStatus = det.statusCode === undefined ? null : det.statusCode;\nconst d = det.body || {};\n\nconst contract = {\n  id: c.contractId,\n  clientId: c.clientId,\n  prospectTypeCode: 'maidvisa.ae_prospect',\n  startDate: d.contractStartDate || c.startOfContract || null,\n  dateOfTermination: (d.dateOfTermination !== undefined ? d.dateOfTermination : c.dateOfTermination) || null,\n  scheduledDateOfTermination: (d.scheduledDateOfTermination !== undefined ? d.scheduledDateOfTermination : c.scheduledDateOfTermination) || null,\n  isScheduledForTermination: d.isScheduledForTermination === true,\n  currentPayment: d.currentPayment || null,\n  currentPayments: Array.isArray(d.currentPayments) ? d.currentPayments : null,\n  preCollectedInfo: detStatus === 200 ? (d.preCollectedInfo || {}) : undefined,\n  vip: c.vip === true,\n  vVip: c.vVip === true,\n  paymentPlan: d.paymentPlan || {}\n};\n\nlet out;\nif (detStatus !== 200) {\n  out = { verdict: 'inconclusive', gate: 'surface', reason: 'CONTRACT_DETAILS unreadable (status ' + detStatus + ')',\n          caps: ['contract details unreadable'], needsVerifier: true, monthUnderTest: null };\n} else if (!ledgerComplete) {\n  out = { verdict: 'inconclusive', gate: 'surface',\n          reason: 'payment ledger incomplete - pulled ' + rows.length + ' of ' + totalEl + ' (status ' + ledStatus + ')',\n          caps: ['ledger incomplete - a negative cannot be trusted'], needsVerifier: true, monthUnderTest: null };\n} else {\n  out = scoreContractMonth({ auditedMonth: inp.auditedMonth, contract: contract, payments: rows, options: {} });\n}\n\nconst DISPLAY = {\n  'clean': 'OK',\n  'clean-vip-exception': 'OK - VIP Exception',\n  'finding': 'Red Flag',\n  'pending': 'Still in flight',\n  'inconclusive': 'Awaiting reviewer'\n};\nconst STATE = {\n  'clean': 'clean', 'clean-vip-exception': 'clean',\n  'finding': 'finding', 'pending': 'pending', 'inconclusive': 'pending'\n};\n\nconst monthKeyed = out.monthUnderTest || inp.auditedMonth;\nconst caps = Array.isArray(out.caps) ? out.caps : [];\n\nreturn [{ json: {\n  run_id: String(inp.runId || ''),\n  case_key: String(c.contractId) + ':' + monthKeyed,\n  contract_id: String(c.contractId),\n  client_id: String(c.clientId),\n  audit_month: String(inp.auditedMonth),\n  target_month: String(out.monthUnderTest || ''),\n  verdict: DISPLAY[out.verdict] || String(out.verdict || ''),\n  state: STATE[out.verdict] || 'pending',\n  red_flag_type: String(out.redFlagType || ''),\n  reason_code: 'gate-' + String(out.gate || 'none'),\n  reason_text: String(out.reason || ''),\n  gate: String(out.gate || ''),\n  expected_total: typeof out.expected === 'number' ? out.expected : 0,\n  paid_total: typeof out.received === 'number' ? out.received : 0,\n  gap: typeof out.gap === 'number' ? out.gap : 0,\n  expected_known: typeof out.expected === 'number',\n  expected_source: String(out.expectedSource || ''),\n  is_pre_collected: out.isPreCollected === true,\n  pre_collected_undetermined: out.isPreCollected === null || out.isPreCollected === undefined,\n  month_shifted: out.monthShifted === true,\n  advance_received: typeof out.advanceReceived === 'number' ? out.advanceReceived : 0,\n  chain_settled: out.chainSettled === true,\n  in_flight_aed: typeof out.inFlight === 'number' ? out.inFlight : 0,\n  vip: c.vip === true,\n  v_vip: c.vVip === true,\n  refund_present: out.refundPresent === true,\n  credit_note_present: out.reliefTextPresent === true,\n  block_pil: out.refundPresent === true,\n  payments_truncated: !ledgerComplete,\n  ledger_rows: rows.length,\n  unknown_statuses: (out.unknownStatuses || []).join('|'),\n  unrecognised_type_codes: (out.unrecognisedTypeCodes || []).join('|'),\n  caps: caps.join(' | ').slice(0, 900),\n  needs_human: out.needsVerifier === true,\n  population_sample: inp.populationSample === true,\n  scored_at: new Date().toISOString()\n} }];\n" },
  },
  output: [{ run_id: 'run-x', case_key: '1074171:2026-06', verdict: 'Red Flag', state: 'finding', gap: 2405 }],
});

const insertCase = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Write Case Row',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'MlU50KCb0NEQC1ch' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
            run_id: expr('{{ $json.run_id }}'),
            case_key: expr('{{ $json.case_key }}'),
            contract_id: expr('{{ $json.contract_id }}'),
            client_id: expr('{{ $json.client_id }}'),
            audit_month: expr('{{ $json.audit_month }}'),
            target_month: expr('{{ $json.target_month }}'),
            verdict: expr('{{ $json.verdict }}'),
            state: expr('{{ $json.state }}'),
            red_flag_type: expr('{{ $json.red_flag_type }}'),
            reason_code: expr('{{ $json.reason_code }}'),
            reason_text: expr('{{ $json.reason_text }}'),
            gate: expr('{{ $json.gate }}'),
            expected_total: expr('{{ $json.expected_total }}'),
            paid_total: expr('{{ $json.paid_total }}'),
            gap: expr('{{ $json.gap }}'),
            expected_known: expr('{{ $json.expected_known }}'),
            expected_source: expr('{{ $json.expected_source }}'),
            is_pre_collected: expr('{{ $json.is_pre_collected }}'),
            pre_collected_undetermined: expr('{{ $json.pre_collected_undetermined }}'),
            month_shifted: expr('{{ $json.month_shifted }}'),
            advance_received: expr('{{ $json.advance_received }}'),
            chain_settled: expr('{{ $json.chain_settled }}'),
            in_flight_aed: expr('{{ $json.in_flight_aed }}'),
            vip: expr('{{ $json.vip }}'),
            v_vip: expr('{{ $json.v_vip }}'),
            refund_present: expr('{{ $json.refund_present }}'),
            credit_note_present: expr('{{ $json.credit_note_present }}'),
            block_pil: expr('{{ $json.block_pil }}'),
            payments_truncated: expr('{{ $json.payments_truncated }}'),
            ledger_rows: expr('{{ $json.ledger_rows }}'),
            unknown_statuses: expr('{{ $json.unknown_statuses }}'),
            unrecognised_type_codes: expr('{{ $json.unrecognised_type_codes }}'),
            caps: expr('{{ $json.caps }}'),
            needs_human: expr('{{ $json.needs_human }}'),
            population_sample: expr('{{ $json.population_sample }}'),
            scored_at: expr('{{ $json.scored_at }}')
        },
        schema: [
            { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'case_key', displayName: 'case_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'contract_id', displayName: 'contract_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'client_id', displayName: 'client_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'audit_month', displayName: 'audit_month', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'target_month', displayName: 'target_month', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'verdict', displayName: 'verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'state', displayName: 'state', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'red_flag_type', displayName: 'red_flag_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'reason_code', displayName: 'reason_code', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'reason_text', displayName: 'reason_text', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'gate', displayName: 'gate', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'expected_total', displayName: 'expected_total', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'paid_total', displayName: 'paid_total', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'gap', displayName: 'gap', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'expected_known', displayName: 'expected_known', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'expected_source', displayName: 'expected_source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'is_pre_collected', displayName: 'is_pre_collected', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'pre_collected_undetermined', displayName: 'pre_collected_undetermined', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'month_shifted', displayName: 'month_shifted', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'advance_received', displayName: 'advance_received', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'chain_settled', displayName: 'chain_settled', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'in_flight_aed', displayName: 'in_flight_aed', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'vip', displayName: 'vip', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'v_vip', displayName: 'v_vip', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'refund_present', displayName: 'refund_present', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'credit_note_present', displayName: 'credit_note_present', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'block_pil', displayName: 'block_pil', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'payments_truncated', displayName: 'payments_truncated', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'ledger_rows', displayName: 'ledger_rows', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
            { id: 'unknown_statuses', displayName: 'unknown_statuses', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'unrecognised_type_codes', displayName: 'unrecognised_type_codes', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'caps', displayName: 'caps', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'needs_human', displayName: 'needs_human', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'population_sample', displayName: 'population_sample', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
            { id: 'scored_at', displayName: 'scored_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ],
      },
      options: { optimizeBulk: true },
    },
  },
  output: [{ id: 1 }],
});

const chunkDone = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Chunk Summary',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const inp = $('Chunk In').first().json;\nconst planned = $('Fan Out Contracts').all().length;\nreturn [{ json: { runId: String(inp.runId || ''), auditedMonth: String(inp.auditedMonth), contractsInChunk: planned, ok: true } }];",
    },
  },
  output: [{ runId: 'run-x', auditedMonth: '2026-07', contractsInChunk: 25, ok: true }],
});

const note = sticky(
  '## MV Monthly Payment - Stage 2 (scoring worker)\n\n' +
  'Called once per chunk by Stage 1. Reads one contract at a time, scores it with the SAME\n' +
  'deterministic logic as audit/mv-monthly-payment/scorer.js (140 offline tests), writes one\n' +
  'case row per contract-month, and returns COUNTS ONLY so the parent never retains payloads.\n\n' +
  'The ERP token arrives in the run payload. This flow holds no ERP credential of its own.\n\n' +
  'Ledger read is size=1000 in one call (largest observed contract: 689 rows). If\n' +
  'rows.length !== totalElements the case is marked payments_truncated and routed to a human -\n' +
  'a negative from an incomplete ledger is never trusted.\n\n' +
  'DRAFT - never publish, never schedule.',
  [chunkIn, fanOut],
  { color: 3 }
);

export default workflow('mv-monthly-2-score', 'MV Monthly Payment - 2-Score chunk')
  .add(note)
  .add(chunkIn)
  .to(fanOut)
  .to(eachContract
    .onDone(chunkDone)
    .onEachBatch(readLedger.to(readDetails).to(scoreCase).to(insertCase).to(nextBatch(eachContract)))
  );
