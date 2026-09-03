# Spec template — Police & Control audit dashboards

Extracted from **Wellcare Invoice Audit v2** (Malaz Alool, 2026-09-02), which is the reference
implementation. **Every P&C audit spec follows this structure from 2026-09-03 onward.**

Read the reference spec alongside this file — the template gives the skeleton, the reference shows
the depth each section is meant to reach.

---

## Conventions that bind

| Marker | Means |
| --- | --- |
| 🔴 | **Load-bearing.** Getting this wrong changes an answer, silently. Reserve it |
| ⚠️ | A caution: real, but it will not invert a verdict on its own |
| *(code-verified)* | Confirmed against the ERP source via Ask the Code — not inferred from a column name |
| `UNVERIFIED` | Named but not confirmed. **Every unconfirmed name carries this**, no exceptions |
| ~~struck~~ + **CLOSED** | An open item that was resolved. Keep the history; do not delete rows |

- **Never invent a table, column, field or enum value.** It enters the spec from a query result,
  an Ask the Code answer, or the requestor — or it is marked `UNVERIFIED`.
- **Correct earlier versions in place, in the open.** *"correcting v1"* / *"this was wrong before
  <date> and the correction is load-bearing"*, with what the wrong answer produced.
- **Say what could not be verified, and why**, rather than leaving the reader to assume it was.
- **Approved KPI definitions are reused verbatim**, filters included. If none exists, say so
  explicitly and mark the metric a new P&C definition for the Data Catalog.
- **No recurring or scheduled warehouse queries.** Ad hoc only; recurring processes go to the ERP
  team, and the spec is the handoff.

---

## Structure

### Header

A two-column table: **Requested by** · **Spec version** · **Date** · **UI mockup** (the artifact
URL) · **Status** (one line: what gate it has passed and what is open).

### `### What changed from v<n-1>`

Only for v2 and later. Numbered, and **only the changes that altered the logic** — not wording.
State the defect, what it produced, and where the fix is (`§3 M4`). Then, separately: what the
audit flagged that this version **deliberately did not change**, and where it was escalated to.

---

### `## 1. Business Logic`

Plain business language. No table names, no SQL.

- **The control.** What must be true, in the requestor's terms.
- **The failure it catches.** The money that goes missing when it is not true — and why no other
  control notices. Name the secondary failures too.
- **Reader and action.** Who opens it, how often, and what they *do* with each colour.
- **Population in scope.** Bullets. Include the awkward cases explicitly — negatives, credit notes,
  duplicates, inactive records — and say how each behaves.
- **Explicitly out of scope**, each with the reason and, where one exists, the check that owns it.
- **Restatement policy.** What happens to a published month when the answer changes later. Without
  this, "late is not a finding" and a permanent flag contradict each other.
- **Grain.** *One row per ___.* Say what does **not** split a row, and what does.
- **Refresh expectation.** The trigger, and what a run started too early reports.
- **Sensitivity class.** Name the class (health data, payroll data), what appears and what never
  does, and who may read it.

---

### `## 2. Data Points Needed`

Open with a **verification note**: what was verified how, and what was verified nowhere.

**`### 2.1 Verified — already in Snowflake`**
A table: `#` (D1, D2…) · Data point · `Database.Schema.Table` · Column + type · Notes/verification.
Per-row notes carry the enum values in full, nullability, the `source_expression` where it
surprises, and 🔴 on anything that inverts a result. Add a closing warning for any column that
**exists and must never be used**, with what using it would produce.

**`### 2.2 Approved KPI definitions reused`**
A table: Metric · Source of definition · Reused verbatim? Check
`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` and record the result even when it is "none".
**Then name any already-modelled view that answers the same business question** and state how this
spec's verdicts map onto it — shipping without that leaves the company two official answers.

**`### 2.3 New data ingestion request — NOT yet in Snowflake`**
Only what is genuinely missing. Where the data actually lives *(code-verified)*; the ask, sized
honestly; a target schema, one row per what; the selection rule where more than one candidate
exists; the shapes the ingestion must survive; join keys with both types; known hygiene issues.

---

### `## 3. Metric Calculations`

One block per metric, `### M<n> — <name>`:

- **Business definition** — a sentence a finance person would accept.
- **Formula** — computable from the D-points above and nothing else.
- **Basis** — VAT-inclusive or not, gross or net, snapshot or current.
- **Currency** · **Rounding** (with the level it is applied at).
- **Nulls** — and *never a zero* wherever a null could read as clean.
- **Legitimate zero** — the case where 0 is a correct answer, not a defect.
- **Negatives** — every money column that can go negative, and what that means.
- Where a rule changed: a 🔴 block with the superseded rule, what it produced, and the evidence
  that settled it.

**The verdict ladder** — `### M<n> — Verdict`, an ordered table, **first match wins**:
`# · Condition · Verdict · Colour · Red flag?` Follow it with: which rows are the red shapes and
why the others are not; any row that must be a **positive test** rather than the negation of
another; and any ruling change, dated, with what it does to prior months.

**Tie-out rule and run guards** — `G1` upward, each named. At least one **arithmetic identity that
cannot be satisfied by construction** (a remainder always closes; that is not a tie-out). Then a
guard per condition under which a number must not be trusted, each stating what renders and whether
it **blocks publication**.

---

### `## 4. Finalised UI Report`

Mockup URL · **Layout** (the reading order) · **KPI strip** (and which figure leads, at the largest
type) · **Columns** table with source and format, and the default sort · **Sections below the
flags**, collapsible, each with its own subtotal and none in the headline · **Filters** and their
defaults · **Drill-down** — everything needed to work the case without leaving the page ·
**Conditional formatting**, colour never the only carrier · **Provenance line**, always visible,
naming sources, the run, and every rule version in force · **Run integrity panel** rendering the
guards pass/fail with numbers · **Export**, and what it must not contain.

Where the mockup contains invented rows for approval, say so — *a mockup device, not a report
feature*.

---

### `## 5. Worked Examples`

Real runs wherever possible; anything invented is labelled **constructed** and the reason given
(usually: the month held no case of the report's own red shape). Each example: an **Input** table ·
**Arithmetic**, shown · the **Expected row** as it renders · **Why this example exists** — the
defect it exists to prevent.

Close with a **full-month expectation**: every headline figure for one real run, so the build has
something to reconcile against.

---

### `## 6. Open Items`

`# · Item · Owner · Blocking?` — the Blocking column is the point. Resolved items stay, struck
through and marked **CLOSED**, with the answer.

### `## 7. Requestor decisions still open`

Separate from §6, and in prose. These are the business owner's, not the data team's. For each:
what this version implements, what the objection is, what each choice costs — and **"Your call"**.
Where a version deliberately did not act on an audit finding, say so here.
