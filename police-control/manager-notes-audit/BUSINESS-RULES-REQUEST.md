# What we need written down — Manager Notes Audit

**To:** Payroll / Police & Control rule owners
**From:** Hassan Ahmed, Police & Control
**Date:** 2026-09-08

We are building an audit that checks every payment a manager adds to a housemaid's payslip — about
**1,300 additions a month, roughly AED 6.3m a year**. For most payment types we can now check the
amount and the entitlement automatically.

For the payments below **we cannot, because the rule has never been written down anywhere** — not in
the ERP, not in the warehouse, not in policy. This is not a data problem and no amount of engineering
will fix it. Each one needs a person to state the rule once; after that the check runs itself every
month, forever.

**Until then the audit reports these as "unverifiable" rather than "fine."** That is the honest
result, but it means real money passes without a check.

---

## Part 1 — Seven payment types that cannot be checked at all

Each of these goes from *unverifiable* to *fully checked* the moment somebody answers.

### 1. Raffle prize — `raffle_prize`

**What we need:** the list of winners for each draw.

**Why we can't work it out:** the ERP runs the draw and writes the payment automatically, but no
record of *who won* has ever been brought into the warehouse. Searching the entire warehouse for
anything raffle-related returns nothing.

**The answer we need:** who owns the draw, and where the winners are recorded — a spreadsheet, a
system, a person's inbox. Any of those is workable.

> *For the data team, in parallel:* one question to the ERP code about what `RafflePerformerJob`
> reads to pick winners would likely name the table directly. Worth asking before the business
> chases a spreadsheet.

**This is the cheapest fix on the page** — the rule is a single line ("is she on the winners list"),
and it is the only test needed.

---

### 2. Google review payment — `recommendation_from_client`

**What we need:** the amount, and the condition.

**Questions:**
- Is it a **fixed amount**? If so, what, and has it ever changed?
- What has to happen for it to be owed — a review posted, a review naming the maid, a review of a
  certain rating?
- Is the review itself recorded anywhere we can check against, or is it taken on trust?

**Why it matters:** without the amount we cannot tell a correct payment from a generous one. Without
the condition we cannot tell a real one from an invented one.

---

### 3. Payment for unused vacation days — `pay_vacation_days`

**What we need:** how a vacation day is valued, and where the balance lives.

**Questions:**
- How is the daily rate calculated — monthly salary ÷ 30, ÷ working days, or a fixed figure?
- Where is a maid's **leave balance** kept, and is it reliable?
- Is there a cap on how many days can be paid out?

**Why it matters:** this is pure arithmetic — balance × rate — and we can check it exactly, the day
somebody tells us the two inputs.

---

### 4–6. The three loan-type advances

**`Sim card Loan` · `WPS Compliance Loan` · `PCR Test & medical assistance Loan`**

**What we need:** who qualifies, and for how much.

**Questions, for each of the three:**
- **Who is eligible** — all maids, CC only, live-out only, first year only?
- **Is there a maximum amount?**
- **What triggers it** — a request from the maid, a manager's decision, an automatic process?
- **Is it always recovered from salary,** and over how many months?

**What we can already check without answers:** that the advance was booked as **both an addition and
a matching loan**, so the company can recover it. We already know that rule is being broken — the
warehouse shows the loan-to-addition ratio running from **0%** (no loan booked at all — money given
away) to **115%** (the maid repaying more than she received).

**What we cannot check:** whether the person should have received it in the first place.

---

### 7. Live-out transport allowance — `Live-out Transportation Assistance`

**What we need:** the rate.

**Questions:**
- Is it a **fixed monthly amount**, or does it vary — by distance, by contract, by area?
- Does every live-out maid get it, or only some?
- Has the amount changed, and if so from when?

**We can already confirm she is live-out.** We cannot confirm the amount is right.

---

## Part 2 — Three reference lists that unlock checks across *many* payment types

These are different from Part 1. They are not about one payment each — each one switches on a test
that applies across the board. **They are the highest-leverage items on this page.**

### A. Which expense categories belong to which payment type

**The question:** when a maid is reimbursed for a taxi, which expense categories are legitimate to
find behind that payment? And for medical assistance, lost luggage, and other maid expenses?

**Why:** a reimbursement backed by the *wrong* category is a real finding — money paid under one
heading and justified under another. Right now we can see whether *an* expense record exists, but not
whether it is the *right kind*.

**The answer we need:** a simple table — payment type on the left, allowed expense categories on the
right.

### B. Which payments each contract type may receive

**The question:** what may a CC maid be paid that an MV maid may not, and vice versa? And what about
Freedom Operator and Walk-in maids?

**Why:** paying someone against a rule that never applied to her is one of the four failure types
this audit exists to catch, and we cannot detect it without this list.

**Two rows are already confirmed** from payroll, so the list is started:

| Payment | Who may receive it |
| --- | --- |
| Airfare ticket | **CC only** |
| Accommodation relocation | **CC live-out only** |

**One open question that belongs with this:** the rest of the company treats **Freedom Operator** and
**Walk-in** maids as CC. Should this audit do the same — in particular, do those months count toward
the 22-month airfare tenure?

### C. Which payment types must always have an expense record behind them

**The question:** for which payments should we expect to find a matching expense request every time?

**Why:** this is what separates *"nothing authorised this"* — a real finding — from *"no record was
expected here"* — not a finding. Without the list we cannot safely call either one, so both come out
as unverifiable.

**Two entries are already settled:** **airfare tickets** and **office-work additions** are booked
straight onto salary with no payment behind them, so they legitimately have no expense record. Absent
that knowledge, the audit would red-flag every single flight-home payment.

---

## Part 2b — Three questions about held salary

We can now check **`previously_held_salary`** — the payment that releases money withheld earlier —
because the payslip records both the withholding and the amount. Three things decide how far that
check can go.

### 1. Can a salary be held in part, or only in full?

On the payslip a hold is **all-or-nothing**: the month was either transferred or it wasn't. But we
also found an explicit **partial** hold at final settlement — a prorated amount split into *paid* and
*kept on hold*.

**The question:** are those the only two ways money gets held, or is there a third? Specifically, can
a single month's salary be **partly** paid and partly withheld outside of final settlement?

**Why it matters:** a rule written for full holds will mis-read every partial one, and vice versa.

### 2. Is the final-settlement sheet still maintained?

The partial-hold figures live in a final-settlement details sheet whose columns look hand-maintained
rather than system-generated.

**The question:** is it current and trustworthy, who keeps it, and is it the system of record for
held prorated salary — or just a working copy?

**Why it matters:** if it is a working copy, the audit must report those cases as unverifiable rather
than checking against it.

### 3. Does `previously_held_salary` ever release something that was never "held"?

Money also comes off a payslip through **deductions**, and a month's additions total can be
**negative** — both reduce what she receives without any hold being recorded.

**The question:** is `previously_held_salary` ever used to reverse a deduction or a negative
adjustment, rather than to release a genuine hold?

**Why it matters:** if yes, some of these payments will look like *"money released that was never
held"* when they are perfectly correct. We would rather know now than raise false findings.

---

## Part 3 — Two things nobody owns, which are bigger than anything above

### The loyalty payment — `anti_attrition_incentive`

**There is no rule for this anywhere in the company.** We checked the ERP source code: the only place
this payment appears is a list telling the system *how* to pay it. Nothing says *who should get it*,
*how much*, or *when*.

On illustrative figures this is the **largest single category of unverifiable money** in the audit.

**This needs a decision, not an answer:** either somebody writes the rule, or the audit reports every
month that a material sum leaves the company against no stated basis. Both are legitimate outcomes.
Silence is not.

### `AR-1`

An addition reason with no descriptive name and no rule anywhere in the system. Money is being paid
under it. **Somebody in payroll knows what it is, and nothing in the system does.**

---

## What happens when these are answered

| | Today | After |
| --- | --- | --- |
| Seven payment types in Part 1 | unverifiable | fully checked, every month |
| The three lists in Part 2 | three tests permanently blocked | those tests run across all payment types |
| Loyalty and AR-1 | unverifiable, and unexplained | at minimum, explained |

None of this needs engineering. Each answer is written once and the check runs itself from then on.

If it is easier to answer some and not others, **the three lists in Part 2 are worth the most**, and
**the raffle winners list in Part 1 is the quickest win.**
