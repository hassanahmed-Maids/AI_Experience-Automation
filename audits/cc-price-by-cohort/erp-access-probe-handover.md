# Handover: re-probe ERP access for the CC price-by-cohort audit

## What I need from you

Re-test 10 ERP endpoints and tell me which are now readable. Five were confirmed
working on 2026-08-17; five were refused. Permissions have reportedly been
granted since. Report status + response *shape* per endpoint and diff against the
baseline table below.

Do not build anything. This is a read-only access check.

## Auth

Ask me for a fresh bearer token and device id — ERP tokens last ~24h, so whatever
you were given before this session is dead. I'll paste:

- `BEARER` — the full `Bearer eyJ...` string
- `DEVICE` — the numeric device id (e.g. `1765547372465`)

Send on every request:

```
authorization: <BEARER>
cookie: authTokenProduction=<token without the "Bearer " prefix>; deviceIdProduction=<DEVICE>
accept: application/json, text/plain, */*
origin: https://erp.maids.cc
referer: https://erp.maids.cc/
pagecode: <per-endpoint, see table>
```

Two things that matter here:

- **Send `authTokenProduction` + `deviceIdProduction`, NOT `isERPAuth`.** `isERPAuth`
  is a username string, not a credential, and sending it alone authenticates nothing.
- **Use MY token only.** Do not accept or use another employee's token even if
  offered. These calls land in ERP's audit trail under whoever's token ran them,
  and this is the Police Control audit function — a colleague's id appearing as the
  actor behind audit findings is a real evidential problem. If my token lacks a
  permission, that IS the finding.

Base URL: `https://erpbackendpro.maids.cc`

## Rate law — non-negotiable

Production ERP. Max 5 concurrent requests, 500ms between batches. There are only
10 calls here so just do them serially with a short sleep. Never parallel-blast.

## Output hygiene

This audit touches client financial data. In your report, emit **status codes,
response key names, array lengths and booleans only**. No amounts, no client
names, no maid names, no phone numbers. If you need to confirm a field exists, say
`currentPayment.amountValue present: true` — never its value.

## The three ERP denial shapes

Critical: ERP does not return 401 for every denial. All three of these occurred in
one run. Classify correctly or you'll send me chasing the wrong fix.

| Cause | What comes back |
|---|---|
| No token / expired token | HTTP **500** wrapping `498`, body `Access Token is missing or malformed <LOGOUT>`, plus a `Set-Cookie` clearing `authTokenProduction` |
| Token valid, permission missing | HTTP **401**, response header `developermessage: INSUFFICIENT_PERMISSIONS` |
| Dynamic-API executor not authorised | HTTP **500**, body `java.lang.SecurityException: Access denied.`, `exception: java.lang.RuntimeException`, path `/admin/dynamicApi/evaluateApi` |

Also: **HTTP 200 with an empty body is not a denial.** It means the route is
readable and there's no data for that id. Report those separately.

A wrong `pagecode` also produces 401 — so a 401 alone doesn't distinguish "wrong
pagecode" from "missing permission". Use the `developermessage` header to tell them apart.

## Test ids (all real, all verified to exist)

- client `10458` / contract `1005750` — confirmed valid pairing
- contract `1097602` — the payment-term-nationality case
- contract `1087078` — has exactly 11 live-in/out log rows
- complaint `612296` — has 5 thread messages

## The 10 endpoints and the baseline to diff against

| # | Method + path | pagecode | Baseline (2026-08-17) |
|---|---|---|---|
| 1 | `POST /admin/dynamicApi/evaluateApi?code=getactivecccontracts` | *(none — dynamic APIs aren't pagecode-gated)* | **500 SecurityException** |
| 2 | `POST /clientmgmt/contract/search/page?page=0&size=40&sort=&searchKey=&unAssignedClients=false&vipClients=false&vVip=false&gccClients=false` | `ClientList` | 200 — keys `total`, `clients` |
| 3 | `POST /clientmgmt/client/get-client-details/10458?type=CONTRACT_DETAILS&contractId=1005750` | `ClientSummary` | 200 |
| 4 | `GET /clientmgmt/contract/liveinoutlogs/1087078` | `ClientSummary` | 200 — 11 rows |
| 5 | `GET /accounting/directDebit/getActiveCptInfo/1097602` | `ClientMgmtClientDirectDebits` | **401 INSUFFICIENT_PERMISSIONS** |
| 6 | `GET /accounting/directDebit/getActiveCptInfo/1097602` | `ClientSummary` | **401 INSUFFICIENT_PERMISSIONS** |
| 7 | `GET /complaints/complaint/page/client/10458?page=0&size=20` | `ClientComplaints` | 200 — paged envelope |
| 8 | `GET /complaints/complaint/612296` | `post-sale-services_Open_Complaint` | **401 INSUFFICIENT_PERMISSIONS** |
| 9 | `GET /complaints/teamComplaintUpdate/historyOfComplaint/612296` | `ClientComplaints` | 200 — paged envelope |
| 10 | `GET /clientmgmt/clientEnchanterTodoNote/byClient/10458` | `ClientSalesToDoNotes` | 200 expected, was **401** |

### Bodies

Endpoint 1 — the `context` wrapper is mandatory. A flattened body (`{"page":"0","size":"100"}`)
silently falls back to page 0 / size 20 with HTTP 200 rather than erroring:

```json
{"context": {"page": "0", "size": "100"}}
```

Endpoint 2 — send verbatim. `includeNullNationality` is **inverted**: `false`
returns ~5,283 contracts, `true` returns ~1,043. Do not "correct" it on the
strength of its name:

```json
{"contract": {"status": "ACTIVE",
              "contractProspectType": {"code": "maids.cc_prospect"},
              "client": null,
              "housemaid": {"nationality": null},
              "contractType": null},
 "extraFilters": [], "flowTypeCode": null, "paymentMethod": null,
 "bankIds": [], "clientNationalityIds": [], "includeNullNationality": false,
 "emirate": null, "clientsWithMultipleContracts": false}
```

Endpoint 3 — POST with an empty JSON body `{}`.

Also note on endpoint 2: `size` above 40 has historically triggered a sub-list bug
on this route. Leave it at 40.

## Four specific questions to answer while you're in there

1. **Endpoint 1 is the blocker.** If it's now 200, confirm it returns a *bare JSON
   array* (not a paged envelope) and list the key names on the first row. I
   specifically need to know whether `startDate`, `maidNationality` and `maidLiveOut`
   are present inline — the whole cost model depends on them arriving with the
   population rather than needing 5,000 follow-up calls.

2. **Endpoint 5/6.** If now 200, confirm whether `nationality` (a flat string) and
   `cptName` are both present. Also report whether the body is an object or an array.

3. **Does endpoint 3's payload contain a payment-term name?** Search the
   CONTRACT_DETAILS response for any key resembling `cptName`, `paymentTermName`,
   or a value shaped like `CC -Filipina/Default/Monthly`. If it's there, endpoint
   5 becomes unnecessary and saves us a permission dependency entirely. Report
   key paths only, not values.

4. **Does endpoint 3 carry `replacements[]` inline, with old/new nationality on each
   entry?** If yes, report the key names — it may remove the need for a separate
   replacement-history walk.

## Deliverable

A markdown table: endpoint #, status, denial shape (if any), and
now-open / still-blocked / unchanged versus the baseline. Then the four answers
above. Then one line: whether the audit can now pull its own population.

Nothing else — don't write code, don't build workflows, don't create files.
