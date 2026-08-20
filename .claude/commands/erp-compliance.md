---
description: Audit n8n audit flows against ERP-LOAD-POLICY.md and fix what fails
---

Audit the ERP audit flows against `audit-flows/ERP-LOAD-POLICY.md` §7 and bring them into
compliance. Arguments (optional): flow names or workflow IDs to limit the sweep. With no
arguments, sweep every flow listed in `audit-flows/cc-below-agreed/FLOWS.md`.

ERP is production and audit traffic has taken it down three times. The policy is binding on
every flow, existing and future. This command is the retrofit path.

**Do this:**

1. **Export what is LIVE, not what is in the repo.** For each flow, `get_workflow_details` and
   save the JSON into `audit-flows/exports/<flow>.json`. A stale export is the one way this
   checker lies — it will pass a flow whose live version was edited after the export was taken.
2. **Run `python3 audit-flows/tools/erp_compliance.py --all`.** It checks all five requirements:
   pacing and timeouts (§1), paginated-sweep intervals (§2), the pre-flight budget gate (§3), the
   ERP lease on entry flows (§4), and the circuit breaker in every projection node — re-generated
   and compared byte-for-byte, so drift is a finding rather than an opinion (§5).
3. **Fix what it names, in the repo first.** Node bodies live under
   `audit-flows/cc-below-agreed/**/nodes/`. Generate the breaker with
   `python3 audit-flows/tools/build_breaker_embed.py --call-site <site> --source-node "<node>"` —
   never hand-copy it.
4. **Prove each fix offline before deploying.** Every flow has a suite under `offline/`; run all
   of them, and add assertions for whatever you changed. If a suite goes green on a change that
   should have broken it, the suite is the bug.
5. **Deploy, then re-export and re-run the checker.** Repo and deployment must not silently
   drift; that trap has already produced two live defects in this system.

**Judgement calls that are yours to make:**

- If a layer legitimately lives in the caller (a sub-workflow whose cohort its parent already
  gated, or which runs inside its parent's lease), declare it *in the flow* with the
  `ERP-COMPLIANCE:` marker the checker looks for. A declared exemption is visible to the next
  reader. A silent one is a blind spot.
- Never widen a threshold to make a finding go away. If a threshold is genuinely wrong, change it
  in `audit-flows/tools/erp_breaker.js` with the reasoning, log it in `docs/decisions.md`, and
  re-generate every copy.

**Report** what was live before, what changed, what is still outstanding and why — and say
plainly which flows you could not verify end to end, rather than letting a green checker stand
in for a run that never happened.
