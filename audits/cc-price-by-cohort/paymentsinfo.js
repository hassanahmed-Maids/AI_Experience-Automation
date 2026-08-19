// ---------------------------------------------------------------------------
// paymentPlan.paymentsInfo parser.
//
// ERP publishes a contract's payment schedule as human-readable strings:
//
//   'Service Fees: 4490 + 225 VAT, on Nov 01 2026 (Monthly)'
//   'Service Fees: 3990 + 200 VAT, on Sep 01 2026 (Monthly (for 2 months))'
//   'Service Fees: 2027 + 102 VAT, on Today (One Time Payment)'
//
// This is the ONLY place a plan's structure is visible. currentPayment.amountValue
// is whatever period happens to be current - a joining fee, an intro rate, or the
// steady-state monthly - and reading it produced nine false "under-priced"
// findings on 2026-08-18.
//
// Parsing prose is load-bearing, so anything that does not match the expected
// shape is returned as a PARSE FAILURE and routed to a human. A line is never
// silently skipped: a dropped entry could hide the very rate being audited.
// ---------------------------------------------------------------------------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// 'Nov 01 2026' -> UTC ms. Returns null for anything else, including 'Today',
// which the caller resolves against the contract's start date.
function parseEntryDate(s, contractStartMs) {
  const raw = String(s === undefined || s === null ? '' : s).trim();
  if (raw === '') return null;
  if (/^today$/i.test(raw)) return contractStartMs === undefined ? null : contractStartMs;
  const m = raw.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  return Date.UTC(Number(m[3]), mon, Number(m[2]));
}

function num(s) {
  const v = Number(String(s).replace(/,/g, ''));
  return isFinite(v) ? v : null;
}

// One line -> a structured entry, or {parse_failed: true} carrying the raw text.
function parseEntry(line, contractStartMs) {
  const raw = String(line === undefined || line === null ? '' : line).trim();
  if (raw === '') return { parse_failed: true, raw: raw, why: 'empty line' };

  // '<label>: <fee> + <vat> VAT, on <date> (<frequency>)'
  const m = raw.match(/^(.*?):\s*([\d,]+(?:\.\d+)?)\s*\+\s*([\d,]+(?:\.\d+)?)\s*VAT\s*,\s*on\s+(.+?)\s*\((.+)\)\s*$/i);
  if (!m) return { parse_failed: true, raw: raw, why: 'does not match the expected shape' };

  const fee = num(m[2]);
  const vat = num(m[3]);
  if (fee === null || vat === null) return { parse_failed: true, raw: raw, why: 'fee or VAT is not a number' };

  const effective = parseEntryDate(m[4], contractStartMs);
  if (effective === null) return { parse_failed: true, raw: raw, why: 'unreadable effective date: ' + m[4] };

  const freqText = m[5].trim();
  // The card is denominated in "minimum monthly payment + VAT", so the amount
  // that compares like-for-like is fee + VAT, not the fee alone.
  const amount = Math.round((fee + vat) * 100) / 100;

  let kind;
  if (/one\s*time/i.test(freqText)) kind = 'one_time';
  else if (/^monthly/i.test(freqText)) kind = 'monthly';
  else return { parse_failed: true, raw: raw, why: 'unrecognised frequency: ' + freqText };

  // 'Monthly (for 2 months)' bounds the entry to N months from its effective date.
  let durationMonths = null;
  const dur = freqText.match(/for\s+(\d+)\s+month/i);
  if (dur) durationMonths = Number(dur[1]);

  return {
    parse_failed: false,
    raw: raw,
    label: m[1].trim(),
    fee: fee,
    vat: vat,
    amount: amount,
    effective_ms: effective,
    kind: kind,
    duration_months: durationMonths,
  };
}

function ym(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// Parses every line and resolves which MONTHLY entries apply to a given month.
//
// Coverage: an entry runs from its effective month until either its stated
// duration expires or the next monthly entry begins, whichever comes first.
// One-time entries are excluded entirely - a joining fee is not a rate.
function resolveMonthlyRate(paymentsInfo, auditMonthMs, contractStartMs) {
  const lines = Array.isArray(paymentsInfo) ? paymentsInfo : [];
  const parsed = lines.map(function (l) { return parseEntry(l, contractStartMs); });
  const failures = parsed.filter(function (e) { return e.parse_failed; });

  const monthly = parsed
    .filter(function (e) { return !e.parse_failed && e.kind === 'monthly'; })
    .sort(function (a, b) { return a.effective_ms - b.effective_ms; });

  const oneTime = parsed.filter(function (e) { return !e.parse_failed && e.kind === 'one_time'; });

  const target = ym(auditMonthMs);
  const applicable = [];
  for (let i = 0; i < monthly.length; i++) {
    const e = monthly[i];
    const from = ym(e.effective_ms);
    if (target < from) continue;

    let until = Infinity; // exclusive
    if (e.duration_months !== null) until = from + e.duration_months;
    if (monthly[i + 1]) {
      const nextFrom = ym(monthly[i + 1].effective_ms);
      // Truncate only when the next entry genuinely STARTS LATER. Two monthly
      // entries effective in the same month do not supersede one another - they
      // overlap, and both stay applicable so the caller routes to a human
      // instead of silently letting the later line win.
      if (nextFrom > from && nextFrom < until) until = nextFrom;
    }
    if (target < until) applicable.push(e);
  }

  return {
    parsed: parsed,
    parse_failures: failures,
    monthly_entries: monthly,
    one_time_entries: oneTime,
    applicable: applicable,
  };
}

module.exports = { parseEntry, parseEntryDate, resolveMonthlyRate, ym };
