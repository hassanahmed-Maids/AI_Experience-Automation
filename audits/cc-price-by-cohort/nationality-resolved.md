# Nationality — diagnosis resolved, 2026-08-18

Supersedes the open questions in `nationality-blocker.md`.

The dynamic API was called successfully from a colleague's session (a teammate
who holds the grant; those reads are logged under their id). It returns
**HTTP 200, a bare array of flat objects**:

```
contractId · contractStatus · startDate · scheduledDateOfTermination
clientId · clientName · maidId · maidName · maidNationality · maidLiveOut
```

## What this proves

**1. The cohort key is inline.** `maidNationality` and `maidLiveOut` sit on every
row. Nationality costs **zero** extra calls once the caller has the grant —
strictly better than the filter-subtraction plan, which needed four full
population pulls to derive the same thing.

**2. The grant is per-user, not missing.** The identical request returns
`SecurityException` for Hassan.Ahmed and 200 for the teammate. So
`getactivecccontracts` *is* registered and *is* grantable.

This **corrects** the earlier reading of the ERP access-request error. *"No
secured resources found for SecurityPolicy 3128"* was taken to mean the dynamic
API had never been registered as a grantable resource. That reading was wrong —
it concerns attaching the resource to a new user under that policy, not the
resource's existence. The access request is a normal grant, not a registration
project.

**3. Stage 1 already parses these field names.** `Assemble Baton` reads
`maidLiveOut` / `startDate` / `maidNationality` / `clientId` as its dynamic-API
fallbacks alongside the search-route names. Swapping the population endpoint
needs no parsing changes.

## The ask, now evidenced

> `getactivecccontracts` returns 200 for a colleague who holds the grant and
> `SecurityException` for Hassan.Ahmed. Please mirror that grant — preferably
> onto a shared audit service account rather than an individual, so the audit
> trail names the audit function and no token needs re-pasting every few hours.

## PII: the payload carries names — keep dropping them

The response includes **`clientName`** and **`maidName`**. Neither is needed to
price a contract and neither may be stored or surfaced. The Cases table's
`client_name` column stays deliberately unpopulated, and any dynamic-API
population step must project to `contractId / clientId / maidNationality /
maidLiveOut / startDate` only, discarding both name fields at the first Code
node.

## What is NOT built yet, and deliberately so

The dynamic-API population path has **not** been added to Stage 1. It has never
been called from a session this pipeline can use, so its pagination behaviour is
unverified here:

- `context.page` / `context.size` semantics beyond a single `size: 2` call
- the documented 1..100 size bound
- the flattened-body trap, where `{page, size}` outside `context` silently
  returns page 0 size 20 with HTTP 200

Wiring an untested population source into a check whose entire discipline is
refusing to report unverified work would be inconsistent — and page-size
behaviour on the *other* route already turned out to silently drop 80% of the
population while returning 200 on every request.

When the grant lands, the change is small and testable in a single run:

1. Point Stage 1's population node at the dynamic API, keeping
   `contract/search/page` as the fallback source.
2. Confirm the paged total reconciles against ~5,395 through the existing
   population guard, which already turns a short read into a hard abort.
3. Flip `SOURCE` in Stage 2's `Resolve Nationality` from `unavailable` to
   `baton`.

Step 3 is a one-word change. Steps 1–2 are the part that needs a real run.

## Pagination — VERIFIED 2026-08-18

Probed from the granted session. All four questions answered:

| Test | Result |
|---|---|
| `context.size` = 20 / 100 / 500 | **honoured exactly** — 20, 100, 500 rows |
| `page0@100`[50] vs `page1@50`[0] | **both 1102962 — offsets align** |
| page 200 / 5000 | **`[]`** — clean loop terminator |
| `{page, size}` outside `context` | **20 rows when 100 was asked for — the trap is real** |

**Offset is genuinely `page × size` and no contract falls between pages.** This is
the property `contract/search/page` fails: there, pages advance by the requested
size while returning only 40 rows, silently skipping 80% of the population behind
a healthy HTTP 200. The dynamic API does not have that defect.

**`size` is honoured well past the 1..100 bound the notes claimed.** At 500 the
full population is **11 pages instead of 135**, taking Stage 1's pull from ~15
minutes to well under two. That removes the 2400 s execution ceiling as the
binding constraint on the population stage.

**The flattened-body trap is confirmed and must be guarded.** Asking for
`{"page":"0","size":"100"}` *outside* `context` returned 20 rows — the documented
silent fallback to page 0 size 20, with HTTP 200 throughout. Any population node
must nest inside `context` **and assert the returned row count equals the
requested size**, treating a mismatch as a short read rather than trusting the
status code.

### Consequences for the build

- Population becomes a single node at `size: 500`, terminating on the first empty
  array, with a per-page row-count assertion.
- The existing population guard still applies, but there is no `total` field on
  this route — completeness must be proven by the empty-page terminator plus the
  per-page count assertion, and cross-checked once against
  `contract/search/page`'s `total` (~5,395).
- Stage 2's chunking may become unnecessary for the population, though the
  per-contract enrichment still needs it *if* any per-contract calls remain.
  With `maidNationality` and `maidLiveOut` inline and the rate the only remaining
  per-contract read, that is worth re-costing before rebuilding.

## Expectation to set before that run

`includeNullNationality: true` on the search route returns **1,072 of 5,395**.
Whether nationality arrives via the dynamic API or anywhere else, roughly a fifth
of active CC contracts have no maid nationality recorded at all and remain
genuinely unpriceable. The check tops out near 80% conclusive, and Stage 3 will
correctly report the remainder as `pending / no_nationality` rather than
clearing them.
