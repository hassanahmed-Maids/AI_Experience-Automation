# What is missing to close all three documents — 2026-08-27

Three documents, three different kinds of "closed". Sorting them that way is the point: most of
what remains is **not** flow work, and two items are not yours at all.

---

## The single biggest gap, stated first

**Not one of the fourteen flow changes made this session has been executed against real data.**
Every one is verified by unit test, dry run and re-read — never by a run. No ERP token, and
`.env` is absent so `ask-code.sh` and the Snowflake helper cannot run either.

Nothing in the defect document can honestly be marked closed on that evidence. It can be marked
*built and unverified*, which is a different and weaker claim.

---

## Document 1 — Build Defects (17)

### Built in n8n this session (9)
D1 · D3 · D5 · D6 · D9/D16 · D10 · D12 · D17 — and D7 in part.

### Blocked on the scorer repo — appliers ready (3)
| | Effect |
|---|---|
| **D14** | 145 wrong reds, ~AED 54,000 of reported gap |
| **D2** | 42 wrong reds. Also ruling 2 of the change report |
| **D13** | 1 false duplicate; 8 → 7 maids |

These need the repo holding `audit/mv-monthly-payment/scorer.stage2.js`,
`n8n/build-score-node.js` and `test-node-parity.js`. Nothing this session can reach names that
repository or a git remote — the flows cite it only by path.

### Not started (4)
| | Sev | What it needs |
|---|---|---|
| **D15** CC Price live-out cohort | 1 | 944 contracts never scored, 29 failing. The only remaining defect where findings are *missed* rather than over-reported |
| **D4** MV gate ❼ | 2 | 778 opportunities, 0 fires. No wrong answers today; the rule is undemonstrable and collections lose the bounced-then-recovered list |
| **D8** Dummy run context | 2 | 63 rows with no `run_id` — in the table, in no report |
| **D7** part two | 2 | Out-of-scope housemaid charges should not be emitted as cases at all; they belong to Terminated Housemaids |

### Blocked on a read, deliberately (1)
**D11** — the report is explicit: read `ticketOutcome` on tickets 518157, 1857237 and 1169535
**before** changing anything. The answer decides build fix vs new rule. Five further findings
have no ticket matching the flagged amount at all.

---

## Document 2 — False Red Flags change report

Its §6 lists **six Hassan-build items**, and they are the same work under different names:

| §6 item | Maps to | State |
|---|---|---|
| #1 id ceiling — *ships first* | D1 | **Built** |
| #1 gate ❼, 0 of 778 | D4 | Not started |
| #3 three over-reaching findings | D11 | Blocked on the ERP read |
| #4 partial-reversal netting | D13 | Applier ready |
| Verifier degrades silently | D3 / D17 | **Built on all three** |
| Runs mixed, no supersession | D9 / D16 | **Built, and backfilled** |

**Two §6 rows are not yours.** Jacky owns #4's cancellation-paper ruling (`signedCancellationPaper`
reaches 2 of 77 and neither carries a 2026 document, so under the rule's own *Never* it clears
zero). The report's author owes the ILOE ❸ measurement.

### One thing to confirm rather than assume closed

**Ruling 11 says #2's repeat-review route is "dropped entirely — no threshold; the trigger
goes."** What is built is `repeat_bookings_off` defaulting to **on**, with the parameter kept so
the question can be measured deliberately. That removes the 731 zero-amount reviews, which is
the effect the ruling wanted, but the route is disabled rather than deleted. If you want the
ruling honoured literally, the code and its `STATE` entry come out.

### Most of the report is not flow work at all

Rulings 3, 6, 7, 8, 12, 14 and 16 land on checks **#6, #8, #9, #12, #13 and Wellcare** — Notion
spec edits (rule counts, tombstones, boundaries, scope statements), not n8n. None of the five
flows is touched by them. Add gate 17's tombstone from the D2 work to that list.

---

## Document 3 — Dead-End ERP Routes

Audited for the first time this session; every flow held on disk broke it.

| Flow | Route | State |
|---|---|---|
| MV Stage 2 | `payments/page/advancesearch` | **Swapped** to `payments/search` |
| MV Stage 1 / 0 | `clientmgmt/contract/search/page` | Not done — a rebuild, not a swap |
| Applicant · Dummy · Terminated HM | `transactions/page/advancesearchNew` | **No alternative exists** |

**The three on `advancesearchNew` cannot be fixed by us.** Section A needs new backend endpoints
— an ERP-team ask. Until then the document's own obligation applies and is *not* satisfied
today: each spec needs a **NO CONFIRMED NON-PAGE ROUTE** row, and any rule reading that field
must route to the verifier instead of concluding from it.

The document's own open items are also outstanding: sweep the thirteen specs against Sections A
and B, and measure `getReplacementHistory/{contractId}` once the ERP token is refreshed — the
only row that could leave the list without new backend work.

Not audited at all: CC Price Stages 1–2, MV Stage 4, and any stage not on disk here.

---

## So, to close everything

**Four keys unlock almost all of it:**

1. **An ERP token** — runs the flows (turning fourteen unverified changes into verified ones),
   settles D11, and measures `getReplacementHistory`.
2. **The scorer repo** — D14, D2, D13, and lets parity and the 140 tests run.
3. **`.env`** — `ask-code.sh` and Snowflake; unblocks the Stage 1/0 route rebuild by letting the
   replacement's response shape be read from the ERP source.
4. **Publishing Dummy Tickets** — its `activeVersionId` has not moved all session, so D7, D10,
   D16 and D17 are draft-only there.

**Then the build work that remains is four defects**: D15, D4, D8 and D7's second half.

**And these are not yours:** Jacky's cancellation-paper ruling, the author's ILOE measurement,
the ERP team's Section A endpoints, and the Notion spec edits across checks #6–#13.
