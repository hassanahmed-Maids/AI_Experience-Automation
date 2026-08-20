# Three routes at 401, and exactly what to ask for

**2026-08-19.** Hassan asked for the pagecodes behind the 401s. Here is what is
certain, what is not, and why.

## The probe

All four hit within the same minute, same bearer:

| Route | Status |
|---|---|
| `GET /accounting/directDebit/getActiveCptInfo/{contractId}` (pagecode `ClientMgmtClientDirectDebits`) | **200** |
| `GET /accounting/contractpaymentterm/getcontractpaymentterminfo/{contractId}` | 401 |
| `GET /accounting/payments/getPayments/{contractId}` | 401 |
| `GET /clientmgmt/contract/{id}` | 401 |

The three failures return body `message: "UNAUTHORIZED <LOGOUT>"`, with or
without a pagecode header — I tried `ClientMgmtClientDirectDebits`, `ClientSummary`
and none, and all six combinations returned the identical 207-byte body.

**At that moment it was not a dead session** — `getActiveCptInfo` answered 200 on
the same token seconds either side of the three failures.

### …but the message is ambiguous, and I nearly wrote it up as if it weren't

Thirty minutes later, at 18:39 Dubai, **every** route returned the identical
`UNAUTHORIZED <LOGOUT>` body — `getActiveCptInfo`, the `getactivecccontracts`
dynamic API, even `/lowcode/c2d/sessions`. The JWT's `exp` was still six hours
away, so I recorded it as ERP invalidating the session.

**That was wrong, and Hassan supplied the actual cause: both his and Abdullah's
ERP accounts had been deactivated.** Shortly afterwards the same call started
answering HTTP 500 `Token not valid, {Token is expired}` instead — a third
message for one underlying condition.

So the same `UNAUTHORIZED <LOGOUT>` string covers at least three conditions:

1. **this (user, pagecode, API) tuple is denied** (that route 401s, others 200),
2. **the session is gone**, and
3. **the account itself is deactivated** (everything 401s).

The operationally useful split is only two-way, and a control probe gives it to
you: **route-specific** (control answers 200 → the denial is real, go ask for the
grant) versus **global** (control also fails → it is a credential problem, and
you have learned nothing about the route). Distinguishing a dead session from a
dead account is not something the API will tell you — ask the account owner.

LCP predicted exactly this: `BaseController.unauthorizedReponse()` is a generic
hard-deny, and the branch conditions that would separate the cases live in the
compiled `magnamedia-core` JAR. **The message alone cannot tell you which you
have.** Only a control probe can — and a control probe is evidence about the
instant it ran, nothing more. Re-run it alongside every failure, not once at the
start of a session.

## A fourth denial shape

Distinct from the three already recorded, and added to the skill:

| Shape | Meaning | Fix |
|---|---|---|
| edge 403, HTML, `server: awselb/2.0` | path does not exist | fix the URL (usually a missing module prefix) |
| 401 + `developermessage: API_NOT_FOUND_FOR_PAGE` | pagecode not registered against this API | register the API on the page |
| 401 + `INSUFFICIENT_PERMISSIONS` | API mapped, grant missing | grant the permission |
| 401 + `UNAUTHORIZED <LOGOUT>` | **ambiguous** — route denied, session dead, **or** account deactivated | control-probe first; if the control also fails it is a credential problem, not a route problem |
| 500 + `Token not valid, {Token is expired}` | same credential problem, later in its lifecycle | new credential required |

## Credentials die before the JWT expires

Worth its own line, because it changes how a long run must be read. The 18:36
smoke completed on this token; by 18:39 every route was refusing it, with `exp`
at 22:00. **`exp` is not a liveness guarantee** — it says when the token stops
being valid at the latest, not that it is valid now. Here the cause was account
deactivation, but a run cannot tell the difference and must not try.

The flow degrades safely: the HTTP nodes use full-response mode with
`onError: continueRegularOutput`, so a mid-run 401 records a non-200 status and
routes those contracts to `pending` with `details_unreadable_*` /
`logs_unreadable_*` rather than scoring them on an empty payload. The smoke shows
this working — its final batch of 5 carries `logs_unreadable_null`, which is the
session dying in the last seconds of the run, not an ERP hiccup.

## What to request

LCP was asked for the pagecodes and gave a straight answer: **they are not in
source.** `FrontendPage.code` values are database rows, resolved at runtime; the
emitting classes (`AuthorizeFilter`, `ApiAuthorizationService`,
`BaseController.unauthorizedReponse()`) live in the compiled `magnamedia-core`
JAR, not in any cloned repo. It declined to invent values, which is the right
answer.

So the request splits in two.

**Certain — the permission strings, quoted from `@PreAuthorize`:**

| Route | Grant to request |
|---|---|
| `getcontractpaymentterminfo` | `hasPermission('ContractPaymentTerm','getContractPaymentTermInfo')` |
| `getPayments` | `hasPermission('Payments','getPayments')` |
| `GET /clientmgmt/contract/{id}` | no annotation in source — the guard is in the core JAR, derived from the `Contract` entity. Confirm the resource name from the admin Security-Resource listing rather than guessing. |

Case matters: capital-C `ContractPaymentTerm`, capital-P `Payments`.

**Not in source — the pagecodes.** Capture each from DevTools, exactly as the
`salesPaymentTermsConfig` pagecode was captured: open the screen that issues the
call, read the `pageCode` request header off that request in the Network tab.
The screens are the contract payment-term / payment-plan panel, the contract
payments grid, and whichever contract-detail screen loads `contract/{id}`.

**Ask for both parts.** In this ERP, authorization is two-part: the
`hasPermission` grant *and* the API being registered in that page's
`newAllowedApis`. A grant alone will not open a route whose URL is not mapped to
the page.

## What this costs the audit

Nothing that is currently reported — but it caps one thing.
`ContractPaymentTerm.REASON` (`SWITCHING` / `REPLACEMENT` / `REPLACEMENT_WITH_VAT`)
is the direct, unambiguous marker of a nationality switch, and it lives behind
`getcontractpaymentterminfo`. Without it, `upgrading_nationality` is detected
indirectly — by comparing the active term's maid nationality against the
contract's current maid — which finds the same state but cannot name the reason
ERP recorded for it. With the grant, the test would corroborate rather than infer.
