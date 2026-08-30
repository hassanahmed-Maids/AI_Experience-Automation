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

**2. `HousemaidsPayrollLoans`** — reaches route 2. Note this one is **not** read-only: its whitelist
carries `POST /payroll/loans/`, `POST /payroll/loans/waiveLoanAmount/`, `POST /payroll/Repayment/`
and `Delete /payroll/*/customdelete/`. Route 2 is also the only one of the four with method-level
security on top of the pageCode check —
`@PreAuthorize("hasPermission('loans','getHousemaidLoans')")`, `LoansController.java:324` — so the
grant must carry that permission too, not just the page. If a read-only payroll page exists that
whitelists `GET /payroll/loans/getHousemaidLoans/`, it is the better ask; `HousemaidsPayrollList`,
`HousemaidPayroll` and `ResignedMaidsToDo` also match and were not individually inspected for write
scope. **Worth one more question to the code before requesting.**

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

## Next

1. Request **`Visa_OverStayFinesMonitoring`** read-only.
2. Ask the code for the tightest read-only page reaching route 2 before requesting a payroll grant.
3. Re-run CC Overstay once granted; the verifier band (routes 3 and 4) is already reachable.
