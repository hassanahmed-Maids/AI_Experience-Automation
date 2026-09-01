# R-Visa Audit — questions for the low-code platform (ask-the-code)

Five surfaces the check needs and for which **no route is established**. Each is
the closing action a rule row already names as blocking.

**Status: submitted 2026-09-01**, all five accepted (HTTP 200), conversations
`45423`–`45427` via n8n execution `113004`.

⚠️ **PROVENANCE — read before trusting any answer below.** These were asked on a
token issued to **`Malaz.a`, not to the operator running the build.** Two
consequences, neither cosmetic:

1. **Every route LCP names is UNVERIFIED on the auditing account.** This check has
   already been burned by exactly this: the spec recorded test cases 1 and 3 as
   "confirmed against live ERP", that confirmation having been made on a different
   login, and `GET /accounting/transactions/{id}` turns out to be refused with
   `INSUFFICIENT_PERMISSIONS` on the operator's own account. An answer here says
   *the code has this route*; it does not say *we can call it*. Each route must be
   probed on the operator's token before any row of the spec is marked verified.
2. **Malaz is the spec's named independent reviewer** for this money-out check.
   Discovery on his credentials is tolerable — these are code-documentation
   questions, not client data, and they produce no findings. Running the CHECK on
   them would not be: it would make the reviewer an actor in the evidence he has
   to review independently. The audit's own ERP reads (population sweep, identity
   resolution, live testing) stay on the operator's token.

Earlier finding, kept because it explains why the token was needed at all: LCP
authenticates with the same ERP bearer, and the `ERP Hassan Prod` and
`Hassan Bearer` credentials both return HTTP 500
`Token not valid, {Token is expired}` against `/lowcode/c2d/session/…`.

**How to fire them:** n8n workflow `dXWzWtPZHO3CuRvx`
(*ZZ Ask LCP — R-Visa open questions*), which holds these questions verbatim.
POST `{"mode":"submit","erp_auth":{"bearer":"Bearer …","device":"…"}}`, keep the
returned `sessions` array, then POST `{"mode":"poll","sessions":[…]}` until the
answers come back. Two modes because an answer takes minutes and a Code node
making serial calls dies at ~60s.

**Each question is pinned to the module that plausibly owns the code.**
`docs/code-llm-api.md` records that an unpinned session has twice returned a
confident "doesn't exist" for code that did exist, and that a negative verdict is
only trustworthy from a pinned session. Do not accept a "not found" from these
without checking the pin.

---

### 1. Visa request / task history — pinned to `erp/magnamedia-visa-processing`
Blocks: ⓫ (the preferred duplicate discriminator), ❿

> For a given housemaid id, which endpoint returns her VISA REQUEST / task
> history — the record showing each visa request cycle with its start and end
> dates, and any marker such as "Fill Previous Visa Info" indicating a second
> visa cycle? Give the exact HTTP method, path, the pageCode header value it
> requires, and the response field names for the request start date, end date,
> and any cycle marker. If more than one route exists, say which returns ALL
> requests rather than only the latest one.

*Why the last sentence matters:* ⓫'s rule body records that the known route
returns **one** request, the latest, so a payment predating it cannot be assigned
to its own cycle. A route returning all cycles would upgrade ⓫ from a day-gap
proxy to the real test.

### 2. Cancellation type — pinned to `erp/magnamedia-visa-processing`
Blocks: ❿ — the **sole** clearance a duplicate payment has

> For a given housemaid id, how do we read whether her residence visa was
> CANCELLED, and what type of cancellation it was? The entity is believed to be
> CancelRequest. Give the exact HTTP method, path and pageCode for a
> PER-HOUSEMAID read (not a bulk /tasks listing), and the response field holding
> the cancellation type and its effective date. If only a bulk listing exists,
> say so explicitly.

*The per-housemaid constraint is not fussiness:* ❿'s rule body says explicitly
never to reach for `/visa/cancelRequest/tasks`, because that is the family of
bulk `/tasks` call that got the ERP account disabled in June 2026.

### 3. Rejection status and refund-request date — pinned to `erp/magnamedia-visa-processing`
Blocks: ⓬ and verifier ❸ — an entire sub-audit that currently never executes

> For a residence visa (R-visa) application that was REJECTED by the authority:
> which field records the rejection status, and which field records the date a
> REFUND was requested from the authority? Give the entity, the exact field
> names, and the HTTP method/path/pageCode that exposes them per housemaid. The
> analogous entry-visa fields are believed to be `entryVisaImmigrationApproved`,
> `refundedStatus` and `taskNameDate` — confirm whether R-visa uses the same
> fields or different ones, and do not assume they are shared.

*The last clause is load-bearing:* the entry-visa analogue is a different product
with a different counterparty, and the spec warns against respeccing the wrong
check by borrowing its mechanism.

### 4. Visa term and issued validity — pinned to `erp/magnamedia-visa-processing`
Blocks: ❻ — we hold one side of the comparison only

> Where is the VISA TERM stored — that is, whether a residence visa was bought as
> a 1-year or 2-year option — and where is the ISSUED VISA VALIDITY (the actual
> start and expiry dates of the issued residence visa)? Give the entity, field
> names, and the HTTP method/path/pageCode to read each per housemaid. Also state
> where the CONTRACTED visa term lives, if it is a different field from the
> purchased option.

### 5. Entry-visa expense heads — pinned to `erp/magnamedia-accounting` + visa
Blocks: ❼ and ❽ — the fine gates cannot clock a day count without an anchor

> Which accounting EXPENSE HEADS represent ENTRY VISA payments for housemaids (as
> opposed to residence/R-visa, MOHRE, or change of status)? List the exact
> `expense.name` strings and their `expense.id` values, for both CC and MV maids,
> and for both the pre-December-2025 generic immigration buckets and any
> dedicated heads created in the December 2025 taxonomy cutover. I need to filter
> transactions on these heads via `POST /accounting/transactions/page/advancesearchNew`.

*This one was added by the build, not by the spec.* ❼/❽ clock the 60-day grace
from the LAST entry-visa payment on or before the R-visa payment, and no
entry-visa expense head has ever been observed on a payload — so the flow ships
with the fine gates suppressed and the gap declared, rather than clocking from a
guessed anchor.

---

## What each answer unlocks

| Answer | Effect on the flow |
|---|---|
| 1 | ⓫ swaps its 30-day day-gap proxy for real visa-cycle membership. The measurement says the proxy is reding the *least* enriched band, so this is a precision fix, not a tidy-up. |
| 2 | ❿ becomes provable, and every duplicate red stops being provisional. |
| 3 | ⓬ becomes a deterministic gate and verifier ❸ shrinks to the residue; the run stops declaring a whole sub-audit unexecuted. |
| 4 | ❻ gets its second side and stops annotating every record `term-unverifiable`. |
| 5 | ❼ and ❽ switch on. Until then the check cannot produce a fine finding at all. |
