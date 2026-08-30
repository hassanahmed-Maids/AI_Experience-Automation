# CC Overstay Fines — the four downstream endpoints, resolved (2026-08-30)

Asked the code (session 45321) which pageCode whitelists each of the four endpoints the breaker had
never reached, then probed every named pageCode live. Result: **two of the four already work, one
was failing on a wrong pageCode in our own flow, and only two real grants are needed.**

## Probe results — the decisive table

`developerMessage` is the response header that carries the real reason; the body always says the
fixed string `UNAUTHORIZED <LOGOUT>`.

| # | Route | pageCode tried | Result |
|---|---|---|---|
| 1 | `GET /visa/overstay-fines/housemaid/{id}` | `Visa_OverStayFinesMonitoring` | 401 **INSUFFICIENT_PERMISSIONS** |
| 1 | " | `HousemaidOverstayFines` | 401 **INSUFFICIENT_PERMISSIONS** |
| 2 | `GET /payroll/loans/getHousemaidLoans/{id}` | `HousemaidsPayrollLoans` | 401 **INSUFFICIENT_PERMISSIONS** |
| 2 | " | `HousemaidPayroll` | 401 **INSUFFICIENT_PERMISSIONS** |
| 3 | `GET /complaints/complaint/limited/housemaid/{id}` | `HousemaidComplaints` | **HTTP 200** ✅ |
| 4 | `GET /complaints/teamComplaintUpdate/historyOfComplaint/{id}` | `HousemaidComplaints` | **HTTP 200** ✅ |

`INSUFFICIENT_PERMISSIONS` is the useful answer: it means the pageCode string is *correct* and the
API *is* whitelisted under it — only the grant is missing. Contrast the earlier probes, where
`OverstayFines` and `HousemaidProfile` returned `PAGE_NOT_FOUND` (not real pageCode strings) and
`ManageTransactions` returned `API_NOT_FOUND_FOR_PAGE` (real page, API not on its whitelist).

## Defect found and fixed: the flow sent a pageCode that whitelists nothing

`Get Overstay Fines` was sending **`VisaProcessingPage`**, which does not whitelist
`/visa/overstay-fines/*` in any security file. Corrected to **`Visa_OverStayFinesMonitoring`**
(`visa-angular/src/custom/security-visa.json:824-829`). The grant is still outstanding, so this does
not unblock the node by itself — but without the fix the node would have kept failing *after* the
grant landed, and the failure would have looked like the grant had not been applied.

The other three nodes were already sending the right pageCode.

## The two grants to request — exact strings

**1. `Visa_OverStayFinesMonitoring`** — read-only, and the tightest page that reaches route 1. Its
whole whitelist is four GETs:

```
"Visa_OverStayFinesMonitoring": [
  "GET /visa/overstay-fines/get*",
  "GET /visa/overstay-fines/status",
  "GET /visa/overstay-fines/housemaid/*",
  "GET /public/picklist/items/*"
]
```

Do **not** request `HousemaidOverstayFines`, the other page that reaches route 1: it also carries
`POST /visa/overstay-fines/fine/update*`, so it is not read-only. For a read-only audit user
`Visa_OverStayFinesMonitoring` is strictly the correct ask.

**2. `HousemaidPayroll` — and the grant must be the `_READONLY` policy.** Followed up (session
45321) and inspected all four pages that whitelist route 2. **None is GET-only.** Ranked by write
scope:

| pageCode | file | non-GET entries |
|---|---|---|
| **`HousemaidPayroll`** | `security-staff-mgmt.json:1596-1618` | **3 POST, no Delete** |
| `HousemaidsPayrollLoans` | `security-payroll.json:39-52` | 5 POST + 1 Delete |
| `ResignedMaidsToDo` | `security-staff-mgmt.json:1951-1975` | 10 POST |
| `HousemaidsPayrollList` | `security-payroll.json:2-30` | 10 POST + 3 Delete |

`HousemaidPayroll` is the narrowest: `POST /payroll/HousemaidPayroll/update`,
`POST /staffmgmt/housemaid/sendemailtowaiverapprove`, `POST /payroll/loans/waiveLoanAmount/*`. It is
the only one of the four with no `Delete` entry at all.

### The `@PreAuthorize` is a no-op — do not ask anyone to seed a permission row

`@PreAuthorize("hasPermission('loans','getHousemaidLoans')")` (`LoansController.java:324`) never
resolves a permission. `PermissionEvaluatorImpl.hasPermission` returns `true` unconditionally, with
the comment *"all permission checks are performed in JwtAuthorizer"*
(`magnamedia-core/.../security/PermissionEvaluatorImpl.java:66-81`). Access is decided **entirely**
by the pageCode + policy path in `ApiAuthorizationService.checkAuthorization:166-183` — which is
also where our `INSUFFICIENT_PERMISSIONS` comes from: the page resolved *and* the API was found
inside it, we simply hold no `SecureResourceHolder` on it.

So the provisioning instruction is one line: **assign the `<pageCode>_READONLY` SecurityPolicy to
the user** (a `UserSecurityPolicy` row). Every page auto-gets `_FULL` and `_READONLY` policies at
import (`SecurityPolicyCreationService.java:63-67`). Asking for an `API_PERMISSIONS` /
`loans_gethousemaidloans` row would be wasted work — nothing reads it.

### ⚠ Caveat on what `_READONLY` actually does — do not oversell this

Ask-code's summary said a READONLY grant "neutralizes" the write entries. **Its own working says
something weaker**, and the weaker reading is what the cited code shows: a READONLY holder is still
`ApiAuthorizationResult.authorized(PermissionType.READONLY, true, apiKey)` — the request **is
authorized** at the API layer and merely flagged, propagating as `CurrentRequest.setSpelRequest(true)`.
In its words: *"a READONLY policy grants READONLY across the whole page including its write APIs —
the READONLY flag is set but the request is still authorized. Write protection is a downstream
`spelRequest` concern, not an API-level block."*

READONLY is still the correct ask and is materially narrower than FULL. But it should not be
presented to whoever approves it as a hard block on those three POSTs — that has not been verified,
and claiming it could get a grant approved on a false premise. If a hard guarantee is needed, that
is a question for whoever owns the security model, not something to infer from this.

### Accounting-scoped alternative — reaches the same data, but not narrower

`GET /accounting/loans/getHousemaidLoans/{id}` exists under an accounting-module
`HousemaidsPayrollLoans` (`security-accounting.json:7-18`) and reaches the same loans + forgiveness
data. Attractive because an accounting-scoped grant is easier to justify — but its whitelist carries
`Delete /accounting/.*/delete/`, a wildcard across the **whole accounting module**, which is the
single broadest entry in any of these pages. Taking it would also require repointing the flow's URL
from `/payroll/loans/...` to `/accounting/loans/...`.

**Probed live 2026-08-30 — we hold none of them:** `/accounting/loans/getHousemaidLoans` and
`/accounting/forgiveness/getHousemaidForgiveness` under accounting `HousemaidsPayrollLoans`, and
`/payroll/loans/getHousemaidLoans` under `HousemaidPayroll`, all return
401 `INSUFFICIENT_PERMISSIONS`. There is no free path; a grant is unavoidable.

## Why there is no way around grant 1

Unlike the transaction-attribution problem, this one has no back door, and that was checked
explicitly rather than assumed:

- The four fields the check needs — gross `originalOverstayFees`, reduction `reducedAmount`, net
  `overstayFineAmount`, and `reductionReason` — live only on the `OverstayFines` entity, served only
  by `OverstayFinesController`, i.e. everything is under `/visa/overstay-fines/*`.
- The legacy-search endpoint `GET /visa/overstay-fines/get` does return all four — and is
  whitelisted under the same single page. (This is the move that solved attribution; it was tried
  first and does not work here.)
- The reporting module's `VisaOverstayFeesAudit` Jasper report is per transaction-month, not per
  housemaid, and carries no `reductionReason`.
- Accounting models overstay only as a payment concept (`Contract.overstayFee`, the `overstay_fee`
  payment type, `currentOverstayFinesAmount`/`Status`) — no reduction, no reason.

## Gateway prefixes confirmed

`/visa`, `/payroll` and `/complaints` are **gateway prefixes, not Spring context-paths** — the
controllers carry only module-relative `@RequestMapping` and the Angular clients prepend the segment.
So the whitelist strings in the security JSONs are the real external paths, prefix included. Dropping
a prefix produces the bare nginx 403 we hit once before with `/accounting`.

## Caveat carried from the answer

Routes 3 and 4's complaints backend is not in the ask-the-code workspace (no `magnamedia-complaints`
repo), so their controller and method-level security could not be read from source — only their
whitelists and callers. Both were verified live at HTTP 200, which is the stronger evidence anyway.

## The access request, ready to send

Two policies, for the same user, both **READONLY**:

| # | Policy to assign | Unblocks |
|---|---|---|
| 1 | **`Visa_OverStayFinesMonitoring_READONLY`** | `GET /visa/overstay-fines/housemaid/*` — gross, net, reduction, reduction reason |
| 2 | **`HousemaidPayroll_READONLY`** | `GET /payroll/loans/getHousemaidLoans/*` — whether the cost was raised as a loan, and waived |

Mechanism, in one sentence for the provisioner: *assign these two `*_READONLY` SecurityPolicies to
the user via `UserSecurityPolicy`; no `API_PERMISSIONS` row is needed, because the `@PreAuthorize`
on the loans endpoint is never evaluated.*

Grant 1 is genuinely read-only by its whitelist (four GETs). Grant 2 is not — see the caveat above —
but `HousemaidPayroll` is the narrowest of the four pages that can reach the endpoint, and READONLY
is the narrowest form of it.

## Next

1. Send the two-policy request above.
2. Re-run CC Overstay once granted; the verifier band (routes 3 and 4) is already reachable, and the
   fines node now carries the right pageCode.
3. Regenerate the CC Overstay deploy draft — it still names `advancesearchNew` and the deleted
   detail node.

---

# ⚠ CORRECTION 2026-08-30 — the grants are missing from *Hassan's account*, not from ERP

Everything above is accurate about which pageCodes whitelist which route. But the framing — "we need
two grants" — was drawn entirely from probes made with **one token** (`Hassan Bearer`). Checking a
flow that already works shows another account has them.

**Wellcare Advanced Clinic, execution `101978` (2026-08-25):** its `Get Loans` node calls
`GET /payroll/loans/getHousemaidLoans/{id}` with pageCode **`HousemaidsPayrollLoans`** — the exact
pageCode that returns `INSUFFICIENT_PERMISSIONS` for Hassan's token today — and returned
**HTTP 200 with 3 rows, twice, no error.**

The same flow also calls two nodes under **`AddEditTransaction`** (`Get Transaction`,
`Download Data File`) and both succeeded — the very pageCode whose absence started the
transaction-attribution investigation.

Wellcare holds **no stored ERP credential**; its Authorization header comes from an expression, so a
token was supplied per run. Whoever supplied it holds `AddEditTransaction`, `HousemaidsPayrollList`
and `HousemaidsPayrollLoans`.

## What this changes

- **The pageCode analysis stands. The provisioning conclusion does not.** The correct question is not
  "does ERP grant this page?" but **"does the account behind the production token hold it?"**
- Every deploy draft says *the deploying team creates the ERP credential with a production token*.
  So the grants may already be satisfied the moment that credential is made, with no request at all.
- **Ask the deploying team first, before requesting anything from Chekri Khalife:** which ERP account
  will back the production credential, and does it already hold `Visa_OverStayFinesMonitoring`,
  `HousemaidsPayrollLoans` / `HousemaidPayroll`, `HousemaidComplaints` and `ManageTransactions`?
- Only if that account lacks them does the two-policy request above apply — and then it applies to
  *that* account, not to Hassan's.

## Not yet established

Whether `Visa_OverStayFinesMonitoring` is held by that broader account. No flow has ever successfully
called `/visa/overstay-fines/housemaid/*` — MV Overstay has no successful run at all, and CC Overstay
reached it for the first time on 2026-08-30 and was refused. So the fines route remains genuinely
unproven on *any* token, unlike the loans route.
