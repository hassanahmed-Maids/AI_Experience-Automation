---
# ═══════════════════════════════════════════════════════════════════════════
# AUDIT CHECK SKILL  ·  Same Day Recruitment Fee (SDRF) Verification
#
# Investigation logic below is NOT a draft: it is the manual re-check process
# authored and run by Jacky (Abdullah Mahdi) against the Apr-2026 tracker,
# transcribed from HOW_THIS_CHECK_WORKS.txt + SDRF_Live_Recheck.md + the code.
#
# Architecture change vs the old process: Jacky's runner took a CSV/XLSX export
# of the tracker as input. This skill removes that. The n8n flow now produces
# the red flags live on a schedule; the agent (Claude) then performs the manual
# investigation live against the ERP. No spreadsheet in the loop.
# ═══════════════════════════════════════════════════════════════════════════

id: same-day-recruitment-fee
name: Same Day Recruitment Fee (SDRF) Verification
version: 0.2.0
status: in_review              # logic complete; 2 baseline fixes must be honoured (see §6) before 'active'
owner: Police & Control Dept.
manual_source: Jacky (Abdullah Mahdi)

flow:
  workflow_name: Same Day Recruitment Fee Verification
  webhook_method: POST
  webhook_path: same-day-recruitment-fee-audit
  webhook_url: '{{N8N_BASE}}/webhook/same-day-recruitment-fee-audit'
  response_mode: async_callback

schedule:
  cron: '0 6 1 * *'            # 06:00, 1st of month, Asia/Dubai
  timezone: Asia/Dubai
  default_window: previous calendar month

trigger_payload:
  required: [check_id, run_id, callback_url, audit_window, auth]
  audit_window: '{ "kind": "month", "year": 2026, "month": 4 }  OR  { "kind": "date_range", "from": "...", "to": "..." }'
  auth: '{ "erp": { "token": "Bearer <jwt>", "device_id": "<optional>" } }'
  params:
    received_window: '{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }  # REQUIRED'
    payment_window:  '{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }  # REQUIRED'
    thresholds:      '{ "All": 8925 }  # flat AED 8,925 pre-VAT, ALL nationalities, no tiering'

result_contract:
  callback_fields: [check_id, run_id, result, result_data, warnings, notes, completed_at]
  work_items_path: result_data.checks[0].red_flags
  work_item_key: reason_code
  # RECOMMENDED (see §9 design note): have the flow also emit the full SDR payment
  # rows it already fetched, so the agent does NOT re-hit the HEAVY PaymentReport
  # endpoint that once got the ERP account banned.
  desired_flow_passthrough: [sdr_payment_rows_per_contract]

verdict_schema:
  per_flag: [contract_id, reason_code, verdict, probable_cause, exception_type, confidence, evidence, reasoning, evidence_link, checked_at]
  run_rollup: [total_red_flags, false_positive, justified, needs_action, escalated_to_human]

guardrails:
  min_confidence_to_auto_dismiss: 0.85
  never_auto_dismiss: [received_date_missing]     # data-entry gap -> always human
  on_missing_data: needs_human
  on_erp_error: escalate
  # ── ERP RATE LAW — non-negotiable, this endpoint once got the account banned ──
  erp_call_law:
    mode: sequential_only
    min_gap_ms: 350
    max_calls_per_run: 500
    circuit_breaker: trip_on_first_error          # after any ERP error, refuse all further calls this run
    heavy_endpoints_scope_tightly: [PaymentReport, contract_search]
---

# Same Day Recruitment Fee (SDRF) Verification

## 1. Purpose
The SDRF (ERP `typeOfPayment.id = 2`, "same_day_recruitment_fee") is the fee an
MV client owes for the maid's 2-year visa — the company only sells 2-year
visas, so the "2-year visa" line **is** the SDR fee. A red flag means the flow
expected the fee and did not cleanly see it. A flagged contract is **not** the
same as an underpaying client: the money may be paid, on an installment plan,
bounced, voided, refunded, discounted/credit-noted at signing, or covered by an
MV-to-MV replacement. This check's entire job is to separate the **genuine
shortfalls** (the only real finding) from that noise, with primary evidence and
a clickable ERP link behind every verdict.

## 2. How the automated flow decides a red flag
The flow pulls active MV contracts for the window, pulls their type-2 payments,
and flags any contract whose fee isn't RECEIVED-in-window at ≥ the minimum. It
emits one `reason_code` per flag. The flow's flag is only the *entry point* —
the agent re-derives the truth from the ERP and may overturn the flag (e.g.
mark it FALSE POSITIVE). Do not treat the flow's flag as the verdict.

## 3. Reason code catalogue (the flag the flow raises)
| reason_code | What the flow saw | Agent must investigate? |
|---|---|---|
| `missing_payment` | no type-2 payment found | Yes |
| `not_received` | fee exists, status ≠ RECEIVED | Yes |
| `received_date_missing` | Received but no date recorded | Yes → almost always human (data gap) |
| `received_before_window` | turned Received before window | Yes (timing, usually not a real miss) |
| `received_after_window` | turned Received after window | Yes (timing, usually not a real miss) |
| `amount_too_low` | Received in window, below minimum | Yes |

## 4. ERP access reference
Two hosts on purpose: the agent **reads the BACKEND**, a human **verifies on the
FRONTEND**.
- Backend API: `https://erpbackendpro.maids.cc`
- Frontend UI: `https://erp.maids.cc`
- **Auth is per-endpoint** off one raw token (`auth_mode`: `raw` / `bearer` /
  `secc` / `both`). A 401 usually means the **wrong mode for that endpoint**, not
  a dead token — flip the mode before assuming the token died.

| Purpose | Endpoint (method) · auth_mode · tier | Reads |
|---|---|---|
| SDR payments (was it paid?) | `POST /accounting/payments/page/advancesearch` · `raw` · **HEAVY** | filter body `[{contract.id},{typeOfPayment.id in [2]}]`; per-payment amount, status, dates, type |
| Contract → client id | `POST /clientmgmt/contract/search/page` · `secc` · **HEAVY** | needs `search_key`=contract id or it 400s |
| Manager/prospect notes + discount/credit note + payment plan | `POST /clientmgmt/client/get-client-details/{clientId}?type=CLIENT_DETAILS` and `?type=CONTRACT_DETAILS` (+`contractId`) · `bearer` · SAFE | `managerNotes[]`, `prospectNote.latest_notes[]`, `paymentPlan.additionalDiscount`, `paymentPlan.creditNoteDiscount`, `paymentPlan.paymentsInfo[]` |
| Complaints list | `GET /complaints/complaint/page/client/{clientId}?contract=<id>` · `bearer` · SAFE | complaint ids + `initialDescription` |
| Complaint thread | `GET /complaints/teamComplaintUpdate/historyOfComplaint/{complaintId}` · `bearer` · SAFE (⚠ same pagecode `ClientComplaints` as the list — easy 401 trap) | real staff comment thread |

**Evidence links written into the verdict (frontend, confirmed-live):**
- payments / notes / discount / credit note → `https://erp.maids.cc/client/client-profile/details/{clientId}`
- complaint → `https://erp.maids.cc/post-sale-services/open-todo/{complaintId}`

## 5. Investigation procedure (unified — run for every red flag)
The truth is re-derived from the ERP regardless of which `reason_code` came in.

**Step 1 — Baseline the expected amount (do this FIRST — see §6 Bug 2).**
Read `paymentPlan.paymentsInfo[]` and use the contract's own **"2-year visa"
line** amount as the expected baseline. Only fall back to the flat **AED 8,925
pre-VAT** if no such line exists. A signing-time credit note can legitimately
lower the real price (a real case: true price AED 3,883 incl. VAT, not 8,925) —
comparing against the flat fee here manufactures false positives. VAT tolerance
5%.

**Step 2 — Pull the SDR payment picture** (all pages, contract-scoped, type 2).
*If the flow already passed the payment rows through (see §9), reuse them —
don't re-hit the HEAVY endpoint.*

**Step 3 — Classify (first-match-wins resolver):**
1. Σ received ≥ expected × 0.95 → **FALSE POSITIVE** (it was paid)
2. pending/PRE_PDP tops the gap to threshold → **Installment plan**
3. any BOUNCED → **Payment bounced**
4. any DELETED/replaced and still short → **Payment voided/replaced**
5. any refund-typed payment → **Refund issued** (netted out, not summed)
6. partial (>0, < threshold) → **Genuine shortfall** → Step 4
7. zero → **Missing** → Step 4

Only cases 6 and 7 spend more ERP calls.

**Step 4 — Look for a legitimate explanation (shortfall/missing only), in order:**
- **(a) Structured contract discount / credit note — report this FIRST (see §6
  Bug 1).** `additionalDiscount` + `creditNoteDiscount` on the 2-year-visa line.
  If combined relief **covers** the shortfall (5% tol) → **JUSTIFIED
  (structured discount)**. Nonzero but insufficient → `contract_discount_partial`
  → manual review, **never** auto-cleared.
- **(b) MV-to-MV replacement → GREEN flag → JUSTIFIED.** Regex `\bmv\s*(?:to|-)\s*mv\b`
  (case-insensitive) in manager or prospect notes. A prior MV client already paid
  the visa cost, so a short/missing SDR here is expected. (Clears the flag —
  this was once implemented backwards; the correct behaviour clears it.)
- **(c) Written evidence:** manager notes → prospect notes → complaints,
  keyword-matched on `["amend","discount","waiver","waive","sdr","recruitment
  fee","price adjustment","installment","2-year visa","offer"]`.
  - **Skip intake-checklist templates:** if a prospect note contains the marker
    `"peekabo"` it's a fixed boolean template ("Discount: false" etc.) — never
    treat as evidence.
  - **Summary is NOT evidence.** Ignore the ERP-generated `summary`/
    `recentSummary`. Read the complaint's `initialDescription` (staff opening
    statement) + the real comment thread only.

**Step 5 — Emit verdict + primary evidence + real link** (per `verdict_schema`).

## 6. Mandatory correctness rules (baked-in fixes — required before `active`)
- **Bug 1 — never let a coincidental note keyword bury a real credit note.**
  Report/evaluate the structured contract discount (full or partial) **ahead of and
  independently of** the note/complaint keyword match. Real case: a genuine
  AED 4,301 credit note was dropped because an unrelated note matched "waive"
  first.
- **Bug 2 — the flat AED 8,925 is not universal.** Baseline against the
  contract's own `paymentsInfo` 2-year-visa line (Step 1); flag a mismatch
  rather than trusting the flat fee.
- **Keyword match ≠ justification.** Reading Apr-2026's 49 keyword-matched
  complaints by hand, ~0 genuinely explained the SDR shortfall (most were visa
  switch / EID / salary / ILOE / NOC — a stray word match). A match means the
  word appears, not that the ticket is about this fee. Only mark JUSTIFIED when
  the evidence actually concerns the SDR fee/amount; otherwise tag NOT RELATED.

## 7. Verdict vocabulary
- **Reasoning tag** (agent's synthesis of raw text): `JUSTIFIED` / `PLAUSIBLE` /
  `UNRESOLVED` / `NOT RELATED` / `AMBIGUOUS` / `NO TEXT`. Never paste the raw
  text or an id as the reasoning — write the synthesis + one honest tag.
- **Roll-up verdict:** Green Flag / Discounted / Justified / Plausible / Not
  Related / Ambiguous / Unresolved / Manual Review / **Unexplained Shortfall**
  (the only true finding) / False Positive / Bounced / Voided / Installments /
  Refund / No Shortfall.

## 8. Escalation & guardrails
- Below 0.85 confidence, or ambiguous/conflicting/missing data → `needs_human`.
- `received_date_missing` → always human (data-entry gap, in `never_auto_dismiss`).
- Very old (e.g. 2020-vintage) missing-payment flags: sanity-check contract/maid
  status before treating as a real finding.
- Honour the flow's `warnings[]` (e.g. `results_truncated`): a capped fetch means
  the flag set is incomplete — surface it, don't treat the run as exhaustive.
- **ERP rate law (frontmatter `erp_call_law`) is absolute.** Sequential, ≥350ms
  between calls, ≤500 calls/run, circuit-breaker trips on the FIRST error and
  refuses everything after. This exists because the HEAVY payments advancesearch
  endpoint once got the ERP account disabled. Never bypass it.

## 9. Design note for the integrated (no-CSV) architecture — decide with Jacky
The flow already fetches SDR payments to raise the flag; the agent's Step 2 would
re-fetch the same rows from the **HEAVY** endpoint that caused the outage.
**Recommendation:** have the flow emit its per-contract SDR payment rows inside
each red flag (`desired_flow_passthrough`), so the agent runs Steps 3–5 on that
data and only spends ERP calls on the SAFE explanation endpoints (notes /
discount / complaints). This keeps the "independent second opinion" spirit while
respecting the rate law. If a truly independent re-pull is wanted instead, it
must fit inside the 500-call budget with the 350ms floor.

## 10. Audit trail
Every verdict records: the red flag, the expected baseline used (paymentsInfo vs
flat) , each ERP query + raw finding, the resolver case, any discount/credit
note or note/complaint evidence (raw `initialDescription`+thread, never the
summary), the reasoning tag, confidence, the clickable link, and the timestamp.
No dismissal without traceable primary evidence.

## 11. Change log
| version | date | author | change |
|---|---|---|---|
| 0.1.0 | 2026-07-22 | Claude (from flow export) | Initial draft; investigation stubbed. |
| 0.2.0 | 2026-07-22 | Claude (from Jacky's SDRF package) | Investigation filled authoritatively from HOW_THIS_CHECK_WORKS + spec + code: unified resolver, structured-discount short-circuit, MV-to-MV green flag, intake-checklist skip, summary≠evidence rule, both baseline bugs as mandatory fixes, ERP rate law, CSV→integrated architecture note. |
