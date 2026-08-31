// Change of Status Audit — deterministic scorer.
//
// Built standalone and tested offline BEFORE it went into n8n, so the spec's
// test cases are a fixed reference: if a later refactor moves these numbers,
// the refactor is wrong.
//
// DEGRADED BUILD, 2026-08-30. Probed live on the operator's token: the visa
// module (/visa/overstay-fines, /visa/newRequest) and payroll loans
// (/payroll/loans/getHousemaidLoans) return 401 INSUFFICIENT_PERMISSIONS.
// Two consequences, both declared rather than papered over:
//   1. The REQUEST GRAIN of rule 19 cannot run. A repeat pair outside ninety
//      days is therefore NOT settled — it exits `pending`, never `clean`,
//      except in the over-365 band (see WINDOW_BANDS below, and the declared
//      inflation this carries).
//   2. Orders 30-150 - fine sizing, recovery and waivers - cannot run at all,
//      because Order 40 forbids deriving a fine by subtraction and the fines
//      record is unreadable. A row carrying a fine exits `pending`, never
//      `clean` and never a finding.

// ---------------------------------------------------------------- constants ---

const LIVE_HEADS = [1677, 1589];          // rule 1 (Order 5): the live population
const MV_HEAD = 1677;
const CC_HEAD = 1589;

// All four heads, for the trailing-history comparison only. Rule 19 is
// deliberately all-era: a repeat pair can straddle the 2025-12-19 rename, and
// neither live Overstay check carries a duplicate rule at all, so restricting
// this to the live heads would leave current-era duplicates detected by nobody.
const ALL_COS_HEADS = [1677, 1589, 736, 150];

// Rule 17 (Order 15): the base in force on the transaction date. Never one
// constant - the 2016 base is AED 45.65 below today's, which is more than the
// most common real fine, so a single constant both invents and erases fines.
const BASE_BY_ERA = [
  { from: '2016-01-01', to: '2016-12-31', base: 530 },
  { from: '2017-01-01', to: '2017-12-31', base: 553 },
  { from: '2018-01-01', to: '2018-12-31', base: 556 },
  { from: '2019-01-01', to: '2023-12-31', base: 576 },
  { from: '2024-01-01', to: '2099-12-31', base: 575.65 }
];

// Rule 19's maid-grain window. The gap test is a PROXY for "a different visa
// cycle"; the visa request answers that directly and is unavailable here.
const DUPLICATE_WINDOW_DAYS = 90;

// Where an out-of-window repeat lands, given the request grain is blocked.
//   91-365  -> pending. Small (27 pairs in a decade) and the band Still-open
//              item 4 says a ruling would move anyway.
//   >365    -> clean, because the variable row states this band is legitimate
//              business behaviour (110 of 162 repeats), BUT the run summary must
//              declare that 4 of 117 historical over-a-year pairs shared one
//              visa request and are undetectable without visa access.
const OVER_YEAR_DAYS = 365;

const VERDICT_RANK = { finding: 4, inconclusive: 3, pending: 2, clean: 1 };

// The spec's verdict NAMES, mapped to the standard states. Reproduced exactly
// as the check page's "Verdict names" table gives them, because the check page
// reconciles that table against the policy database "cell by cell" - a paraphrase
// here would silently break that reconciliation.
//
//   finding (red) : Duplicate application - Unrecovered fine
//   clean (green) : Recovered - Waived - Under-threshold and paid anyway -
//                   One application, one price
//   pending       : Sub-threshold fine, no recovery found - Misfiled charge -
//                   Off-era - Raised but unsettled - Negative amount
//   inconclusive  : Identity unresolved - No record anywhere
//
// WHICH WORDS THIS DEGRADED BUILD CAN ACTUALLY REACH. Every word above whose
// producing rule sits in Orders 30-150 is unreachable, because those rules need
// the refused surfaces: `Unrecovered fine`, `Recovered`, `Waived`,
// `Under-threshold and paid anyway`, `Sub-threshold fine, no recovery found`,
// `Raised but unsettled` and `No record anywhere` cannot be produced at all.
//
// AND THE BUILD PRODUCES STATES THE SPEC HAS NO WORD FOR. The check page holds
// itself to "every promised verdict has a producing rule, and every rule's
// verdict maps to a named state". The degraded path breaks the second half:
// four outcomes below carry verdict_word = null and needs_verdict_word = true
// rather than borrowing a word that means something else. That is the same shape
// as Still open item 8 (the charge on the wrong maid's request, which also has
// no word), and it is surfaced rather than papered over.
const VERDICT_WORD = {
  duplicate:        { word: 'Duplicate application',      state: 'finding' },
  one_application:  { word: 'One application, one price', state: 'clean' },
  misfiled:         { word: 'Misfiled charge',            state: 'pending' },
  off_era:          { word: 'Off-era',                    state: 'pending' },
  negative:         { word: 'Negative amount',            state: 'pending' },
  identity:         { word: 'Identity unresolved',        state: 'inconclusive' },
  // No spec word exists for these four - all four are artefacts of the degraded
  // build, and naming them wrongly would be worse than leaving them unnamed.
  fine_unsized:     { word: null, state: 'pending', needs_word: 'a fine is present but the record that sizes it is refused' },
  out_of_window:    { word: null, state: 'pending', needs_word: 'a repeat outside ninety days that only the visa request could settle' },
  unreadable:       { word: null, state: 'pending', needs_word: 'a field required by a gate could not be read' },
  reversal_present: { word: null, state: 'pending', needs_word: 'a repeat on a maid who also carries a reversal' }
};

function applyWord(out, key) {
  const v = VERDICT_WORD[key];
  out.verdict = v.state;
  out.verdict_word = v.word;
  if (v.needs_word) { out.needs_verdict_word = true; out.unnamed_because = v.needs_word; }
  return out;
}


// ------------------------------------------------------------------ helpers ---

function toDay(d) {
  // Dates arrive as 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'. Compare on the
  // calendar day only: the booking date is what puts a row in the period.
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function dayDiff(a, b) {
  const A = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const B = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((B - A) / 86400000);
}

function resolveBase(day) {
  for (const b of BASE_BY_ERA) if (day >= b.from && day <= b.to) return b.base;
  return null;   // rule 17: never nearest-neighbour. An unmatched date is off-era.
}

// ------------------------------------------------------------ row scoring -----

// Order 25 - the purity gate. A Change-of-Status head also carries other
// products and those are not this population.
//
// Probed 2026-08-30: `newRequestExpense.purpose` is a structured enum reading
// 'Change of Status' on 40/40 rows. Keying on the enum beats parsing the
// description, and closes this rule's open technical action (which was "a full
// enumeration of the description vocabulary").
function purityCheck(row) {
  if (row.purpose !== undefined && row.purpose !== null && row.purpose !== '') {
    return String(row.purpose) === 'Change of Status'
      ? { pure: true }
      : { pure: false, reason: 'misfiled charge (purpose=' + row.purpose + ')' };
  }
  // Fallback for rows carrying no structured purpose (the legacy heads).
  const d = String(row.description || '');
  if (!d) return { pure: false, reason: 'misfiled charge (no purpose and no description to test)' };
  if (/change of status/i.test(d)) return { pure: true };
  return { pure: false, reason: 'misfiled charge (description names another product)' };
}

function scoreRow(row) {
  const out = {
    txn_id: row.txn_id,
    maid_id: row.maid_id === undefined ? null : row.maid_id,
    expense_id: row.expense_id,
    leg: row.expense_id === CC_HEAD ? 'CC' : (row.expense_id === MV_HEAD ? 'MV' : 'legacy'),
    date: toDay(row.date),
    amount: row.amount,
    verdict: null,
    reason: null,
    gate: null,
    capped_by: null
  };

  // Order 5 - population.
  if (LIVE_HEADS.indexOf(row.expense_id) === -1) {
    out.verdict = 'out_of_population';
    out.reason = 'expense head ' + row.expense_id + ' is not a live Change-of-Status head';
    out.gate = 'Order 5';
    return out;
  }
  if (!out.date) {
    applyWord(out, 'unreadable'); out.reason = 'unreadable transaction date'; out.gate = 'Order 128';
    return out;
  }

  // Order 25 - purity, BEFORE any concluding gate and before dedup.
  const pure = purityCheck(row);
  if (!pure.pure) {
    applyWord(out, 'misfiled'); out.reason = pure.reason; out.gate = 'Order 25';
    return out;
  }
  // `dedup_eligible` is set only where every input rule 19 needs was actually
  // READ: purity cleared, a real date, a resolved era, a positive readable
  // amount and an identity. It gates the duplicate rule below.
  //
  // THIS EXISTS BECAUSE OF A BUG FOUND IN TEST. The duplicate rule used to
  // overwrite `verdict` on any row it matched, including rows an earlier gate
  // had already routed to `pending` because a field was UNREADABLE. A row whose
  // amount could not be read, or whose date matched no era band, would be
  // promoted to `finding` - and rule 19 values a finding "at its own amount",
  // which is the very field that could not be read. In production that would
  // have raised red flags carrying a null amount against named maids.

  // A reversal. No gate above reads these, and rule 19 needs them netted.
  if (typeof row.amount === 'number' && row.amount < 0) {
    applyWord(out, 'negative'); out.reason = 'negative amount (reversal)'; out.gate = 'Order 128';
    out.is_reversal = true;
    return out;
  }

  // Order 15 - base by era.
  const base = resolveBase(out.date);
  if (base === null) {
    applyWord(out, 'off_era'); out.reason = 'off-era: no base band matches this date'; out.gate = 'Order 128';
    return out;   // not dedup_eligible: the era is unresolved
  }
  out.base = base;

  // Order 20 - overstay exists only where the amount exceeds the base.
  // Never treat a missing amount as the base: that silently means "no overstay".
  if (typeof row.amount !== 'number' || !isFinite(row.amount)) {
    applyWord(out, 'unreadable'); out.reason = 'amount missing or unreadable'; out.gate = 'Order 20';
    return out;   // not dedup_eligible: rule 19 values a finding at its own amount
  }
  out.fine_present = row.amount > base;

  // Order 30 / verifier Order 155 - identity. Every gate below identity is
  // UNREACHABLE, not passing.
  if (out.maid_id === null || out.maid_id === '' || out.maid_id === undefined) {
    applyWord(out, 'identity');
    out.reason = 'identity unresolved: no maid id, so no route to a loan, a fine or a contract';
    out.gate = 'Order 155';
    return out;
  }

  // Orders 30-150 - BLOCKED on this token. A row carrying a fine cannot be
  // sized (Order 40 forbids the subtraction) nor its recovery checked.
  if (out.fine_present) {
    applyWord(out, 'fine_unsized');
    out.reason = 'fine present but unsized: the overstay-fines record and the maid-loan record are both refused on the operator token';
    out.gate = 'Order 20 -> 128';
    out.capped_by = 'INSUFFICIENT_PERMISSIONS on /visa/overstay-fines and /payroll/loans';
    out.dedup_eligible = true;   // a duplicate is a duplicate whether or not it also carries a fine
    return out;
  }

  // Amount equals the base exactly: no overstay, and rule 19 still has to run.
  applyWord(out, 'one_application');
  out.reason = 'one application, one price';
  out.gate = 'Order 20';
  out.dedup_eligible = true;
  return out;
}

// ------------------------------------------------- Order 125 - the duplicate ---

// `population` = the month's rows. `history` = the same maids' Change-of-Status
// charges across ALL time and all four heads (including the population rows).
function applyDuplicateRule(scored, history) {
  // Net reversals first. The company's recovery channel for a duplicate is a
  // negative transaction on the same head, not a refund record - and both of the
  // only two negatives in ten years fall inside this rule's window. Score before
  // netting and the red list opens with the only two cases anyone ever recovered.
  const reversedAmounts = new Map();   // maid_id -> total negative magnitude
  for (const h of history) {
    if (typeof h.amount === 'number' && h.amount < 0 && h.maid_id != null) {
      reversedAmounts.set(h.maid_id, (reversedAmounts.get(h.maid_id) || 0) + Math.abs(h.amount));
    }
  }

  // Candidate history: purity-cleared, positive, dated, with a maid id, on a
  // Change-of-Status head. Never key on the maid's NAME - one maid appears under
  // two name strings, and one name string has resolved to two distinct maids.
  const byMaid = new Map();
  for (const h of history) {
    if (h.maid_id == null || h.maid_id === '') continue;
    if (ALL_COS_HEADS.indexOf(h.expense_id) === -1) continue;
    if (typeof h.amount !== 'number' || h.amount < 0) continue;
    if (!purityCheck(h).pure) continue;
    const d = toDay(h.date);
    if (!d) continue;
    if (!byMaid.has(h.maid_id)) byMaid.set(h.maid_id, []);
    byMaid.get(h.maid_id).push({ txn_id: h.txn_id, date: d, amount: h.amount, expense_id: h.expense_id });
  }
  for (const arr of byMaid.values()) arr.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  for (const row of scored) {
    // Only rows whose inputs were all actually read. A misfiled row is never
    // counted as a duplicate; an unattributed row never becomes a first charge;
    // and a row pending because a field was unreadable is never promoted to a
    // finding valued at that same unread field.
    if (!row.dedup_eligible) continue;

    const hist = byMaid.get(row.maid_id) || [];
    const idx = hist.findIndex(h => String(h.txn_id) === String(row.txn_id));
    if (idx <= 0) {
      row.duplicate_band = idx === 0 ? 'first charge on this maid' : 'not found in history';
      continue;
    }
    const prev = hist[idx - 1];
    const gap = dayDiff(prev.date, row.date);
    row.gap_days = gap;
    row.prior_txn_id = prev.txn_id;

    if (reversedAmounts.get(row.maid_id)) {
      row.duplicate_band = 'repeat, but a reversal exists on this maid';
      applyWord(row, 'reversal_present');
      row.reason = 'repeat charge on a maid who also carries a negative transaction - net the reversal before raising';
      row.gate = 'Order 125';
      continue;
    }

    if (gap <= DUPLICATE_WINDOW_DAYS) {
      row.duplicate_band = gap === 0 ? 'same day' : (gap <= 30 ? '1-30 days' : '31-90 days');
      applyWord(row, 'duplicate');
      row.reason = 'duplicate application: repeat Change of Status ' + gap + ' days after the previous one on the same maid';
      row.gate = 'Order 125';
    } else if (gap <= OVER_YEAR_DAYS) {
      // The request grain would have settled this. It is refused, so this is
      // NOT clean - it is unexamined.
      row.duplicate_band = '91-365 days';
      const band = 'repeat ' + gap + ' days apart, outside the ninety-day window: only the visa request can settle whether it is one cycle, and that surface is refused';
      if (row.verdict === 'clean') { applyWord(row, 'out_of_window'); row.reason = band; row.gate = 'Order 125'; }
      else { row.reason = row.reason + '; also ' + band; }
      row.capped_by = 'INSUFFICIENT_PERMISSIONS on /visa/newRequest';
    } else {
      row.duplicate_band = 'over 365 days';
      row.over_year_repeat = true;   // counted and declared in the run summary
    }
  }
  return scored;
}

// ------------------------------------------------------ case aggregation ------

// One case = one maid. The case verdict is the WORST of her transactions, and
// inconclusive outranks clean: one unreconcilable row means the case was not
// proven clean, whatever its siblings did.
function aggregateCases(scored) {
  const cases = new Map();
  for (const r of scored) {
    if (r.verdict === 'out_of_population') continue;
    const key = r.maid_id == null ? ('unattributed:' + r.txn_id) : ('maid:' + r.maid_id);
    if (!cases.has(key)) cases.set(key, { key: key, maid_id: r.maid_id, rows: [], verdict: 'clean', reasons: [] });
    const c = cases.get(key);
    c.rows.push(r);
    if (VERDICT_RANK[r.verdict] > VERDICT_RANK[c.verdict]) { c.verdict = r.verdict; }
    if (r.reason) c.reasons.push(r.reason);
  }
  return Array.from(cases.values());
}

function summarise(scored, cases) {
  const count = v => scored.filter(r => r.verdict === v).length;
  return {
    transactions_scored: scored.length,
    out_of_population: count('out_of_population'),
    rows_finding: count('finding'),
    rows_pending: count('pending'),
    rows_inconclusive: count('inconclusive'),
    rows_clean: count('clean'),
    cases: cases.length,
    cases_finding: cases.filter(c => c.verdict === 'finding').length,
    cases_pending: cases.filter(c => c.verdict === 'pending').length,
    cases_inconclusive: cases.filter(c => c.verdict === 'inconclusive').length,
    cases_clean: cases.filter(c => c.verdict === 'clean').length,
    // Declared inflation, per the builder process: a quietly absorbed gap is
    // worse than a loud one.
    over_year_repeats_cleared: scored.filter(r => r.over_year_repeat).length,
    capped_rows: scored.filter(r => r.capped_by).length,
    rows_needing_a_verdict_word: scored.filter(r => r.needs_verdict_word).length
  };
}


// ------------------------------------------------------------- projection ----
// Normalises a raw ERP `advancesearch` row into the slim shape the gates use.
// The description is reduced to a BOOLEAN and never carried forward: it holds
// the maid's name and passport number verbatim, and no rule needs either.
function project(r) {
  const hm = (r.housemaids && r.housemaids.length) ? r.housemaids[0] : null;
  const nre = r.newRequestExpense || {};
  const d = String(r.description || '');
  return {
    txn_id: r.id,
    maid_id: hm && hm.housemaid ? hm.housemaid.id : null,
    expense_id: Number((r.expense || {}).id),
    date: toDay(r.date),
    amount: typeof r.amount === 'number' ? r.amount : null,
    purpose: nre.purpose || null,
    desc_names_cos: d ? /change of status/i.test(d) : undefined,
    contract_id: r.contractId == null ? null : String(r.contractId),
    vat_type: r.vatType || null
  };
}

function run(population, history) {
  const scored = population.map(scoreRow);
  applyDuplicateRule(scored, history && history.length ? history : population);
  const cases = aggregateCases(scored);
  return { scored, cases, summary: summarise(scored, cases) };
}


// ---------------------------------------------------------------------------
// n8n glue. Everything above is generated verbatim from
// audit/change-of-status/scorer/score.js, which carries the offline test suite.
// Do not hand-edit this node: change score.js, run its tests, regenerate.
// ---------------------------------------------------------------------------
const population = ($('Verify Population Pull').first().json.rows || []).map(project);

let historyRows = [];
for (const p of $('Get Trailing History').all()) {
  const b = p.json || {};
  if (Array.isArray(b.content)) for (const r of b.content) historyRows.push(project(r));
}
if (!historyRows.length) {
  throw new Error('Trailing history is empty. Rule 19 compares each charge against the same maid\'s EARLIER charges, and a month compared only against itself finds 2 of the 10 known pairs. Refusing to score without history.');
}

const result = run(population, historyRows);
const pop = $('Verify Population Pull').first().json;
result.summary.history_rows = historyRows.length;
result.summary.pages_fetched = pop.pages_fetched;
result.summary.total_elements = pop.total_elements;
result.summary.population_complete = pop.population_complete;

return [{ json: { scored: result.scored, cases: result.cases, summary: result.summary } }];
