// Attach Month Payments - index THREE months of payments and place each contract's
// receipts, per month, without ever stapling the rows onto a case.
//
// WHY THREE MONTHS. Gate 18 (Order 128) is the persistence test: a wrong rate
// persists, a light month does not. It requires the shortfall to repeat across the
// window with month-to-month variance <= 5.00, and it is what removes 88% of the
// freeze false positives using no freeze data at all (measured Jun-Aug 2026: a
// single-month test flags 17 frozen contracts, the persistence test cuts it to 2).
// The bulk endpoint caps at a 31-day window, so three months means three calls.
//
// MEMORY. The index is built as LOCALS and thrown away when this node returns. Item
// JSON is retained for the whole execution, so the sibling check crashed out of
// memory (execution 87369) by stapling one month of payment ROWS onto each of ~5,300
// cases. Here each case carries per-month SCALARS only - six numbers and a couple of
// flags per month - which the scorer consumes directly. It does NOT rebuild the
// index, and it does not need the rows: everything a gate asks about a month is
// already collapsed into those scalars.
const validated = $('Validate Inputs').first().json;

function s(v) { return v === null || v === undefined ? '' : String(v); }
function ymd(v) { return s(v).slice(0, 10); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---------------------------------------------------------------------------
// The payment-row normaliser. It lives ONLY here - unlike the sibling check, the
// scorer downstream reads collapsed scalars rather than rows, so there is no second
// copy to keep in step.
//
// The nine refund-bearing payment types, measured live on CC in July 2026. Gate 9
// nets only the FOUR that reverse a monthly payment; the other five, and anything
// unrecognised, route to a human instead of quietly changing a number.
const MP_REVERSING_REFUNDS = [
  'mp refunded to the client',
  'partial mp refunded to client',
  'full refund - freezing',
  'partial refund - freezing'
];
const OTHER_REFUNDS = [
  'non-mp refunded to the client',
  'full refund for cancellation - switch cc to mv',
  'refund due escalation after cancellation',
  'refund for cancellation at the beginning of the month',
  'service charge refund'
];
function refundKind(t) {
  const k = s(t).trim().toLowerCase();
  if (MP_REVERSING_REFUNDS.indexOf(k) !== -1) return 'mp_reversing';
  if (OTHER_REFUNDS.indexOf(k) !== -1) return 'other_known';
  // Detect the WORD refund so an unlisted refund type is never read as "not a
  // refund". A negative amount is NOT a reliable detector - ERP has recorded a
  // refund with a POSITIVE amount.
  if (k.indexOf('refund') !== -1) return 'unrecognised';
  return null;
}
// GATE 8, REWRITTEN 2026-08-14 (spec v1.5) - "Another payment type counts only
// when it closes a shortfall, never as income on its own".
//
// THE OLD FORM WAS A BLANKET SUM and it was wrong in the common case. Measured
// across the 534 contracts carrying a second charge: 400 are EXTRA - the contract's
// Monthly Payment was ALREADY a full standard rate and the other charge sits on top
// (5,712 monthly PLUS 5,712 service charge; 3,129 plus 9,409; 4,715 plus 8,715).
// Only 11 - 2% - are genuine splits like 1097602 (2,252 + 2,200 = the 4,452 owed).
// A blanket sum rescues 11 contracts and inflates `actual` on 400.
//
// So the split is preserved here and the GAP-COMPLETION test happens in the scorer,
// where `expected` is known: start from Monthly Payment alone, and only if that
// falls short do other non-refund types count, and only to the extent they close
// the gap. Money beyond the gap is a separate charge, not this month's fee.
//
// NEVER match the monthly type loosely: the allowlist is ONE entry, "Monthly
// Payment". "Monthly Payment Add-On" is a distinct type that a LIKE '%Monthly
// Payment%' swallows and an equality match drops - it is excluded here DELIBERATELY
// as not part of the monthly rate, which is the decision the rule defers to us.
const NOT_THE_MONTHLY_RATE = ['monthly payment add-on'];
// THE MONTHLY ALLOWLIST IS ONE ENTRY LONG. Never match the type loosely: a
// LIKE '%Monthly Payment%' swallows "Monthly Payment Add-On" and an equality match
// drops it - the deliberate decision here is that the Add-On is NOT part of the
// monthly rate. And never treat a type as monthly because its name sounds like it.
const MONTHLY_ALLOWLIST = ['monthly payment'];
function isMonthlyType(t) {
  return MONTHLY_ALLOWLIST.indexOf(s(t).trim().toLowerCase()) !== -1;
}
function countsTowardActual(type) {
  const k = s(type).trim().toLowerCase();
  if (refundKind(type)) return false;
  if (NOT_THE_MONTHLY_RATE.indexOf(k) !== -1) return false;
  return true;
}

function buildIndex(windows) {
  // windows: [{ key:'2026-07', from:'2026-07-01', to:'2026-07-31', node:'Get Month Payments' }, ...]
  const byContract = new Map();   // contract_id -> { '2026-07': {rows:[], ...}, ... }
  const stats = { bulk_rows: 0, bulk_cc: 0, out_of_window: 0, adv_rows: 0,
                  adv_out_of_window: 0, status_overrode_bulk: 0, bulk_only_rows: 0 };

  function slot(contractId, monthKey) {
    if (!byContract.has(contractId)) byContract.set(contractId, {});
    const m = byContract.get(contractId);
    if (!m[monthKey]) m[monthKey] = { rows: [], byId: {} };
    return m[monthKey];
  }
  function monthOf(date, wins) {
    for (const w of wins) if (date >= w.from && date <= w.to) return w.key;
    return null;
  }

  // ---- the three bulk sweeps: what arrived -------------------------------
  for (const w of windows) {
    for (const page of $(w.node).all()) {
      const rows = Array.isArray(page.json.payments) ? page.json.payments : [];
      for (const r of rows) {
        stats.bulk_rows++;
        // FILTER ON CONTRACT TYPE FIRST - the pull is ~80% MV by row count, and
        // auditing the wrong population passes every gate.
        if (s(r.contractType).indexOf('CC') !== 0) continue;
        stats.bulk_cc++;
        const date = ymd(r.paymentDate);          // NEVER paymentReceivedDate
        const mk = monthOf(date, windows);
        if (!mk) { stats.out_of_window++; continue; }
        const cid = s(r.contractID || r.contractId);
        if (!cid) continue;
        const row = {
          origin: 'received_bulk',
          payment_id: num(r.paymentId),
          amount: num(r.paymentAmount),
          method: s(r.paymentMethod),             // 'Card', never 'Credit Card'
          type: s(r.paymentType),
          date: date,
          status: '',                             // the bulk route returns NO status
          refund_kind: refundKind(r.paymentType),
          is_monthly: isMonthlyType(r.paymentType),
          counts_toward_actual: countsTowardActual(r.paymentType)
        };
        const sl = slot(cid, mk);
        const key = row.payment_id === null ? ('anon:' + sl.rows.length) : String(row.payment_id);
        sl.byId[key] = row;
      }
    }
  }

  // ---- the status sweep: what state each payment is in --------------------
  // ADVANCESEARCH WINS ON STATUS WHEREVER A PAYMENT APPEARS IN BOTH FEEDS.
  // This is the fix for a defect found in the sibling check on 2026-08-14: it
  // trusted every bulk row as settled money purely because the endpoint is named
  // getReceivedClientsPayments, and its de-duplication was first-wins with bulk
  // first - so a payment advancesearch calls DELETED was counted as collected
  // before its status was ever read. That masks findings, the worst direction to
  // fail in. Here the status row overwrites the bulk row, and bulk-only rows are
  // COUNTED so the residual assumption is measurable instead of load-bearing.
  for (const page of $('Get Payment Statuses').all()) {
    const rows = Array.isArray(page.json.content) ? page.json.content : [];
    for (const r of rows) {
      stats.adv_rows++;
      const stub = r.contract;
      if (!stub || typeof stub !== 'object') continue;
      const cid = s(stub.id);
      if (!cid) continue;
      const date = ymd(r.dateOfPayment || r.paymentDate);
      const mk = monthOf(date, windows);
      if (!mk) { stats.adv_out_of_window++; continue; }
      // THE TYPE IS AT typeOfPayment.NAME, and reading label/value silently emptied it
      // on EVERY advancesearch row. Measured 2026-08-18: this DTO's typeOfPayment
      // carries { code, id, name } - there is no label and no value - and `paymentType`
      // (the bulk feed's spelling) does not exist here either. So `type` was '' for
      // every row, and because a status row OVERRIDES the bulk row for the same
      // payment_id, the correctly-typed bulk row was discarded with it.
      //
      // WHAT THAT COST, and it is the whole basis of the check: isMonthlyType('') is
      // false, refundKind('') is null, countsTowardActual('') is TRUE. So every
      // received payment stopped counting as a Monthly Payment and started counting as
      // OTHER, monthly_net collapsed toward zero, and REFUNDS WERE COUNTED AS INCOME.
      // Proved by reverting only this read: a 10,000 monthly with a 5,000 MP-reversing
      // refund reported 15,000 received instead of 5,000 net. That destroys the
      // monthly-vs-other split gate 8 exists to preserve, and it can CLEAR a contract
      // whose monthly was never paid but which carries a non-monthly charge that
      // happens to land on the expected amount.
      //
      // `name` is the right field, not `code`: measured over the live vocabulary, name
      // matches the bulk feed's paymentType strings EXACTLY ('Monthly Payment',
      // 'Related to number of days', 'Full refund - freezing', ...) with zero
      // advancesearch-only values, so one allowlist serves both sweeps. `code` is
      // snake_cased ('monthly_payment') and would match nothing.
      const type = s((r.typeOfPayment && (r.typeOfPayment.name || r.typeOfPayment.code ||
                      r.typeOfPayment.label || r.typeOfPayment.value)) || r.paymentType);
      const row = {
        origin: 'advancesearch',
        payment_id: num(r.id || r.paymentId),
        // amountOfPayment, NOT amount - `amount` is present and null on EVERY row.
        amount: num(r.amountOfPayment),
        // methodOfPayment, NOT paymentMethod - the bulk feed's spelling does not exist
        // on this DTO, so this read was also always empty. Nothing decides on `method`,
        // so this one cost nothing; corrected so the column stops lying.
        method: s((r.methodOfPayment && (r.methodOfPayment.label || r.methodOfPayment.value)) ||
                  (r.paymentMethod && (r.paymentMethod.label || r.paymentMethod.value)) || r.paymentMethod),
        type: type,
        date: date,
        // status.value, NEVER status.label: the screen shows PDP where the API
        // returns PDC. Testing the label matches nothing, silently, forever.
        status: s(r.status && r.status.value),
        // REPLACEMENT LINKAGE IS NOT AVAILABLE ON THIS ROUTE, stated rather than left
        // to look functional. Measured 2026-08-18: neither `replacementForId` nor
        // `REPLACEMENT_FOR_ID` exists on the advancesearch DTO (0 of 40 rows), so this
        // read is always null and the replacement de-duplication below never fires.
        // Those names belong to the Snowflake table, not this API - which is also where
        // the 'PAYMENT_WAS_REPLACED is true on 112,458 of 112,458 rows' note came from.
        //
        // WHY IT IS NOT A HOLE HERE: only status === 'RECEIVED' counts toward actual,
        // and a replaced payment does not carry that status - the live sample ran
        // RECEIVED 28 / DELETED 10 / BOUNCED 2, and the 2 rows flagged `replaced: true`
        // were not RECEIVED. The status override is what actually removes them: a bulk
        // row with no status is superseded by its advancesearch row, which carries the
        // real one. So the de-dup is redundant here, not load-bearing. It stays wired
        // for the day the field appears, and `replaced` is carried so the assumption is
        // measurable instead of invisible.
        replacement_for_id: num(r.replacementForId || r.REPLACEMENT_FOR_ID),
        replaced_flag: r.replaced === true,
        refund_kind: refundKind(type),
        is_monthly: isMonthlyType(type),
        counts_toward_actual: countsTowardActual(type)
      };
      const sl = slot(cid, mk);
      const key = row.payment_id === null ? ('anon_adv:' + stats.adv_rows) : String(row.payment_id);
      if (sl.byId[key] && sl.byId[key].origin === 'received_bulk') stats.status_overrode_bulk++;
      sl.byId[key] = row;
    }
  }

  // ---- collapse to per-contract-per-month figures -------------------------
  for (const [cid, months] of byContract) {
    for (const mk of Object.keys(months)) {
      const sl = months[mk];
      sl.rows = Object.keys(sl.byId).map(function (k) { return sl.byId[k]; });
      delete sl.byId;

      // A replacement supersedes its original: count the replacement, drop the
      // row it replaced, so a bounced-then-settled month is neither double-counted
      // nor read as unpaid.
      const replaced = {};
      for (const p of sl.rows) if (p.replacement_for_id) replaced[String(p.replacement_for_id)] = true;

      let monthlyReceived = 0, otherReceived = 0, refundMp = 0, refundOther = 0, inFlight = 0;
      let unrecognisedRefund = false, bulkOnly = 0, deadRows = 0;
      const types = {};
      for (const p of sl.rows) {
        if (p.payment_id !== null && replaced[String(p.payment_id)]) continue;
        if (p.origin === 'received_bulk') bulkOnly++;
        if (p.refund_kind === 'mp_reversing') { refundMp += Math.abs(p.amount || 0); continue; }
        if (p.refund_kind === 'other_known') { refundOther += Math.abs(p.amount || 0); continue; }
        if (p.refund_kind === 'unrecognised') { unrecognisedRefund = true; continue; }
        if (!p.counts_toward_actual) continue;
        // SETTLED means RECEIVED. A bulk row carries no status and the endpoint's
        // name is the only evidence it is settled - counted, and counted as such.
        const st = p.status;
        if (st === 'RECEIVED' || (st === '' && p.origin === 'received_bulk')) {
          // RULE 8, REWRITTEN 2026-08-14 (spec v1.5): monthly and other are kept
          // APART here, because the gap-completion test downstream needs to start
          // from Monthly Payment ALONE. Summing them here would destroy the
          // distinction the rule exists to draw.
          if (p.is_monthly) monthlyReceived += (p.amount || 0);
          else otherReceived += (p.amount || 0);
          types[s(p.type)] = r2((types[s(p.type)] || 0) + (p.amount || 0));
        } else if (st === 'PRE_PDP' || st === 'PDC') {
          inFlight += (p.amount || 0);
        } else if (st) {
          deadRows++;
        }
      }
      stats.bulk_only_rows += bulkOnly;

      months[mk] = {
        rows: sl.rows.length,
        // Kept separate for rule 8. `received_gross` is monthly + other and is
        // reported for visibility ONLY - it is never the actual.
        monthly_received: r2(monthlyReceived),
        other_received: r2(otherReceived),
        received_gross: r2(monthlyReceived + otherReceived),
        refund_mp_reversing: r2(refundMp),
        refund_other: r2(refundOther),
        // GATE 9: only the MP-reversing refunds net off. Any other refund, or an
        // unrecognised one, is annotated and routed to a human - money going out is
        // not evidence about money coming in.
        monthly_net: r2(monthlyReceived - refundMp),
        in_flight: r2(inFlight),
        dead_rows: deadRows,
        unrecognised_refund: unrecognisedRefund,
        types_seen: types,
        bulk_only_rows: bulkOnly
      };
    }
  }
  return { byContract: byContract, stats: stats };
}

const WINDOWS = validated.persistence_windows;
if (!Array.isArray(WINDOWS) || WINDOWS.length !== 3) {
  throw new Error('Validate Inputs did not supply three persistence windows. Gate 18 cannot run on ' +
    'one month, and without it the freeze false positives come back (17 flagged vs 2).');
}
const idx = buildIndex(WINDOWS);

// The date filters on both routes are asserted rather than trusted: a wrong
// property name does not error, it returns the whole payment book.
if (idx.stats.adv_rows > 0 && idx.stats.adv_out_of_window > idx.stats.adv_rows * 0.5) {
  throw new Error('The status sweep returned ' + idx.stats.adv_out_of_window + ' of ' +
    idx.stats.adv_rows + ' rows outside the three audited months. The dateOfPayment filter is not ' +
    'narrowing - refusing to score, because unfiltered rows would settle the wrong month.');
}

const auditKey = WINDOWS[0].key;
const out = [];
const stats = { candidates: 0, paid_in_full: 0, carried: 0, nothing_received: 0, in_flight_only: 0 };

for (const item of $input.all()) {
  const c = Object.assign({}, item.json);
  if (c.skip_computation === true) {
    c.needs_enrichment = false;
    stats.carried++;
    out.push({ json: c });
    continue;
  }

  const months = idx.byContract.get(s(c.contract_id)) || {};
  const audited = months[auditKey] || null;

  // GATE 1 (Order 10): a month with NOTHING received belongs to the sibling check
  // - CC Non Received Monthly Payments - and is closed here so the same dirham is
  // never reported twice.
  const receivedAnything = !!audited && audited.received_gross > 0;

  c.months = {};
  for (const w of WINDOWS) {
    const m = months[w.key];
    // MONTHLY AND OTHER TRAVEL SEPARATELY, per rule 8 v1.5. There is deliberately
    // no combined `actual` here: the actual cannot be computed without `expected`,
    // and `expected` is not known until the scorer. Anything that pre-combined them
    // would be the blanket sum the rule was rewritten to remove.
    c.months[w.key] = m ? {
      monthly_received: m.monthly_received, other_received: m.other_received,
      monthly_net: m.monthly_net, received_gross: m.received_gross,
      refund_mp_reversing: m.refund_mp_reversing, refund_other: m.refund_other,
      in_flight: m.in_flight, dead_rows: m.dead_rows, rows: m.rows,
      unrecognised_refund: m.unrecognised_refund, types_seen: m.types_seen,
      bulk_only_rows: m.bulk_only_rows
    } : null;
  }
  c.received_anything = receivedAnything;
  // Only a month that collected SOMETHING can be short, so only those need the
  // plan and the coverage reads. Everything else is out of scope at gate 1.
  c.needs_enrichment = receivedAnything;

  if (!receivedAnything) {
    stats.nothing_received++;
    if (audited && audited.in_flight > 0) stats.in_flight_only++;
  } else {
    stats.candidates++;
  }
  out.push({ json: c });
}

console.log(JSON.stringify({ stage: 'attach_month_payments',
  windows: WINDOWS.map(function (w) { return w.key; }),
  bulk_rows: idx.stats.bulk_rows, bulk_cc_rows: idx.stats.bulk_cc,
  out_of_window: idx.stats.out_of_window, adv_rows: idx.stats.adv_rows,
  adv_out_of_window: idx.stats.adv_out_of_window,
  status_overrode_bulk: idx.stats.status_overrode_bulk,
  bulk_only_rows_trusted_without_status: idx.stats.bulk_only_rows,
  contracts_with_payments: idx.byContract.size,
  cases: out.length, in_scope_received_something: stats.candidates,
  out_of_scope_nothing_received: stats.nothing_received,
  of_which_in_flight_only: stats.in_flight_only, carried: stats.carried }));

return out;

