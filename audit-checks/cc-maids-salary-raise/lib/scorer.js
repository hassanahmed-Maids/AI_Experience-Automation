'use strict';
/**
 * CC Maids Salary Raise — deterministic scorer.
 *
 * Implements the 15 LIVE deterministic gates from the Audit Conditional Policy — CC Maid
 * database, tagged `CC Maids Salary Raise`, IN `Order` SEQUENCE. Order is load-bearing: it is
 * the column, not the numeral. The numerals (❶…⓰) are citations and never change.
 *
 * This file is deliberately pure and n8n-free: no $json, no $input, no node context. It is the
 * fixed reference the n8n Code node calls. If a refactor changes the known-good numbers in
 * test/cases.js, the refactor is wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE LINE THIS WHOLE FILE EXISTS TO GET RIGHT (check page, "What are we comparing"):
 *
 *   An APPROVED BASE IS NOT A FINAL SALARY.
 *
 * Reading an approved figure as a ceiling called maid 65604 "the strongest finding" during the
 * rebuild when she is clean, and would have produced 3 false reds out of 5 across the entire
 * above-allowance population. The allowance is worked out PER MAID:
 *
 *   allowed = base + renewal_raise × min(qualifying_renewals, lifetime_cap)
 *
 * A flat nationality ceiling was tested against the five real cases and produced two confirmed
 * false reds with a third unresolved. Never reintroduce one.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

// ── Verdicts ────────────────────────────────────────────────────────────────────────────────
// Only these four. `candidate` is not a verdict a case may end on — it means "the deterministic
// layer is done and the verifier must read prose". A case still holding `candidate` at the end
// of a run is a bug, and adjudicate() throws on it rather than letting it drift to clean.
const V = {
  CLEAN: 'clean',
  FINDING: 'finding',
  PENDING: 'pending',
  CANDIDATE: 'candidate',
  OUT_OF_POPULATION: 'out_of_population'
};

// ── Constants that are RULINGS, not ERP reads ───────────────────────────────────────────────
// Both are maintained by a human and NOTHING upstream will change them for us when policy moves.
// Their variable rows say the run must STOP if one is missing: an absent cap silently makes the
// allowance unbounded and clears every finding; an absent cohort level re-creates the candidate
// flood the rulings resolved. So they are asserted, never defaulted.
const RULINGS = {
  // Jacky, 2026-08-19. LIFETIME, not a rolling window — a 2-year lookback gives every Filipina
  // exactly one qualifying renewal (renewals are themselves on a 2-year cycle), which makes a
  // 2-raise cap unreachable and flags the whole +700 population.
  renewal_raise_lifetime_cap: 2,

  // Jacky, 2026-08-19, observation-derived — NO ERP rule produces either. Keyed
  // nationality|living. Every other cohort has NO level and keeps its own salary-rule total.
  // Renewal raises DO NOT STACK on top of a ruled figure (check page, gate ⓰).
  ruled_cohort_level: {
    'Filipina|live_out': 3200,
    'Ethiopian|live_in': 1500
  }
};

// r-visa tag vocabulary. All four spellings, because the vocabulary DRIFTED: maid 7320's
// 2020/2022/2024 cycles carry `rVisa` while her 2018 cycle carries `stampedRvisa` / `oldRvisa` /
// `rvisaApplication` and no `rVisa` at all. Matching only `rVisa` reads a real pre-2020 renewal
// as "never renewed", which inflates her allowance downward and manufactures a red.
const RVISA_TAGS = ['rvisa', 'stampedrvisa', 'oldrvisa', 'rvisaapplication'];

// Explicitly NOT r-visa, though they ride on the same renew requests. Listed so a future reader
// can see the exclusion was deliberate rather than an oversight.
const NOT_RVISA_TAGS = [
  'newemiratesidfront', 'newemiratesidback', 'eidapplication', 'medicalcertificate',
  'lmpform', 'signedprejoiningagreement', 'stampedcontract', 'electronicworkpermit'
];

function assertRulings(rulings) {
  const cap = rulings && rulings.renewal_raise_lifetime_cap;
  if (!Number.isInteger(cap) || cap < 0) {
    throw new Error(
      'RULING MISSING: renewal_raise_lifetime_cap is not a non-negative integer. This is a ' +
      'constant a human maintains and ERP does not publish it (Salary_raise_Cap is specced in ' +
      'VPM-9915 but NOT deployed). An absent cap makes the allowance unbounded and clears every ' +
      'finding, so the run stops here rather than falling back.'
    );
  }
  const levels = rulings.ruled_cohort_level;
  if (!levels || typeof levels !== 'object') {
    throw new Error('RULING MISSING: ruled_cohort_level absent. Run stopped; nothing was scored.');
  }
  for (const k of Object.keys(levels)) {
    if (!(Number.isFinite(levels[k]) && levels[k] > 0)) {
      throw new Error('RULING INVALID: ruled_cohort_level["' + k + '"] is not a positive number.');
    }
  }
  return true;
}

/** Checksum over the rulings, asserted before anything is scored (Phase 5 rail). */
function rulingsChecksum(rulings) {
  const levels = rulings.ruled_cohort_level;
  const parts = Object.keys(levels).sort().map(k => k + '=' + levels[k]);
  return 'cap=' + rulings.renewal_raise_lifetime_cap + ';' + parts.join(',') +
         ';n=' + Object.keys(levels).length;
}

// ── Field readers, each carrying the trap that makes it necessary ───────────────────────────

/**
 * Order 45 ⓮ / variable `nationality_renewal_raise`.
 * Tags are a FLAT STRING ARRAY in 'key:value' form, not an object — parse, do not index.
 * TAG ABSENT IS THE ANSWER, not a gap: that nationality earns no renewal raise and the allowed
 * amount is the base alone. Never fall back to another nationality's value and NEVER hardcode
 * 350 — it is per-nationality and Finance can change it.
 * Must not be confused with `max_renewal_raise` (400 on Filipina), which caps the size of a
 * SINGLE raise. Similar names, different numbers, so the regex is anchored.
 */
function readRenewalRaise(tags) {
  if (!Array.isArray(tags)) return null;
  for (const raw of tags) {
    const m = /^renewal_raise:(\d+)$/.exec(String(raw).trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Variable `nationality_mv_app_salary_range` — CONTEXT, NEVER A CEILING.
 * It is the MaidVisa app's band and it explains why 561 of 798 CC Filipina live-out maids sit
 * on exactly 3,200; it does NOT authorise that figure (the gate ⓰ ruling does). Parsed here
 * only so a case record can carry the explanation. Split on the FIRST COLON ONLY or the JSON
 * is mangled — the value is JSON embedded in a string inside a string array.
 */
function readMvAppSalaryRange(tags) {
  if (!Array.isArray(tags)) return null;
  for (const raw of tags) {
    const s = String(raw);
    const i = s.indexOf(':');
    if (i > 0 && s.slice(0, i) === 'mv_app_salary_range') {
      try { return JSON.parse(s.slice(i + 1)); } catch (e) { return null; }
    }
  }
  return null;
}

/**
 * Variable `nationality_standard_total` / Order 40 ❹.
 * = getTotalSalaryFromComponents() (SalaryRule.java:418-429) — the SUM of every component
 * EXCEPT accommodationSalary.
 *
 * THIS IS NOT primarySalary. The ERP API library wrongly recorded primarySalary as the
 * nationality ceiling; it is 1500 Filipina / 1000 Ethiopian / 600 most others, and using it
 * re-prices every cohort and manufactures findings everywhere.
 *
 * Returns null rather than 0 when it cannot be computed. Defaulting a missing standard to 0
 * makes every maid look over-ceiling; defaulting it to Infinity clears everyone. Order 42 ❼
 * turns the null into `pending`.
 */
function sumSalaryRuleComponents(details) {
  if (!Array.isArray(details) || details.length === 0) return null;
  let total = 0;
  let counted = 0;
  for (const row of details || []) {
    const comp = row && row.salaryComponent;
    const label = String((comp && comp.label) || '').trim();
    if (label.toLowerCase() === 'accommodationsalary') continue;
    const v = Number(row && row.value);
    if (!Number.isFinite(v)) continue;
    total += v;
    counted++;
  }
  return counted === 0 ? null : total;
}

/**
 * Order 55 ❾ / variable `renewal_visa_document`.
 * Counts by the ATTACHMENT's creationDate, NEVER the renew request's. Maid 7320's request is
 * 2024-05-22 while her r-visa landed 2024-09-03; across 33 sampled maids the two dates gave
 * DIFFERENT VERDICTS on 3 (9%). ERP's own automated job grants the raise at the 'Upload The
 * e-Residency' step — which is the document — so the document date is the one that matches the
 * money.
 *
 * Counts DISTINCT renew requests carrying at least one r-visa attachment, not attachments: one
 * cycle can carry `stampedRvisa` AND `oldRvisa` AND `rvisaApplication` (maid 7320's 2018 cycle
 * does exactly that) and counting attachments would score one renewal as three.
 */
function countQualifyingRenewals(renewRequests, asOfISO) {
  if (!Array.isArray(renewRequests)) return { count: 0, dates: [], unreadable: true };
  const cutoff = asOfISO ? Date.parse(asOfISO) : null;
  const dates = [];
  for (const req of renewRequests) {
    const atts = (req && req.attachments) || [];
    if (!Array.isArray(atts)) continue;
    let earliest = null;
    for (const a of atts) {
      const tag = String((a && a.tag) || '').trim().toLowerCase();
      if (RVISA_TAGS.indexOf(tag) === -1) continue;
      const t = Date.parse(String((a && a.creationDate) || ''));
      if (!Number.isFinite(t)) continue;
      // Only renewals that had ALREADY HAPPENED by the audited month may raise her allowance.
      // A renewal uploaded after the month cannot justify money paid before it.
      if (cutoff !== null && t > cutoff) continue;
      if (earliest === null || t < earliest) earliest = t;
    }
    if (earliest !== null) dates.push(new Date(earliest).toISOString().slice(0, 10));
  }
  dates.sort();
  return { count: dates.length, dates, unreadable: false };
}

/**
 * Order 62 ⓭ / variable `payroll_additions` — the VPM-8374 shape.
 * That bug (closed `Won't Do`, STILL LIVE) is a maid whose profile read 2350 while payroll
 * computed 2000 and paid the 350 difference as a RECURRING MONTHLY ADDITION. Her
 * payroll_total_salary therefore reads exactly the standard while she is in fact paid above it —
 * a FALSE NEGATIVE the check cannot see any other way.
 *
 * RECURRENCE IS THE DISCRIMINATOR, NOT SIZE. A 1,500 airfare dwarfs a 350 raise and is a
 * one-off; maid 55376's 1,500 addition in May 2026 is an airfare ticket auto-added at the
 * e-Residency step that coincidentally equals her new salary and was misread as raise arrears
 * during the rebuild. So: the SAME amount across CONSECUTIVE months.
 *
 * Zero-valued additions are excluded — a run of 0.0 is "no addition", not a recurring raise.
 */
function detectRecurringAddition(history, minRun) {
  const need = Number.isInteger(minRun) && minRun >= 2 ? minRun : 2;
  const rows = (Array.isArray(history) ? history : [])
    .filter(r => r && r.formattedPayrollMonth)
    .slice()
    .sort((a, b) => monthKey(a.formattedPayrollMonth) < monthKey(b.formattedPayrollMonth) ? -1 : 1);

  let best = null;
  let runAmt = null;
  let runLen = 0;
  let runMonths = [];
  for (const r of rows) {
    const amt = Number(r.totalAddition || 0);
    // > 0 only. `payroll_additions` defaults to 0.0 and that default is SAFE here: a missing
    // addition can only make the check more conservative, never less.
    if (amt > 0 && runAmt !== null && amt === runAmt) {
      runLen++; runMonths.push(r.formattedPayrollMonth);
    } else if (amt > 0) {
      runAmt = amt; runLen = 1; runMonths = [r.formattedPayrollMonth];
    } else {
      runAmt = null; runLen = 0; runMonths = [];
    }
    if (runLen >= need && (best === null || runLen > best.months_count)) {
      best = { amount: runAmt, months_count: runLen, months: runMonths.slice() };
    }
  }
  return best;
}

/**
 * Normalises `formattedPayrollMonth` to a sortable YYYY-MM.
 *
 * ERP HANDS THIS BACK AS "MMM YYYY" — literally "Jul 2026". Confirmed live 2026-08-30 on
 * getHistoryLog. Neither the spec nor the variable row records the format, and an earlier
 * version of this function assumed YYYY-MM: it would have matched NO month at all, which reads
 * as "no payroll row for the audited month" and drops every maid out of population — a silent
 * empty run that looks like a clean one.
 *
 * Accepts the ERP form plus the ISO forms, so a warehouse-sourced fixture still keys correctly.
 */
const MONTH_ABBR = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                     jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function monthKey(s) {
  const t = String(s || '').trim();
  // "Jul 2026" / "July 2026" — the live ERP form.
  let m = /^([A-Za-z]{3,})\s+(\d{4})$/.exec(t);
  if (m) {
    const mm = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()];
    if (mm) return m[2] + '-' + mm;
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) return m[1] + '-' + m[2].padStart(2, '0');
  m = /^(\d{1,2})-(\d{4})$/.exec(t);
  if (m) return m[2] + '-' + m[1].padStart(2, '0');
  m = /^(\d{4})-(\d{1,2})-\d{1,2}/.exec(t);
  if (m) return m[1] + '-' + m[2].padStart(2, '0');
  return t;
}

/**
 * The maid's PREVAILING monthly total across the retrieved window — the modal `basicSalary`.
 *
 * WHY THIS EXISTS. The spec models `payroll_total_salary` as a stable contractual rate and
 * compares the audited month against entitlement. Probed live 2026-08-30, IT IS NOT STABLE:
 * maid 3978 reads +350 over her capped entitlement in 15 of her last 24 months and BELOW it in
 * five, with every single row marked `Paid`, transferred, and carrying no exclusion reason at
 * all. The dips are reduced months (unpaid days and the like), not rate changes.
 *
 * The consequence runs in the FALSE-CLEARANCE direction, which is the one that defeats the
 * check: audit a maid in a month that happened to be reduced and she clears, however far above
 * entitlement her actual rate is. Scoring maid 3978 — the spec's own flagship red — for
 * Jul 2026 clears her. Scoring her for Jun 2026 flags her correctly. The verdict should not
 * depend on which month the run happened to pick.
 *
 * The mode is used rather than the max so that a one-off spike (arrears, a correction) does not
 * become "her rate" either. A tie takes the higher value, since this check looks upward only.
 */
function prevailingTotal(history) {
  const counts = new Map();
  for (const r of (Array.isArray(history) ? history : [])) {
    const v = Number(r && r.basicSalary);
    if (!Number.isFinite(v)) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestVal = null, bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && v > bestVal)) { bestVal = v; bestN = n; }
  }
  return { total: bestVal, months: bestN, distinct_totals: counts.size };
}

/**
 * Variable `payroll_total_salary`.
 * NEVER netSalary. Net = total + additions − deductions, and maid 7320 reads 2550 in Dec 2025
 * and Jun 2026 purely because a 200 addition landed while her rate never moved.
 * The API hands the figure back as `basicSalary` (identical to `companySalary` on every row
 * observed) — and `basicSalary` is NOT a basic salary, it is the computed TOTAL.
 * No row for the audited month = OUT OF POPULATION for that month. Never a zero salary and
 * never clean.
 */
function readPaidForMonth(history, payrollMonth) {
  const want = monthKey(payrollMonth);
  for (const r of (Array.isArray(history) ? history : [])) {
    if (monthKey(r && r.formattedPayrollMonth) !== want) continue;
    const basic = Number(r.basicSalary);
    const company = Number(r.companySalary);
    const paid = Number.isFinite(basic) ? basic : (Number.isFinite(company) ? company : null);
    if (paid === null) return { paid: null, row: r, disagreement: false };
    // Observed identical on every row. If they ever diverge the assumption behind this reader is
    // gone, so surface it rather than silently preferring one.
    const disagreement = Number.isFinite(basic) && Number.isFinite(company) && basic !== company;
    return { paid, row: r, disagreement };
  }
  return { paid: null, row: null, disagreement: false };
}

function cohortKey(nationalityName, liveOut) {
  if (liveOut === null || liveOut === undefined) return null;
  const nat = String(nationalityName || '').trim();
  if (!nat) return null;
  return nat + '|' + (liveOut ? 'live_out' : 'live_in');
}

// ── The scorer ──────────────────────────────────────────────────────────────────────────────
/**
 * Scores ONE maid for ONE payroll month. One case is one maid in one payroll month — a maid
 * flagged two months running is two cases, because the approval may have arrived in between.
 *
 * `maid` carries only what the flow actually read. Every reader above returns null rather than
 * a plausible default, and every null lands on `pending` here rather than on `clean`.
 */
function scoreMaid(maid, opts) {
  const o = opts || {};
  const rulings = o.rulings || RULINGS;
  assertRulings(rulings);

  const trace = [];      // every rule that fired, in Order — this is the audit trail
  const gaps = [];       // named degradations that cap confidence

  /**
   * A gap BLOCKS A CLEAN only if resolving it could LOWER her allowance — i.e. only if the
   * missing information could turn a clean into a finding.
   *
   * This distinction is not pedantry, it is the difference between a usable check and an
   * unusable one. An unreadable renewal count and an unresolvable MV→CC service clock can only
   * ever RAISE her entitlement, so a maid already at or below the allowance composed WITHOUT
   * them cannot be overpaid whatever the answer turns out to be. Treating those as blocking
   * would mark all ~1,500 switchers pending every run and drown the reviewer in cases that
   * are provably fine — and a review queue nobody can get through is how a real finding gets
   * missed.
   *
   * Living status and the paid figure itself are the opposite shape: living status selects a
   * DIFFERENT and lower salary rule, and a disagreement about what she was paid undermines the
   * comparison outright. Those block.
   */
  function gap(text, blocksClean) { gaps.push({ text, blocks_clean: blocksClean === true }); }
  function blockingGaps() { return gaps.filter(g => g.blocks_clean); }
  function gapText() { return gaps.map(g => g.text); }

  function fired(order, numeral, name, detail) {
    trace.push({ order, numeral, name, detail: detail || null });
  }
  function settle(order, numeral, name, verdict, reason, extra) {
    fired(order, numeral, name, reason);
    return Object.assign({
      maid_id: maid.maid_id,
      payroll_month: maid.payroll_month,
      case_key: String(maid.maid_id) + ':' + monthKey(maid.payroll_month),
      verdict,
      settled_by: 'Order ' + order + ' ' + numeral,
      reason,
      trace,
      gaps: gapText(),
      gaps_detail: gaps,
      gaps_blocking: blockingGaps().map(g => g.text)
    }, extra || {});
  }

  // ── Order 10 ❶ — Join by ERP maid id, never by name or MOL ────────────────────────────────
  // Structural. Enforced by the fact that every record on `maid` was fetched BY id; there is no
  // name-matching path in this file at all. Asserted so a caller that assembles a case without
  // an id cannot get as far as a verdict.
  if (!(Number.isFinite(Number(maid.maid_id)) && Number(maid.maid_id) > 0)) {
    throw new Error(
      'JOIN KEY MISSING: a case reached the scorer without a numeric ERP maid id. Order 10 ❶ ' +
      'forbids joining on name, and MOL is retired (filterHousemaids returns none and needs ' +
      'none). Run stopped; nothing was scored.'
    );
  }

  // ── Order 20 ❷ — Exclude MaidVisa maids at the query, never after scoring ──────────────────
  // Also structural: the population request sends maidPayrollTypes:["MAID_CC"], which compiles
  // to housemaidType <> MAID_VISA, so MV maids never enter. There is NO 'CC' constant — CC is
  // defined negatively, which is why a predicate testing housemaidType == 'CC' never matches.
  // The assert below catches a filter that fell through, which the variable row warns is an
  // UNFILTERED dump of every housemaid (121,216 live 2026-08-19).
  if (maid.payroll_type && String(maid.payroll_type).toUpperCase() === 'MAID_VISA') {
    throw new Error(
      'MAID_VISA IN THE POPULATION (maid id ' + maid.maid_id + '). The maidPayrollTypes filter ' +
      'did not apply. Never filter these out after scoring — widen nothing. Run stopped.'
    );
  }

  // ── Order 25 ⓬ — A walk that does not reconcile is unresolved, never clean ─────────────────
  // Nothing is scored until the walk reconciles. This covers BOTH the population walk and the
  // per-maid evidence sweep. The evidence sweep is the one that condemns rather than clears:
  // `complaint/limited/housemaid/{id}` defaults to size=20 and maid 3978 has 96, so reading
  // page 0 and concluding "no approval exists" is a FALSE ABSENCE that nearly produced a red.
  if (maid.evidence_sweep && maid.evidence_sweep.reconciled === false) {
    return settle(25, '⓬', 'A walk that does not reconcile is unresolved, never clean', V.PENDING,
      'evidence sweep did not reconcile: pulled ' + maid.evidence_sweep.pulled + ' of ' +
      maid.evidence_sweep.total_elements + ' complaints. "Not on a page" and "does not exist" ' +
      'are indistinguishable, and the false direction condemns.');
  }

  // ── Out of population for this month ──────────────────────────────────────────────────────
  // Not a gate — it is the definition of the month's population, per `payroll_total_salary`:
  // no row for the audited month means she was not on that month's payroll. This is also how
  // the flow answers the OPEN paying-status question without a ruling: take every non-terminated
  // status, and let the presence of a payroll row decide who actually drew a salary.
  const paidRead = readPaidForMonth(maid.payroll_history, maid.payroll_month);
  if (paidRead.paid === null) {
    return settle(0, '—', 'No payroll row for the audited month', V.OUT_OF_POPULATION,
      'no payroll row for ' + monthKey(maid.payroll_month) + ' — she was not on that month\'s ' +
      'payroll. Never a zero salary and never clean.');
  }
  const paid = paidRead.paid;
  if (paidRead.disagreement) {
    // DOES NOT BLOCK. The spec's variable row DESIGNATES the field — payroll_total_salary is
    // "[].basicSalary" — and adds "(identical to [].companySalary on every row observed)" as an
    // OBSERVATION. That observation is FALSIFIED: probed live 2026-08-30, the two agree on only
    // 9 of 12 months for one real maid. The instruction still stands; only the parenthetical was
    // wrong, so basicSalary is used and the divergence is recorded rather than treated as an
    // unknown. Blocking on it would strand a large share of the population on a field the spec
    // never asked the check to read.
    gap('basicSalary and companySalary disagree on the audited month; basicSalary used, per the ' +
        'spec\'s designated field. The two are NOT always identical (falsified live 2026-08-30) ' +
        '— the spec\'s parenthetical claim that they are should be corrected.', false);
  }

  // ── Order 40 ❹ — Read the standard live from ERP, never from a spreadsheet ─────────────────
  // Realised by the caller (the flow reads salaryrules/getruleofhousemaid per maid). Recorded in
  // the trace so a case record shows the standard was live, and asserted below at Order 42.
  fired(40, '❹', 'Read the standard live from ERP, never from a spreadsheet',
    'salary rule read live per maid; no spreadsheet is consulted anywhere in this check');

  const ruleTotal = maid.salary_rule_no_rule_found
    ? null
    : sumSalaryRuleComponents(maid.salary_rule_details);

  // ── Order 42 ❼ — No live standard is unresolved, never clean ───────────────────────────────
  // `salary_rule_for_housemaid` returns HTTP 400 with the body 'No Rule is found!' for a maid
  // matching no rule — that is a real answer, and reading it as "no ceiling applies" clears
  // whatever she is paid. Two active rules disagreeing is the same shape of unknown.
  if (maid.salary_rule_conflict === true) {
    return settle(42, '❼', 'No live standard is unresolved, never clean', V.PENDING,
      'two active salary rules disagree for this maid — rule order is load-bearing inside ERP ' +
      'and cannot be reproduced offline, so the standard is unknown.');
  }
  if (ruleTotal === null) {
    return settle(42, '❼', 'No live standard is unresolved, never clean', V.PENDING,
      maid.salary_rule_no_rule_found
        ? 'salary rule returned "No Rule is found!" — a real answer meaning no standard, never ' +
          '"no ceiling applies".'
        : 'salary-rule components could not be summed, so nationality_standard_total is unknown. ' +
          'Defaulting it to 0 flags everyone; defaulting it to infinity clears everyone.');
  }

  // Living status and nationality are needed before a cohort level can be chosen.
  // Both refuse to guess: `maid_live_out` absent is UNKNOWN, not live-in — guessing live-in
  // picks the lower standard and MANUFACTURES an over-ceiling finding.
  if (maid.live_out === null || maid.live_out === undefined) {
    return settle(42, '❼', 'No live standard is unresolved, never clean', V.PENDING,
      'living status is unknown. Do not infer live-in: it picks the lower standard and ' +
      'manufactures an over-ceiling finding.');
  }
  if (!maid.nationality || !maid.nationality.name) {
    return settle(42, '❼', 'No live standard is unresolved, never clean', V.PENDING,
      'nationality missing, so no standard can be selected. ERP itself refuses to evaluate a ' +
      'salary cap without it.');
  }
  // Cross-check, per `maid_live_out`: ERP's boolean reflects TODAY while the audited month may
  // differ. Disagreement is REPORTED, never silently resolved.
  if (maid.live_out_asserted !== undefined && maid.live_out_asserted !== null &&
      maid.live_out_asserted !== maid.live_out) {
    // BLOCKS: living status selects a different salary rule, and live-in is the LOWER standard —
    // so resolving this the other way can lower her allowance and turn a clean into a finding.
    gap('living status disagrees between sources for the audited month; ERP\'s current boolean ' +
        'was used. Living status changes the applicable salary rule.', true);
  }

  // ── Order 45 ⓮ — A nationality with no renewal_raise tag earns no renewal raise ────────────
  // ABSENCE IS THE ANSWER. Ethiopian carries no renewal_raise tag at all (all 38 tags dumped and
  // checked), which independently confirms the ruling that Ethiopians receive no renewal raise.
  const renewalRaise = readRenewalRaise(maid.nationality.tags);
  const raisePerRenewal = renewalRaise === null ? 0 : renewalRaise;
  fired(45, '⓮', 'A nationality with no renewal_raise tag earns no renewal raise',
    renewalRaise === null
      ? 'no renewal_raise tag on ' + maid.nationality.name + ' — she earns no renewal raise and ' +
        'her allowance is the base alone'
      : 'renewal_raise:' + renewalRaise + ' on ' + maid.nationality.name);

  // ── Order 48 ⓰ — A ruled cohort level replaces the salary-rule total as the default base ───
  // The two ruled levels are Filipina live-out 3,200 and Ethiopian live-in 1,500. Renewal rises
  // DO NOT STACK on top of a ruled figure.
  const ck = cohortKey(maid.nationality.name, maid.live_out);
  const ruledLevel = ck ? rulings.ruled_cohort_level[ck] : undefined;
  const hasRuledLevel = Number.isFinite(ruledLevel);
  const base = hasRuledLevel ? ruledLevel : ruleTotal;
  if (hasRuledLevel) {
    fired(48, '⓰', 'A ruled cohort level replaces the salary-rule total as the default base',
      'cohort ' + ck + ' carries a ruled level; it is used as the base in place of the ' +
      'salary-rule total, and renewal raises do not stack on top of it');
  }

  // ── Order 50 ❺ — An approved base overrides the nationality standard ──────────────────────
  // The approved base exists ONLY as free text a human wrote — there is no structured field
  // holding it anywhere (`raiseApproved` is reachable but was EMPTY ON 14 OF 14 above-tier
  // candidates, so it corroborates when present and never clears when absent). The deterministic
  // layer therefore CANNOT apply this rule; it is realised by the verifier at Order 85/108/110.
  // Recorded so the trace shows it was considered rather than skipped.
  fired(50, '❺', 'An approved base overrides the nationality standard',
    'deferred to the verifier: the approved base exists only as prose, and there is no numeric ' +
    'field on Complaint at all');

  // ── Order 55 ❾ — Count renewals by r-visa document date, never by request date ─────────────
  const asOf = maid.month_end_iso || null;
  const renewals = countQualifyingRenewals(maid.renew_requests, asOf);
  if (maid.renew_requests_unreadable === true) {
    // DOES NOT BLOCK A CLEAN: an unread renewal can only ADD to her allowance, so a maid already
    // at or below the allowance composed with zero renewals is safe whatever the true count is.
    gap('renew-request documents were unreadable for this maid; the renewal count is not ' +
        'established. Her allowance is composed with the renewals that could be read, so it is ' +
        'a FLOOR — the true allowance can only be higher.', false);
  }
  fired(55, '❾', 'Count renewals by r-visa document date, never by request date',
    renewals.count + ' qualifying renewal(s) by r-visa attachment date' +
    (renewals.dates.length ? ' (' + renewals.dates.join(', ') + ')' : ''));

  // ── Order 57 ⓫ — MV→CC switchers earn the renewal raise on CC service, not on visa renewal ─
  // MV_TO_CC maids ARE in scope: they are CC now (1,500 of them). But their raise fires on every
  // 24 CONTINUOUS MONTHS AS CC, not at the visa-renewal step — so the Order 55 count does not
  // apply to them and Order 58 must not use it. Looking for a renewal and finding none would
  // wrongly flag them.
  // INTERIM, until a CC-service clock is readable: a switcher whose excess is not otherwise
  // explained is PENDING, NEVER RED — she must not reach the Order 60 candidate route on a
  // missing renewal alone.
  const isSwitcher = String(maid.payroll_type || '').toUpperCase() === 'MV_TO_CC';
  if (isSwitcher) {
    fired(57, '⓫', 'MV→CC switchers earn the renewal raise on CC service, not on visa renewal',
      'payroll type MV_TO_CC — the r-visa renewal count does not apply to her and is not used ' +
      'in the composition below');
    // DOES NOT BLOCK A CLEAN, for the same reason: her CC-service raise can only RAISE the
    // allowance. If she is at or below the base alone she is provably fine. If she is ABOVE it,
    // Order 57's interim guard below sends her to pending rather than red.
    gap('MV→CC switcher: her renewal raise is earned on 24 continuous months as CC, and no ' +
        'CC-service clock is readable. Her allowance is composed as the base alone, which is a ' +
        'FLOOR — the true allowance can only be higher.', false);
  }

  // ── Order 58 ❿ — Renewal raises are capped per maid for life ──────────────────────────────
  // allowed = base + renewal_raise × min(qualifying renewals, lifetime cap).
  // The cap is a RULING and is deliberately not describable as an ERP value.
  const cap = rulings.renewal_raise_lifetime_cap;
  const countedRenewals = isSwitcher ? 0 : Math.min(renewals.count, cap);
  const cappedOut = !isSwitcher && renewals.count > cap;
  // Renewal raises do not stack on a ruled cohort level (gate ⓰).
  const raiseComponent = hasRuledLevel ? 0 : raisePerRenewal * countedRenewals;
  const allowed = base + raiseComponent;
  fired(58, '❿', 'Renewal raises are capped per maid for life, and the cap is a ruling not an ERP value',
    'allowed = base(' + base + (hasRuledLevel ? ', ruled cohort level' : ', salary-rule total') +
    ') + ' + (hasRuledLevel ? '0 (raises do not stack on a ruled level)'
                            : raisePerRenewal + ' x min(' + renewals.count + ', ' + cap + ')=' +
                              raiseComponent) + ' = ' + allowed +
    (cappedOut ? ' — CAPPED OUT: ' + renewals.count + ' renewals against a lifetime cap of ' + cap : ''));

  const delta = paid - allowed;

  // ── Order 62 ⓭ — A recurring identical addition routes to the verifier even at standard ────
  // Runs BEFORE the clean gate on purpose: this is the only rule that can see a maid reading
  // exactly at standard who is nevertheless paid above it.
  const recurring = detectRecurringAddition(maid.payroll_history, o.recurring_min_months);

  // ── Order 60 ❻ — Above the allowed amount is a candidate, not a verdict ────────────────────
  if (delta > 0) {
    if (isSwitcher) {
      // Order 57's interim guard: a switcher must not reach the candidate route on a missing
      // renewal alone. She is pending, never red.
      return settle(57, '⓫', 'MV→CC switchers earn the renewal raise on CC service, not on visa renewal',
        V.PENDING,
        'paid above an allowance that cannot be composed for an MV→CC switcher, because her ' +
        'raise is earned on CC service and no CC-service clock is readable. Pending, never red.',
        { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
          capped_out: cappedOut, recurring_addition: recurring });
    }
    return settle(60, '❻', 'Above the allowed amount is a candidate, not a verdict', V.CANDIDATE,
      'paid ' + delta + ' above her composed allowance — a candidate for the verifier, never a ' +
      'verdict on its own',
      { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
        capped_out: cappedOut, recurring_addition: recurring,
        route_reason: cappedOut ? 'above_allowance_and_capped_out' : 'above_allowance' });
  }

  if (recurring) {
    return settle(62, '⓭', 'A recurring identical addition routes to the verifier even at standard',
      V.CANDIDATE,
      'total salary is at or below her allowance, but ' + recurring.amount + ' recurs across ' +
      recurring.months_count + ' consecutive months of additions — the VPM-8374 shape, where a ' +
      'raise is paid through ADDITIONS while total salary reads exactly at standard',
      { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
        capped_out: cappedOut, recurring_addition: recurring,
        route_reason: 'recurring_addition_at_standard' });
  }

  // ── Order 65 ⓯ — At or below the allowed amount is clean, FOR THAT MAID AND MONTH ONLY ─────
  // A clean has to be PRODUCED by a rule, never assumed.
  // The one deliberate deviation in this file lives here — see docs/spec-deviations.md, gate ⓰
  // at-exactly-the-ruled-level. Its own variable row leaves the boundary open, and clearing it
  // would auto-clear a population the ruling says is "not auto-clearable", so it routes instead.
  if (hasRuledLevel && paid === ruledLevel && o.route_at_exactly_ruled_level !== false) {
    return settle(48, '⓰', 'A ruled cohort level replaces the salary-rule total as the default base',
      V.CANDIDATE,
      'paid exactly at the ruled cohort level for ' + ck + '. The ruling\'s own row leaves this ' +
      'boundary OPEN (verifier ❷\'s counter-example is a DENIED raise at exactly this amount, ' +
      'and ruling #3 says the cohort is "not auto-clearable"), so the conservative reading routes ' +
      'her rather than clearing her.',
      { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
        capped_out: cappedOut, recurring_addition: recurring,
        route_reason: 'at_exactly_ruled_cohort_level' });
  }

  // ── Reduced-month guard — lands on Order 78 ⓯ ─────────────────────────────────────────────
  // NOT an ACP rule: it is a build-added guard, declared in docs/spec-deviations.md, and it is
  // deliberately routed to the existing catch-all (⓯ "anything no rule settled is pending, never
  // clean") rather than given a numeral of its own, because inventing rule numbers is a
  // governance act and the ACP is the only place rules live.
  //
  // If the audited month reads at or below entitlement but her PREVAILING total is above it, the
  // audited month is reduced and cannot demonstrate that her rate is compliant. Pending, never
  // clean — and never a finding either, since this guard proves nothing about authorisation.
  const prevailing = prevailingTotal(maid.payroll_history);
  if (prevailing && prevailing.total > allowed && paid <= allowed) {
    return settle(78, '⓯', 'A maid no rule settled is pending, never clean', V.PENDING,
      'the audited month reads at or below her allowance, but her PREVAILING monthly total ' +
      '(the modal figure across ' + prevailing.months + ' of the months read) is ABOVE it. The ' +
      'audited month is reduced, so it cannot show her rate is compliant. Scoring it as clean ' +
      'would clear her on the accident of which month the run picked.',
      { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
        capped_out: cappedOut, recurring_addition: recurring,
        prevailing_vs_allowed: prevailing.total - allowed,
        prevailing_months: prevailing.months, distinct_totals: prevailing.distinct_totals,
        route_reason: 'audited_month_reduced_below_prevailing_rate' });
  }

  const blocking = blockingGaps();
  if (blocking.length > 0) {
    // A gap that could LOWER her allowance caps the verdict. A clean produced over a hole of
    // that shape is exactly the silent false clearance this check exists to avoid.
    return settle(78, '⓯', 'A maid no rule settled is pending, never clean', V.PENDING,
      'at or below her allowance, but the case carries an unresolved gap that could lower it: ' +
      blocking.map(g => g.text).join(' | '),
      { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
        capped_out: cappedOut, recurring_addition: recurring });
  }

  return settle(65, '⓮', 'At or below the allowed amount is clean, for that maid and month only',
    V.CLEAN,
    'at or below her composed allowance, and no earlier rule routed or halted her',
    { paid_vs_allowed: delta, allowed, base, renewals_counted: countedRenewals,
      capped_out: cappedOut, recurring_addition: recurring });
}

module.exports = {
  V, RULINGS, RVISA_TAGS, NOT_RVISA_TAGS,
  assertRulings, rulingsChecksum,
  readRenewalRaise, readMvAppSalaryRange, sumSalaryRuleComponents,
  countQualifyingRenewals, detectRecurringAddition, readPaidForMonth, prevailingTotal,
  monthKey, cohortKey,
  scoreMaid
};
