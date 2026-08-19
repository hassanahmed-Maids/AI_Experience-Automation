// Merge with previous_cases - combine this month's cohort with previous_cases.
// Output: one item per case, keyed case_key (= contract_id:YYYY-MM).
//
// CLONED from the golden. The carry-forward and auditor-override handling below
// is SKELETON and is not re-derived per check. Two changes only:
//   1. The golden's cohort filter (`housemaid.travelAssist === true`) is gone -
//      Build Cohort already settled the population, including maid-less
//      contracts, which this check must keep (gate 5 is measured on them).
//   2. case_key carries the month, so a carried case's shell keeps its own month
//      rather than inheriting this run's.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};
const prev = Array.isArray(params.previous_cases) ? params.previous_cases : [];

const cohortRows = $input.all().map(function (i) { return i.json; });

const working = new Map();

// AUDITOR OVERRIDES - skeleton behaviour, unchanged.
// green / red are PINNED: the auditor either closed the case or escalated it, so
// the state is kept and the case is not re-scored at all - in range or out.
// pending is deliberately NOT pinned: "pending" means "money is in flight, look
// again next run", so pinning it would freeze the case forever instead of
// letting the next run discover that the payment landed (or bounced).
const PINNED_OVERRIDES = ['green_flag', 'green_flag_manual', 'red_flag'];

function shell(key) {
  const month = String(key).indexOf(':') !== -1 ? String(key).split(':')[1] : validated.audit_month;
  const contractId = String(key).split(':')[0];
  return {
    case_key: key,
    contract_id: contractId,
    audit_month: month,
    client_id: '',
    client_name: '',
    maid_id: '',
    maid_name: '',
    contract_start: '',
    contract_status: '',
    termination_date: '',
    paid_end_date: '',
    sources: [],
    maid_present_now: false,
    previous_state: null,
    carried_state: null,
    manual_override_state: null,
    source: 'carry_forward',
    skip_computation: true
  };
}

for (const row of cohortRows) {
  const key = String(row.case_key || '');
  if (!key) continue;
  working.set(key, Object.assign({}, row, {
    previous_state: null,
    carried_state: null,
    manual_override_state: null,
    source: 'in_range',
    skip_computation: false
  }));
}

for (const p of prev) {
  if (!p || !p.case_key) continue;
  const key = String(p.case_key);
  const override = String(p.manual_override_state || '').trim();
  const inRange = working.has(key);

  if (override && PINNED_OVERRIDES.indexOf(override) !== -1) {
    const base = inRange ? working.get(key) : shell(key);
    base.previous_state = p.state || override;
    base.carried_state = override;
    base.manual_override_state = override;
    base.source = inRange ? 'manual_override' : 'manual_override_out_of_range';
    base.skip_computation = true;
    working.set(key, base);
    continue;
  }

  if (inRange) {
    const w = working.get(key);
    w.previous_state = p.state || null;
    if (override) w.manual_override_state = override;
    continue;
  }

  if (p.state === 'green_flag_manual') continue;

  // red and pending both carry forward without re-evaluation. pending_flag MUST
  // be here: a pending case is explicitly NOT settled, so leaving it out drops
  // the case the moment the window moves past it.
  if (p.state === 'red_flag' || p.state === 'pending_flag') {
    const sh = shell(key);
    sh.previous_state = p.state;
    sh.carried_state = p.state;
    sh.manual_override_state = override || null;
    working.set(key, sh);
  }
}

const out = Array.from(working.values());
console.log(JSON.stringify({
  stage: 'merge_with_previous_cases',
  total: out.length,
  in_range: out.filter(function (c) { return c.source === 'in_range'; }).length,
  carried_forward: out.filter(function (c) { return c.source === 'carry_forward'; }).length,
  pinned_overrides: out.filter(function (c) { return !!c.manual_override_state && c.skip_computation; }).length
}));

return out.map(function (c) { return { json: c }; });

