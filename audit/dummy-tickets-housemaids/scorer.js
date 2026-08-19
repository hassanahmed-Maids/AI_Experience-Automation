'use strict';
/**
 * Dummy Tickets Submitted for Refund — Housemaids
 * Deterministic scorer. Spec v0.4 draft (2026-08-17), check_id 7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02
 *
 * Pure functions, no n8n dependency, so the gate logic can be tested offline
 * against the spec's own test cases before any of it is wired into a flow.
 *
 * Gates run in ACP `Order` sequence, first match wins per ticket.
 * The case then takes the WORST of its tickets (gate Order 40).
 */

// ---------------------------------------------------------------- field readers

/** ERP writes several of these as objects; the payload disagrees with the
 *  spec's own "API Parameter Name" on `currency` (row says .label, its example
 *  values show {"name":"AED"}). Read either, prefer .label. */
function label(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return String(v.label ?? v.name ?? '').trim();
  return String(v).trim();
}

/** amountInAED arrives as a number, or "" on unresolved tickets.
 *  Empty/absent => null (UNKNOWN), which is NOT zero. */
function amount(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "2026-06-15 00:00:00" -> "2026-06-15". Empty stays empty; empty is never a date. */
function dateOnly(v) {
  const s = label(v);
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- vocabulary

const REFUND_SETTLED = ['REFUNDED', 'REFUND_SENT_TO_PAYERS'];
const AWAITING_STATUSES = ['ISSUED', 'REQUESTED', 'PENDING_REFUND', 'CANCELED'];
const GRACE_DAYS = 30; // owner ruling Jacky 2026-08-17, measured over n=3357

/** Case severity, worst first (gate Order 40). `Used` outranking `refund_overdue`
 *  is the spec's explicit ranking, not a slip: verifier rule 1 is ticket-scoped,
 *  so after it answers the case re-takes the worst of the REMAINING tickets and
 *  a sibling overdue red resurfaces. */
/** OWNER RULING (Hassan, 2026-08-19): `immaterial` ranks BELOW `refunded`, so a case whose
 *  money all came back reads clean even with a cancelled zero-amount ticket beside it. Before
 *  the ruling it ranked above, which made 26 of 93 reference-window cases pending with nothing
 *  in them to review. A case holding ONLY zero-amount tickets still lands pending, because
 *  nothing in it was ever verified as refunded. */
const SEVERITY = [
  'financial_loss',            // red      — gate 70
  'used_review',               // verifier — gate 80
  'refund_overdue',            // red      — gate 100
  'awaiting_scheduled_refund', // pending  — gate 50
  'unsettled',                 // pending  — gate 115
  'refunded',                  // clean    — gate 60
  'immaterial',                // pending  — gate 90  (below refunded, per the ruling)
  'clean_explained',           // clean    — verifier rule 1
];

const STANDARD_STATE = {
  financial_loss: 'finding',
  refund_overdue: 'finding',
  refunded: 'clean',
  clean_explained: 'clean',
  awaiting_scheduled_refund: 'pending',
  immaterial: 'pending',
  erp_unreachable: 'pending',
  unsettled: 'pending',
  unresolved: 'pending',
  used_review: 'verifier',
  repeat_bookings: 'verifier',
};

// ---------------------------------------------------------------- ticket gates

/**
 * Score ONE dummy ticket. Returns {verdict, reason, gate, amount_aed, flags[]}.
 * ctx: { run_date: 'YYYY-MM-DD', empty_schedule_means_do_not_request: boolean }
 */
function scoreTicket(raw, ctx) {
  const t = {
    id: raw.id ?? raw.ticketId ?? null,
    type: label(raw.ticketType),
    status: label(raw.status).toUpperCase(),
    outcome: label(raw.ticketOutcome),
    amount_aed: amount(raw.amountInAED),
    currency: label(raw.currency),
    refund_on: dateOnly(raw.requestRefundOn),
    auto_type: label(raw.requestRefundAutomaticallyType),
    flight_date: dateOnly(raw.flightTicketDate),
    refund_reason: label(raw.refundReason),
  };
  const flags = [];

  // --- Gate Order 10 (1) — only DUMMY is in scope. Exact match, never substring.
  if (!t.type) {
    return { ...t, verdict: 'unsettled', gate: 10, reason: 'ticketType_missing',
             flags: ['route_verifier_unknown_type'] };
  }
  if (t.type !== 'DUMMY') {
    return { ...t, verdict: 'out_of_scope', gate: 10, reason: `ticketType=${t.type}`, flags };
  }

  // A non-AED ticket is annotated. The guard only escalates when the ticket
  // ends up SIZED (a red) — escalating a REFUNDED SAR ticket would contradict
  // gate 60 and break spec test case 3 (applicant 1846842, one SAR one AED).
  if (t.currency && t.currency !== 'AED') flags.push('non_aed_currency');

  // --- Gate Order 50 (5) — a refund not yet due is pending, never a finding.
  // Empty refund_on is NOT a future date.
  if (t.refund_on && t.refund_on > ctx.run_date && AWAITING_STATUSES.includes(t.status)) {
    return { ...t, verdict: 'awaiting_scheduled_refund', gate: 50,
             reason: `scheduled_${t.refund_on}`, flags };
  }

  // --- Gate Order 60 (6) — a refunded dummy ticket is clean. Exact literals;
  // contains('REFUND') would turn REFUND_FAILED and REFUND_SENT_TO_PAYERS green.
  if (t.outcome === 'Refunded' || t.status === 'REFUNDED') {
    return { ...t, verdict: 'refunded', gate: 60, reason: 'refund_recorded', flags };
  }

  // --- Gate Order 70 (7) — Lost / REFUND_FAILED is THE finding.
  // One state seen through two fields: outcome shadows status.
  if (t.outcome === 'Lost' || t.status === 'REFUND_FAILED') {
    const f = [...flags];
    // Gate 90's zero floor must NOT be applied here retrospectively: a Lost
    // ticket with an unknown amount is still a loss of unknown size.
    if (t.amount_aed === null) f.push('route_verifier_for_pricing');
    if (f.includes('non_aed_currency')) f.push('route_verifier_currency');
    return { ...t, verdict: 'financial_loss', gate: 70, reason: 'lost_or_refund_failed', flags: f };
  }

  // --- Gate Order 80 (8) — flown on: never deterministically clean or red.
  if (t.outcome === 'Used') {
    return { ...t, verdict: 'used_review', gate: 80, reason: 'flown_on_dummy_ticket', flags };
  }

  // --- Gate Order 90 (10) — zero or unknown amount cannot open a case.
  // MUST precede gate 100, else the empty-schedule default drags every
  // zero-amount CANCELED row into the past-due red (154 of 271 live cases).
  if (t.amount_aed === null) {
    return { ...t, verdict: 'immaterial', gate: 90, reason: 'amount_unknown', flags };
  }
  if (t.amount_aed === 0) {
    return { ...t, verdict: 'immaterial', gate: 90, reason: 'amount_zero', flags };
  }

  // --- Gate Order 100 (9) — past its refund date and still unrefunded.
  // NOTE the spec contradiction on the empty auto_type, resolved conservatively.
  // See SPEC-FINDINGS.md #1. ctx flag lets the other reading be measured.
  const treatEmptyAsDoNotRequest = ctx.empty_schedule_means_do_not_request !== false;
  const doNotRequest = t.auto_type === 'DoNotRequestRefund'
    || (treatEmptyAsDoNotRequest && t.auto_type === '');
  const pastGrace = t.refund_on !== '' && t.refund_on <= addDays(ctx.run_date, -GRACE_DAYS);

  if ((pastGrace || doNotRequest) && !REFUND_SETTLED.includes(t.status)) {
    const f = [...flags];
    if (f.includes('non_aed_currency')) f.push('route_verifier_currency');
    return {
      ...t, verdict: 'refund_overdue', gate: 100,
      reason: pastGrace ? `overdue_since_${t.refund_on}`
                        : (t.auto_type === '' ? 'no_refund_scheduled' : 'do_not_request_refund'),
      flags: f,
    };
  }

  // --- Gate Order 115 (13) — terminal net. Silence never means clean.
  // Known to catch: a refund 1-29 days late, and REFUND_SENT_TO_PAYERS.
  return {
    ...t, verdict: 'unsettled', gate: 115, reason: 'no_gate_matched',
    flags: [...flags, `unmatched_status=${t.status || 'EMPTY'}`,
            `unmatched_outcome=${t.outcome || 'EMPTY'}`],
  };
}

// ---------------------------------------------------------------- case level

/**
 * Score ONE applicant's case from all their ticket rows (gate Order 40).
 * applicant: { id, reachable: bool|number, tickets: [...] }
 * ctx: { run_date, repeat_threshold: number|null, empty_schedule_means_do_not_request }
 */
function scoreCase(applicant, ctx) {
  const httpOk = applicant.reachable === true || applicant.reachable === 200;

  // --- Gate Order 30 (3) — an unreadable profile is an outage, not a finding.
  // Never "applicant_not_found": ERP returns 500, not 404.
  if (!httpOk) {
    return {
      applicant_id: applicant.id, verdict: 'erp_unreachable', state: 'pending',
      reason: 'applicant_profile_unreadable_after_retry', infrastructure: true,
      dummy_ticket_count: 0, tickets: [], exposure_aed: 0, flags: ['retry_next_run'],
    };
  }

  // --- Gate Order 20 (2) — identity. An unattributable transaction is never clean.
  if (applicant.id === null || applicant.id === undefined || applicant.id === '') {
    return {
      applicant_id: null, verdict: 'unsettled', state: 'verifier',
      reason: 'applicant_id_unresolved', dummy_ticket_count: 0, tickets: [],
      exposure_aed: 0, flags: ['route_verifier_no_identity'],
    };
  }

  const scored = (applicant.tickets || []).map((t) => scoreTicket(t, ctx));
  const inScope = scored.filter((t) => t.verdict !== 'out_of_scope');
  const count = inScope.length;

  // A count of 0 on an applicant reached through a 492 transaction is a
  // contradiction, and routes to the verifier rather than clearing.
  if (count === 0) {
    return {
      applicant_id: applicant.id, verdict: 'unsettled', state: 'verifier',
      reason: 'no_dummy_tickets_on_applicant_reached_via_expense_492',
      dummy_ticket_count: 0, tickets: scored, exposure_aed: 0,
      flags: ['route_verifier_scope_contradiction'],
    };
  }

  // --- Gate Order 40 (4) — the case takes the WORST, and lists every ticket.
  const worst = inScope.reduce((acc, t) => {
    const a = SEVERITY.indexOf(t.verdict);
    const b = SEVERITY.indexOf(acc.verdict);
    return (a !== -1 && (b === -1 || a < b)) ? t : acc;
  }, inScope[0]);

  const flags = [...new Set(inScope.flatMap((t) => t.flags))];

  // --- Gate Order 110 (11) — repeated dummy bookings are their OWN question.
  // Additive: it never replaces or downgrades the verdict above.
  // repeat_threshold is UNSET (Pending Business, owner Malaz) => gate inert.
  if (ctx.repeat_threshold === null || ctx.repeat_threshold === undefined) {
    if (count >= 2) flags.push('repeat_threshold_unset');
  } else if (count >= ctx.repeat_threshold) {
    flags.push('repeat_bookings_route_verifier');
  }

  // Exposure counts ONLY tickets that produced a red and carry a real amount.
  // Gate 90 cases are never sized (154 of 271 live cases are AED 0 CANCELED).
  const exposure = inScope
    .filter((t) => STANDARD_STATE[t.verdict] === 'finding' && t.amount_aed)
    .reduce((s, t) => s + t.amount_aed, 0);

  return {
    applicant_id: applicant.id,
    verdict: worst.verdict,
    state: STANDARD_STATE[worst.verdict] ?? 'pending',
    reason: worst.reason,
    driving_ticket_id: worst.id,
    dummy_ticket_count: count,
    tickets: inScope,
    exposure_aed: Math.round(exposure * 100) / 100,
    flags,
  };
}

/** Verifier rule 1 / 2 re-aggregation: a verifier answer is TICKET-SCOPED, and
 *  the case then re-takes the worst of its REMAINING tickets. This is the fix
 *  for the recheck's severity-1 (an explained emergency absorbing a sibling red).
 *  It re-aggregates ALREADY-SCORED tickets — it must never re-run the gates,
 *  which would discard the verifier's answer. */
function reaggregateAfterVerifier(caseRow, answers, ctx) {
  const patched = caseRow.tickets.map((t) => {
    const a = answers[t.id];
    if (!a) return t;
    // Verifier rule 1 (Order 120) — was travel on a dummy ticket an emergency?
    if (a.rule === 1 && t.verdict === 'used_review') {
      return a.explained
        ? { ...t, verdict: 'clean_explained', reason: 'verifier_emergency_explained' }
        : { ...t, verdict: 'financial_loss', reason: 'verifier_no_explanation' };
    }
    // Verifier rule 2 (Order 130) — refund handled outside ERP?
    // Never clears the amount; downgrades to pending and names who owes a receipt.
    if (a.rule === 2 && STANDARD_STATE[t.verdict] === 'finding') {
      return a.claimed
        ? { ...t, verdict: 'unresolved', reason: 'evidence_claimed_not_verified' }
        : t;
    }
    return t;
  });

  const worst = patched.reduce((acc, t) => {
    const a = SEVERITY.indexOf(t.verdict);
    const b = SEVERITY.indexOf(acc.verdict);
    return (a !== -1 && (b === -1 || a < b)) ? t : acc;
  }, patched[0]);

  const flags = [...new Set(patched.flatMap((t) => t.flags || []))];
  if (ctx && ctx.repeat_threshold != null && patched.length >= ctx.repeat_threshold) {
    flags.push('repeat_bookings_route_verifier');
  } else if (patched.length >= 2) {
    flags.push('repeat_threshold_unset');
  }

  const exposure = patched
    .filter((t) => STANDARD_STATE[t.verdict] === 'finding' && t.amount_aed)
    .reduce((s, t) => s + t.amount_aed, 0);

  return {
    ...caseRow,
    verdict: worst.verdict,
    state: STANDARD_STATE[worst.verdict] ?? 'pending',
    reason: worst.reason,
    driving_ticket_id: worst.id,
    tickets: patched,
    exposure_aed: Math.round(exposure * 100) / 100,
    flags: [...new Set(flags)],
    reaggregated: true,
  };
}

module.exports = {
  scoreTicket, scoreCase, reaggregateAfterVerifier,
  SEVERITY, STANDARD_STATE, GRACE_DAYS, label, amount, dateOnly, addDays,
};
