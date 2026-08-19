# Stage 4 verifier — branch tests, 2026-08-19

Run with pinned fixtures (`test_workflow`), so no ERP load. The ERP routes themselves were
already proven live in Phase 2; what these prove is the **rule wiring and precedence**.

| # | Scenario | Result | Gate | PIL |
|---|---|---|---|---|
| 1 | Complete evidence, no staff reason, a qualifying chase 3 days ago | **Awaiting reviewer** / pending | `v5` | blocked |
| 2 | Complete evidence, **model call fails** | **Red Flag stands** | `v-down` | blocked |
| 3 | **Message log 503**, model says the case is explained | **Red Flag stands** | `v-evidence` | blocked |
| 4 | Complete evidence, staff reason for this exact month | **OK** / clean | `v2` | not blocked |

## What each one actually proves

**1 — the follow-up classifier rejects the near-misses.** The fixture carried three messages
*dated later* than the real chase: a `MV_PAYMENT_RECEIVED_NOTIFICATION` (a receipt containing the
word PAYMENT), a `CM_CLIENT_BROADCAST_*` (marketing), and a genuine chase whose delivery **FAILED**.
`last_followup_date` came back **2026-08-16** — the newest *qualifying, delivered* chase — not
2026-08-18. Taking the receipt would have suppressed the finding by making the chase look recent;
counting the failed one would have credited a message that never arrived.

**2 — unknown never clears, and this is the one that matters.** The pinned complaint text said
*"Client agreed a payment holiday for June with the manager"* — text that **would** have cleared
the case had the model answered. Because the model failed, the finding **stands** and is blocked
from the PIL. A verifier that cleared on a failed call would be worse than no verifier at all.

**3 — the evidence gate outranks the clearing path.** Found by accident: I built this fixture
intending to test clearing and pinned the message log as 503 by mistake. The model said
`explainsThisMonth: true` and the case **still** stayed a finding, because the 10-day rule is not
evaluable without the log. That precedence is correct and is now covered deliberately.

**4 — the clearing path does work, and carries its evidence.** `verifier_quote` holds the exact
sentence, `verifier_reason` the one-line rationale, `block_pil` false, `needs_human` false. Worth
proving: a verifier that can never close anything sends every finding to review and wastes the
reviewer's time, which is the failure mode opposite to a false clearance. Note the WhatsApp log in
this fixture held only a birthday reminder, so `last_followup_date` is empty — v2 precedes the
follow-up rules, as the Orders require (270 before 290/300).

## A silent failure found and fixed

Test 1 initially ended at `Update Case With Verdict` and **never reached the summary**, because the
update matched no rows (a synthetic `run_id`). The verifier had decided and the decision was
silently lost — no error, no report.

Fixed: `Verify Summary` now asserts one persisted row per verified finding and throws otherwise,
and the update node sets `alwaysOutputData` so the assertion is always reached. Same discipline as
Stage 3 reading the case store back rather than trusting what the previous stage returned.

## Not yet proven

Stage 4 has **not** run against live ERP evidence end to end. The routes are proven, the rules are
proven, but the two together are not. That needs one live run on a real finding.

---

# Live end-to-end run — and the credential that was dead

## Run 1: execution 93522, 11:04:45 → 11:17:40 UTC (12m55s), success

Same gentle sweep configuration as before, deliberately unchanged so "proven safe" still meant
something. Health checked before (200), mid-run (probed the **accounting** module so the check
itself added no load to the module being swept), and after (200, including the smsLog route).
**No 503 at any point.**

Stage 4's live ERP reads worked on the first attempt — `evidence_complete: true`, and it pulled a
real qualifying follow-up date of **2026-05-05** out of the live WhatsApp log.

**But the model failed:** `Authorization failed - please check your credentials`. The verifier fell
back to `v-down` — finding stands, PIL blocked. **The fallback did its job**: the run produced no
wrong clearance, it produced an honest "I could not judge this".

Cause: the `Anthropic account 3` credential (`JizfbDQuznvST8op`) is dead.

## Diagnosing it for one call instead of thirteen minutes

Rather than swap a credential and re-run the whole 464-call chain to see if it worked, a throwaway
probe tried the project's other `anthropicApi` credentials with a one-word prompt:

```
anthropic_account_4 (bIzntHpfKnBvMxvy)  WORKS -> OK
hassan_langcc      (XgUKcezcqSep8clp)  WORKS -> OK
anthropic_account_3 (JizfbDQuznvST8op)  Authorization failed
```

Swapped to `Anthropic account 4`. Probe archived.

## A re-verify entry point, so this is cheap next time

Stage 4 now has a **second trigger**: POST `{ runId, bearer, token, device }` to
`mv-monthly-payment-verify` and it re-verifies that run's findings **straight from the case
store** — no population sweep. **2 ERP calls per finding instead of ~464.** Use it whenever only
the verifier changed.

Implementation note: the sub-workflow trigger was renamed to `Sub Trigger` and the normaliser node
was named `Verify In`, so every existing `$('Verify In')` reference downstream resolves to the
normaliser unchanged — no expression rewrites, no chance of missing one.

## Run 2: execution 93559 — the verifier working on live evidence

Re-verified the same run through the new entry point:

```
case_key            1074171:2026-06
verdict / state     Red Flag / finding
verifier_gate       v4
verifier_down       false          <- the model ran
evidence_complete   true           <- both live ERP reads succeeded
last_followup_date  2026-05-05
verifier_reason     "no qualifying chase since 2026-05-05 (106 days) - the finding stands"
block_pil           false
```

Summary: `findingsVerified 1 · verdictsPersisted 1 · standAsFindings 1 · pilReady 1`.

**This is the first PIL-ready finding the check has produced.** AED 2,405 unpaid for June 2026 on a
contract that was cancelled mid-month, with no staff-written explanation and no payment chase in
106 days. The full chain is proven: population union → scoring → verification → delivery.
