# CC Maids Salary Raise — ERP surfaces, as probed

Probed live **2026-08-30** against `erpbackendpro.maids.cc` on the operator's own token
(user claim `Hassan.Ahmed`), serial, 2.0 s pacing. Every row below is what the API actually did,
not what the spec recorded.

## Auth shape

Every call carries **both**, and both are needed:

```
authorization: Bearer <token>
cookie:        authTokenProduction=<token without the "Bearer " prefix>; deviceIdProduction=<device id>
pagecode:      <see table>
accept:        application/json, text/plain, */*
content-type:  application/json
origin:        https://erp.maids.cc
referer:       https://erp.maids.cc/
```

The token is a **runtime payload**, never a stored credential and never a literal in a Code node.

## The three denial shapes — now distinguishable

This matters more than anything else here, because all three arrive as **HTTP 401** and the only
thing separating them is the `developermessage` header. Round one of probing misread one as the
other and briefly reported the check as blocked when it was not.

| `developermessage` | What it actually means | What to do |
|---|---|---|
| `API_NOT_FOUND_FOR_PAGE` | The route is not registered on **that pagecode**. The pagecode exists. | Try the right pagecode. **Not** a permission problem. |
| `PAGE_NOT_FOUND` | The pagecode itself does not exist. | Fix the pagecode string. |
| `INSUFFICIENT_PERMISSIONS` | The route **is** registered on that pagecode and the role lacks it. | A real permission gap — **for that pagecode**. The same route may still be reachable on another pagecode. |
| HTTP 500 containing `498` | Dead token. | Get a fresh one. Not a server fault. |

**Permissions are per route × pagecode, not per route.** `getHistoryLog` returns
`INSUFFICIENT_PERMISSIONS` on `HousemaidsPayrollHistory` and **200 on `HousemaidsPayrollList`**.
So `INSUFFICIENT_PERMISSIONS` is never on its own proof that a surface is unreachable — probe the
plausible alternatives before reporting an access gap.

## Working surfaces

| Surface | Method + path | pagecode | Envelope |
|---|---|---|---|
| Population | `POST /payroll/HousemaidPayroll/filterHousemaids?page=N&size=40` | `HousemaidsPayrollList` | paged, `content[]` + `totalElements` |
| Salary rule (per maid) | `GET /payroll/salaryrules/getruleofhousemaid/{id}` | `HousemaidsPayrollList` | **bare array** of component rows |
| Payroll history | `GET /payroll/HousemaidPayroll/{id}/getHistoryLog?monthsCount=N` | **`HousemaidsPayrollList`** ⚠️ not the documented one | **bare array**, newest last |
| Maid profile | `GET /staffmgmt/housemaid/getHousemaidInfo/{id}` | `HousemaidDetails` | object, ~155 fields |
| Renew-request documents | `GET /visa/renewRequest/housemaidProfile/documents/{id}` | `HousemaidDocuments` | **bare array** of renew requests |
| Complaints (evidence) | `GET /complaints/complaint/limited/housemaid/{id}?page=N&size=20` | `HousemaidComplaints` | paged, `content[]` + `totalElements` |

## Refused on this operator's token

| Surface | pagecode(s) tried | Result | Effect |
|---|---|---|---|
| `GET /visa/renewRequest/housemaid/{id}` (`raiseApproved`) | `VisaProcessingPage` (its own), + 3 others | `INSUFFICIENT_PERMISSIONS` on its own pagecode; `API_NOT_FOUND_FOR_PAGE` elsewhere | **Degradation, not a blocker.** The field was empty on 14 of 14 above-tier candidates, so it corroborates when present and never clears when absent. The check does not depend on it. |
| `GET /payroll/payrollAuditTodo/getMaidsSalariesOverNationalitiesTodo/{id}` | `HousemaidsPayrollList` | `API_NOT_FOUND_FOR_PAGE` | **Inconclusive on permissions** — that is the wrong pagecode, so this probe says nothing about whether the role has it. The spec's own claim (401 across 4 pagecodes × 3 auth modes) stands unchallenged. Still worth requesting: it would collapse the per-maid fan-out and supply the change trail. |

## Corrections to the spec's variable rows

### 1. `maid_payroll_history` — the documented pagecode does not work; another one does
Recorded as `HousemaidsPayrollHistory`. That returns `INSUFFICIENT_PERMISSIONS`.
**`HousemaidsPayrollList` returns 200.** Had the alternative not been probed, this check would
have been reported as blocked on a permission the operator already has.

### 2. `formattedPayrollMonth` is `"MMM YYYY"`, not ISO
Live values: `"Jul 2026"`, `"Aug 2025"`. Neither the spec nor the variable row records the format.
A YYYY-MM assumption matches **no month at all**, which reads as "no payroll row for the audited
month" and drops every maid out of population — **a silent empty run that looks like a clean one.**

### 3. `payroll_total_salary` — `basicSalary` and `companySalary` are NOT always identical
The row says "identical to `[].companySalary` on every row observed". Falsified: they agree on
**9 of 12** months for one real maid. The row's *instruction* (read `basicSalary`) still stands —
only the parenthetical is wrong. The build reads `basicSalary` and records the divergence as a
non-blocking note.

### 4. `maid_payroll_history` — `monthsCount` omitted returns EVERYTHING, not one month
The row warns that "monthsCount defaults to 1 in the client wrapper". That is true of the wrapper.
**The API itself returns the maid's entire history when the parameter is omitted** — 73 rows for
one maid, back to Jul 2020. Cheap for a back-audit, expensive at population scale. The build sends
`monthsCount=18` explicitly.

### 5. `maid_payroll_type` — the status filter is a STRING, and a wrong shape falls through SILENTLY
The population filter's status key is `status`, and it takes **a single string**:

| body | result |
|---|---|
| `{maidPayrollTypes:["MAID_CC"], status:"WITH_CLIENT"}` | **5,611** ✅ |
| `{maidPayrollTypes:["MAID_CC"], statuses:["WITH_CLIENT"]}` | 80,621 — **silently unfiltered** |
| `{maidPayrollTypes:["MAID_CC"], housemaidStatus:[...]}` | 80,621 — silently unfiltered |
| `{maidPayrollTypes:["MAID_CC"], housemaidStatuses:[...]}` | 80,621 — silently unfiltered |
| `{maidPayrollTypes:["MAID_CC"], maidStatus:[...]}` | 80,621 — silently unfiltered |

**An unrecognised filter key returns HTTP 200 and the entire unfiltered population.** The spec's
`maid_population_bulk` row warns about a filter falling through to *empty*; the real failure is the
opposite and far worse — it falls through to **everything**, and a run that quietly audits 80,621
maids instead of 5,611 is both a wrong answer and an ERP load incident. **Assert that the filter
narrowed the result before paging.** `status` accepts only one value, so a multi-status population
is one call per status.

Also: `MAID_CC` unfiltered is **80,621**, not the 7,752 the spec quotes — the spec's figure is CC
maids in *non-terminated* statuses. Page 0 of the unfiltered sweep is entirely
`EMPLOYEMENT_TERMINATED` / `REJECTED` / `PASSED_EXIT` / `UNREACHABLE`.

### 6. The population row already carries what the enrichment was going to fetch
Confirmed inline on every row: `id`, `name`, `status`, `startDate`, **`basicSalary`**,
**`nationality`**, `loanBalance`, `pendingStatus`, `notArabicSpeaker`,
`additionToBalanceDeductionLimit`. This is what makes candidate narrowing possible and is the
answer to the spec's budget problem — with the back-audit caveat already declared.

### 7. ⚠️ NEW AND MATERIAL — the monthly total is not a stable rate, and one month can clear an overpaid maid
The spec models `payroll_total_salary` as the maid's rate for the month and compares it to
entitlement. Probed across 24 months for maid 3978:

- She is **+350 over her capped entitlement in 15 of 24 months** — continuously since Apr 2025,
  which is exactly when her fourth r-visa landed.
- She is **below entitlement in five** of them, including the month this build first picked.
- **Every single row is `Paid`, transferred, `canBeMarkedAsPaid: true`, `accountantTodoIsClosed:
  true`, with no automatic or manual exclusion reason.** The reduced months are not flagged as
  exceptional anywhere in the payload.

So a maid whose *rate* is plainly above entitlement clears if the run happens to audit a reduced
month. That is a **false clearance produced by month selection**, and nothing in the spec guards
against it. Scoring maid 3978 — the spec's own flagship red — for Jul 2026 cleared her; scoring
her for Jun 2026 flags her correctly.

**Guard built:** if the audited month reads at or below entitlement but the maid's **prevailing**
monthly total (the modal figure across the window read) is above it, the case is `pending`, never
`clean`. It is routed to the existing catch-all Order 78 ⓯ rather than given a new rule numeral,
because inventing rule numbers is a governance act and the ACP is the only place rules live.
**A new ACP rule should be added for this** — Jacky and Malaz's call.

### 8. The spec's five-case table has no audited month, and the verdicts are month-dependent
The table gives each maid an expected verdict but never names the payroll month, and two of the
five only hold in specific months:

| maid | expected | holds when |
|---|---|---|
| 3978 | finding | any month at her prevailing rate; **not** a reduced month (the new guard covers this) |
| 44770 | clean | stable |
| 65604 | clean | stable |
| 10907 | pending | stable |
| 11964 | finding | **only from Jul 2026** — her fourth r-visa is dated 2026-07-25, so in Jun 2026 she was exactly at entitlement and correctly reads clean |

The table should name an audited month, or state that each row is "as at 2026-08-19".

## Live results, deterministic stage

Run against real ERP, both months, deterministic layer only (all five are expected to route,
because the approved base is prose and only the verifier can settle it):

| maid | Jun 2026 | Jul 2026 | correct? |
|---|---|---|---|
| 3978 | `candidate` (Order 60 ❻) | `pending` (Order 78 ⓯ — reduced month) | ✅ both |
| 44770 | `candidate` (Order 60 ❻) | `candidate` (Order 60 ❻) | ✅ |
| 65604 | `candidate` (Order 60 ❻) | `candidate` (Order 60 ❻) | ✅ |
| 10907 | `candidate` (Order 60 ❻) | `candidate` (Order 60 ❻) | ✅ |
| 11964 | `clean` (Order 65 ⓮) — not yet renewed | `candidate` (Order 60 ❻) | ✅ both |

Every case lands correctly in the month where its condition actually holds. Evidence sweeps
reconciled in every case (96/96, 26/26, 18/18, 22/22, 33/33).

**The +500 approved-base premium on maids 44770 and 65604, and the +350 third-renewal shape on
11964, reproduce the spec's stated figures exactly** from live data — which is the strongest
available signal that the allowance composition is right.

## Recounted call budget

Per maid: 1 profile + 1 salary rule + 1 history + 1 renew-docs + ⌈complaints/20⌉ sweep pages.
Observed: **32 ERP calls for 5 maids**, i.e. ~6.4 per maid (the sweep dominates — 5 pages for the
maid with 96 complaints).

| | calls |
|---|---|
| Population sweep, `WITH_CLIENT` (5,611 @ size 40) | 141 |
| Enrichment @ ~6.4 per **candidate** | 6.4 × C |
| **Total** | **141 + 6.4C** |

Against a 500-call cap that allows roughly **C ≈ 56 candidates per run** — so the run must be
cohort-scoped or the narrowing floor set tightly, exactly as the spec rules. At 2.0 s pacing,
500 calls is a ~17-minute run.
