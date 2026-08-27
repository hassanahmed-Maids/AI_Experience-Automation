# The two route swaps — 2026-08-27

**Swap 1 (MV Stage 2, payments ledger) is done. Swap 2 (MV Stage 1, contract search) is not,
and should not be done blind.** Reasons below.

First, the constraint that shaped both: **`.env` is absent in this session**, so
`scripts/ask-code.sh` cannot run. Secrets live only in `.env` and this is a fresh clone. That
means I could not verify either replacement route's real response shape against the ERP source
— the one thing `CLAUDE.md` calls the only source of truth. Everything below is built to be
safe *without* that confirmation.

---

## Swap 1 — DONE · MV Monthly Payment · 2-Score chunk

`POST /accounting/payments/page/advancesearch?page=0&size=1000` →
**`POST /accounting/payments/search`**, same filter body, same headers, pacing unchanged at
2 concurrent / 500 ms.

This is the route the ban document records as having taken Accounting ERP down once — the
2026-08-19 outage this flow's own pacing exists to survive.

### It could not be a URL edit, and the reason is interesting

The scorer reads the ledger **by node name**: `$('Read Payment Ledger').item.json`. And its
completeness guard reads a *page envelope*:

```js
rows2 = ledBody.content;  ledgerComplete = rows2.length === ledBody.totalElements
```

A bare list has neither field. Swapping only the URL would have made **every contract** fall to
gate `surface` as "ledger incomplete" — a run of nothing but pendings.

Editing that guard means rewriting the whole node, ~700 lines of parity-guarded core included —
the transcription risk we already refused once for D5/D6. So instead:

1. The HTTP node was **renamed** to `Fetch Payment Ledger (unpaged)`.
2. A new adapter node **took the name `Read Payment Ledger`**, so the scorer resolves to it.

That works because n8n's `renameNode` rewrites **connections** but leaves `$()` references
inside Code bodies alone. I did not assume that — I **tested it on the throwaway harness first**
(renamed a node, confirmed two Code nodes still referenced the old name, renamed it back).

**Score Contract Month was never written to.** Verified after: parameters still
`jsCode, mode, notes`; core still 554 lines, `sha 94f9b4c6`, byte-identical to the pre-swap core.

### Two things the adapter deliberately does

**Non-200 passes through untouched.** Chunk Summary's circuit breaker classifies the *raw body*
of this node to tell a dropped ERP session (`<LOGOUT>` / `UNAUTHENTICATED`) from a module outage
from a permission denial. Normalising an error into `{content: []}` would have blinded the
flow's most important safety mechanism.

**Both shapes are handled.** The ban document's own warning: *"a totalElements / totalPages /
content envelope in a live response means it is a page endpoint whatever it is called"* — a path
without `page` in it is necessary, not sufficient. If `payments/search` pages after all, the
envelope branch keeps its **own** `totalElements`, preserving the real truncation guard rather
than papering over a short read.

A 200 in an unrecognised shape leaves `totalElements` null on purpose → `ledgerComplete` false →
the case routes to a human. Never a silent pass.

### Verified

- No paginated route left anywhere in the flow.
- Chain: `Fan Out → Fetch Payment Ledger (unpaged) → Read Payment Ledger → Read Contract Details → Score → …`
- Scorer core byte-identical; scorer and breaker both still resolve `$('Read Payment Ledger')`.
- **10/10 adapter unit tests** (`tests/test-adapter.mjs`): bare list, empty list, consistent
  envelope, **truncated envelope still caught**, `{payments:[…]}`, unrecognised shape, 401
  `<LOGOUT>`, 500 malformed-token, plain 403, 503 — each judged by replaying the scorer's real
  guard and the breaker's real classifier.

### What is still unconfirmed, and how it fails

I could not confirm the route accepts the same body or that the role holds `payments,search`.
Both failure modes are **loud, not silent**: a permission gap gives 401/403 → the breaker throws
`ERP_ACCESS_DENIED` at 3; a rejected body gives a non-200 → every case becomes `surface` → the
40% surface-storm breaker throws. The most likely single point of failure is the `pagecode`
header, still `PaymentReport`; if the new route wants a different screen code it will 401 with
`PAGE_CODE_MISSING`, which the breaker's message already tells you how to read.

The flow is a **draft**, so this cannot reach production before someone runs it.

---

## Swap 2 — NOT DONE · MV Stage 1 / Stage 0 · contract search

It is not a swap. Three things make it a rebuild:

**1. Stage 1 uses the banned route as a COUNTER, not a lister.** `Count Cohorts` calls it with
`size=1` purely to read `totalElements`. None of the doc's three replacements is a count
endpoint — `getMVClientsBatch` is cursor/keyset, so counting means walking the whole thing. That
count feeds the ERP budget gate, the cohort plan, and D1's `inScopeTotal`.

**2. Stage 0 is an elaborate pager built around this exact endpoint's quirks.** From its own
code: *"Page 0 caps at 40 rows whatever size asks for … any S > 40 leaves a hole at 40..S-1"* —
so it runs a two-pass head/tail pager, pageSize 100, one request at a time, with a group-boundary
circuit breaker written after the 503 incident. The cursor replacement makes all of that
obsolete rather than adjustable. (Notably the doc says the cursor route has *"no page-0 cap and
no missing 40–49 hole"* — which is D1's disease.)

**3. The response shape is unverified and the projection is specific.** Stage 0 projects
`contractId, clientId, vip, vVip, startOfContract, dateOfTermination,
scheduledDateOfTermination, status` out of `body.clients.content[]`. Whether
`getMVClientsBatch` returns contracts in that shape — or clients keyed by family — I cannot
check without ask-the-code. The population also needs the *cancelled-in-scope* union, which is a
**second** replacement route (`getcontractscancellationinfo`).

Rebuilding a population sweep blind, against the module that has already been taken down once,
on a flow whose own sticky note says **"UNTESTED — do not run it until someone confirms
clientmgmt is healthy"**, is not a swap I should make on my own judgement.

### What would unblock it

- `.env` restored so `ask-code.sh` runs — then the response shapes of `getMVClientsBatch` and
  `getcontractscancellationinfo` can be read out of the ERP source, which is the standard this
  repo requires anyway.
- A decision on the count: keep a count endpoint, or change Stage 1's model so a cursor sweep
  reports its own total and the budget gate is costed differently.

With those two, it is a contained rebuild of Stage 0 plus `Count Cohorts` — and it would very
likely close D1 properly, since the page-0 hole is the same defect.
