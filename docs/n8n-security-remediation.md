# n8n security remediation — SA-* tickets

Written 2026-08-26. Supersedes the overnight note of 2026-08-25
(`audit-flows/SECURITY-STATUS.md` on branch `claude/cc-payments-audit-testing-fgdwdm`),
which was written against a different plan.

**What changed between the two.** The overnight work tried to *guard* the Security Room
webhooks: a shared secret, a callback-URL allowlist, CRLF shape checks. All of that is now
deleted, because Hassan retired the portal. The flows no longer take a request at all, so
the findings lose their mechanism instead of gaining a defence. Deleting the guards also
removed the live rotating shared secret, which had been spread across thirteen flows.

Deadline for the tickets was **Thursday 27 August**.

---

## 1. Ticket status

| Ticket | Sev | Where | Status |
|---|---|---|---|
| SA-97 | Critical | Housemaid Payroll | **Mechanism closed.** Two residual UI actions — see §4.1 |
| SA-101 | High | Payroll, Client Refunds | **Closed** — no endpoint, no caller-supplied callback |
| SA-105 | High | Payroll, Client Refunds, SDR Fee, SDR Audit, ZZ Contract Test, Travel Assist | **Closed on all six** |
| SA-109 | High | Daily Household Expenses | **Was already closed** — see §3.2 |
| SA-116 | High | SDR Agentic Judge | **Closed** — no HTTP endpoint at all |
| SA-124 | Medium | DIAGNOSTIC ERP auth probe | **Archived + stripped.** History purge is UI — §4.2 |
| SA-129 | Medium | SDR Fee, Travel Assist | **Closed** — nothing left to fail open on |
| SA-142 | Medium | Payroll, SDR Fee, Travel Assist, ZZ Contract Test | **Closed in n8n.** New instance of the same *ownership* problem found — §4.3 |
| SA-322 | Medium | Daily Household Expenses | **Answered:** recipient is intentional (Hassan, 2026-08-26) |
| SA-146 | Medium | tenant-level | Security team's — not ours |

---

## 2. The new shape

Every Security Room audit now looks like this. `Travel Assist Payments Audit`
(`LM7ofq89VWXiLRU0`) was already built this way and is the reference.

```
Monthly Schedule ──▶ Run Config ──▶ Validate Inputs ──▶ ERP reads ──▶ checks
   (no webhook)      (derives the      (no callback_url,   (credential
                      audited month)    no erp_token)       store)
                                                              │
                                       results sheet ◀────────┴───▶ e-mail
                                    (audit-sheet-standard.md)      (notification)
```

Four things carry the security properties:

1. **No inbound endpoint.** Nothing to find, trigger, or authenticate. This is what
   actually closes SA-101, SA-116 and SA-129 — not a better check.
2. **No credential in a request.** ERP auth is the `ERP Hassan Prod` custom-auth
   credential (`egREvHnZfspVnrza`), which n8n stores encrypted and never writes to
   execution data. That is SA-105, and the half of SA-97 about live session fields.
3. **No egress to a caller-named host.** Delivery is a Google Sheet plus a maids.cc
   mailbox. That is SA-142 — with a caveat in §4.3.
4. **Loud failure.** Every `Callback — Error` node is replaced by `Fail The Run`
   (`stopAndError`) or a failure e-mail. The old design POSTed failures to the
   caller-supplied URL, so a run broken by a bad caller was reported *only to that
   caller*.

Per-flow schedules are staggered (5th, 6th, 7th) so the audits do not contend for the
single ERP lease.

---

## 3. Done — deployed and verified

### 3.1 The four open endpoints are deregistered

`zwSxrV00VE4rOSvd` (Payroll), `NIUelKhaMucLLSqK` (Client Refunds), `N3OWVknR68JImzvl`
(SDR Fee) and `5juo1j8x7gcVQVK5` (SDR Judge) were **unpublished** before any rebuild
started, so the exposure closed immediately rather than at the end of the work.

All four had **zero retained executions** at that moment. That is not proof of zero
traffic — retention is off (`saveDataSuccessExecution: none`), so a request would leave
no trace. It is consistent with the overnight finding that the portal never called any
of them.

The webhook, respond and callback **nodes are now deleted**, not just inactive. An
unpublished flow can be republished by accident; a flow with no webhook node cannot.

### 3.2 SA-109 was already fixed, and SA-105 on the SDR audit was not

Two findings turned out differently from the ticket text:

- **SA-109** cites a live API key as a literal `X-API-Key` header on a **Render PDF**
  node in `Daily - Household Expenses`. That node no longer exists. Every node
  parameter, header value and code body in the workflow was scanned: **no literal key
  of any kind.** `Summarize (LiteLLM)` uses the `Langcc` bearer credential, QuickBooks
  uses a predefined credential. Nothing to fix in n8n — but the key named in the ticket
  should still be rotated at the provider if that was never done.

- **SA-105 on `RTCQUXJ2Iss6IVwW` (SDR Audit - Consolidated) was worse than the ticket
  says, and in a place a draft-only scan cannot see.** The **live** version `a8cea538`
  carried **Malaz's signed ERP JWT as a literal `authorization` header on all eight
  `Fetch * (ERP)` nodes**, plus a `cookie` header carrying his ERP identity and device id. The `ERP Hassan Prod` credential *was* attached to
  those nodes — but `authentication` was `"none"`, so the credential was inert and the
  literal was the real auth path. The draft underneath was clean, so a scan of drafts
  saw nothing.

  Fixed by restoring the live version as the draft, setting
  `authentication: "genericCredentialType"` and removing the two headers on all eight
  nodes, then publishing (`8fa7c15e`). The live version is now verified clean: zero
  matches for the JWT, `isERPAuth` or `deviceIdProduction`. The bearer expired
  2026-08-07, so this was identity disclosure rather than live credential exposure —
  but the username and device id sat in the running definition for eighteen days.

  **Lesson worth keeping: a credential sweep must read active versions, not just
  drafts, and an attached credential does not mean it is being used.**

### 3.3 SA-116 — closed by construction

`5juo1j8x7gcVQVK5`'s unauthenticated `POST /webhook/sdrf-investigate` is replaced by an
**Execute Sub-workflow Trigger**, and `callerPolicy` is set to `workflowsFromAList`
allowlisting exactly the two real callers (`F1xw4pMpdl39kjMP`, `jYmwBoopFcot2IDN`).
Both SA-116 lanes close without a check in the flow: there is no anonymous request to
inject a prompt through, and no stranger who can reach the caller-supplied-verdict lane.

Two things were deliberately **deleted** rather than kept:

- The shared-secret check. It authenticated an HTTP caller; there is no HTTP caller.
  This also removed the live rotating secret, which was sitting in `Extract Cases` as a
  literal.
- The `deterministic_verdicts: true` opt-in gate. Its only job was to tell a trusted
  sibling from a stranger, which the trigger now does properly. Keeping it would have
  thrown on **every** bundle carrying a PIL red flag, because neither gatherer sends the
  flag — a guaranteed break guarding against a caller that can no longer exist.

Kept, because it does not depend on the threat model: caller-supplied `verdict`,
`exception`, `confidence`, `evidence_cited` and `reasoning` are still stripped from the
review lane, and `report_to` is still clamped to `'PIL'`.

Both gatherers were rewired from HTTP POST (which carried the secret as a literal
header) to Execute Sub-workflow with `waitForSubWorkflow: true` — the old POST nodes had
`onError: continueErrorOutput` with output 1 wired to nothing, so a failed handoff looked
green and silent.

**Prompt injection is still not addressed, deliberately.** `Render Evidence` honours
`c.gatherer.evidence_text` verbatim, so client notes and complaint threads reach the
judge's prompt unbounded. The caller is now provably a sibling flow, but the *data* it
forwards is still written by clients and staff. Restructuring a live verdict prompt
changes verdicts, which is the owner's call; the recommendation is in the node.

### 3.4 Two workflows archived

- `IwthgHiIv40FbLzO` **ZZ SDR Portal Contract Test** — existed only to POST fixtures at
  `https://security-room-n8n-callback-proxy.hassan-ahmed-e4c.workers.dev`. It was
  **live** and testing a portal that no longer exists. Unpublished, then archived. This
  closes its share of SA-105 and SA-142.
- `MvBUAdN2YfgcrwZC` **TEMP - ERP auth probe** — already credential-clean
  (`REDACTED - supply per run`) and inactive. Archived as leftover scaffolding.

### 3.5 Results sheets created

Three results spreadsheets, built to `docs/audit-sheet-standard.md` by
`Audit Sheet Generator (from standard)` (`VsXUGibmUlhNbX2j`):

| Check | Spreadsheet id |
|---|---|
| Client Refunds | `10FM6O08F3iSW086-Fe-C93Hfu_Ps-PwhIpbOneqVBA8` |
| Same Day Recruitment Fee | `1KQ6rT8MaM3LQ0rhgQcOdVJ0HYabJ9V34raPeVPV4YMo` |
| Housemaid Payroll Critical Checks | `1mtI668uFyvSWX_lj6yW4TPjLOpAHAEKV__Ov5VSIfXE` |

The Client Refunds creation failed first with a Google Sheets **503** at
`Create Spreadsheet` — before any file existed, so there is no orphan. The retry
succeeded.

---

## 4. Outstanding — needs a person

### 4.1 SA-97's two residual halves

Retention is already `saveDataSuccessExecution: none` on the payroll flow (and
`saveDataErrorExecution: none` too), so nothing new is written. Two things remain:

- **Prune the retained runs.** The API exposes no delete-execution tool. The payroll
  flow read **zero** retained executions on 2026-08-25 and again today, so this may
  already be moot — spot-check in the UI and reply to the ticket with the count. If the
  security team's own snapshot from 10/18 August retains a copy, that exposure lives
  with them, not in n8n.
- **Enable production masking.** A real per-workflow capability — the API exposes
  `workflow:enableRedaction` / `workflow:disableRedaction` as *scopes* — but there is no
  MCP tool and no settings field, so it cannot be set from here. It is the better
  long-term control than turning retention off, because it keeps execution data for
  debugging *and* redacts the sensitive fields.

### 4.2 SA-124 — permanent delete

`1sQJ72njQra4d5CQ` is archived and its current version stripped. The ticket asks for
deletion **together with its version history**, and earlier versions still hold
Abdullah's bearer and an identity cookie. The API has no history
delete. → n8n → Archived → delete permanently.

### 4.3 SA-142 is closed in n8n and reopened in Drive

The `workers.dev` egress is gone. But the audit-outputs folder
`1DyG9PHws8-52t_vNN96ZAh-T0Ewpoh1w` is **an ordinary My Drive folder that has been
shared, not a company Shared Drive.** Measured three times today — every sheet created
returned `on_shared_drive: false`.

This matters because SA-142 was never really about *access*, it was about *ownership*:
a personal `workers.dev` host and a personal My Drive folder fail the same way. Access
is fine; the folder belongs to one person, and the audit history leaves when they do.
`docs/audit-sheet-standard.md` §2 already says this ("**never** in an individual's My
Drive") — the folder in use does not meet its own standard.

→ An admin creates a company Shared Drive, moves the folder into it, and the standard's
§2 becomes true rather than aspirational. This affects **Travel Assist too**, which is
already live and writing to that folder.

### 4.4 Credential rotations, external to n8n

- **Malaz** — his ERP session (username and device id) was in the live SDR audit
  definition until today. Expired 2026-08-07; treat as disclosed and re-log-in.
- **Abdullah** — ERP bearer plus identity cookie, in the archived diagnostic probe's
  history.
- **The Render PDF key** named in SA-109 — rotate at the provider if that was never
  done, even though the node is gone.

### 4.5 Move `SDR Gatherer v2.1` into the Adeeb project

`F1xw4pMpdl39kjMP` lives in **Hassan's personal project** while everything else is in
**Adeeb**. Two consequences, both blocking, both UI-only:

- It cannot bind `ERP Hassan Prod` (a credential in another project), so its eight ERP
  nodes have no usable auth. Seven were already set to `genericCredentialType` with **no
  credential attached**, and `Fetch Visa Expenses` was reading a `cfg.erp_token` baton
  that `Config` never populates — it was sending `undefined`. This flow was already
  broken before today.
- Its Execute Sub-workflow call to the judge is allowlisted by id, so it will work once
  the projects line up.

→ Move it to Adeeb, then bind the credential.

### 4.6 SA-322 — add the reason, not just the confirmation

Hassan confirmed the external recipient `3nb3d@3nb3d.com` is intentional. That is
recorded in the flow. The *reason* is not. Whoever closes the ticket should add the
business justification to the sticky, so the next audit does not ask again.

---

## 5. Known incomplete — the Sheet write

**The security work is done. The delivery work is not.** All three rebuilt checks
currently e-mail their report body, and `docs/audit-sheet-standard.md` §8 says the
e-mail must be a *notification* — check name, window, link, nothing else — because mail
is forwarded and archived by people who were never granted access to the findings.

This is a deliberate interim, not an oversight: the Sheet write is not wired, so
shrinking the e-mail first would leave the findings nowhere at all. The two halves are
one job.

Why it was not finished: mapping each check onto the standard's A–R spine is a design
decision, not a copy-paste. Client Refunds emits **category-level** rows
(`category`, `count`, `amount`, `threshold`), but the spine is keyed on `Case key` with
`Entity`/`Counterparty` identity columns — someone has to decide what one row *means*
for that check. Guessing it would produce a sheet that looks standard-compliant and
is not.

Per-check state:

- **Same Day Recruitment Fee** — narrowest gap. `email_html` is already the
  drill-down-suppressed variant: metrics only, **no per-case names or contract ids**.
  Counts and AED totals still travel by mail. Row mapping is obvious
  (`Case key` = contract id, `Entity` = client, `Counterparty` = housemaid).
- **Client Refunds** — needs the row-grain decision above.
- **Housemaid Payroll** — **wire the Sheet before the intake**, not after. The flow
  cannot run today, so nothing is being mailed; use that window, so the first real run
  never mails 25k payroll rows. That would be SA-97's exposure in a different container.
- **SDR Audit - Consolidated** — `Write to Sheet` is disabled and `Config.sheet_id` is
  empty; it is e-mail-only. Needs a sheet generated for `SDR Fee Recovery` and the node
  enabled.

## 6. Known incomplete — the payroll intake

`zwSxrV00VE4rOSvd` is **secure but cannot run.** `Load Inputs` throws by design.

`ansari_data` and `payroll_data` are parsed spreadsheets — the Ansari bank payroll file
and the ERP payroll export, with human column headers (`Employee Unique ID`,
`Ansari (AED)`, `Pay Start Date`, `Housemaid Name`). Neither is fetchable from ERP.
Under the portal a human uploaded both and the portal POSTed them in the request body,
which is precisely how SA-97 came to hold 25,290 unredacted payroll rows in one
execution.

Hassan chose a **Google Drive folder** as the replacement. Three things must be pinned
down before it can be built, and guessing any of them means silently auditing the wrong
month:

1. **Which folder** — must be a company Shared Drive, and *not* the audit-outputs
   folder; inputs and outputs should not share an access boundary.
2. **File-naming rule** — how the Ansari file is told from the payroll file, and how the
   month is read off them. Newest-by-modified-time is not enough: a re-upload of last
   month's file would pass.
3. **`prev_cc_total`** — required and must be non-zero. Portal-supplied until now.
   Either derive it from the previous month's Ansari file (which means reading the two
   newest, not one) or carry it forward from the last run's own output.

Shape to build: Drive search → Download → Extract from File → `Load Inputs` assembles
`{ body: { ... } }`. The `body` wrapper is load-bearing — `Validate Inputs` reads
`$input.first().json.body`, so keeping it leaves the validator's date and calendar logic
untouched.

---

## 7. Publish state, and why

| Workflow | State | Why |
|---|---|---|
| `RTCQUXJ2Iss6IVwW` SDR Audit | **published** | The fix removed a live credential from a running flow. It was already broken (expired token), so publishing could only improve it. |
| `yYx7uqH25wnwItMR` Daily Household Expenses | **published** | Documentation-only change (one sticky); the draft was otherwise identical to the live version. |
| `zwSxrV00VE4rOSvd` Payroll | draft | Cannot run — intake unconfigured (§6). |
| `N3OWVknR68JImzvl` SDR Fee | draft | Ready to publish, but the date windows in `Run Config` are my defaults and should be confirmed first (§4 / node sticky). |
| `NIUelKhaMucLLSqK` Client Refunds | draft | **Abdullah's flow.** Structurally ready; publishing starts a monthly schedule on someone else's audit, which is his call. |
| `5juo1j8x7gcVQVK5` SDR Judge | draft | Its two callers are inactive drafts; the whole SDR chain is dormant. |
| `F1xw4pMpdl39kjMP` / `jYmwBoopFcot2IDN` gatherers | draft | Blocked on §4.5 (project move). |

Unpublished does **not** mean unfixed: the vulnerable nodes are deleted in every case, so
the findings are closed whether or not the flow is running. What publishing buys is the
audit actually running again.

---

## 8. Cosmetic residue, recorded so nobody mistakes it for a bug

`Build Report & Payload` and `Build Error Payload` on Client Refunds and SDR Fee still
emit a `callback_url` output key, now always `undefined`. It is an unused output field,
not a code path, and nothing reads it. The `erp_token` / `erp_cookie` plumbing in SDR
Fee's three `Build *` nodes **was** removed — not because it was broken (the values were
undefined and the HTTP nodes ignore them) but because leaving `erp_token` in three code
nodes invites someone to "fix" the undefined by restoring the token input, which is
exactly how SA-105 comes back.
