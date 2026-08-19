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
