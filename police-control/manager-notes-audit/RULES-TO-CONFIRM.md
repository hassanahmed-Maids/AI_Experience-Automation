# Rules to confirm — one page per payment type

**For payroll (George Abboud) · drafted 2026-09-10**

Every rule below is written as a **testable assertion**, in the shape the Last Day CC Switch rules
arrived in — *the maid must be MV · no duplication · not above AED 150*. Those three took one message
to state and produced a clean 213/213 verdict the same day.

**Confirm or correct each line.** A "yes" is enough; a correction is more useful than an explanation.
Where a rule is wrong, the wrong version is more useful to us than silence, because we can measure the
gap between what is written and what is happening.

Tags: 🟩 **code-verified** — read from the ERP source · 🟦 **config** — read from
`EXPENSES_CONFIGURATION` · 🟨 **inferred** — from how the data behaves · 🟥 **guess** — we have nothing.

Ordered by money. The first three carry AED 5.01m of the AED 6.79m examined.

---

---

## SCOPE — SETTLED BY MOE, 2026-09-15

| Question | Answer | Consequence |
|---|---|---|
| Payslip additions only, or all money reaching a maid? | **Payslip additions only** *(read from "yes" alongside the six narrowing answers; flagged for correction)* | "Paid manually" money is **out of scope**. Say so when quoting any total — it is a known, accepted hole, not an oversight |
| Audit deductions? | **No** | `NOTE_TYPE = 'ADDITION'` stands. X2 is closed, not deferred |
| Fixed window? | **No — the dashboard reads live data in whatever window the user picks** | See *Check design* below. This is the biggest constraint on the spec |
| Zero-amount notes in scope? | **No** | `AMOUNT > 0` is **mandatory in every check**. This is the exact filter whose absence produced the retracted AED 49,500 artefact — the exclusion is now a rule, not a preference |
| Who may edit a note's amount/date; should it be logged? | **Out of scope** ("we don't care about that cycle") | The override gap stays recorded as an observation. Not a dashboard check |
| Is zeroing the sanctioned cancellation? | **Out of scope** ("idk and idc") | Recorded, not pursued |
| Is secondary-payroll re-generation a known defect? | **Not ours** | Hand the two evidence notes to whoever owns payroll; do not build a check for it |

### 🔴 CHECK DESIGN — what a user-chosen window forces

A window picked at runtime means **any rule expressed as an aggregate over the window silently
changes answer as the user drags it.** Three consequences, binding on every check in this spec:

1. **Lookbacks ignore the display window.** "No second airfare within 5 months" looks 5 months back
   from THE NOTE, even when the user is viewing one month. A check that only sees the displayed
   rows will report a clean month that is not clean.
2. **Anything expressed as a share of the window is NOT a check.** Requester concentration, producer
   share, "% of notes" — all move with the slider. Investigative tools, not dashboard rules.
3. **Base rates and chance baselines cannot live in the UI**, for the same reason.

**The testable surface is therefore: one addition, `AMOUNT > 0`, given a verdict on its own terms,
with whatever lookback its own rule needs.**

---

## 1 · Airfare Ticket — AED 2,335,000

| # | Proposed rule | Basis |
|---|---|---|
| A1 | Only **CC** maids receive it; MV maids never do | 🟩 + confirmed by you 2026-09-07 |
| A2 | Entitlement arises at **visa renewal**, and the amount is a **flat per-nationality figure**, not tenure- or salary-based | 🟩 |
| A3 | A maid may not receive two airfares **within 5 months**, by any route | 🟩 |
| A4 | 🔴 **A maid who received a company-bought ticket should NOT also receive the cash** | 🟥 — the code performs no such check. ✅ **The rule itself is now code-verified (session 46385)**: `AddScheduledAnnualVacationService`, fired at the `GetFormFromGDRFAStep` (Upload the e-Residency) renewal step — CC only (`!isMaidVisa()`), no airfare within 5 months, and >= 16 months since the last ticket. The ticket-vs-cash question remains open |
| A5 | 🔴 The **manual expense route** should apply the same 5-month guard as the automatic one | 🟥 — it does not today. ⚠️ **The AED 49,500 attached to this row is RETRACTED (2026-09-14)**: it was a zero-amount pairing artefact. The route genuinely skips the guard, but **no duplicate payment resulted** — the four real second payments were separately authorised top-ups and settlements booked under the airfare head. Still worth confirming as a control question, no longer as a loss |
| A6 | **Freedom Operator** and **Walk-in** months count as CC months for the tenure clock | 🟥 |
| A7 | 🔴 **Is the tenure rule 22 months or 2 years?** | 🟥 — the note narratives use **both, interchangeably, in the same week**: "postponed till she completes 22 months" and "postponed till she completes 2 years". The whole airfare eligibility test depends on which |
| A8 | 🔴 **Is "renewal bonus upon the switch to MV" the SAME entitlement as the airfare ticket?** | 🟥 — at least 18 notes / ~AED 32,500 are booked under the `Airfare Ticket` head but read "Approved renewal bonus upon the switch to MV". If it is a different payment, every airfare rule tested against those rows is testing the wrong thing |

---

## 2 · Anti-attrition Incentive — AED 1,829,735

| # | Proposed rule | Basis |
|---|---|---|
| B1 | Only maids with an **active enrolment record** are paid | 🟩 |
| B2 | Only **CC** maids; MV never | 🟩 |
| B3 | 🔴 **Eligibility must still hold on the day of payment, not only on the day of selection** | 🟥 — **the single most valuable line on this page.** The job checks at selection and pays two hops later. If eligibility must hold at payment, AED 13,257 went to maids who had absconded and AED 3,050 to already-ineligible maids. If checking at selection is intended, both stop being findings. ⚠️ **2026-09-15: the 13,257 is not one number.** Prorated against days actually eligible, **AED 10,210 was earned before she left** and only **AED 1,613 is for days after** — so B3 has a THIRD answer ("she keeps the prorated part") that neither yes nor no covers, and it is the likely one. Two further holes surfaced that B3 as written does not ask about: maids **enrolled while already absent**, and **no re-check between cycles** (full unprorated months paid to maids gone 37-98 days). ✅ **B3 IS NOW FULLY CLOSED (2026-09-15).** (i) proration is correct and not to be questioned; (ii) `rejectedStatuses` deliberately omits every `NO_SHOW*` value, so paying them is config, not a defect — and the requestor has **closed** that policy question rather than raise it, because the payment-date re-measure showed 63 of those notes went to maids **back at work when payroll ran**. What survives is **AED 1,613**, confirmed by two independent methods. See `queries/anti-attrition-abscondment-cases.sql` and `queries/absconded-payment-date.sql` |
| B4 | A maid receives **at most one** incentive per contract per month | 🟩 — the code guards per *contract*, not per maid |
| B5 | The enrolled amount must be one of **100 / 150 / 200 / 250 / 300 / 350** | 🟩 — but 795 notes imply enrolments of **400 and 500**. Are those valid, newer values? |

---

## 3 · Bonus — AED 849,316

| # | Proposed rule | Basis |
|---|---|---|
| C1 | There are exactly **three** kinds: referral, signing/joining, and retracting-resignation | 🟩 — ⚠️ **corrected 2026-09-15: referral and signing are two HALVES OF ONE SCHEME**, not separate kinds. The narratives are "X was referred by Y" (the referrer's bonus) and "Signing bonus for being referred by Y" (the referred maid's), written by two code paths (`HousemaidReferralService` and `PayrollManagerNoteController.syncSigningBonus`) |
| C2 | Referral pays **AED 1,000 per referral event** — 1,000/0 for CC, 500/500 for MV — when the referred maid completes **30 days with the client** | 🟩 + you, 2026-09-07 |
| C3 | A referral bonus requires a **referral record for that maid, dated before the payment** | 🟨 |
| C4 | 🔴 **The retracting-resignation bonus should no longer be paid at all** | 🟥 — it is `@Deprecated`, the job filters it out, the UI hides it, and its config head is **Disabled**. Yet **10 notes / AED 7,126** were paid in twelve months. Is this a live exception or a defect? |
| C5 | 🔴 **What is the full list of reasons a bonus request is rejected?** | 🟥 — worth more than any single price. Our target is bonuses that met a rejection condition and were paid anyway |
| C6 | What is the **signing bonus amount**, and who qualifies? | 🟥 — the data clusters at ~500 |

---

## 4 · MV Prorated Salary — AED 788,068

> 🔴 **REWRITTEN 2026-09-15 — the four rules below were drafted against the wrong premise.**
> This is **not** proration. Code (session 46385) and all 782 narratives agree it is the
> **last MV salary on a CANCELLED PRE-COLLECTED contract** — "Last MV Salary for a Cancelled
> Pre-collected Contract from <start> until <end>". It is raised by an **agent** as a
> `LAST_MV_SALARY_FOR_A_PRE_COLLECTED_CONTRACT` MaidService, then picked up by
> `LastMvSalaryMaidServiceJob`. D1-D4 need restating in those terms before they can be confirmed.

| # | Proposed rule | Basis |
|---|---|---|
| D1 | It is the **final settlement** of a part-month when an MV contract ends | 🟨 |
| D2 | **One settlement per contract end** — a second for the same exit is an error | 🟨 |
| D3 | The daily rate is **monthly salary ÷ 30** (rather than ÷ working days, or a fixed figure) | 🟥 |
| D4 | Being `NO_SHOW` / `PENDING_FOR_TERMINATION` when paid is **correct**, not an error | 🟨 — confirm, because AED 393,000 sits in those statuses and it currently reads as the type working properly |

---

## 5 · Salary Dispute — AED 385,985

| # | Proposed rule | Basis |
|---|---|---|
| E1 | It corrects a **payroll error or a pay disagreement** | 🟨 |
| E2 | Every one requires an **approved expense request** | 🟦 |
| E3 | 🔴 **Is any evidence required** — a complaint, a ticket, a recomputation — or is manager judgement sufficient? | 🟥 — we tested complaints as a proxy and it scored **1.08× chance**, i.e. no signal. If nothing is required, we should stop looking |
| E4 | Is there a **maximum** a single dispute may settle? | 🟦 — config shows a CEO limit of 9,671 |

---

## 6 · Raffle Prize — AED 180,000

| # | Proposed rule | Basis |
|---|---|---|
| F1 | **48 winners a month**: 3 × AED 2,000 and 45 × AED 200 | 🟩 |
| F2 | Odds are **weighted by ticket points**, which accrue with tenure — so long-serving maids are meant to win more often | 🟩 |
| F3 | 🔴 **A maid who has left the company should not win** | 🟥 — the pool is snapshotted when the draw is created, so a maid who goes inactive between snapshot and draw can still win |
| F4 | A previous winner **may** win again in a later month | 🟩 — confirm this is intended, since it drives the repeat rate |

---

## 7 · Prorated salary — AED 98,836

| # | Proposed rule | Basis |
|---|---|---|
| G1 | It pays the **part-month** between a salary effective date and the payroll cycle | 🟨 |
| G2 | 🔴 The **eligibility window**: the salary start date must fall **inside the month being paid** | 🟨 — 25 notes fail this today; we need the real window before calling them |
| G3 | The daily rate basis — **÷ 30, ÷ working days, or a fixed figure?** | 🟥 |

---

## 8 · Taxi Reimbursement — AED 84,163

| # | Proposed rule | Basis |
|---|---|---|
| H1 | **Live-out Transportation Assistance** (85% of the money) is for **live-out maids only** | 🟨 |
| H2 | Is there a **monthly cap** per maid on the live-out allowance? | 🟥 |
| H3 | 🔴 **Which expense categories are legitimate behind a taxi reimbursement?** | 🟥 |
| H4 | 🔴 **Should a taxi reimbursement require an invoice?** | 🟦 — two heads require one and **carry zero notes**; the two that require none carry all AED 84,163 |

---

## 9 · Forgive Deduction — AED 53,288

| # | Proposed rule | Basis |
|---|---|---|
| I1 | One note reverses **one day** of a deduction already taken | 🟨 |
| I2 | The value is **one day at the accommodation rate**, which differs live-in vs live-out | 🟨 |
| I3 | 🔴 Is there a **maximum number of days** forgivable in one month? | 🟥 — 3 maid-months had **15–21 days** forgiven, i.e. two thirds of a month written back |
| I4 | **Who** may forgive a deduction, and on what grounds? | 🟥 |

---

## 10 · Accommodation Relocation — AED 51,600

| # | Proposed rule | Basis |
|---|---|---|
| J1 | **CC live-out maids only** | 🟩 + you, 2026-09-07 |
| J2 | It must be booked as an **addition AND a matching loan**, so the advance is recoverable | 🟩 + you — 65 of 66 do |
| J3 | Is there a **cap**, and how often may one maid relocate? | 🟦 — config CEO limit 1,000 |
| J4 | Being `SURPLUS` (between placements) when paid is **correct** | 🟨 — confirm; it is 83% of the type |

---

## 11 · Maids.at other expenses — AED 51,260

| # | Proposed rule | Basis |
|---|---|---|
| K1 | 🔴 **What is this payment actually for?** | 🟥 — **the largest single unknown in the audit.** It looks like Philippine overseas-employment paperwork (OWWA, OEC) and small cash advances, but that is inferred from complaint pairing, not from any rule |
| K2 | What makes a maid **eligible**? | 🟥 — nothing has ever tested whether any of it was deserved |
| K3 | Is the **AED 200 approval threshold** deliberate? | 🟦 — the average note is **188**, and below 200 there is no approval and no invoice |

---

## 12 · Office Work Addition — AED 29,684

| # | Proposed rule | Basis |
|---|---|---|
| L1 | It pays a maid for **office work done instead of placement** | 🟨 |
| L2 | 🔴 **Must she be assigned to office work on the day she is paid, or is retrospective payment normal?** | 🟥 — decides AED 13,140. Only 15 of 92 notes were assigned when paid; 62 were with a client |
| L3 | How is the amount computed — **days × a rate**? | 🟥 |

---

## 13 · Medical Assistance — AED 21,884

| # | Proposed rule | Basis |
|---|---|---|
| M1 | Two modes: a **loan** recovered from salary, or **paid by the company** | 🟨 — 582 loan vs 355 company-paid |
| M2 | 🔴 **Who decides which mode applies**, and on what basis? | 🟥 |
| M3 | Loan-mode advances must **always book a loan** | 🟨 — they do, 100% |
| M4 | Is there a **cap** per episode? | 🟦 — config CEO limit 440 on the head in use |

---

## Cross-cutting — worth more than any single type

| # | Question | Why |
|---|---|---|
| X1 | 🔴 **Which payment types may each contract type receive?** CC live-in, CC live-out, MV, Freedom Operator, Walk-in | Two rows confirmed so far (airfare CC-only, relocation CC-live-out). Paying against a rule that never applied is one of the four failure types this audit exists to catch, and we cannot detect it without the list |
| X2 | ~~Should deductions be audited?~~ | ⚪ **CLOSED 2026-09-15 — no.** Additions only. Recorded so it is not re-opened by a future reader who notices the gap |
| X3 | ~~Should the audit cover more than twelve months?~~ | ⚪ **CLOSED 2026-09-15 — no fixed window.** The dashboard reads live data in whatever window the user picks. See *Check design* above |

---

## What we no longer need to ask

Recorded so nobody spends time on them: the **allowed expense categories per payment type**, the
**CC/MV contract timeline**, and the **live-in/live-out flag** were all open business asks until
2026-09-09. All three turned out to be readable from the database — `EXPENSES_CONFIGURATION` declares
the first, `HOUSEMAID_TYPE_LOGS` the other two. **Three asks closed by two queries.**
