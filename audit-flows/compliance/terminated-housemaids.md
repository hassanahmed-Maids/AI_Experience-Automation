# ERP load compliance — Terminated Housemaid Tickets

Audited 2026-08-23 against `../ERP-LOAD-POLICY.md`. Two flows, **both were untagged** and are
tagged `audit: Terminated HM` as of this audit. Neither is live. Verdicts are
`tools/erp_compliance.py`, not reading.

| flow | id | live | verdict |
|---|---|---|---|
| 0-Fetch Profiles (sub-workflow) | `dhkfRbuaGv8MXzSG` | no | **FAIL** — 3 findings |
| 1-Score (parent, webhook entry point) | `sXsn4NUYt4kh3OAU` | no | **FAIL** — 9 findings |

Both flows were invisible to every coverage sweep in this project, because those sweeps work off
the `audit: *` tags. Unlike the legacy Real Ticket flow, neither of these is active, so the cost
of the omission here was a gap in the record rather than exposure.

## 1-Score — the parent

**§1.** `Get FT29 Transactions` is the paginated population sweep with **no `requestInterval` and
no timeout** — pages fire back to back and a hung call holds its slot indefinitely.
`Get Transaction Detail` and `Get All-Time Reversals` both run 5 in flight / 500 ms = 10 req/s,
over the 2-in-flight cap.

**§3** no pre-flight budget gate, two per-item ERP nodes.

**§5** no circuit breaker in `Verify Population`, `Build Error Payload`, `Resolve Maids` or
`Score Cases` — the four nodes that each read a full ERP batch.

**§4** no ERP lease, and it is a webhook entry point that reaches ERP. It is not live, so it is
not currently part of the broken-mutex problem described in `applicant-real-ticket.md` — but it
would join it the moment it is activated. Fix the lease **before** activation, not after.

## 0-Fetch Profiles — the sub-workflow

**§1** `Get Housemaid Info` at 5 in flight / 500 ms.
**§3** no budget gate, one per-item ERP node, and the caller has none either.
**§5** no breaker in `Project Profiles`.
**§4** relies on the caller holding the lease without declaring it — and the caller holds none.

Same shape as `Dummy Tickets Housemaids · 0-Fetch Tickets`, down to the numbers. These two
sub-workflows were clearly built from the same template, so they should be fixed together and
with the same edit, or the next audit will find one fixed and one not.

## What is good here, and worth keeping

`Project Profiles` carries the clearest statement of the `neverError` trap anywhere in the
codebase — that `retryOnFail` only fires because `neverError` is **off**, and that setting it
true would silence the throw and make the retry rule silently unimplemented. It also uses
`responseFormat: autodetect` on purpose, because ERP's error page is HTML and under `json` the
node emits a parse-error item with **no `statusCode` at all**, making a dead token
indistinguishable from an unclassifiable anomaly. Neither of those is a load-policy matter, and
both are the kind of hard-won detail that gets deleted by someone tidying up. They belong in the
skill playbook, not only in one node's comment.

## Fix order

Identical to Dummy Tickets, and should be done in the same pass:

1. `Get FT29 Transactions` — `requestInterval` + timeout.
2. All three per-item nodes to 2 / 500.
3. Lease on `1-Score` **before it is ever activated**; `lease-held-by-caller` declaration in
   `0-Fetch Profiles`.
4. Budget gate in `1-Score`; `budget-gate-in-caller` in `0-Fetch Profiles`.
5. Generated breakers.
