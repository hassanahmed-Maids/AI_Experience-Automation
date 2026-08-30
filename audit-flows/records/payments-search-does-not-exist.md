# The payments-ledger "replacement" route does not work — and one check is already on it

**Date:** 2026-08-30. **Probed live with a fresh token.**

## The finding

| Route | pageCode | Result |
|---|---|---|
| `POST /accounting/payments/page/advancesearch` — the current route | `PaymentReport` | **HTTP 200**, page envelope (`content` + `totalElements`) |
| `POST /accounting/payments/search` — the adopted replacement | `PaymentReport` | **401** · `developerMessage: API_NOT_FOUND_FOR_PAGE` |
| " | `ManageTransactions` | **401** · `API_NOT_FOUND_FOR_PAGE` |
| " | `ClientSummary` | **401** · `API_NOT_FOUND_FOR_PAGE` |

`API_NOT_FOUND_FOR_PAGE` means the pageCode resolves but the API is not on its whitelist. The
replacement is not reachable under any pageCode tried, including the one the flow that adopted it
actually sends.

## Consequence 1 — MV Monthly Payment Stage 2 is broken

`CopNHNsXUzFO59bW` node `Fetch Payment Ledger (unpaged)` calls
`POST /accounting/payments/search` with pageCode `PaymentReport`. That is the exact call probed
above, and it 401s. **Every payment-ledger read in that stage would fail.**

The swap was made on 2026-08-27 and its own record says why this was missed —
`records/route-swaps.md`, first paragraph, verbatim:

> *"`.env` is absent in this session, so `scripts/ask-code.sh` cannot run. […] That means I could
> not verify either replacement route's real response shape against the ERP source — the one thing
> `CLAUDE.md` calls the only source of truth. Everything below is built to be safe *without* that
> confirmation."*

The adapter it built is genuinely careful — it handles both a bare list and a page envelope, and
passes non-200 through untouched so the circuit breaker can still classify a refusal. None of that
helps: the route is never reached. **A design that is safe under every response shape is still
broken if the endpoint 401s.**

This adds a fifth blocker to MV Monthly Payment, and it is worth noting that the check was already
being held for four others.

## Consequence 2 — do NOT swap MV Overstay Fines to it

Every deploy draft in this batch, and my own recommendation earlier today, said a non-paging
replacement "exists and has already been adopted on MV Monthly Payment Stage 2", and recommended
swapping MV Overstay to it before production. **That recommendation was wrong and is withdrawn.**
MV Overstay keeps `POST /accounting/payments/page/advancesearch`, which is verified working.

## What this does not settle

Whether `/accounting/payments/search` exists at all under some pageCode nobody here holds, or
whether it was never a real route. That is a question for the code, not for more probing — and it
should be answered before anyone tries this swap again.

## The rule this earns

**A route swap is not done until the replacement has returned 200 on a live call.** Shape-tolerant
adapters, careful comments and a clean diff are not evidence the endpoint answers. The 2026-08-27
swap had all three and none of them caught a 401 that one request would have.
