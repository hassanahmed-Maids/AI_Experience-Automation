// Build Case Payload - the portal payload, the HTML report and the run note.
//
// The payload SHAPE is the portal's contract and is unchanged from the sibling:
// { check_id, run_id, callback_url, result, result_data:{summary,cases},
//   result_html, email_html, notes, completed_at }.
//
// Read Build Runs Log BY NODE NAME, not from this node's input. The runs-log
// branch may or may not pass through an HTTP node (Callback - Runs Log), and an
// HTTP node REPLACES the item json - so reading $input here would silently lose
// every case on runs that do post the record. Both convergent branches carry the
// same upstream node, so naming it is the only stable read.
//
// FIVE BANDS, NOT THREE, and the reason is the whole point of this check:
//   Candidates    short against the contract rate. PROVISIONAL. The rate on file
//                 is NOT reliably the rate billed, so nobody may read these as
//                 findings - whether it is Underpaid or Under-billed is unknown
//                 until the verifier reads what we actually told the client.
//   Inconclusive  the money question cannot be answered from what we can read.
//   In flight     PRE_PDP / PDC would cover the gap. Money on its way.
//   Paid in full  inside the AED 5.00 tolerance, overpaid, or not owed.
//   Not in scope  nothing arrived at all - that is the SIBLING check's finding
//                 (CC Non Received Monthly Payments), closed here so the same
//                 dirham is never reported twice.
//
// The words on the badges are the owner's PROPOSED vocabulary - Underpaid /
// Under-billed / Paid in full or not owed / In flight / Can't tell - and the
// mapping is NOT signed off. Do not harden it further until it is.
const input = $('Build Runs Log').first().json || {};
const cases = Array.isArray(input.cases) ? input.cases : [];
const validated = $('Validate Inputs').first().json;
const runsLogState = String(input.runs_log_state || 'unknown');
const record = input.record || {};

const now = new Date().toLocaleString('en-AE', {
  timeZone: 'Asia/Dubai',
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
});

function s(v) { return v === null || v === undefined ? '' : String(v); }
function intAed(n) { return Math.ceil(Number(n) || 0).toLocaleString('en-US'); }
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build Runs Log stamps display_band on every case so this report, the Cases tab
// and the durable record cannot drift. The local fallback exists only so this
// node still renders if the runs-log branch is ever re-wired away from it - if it
// fires, the two nodes' definitions must be kept identical.
function bandOf(c) {
  if (c.display_band) return c.display_band;
  if (c.skip_computation === true) return 'carried';
  if (c.reason_code === 'out_of_scope_nothing_received') return 'not_in_scope';
  const cm = c.computed || {};
  const q = c.quoted || null;
  const quotedUnresolved = !!q && (q.no_quote_found === true || q.read_failed === true);
  if (cm.expected_known === false || c.reason_code === 'unscored' || quotedUnresolved) return 'inconclusive';
  if (c.new_state === 'pending_flag') return 'in_flight';
  if (c.new_state === 'green_flag' || c.new_state === 'green_flag_manual') {
    return c.requires_verifier === true ? 'inconclusive' : 'paid_in_full';
  }
  return 'candidate';
}

// The badge NEVER says "finding" on a case the scorer produced. A candidate whose
// verifier verdict has landed shows the verifier's word instead - and only then.
function badge(c) {
  const b = bandOf(c);
  const fr = s(c.finding_reason);
  if (b === 'candidate' && fr === 'Underpaid') {
    return '<span style="background:#B91C1C;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">UNDERPAID</span>';
  }
  if (b === 'candidate' && fr === 'Under-billed') {
    return '<span style="background:#9A3412;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">UNDER-BILLED</span>';
  }
  if (b === 'candidate') {
    return '<span style="background:#DC2626;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">CANDIDATE — NOT VERIFIED</span>';
  }
  if (b === 'inconclusive') {
    return '<span style="background:#7C3AED;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">CAN\'T TELL</span>';
  }
  if (b === 'in_flight') {
    return '<span style="background:#D97706;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">IN FLIGHT</span>';
  }
  if (b === 'not_in_scope') {
    return '<span style="background:#64748B;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">NOT IN SCOPE</span>';
  }
  return '<span style="background:#16A34A;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;">PAID IN FULL / NOT OWED</span>';
}

const transitions = { red_to_green: 0, green_to_red: 0, new_red: 0, new_green: 0 };
for (const c of cases) {
  const prev = c.previous_state, next = c.new_state;
  if (prev === 'red_flag' && next === 'green_flag') transitions.red_to_green++;
  else if (prev === 'green_flag' && next === 'red_flag') transitions.green_to_red++;
  else if (!prev && next === 'red_flag') transitions.new_red++;
  else if (!prev && next === 'green_flag') transitions.new_green++;
}

const itemsNew = cases.filter(function (c) { return !c.previous_state; }).length;
const itemsRechecked = cases.length - itemsNew;

const candidateCases    = cases.filter(function (c) { return bandOf(c) === 'candidate'; });
const inconclusiveCases = cases.filter(function (c) { return bandOf(c) === 'inconclusive'; });
const pendingCases      = cases.filter(function (c) { return bandOf(c) === 'in_flight'; });
const paidCases         = cases.filter(function (c) { return bandOf(c) === 'paid_in_full'; });
const outOfScopeCases   = cases.filter(function (c) { return bandOf(c) === 'not_in_scope'; });

// `fail` here means "there is something a human must resolve", NOT "findings were
// established". A run of pure candidates is a full review queue, not a verdict.
const overall = (candidateCases.length + inconclusiveCases.length) > 0 ? 'fail' : 'pass';

const candidateAed = Math.round(candidateCases.reduce(function (t, c) {
  const cm = c.computed || {};
  return t + (cm.expected_known === false ? 0 : (Number(cm.shortfall) || 0));
}, 0) * 100) / 100;

function caseRow(c) {
  const m = c.metadata || {};
  const cm = c.computed || {};
  const q = c.quoted || {};
  // "unknown" is a real answer and must never render as a zero: it means
  // currentPayment.amountValue could not be read, so there is no verified figure.
  const expected = cm.expected_known === false ? 'unknown' : 'AED ' + intAed(cm.expected);
  const shortfall = cm.expected_known === false ? 'unknown'
    : (Number(cm.shortfall) ? 'AED ' + intAed(cm.shortfall) : '—');
  const quoted = (q.requested_quoted !== null && q.requested_quoted !== undefined)
    ? 'asked AED ' + intAed(q.requested_quoted)
    : ((q.contract_rate_quoted !== null && q.contract_rate_quoted !== undefined)
        ? 'quoted rate AED ' + intAed(q.contract_rate_quoted) : '—');
  return '<tr>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">' + esc(c.case_key) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">' + esc(m.client_name || m.client_id || '') + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">' + esc(m.maid_name || m.maid_id || '—') + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">' + expected + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">AED ' + intAed(cm.actual) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">' + shortfall + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc(quoted) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">' + badge(c) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">' + esc(c.reason_text || '') + '</td>' +
    '</tr>';
}

function tableHtml(rows, title, accent) {
  if (!rows.length) return '';
  return '<h3 style="margin:18px 0 6px 0;color:' + accent + ';font-size:14px;">' + title + ' (' + rows.length + ')</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    '<thead><tr style="background:#F1F5F9;">' +
    '<th style="padding:6px 8px;text-align:left;">Contract-month</th>' +
    '<th style="padding:6px 8px;text-align:left;">Client</th>' +
    '<th style="padding:6px 8px;text-align:left;">Maid</th>' +
    '<th style="padding:6px 8px;text-align:right;">Agreed (expected)</th>' +
    '<th style="padding:6px 8px;text-align:right;">Received</th>' +
    '<th style="padding:6px 8px;text-align:right;">Shortfall</th>' +
    '<th style="padding:6px 8px;text-align:left;">What we quoted</th>' +
    '<th style="padding:6px 8px;text-align:left;">State</th>' +
    '<th style="padding:6px 8px;text-align:left;">Reason</th>' +
    '</tr></thead><tbody>' + rows.map(caseRow).join('') + '</tbody></table>';
}

function card(bg, accent, label, value) {
  return '<div style="background:' + bg + ';border-left:4px solid ' + accent + ';padding:10px 14px;min-width:130px;">' +
    '<div style="font-size:11px;color:#64748B;text-transform:uppercase;">' + label + '</div>' +
    '<div style="font-size:18px;font-weight:bold;">' + value + '</div></div>';
}

const headerColor = overall === 'pass' ? '#16A34A' : '#DC2626';
const headerText = overall === 'pass'
  ? 'EVERY MONTH PAID IN FULL, NOT OWED OR IN FLIGHT'
  : (candidateCases.length + ' CANDIDATE(S) — NOT FINDINGS' +
     (inconclusiveCases.length ? ' + ' + inconclusiveCases.length + ' CAN\'T TELL' : ''));

const summaryCardsHtml =
  '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">' +
  card('#F8FAFC', '#1B2A47', 'Audited', cases.length) +
  card('#FEF2F2', '#DC2626', 'Candidates', candidateCases.length) +
  card('#F5F3FF', '#7C3AED', 'Can\'t tell', inconclusiveCases.length) +
  card('#FFFBEB', '#D97706', 'In flight', pendingCases.length) +
  card('#F0FDF4', '#16A34A', 'Paid in full', paidCases.length) +
  card('#F1F5F9', '#64748B', 'Not in scope', outOfScopeCases.length) +
  card('#FEF2F2', '#B91C1C', 'Candidate AED', intAed(candidateAed)) +
  '</div>';

// THE LOUDEST THING ON THE PAGE, because the one way this report can do damage is
// by being read as a list of findings.
const candidateWarningHtml =
  '<div style="background:#FEF2F2;border:1px solid #FECACA;padding:8px 12px;margin:10px 0;font-size:12px;color:#7F1D1D;line-height:1.5;">' +
  '<strong>These are CANDIDATES, not findings.</strong> The expected amount is the contract\'s own stored ' +
  'rate (<code>currentPayment.amountValue</code>), and that rate is <strong>not reliably what was ' +
  'billed</strong>: on three verified contracts it read 4,715 / 4,715 / 5,712 while the client was billed ' +
  'and paid 2,100 / 2,100 / 3,360 for three to four consecutive months — and <em>both</em> numbers were ' +
  'sent to the same client in writing, days apart, by two different template families. So arithmetic ' +
  'alone cannot tell <strong>Underpaid</strong> (the client paid less than we asked) from ' +
  '<strong>Under-billed</strong> (we asked less than the contract says). Same money, different teams. ' +
  'That split is filled in by the verifier after reading what we actually quoted — never by the scorer.' +
  '</div>';

const run1Html =
  '<div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:8px 12px;margin:10px 0;font-size:11px;color:#475569;line-height:1.5;">' +
  '<strong>Run 1 is big by design.</strong> ' + esc(s(record.run1_expectation) ||
    '108 contracts are stably under-billed at roughly AED 64,000 a month, and the 2025 exception ' +
    'register clears NONE of them (owner\'s clean-slate ruling, 2026-08-13).') + ' ' +
  esc(s(record.residue_bounds) ||
    'Of the ~984 measured July 2026 shortfalls the surviving residue is bounded at roughly 1 (strict) ' +
    'to ~40 (lenient) — ~984 is a candidate count and must never be reported as findings.') +
  '</div>';

// The footnote states what this check does NOT answer, because a reader who
// assumes otherwise will read a candidate as a proven loss.
const footnoteHtml =
  '<div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:8px 12px;margin:10px 0;font-size:11px;color:#475569;line-height:1.5;">' +
  '<strong>What this check does and does not answer.</strong> It asks whether a client was billed or paid ' +
  '<em>less for a month</em> than the contract\'s own agreed monthly rate, and it is worth the shortfall ' +
  'in AED. Everything is compared <strong>VAT-inclusive</strong>: <code>agreed × 1.05</code> matches ' +
  '<strong>0 of 5,612</strong> contracts, so VAT is <strong>never</strong> added. The tolerance is ' +
  '<strong>AED 5.00 absolute</strong> — never a percentage, and never the price-card check\'s 3.00 — ' +
  'because ERP rounds VAT (a 4,714.50 card price is stored as 4,715.0). The expected amount is the ' +
  '<strong>contractual</strong> rate and is <strong>not reliably the amount billed</strong>. ' +
  'This check does <strong>not</strong> ask whether anything arrived at all — that is the sibling check ' +
  '(CC Non Received Monthly Payments), and a month with zero receipts is closed here as <em>not in ' +
  'scope</em> so the same dirham is never reported twice. Pro-rating uses ERP\'s own formula (daily = ' +
  'monthly ÷ days in that calendar month, both ends inclusive, rounded half-up). Freeze cannot be tested: ' +
  'ERP stores <strong>no freeze date</strong> anywhere, and a currently-frozen test was a proven 4-of-4 ' +
  'false positive on the largest July shortfalls — the three-month persistence test is the mitigation. ' +
  'Verdict names (Underpaid · Under-billed · Paid in full / not owed · In flight · Can\'t tell) are ' +
  '<strong>PROPOSED and not signed off</strong>. Out of scope by design: MaidVisa contracts, SDR, ' +
  'insurance, the nationality-switch fee and Travel Assist.' +
  '</div>';

// A stale bake does not fail the run - it quietly converts candidates into
// "can't tell". So it is stated on the face of the report.
const evidence = record.evidence || {};
const stalenessHtml =
  '<div style="background:#FFFBEB;border:1px solid #FDE68A;padding:8px 12px;margin:10px 0;font-size:11px;color:#92400E;line-height:1.5;">' +
  '<strong>Quoted-amount lookup:</strong> baked snapshot pulled <strong>' +
  esc(s(evidence.template_lookup_pulled_on) || 'unknown date') + '</strong>, ' +
  esc(String(Number(evidence.templates_in_lookup) || 0)) + ' templates known, ' +
  esc(String(Number(evidence.unknown_or_unresolved_templates) || 0)) + ' message template(s) not ' +
  'recognised or not resolvable on this run. This n8n instance has no Snowflake credential and ' +
  '<code>smsContent</code> is empty on every WhatsApp row, so the template bodies must be baked in — ' +
  'and a stale bake produces <em>inconclusive</em> cases rather than an error. Refresh from ' +
  '<code>/clientmgmt/clientbroadcast/templates</code> when this count is not zero.' +
  '</div>';

const runsLogWarning = runsLogState === 'configured' ? '' :
  '<div style="background:#FFFBEB;border:1px solid #FDE68A;padding:8px 12px;margin:10px 0;font-size:11px;color:#92400E;">' +
  '<strong>Runs log: ' + esc(runsLogState) + '.</strong> The durable run record was built and logged in the ' +
  'execution, but no allowlisted runs-log endpoint was supplied in the trigger payload, so it was not ' +
  'posted anywhere. The spec requires the runs-log write to be an independent target ordered before this ' +
  'report — the portal needs to send <code>params.runs_log_url</code> for that to be true end to end.' +
  '</div>';

const baseHtml =
  '<div style="font-family:Calibri,Arial,sans-serif;max-width:680px;">' +
  '<div style="background:#1B2A47;color:#fff;padding:12px 16px;">' +
  '<div style="font-size:16px;font-weight:bold;">CC Monthly Payments Below Agreed Amount</div>' +
  '<div style="font-size:12px;color:#CBD5E1;">' + esc(validated.audit_month) + ' · ' +
  esc(validated.range_start) + ' → ' + esc(validated.range_end) + ' · Run @ ' + esc(now) + ' (Dubai)</div></div>' +
  '<div style="background:' + headerColor + ';color:#fff;padding:6px 16px;font-size:13px;font-weight:bold;">' + headerText + '</div>' +
  '<div style="padding:12px 16px;">' +
  summaryCardsHtml + candidateWarningHtml + run1Html + footnoteHtml + stalenessHtml + runsLogWarning;

const fullTablesHtml =
  tableHtml(candidateCases, 'Candidates — under-billed or underpaid, unknown until verified', '#DC2626') +
  tableHtml(inconclusiveCases, 'Can\'t tell — the evidence could not answer it', '#7C3AED') +
  tableHtml(pendingCases, 'In flight', '#D97706') +
  tableHtml(paidCases, 'Paid in full / not owed', '#16A34A') +
  tableHtml(outOfScopeCases, 'Not in scope — nothing received (the sibling check\'s finding)', '#64748B');

// The emailed variant suppresses the settled bands. This check sends no email by
// design; the field is kept because the portal contract expects it.
const emailTablesHtml =
  tableHtml(candidateCases, 'Candidates — under-billed or underpaid, unknown until verified', '#DC2626') +
  tableHtml(inconclusiveCases, 'Can\'t tell — the evidence could not answer it', '#7C3AED');

const footerHtml =
  '</div>' +
  '<div style="background:#F8FAFC;color:#94A3B8;padding:8px 16px;font-size:11px;">Security Room · contract v1 · ' +
  'spec v1 (DRAFT) · flow generated v1 (DRAFT) · run_id ' + esc(validated.run_id) + '</div></div>';

const result_html = baseHtml + fullTablesHtml + footerHtml;
const email_html = baseHtml + emailTablesHtml + footerHtml;

const notes = overall === 'pass'
  ? 'All ' + cases.length + ' case(s) paid in full, not owed, in flight or out of scope.'
  : candidateCases.length + ' provisional candidate(s) of ' + cases.length + ' audited, worth AED ' +
    intAed(candidateAed) +
    (inconclusiveCases.length ? ', plus ' + inconclusiveCases.length + ' inconclusive' : '') +
    (pendingCases.length ? ' and ' + pendingCases.length + ' in flight' : '') +
    '. NOT findings: the contractual rate is not reliably the amount billed, so each candidate needs the ' +
    'quoted-amount read before it can be called Underpaid or Under-billed.';

const result_data = {
  summary: {
    items_audited: cases.length,
    items_new: itemsNew,
    items_rechecked: itemsRechecked,
    // Deliberately NOT named `red`/`green`: this check has no red it may keep.
    candidates: candidateCases.length,
    inconclusive: inconclusiveCases.length,
    in_flight: pendingCases.length,
    paid_in_full: paidCases.length,
    out_of_scope_nothing_received: outOfScopeCases.length,
    total_candidate_shortfall_aed: candidateAed,
    transitions: transitions,
    overall: overall,
    audit_window: validated.audit_window,
    audit_month: validated.audit_month,
    tolerance_aed: 5.00,
    amount_basis: 'contract\'s own agreed monthly rate, VAT-inclusive; agreed x 1.05 matches 0 of 5,612 ' +
      'contracts, so VAT is never added. The rate is CONTRACTUAL and not reliably what was billed.',
    findings_possible_here: false,
    runs_log_state: runsLogState,
    run_record: record || null
  },
  cases: cases
};

// A Code node in "run once for all items" mode MUST return. The sibling lost this
// statement once in an edit and would have delivered nothing at the END of a long
// expensive audit - it had simply not run since.
return [{ json: {
  check_id: validated.check_id,
  run_id: validated.run_id,
  callback_url: validated.callback_url,
  result: overall,
  result_data: result_data,
  result_html: result_html,
  email_html: email_html,
  notes: notes,
  completed_at: new Date().toISOString()
} }];
