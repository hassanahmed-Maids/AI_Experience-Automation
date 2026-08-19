# n8n workspace hygiene for audit flows

Added 2026-08-19 at Hassan's instruction, and mirrored into the `erp-audit-flow-builder`
skill (`Workspace hygiene`, plus a "probe with curl, not with a flow" line in Phase 2).
It lives here as well because the skill copy sits in a synced directory outside this repo —
if that sync is one-way, this file is the durable record.

## The rule

The n8n project is shared. A check is not finished while the workspace still shows the
scaffolding it was built with; someone opening the project should be able to tell what runs
from what was scratch, without asking.

1. **Probe with `curl`, not with a flow.** A shell loop gives status, headers and byte
   counts in one place, leaves nothing behind, and iterates faster than editing nodes.
   Build a probe *flow* only for something genuinely n8n-specific — pagination behaviour,
   an expression, a credential binding.
2. **Leave only the flows the check needs, and leave them deployed.** For a staged build
   that is the stage chain plus its sub-workflows, nothing else.
3. **Archive every probe, preflight, diagnostic and one-off as soon as its answer is
   written down.** The answer belongs in the probe record; the flow that produced it does
   not belong in the project. Archive rather than delete — reversible, and the trail of
   what was tried survives.
4. **Name throwaways as throwaway when you create them** — `(throwaway)`,
   `(diagnostic)`, `PREFLIGHT - …`. Nobody remembers later which of eleven similar names
   was the scratch one.
5. **Only archive what your own work created.** Another stream's experiments get listed
   for their owner, not tidied away.
6. **Publish leaves first, parent last.** n8n refuses to publish a parent while any
   referenced sub-workflow is unpublished, and it names them. Never unpublish a child
   while a parent run is in flight.
7. **Deploying is not permission to run.** Publishing is a human decision, and it should
   be stated plainly what it exposes: a published webhook is reachable by anyone holding
   the URL and the shared secret.

Do the cleanup in the session that created the mess.

## Done 2026-08-19

Archived (recoverable from n8n's archive, nothing deleted):

| workflow | id | why |
|---|---|---|
| PREFLIGHT - CC Price by Cohort (throwaway) | `psroZBP7aFtiwnzz` | self-labelled throwaway; its probe results are recorded |
| READ PRICE CARD (throwaway) | `1kX3isU27HfmPMU0` | self-labelled throwaway |
| PPSS · ERP Probe | `ANxfLq7rrUqcouJ6` | read-only endpoint probe, superseded by `PROBE-RESULTS.md` |
| ERP Auth Probe (diagnostic — safe to delete) | `pzAtKIoVYy64iAAL` | its own description said so |
| LCP API Catalog Search (diagnostic) | `LkLetwdmRpuApMYV` | one-off catalogue lookup |

**Kept and published** — the CC Below Agreed chain, all six:

| workflow | id |
|---|---|
| WF-A · CC Monthly Payments Below Agreed Amount | `uJ8UVNKdN2s5PHHA` |
| WF-S · 0-Sweep Statuses | `D1mCMJuN9lMURJHb` |
| WF-P · 0-Sweep Payments | `M79KcC9vaHte5Ibi` |
| WF-E · 0-Enrich Candidates | `NDk03cYGF4XSXsk5` |
| WF-B · 2-Verify | `2LaIbHqQ1A2sEBKm` |
| WF-C · 3-Deliver | `yEF4BHYDZAnhBnYg` |

**Left alone, and flagged rather than tidied** — not this stream's to archive:

- `UY6oO1gC0rOqenc6` "CC Price by Cohort · setup result tabs" — a one-off that has already
  run, but it is the only record of how those tabs were created. Worth keeping until the
  price-by-cohort build is finished.
- The `ZZ *` scratch flows (`IwthgHiIv40FbLzO`, `I9KupNm36pBLBCMe`, `QPRKLiMCSu7IbDVK`) and
  the SDR experiments (`v10m1b7dcBwS71sB`, `TYUliva3dhgWqSAS`, `eUZ9U3V0jMsxT534`) belong to
  the SDR/expense work. They look like scratch; ask their owner.
