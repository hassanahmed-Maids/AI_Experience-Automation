# Testing the Change of Status Audit on staging

Written 2026-09-01. Answers "how can we test everything on staging?" — what
staging actually is, which tier is usable, what a staging run can and cannot
prove, and the exact things a human has to unblock first.

Everything below was probed or read out of the code today. Nothing was run
against production ERP.

---

## 1. There is no single "staging" — there are five tiers

The tier list is not guesswork: the `apiBase` constants live in
`cc-erp-services/projects/cc-erp-services/src/lib/enviroment/default-enviroments.ts`
and are mirrored in every frontend's `environment.<tier>.ts`. Confirmed via
ask-the-code (conversation 45465), and cross-checked by reading the deployed
staging bundle at `https://staging.maids.cc/main.db3ca4585b5eb6ca.js` directly.

GitLab CI stages the same five: `DEV → TZ → STG1 → STG2 → PROD`.

| Tier | Backend base | Probed 2026-09-01 | Usable? |
|---|---|---|---|
| DEV | `https://devbackerp.teljoy.io` | ERP auth envelope (`498`) | alive |
| TZ | `https://testbackerp.teljoy.io` | ERP auth envelope (`401`) | **alive** |
| TZ (k8s) | `https://tfback.teljoy.io` | ERP auth envelope (`401`) | alive |
| **STG1** | `https://backstaging.maids.cc:9443` | `awselb/2.0` **503** on every ERP route | **DOWN** |
| **STG2** | `https://stagingiibackerp.maids.cc` | ERP auth envelope (`498`/`500`) | **alive — use this** |
| PROD | `https://erpbackendpro.maids.cc` | — | production |

### The trap: "staging" usually means STG1, and STG1 is down

`https://staging.maids.cc` (the staging frontend people log into) compiles
`apiBase: "https://backstaging.maids.cc:9443"` — that is STG1. Probed from two
different networks, every ERP route there returns **503 from the load balancer
itself**, while unmapped paths return 403. That pattern — listener rules
matching, nothing healthy behind them — means the application is not running.
No ERP response was ever produced, only the load balancer's.

Nothing in the repos explains why. Ask-the-code (conversation 45461) found the
GitLab CI only ever `mvn install`s and copies a `.war` to a shared path; every
staging job is `when: manual`, and the scripts that actually start or scale a
server live outside the repos in `/shared_resources/deployment_scripts`. So STG1
being down is a deployment fact someone has to fix, not a config we can read.

**So: test on STG2.** It answers on every surface the check touches.

## 2. What a staging run is actually FOR

Not a second opinion on the numbers — a staging run cannot produce business
facts, because it reads staging data. It exists to settle the one thing
production refuses to tell us.

Four surfaces return `401 INSUFFICIENT_PERMISSIONS` on the auditing account in
production, which is why this is currently a duplicate check (7 of 21 rules)
rather than a fine-recovery check, and why Orders 30–150 are NOT PASSED.
Ask-the-code (conversation 45462) established how that denial is actually
produced, and it changes what we should ask for:

- **The `@PreAuthorize` strings are a red herring.** `PermissionEvaluatorImpl.hasPermission`
  returns `true` unconditionally (the real check is commented out), and
  `CurrentRequest.checkPermission` short-circuits once `AuthorizeFilter` has run.
  The effective gate is `AuthorizeFilter → ApiAuthorizationService.checkAuthorization`:
  **pageCode header → `Api` row on that page → the user's FULL/READONLY grant.**
- Therefore a `401 INSUFFICIENT_PERMISSIONS` means *either* a missing grant *or*
  the wrong `pageCode` — the two are indistinguishable from outside, which is the
  trap already recorded in `00-build-log.md`.

The pageCodes that actually register each surface, from the `security-*.json`
registries:

| Surface | pageCode(s) that register it | Grant to request |
|---|---|---|
| `GET /visa/overstay-fines/housemaid/{id}` | `Visa_OverStayFinesMonitoring`, `HousemaidOverstayFines` | `<pageCode>_FULL` |
| `GET /visa/newRequest/{id}` | the visa page carrying `/visa/.*` (`VisaProcessingForm`) | `<pageCode>_FULL` |
| `GET /payroll/loans/getHousemaidLoans/{id}` | `HousemaidsPayrollLoans`, `HousemaidsPayrollList`, `HousemaidPayroll` | `<pageCode>_FULL` |

### One of the four "refused" surfaces is probably not refused at all

`GET /visa/visaRequestExpenses/newRequest/{newRequestId}` **does not exist in the
codebase.** Ask-the-code searched all repos case-insensitively and found no
controller mapping it. The nearest real route is
`magnamedia-accounting`'s `VisaRequestExpenseController` at base
`/visarequestexpense` (all lowercase, mounted under `/accounting/...`).

So that 401 was most likely a **wrong path**, not a denied permission — a
no-matching-`Api` denial reads identically. This needs re-probing against the
real path before it is reported as a missing grant. It is filed as a correction
to `01-surface-probe.md`.

## 3. Is a staging run safe?

Yes for this check, and the reasons are specific rather than general.

- **The population call is provably read-only.** `TransactionsController.advanceSearch`
  builds a `SelectQuery`, applies filters, aggregates and returns a page. No
  `save`/`persist`/`update`/`delete`, no `@Transactional`, no audit-log row, no
  event emission. Confirmed from the controller and service implementation.
- **Outbound side effects are suppressed on staging.** The environment is decided
  at runtime from the DB core parameter `Server` (`isStagingServer()` = `staging`
  or `staging-ii`), not a Spring profile. On staging, `TestingEnvironmentMessageFilter`
  rewrites every WhatsApp recipient to `WHATSAPP_TEST_NUMBER` and drops the
  message entirely if that is empty; `StagingEnvironmentValidator` drops or
  redirects SMS, and both SMS providers stub outbound when `!isProduction()`.
- **Ledger writes are NOT environment-guarded** — transaction creation runs the
  same on staging. Irrelevant to us (this check only reads) but worth knowing
  before anyone points a *writing* flow at staging.

The real hazard is not ERP, it is **delivery**: the workbook, the Gmail draft and
the n8n Data Tables are shared with production. That is now handled in the flow
(§4), not left to whoever runs it.

## 4. The flow can now be pointed at a tier — safely

`params.erp_env` selects the backend, resolved through a **closed allowlist** in
`Validate Inputs`. It is an allowlist and not a URL field on purpose: the run
bearer is interpolated into the `Authorization` header of every ERP node, so the
host that receives it is a security decision. A raw hostname is refused with the
same reasoning that guards `callback_url`.

Accepted values: `production` (default), `staging` (STG1), `staging2`, `tz`.

Two safeguards ride along, so a rehearsal cannot be mistaken for a real audit:

- the run id is **prefixed with the tier** (`staging2-<run_id>`) in the shared Runs log;
- delivery **defaults off** for any non-production tier — pass `workbook_id`
  explicitly to send a rehearsal somewhere deliberate.

All four ERP nodes now read the resolved base; the offline suite asserts none of
them still carries a hard-coded production host. **51 assertions, 0 failures**
(`fixtures/run-nodes-offline.js`), including the allowlist refusals.

### The run payload

```json
{
  "check_id": "change-of-status",
  "run_id": "stg2-rehearsal-01",
  "audit_window": { "kind": "month", "year": 2026, "month": 7 },
  "params": {
    "erp_env": "staging2",
    "erp_auth": { "bearer": "Bearer <a fresh STG2 token>" }
  }
}
```

## 5. What has to be unblocked first — none of it is code

1. **A STG2 login for the auditing account, and a fresh token.** The stored n8n
   credential `erp_staging2_n8n_token` is **expired** — probed today, all six
   surfaces returned `Token not valid, {Token is expired}`. That probe is also
   the proof STG2 is alive: the ERP's own auth layer answered every call,
   including the population `POST`.
2. **Grants on STG2** for the page policies in the §2 table. This is the whole
   point of the exercise — with them, the duplicate rule can run at request grain
   and Orders 30–150 become testable.
3. **Confirm STG2 carries Change-of-Status charges at volume.** The check has a
   cohort floor of 250 and aborts below it. One call settles this once a token
   exists: `POST /accounting/transactions/page/advancesearch?size=1` on heads
   `[1677, 1589]` and read `totalElements`.
4. **Confirm STG2's database is separate from production's.** Not answerable from
   code — every datasource URL lives in `application-*.properties`, which
   ask-the-code is not permitted to read. It is a deployment fact somebody has to
   state. Until they do, treat staging data as potentially production data.
5. **Re-probe the real `visarequestexpense` path** (§2) before reporting it as a
   missing permission.

Items 1–2 are for whoever administers ERP access; 3 is one call; 4 is a question
for whoever deploys.

## 6. What a staging run can and cannot prove

**Can:** the auth and pageCode shape end to end; whether the four surfaces open
with the right grants; pagination and the `collected == totalElements`
reconciliation at real volume; the ERP budget gate against real page counts; the
cooperative lease; the failure path; token-expiry handling (the `500`-carrying-an-
expiry-message shape, seen again today on STG2).

**Cannot:** any business result. Staging data is not production data, so the
production run's `1 finding · 105 pending · 598 clean` will not reproduce, and
should not be expected to. It also cannot validate delivery into the real
workbook — deliberately, per §4.

**Consequence for go-live:** a green staging run is evidence the *mechanics* are
sound. The spec's `Test cases verified` gate still needs a production run on the
current build, because the spec's test cases are production records.

## 7. Reusable probe

`ZZ Probe ERP STG2 tier (throwaway)` — n8n `OB2rW4uQNc426n4a`, Adeeb project.
Read-only; reports status codes and denial reasons only, never response bodies.
Re-run it the moment a fresh STG2 token exists: it answers items 1, 2 and 3 in
one execution. Attach a valid credential to its `Probe Host` node first.
