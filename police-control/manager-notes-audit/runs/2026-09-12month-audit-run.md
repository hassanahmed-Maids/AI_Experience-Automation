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

---

# B1b re-run on the right column — 🔴 42 stand, AED 9,019

`CREATION_DATE` turned out to be on the view already, so the correction cost one query rather than a
data ask.

| | ACTION_DATE (as run) | CREATION_DATE (correct) |
|---|---:|---:|
| B1b notes | 53 | **42** |
| AED | 11,419 | **9,019** |

**The 42 are a strict subset of the 53.** Using the right column cleared 11 and created none. B1b is
RED again — and now the semantic doubt is closed instead of open, which is why 42 is a stronger
finding than 53 was. Separately, **B1 — no enrolment row at all — is 11 notes.**

## The artefact theory is dead on independent evidence

Of **3,757** incentive enrolment rows, **3,632 (96.7%) have `ACTION_DATE = CREATION_DATE`**. 121 are
back-dated (median 18 days, max 102); 4 run ahead of creation (median 91, max 204). The field is
editable in principle and almost never edited. The 42 were never going to be explained by date edits.

## 🔴 A correction to what I said one message earlier

I claimed `USER_WHO_LAST_MODIFIED` would make an edited enrolment row identifiable. **It does not.**
It is populated on **100% of rows in every bucket** — all 3,632 same-day rows included — so it is
stamped at creation, not only at modification. It carries no information about editing, and no
mutation check can be built on it. **Whether the enrolment trail is mutable stays unanswerable from
the warehouse**, which leaves explanation 1 (delete-and-recreate) neither confirmed nor excluded.

Written up as trap 22: *before using a provenance column as evidence, check its fill rate on rows you
know were never touched.* This is the second column in one day that looked like an audit trail and
was not.

## What is still open on the 42

- **F2** — did they come through the batch or the manual `AAI - 01` route? The batch stamps one
  configured service account on every note, so a different `REQUESTED_BY` is the discriminator.
  `REQUESTED_BY` / `APPROVED_BY` are on the notes view; `USER_WHO_CREATED_NOTE` is not (it is on the
  action-logs view — my first F2 referenced the wrong table).
- **F5** — the gap profile and the repeat-maid concentration, recomputed on `CREATION_DATE`. The
  "12 maids, 44 notes, median 49 days" figures in this file were measured on `ACTION_DATE` and are
  **superseded pending F5**.
- **F3** — blocked. `HousemaidExtraFields` is not in the warehouse, so the Abu Dhabi route can be
  neither confirmed nor excluded. A named ingestion ask, like the raffle tables.

---

# F2/F5 — the batch made 32 of the 42 itself, and 16% of this type is not the batch

## 🔴 The 42, attributed

| | notes | AED |
|---|---:|---:|
| From the batch's own requester | **32** | — |
| From one of 28 other requesters | 10 | — |
| Unattributed | 0 | — |
| **Total** | **42** | **9,019** |

The manual `AAI - 01` route is real but marginal here: 23.8% of the 42 versus a 16.0% base rate, about
1.5×. **It does not explain the finding. The unattended job produced 32 payments with no enrolment
record on file at the time.**

## 🔴 The bigger thing F2 found by accident

**1,468 of 9,167 anti-attrition notes — 16% — did not come from the batch account.** 28 distinct other
requesters, 2 notes with no requester at all. N13 describes this payment type as an unattended monthly
job stamping one configured service account. **One note in six is something else**, and nothing in the
audit was looking at that. F6 and F7 characterise it: whether a second expense code is visible (the
only surviving angle on the Abu Dhabi question after F3 blocked), and whether the 28 are one-offs or
standing alternate routes.

## The 42 profiled on the right column

**42 notes · 18 maids · AED 9,019 · median gap 41 days · max 157 · 2 within three days · 28 at thirty
or more · 8 beyond ninety · 10 maids paid more than once.**

This supersedes the ACTION_DATE profile in this file (53 notes, 21 maids, median 49, max 176). The
shape survives the correction intact: still not a lag, still concentrated in repeat maids.

## 🔴 What the 32 narrow the question to

Code answer 46015 said the eligibility `EXISTS` is evaluated once at selection, with the note written
two async hops later. That explains paying a maid whose enrolment was removed *after* selection — and
**a removal followed by a later re-enrolment is exactly what `MIN(CREATION_DATE) > note_day` looks
like.** So the 32 are one of:

- **(a) the enrolment row was deleted and recreated** → the trail is mutable, and no point-in-time
  check on it can be trusted;
- **(b) the job paid with no row that ever existed** → the guard is bypassable.

**Neither is excludable from the warehouse.** Deleted rows are gone, and `USER_WHO_LAST_MODIFIED` is
always populated so it cannot mark an edit. This is the next ask-the-code question, and it is now a
much sharper one than the one I asked this morning: not *"what is `ACTION_DATE`"* but *"can a
`Maid_Incentive_Experiment` row be deleted, and does anything record that it was"*.

---

# 🔴 F7 — this payment type has at least three producers, not one

F6 was built on a wrong premise and returned nothing: `EXPENSE_ID` is the **per-request id**, one per
note (9,166 distinct values across 9,167 notes, 9,165 used once), not an expense category. The dev
spec's trap table asserted the opposite; that row is corrected. The run did confirm the type total
independently — **AED 1,829,743** over twelve months.

F7 answers the producer question directly. **The 1,468 non-batch notes are not 28 people making
one-offs. They are two batch-shaped streams plus a small tail.**

| Requester | Notes | AED | Months active | Window |
|---|---:|---:|---:|---|
| **#1** | **931** | **210,302** | 4 | 2026-06-27 → 2026-09-04 |
| **#2** | **409** | **65,862** | 1 | **2025-09-30 only** |
| 26 others | 128 | 31,295 | — | spread |
| **Total non-batch** | **1,468** | **307,459** | | |

**AED 307,459 — 16.8% of this payment type's money — did not come from the job the spec says produces
it.** And 90% of that sits in two requesters.

- **#2 paid 409 notes on a single day, 2025-09-30 — a month-end.** That is batch behaviour under a
  requester that is not the batch's. Either the configured `requesterId` differed that month, or the
  run was repeated by hand.
- **#1 appeared on 2026-06-27 and has run since — 931 notes, AED 210,302 in about ten weeks.** A
  second standing stream started ten weeks ago and nothing in the audit was watching for it.

## What #1 is not

The obvious guess is the Abu Dhabi job, which needs no enrolment log. **The data argues against it:**
only **11** of 9,167 notes belong to a maid with no `Maid_Incentive_Experiment` row at all, so
virtually every non-batch note is paid to an *enrolled* maid. A producer that never consults the
enrolment table would not land almost exclusively on enrolled maids. #1 is more likely a second route
paying the same population — which raises the question the duplicate rule already gestured at.

## 🔴 The link to the 516 duplicate candidates

This run reported 516 anti-attrition duplicate candidates and could not explain them. **A maid paid
once by the batch and once by #1 in the same month is exactly that shape.** F8 tests it directly:
maid-months carrying notes from both. If it lands, the duplicate finding and the second-producer
finding are one finding, and it is a double-payment finding.

---

# 🔴 RETRACTION — "three producers" was wrong. It is one job with an unstable requester

F9 settles it in one row: **918 of producer #1's 931 notes fell on 2026-09-01**, AED 206,831.
**2026-09-01 with 918 notes is already recorded in this file as August's batch day.** #2's 409 notes
all fell on 2025-09-30, the September 2025 month-end. Both "producers" are the monthly job.

**Withdrawn:** *"AED 307,459 — 16.8% of the type — did not come from the job the spec describes."*
It did. The job's stamped requester is simply not the same across runs.

## What is true instead, and it is not nothing

🔴 **`REQUESTED_BY` does not identify the batch.** The configured requester changed at least twice in
twelve months — the Sept 2025 run and the Aug 2026 run each carry a different account from the modal
one. N13 records `requesterId = 2226` from `MAID_INCENTIVE_CONFIGS_PARAM` as *the* stamp on every
note; across a year it is three accounts.

**Consequences, in order of cost:**

1. **F2 is void as a batch-vs-manual test.** Its "32 from the batch, 10 from elsewhere" split was
   measuring which *run* a note came from, not which *route*. **The manual `AAI - 01` explanation for
   the 42 now has no evidence behind it at all** — and that makes B1b stronger, not weaker: the most
   likely reading is that **all 42 are the job's own work**.
2. **Any check keyed on "the service account" is unsound**, including the self-approval and
   nobody-recorded verdicts that used requester identity in earlier runs.
3. **The batch day crosses the month boundary**, which corrupts every monthly window. August's run on
   2026-09-01 and September's run both fall in calendar September.

## 🔴 Which explains the 81, and probably the 516

F8: 8,895 maid-months · **81 with notes from two requesters** (AED 42,196) · **161 where the batch
paid twice** · 20 where a non-modal requester paid twice · **255 maid-months carrying more than one
note**.

The 81 are almost certainly the boundary artefact, not double payments: August's batch (2026-09-01,
requester #1) and September's batch land in the same calendar month under different requesters, so a
month-grained duplicate rule reports them as a pair. **255 maid-months with multiple notes reconciles
with the 516 notes reported earlier at roughly two notes each** — the discrepancy flagged in this file
was grain, as suspected.

**The monthly duplicate window is the wrong instrument.** F10 replaces it with the batch cycle: a gap
histogram between consecutive payments to the same maid. The true cycle is 28–32 days; anything much
shorter is a real duplicate and anything at ~1 day is the same run counted twice.

---

# F10 — the duplicate rule, rebuilt on the batch cycle

| Gap since this maid's previous payment | Notes | Maids | AED |
|---|---:|---:|---:|
| **28–34 days — the normal cycle** | **6,245** | 1,615 | **1,393,732** |
| First payment to this maid | 2,394 | 2,394 | 351,715 |
| 35+ days — a gap in payments | 207 | 192 | 36,996 |
| 🔴 **Same day — one run counted twice** | **176** | 157 | **14,906** |
| ⚠️ 21–27 days — short cycle | 62 | 61 | 14,812 |
| 🔴 8–20 days — duplicate | 46 | 36 | 9,792 |
| 🔴 1–7 days — duplicate | 37 | 33 | 7,783 |

**76% of the money sits in a clean 28–34 day rhythm.** That is the cycle asserted from the batch days
and now confirmed from the payment intervals — the window is right, and the calendar month never was.

**Duplicate candidates: 259 notes, AED 32,481** (plus 62 amber at 21–27 days), against **516** from the
month-grained rule. **Roughly half the old count was the month-boundary artefact**, exactly as F8
predicted. The 516 figure in this report is superseded.

## 🔴 The 176 same-day repeats are the sharp end, and are not yet a verdict

A maid paid twice on the same batch day looks like the cleanest duplicate available. It is not, quite:
**the job's guard is per contract**, so a maid who changed contracts mid-month legitimately receives
two *prorated* notes on one day — and the notes view carries no `CONTRACT_ID`, which is why this run
originally called the population indistinguishable.

**Proration is decidable from the amounts, without `CONTRACT_ID`.** A genuine two-contract split sums
to **one** entitlement, because the two fragments cover one month between them. Two *full* entitlements
on the same day cannot be a split. F11 asks exactly that of all 176.

- Sums to one allowed value → **the two-contract case. Legitimate, and it clears.**
- Every note a full allowed value → **a double payment**, with no proration story available.
- Neither shape → both prorated but not complementary; a review case.

This is the check that turns "indistinguishable without a column we do not have" into a verdict using
the column we do.

---

# F11 — the same-day repeats do not contain a single double payment

| Notes on the day | Groups | AED | Sums to one entitlement | **Every note a full one** | Neither |
|---:|---:|---:|---:|---:|---:|
| 2 | 163 | 28,854 | 10 | **0** | 153 |
| 3 | 5 | 1,006 | 0 | **0** | 5 |
| 4 | 1 | 200 | 1 | **0** | 0 |

**In twelve months, not one maid received two full entitlements on the same day.** The shape that
would prove a double payment — two whole monthly amounts, no proration story available — has **zero**
instances. That is a real clearing result on a population this report had called indistinguishable.

*(Reconciling with F10's 176: the gap histogram counts only the second and later note of each group.
345 notes − 169 groups = 176. The two agree.)*

## ⚠️ My own bucket label was wrong, and it was the biggest bucket

I designed F11 with three outcomes and called the third — sums to no allowed value — a **review case**.
**It is not.** Proration pays `daysBetween ÷ daysInMonth`, so a maid with a **gap between contracts**,
unassigned for part of the month, legitimately receives fragments summing to **less** than her
entitlement. 153 of 163 landing in that bucket is the ordinary shape of proration with gaps, not 153
findings. Had I read the bucket by its label I would have reported an AED 28,854 review population
that is mostly routine.

**The test could not separate what it claimed to**, because it asked the wrong question. Proration can
only ever sum to *at most* the entitlement, so the question is not *does it sum to an allowed value*
but **does it sum to more than this maid's own entitlement**.

F12 asks that. `INCENTIVE_AMOUNT` is still not exposed — B4/B5's blocked column — so the entitlement is
proxied by the largest whole-entitlement amount the maid was paid in any single note across the year.
Anything over it is an overpayment; anything at or under it is proration behaving correctly.

---

# F12 — the same-day duplicate population is AED 838, and 52 groups cannot be judged at all

| Verdict | Maid-days | AED | Excess |
|---|---:|---:|---:|
| Under entitlement — proration with a gap | 99 | 18,339 | 0 |
| Entitlement unknown — never paid a whole month | 52 | 7,083 | — |
| 🔴 **Over entitlement — overpaid** | **17** | 4,338 | **838** |
| Exactly the entitlement — a clean split | 1 | 300 | 0 |

**The anti-attrition duplicate finding has collapsed under every correction applied to it:**
516 candidates on the calendar month → 259 on the batch cycle → **AED 838 of actual excess** in the
same-day core. It is not a material finding, and saying so is the result.

## Three caveats that belong with the 838

1. 🔴 **17 is a floor, not a ceiling.** The entitlement proxy is the *largest* whole-entitlement note
   the maid received all year, so the test only fires above her best-ever amount. A maid whose
   entitlement was raised mid-year can exceed her then-current entitlement and still pass. The true
   figure is higher; how much higher is unknowable without `INCENTIVE_AMOUNT`.
2. 🔴 **52 groups, AED 7,083, cannot be adjudicated at all** — those maids were never paid a whole
   month, so no proxy exists. **This is the concrete price of `INCENTIVE_AMOUNT` not being exposed**,
   and it is now a number rather than an argument: the cheapest ask in the filing pack buys back 52
   unjudgeable cases and removes the floor caveat above.
3. **AED 838 across 17 groups averages AED 49** — too small for a duplicated monthly payment and the
   wrong shape for one.

## The 838 is probably the code's own arithmetic

`MaidIncentiveExperimentJob` prorates with `daysBetween(startDate, endDate) + 1` over
`daysBetween(firstDayOfMonth, currentDate) + 1`. **Inclusive counting on both segments pays the
changeover day twice** when one contract ends and the next begins on the same date. That produces
exactly this signature: a small excess, on maids with two same-day notes, in whole days of
entitlement.

F13 tests it by expressing each excess in days of entitlement. **Clustering at 1, 2, 3 is the
arithmetic — a code defect worth one line to fix, affecting every prorated payment, not a control
failure. Scattered fractions mean something else and the 17 stay open.**

## Where anti-attrition ends up

**One material finding: 42 notes, AED 9,019, paid before any enrolment record existed** — the job's own
work, with every alternative explanation tested and eliminated. Alongside it the three control
findings from the code, which apply to all 9,167 notes and AED 1.83m rather than to 42.

**The duplicate rule produced no material finding on this payment type, and required five corrections
to establish that.** Both halves of that sentence are the deliverable.

---

# F13 — my arithmetic hypothesis was right for AED 68 and wrong for AED 771

| Excess, in days of entitlement | Maid-days | AED |
|---|---:|---:|
| ≤ 2 days | 6 | **68** |
| 3.5 – 21.3 days | 11 | **771** |

**The changeover-day explanation covers 6 of 17 groups.** The rest run to 21.3 days of extra
entitlement, which no off-by-one produces, and several land on half-days (3.5, 6.5, 9.5, 10.5, 16.5)
rather than whole ones. I proposed the arithmetic reading with a code mechanism behind it; the data
supports it for a third of the cases and rejects it for the rest.

**The likely reading for the 11 is not a defect at all.** The job's guard is **per contract** — it
skips a maid only if a note *for the same contract* already carries `incentiveRequestDate` this month.
A maid on two **concurrent** contracts is therefore paid twice **by design**. Sequential contracts sum
to at most one entitlement (the 99); overlapping ones sum to more (the 11). Without `CONTRACT_ID` on
the notes view this cannot be confirmed.

## ⛔ Stopping the duplicate thread here

**AED 771 across 11 maid-days over twelve months is immaterial, and what remains is a business
question, not a query:** *is a maid on two concurrent contracts entitled to two incentives?* Raised as
**N22** in `BUSINESS-RULES-REQUEST.md`. It is worth answering because the same per-contract guard
governs every prorated payment type — not because of the amount.

Chasing it further with SQL would be spending the audit's credibility on AED 771.

---

# Anti-attrition: final state

**One material finding.** 🔴 **42 notes, AED 9,019 — paid before any enrolment record existed.** Every
competing explanation was tested and eliminated: logging lag (96.7% of enrolment rows are same-day),
wrong column (re-run on `CREATION_DATE`, 11 cleared, 42 stood), manual route (`REQUESTED_BY` identifies
a *run*, not a *route*). What is left is the job's own work.

**Three control findings that apply to all 9,167 notes and AED 1,829,743**, not to 42: enrolment is
checked once at selection and never across the two async hops to payment; the amount is validated only
at write time, with a silent hard-coded fallback when the parameter is missing; and a back-fill utility
sets that amount by string-matching free text.

**No material duplicate finding — after five corrections.** 516 on calendar months → 259 on the batch
cycle → AED 838 of real excess → AED 68 arithmetic, AED 771 a definition question. **Both halves of
that belong in the report: the number, and the fact that four of the five corrections were to my own
work.**

**One ask, now priced.** `INCENTIVE_AMOUNT` on `HOUSEMAID_MANAGERACTIONLOGS`: it unblocks B4/B5,
adjudicates the 52 groups that currently cannot be judged at all (AED 7,083), and removes the floor
caveat from every entitlement test in this payment type. One column.

---

# The MV eligibility question, closed — 11 notes, AED 2,476

D3 read the current housemaid type and reported **941 notes / AED 172,967** against a code-verified
CC-only rule. The as-of-payment join cut it to **22 / AED 5,526**. Reading all 22 individually closes
it at **about half that again**.

⚠️ **My classification query had its `CASE` arms in the wrong order** — it tested the recording date
before the effective date, so a note whose maid became MV **13 days** before payment was labelled a
2-day boundary case. Reclassified by effective date first:

| Reading | Notes | AED |
|---|---:|---:|
| 🔴 **MV well before payment — a real contradiction** | **11** | **2,476** |
| ⚠️ Switched within 2 days of the run — selection lag | 11 | 3,050 |

## 🔴 The second half is the code finding, visible in data

Three of the eleven lag cases are notes dated **2026-09-01** — August's batch day — for maids whose MV
switch took effect **2026-08-31**, the day before. Eight more were recorded MV on the payment day
itself or within two days of it.

**That is conversation 46017's finding, in the data.** The eligibility `EXISTS` is evaluated **once, at
selection**, and the note is written two async hops later. A maid who was CC when the job read its page
and MV by the time the note landed is paid anyway. **The code said it was possible; these eleven notes
are it happening**, roughly once a month, at AED 3,050 a year.

**It is not a separate finding — it is corroboration**, and it belongs in the same recommendation:
re-check eligibility at payment, not only at selection.

## Anti-attrition, final

| Finding | Notes | AED |
|---|---:|---:|
| Paid before any enrolment record existed (B1b) | 42 | 9,019 |
| Paid while MV, against a CC-only rule | 11 | 2,476 |
| Selection-lag payments (corroborating the code) | 11 | 3,050 |
| **Total, against AED 1,829,736 examined** | **64** | **14,545 — 0.8%** |

Plus the three control findings that apply to all 9,167 notes: enrolment checked once at selection,
amount validated only at write time with a silent fallback, and a back-fill that sets the amount from
free text.

**On the evidence this is a well-behaved payment type**, and saying so took eleven queries, two
ask-the-code conversations and five retractions. The retractions are the reason the 0.8% can be stated
without hedging.
