# Question 1 — is there a BULK route carrying the contract monthly rate?

Written 2026-08-18 for fix item 2 of VALIDATION.md §15. Not yet asked: the ERP token
expired at 22:00 UTC before it could be submitted (see docs/code-llm-api.md on the fixed
daily expiry).

Pin to: `erp/magnamedia-client-management,erp/magnamedia-accounting,erp/magnamedia-reporting`
— pinning matters because the guide warns a session can silently not see a module and
return a confident false negative.

Run it with:

```bash
# ERP_AUTH_TOKEN comes from the environment at call time; .env carries no secret.
export ERP_AUTH_TOKEN="Bearer <fresh token>"
./scripts/ask-code.sh "$(cat audit-flows/cc-below-agreed/askcode/q-bulk-contract-rate.md | sed -n "/^---$/,\$p" | tail -n +2)" \
  "erp/magnamedia-client-management,erp/magnamedia-accounting,erp/magnamedia-reporting"
```

---

I need to know whether the ERP can return a CONTRACT'S AGREED MONTHLY PAYMENT AMOUNT for MANY contracts in one call, instead of one call per contract.

Context (measured live today, so please correct me from the code if any of it is wrong):
- POST /clientmgmt/client/get-client-details/{clientId}?type=CONTRACT_DETAILS&contractId={contractId} (pagecode ClientSummary) returns a payload containing `currentPayment`. It is ONE contract per call.
- POST /clientmgmt/contract/search/page (pagecode ClientList) returns 40 contracts per page and its row DTO appears to contain: client, clientComplaints, clientReplacments, contractProspectType, dateOfTermination, deletedFromApp, housemaid, id, liveOut, longTermPackage, maidComplaints, scheduledDateOfTermination, startOfContract, status, visaRenewalDeclined, workerSalaryMonthlyTip. I see no client-facing monthly fee in that list.

Please answer these, grounding EVERY claim in code with class name + line numbers, and quoting the DTO/entity field declarations:

1. Which JPA entity and column store the client contract's agreed monthly payment (the amount `currentPayment` is derived from)? Show how `currentPayment` is computed in the get-client-details CONTRACT_DETAILS path - is it a stored column, the latest payment row, a plan/package amount, or computed?

2. List EVERY controller endpoint whose response includes that monthly amount for a LIST or PAGE of contracts (more than one contract per call). For each: HTTP method, full path, the pagecode/permission it requires, the request DTO, and the exact response field name carrying the amount.

3. Quote the DTO actually returned by POST /clientmgmt/contract/search/page. Does it carry the monthly payment, or can it be made to - via a projection, `extraFilters`, or a query parameter that widens the selected columns?

4. Is there a REPORTING module endpoint or a low-code dynamic API that already exposes contract id + monthly payment in bulk (paged or CSV/export)? If so name it and its permission.

5. If nothing bulk exists today, name the exact repository/query method that would need to be added, and say whether a low-code dynamic API could expose it without a Java change.

If you cannot find something, say so explicitly rather than inferring. A wrong "it does not exist" is more expensive to me than "I could not find it in the modules I can see" - so tell me which modules this session can actually see.
