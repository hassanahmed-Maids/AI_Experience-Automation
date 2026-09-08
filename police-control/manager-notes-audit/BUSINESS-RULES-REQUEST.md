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

## Part 1 — Payment types that cannot be checked at all

*(Two of the seven have since been answered by the ERP code itself — the raffle and the Google review. They are left in place, marked answered, so you can see what came off the list and why. **Five** genuinely remain.)*

Each of these goes from *unverifiable* to *fully checked* the moment somebody answers.

### 1. Raffle prize — `raffle_prize` ✅ **ANSWERED — question withdrawn**

**We were wrong about this, and we want to say so plainly.** An earlier draft of this page told you
there was no raffle system — no draw, no winners record, nothing but a label on a dropdown. That was
a mistake on our side: we had searched only the payroll part of the ERP. The raffle lives in the
housemaid-management part.

**There is a complete, automated prize draw**, and nothing is needed from you:

- A scheduled job runs the draw each month. Each maid's **tickets** are earned (a month with the same
  client, a renewal, a replacement) and **more tickets mean better odds** — the draw is weighted, not
  a flat lottery.
- **Winners are recorded**, each against the draw she won, with the date and the prize.
- **The prize amounts are set centrally, not typed in:** first prize **AED 2,000** (3 winners),
  second prize **AED 200** (45 winners).
- The system **writes the payslip note itself**, with the amount taken from the prize record.

So we can check this payment completely: that she actually won, that the amount matches her prize,
and that it was paid once. The only thing left is a technical one — those records have not been
copied into the reporting warehouse yet, which is a request to the data team, not to you.

**One thing worth your attention, though it is not a question.** A person can still add a raffle
prize by hand, bypassing the draw. The audit will now show us whether that happens — and if it does,
those are exactly the payments worth looking at.

**Please confirm one thing only:** have the AED 2,000 / AED 200 prize amounts ever changed? The
settings are not date-stamped, so if they moved, older payments would look wrong against today's
values.

---

### 2. Google review payment — `recommendation_from_client` ✅ **ANSWERED — no question needed**

We found this in the ERP code, so nothing is needed from you:

- **The amount is set centrally**, not typed in: parameter `GOOGLE_REVIEW_GIFT_VALUE`, **default
  AED 50**, described as *"the gift value we give to maid after the client adds a 5-star Google
  review to her"*.
- **The condition:** a screenshot of the 5-star review is uploaded, the system creates the addition
  automatically, and a payroll auditor approves it. If the auditor rejects it, the note is deleted.
- **The review is recorded** in a `ClientGoogleReview` table, with the screenshot and duplicate-guard
  flags — so we can check both that the review exists and that it was only paid once.

**One small thing needed from the data team, not from you:** `ClientGoogleReview` lives in Client
Management and has not been brought into the warehouse. It is a small ingestion.

**Please still confirm one thing:** has the AED 50 ever changed? The parameter is not date-stamped,
so if it moved, older payments would look wrong against today's value.

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

### 7. Live-out transport allowance — ⚠️ **may not be a real payment type**

We checked the code, and **"Live-out Transportation Assistance" does not exist as a payment reason in
the ERP.** There is no such option, no rate and no rule. The only live-out transportation thing in
the system is a *complaint ticket* raised after a mediator visit, which pays nothing.

It appears as a **category in a reporting view**, which is not the same as a payment type — that
view groups payments under labels of its own.

**The question:** when someone books transport money for a live-out maid, **what do they actually
record it as** — a taxi reimbursement, or something else? And is there a rate at all, or is every
amount decided case by case?

**Why it matters:** if the reporting label doesn't correspond to a real payment type, we have been
counting a category that doesn't exist — and the same doubt now applies to the sim card, WPS
compliance, PCR and NOL card categories in Part 1 items 4–6. **We are checking those before asking
you to define rules for payments that may not be separate payments at all.**

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

### 3b. Held salary — what the code told us, and the one thing it changes

We found the original rule: this payment used to be **generated automatically**, releasing a **whole
month's salary** that had not been transferred **because the maid was on vacation** — and only for
MaidVisa maids. The amount was calculated by the system from the unpaid payslip.

**All of that automation has since been switched off.** Every piece of it is commented out or marked
"not used anymore". **So today this payment is typed in by hand, with the amount typed in too.**

**Please confirm:**
- Is it still meant to be **on-vacation holds only**, or is it now used for any withheld salary?
- Is it still **MaidVisa only**? Nothing enforces that any more.
- Should it go back to being calculated automatically? The calculation still exists in the system —
  a live payroll exceptions report already compares the held amount against the unpaid payslip.

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
| The five open payment types in Part 1 | unverifiable | fully checked, every month |
| The three lists in Part 2 | three tests permanently blocked | those tests run across all payment types |
| Loyalty and AR-1 | unverifiable, and unexplained | at minimum, explained |

None of this needs engineering. Each answer is written once and the check runs itself from then on.

If it is easier to answer some and not others, **the three lists in Part 2 are worth the most** — each one switches on a test across every payment type at once. The quickest single win is
**the vacation daily rate** (Part 1, item 3): two numbers, and a payment goes from unverifiable to
checked exactly.
