// ERP PRICE-CARD CROSS-CHECK.
//
// The card is a Drive file whose final window per cohort is open-ended (=TODAY()),
// and its own Traps field records the owner's warning that there may be
// "unregistered later prices". Nothing detected the sheet going stale until now.
//
// ERP cannot REPLACE the card - it holds no dated history, so it cannot say what
// the published price was in a past month, and the grandfathering test needs the
// 49 dated windows. See erp-price-card.md. What ERP can do is confirm the card's
// LEADING EDGE against the system of record, and expose where the card's
// three-bucket nationality model diverges from ERP's per-nationality pricing.
//
// Mapping rule, established 2026-08-19 against all 1026 rows (erp-price-matrix-mapping.md):
//   contractProspectType.code = maids.cc_prospect   (the MV variant's LABEL also
//                                                    starts "maids.cc" - match the CODE)
//   isDefault = true AND disabled = false
//   packageType = NORMAL_LONG_TERM
//   live-out = type LIVE_OUT ; live-in = type LONG_TERM
// Every other type/package is a different product: SHORT_TERM, INSIDE_COUNTRY,
// OUTSIDE_COUNTRY, RESIDENCY_VISA_RENEWAL, SWITCH_FROM_*, TEMPORARY_PACKAGE,
// PROBATION_PACKAGE, RENEWAL.
const TOL = 3.0;

const src = $("Parse + Assert Card").first().json;
const params = src.params;
const card = src.price_card;

// --- gather the paged ERP matrix -------------------------------------------
const pages = $input.all();
const rows = [];
const seen = {};
let totalElements = null;
let dupes = 0;
const pageProblems = [];

for (let i = 0; i < pages.length; i++) {
  const p = pages[i].json || {};
  const status = p.statusCode === undefined ? null : p.statusCode;
  const body = p.body;
  if (status !== 200) {
    pageProblems.push("page " + i + " returned HTTP " + status);
    continue;
  }
  const items = body && Array.isArray(body.content) ? body.content : (Array.isArray(body) ? body : null);
  if (items === null) {
    pageProblems.push("page " + i + " had no content array");
    continue;
  }
  if (body && body.totalElements !== undefined && totalElements === null) totalElements = Number(body.totalElements);
  for (const it of items) {
    const id = String(it.id);
    if (seen[id]) { dupes++; continue; }
    seen[id] = true;
    rows.push(it);
  }
}

// A short read here is the trap that made the first attempt report every cohort
// unmapped: the page caps at 500 while totalElements is 1026.
if (totalElements !== null && rows.length < totalElements) {
  pageProblems.push("SHORT READ: " + rows.length + " of " + totalElements + " config rows");
}

const enumv = function (v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String(v.value === undefined ? (v.label === undefined ? "" : v.label) : v.value);
  return String(v);
};
const codeOf = function (v, field) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String(v[field] === undefined ? "" : v[field]);
  return String(v);
};

const bucketOf = function (nat, liveOut) {
  const v = String(nat || "").trim().toLowerCase();
  if (v === "filipina") return "Filipina";
  if (v === "ethiopian") return liveOut ? "Other" : "Ethiopian";
  return "Other";
};

// --- project to the comparable set ----------------------------------------
const erpByCohort = {};
const perNationality = [];
for (const it of rows) {
  const prospect = codeOf(it.contractProspectType, "code").toLowerCase();
  if (prospect !== "maids.cc_prospect") continue;
  const isDefault = it.default === undefined ? it.isDefault : it.default;
  if (isDefault !== true || it.disabled === true) continue;
  if (enumv(it.packageType) !== "NORMAL_LONG_TERM") continue;
  const type = enumv(it.type);
  const isLiveOut = type === "LIVE_OUT";
  if (!isLiveOut && type !== "LONG_TERM") continue;
  const amount = it.monthlyPayment;
  if (amount === null || amount === undefined) continue;

  const nationality = codeOf(it.nationality, "label");
  const cohort = (isLiveOut ? "liveout" : "livein") + ":" + bucketOf(nationality, isLiveOut);
  if (!erpByCohort[cohort]) erpByCohort[cohort] = {};
  const k = String(amount);
  if (!erpByCohort[cohort][k]) erpByCohort[cohort][k] = [];
  erpByCohort[cohort][k].push(nationality);
  perNationality.push({ nationality: nationality, cohort: cohort, erp_price: Number(amount), config_id: it.id });
}

// --- the card's CURRENT window per cohort ---------------------------------
// The final window of each cohort is open-ended: its end date is =TODAY() in the
// source sheet, so "latest start" identifies it, never "covers today".
const cd = function (s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
};
const cardCurrent = {};
for (const w of card.windows) {
  const s = cd(w.start);
  if (s === null) continue;
  if (cardCurrent[w.cohort] === undefined || s > cardCurrent[w.cohort].start_ms) {
    cardCurrent[w.cohort] = { start_ms: s, start: w.start, price: w.price_inc_vat };
  }
}

// --- compare ---------------------------------------------------------------
const cohorts = Object.keys(cardCurrent).sort();
const results = [];
const divergent = [];
for (const cohort of cohorts) {
  const cardPrice = cardCurrent[cohort].price;
  const byPrice = erpByCohort[cohort] || {};
  const prices = Object.keys(byPrice).map(Number).sort(function (a, b) { return a - b; });
  const agreeing = prices.filter(function (p) { return Math.abs(p - cardPrice) <= TOL; });
  results.push({
    cohort: cohort,
    card_price: cardPrice,
    card_window_start: cardCurrent[cohort].start,
    erp_prices: prices,
    erp_price_agreeing_with_card: agreeing,
    agrees: agreeing.length > 0,
    nationalities_by_price: byPrice,
  });
  if (agreeing.length === 0) divergent.push(cohort + ": card " + cardPrice + " vs ERP " + JSON.stringify(prices));
}

// Nationalities ERP prices differently from their card bucket. NOT an abort:
// it is a standing declaration of where the check under-reports (ERP above the
// bucket, so a contract at the bucket price clears while below ERP's own price)
// and where it over-reports (ERP below, so a correct contract is flagged).
const bucketMismatch = [];
for (const pn of perNationality) {
  const cardPrice = cardCurrent[pn.cohort] === undefined ? null : cardCurrent[pn.cohort].price;
  if (cardPrice === null) continue;
  if (Math.abs(pn.erp_price - cardPrice) <= TOL) continue;
  bucketMismatch.push({
    nationality: pn.nationality,
    cohort: pn.cohort,
    erp_price: pn.erp_price,
    card_bucket_price: cardPrice,
    direction: pn.erp_price > cardPrice ? "erp_higher_check_under_reports" : "erp_lower_check_false_reds",
    config_id: pn.config_id,
  });
}

// Two enabled default rows for the same key means findSuitableConfig's answer is
// undefined. Reported, not fatal - it is ERP's data quality, not ours.
const conflicts = [];
for (const cohort of Object.keys(erpByCohort)) {
  const natSeen = {};
  for (const price of Object.keys(erpByCohort[cohort])) {
    for (const nat of erpByCohort[cohort][price]) {
      if (!natSeen[nat]) natSeen[nat] = [];
      natSeen[nat].push(Number(price));
    }
  }
  for (const nat of Object.keys(natSeen)) {
    const distinct = natSeen[nat].filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (distinct.length > 1) conflicts.push({ cohort: cohort, nationality: nat, prices: distinct });
  }
}

// --- gate ------------------------------------------------------------------
// Unreadable ERP does NOT stop the run: the card remains the yardstick and the
// cross-check is an addition, so losing it degrades assurance rather than
// invalidating the audit.
const unreadable = pageProblems.length > 0 || rows.length === 0;

// KNOWN, ESCALATED divergences. A divergence already understood-as-open must not
// block every audit - it has been investigated, written up and put to the spec
// owner. What must never pass silently is a divergence nobody has seen.
//
// livein:Ethiopian - card 3129, ERP NORMAL_LONG_TERM 2919 (2026-08-19). ERP's
// Ethiopian LONG_TERM/RENEWAL is exactly 3129, so "the card tracks the renewal
// price" and "the config moved after the spec's 2026-08-14 measurement" both fit
// and mean opposite things. getconfigs carries no last-modified to separate them.
// Remove this entry once the spec owner rules. See erp-price-matrix-mapping.md.
const ACCEPTED_DIVERGENCE = { "livein:Ethiopian": { card: 3129, erp: 2919 } };

const novel = [];
const accepted = [];
for (const r of results) {
  if (r.agrees) continue;
  const a = ACCEPTED_DIVERGENCE[r.cohort];
  const matchesAccepted = a !== undefined
    && Math.abs(a.card - r.card_price) <= TOL
    && r.erp_prices.length === 1
    && Math.abs(a.erp - r.erp_prices[0]) <= TOL;
  if (matchesAccepted) accepted.push(r.cohort + " (card " + r.card_price + " vs ERP " + r.erp_prices[0] + ", open with the spec owner)");
  else novel.push(r.cohort + ": card " + r.card_price + " vs ERP " + JSON.stringify(r.erp_prices));
}

// Default WARN, because the one divergence we know about is unresolved and the
// card is still the sanctioned yardstick. Flip to abort once it is settled.
const mode = String((params.card_crosscheck === undefined ? "warn" : params.card_crosscheck)).toLowerCase();
if (!unreadable && novel.length > 0 && mode === "abort") {
  throw new Error("PRICE CARD DISAGREES WITH ERP on " + novel.length + " cohort(s) not previously known: "
    + novel.join(" | ")
    + ". The sheet's current window is not what ERP charges, so it may be stale. Run stopped;"
    + " no contract was scored. Reconcile the card against ERP, or re-run with"
    + " params.card_crosscheck='warn' to proceed with the divergence declared.");
}

return [{ json: {
  params: params,
  price_card: card,
  erp_cross_check: {
    readable: !unreadable,
    problems: pageProblems,
    config_rows_read: rows.length,
    config_rows_total: totalElements,
    duplicates_dropped: dupes,
    cohorts_compared: cohorts.length,
    cohorts_agreeing: results.filter(function (r) { return r.agrees; }).length,
    results: results,
    mode: mode,
    novel_divergences: novel,
    accepted_divergences: accepted,
    bucket_mismatches: bucketMismatch,
    duplicate_default_configs: conflicts,
    note: unreadable
      ? "ERP price matrix unreadable this run - the card was NOT confirmed against the system of record"
      : (novel.length > 0
          ? "DECLARED: " + novel.length + " cohort(s) diverge from ERP and were not previously known"
          : (accepted.length > 0
              ? "the card agrees with ERP except for known open divergence(s): " + accepted.join("; ")
              : "the card's current window agrees with ERP on every cohort compared")),
  },
} }];
