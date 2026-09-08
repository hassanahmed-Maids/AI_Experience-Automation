# Audit run — 12 months to 2026-09-08

**17,480 notes · AED 7,167,961 · logic only · adjudicated by the AI Agent**

A backlog sweep, not a monthly audit. Duplicate detection still groups **per month** — grouping by
(maid, type) across a year would have flagged nearly all 9,167 anti-attrition notes, since that
payment recurs monthly by design.

| Class | Notes | % | AED | % |
|---|---:|---:|---:|---:|
| No runnable rule failed | 14,245 | 81.5% | 6,406,221 | **89.4%** |
| BLOCKED — duplicate rule needs an entitlement window | 1,647 | 9.4% | 152,161 | 2.1% |
| Duplicate candidate (same month) | 790 | 4.5% | 200,134 | 2.8% |
| Zero amount | 500 | 2.9% | 0 | 0% |
| BLOCKED — dated beyond the audit period | 228 | 1.3% | 392,000 | 5.5% |
| **RED — enrolled after payment** | **53** | 0.3% | **11,419** | 0.2% |
| **RED — no enrolment record** | **9** | 0.1% | **2,126** | 0.0% |
| **RED — no payment type recorded** | **8** | 0.0% | **3,900** | 0.1% |

---

## 🔴 The new check finds six times more than the old one

**B1b — an enrolment dated *after* the payment it justifies — returns 53 notes, AED 11,419.**
**B1 — no enrolment record at all — returns 9.**

v2 had B1 and not B1b. It tested that a justifying record existed *ever*, and by that test all 53 of
these pass. **The check that did not exist finds 5.9× more than the check that did**, and it needed
one predicate: `enrolled_on <= note_day`.

August surfaced exactly one of these (note 184233). Twelve months surfaces 53. **This is the
strongest argument in the file for running the audit over a year before trusting a month.**

B1's 9 notes in 9,167 (0.1%) confirm the earlier reading: the enrolment record almost always exists.
Its value is the hard RED when it fires, never the 99.9% it clears.

---

## 🔴 500 zero-amount notes, across 14 payment types

Not an airfare quirk. **MOHRE requirement additions is 44% zero — 36 of 82.** `Maids.at other
expenses` is 20%. Salary Dispute 9.6%, Airfare 7.4%, Bonus 5.8%.

MOHRE was never examined before this run; it entered the population only when the type census
replaced the assumed list. **A payment type where nearly half the notes are worth nothing has either
a broken process or a note that means something other than a payment** — and note 185724 already
showed the second is possible, carrying a real AED 1,419 marked *"paid manually"*.

At AED 0 they cost nothing and distort everything: they inflate note counts, deflate average amounts,
and sit inside the denominator of every rate in this report.

---

## ⚠️ A discrepancy in our own numbers, stated rather than smoothed

This run returns **516 anti-attrition duplicate candidates**. `anti-attrition-cases.sql` reports
**167** such cases over the same period.

The likely explanation is grain: **516 is notes, 167 is groups** — at roughly three notes per group
the two reconcile. But *likely* is not *checked*, and two figures for one thing in one audit is
exactly what a reader will notice first. **Reconcile before either number is published.**

Either way it is a review list, not a verdict: without `CONTRACT_ID` a genuine two-contract month is
indistinguishable from a double payment.

---

## The future-dated population, correctly ring-fenced

**228 notes, AED 392,000 — 225 of them airfare.** Dated beyond today, so they cannot be matched to a
payslip that has not happened. They are **BLOCKED, not dropped**: an earlier draft of this audit would
have rejected them as a feed defect and deleted 5.5% of the money, most of it in the largest type by
value. The forward-decay curve says these are real bookings carrying travel dates.

---

## 🔴 What the run does not claim

**89.4% of the money — AED 6.4m — passed every rule that can currently run, which is not a pass.**
T4, T5, T7 and most group rules are blocked on the expense grant and the reference lists. Over twelve
months the audit examined **roughly a tenth of the money**, the same proportion as in August.

The year did what a month could not: it gave the anti-attrition checks a population large enough to
prove themselves, turned zero-amount notes from an August anomaly into a 14-type pattern, and put 53
hard REDs on the board where August had one.

---

# B1b adjudicated — the 53 cases

**AED 11,418.75 · 21 maids · median gap 49 days · maximum 176**

## The semantic doubt is dead

I flagged that `ACTION_DATE` is undocumented, so these could be a logging lag rather than real
findings. **They are not.** Only **2 of 53** sit within three days, and only 4 within seven. **36 are
30 days or more apart, and 12 are over 90.** A 176-day lag is not a lag.

## 🔴 It is not 53 boundary cases. It is 12 maids paid repeatedly with no enrolment on file

**44 of the 53 notes belong to maids who appear more than once**, AED 8,454.

| Maid | Consecutive payments before any enrolment record | AED |
|---|---:|---:|
| **69002** | **6** — Dec, Jan, Feb, Mar, Apr, May; enrolled **2026-06-25** | 1,200.00 |
| **22034** | **6** — Oct through Feb; enrolled **2026-03-13** | 1,118.29 |
| 49801 | 4 | 1,000.00 |
| 91643 | 4 | 800.00 |
| 39835 | 4 | 800.00 |
| 65360 | 4 | 600.00 |
| 87024 · 45052 · 117394 · 37739 | 3 each | 2,151.56 |
| 48871 · 86806 | 2 each | 784.42 |

Maid 69002 was paid **every month from December to May** and her first enrolment record appears on
**25 June**. This is a standing state, not a boundary artefact.

## 🔴 The payment dates are month-end — the job did this

Almost every `paid_on` is a batch date: 30 Sep, 31 Oct, 30 Nov, 31 Dec, 31 Jan, 28 Feb, 31 Mar,
30 Apr, 31 May. **These were not hand-added. `MaidIncentiveExperimentJob` paid them on its normal
monthly run.**

**That contradicts the code.** *(N13, code-verified)* the job requires a `MaidManagerActionLog` with
`actionType = Maid_Incentive_Experiment` and `incentiveAmount NOT NULL` before it pays. The data says
it paid 53 times without one on file. Three possible explanations, and they are an Ask-the-Code
question, not a data question:

1. The enrolment log is **deleted and recreated**, so `MIN(ACTION_DATE)` sees only the newest row.
2. `ACTION_DATE` is a **modification** date, not creation — the row exists earlier and gets stamped later.
3. There is **another route** into payment that the interrogation did not surface.

## 🔴 Every reading is a finding, which is why this is actionable now

- If the log is accurate → **AED 11,419 was paid across 12 maids with no justification on file**, by an
  unattended job, for up to six months each.
- If the log is written late → **the justification for this payment type is retrofitted after the
  money moves**, and the enrolment record cannot evidence anything. That is worse for the control than
  the first reading, not better.
- If the log is deleted and recreated → **the audit trail for AED 1.83m a year is mutable**, and no
  point-in-time check on it can be trusted.

**The check does not need the ambiguity resolved to be worth acting on.** It needs someone to say
which of the three is true, and each answer names a different fix.

## What this says about the audit

B1b is one predicate — `enrolled_on <= note_day` — added to a check that already existed. v2 tested
that a justifying record existed *ever*; all 53 of these pass that test. **The predicate found
AED 11,419, a code-versus-data contradiction, and a mutable-audit-trail question that nobody had
asked.** August showed one of these. The year showed the shape.

---

# B1b answered by the code — session 46015, 2026-09-08

I asked the three explanations as one question (`asks/askcode-B1b-actionlog-mutability.md`; answer in
`evidence-antiattrition-actionlog-conv46015.md`). **Two of the three are confirmed, and the check I ran
was measured against the wrong column.**

## 🔴 The column B1b rests on is not a timestamp

`MaidManagerActionLog.actionDate` — the warehouse's `ACTION_DATE` — is stamped `new LocalDate().toDate()`
**only on create**. `updateEntity` never re-stamps it and only rejects null, so **after any edit it is
whatever the caller sent**. It is user-editable business data. The entity has no `@PreUpdate`, no
`@LastModifiedDate`, no soft-delete flag. The real timestamps sit on the shared `BaseEntity`, and
**`creationDate` is the field the code itself orders enrolments by**. The selection query never reads
`ACTION_DATE` at all.

So B1b's 53 are **not a payment finding yet**. They are a finding about the column plus a population
that has to be re-tested against `CREATION_DATE` (block **B1b-F**, F1).

## 🔴 Two routes pay under this reason with no enrolment row at all

`AbuDhabiMaidIncentiveExpenseJob` calls the same expense-request helper, selects from
`HousemaidExtraFields`, and needs no action log. **Any manual `AAI - 01` expense request** produces the
identical note with no enrolment check on that path. F2 (creator ≠ service account 2226) and F3 (Abu
Dhabi enrolment present) separate them in data.

## 🔴 Three findings that never needed the 53

1. **Enrolment is checked at selection and never again.** The job POSTs an `ExpenseRequestTodo`; the
   note is written two async hops later (accounting confirmation, then a `SequentialQueue` task) and
   nothing re-reads the enrolment. **A maid whose incentive row is edited or removed after selection is
   still paid.** N13's "the job requires an enrolment log before it pays" is wrong as stated.
2. **The amount is validated at write time only.** Neither the job nor the expense helper re-checks it,
   and if `MAID_INCENTIVE_CONFIGS_PARAM` is missing the validator **silently falls back to a hard-coded
   `[100,150,200,250,300,350]`** — broken config passes as good config.
3. **A back-fill utility sets the amount from prose.** `correctIncentiveHistoricalData` re-derives
   `incentiveAmount` by string-matching amounts inside the enrolment's free-text note, and saves
   without re-validating. That number drives AED 1.83m a year.

## What the exchange cost and returned

One question. It downgraded my loudest finding from RED to AMBER, and returned three control findings
of its own — each of which applies to **every** anti-attrition note, not to 53 of them. **The
downgrade is the point: the check was measuring an editable field and reporting it as an audit trail.**
Written into the spec as N13-corrected and as traps 19–21.
