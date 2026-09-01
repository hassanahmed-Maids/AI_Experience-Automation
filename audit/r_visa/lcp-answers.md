# R-Visa Audit — LCP answers (2026-09-01)

Asked via n8n `dXWzWtPZHO3CuRvx`, conversations `45423`–`45427`, each pinned to
its owning module.

⚠️ **Asked on a token issued to `Malaz.a`, not the operator.** Every route below
is **named by the code, not verified as callable on the auditing account.** This
check has already been burned by that distinction: the spec recorded two test
cases as "confirmed against live ERP" on a different login, and
`GET /accounting/transactions/{id}` is refused with `INSUFFICIENT_PERMISSIONS` on
the operator's. Each route needs a probe on the operator's token before any spec
row is marked verified.

One structural note LCP gave that applies to all of them: **`pageCode` is not a
per-route constant.** It is an HTTP header resolved at runtime against a
`FrontendPage` record (`PageRepository.findByCode`) and checked against the
caller's permissions. So the right `pageCode` is whichever frontend page hosts
the view — it cannot be read off the controller, and a missing one is rejected as
`PAGE_CODE_MISSING`. That is consistent with what probing found: `AddEditTransaction`
serves the transaction detail route and `ManageTransactions` does not.

---

## 🔴 3. Rejection and refund — THE SUB-AUDIT CANNOT BE BUILT

**This is the answer that changes the check.** The question was where R-visa
records a rejection status and a refund-request date. The answer is that
**neither field exists**, and the R-visa flow has no rejection or refund handling
at all:

> There is **no** `rVisaImmigrationApproved`-style rejection field, **no** R-visa
> `refundedStatus`, and **no** R-visa refund step anywhere in the codebase.
> `refundedStatus` and `entryVisaImmigrationApproved` are used *exclusively* for
> the entry-visa (and cancellation) flows — never for R-visa.

The R-visa process is linear: Apply → Check EDNRD → Schedule Zajel Pickup → With
Zajel for Stamping → Upload R-visa to SF → Receive/Upload EID. The only R-visa
fields on `NewRequest` are `appliedForRVisa`, `rvisaIssuanceDate` and
`rVisaExpiryDate`.

**LCP also corrected the spec's premise, on all three fields it proposed:**

| Spec's guess | Reality |
|---|---|
| `entryVisaImmigrationApproved` might serve R-visa | It is real, but **entry-visa only**; enum value `Rejected` routes to `RefundEntryVisaApplicationStep` |
| `refundedStatus` records a refund | Real, but a **Boolean** (refunded / not refunded), **not a date**, and entry-visa/cancellation only |
| `taskNameDate` is a refund date | **Not an entry-visa field at all.** It is the generic timestamp on `VisaRequestTaskHistory` for *any* workflow task |

### What this means for ⓬ and verifier ❸

Both rules are currently `Pending Technical`, with the closing action recorded as
*"one `ask_erp_code` query pinned to the visa module, then one payload read."*
**That query has now been run, and the answer is that there is nothing to read.**

So the status is wrong in a way that matters: this is not a route waiting to be
found, it is a sub-audit that **cannot be implemented against ERP as the code
stands**. It needs either a product change (add the fields to the R-visa flow) or
the owner's acceptance that the rule is unbuildable and should be retired rather
than left pending.

The flow's behaviour does not change — ⓬ already annotates and routes without
halting, and verifier ❸ already reports `inconclusive` rather than clean. What
changes is the **honesty of the declared gap**: "never observed on a payload"
becomes "does not exist in ERP", and the reviewer stops waiting for a probe that
has already happened.

---

## ✅ 2. Cancellation type — ROUTE FOUND, and it is the safe one

This unblocks ❿, the **sole** clearance a duplicate payment has.

- **`GET /cancelRequest/housemaid/{housemaidId}`** — the full `CancelRequest`
  entity for that maid.
  - **`visaCancellationType`** — enum `CancellationType`: `ABSCONDING`,
    `IMMIGRATION`, `MEDICAL`, `OFFER_LETTER`, `OUTSIDE_COUNTRY`,
    `UNUSED_WORK_PERMIT`, `USED_WORK_PERMIT`, `NORMAL`, `VISA_CANCELLED`,
    `TAWAFUQ_CANCELLATION`. Stored as a string; **the getter defaults `null` to
    `NORMAL`** — which matters, because a null read would silently become a
    legitimate-looking cancellation type.
  - **`dateOfCancellation`** — the effective date.
  - **`completed`** flag; terminal task is `"Visa Cancelled"`.
  - A separate free-text `cancellationType` field also exists and is **not** the enum.
- Boolean-only alternative: `GET /cancelRequest/check-visa-cancel/{housemaidId}`.

**It is a per-housemaid read, not the bulk `/tasks` listing** that ❿'s rule body
warns against (that being the call family that got the ERP account disabled in
June 2026). Two caveats: it returns the **most recent** CancelRequest only, and
the null-defaults-to-`NORMAL` getter means an absent record must be distinguished
from a real `NORMAL` cancellation before it is allowed to clear anything.

---

## ◐ 1. Visa request history — partially available

⓫'s preferred discriminator is *reachable but split across two routes*, and
neither gives the whole thing:

- **`POST /housemaid/getAllVisaRequests`** (body: `VisaRequestInfoRequestDto` with
  `housemaidID`) — returns **every** request, grouped `new` / `renew` /
  `cancellation` as maps of `requestId → status` (`active`/`completed`/`stopped`).
  **But it carries no dates and no cycle marker.**
- **`GET /newRequest/housemaid/{housemaidId}`** — the full request *including*
  `taskHistorys`, but **only the most recent request**
  (`findByHousemaidOrderByCreationDateDesc` … `.get(0)`). This confirms the spec's
  own note that the route returns one request, the latest.
- Per-cycle fields, on each `taskHistorys` entry: **`taskName`**,
  **`taskMoveInDate`** (start), **`taskMoveOutDate`** (end).
- **`Fill Previous Visa Info`** is confirmed as a real `taskName`
  (`FillPreviousVisaInfoStep`, `STEP_ID = "Fill Previous Visa Info"`) and is the
  marker of a second visa cycle.

**Consequence:** you can enumerate all request ids, and you can date the latest
one — but dating *historical* cycles needs a per-request route LCP did not name.
So ⓫ can be upgraded from the day-gap proxy for the **current** cycle, and the
30-day proxy still has to cover pairs whose earlier payment predates it. That is
better than today but not the clean fix the spec hoped for.

---

## ◐ 4. Term and validity — half of ❻ exists, and the missing half is missing everywhere

- **Issued validity IS stored:** `rvisaIssuanceDate` (start) and `rVisaExpiryDate`
  on `NewRequest`, with the equivalents on `RenewRequest`. Readable via several
  routes, including `GET /visa/newRequest/housemaid/{housemaidId}` and
  `GET /visa/clientPortal/visaCcAppInfo/{housemaidId}`.
- **The purchased 1-year / 2-year option is NOT stored in the visa module.** No
  `visaTerm`, `visaOption`, `visaDuration` or equivalent enum exists. Fields that
  look related are not: `Contract.workerRVisaProcedureType` is urgency
  (`NORMAL`/`URGENT`/`URGENT_VISA`), `contractType` is the MOHRE labour-contract
  type (`Limited`/`Unlimited`), and `getVisaType()` is a computed display string.
- **No contracted visa term field either** (`contractedVisaTerm` does not exist).
- The term is only ever *inferred from dates* — renewal logic derives issuance as
  `rVisaExpiryDate − 2 years`.

**Consequence for ❻:** the rule compares the term bought against the contract and
the issued validity. We can now read the issued validity, but the *bought term*
is not persisted anywhere LCP can see, so the comparison still cannot be made.
❻'s note that we hold "one side of the comparison only" is confirmed — and the
missing side may not exist at all. This also directly supports ❻'s existing
warning never to default the term to 2 years.

---

## ◐ 5. Entry-visa expense heads — not in code, but now precisely locatable

LCP was straight about the limit: the concrete `expense.name` strings and
`expense.id` values are **database reference data**, provisioned at deploy time
via `dataInitializerController` calls, not seeded in source. It could not hand
over literals. What it did give is the exact shape to resolve them:

- Entry visa is an **`ExpensePurpose`**, with exactly two entry-visa values:
  - `ENTRY_VSIA` → `"Entry Visa > 1000 AED"` *(note the typo in the enum name — it
    is `ENTRY_VSIA`, not `ENTRY_VISA`)*
  - `ENTRY_VISA_LESS_THAN_1000` → `"Entry Visa < 1000 AED"`
- Non-entry-visa purposes, for contrast: `APPLY_FOR_RVISA` ("R-Visa"),
  `RENEW_RESIDENCE`, `RESIDENCE_CANCELLATION`, `IMMIGRATION_CANCELLATION`,
  `CHANGE_OF_STATUS`, the three `MOHRE_INSURANCE*` values, and
  `MODIFY_PERSON_INFORMATION_IN_MOHRE`.
- The concrete head is resolved through **`VisaExpenseConfiguration`**, keyed on
  **employeeType × newEmployee × expensePurpose × paymentType**, joined to
  `Expense` for name and id.
- **CC vs MV is the `EmployeeType` discriminator:** `MAID_CC` ("Maids.cc") vs
  `MAID_VISA` ("Maidvisa").

**Consequence for ❼/❽:** the anchor heads are now a *probeable* question rather
than an open one. The resolution path is either a read of
`VISA_EXPENSE_CONFIGURATION` joined to `EXPENSES` filtered on
`expense_purpose IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')`, or — since the
transaction search accepts `expense.name` with a `like` operator, which was
proved to bind — a probe for heads matching those two purposes on the operator's
token. Until one of those is done the fine gates stay suppressed and the gap
stays declared.

---

## Net effect on the check

| Rule | Before | After LCP |
|---|---|---|
| ⓬ / verifier ❸ | Pending Technical — awaiting one ask-the-code query | **Unbuildable.** The query ran; the fields do not exist. Needs a product change or a decision to retire the rule. |
| ❿ | No route to a cancellation type | **Route found and safe.** Wire it, after probing on the operator's token. |
| ⓫ | Day-gap proxy only | Cycle enumeration available; dating limited to the latest request. Partial upgrade. |
| ❻ | One side of the comparison | Issued validity readable; **the purchased term appears not to be stored at all.** |
| ❼ / ❽ | No entry-visa heads | Purposes and resolution path known; the literal heads still need one probe. |

**None of this is wired yet.** Every route is unverified on the auditing account,
and wiring an unprobed route is how a check comes to report on a surface it never
actually read.
