---
name: audit-checks
description: >-
  Run a Police & Control Dept. audit check end to end — fire the check's n8n
  flow, take its red flags, and investigate each one live against the ERP to
  separate genuine issues from legitimate exceptions, attaching primary evidence
  and a clickable ERP link to every verdict. Use whenever the work is running,
  scheduling, or investigating a maids.cc data-integrity audit check — e.g. the
  Same Day Recruitment Fee (SDRF) check. Trigger on phrasing like "run the SDRF
  audit", "the SDRF audit worker", "investigate the red flags", "check flagged MV
  contracts for the recruitment fee", "audit check red flags", or a request to
  verify that flagged contracts really do have a correct fee. This is the
  operator front door for the Police & Control audit subsystem; each check's own
  `<check-id>.skill.md` is the law, and this skill carries the ERP rate law every
  check must obey.
---

# Audit checks — Police & Control Dept.

A subsystem **separate** from the ERP→CustomerIO migration pipeline (that lives in
the repo root `CLAUDE.md`). Each **audit check** is a recurring integrity check on
maids.cc business data: an n8n flow does the deterministic maths and raises **red
flags**; a scheduled Claude worker then investigates every flag live against the
ERP and decides whether it is a **genuine issue** or a **legitimate exception** —
the judgement a human auditor used to do by hand.

```
n8n flow (deterministic)  ──▶  red_flags[]  ──▶  Claude worker (judgement)  ──▶  verdicts + evidence
   raises the flag                                reads the check's law         written back to the portal
```

## File convention — one file per concept

| File | Role |
|---|---|
| `audit-check-skill.template.md` | The **standard template**. Copy it to author a new check. One check = one `<check-id>.skill.md`. Fill every field; leave nothing as `TODO` in a published check. |
| `<check-id>.skill.md` | The **law** for one check: the flow it drives, the trigger/result contracts, the ERP access reference, the investigation playbook, guardrails, and the verdict schema. The worker reads this in full at the start of every run; if the operator prompt and the law ever disagree, **the law wins**. |
| `<check-id>...task.md` | The **operator prompt** — paste-ready instruction for the recurring Claude task. Names the check's law as its source of truth and carries the deployment placeholders (webhook URL, endpoints, token source, schedule). |

## Checks in this skill

| Check | Law | Operator task | Status |
|---|---|---|---|
| Same Day Recruitment Fee (SDRF) | [`same-day-recruitment-fee.skill.md`](./same-day-recruitment-fee.skill.md) | [`sdrf-audit-worker.task.md`](./sdrf-audit-worker.task.md) | `in_review` (see the law's §6 — two baseline fixes must be honoured before `active`) |

## How to run a check

1. **Load the law.** Open the check's `<check-id>.skill.md` and read it in full. It is the source of truth; everything in the operator prompt defers to it.
2. **Follow the operator prompt.** Open the matching `...task.md`, fill its deployment placeholders (n8n webhook URL, results/writeback endpoints, ERP token source, schedule), then work its run procedure: derive the window → fire the flow → collect the red flags → investigate each flag per the law's pipeline → write back verdicts → produce the run summary.
3. **Honour the guardrails.** Escalate (never guess) below the law's confidence floor, on missing/ambiguous ERP data, or on any ERP error.

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
check's frontmatter (`guardrails.erp_call_law`) — never bypass it.
