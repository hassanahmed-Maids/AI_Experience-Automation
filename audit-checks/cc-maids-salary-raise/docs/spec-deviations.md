# CC Maids Salary Raise — declared deviations, gaps and spec corrections

Spec: **CC Maids Salary Raise v0.6 draft** (Notion, Checks — CC Maid).
Status of this document: written during the build, before any live run.

Every item here changes what the check concludes or what it costs. Nothing in this file is
absorbed quietly — the rule the skill works to is that a declared gap is recoverable and a
quiet one is not.

---

## 1. Deviations from the spec as written

### 1.1 At EXACTLY a ruled cohort level, the maid routes to the verifier instead of clearing
**Rules involved:** gate ⓰ (Order 48), verifier ❷ (Order 90).
**Spec position:** contradictory, and the contradiction is recorded on the spec's own variable row.
`ruled_cohort_level` carries an open item: *"an Ethiopian live-in at exactly 1,500 clears under
this level, yet verifier rule ❷'s June counter-example is a DENIED raise at exactly that amount
and ruling #3 says the 260 are 'not auto-clearable' — confirm the at-exactly-1,500 boundary, or
gate ⓰ must route it instead of clearing."*

**What was built:** the conservative reading. Paid *below* a ruled level clears. Paid *exactly at*
a ruled level routes to the verifier with `route_reason: at_exactly_ruled_cohort_level`. Paid
*above* routes as an ordinary candidate.

**Effect on the numbers:** inflates the routed population by everyone sitting exactly on a ruled
level. On Filipina live-out that is potentially **561 of 798** maids, which is a large routing
load — but they route, they are not flagged, and the alternative is auto-clearing a cohort the
ruling explicitly calls not auto-clearable.
**To close:** Jacky confirms the boundary. If "at exactly the level clears", set
`route_at_exactly_ruled_level: false` in the scorer options and the deviation disappears.

### 1.2 The paying-status set is resolved from payroll rows, not from a status list
**Spec position:** ⛔ open, owner Jacky — *"which of these statuses actually draw a salary is a
business question and is still open."*

**What was built:** no status filter at all. The population takes every non-terminated CC maid,
and **the presence of a payroll row for the audited month defines who actually drew a salary**.
That is the spec's own rule for `payroll_total_salary`: *"No row for the audited month = the maid
was not on that month's payroll. Treat as OUT OF POPULATION for that month, never as a zero salary
and never as clean."*

**Why this is not a workaround:** it reads the fact instead of guessing at the category, and it
is strictly more conservative than any status list — a maid on an unexpected status who *was*
paid is scored rather than silently dropped.
**Effect on the numbers:** none on correctness. It removes the 7,752-vs-5,245 population question
from the critical path. Cases settled this way carry `verdict: out_of_population`, so the count is
visible in every run rather than hidden in a filter.
**Still worth Jacky's ruling** for the variable row the spec asks for, but the build does not wait.

### 1.3 A gap blocks a clean only when resolving it could LOWER the allowance
**Spec position:** not addressed. The spec says unknowns are pending, never clean, which is right
in general and wrong for one shape.

**What was built:** gaps are classified. A gap that could only *raise* her entitlement — an
unreadable renewal count, an unresolvable MV→CC service clock — does not block a clean for a maid
already at or below the allowance composed *without* it, because no answer to the open question
could make her overpaid. Gaps that could *lower* the allowance — a living-status disagreement
(live-in is the lower standard), a disagreement about what she was actually paid — still block.

**Effect on the numbers:** prevents roughly **1,500 MV→CC switchers** being marked pending every
run on a question that provably cannot change their verdict. Every gap is still recorded on the
case (`gaps`, `gaps_blocking`), so nothing is hidden.
**Why it matters:** a review queue nobody can get through is how a real finding gets missed.

---

## 2. Rules implemented with a named limitation

### 2.1 Order 57 ⓫ — MV→CC switchers are pending, never red (interim, as the rule itself states)
The rule's own text says INTERIM until a CC-service clock is readable. Implemented exactly:
a switcher above her base-alone allowance settles `pending` at Order 57 and can never reach the
candidate route on a missing renewal alone. **To close:** a readable "continuous months as CC"
figure. Nothing in the ERP surfaces probed so far exposes one.

### 2.2 Order 50 ❺ — the approved base is applied by the verifier, not deterministically
There is **no numeric field on Complaint at all**; the approved base exists only as a sentence.
`RenewRequest.raiseApproved` is reachable but was **empty on 14 of 14** above-tier candidates, so
it corroborates when present and never clears when absent. The deterministic layer therefore
composes with the salary-rule total (or ruled level) and routes; the verifier discovers approved
bases. This is why all five real cases route deterministically and settle at the verifier.

### 2.3 The standard cannot answer for a past payroll month
`SalaryRule` has **no effective-from/to date** — `isActive` is the only liveness signal the entity
has. So the standard read is always *today's*. For a current-month run this is correct. For a
back-audit it is an approximation, and the run must say so.

---

## 3. Corrections filed back to the spec

| Where | The spec said | What the build found | Action |
|---|---|---|---|
| Call-volume callout | ≈23,300 calls, 47× over the 500 cap; "a warehouse-population build or a cohort-scoped run" | The budget assumes **three ID-scoped reads for every maid in the population**. It misses that `filterHousemaids` **returns `basicSalary` inline on every row** — the spec's own `maid_basic_salary` trap #4 says so outright: *"filterHousemaids returns this field on each row, which is what makes cheap candidate narrowing possible without a per-maid call."* Enrichment only has to run on maids who could plausibly be over. | Recount the budget on the narrowed candidate set, not the population. See §4. |
| `renewal_raise_lifetime_cap`, `ruled_cohort_level` | "must STOP the run" if missing | Implemented as a hard assert plus a **checksum** (`cap=2;Ethiopian\|live_in=1500,Filipina\|live_out=3200;n=2`) asserted before anything is scored. | Suggest adding the checksum to the spec so a silent edit to a ruling is detectable. |
| Test-case table | Five cases with expected verdicts and the rule that produces each | All five reproduce **independently**, with the correct rule attribution, from the figures in the table. | None — the table is sound. It is now the regression fixture. |
| ACP tombstones | Two retired rules sit on `Status = Pending Business` alongside two genuinely open ones | Confirmed: filtering on `Status` alone returns dead rules. The build filters the ACP on **`Order` 999** to separate them, as the spec instructs. | Malaz's call on adding a `Retired` state to the shared schema. |

---

## 4. The call budget, recounted

The spec's figure assumes per-maid enrichment across the whole population. The population sweep
returns each maid's current total salary inline, so enrichment runs only on maids who could
plausibly be over their allowance.

| | Spec's figure | Recounted |
|---|---|---|
| Population sweep (7,752 @ size=40) | 194 | 194 |
| Per-maid enrichment (3 reads) | 7,752 × 3 = 23,256 | **candidates only** |
| **Total** | **≈23,300 (47× the cap)** | **194 + 3C + sweep pages** |

For a cohort-scoped run the sweep is far smaller again. This makes the check **feasible**, but it
buys that feasibility with an assumption that must be stated:

> ⚠️ **The inline figure is TODAY's salary, not the audited month's.** The spec's own
> `maid_basic_salary` trap #2 is explicit: maid 55376 reads 1,500 now but was paid 1,150 through
> April 2026. So narrowing on it is **sound for a current-month run** and **unsound for a
> back-audit** — a maid paid high in the audited month and reduced since would be filtered out
> before anyone looked at her. That is a false clearance, the failure direction that defeats the
> check's purpose.

**Mitigation built in:** the narrowing floor is the **lowest allowance any cohort in the run could
have**, not a per-maid figure, so the miss is bounded rather than open-ended. A back-audit run
sets `narrowing: false` and pays the full budget, or is refused. The run summary states which mode
was used.

---

## 4a. Added after live probing (2026-08-30)

Full detail in `api-payloads.md`. The three that change behaviour:

- **The documented pagecode for payroll history does not work; another one does.** `getHistoryLog`
  is `INSUFFICIENT_PERMISSIONS` on `HousemaidsPayrollHistory` and **200 on `HousemaidsPayrollList`**.
  Permissions are per route × pagecode. Probing only the documented one would have reported this
  check as blocked on access the operator already has.
- **The population status filter silently falls through to the entire population** if the key or
  value shape is wrong. Only `status: "<single string>"` filters; every array form returns HTTP 200
  and all 80,621 CC maids. The run must assert the filter narrowed the result before paging.
- **The monthly total is not a stable rate.** A maid at a rate above entitlement clears if the run
  audits a month that happened to be reduced — and reduced months carry no exclusion flag of any
  kind. New guard added (§1.4).

### 1.4 A reduced audited month cannot produce a clean
**Spec position:** not addressed.
**What was built:** if the audited month reads at or below entitlement but the maid's *prevailing*
monthly total is above it, the case is `pending`, never `clean`. Routed to the existing catch-all
Order 78 ⓯ rather than a new numeral, since adding rules is the ACP's job, not the build's.
**Effect:** prevents a false clearance produced purely by month selection. Verified on the spec's
own flagship red, which cleared for Jul 2026 and flags correctly for Jun 2026.
**To close:** a new ACP rule — Jacky and Malaz.

## 5. Still needing a human

1. **The ERP token** — one paste per run, the operator's own. The flow holds no ERP credential.
2. **Jacky:** the at-exactly-a-ruled-level boundary (§1.1). Default until then: route, don't clear.
3. **Jacky, then Malaz:** whether this runs cohort-scoped or waits for a bulk route
   (`getMaidsSalariesOverNationalitiesTodo`, currently 401 on the auditing role, or a wrapper over
   `findLogByPayrollMonthAndTransferredTrue`). Both would collapse the fan-out entirely and the
   first would supply the change trail this check currently reconstructs.
4. **A new ACP rule for the reduced-month guard** (§1.4), and an audited month named on the
   five-case table — two of the five expected verdicts are month-dependent and the table names no
   month. → Jacky, Malaz.
5. **A permission request** for `GET /visa/renewRequest/housemaid/{id}` on `VisaProcessingPage`
   (`raiseApproved`). Degrades corroboration only; the check runs without it.
6. **Maker/checker sign-off before any real run, and before publishing or scheduling.** Required
   by the spec: money-out payroll, and a finding alleges someone was overpaid without authority.
   Reviewer is the Police & Control officer who did **not** run the check.

---

## 6. Defects found in the flow build itself (2026-08-30)

Three, all caught by reviewing my own draft before deploying it. Recorded because each one would
have produced a run that *looked* successful:

1. **Two "nothing to do" branches returned `[]`.** A node that emits zero items makes n8n skip
   every node downstream — the scorer, the verifier, the case store and the run row would all
   silently never execute, and the execution would still report success. An empty audit that
   looks like a completed one. Both are now passthroughs.

2. **Order 57 could never fire.** The rule says an MV→CC switcher is pending, never red. But no
   per-maid route exposes the distinction — `getHousemaidInfo` does not carry `oldHousemaidType`,
   and its `housemaidType` is a recruitment channel, not CC vs MV. The only source is the
   *request* side of `filterHousemaids`. Without a separate MV_TO_CC sweep, a switcher above her
   allowance would have reached the candidate route and could have been **accused** — precisely
   what the rule exists to forbid. The cohort is now enumerated separately and intersected with
   the candidates, with the same reconciliation discipline as the main walk.

3. **The verifier was being asked to judge evidence it was never given.** The agent prompt
   referenced `$json.evidence`, and nothing attached it. Worse, the **comment threads were never
   fetched at all** — and verifier rule 80 is explicit that the thread is the ONLY place a
   *denial* is recorded. A verifier reading descriptions alone can be talked into clearing a maid
   whose raise was explicitly refused. Threads are now fetched wherever `commentCount > 0`,
   attached per maid, and every text is HTML-stripped and phone/email scrubbed before the model
   sees it. An unreadable thread is a **blocking** gap: absence of a refusal cannot be relied on
   when the place refusals live could not be read.

**Budget impact of (3):** the thread reads are the largest single per-candidate cost. The gate now
budgets 13 calls per candidate (4 enrichment + 3 sweep + ~6 threads) rather than 7, which roughly
halves how many candidates fit a 500-call run. That is a real constraint and it pushes harder
toward cohort-scoped runs — but the threads are not optional, because they are the only thing that
distinguishes an approval from a refusal.
