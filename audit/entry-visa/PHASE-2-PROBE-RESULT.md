# Phase 2 — probe result, run 1

**Flow:** `Entry Visa Audit · 0-Probe (throwaway)` — `bnXWEJxfUsYnwhDD`, Adeeb project
**Execution:** `110386`, 2026-08-30 14:41:48 → 14:42:24 UTC, status `success`
**Probes:** 18, read-only GET, 1 in flight / 2000 ms
**Result: 0 readable. Every call refused.**

> `success` here means the workflow did not crash. It did not mean the probe worked —
> which is the whole reason the classifier reports a verdict separately from the status.

---

## What ERP returned

Identical on all 18 calls:

```
HTTP 401
developermessage: INSUFFICIENT_PERMISSIONS
body: <html> … type=Unauthorized, status=401 … UNAUTHORIZED <LOGOUT> </html>
```

## This is a wall, not a per-surface gap

The distinction decides who gets asked for what, so it is worth being explicit.

**Five different pagecodes were refused identically** — `VisaProcessingPage`,
`ManageTransactions`, `AddEditTransaction`, `CancellationVisaProcessingPage`, and the
deliberately-wrong-pagecode control. **Not one call in eighteen succeeded.**

A genuine permission gap is per-grant: the account would hold some pagecodes and not
others, and the wrong-pagecode control would have come back differently from the rest. It
did not. When every pagecode fails, the token is not being accepted as a session at all.

The `developermessage` header saying `INSUFFICIENT_PERMISSIONS` is therefore misleading
here — it is what ERP emits for an unauthenticated caller as much as for an
under-privileged one. The `UNAUTHORIZED <LOGOUT>` marker in the body is the more specific
signal, and it means *no valid session*, not *insufficient rights*.

**The token had not expired by time.** Issued 10:42 UTC, expires 22:00 UTC, run at
14:42 UTC — 7.3 hours of life left. So this is not the ordinary expiry case.

## The three auth-shape controls did their job

They ran first precisely so this would be answerable, and each varied **only the cookie**
against the same known-good request id:

| Control | Cookie sent | Result |
|---|---|---|
| A | none — `authorization` header alone | refused |
| B | `deviceIdProduction` only | refused |
| C | `deviceIdProduction` + `authTokenProduction` | refused |

Control C is the golden flow's exact shape — **except** that no separate
`authTokenProduction` value was supplied for this run, so the raw JWT was substituted for
it. That substitution was flagged as a guess when the probe was written, and it is now the
single most likely cause of the wall.

## Most likely cause, and the one thing needed to settle it

ERP's session is carried by **`authTokenProduction`**, and that is a *different value* from
the bearer JWT. The golden sibling flow (`YQlNlxrnhbQpBbdl`) sends all three parts:

```
authorization: <bearer token>
pagecode:      <per call>
cookie:        deviceIdProduction=<device id>; authTokenProduction=<separate session token>
```

Two of the three were available for this run. The third was guessed. **The real
`authTokenProduction` value is what is needed** — nothing else about the probe changes.

## Deliberately not retried

The golden's own circuit-breaker guidance is explicit, and it is followed here:

> none of the three causes can change between call 1 and call N — the token, the pagecode
> and the grant are all fixed for the whole run — so every remaining call is load on
> production ERP for exactly zero information. DO NOT re-fire this run and DO NOT retry: a
> refusal that is total does not heal, and a retry doubles it.

18 calls were spent establishing this. No further ERP call will be made until the missing
value arrives, which makes the next attempt a *new run* rather than a retry.

---

## Bug found and fixed in the probe itself

`Probe ERP` was configured `responseFormat: 'json'`. ERP returns its 401 as an **HTML**
whitelabel page, so the JSON parse failed and every item reached the classifier without a
`statusCode`, `headers` or `body`. The report therefore said `status: null` and
`denial_shape: null` on all 18 rows — while the underlying refusal was a clean, fully
diagnosable 401 whose `developermessage` header was sitting right there.

**In production this is a false-clearance shape**, not a cosmetic one: a run that cannot
read a refusal cannot distinguish "refused" from "returned nothing", and "returned
nothing" is one careless step from "no findings".

Fixed to `autodetect` — JSON stays parsed for healthy responses, HTML comes through as
text, and the classifier can see both. The diagnosis above was recovered from n8n's
`contextData`, which retained the last raw response.

---

## What this does not tell us

Nothing about the surfaces themselves. **Every question Phase 2 exists to answer is still
open**, including the one that decides the flow's architecture:

- Does `GET /visa/newRequest/{id}` expose `transactionId` on its embedded `expenses[]`
  rows? If not, there is no ERP clock, and gate 1's own population filter cannot be
  evaluated from ERP at all. See `SPEC-CORRECTIONS.md` §3.
- Is there any id-scoped route for the cancel-side mapping, or is it warehouse-only?
- Does the wrong-pagecode control produce `API_NOT_FOUND_FOR_PAGE`, so a later 401 is
  diagnosable?
- What does `getVisaProcessingInfoByHousemaid` return — no value has ever been observed
  from it.

The probe is built, corrected and ready. It is one value away from answering all of them.
