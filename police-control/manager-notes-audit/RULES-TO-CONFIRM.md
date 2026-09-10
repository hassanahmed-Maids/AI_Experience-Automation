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

## 1 · Airfare Ticket — AED 2,335,000

| # | Proposed rule | Basis |
|---|---|---|
| A1 | Only **CC** maids receive it; MV maids never do | 🟩 + confirmed by you 2026-09-07 |
| A2 | Entitlement arises at **visa renewal**, and the amount is a **flat per-nationality figure**, not tenure- or salary-based | 🟩 |
| A3 | A maid may not receive two airfares **within 5 months**, by any route | 🟩 |
| A4 | 🔴 **A maid who received a company-bought ticket should NOT also receive the cash** | 🟥 — the code performs no such check, and we do not know whether that is intended |
| A5 | 🔴 The **manual expense route** should apply the same 5-month guard as the automatic one | 🟥 — it does not today, and this is our largest single finding at AED 49,500 |
| A6 | **Freedom Operator** and **Walk-in** months count as CC months for the tenure clock | 🟥 |

---

## 2 · Anti-attrition Incentive — AED 1,829,735

| # | Proposed rule | Basis |
|---|---|---|
| B1 | Only maids with an **active enrolment record** are paid | 🟩 |
| B2 | Only **CC** maids; MV never | 🟩 |
| B3 | 🔴 **Eligibility must still hold on the day of payment, not only on the day of selection** | 🟥 — **the single most valuable line on this page.** The job checks at selection and pays two hops later. If eligibility must hold at payment, AED 13,257 went to maids who had absconded and AED 3,050 to already-ineligible maids. If checking at selection is intended, both stop being findings |
| B4 | A maid receives **at most one** incentive per contract per month | 🟩 — the code guards per *contract*, not per maid |
| B5 | The enrolled amount must be one of **100 / 150 / 200 / 250 / 300 / 350** | 🟩 — but 795 notes imply enrolments of **400 and 500**. Are those valid, newer values? |

---

## 3 · Bonus — AED 849,316

| # | Proposed rule | Basis |
|---|---|---|
| C1 | There are exactly **three** kinds: referral, signing/joining, and retracting-resignation | 🟩 |
| C2 | Referral pays **AED 1,000 per referral event** — 1,000/0 for CC, 500/500 for MV — when the referred maid completes **30 days with the client** | 🟩 + you, 2026-09-07 |
| C3 | A referral bonus requires a **referral record for that maid, dated before the payment** | 🟨 |
| C4 | 🔴 **The retracting-resignation bonus should no longer be paid at all** | 🟥 — it is `@Deprecated`, the job filters it out, the UI hides it, and its config head is **Disabled**. Yet **10 notes / AED 7,126** were paid in twelve months. Is this a live exception or a defect? |
| C5 | 🔴 **What is the full list of reasons a bonus request is rejected?** | 🟥 — worth more than any single price. Our target is bonuses that met a rejection condition and were paid anyway |
| C6 | What is the **signing bonus amount**, and who qualifies? | 🟥 — the data clusters at ~500 |

---

## 4 · MV Prorated Salary — AED 788,068

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
| X2 | 🔴 **Should deductions be audited?** | `NOTE_TYPE = 'ADDITION'` appears in 151 query blocks. **Money taken *from* a maid has never been examined by anything** — and it lands on the person least able to contest it |
| X3 | Should the audit cover **more than twelve months**? | 70% of all bonus money ever paid sits outside the current window |

---

## What we no longer need to ask

Recorded so nobody spends time on them: the **allowed expense categories per payment type**, the
**CC/MV contract timeline**, and the **live-in/live-out flag** were all open business asks until
2026-09-09. All three turned out to be readable from the database — `EXPENSES_CONFIGURATION` declares
the first, `HOUSEMAID_TYPE_LOGS` the other two. **Three asks closed by two queries.**
