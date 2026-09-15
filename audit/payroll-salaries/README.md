# Housemaid Payroll and Salaries — handoff package

**Date:** 2026-09-15 · **Prepared for:** Abdullah Mahdi, Police & Control
**Live mockup:** https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp

Six payroll-money audits consolidated onto one page, in the same structure as the Housemaid Visa
Process consolidation (DNA-9829).

## What is in here

| File | What it is | Who it is for |
| --- | --- | --- |
| `SPEC_housemaid_payroll_salaries_v2.md` | **The build document.** Part 0 is the shared frame; Parts 1–6 are the six child specs reproduced in full and unedited, prompts included | The data team. **This is the file to attach to the Jira ticket** |
| `JIRA_DRAFT_payroll_salaries.md` | The Jira request, drafted in DNA-9829's shape. Fields at the top, description body below, ready to paste | Whoever files it. **Not filed yet** |
| `FILING_CHECKLIST.md` | What is ready, the one answer still needed, how to file, and what to expect back | Whoever files it — **read this first** |
| `Housemaid_Payroll_Checks.html` | The mockup as a **standalone** file — full document wrapper, opens from disk, no server needed | Anyone who wants it offline or by email |
| `payroll-controls.html` | The same page as an **artifact fragment** (no doctype/head/body — the artifact host supplies those). This is the file that publishes to the URL above | Only for regenerating the artifact |

The two HTML files are the same content. Edit `payroll-controls.html` and rebuild the standalone
from it; publishing that file to the URL above updates the mockup in place.

## The six checks, in the order money moves through her pay

| # | Check | Measured | Ready? |
| --- | --- | --- | --- |
| 1 | Salary Components (CC) | AED 15,342/mo above the rule · AED 375,856/mo below it | No — O1, O2, O3 blocking |
| 2 | Salary Raises and MV Margin | AED 2,150–5,400/mo CC · AED 500/mo MV margin · AED 202,019/mo above standard | No — O5 blocking, OX14 open |
| 3 | Expense → Loan Charged | AED 137,510.33 never charged · AED 4,694.24 typed but never posted | No — O10 blocking |
| 4 | Loan Repayment | AED 215,390 owed · AED 142,414 collectable (Aug 2026) | No — O15 blocking |
| 5 | With Client, No Contract | AED 3,500 · 2 cases | No — and its own author recommends an alert instead |
| 6 | **Manager Notes** | AED 30,441 across 11 rules · AED 16,626 control findings · **~AED 962,000 with no rule to test it** | 🟢 **Yes — no blocking open item** |

**Check 6 is the sensible first delivery.** It is the only one with nothing blocking it, the largest
by money examined (AED 6,851,419), and it carries eleven rules rather than one.

## Read these three things before planning anything

1. **There is no page total, and the spec refuses to add one.** The money here is five different
   kinds — company loss, money never collected, entitlement owed to staff, pay with nobody billing
   for it, and a control broken on money that was probably correct. Adding them produces a number
   that means nothing.
2. **Grey is not green.** ~AED 962,000 across four payment types is untested because no entitlement
   rule exists, not because it passed. A type with no rule is not a clean type.
3. **Gate state is uneven.** One of six child specs went through the adversarial spec-auditor gate;
   one went part way; four never did. One of those four published two wrong headline numbers before
   anyone caught it. **The merged document has never been gated at all.**

## What the merge produced that no single spec could show

Sixteen **OX** items in §5 exist only because the six checks were put on one page. The ones that
change what a number means:

- **OX1** — four checks depend on whether a maid was paid, and there are **three incompatible
  readings** of what "paid" means. Check 6's sweep across 24 payment types is the only measurement,
  and it found the transfer flag tracks *termination*, not payment.
- **OX2** — the three checks sharing the loan ledger dedupe it three different ways, and the date
  column is identical across duplicate rows, so any date tie-break is random.
- **OX3** — checks 3 and 4 are two halves of one pipeline and the same waiver gap breaks both.
- **OX4** — terminated maids are excluded by three checks and deliberately kept by the fourth.
- **OX5** — check 1's audited MOHRE wage is check 4's wage-floor input, and check 1 says it is wrong
  on 21% of the CC population.
- **OX7** — the family's largest number, **AED 1,063,646/month**, has no check and no owner.
- **OX13** — ✅ *resolved by the merge*: `HOUSEMAID_MANAGER_NOTES.EXPENSE_ID` is the expense-**request**
  id space, which answers the GCC Payment Checker spec's open item O15.
- **OX15** — nothing on this page audits whether a **deduction** was correct. Additions get eleven
  rules; deductions get one direction, and the amount never.

## Open decisions — nobody has answered these

1. **Where does the Sub Dashboard hang?** The ticket assumes the same parent as DNA-9829.
2. **Check 5 — section or alert?** Its author recommends against building it as a dashboard.
3. **Who owns OX7** — the 828 maids paid past their contract end, AED 33.7m to date?
4. **Who holds the scope boundary with DNA-9829?** Check 3 excludes two codes that Change of Status
   and the GCC checker own.
5. **Per-maid money columns** — three child specs hold different positions and none carries the named
   approval company policy asks for. The spec applies the strictest meanwhile.

## Status

**Ready to file, pending one answer** — which dashboard the Sub Dashboard hangs under. See
`FILING_CHECKLIST.md`.

The maid's name is **ruled in** by the spec owner (2026-09-15) and the three child specs that carried
the older rule have been amended at source, each struck through and marked in place. The one item still
open that touches personal data is narrower: whether a per-maid **loan balance** shows as an amount or a
status word. It does not block filing.
