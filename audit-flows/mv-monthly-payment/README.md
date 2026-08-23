# MV Monthly Payment — node bodies

Repo copies of the Code-node bodies changed by the **2026-08-23 re-audit**. Five flows, tag
`audit: MV Monthly Pmt`, all `active: false` and marked "DRAFT, never publish" by their author.

| file | node | flow |
|---|---|---|
| `nodes/stage0_project_group.js` | `Project Group` | `9jOMFEC2zEWy2RHM` 0-Sweep Population |
| `nodes/stage1_fail_loudly.js` | `Fail Loudly` | `IKRXhIco1mwxrcPq` 1-Population |
| `nodes/stage4_assemble_evidence.js` | `Assemble Evidence` | `9T91z5VFH5g69WyT` 4-Verify findings |
| `nodes/stage4_budget_gate.js` | `ERP Budget Gate` | `9T91z5VFH5g69WyT` 4-Verify findings |

This is **not** the whole of any flow — only the nodes this audit wrote. The findings, the reasoning
and what is still outstanding are in `../compliance/mv-monthly-payment.md`.

## `scorer.stage2.js` is not in this repo

Stage 2's sticky note and its `Score Contract Month` node both say that node's code is kept
byte-identical to `audit/mv-monthly-payment/scorer.stage2.js`, backed by 140 offline tests. **That
file is not here** — the path is outside `audit-flows/`, and nothing under this repo matches it.

The claim is the flow author's and is repeated in the node's compliance note because it is the
reason that note exists (a comment only n8n has would break the byte-identity). But it is
**unverified from here**, so: nothing in this repo can check that Stage 2's scorer matches anything,
and `tools/regen_breaker_embeds.py --check` does not cover it. If the file is real, bring it in or
point at it; if it is not, the note is describing a guarantee nobody holds.

Recorded rather than assumed, the same way `tools/verify_order.py` was found not to exist on
2026-08-22 after being cited as a precondition.
