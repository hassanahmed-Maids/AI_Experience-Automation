# Phase 2 — probe result

**Flow:** `Entry Visa Audit · 0-Probe (throwaway)` — `bnXWEJxfUsYnwhDD`, Adeeb project
**Date:** 2026-08-30
**Outcome: 0 of 23 calls readable. The operator's ERP account lacks the grants this check needs.**

This is a **finding to report, not an obstacle to route around**. No workaround was built,
and none should be.

> No credential was created or modified in n8n. The token and cookie arrived as a runtime
> payload and were used for those runs only. Neither is committed anywhere in this repo.

---

## The three runs, and what each one ruled out

| Run | Exec | Calls | Sent | Result |
|---|---|---|---|---|
| 1 | `110386` | 18 | bearer + device cookie, 5 pagecodes, 14 surfaces | all 401 |
| 2 | `110435` | 4 | 4 cookie shapes incl. **verbatim browser cookie** | all 401 |
| 3 | `110439` | 1 | **deliberately corrupted token** | 500, different error |

Each run was designed to kill one hypothesis, and each cost as little as possible — run 2
was controls-only precisely so a failure cost four calls instead of eighteen.

### Run 1 — it is a wall, not a per-surface gap

Every call: `HTTP 401`, `developermessage: INSUFFICIENT_PERMISSIONS`, body
`UNAUTHORIZED <LOGOUT>`.

**Five different pagecodes were refused identically** — `VisaProcessingPage`,
`ManageTransactions`, `AddEditTransaction`, `CancellationVisaProcessingPage`, and the
deliberately-wrong-pagecode control that exists to separate a grant gap from a routing
mistake. Not one call in eighteen succeeded. A per-surface gap would have split them.

The token had **7.3 hours of life left** (issued 10:42 UTC, expires 22:00 UTC, run at
14:42 UTC), so ordinary expiry was ruled out here.

### Run 2 — the cookie is not the problem

The operator then supplied the browser cookie, which revealed something useful straight
away: **`authTokenProduction` is byte-identical to the bearer JWT.** Run 1's control C had
therefore already sent exactly the right value for it and was still refused.

Four shapes were tried against one known-good request id, varying **only** the cookie:

| Cookie shape | Result |
|---|---|
| **verbatim browser cookie** (the exact bytes a working browser sends) | 401 |
| `isERPAuth` + `deviceIdProduction` + `authTokenProduction` | 401 |
| `isERPAuth` + `authTokenProduction` | 401 |
| `deviceIdProduction` + `authTokenProduction` (run 1's shape) | 401 |

The verbatim cookie being refused is the one that matters. If the exact bytes that work in
a browser are refused from n8n, no amount of reassembling the cookie will help.

### Run 3 — ERP is validating the token successfully

One call, with a deliberately corrupted signature:

```
corrupted token -> HTTP 500, body "Invalid token signature", NO developermessage header
real token      -> HTTP 401, body "UNAUTHORIZED <LOGOUT>",  developermessage: INSUFFICIENT_PERMISSIONS
```

**Two different responses.** ERP verifies the real token's signature, accepts the identity,
carries it past authentication, and refuses it at **authorization**. A token ERP cannot
verify never reaches that stage and never carries that header at all.

## Conclusion

The account behind this token — `Hassan.Ahmed` — is **authenticated fine and not
authorized** for the pagecodes this check reads. Not a dead session, not the cookie, not
the network, not a wrong pagecode.

**A fresh token will change nothing.** What is needed is a grant, from whoever administers
ERP permissions:

| pagecode | needed for |
|---|---|
| `VisaProcessingPage` | the core surface — gates 1, 3, 5, 6, 7, 8. Without it there is no check at all. |
| `AddEditTransaction` | `transaction_date`, the only usable clock — gates 6 and 9, and identity for gate 2 |
| `CancellationVisaProcessingPage` | gate 4's cancel-side refunds. Without it, 243 refunded cases become false findings. |
| `ManageTransactions` | the independent count for the Phase 7 population proof |

### This is the failure the process warns about, happening

The skill's Phase 1 says it in as many words:

> Permissions tested on a borrowed token get recorded as working and stay recorded. This is
> an observed failure, not a hypothetical: a route documented as verified turned out to be
> refused on the auditing account, because the original check had been made on a different
> login.

That is exactly what has happened. Several ERP Variables rows are marked
**`LIVE ERP READ, 2026-08-20`** with verbatim payload snippets — `entry_visa_rejection_date`
and `visa_expense_status` are both `Confirmed` / `Verified` on that basis. Those reads were
made on a **different login**, and the same routes are refused on the account that would
actually run this check.

**Recommended edit to the ERP Variables rows:** record *which account* a live read was made
on. A row that says "verified" without saying "verified by whom" cannot be trusted by the
next person, and this check just spent 23 production calls discovering that.

---

## Two traps worth adding to the traps file

### 1. ERP inverts the intuitive status mapping

```
BAD / MALFORMED TOKEN  -> HTTP 500  "Invalid token signature"   (no developermessage)
GOOD TOKEN, NO GRANT   -> HTTP 401  "UNAUTHORIZED <LOGOUT>"      developermessage: INSUFFICIENT_PERMISSIONS
```

Both readings fail dangerously if taken at face value:

- A classifier treating **5xx as "server trouble, retry"** will **retry a bad token
  forever**, hammering production for something that cannot heal.
- A classifier treating **401 as "session expired, fetch a new token"** sends the operator
  **chasing tokens when they need a grant** — which no amount of re-authenticating produces.

The `INSUFFICIENT_PERMISSIONS` header is also weaker evidence than it looks on its own: it
appears on a plain 401 too. What makes it *mean* "missing grant" is the **contrast** with
the corrupted-token control. One call establishes it, and it is worth building into every
future probe.

### 2. n8n does not reliably surface the response body under `body`

Two separate bugs came from this, and both are false-clearance shapes.

**First:** `responseFormat: 'json'` against ERP's **HTML** 401 page made the parse fail, so
every item reached the classifier stripped of status, headers *and* body — reporting
`status: null, denial_shape: null` on all 18 rows while a fully diagnosable 401 sat in the
response. Fixed to `autodetect`.

**Second, and subtler:** even on `autodetect`, `statusCode` and `headers` came through while
`body` did **not**. Every body-based test was therefore silently evaluating against an empty
string — which is why run 2 classified as `INSUFFICIENT_PERMISSIONS` (from the header) when
the body plainly said `UNAUTHORIZED <LOGOUT>`. Fixed with a `readBody()` that tries
`body`, `data`, `response`, `error.body`, `error.message`, `message` in order and
**reports which key produced it** on every row, so the next silent change is visible.

Both matter beyond this probe: **a run that cannot read a refusal cannot distinguish
"refused" from "returned nothing"** — and "returned nothing" is one careless step from
"no findings".

---

## What is still unknown

Every question Phase 2 exists to answer. The probe is built, hardened by three rounds of
real refusals, and will answer all of them in a single ~18-call run the moment the grants
exist:

- **Does `GET /visa/newRequest/{id}` expose `transactionId` on its `expenses[]` rows?**
  This decides the flow's architecture. If not, there is no ERP clock and gate 1's own
  population filter cannot be evaluated from ERP at all. See `SPEC-CORRECTIONS.md` §3.
- Is there any id-scoped route for the cancel-side mapping, or is it warehouse-only?
- Does the wrong-pagecode control return `API_NOT_FOUND_FOR_PAGE`, making future 401s
  self-diagnosing?
- What does `getVisaProcessingInfoByHousemaid` actually return — no value has ever been
  observed from it.

## ERP load spent

23 calls total, all read-only, paced 1 in flight / 2000 ms. No run was retried: the
golden's circuit-breaker rule is that a total refusal cannot heal between call 1 and call N,
so re-firing is load on production for zero information. Each round was sized to the
question it was answering — 18, then 4, then 1.
