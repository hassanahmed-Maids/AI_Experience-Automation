# Audit checks — Police & Control Dept.

A separate subsystem from the ERP→CustomerIO migration pipeline (that lives in the
repo root `CLAUDE.md`). Here, each **audit check** is a recurring integrity check on
maids.cc business data: an n8n flow does the deterministic maths and raises **red
flags**; a scheduled Claude worker then investigates every flag live against the
ERP and decides whether it is a **genuine issue** or a **legitimate exception** —
the judgement a human auditor used to do by hand.

```
n8n flow (deterministic)  ──▶  red_flags[]  ──▶  Claude worker (judgement)  ──▶  verdicts + evidence
   raises the flag                                reads the skill = the law     written back to the portal
```

## File convention — one file per concept

| File | Role |
|---|---|
| `audit-check-skill.template.md` | The **standard template**. Copy it to author a new check. One skill = one check. Fill every field; leave nothing as `TODO` in a published skill. |
| `<check-id>.skill.md` | The **law** for one check: the flow it drives, the trigger/result contracts, the ERP access reference, the investigation playbook, guardrails, and the verdict schema. The worker reads this in full at the start of every run; if the operator prompt and the skill ever disagree, **the skill wins**. |
| `<check-id>.task.md` | The **operator prompt** — paste-ready instruction for the recurring Claude task. Names the skill as its source of truth and carries the deployment placeholders (webhook URL, endpoints, token source, schedule). |

## Checks in this repo

| Check | Skill | Operator task | Status |
|---|---|---|---|
| Same Day Recruitment Fee (SDRF) | [`same-day-recruitment-fee.skill.md`](./same-day-recruitment-fee.skill.md) | [`sdrf-audit-worker.task.md`](./sdrf-audit-worker.task.md) | `in_review` (see the skill's §6 — two baseline fixes must be honoured before `active`) |

## Runtime requirement (all checks)

The worker must run where `erpbackendpro.maids.cc` and the n8n host are reachable,
with a live ERP token — i.e. Claude Code as the runner. A public claude.ai task
cannot reach the internal ERP.

## The one rule no check may bypass — the ERP RATE LAW

The payments `advancesearch` endpoint once got the ERP account disabled. Every
check that touches HEAVY ERP endpoints obeys: **sequential calls only, ≥ 350 ms
between calls, ≤ 500 calls per run, and a circuit breaker that trips on the first
ERP error** (stop, write back what's done, escalate the rest as `incomplete`).
Scope heavy endpoints tightly to one entity at a time. This is stated in each
skill's frontmatter (`guardrails.erp_call_law`) — never bypass it.
