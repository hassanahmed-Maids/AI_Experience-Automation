# Change of Status Audit — go-live gate check

Prepared 2026-09-01. What has to be true before a production deploy can be
requested, and what is still open.

The ticket body itself is NOT kept here — Jira drafts are given in chat, never
as a file (standing instruction, 2026-09-01). This page is the evidence behind
it.

---

## ⛔ Gate check — THREE gates are open

The spec sets these itself; they are not my additions.

| Gate | Where it is written | State |
|---|---|---|
| **`Test cases verified`** | Property description on the Checks database: *"Five real cases checked in the ERP by a human. **Flow cannot go live without this.**"* | **NO.** 2 of 6 re-pulled from ERP by the live runs; cases 3, 4 and 5 are not, and case 2 needs the `GET /visa/newRequest/{request_id}` that is refused. |
| **Independent review** | `Independent review required` = YES. Reviewer: Malaz, or whoever owns the Visa module's escalations. | **Not done.** This check can move a charge onto a maid's salary loan or raise a claim against a client. |
| **One clean full run on the current build** | Builder process, Phase 6 | **Not done.** The token expired before the final pass could run, so the **workbook append has never executed once**. |

**A deploy request can be drafted now. It should not be raised as "ready" until
at least the third closes**, because a delivery path that has never run once is
not a deployment risk you can size.

---

---

### Asks

1. **Grant the four permissions above** to the account that will run the check —
   this is what turns 7 rules into 21.
2. **Decide the run identity.** The flow deliberately holds no ERP credential:
   the token is supplied per run so every read is logged under a real person.
   That means the **monthly trigger cannot fire on its own** — it is shipped
   **disabled**. Production needs either a dedicated audit service account, or an
   accepted manual monthly run.
3. **Confirm the delivery target** — the workbook is currently in the Audits
   folder under Hassan's account, readable by the Malaz credential the flow
   writes with.

### Pre-deploy checklist

- [ ] `Test cases verified` ticked by a human (spec: cannot go live without it)
- [ ] Independent review by Malaz
- [ ] One clean full run on the current build with a fresh token
- [ ] Detach the leftover `Hassan Bearer` credential from the four ERP nodes —
      inert today because `authentication` is `none`, but if anyone later flips a
      node to `genericCredentialType` it silently re-binds a shared token and the
      run stops being attributable
- [ ] Clear the test rows from both data tables and the three test drafts from
      Malaz's mailbox
- [ ] Rule on the **105 rows per run that reach states the spec has no verdict
      word for** (same gap as *Still open* item 8)
- [ ] Rule on *Still open* items 1 and 4

### Rollback

Unpublish the flow. It writes only to its own two data tables and its own
workbook, sends nothing (email is a **draft** to Malaz, never sent), and makes no
writes to ERP — every ERP call is a read.
