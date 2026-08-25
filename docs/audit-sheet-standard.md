# Audit results sheet — the standard for every check

Every automated audit check delivers its findings to a Google Sheet built to this
spec. One spec, one look, one set of column meanings — so an auditor who has read
one check's sheet can read all of them, and so a new check is a copy-and-fill job
rather than a design job.

This document is the contract. If a check needs to deviate, change this file
first, then change the check — never the other way round.

---

## 1. Why a sheet

Three delivery mechanisms were tried before this one, and each failed for a
reason worth remembering:

| Mechanism | Why it went |
|---|---|
| **A portal** (Security Room) | Needed a webhook to push into, which meant an unauthenticated endpoint holding a live ERP token in its request body — SA-105 / SA-129 — and a caller-named callback URL on a personal `workers.dev` host — SA-142. The findings were also invisible to anyone without a portal login. |
| **The full report in the e-mail body** | Client payment figures travelled by e-mail every month, to inboxes, forwards and mail archives nobody is auditing. Also unusable: you cannot filter, sort or annotate an HTML table in Gmail. |
| **A retained n8n execution** | Only reachable by someone with n8n access, deleted by retention policy, and it put 25k unredacted rows in an execution store (SA-97 on the payroll audit). |

A sheet fixes all three: access is controlled by Google permissions rather than
by who happens to have the link, the data stops travelling by e-mail, and an
auditor can filter, sort, and **write back** — which none of the above allowed.

## 2. Ownership and location

**The file lives in a company-owned Shared Drive. Never in an individual's My
Drive.** This is not a preference. A sheet of client payment data in a personal
Drive is SA-142 in a new location: it is owned by a person, it leaves with them,
and it is outside any company retention or access review.

- One folder for all audit outputs, on a Shared Drive.
  **Current folder:** `1DyG9PHws8-52t_vNN96ZAh-T0Ewpoh1w`.
- **Access is the department, not the company** (2026-08-25, Hassan): the folder
  is scoped to the AI Experience & Automation team — Hassan, Malaz, Abdullah —
  rather than shared org-wide. That is least privilege and it costs nothing: the
  requirement was never *broad* access, it was *company ownership*. A personal My
  Drive fails because the file is owned by a person and leaves with them; a
  narrowly-shared Shared Drive folder is owned by the company and does not.
  If a check's findings need a different audience later (payroll reviewers are
  not the same people as refund reviewers), share that one **file** wider — do
  not widen the folder, and do not move the file out of it.
- **One spreadsheet per check.** Not one workbook for everything: it keeps
  per-file sharing available as the escape hatch above, and a single file
  accumulating a tab a month across ten checks becomes unnavigable inside a year.
- File name: `Audit — <Check name>` (e.g. `Audit — Travel Assist Payments`).
- The URL is **stable and permanent**. Every month's e-mail links to the same
  spreadsheet; the run adds a tab, it never creates a new file. A link that
  changes monthly is a link nobody bookmarks.

## 3. Tabs

Identical in every check's file, in this left-to-right order:

| Tab | Contents | Written by |
|---|---|---|
| `README` | What the check does, how to read the sheet, what each state means, who owns it, who to ask. Written once, by hand. | Human |
| `Latest` | The current run's findings. The tab people actually open. Cleared and rewritten each run. | Flow |
| `YYYY-MM` | One frozen tab per completed run, newest immediately right of `Latest`. | Flow |
| `Run log` | One row per run — see §7. Append-only. | Flow |

**Retention: 12 monthly tabs.** On the 13th run the oldest monthly tab is copied
into `Audit — <Check name> — Archive YYYY` in the same folder and removed from
the live file. `Run log` is never pruned — it is the audit trail of the audit.

`Latest` is a duplicate of the newest monthly tab, not a different view of it.
Having both costs one tab and means the e-mail can link to a tab name that never
changes.

## 4. The column spine

Columns A–P are **the same in every check**, in this order, with these meanings.
A check that has nothing for a column leaves it blank; it does not repurpose it
and it does not reorder.

| Col | Header | Meaning |
|---|---|---|
| A | `Case key` | Stable identifier for the row across runs. The join key for carry-forward and for human notes. Usually the contract/employee id. |
| B | `Entity` | The human-readable subject — client name, employee name. |
| C | `Counterparty` | The other side, where the check has one — housemaid, vendor, agency. Blank if not applicable. |
| D | `State` | `RED` / `GREEN` / `PENDING`. Exactly these three. See §6. |
| E | `Reason code` | Machine-stable slug, e.g. `ta_short_paid`. Stable across months so it can be counted. |
| F | `Reason` | One sentence a human can act on. No jargon, no node names. |
| G | `Expected` | What should have been paid/charged, in AED. |
| H | `Actual` | What was, in AED. |
| I | `Variance` | `Actual − Expected`. Negative = shortfall. |
| J | `Verdict` | The AI reviewer's judgement, where the check has one. Blank if not reviewed. |
| K | `Confidence` | `high` / `low` / `none`. `none` means **not actually reviewed** — never read a `none` row as a judgement. |
| L | `Why` | The reviewer's reasoning, or the deterministic rule that settled it. |
| M | `ERP link` | Deep link to the record. A `HYPERLINK()` formula, label = the id. |
| N | `First seen` | `YYYY-MM` the case was first flagged. |
| O | `Months open` | Runs it has survived unresolved. Drives escalation. |
| P | `Last checked` | `YYYY-MM` of this run. |
| Q | `Auditor note` | **Human-writable.** Carried forward by case key; the flow never overwrites a non-empty note. |
| R | `Human status` | **Human-writable.** Blank / `Chasing` / `Closed — OK` / `Closed — recovered` / `Escalated`. |

Check-specific columns start at **column T**, leaving S empty as a visual break.
They are the only place a check differs.

Two rules about Q and R that matter more than they look:
- The flow **reads** them and carries them forward for a case that is still open.
  A note written in July is still there in August, or nobody will ever write one.
- The flow **never writes over** a non-empty value. If the auditor and the audit
  disagree, the human wins and the disagreement stays visible.

## 5. Layout and formatting

The point of specifying this is that every check looks identical, so nobody has
to re-learn a layout.

```
Row 1   Title band, merged A1:R1  — "<Check name> — <window>"       navy, white, 14pt bold
Row 2   Run band,   merged A2:R2  — "Run <run id> · <n> audited · <r> red · generated <ts> Dubai"
Row 3   (blank spacer, 6px)
Row 4   HEADER ROW
Row 5+  data
```

- **Freeze 4 rows and 3 columns.** Identity (A–C) stays put when scrolling right;
  that is the whole reason C is a name and not a number.
- **Header:** background `#1B2A47`, white, bold, 10pt, wrapped, vertically
  centred, 40px tall.
- **Banded rows:** alternating `#FFFFFF` / `#F8FAFC`. Borders `#E2E8F0`, 1px.
- **Autofilter** on row 4, spanning to the last used column.
- **Money (G, H, I):** `#,##0` — whole dirhams, no decimals. Fils in an audit of
  thousands is noise, and the underlying figures are already rounded up.
  Variance uses `[Red]-#,##0;#,##0` so a shortfall is red without a rule.
- **State (D)** conditional formatting, on the cell only:
  | Value | Background | Text |
  |---|---|---|
  | `RED` | `#FEF2F2` | `#991B1B` bold |
  | `GREEN` | `#F0FDF4` | `#166534` |
  | `PENDING` | `#FEF3C7` | `#92400E` |
- **`Months open` (O):** ≥ 3 → background `#FEF3C7`; ≥ 6 → `#FEF2F2` with bold.
  A case that has been open half a year should be visible from across the room.
- **Column widths:** A 110 · B 200 · C 180 · D 90 · E 150 · F 380 · G/H/I 110 ·
  J 230 · K 100 · L 460 · M 120 · N 100 · O 110 · P 110 · Q 320 · R 150.
  F and L wrap; everything else clips.
- **Sort order:** `RED` first, then `PENDING`, then `GREEN`; within a state, by
  `Months open` descending, then `Variance` ascending (worst shortfall first).
  The reader should never have to sort it themselves to find the top of the list.
- **Protect the sheet, leave Q and R editable.** Stops a well-meaning edit to a
  computed column from silently disagreeing with the ERP.

**Colour palette** (shared with the failure e-mails, deliberately):
navy `#1B2A47` · green `#16A34A` · red `#DC2626` · amber `#B45309` ·
surface `#F8FAFC` · border `#E2E8F0` · muted text `#64748B`.

### Implementation note: copy a template, do not format at runtime

The flow does **not** re-apply this formatting every month. There is a template
spreadsheet in the same folder, `Audit — TEMPLATE`, whose `Latest` tab carries
all of the above. Each run duplicates that tab, renames it, and fills values.

This matters for two reasons: a `batchUpdate` formatting call is a long list of
brittle range indices that breaks the moment a column moves, and re-applying it
per run means the formatting can silently drift between checks. Copying a
template makes drift impossible and makes "standardise a new check" literally a
file copy.

## 6. State vocabulary

Only three states, and they mean the same thing in every check:

- **`RED`** — the check found something wrong and unexplained. Someone must act.
- **`GREEN`** — checked, nothing owed, no action.
- **`PENDING`** — money is in flight; not wrong yet, look again next run. Never
  use `PENDING` for "we could not tell" — that is `RED` with a reason of
  "insufficient data", because an unknown must not read as settled.

`Verdict` is advisory and never changes `State`. An AI verdict of *justified* on
a `RED` case leaves it `RED`; only a human closes a case, in column R.

## 7. `Run log`

One appended row per run. This is where "did the check actually work" lives, and
it is the reason a permanently-broken data source cannot hide.

| Col | Header | Notes |
|---|---|---|
| A | `Run id` | |
| B | `Window` | `YYYY-MM-DD → YYYY-MM-DD` |
| C | `Started` / D `Duration` | Dubai time, seconds |
| E | `Outcome` | `OK` / `OK (degraded)` / `FAILED` |
| F | `Audited` | rows in the findings tab |
| G | `Red` / H `Green` / I `Pending` | |
| J | `New red` / K `Red→Green` | movement, not just totals |
| L | `Carried in` / M `Carried out` / N `Expired` | carry-forward accounting |
| O | `Reviewed by AI` / P `Unreviewed` | `Unreviewed > 0` means verdicts are incomplete |
| Q | `Data completeness` | **See below** |
| R | `Notes` | free text from the run |

**`Data completeness` is not optional.** It lists every data source the run
touched and whether it returned data — e.g.
`contracts OK · mohre OK · work_permits OK · payments OK · maid_status FAILED(401) · complaints OK`.

A soft-failing lookup does not stop a run: it returns nothing and the audit
carries on with less evidence, which can turn a justified case into an apparent
finding. Without this column that happens silently for ever. With it, an endpoint
that has been failing since March is visible in every row since March.

Rule: a source that fails **every** run is a permission or access problem, not a
blip. It belongs in a ticket, not in an alert that everyone learns to ignore.

## 8. The e-mail contract

The e-mail is a **notification, not a report**. It says the run happened and
where to look. That is all.

It contains: the check name, the window, and the link. It does **not** contain
counts, amounts, names, case keys, or any finding — those live behind Google
permissions, and an e-mail is forwarded, archived and searched by people who were
never granted access to the findings.

```
Subject:  <Check name> — <Month YYYY> results ready
Body:     The monthly <check name> has run for <Month YYYY>.
          Results are in the sheet:  [ Open results ]
          <one line: what to do — e.g. "Review anything marked RED.">
```

Failure and degraded alerts are the exception and stay as they are: they carry
the diagnostic detail needed to fix the run, because there is no sheet to point
at when the run did not produce one. They still carry no client data.

## 9. Adding a new check

1. Copy `Audit — TEMPLATE` in the Shared Drive folder → rename `Audit — <Check>`.
2. Fill in `README`.
3. In the check's n8n flow, set the spreadsheet id in the **one** config node —
   never inline it across nodes.
4. Map the check's findings onto the A–R spine in its `Build Sheet Rows` node.
   Anything that does not fit goes at column T or later.
5. List every data source in `Data completeness`, including the ones expected to
   fail.
6. Point the notification e-mail at the new file. Body per §8 — no figures.

If step 4 tempts you to reorder the spine, the check is not special; stop and
read §4 again.

## 10. Open items

- **Shared Drive folder is not yet chosen.** Until it is, no check should write
  to a personal Drive — that is the finding this standard exists to avoid.
- The n8n Google credentials in use are individual OAuth accounts. The *files*
  being company-owned is the requirement; a service account for the *writer*
  is the better end state and should follow the same path as the ERP service
  account.
- **Known-degraded sources belong in `Data completeness`, not in an alert.**
  Travel Assist proved the rule: `Get Maid Status History` fails 31/31 every run
  on a missing ERP permission. Alerting on it monthly trains people to filter
  the alerts, and the next *real* failure lands in a filtered inbox. Recorded in
  every Run log row, excluded from the alert; a source goes back on the alert
  list the moment it is not expected to fail. The fix belongs in a ticket.
- Verified end to end on Travel Assist (execution 102442, 2026-07): 31 rows,
  2 RED / 26 GREEN / 3 PENDING, verdicts attached, `2026-07` snapshot tab,
  one Run log row, one notification e-mail carrying no figures.

## 11. Done since first draft

- Carry-forward of `Auditor note` / `Human status` (§4) **is now built.** The run
  reads the outgoing `Latest` tab before clearing it and re-applies Q and R by
  case key. This was not optional: rewriting `Latest` monthly without it would
  silently destroy everything an auditor had written, which is worse than having
  no notes column at all — it invites the work and then eats it.
