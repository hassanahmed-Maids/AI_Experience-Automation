# P&C decisions to settle before the tickets are filed

Every open item across the seven specs that **P&C owns** — Hassan, Abdullah or Malaz. Items owned by
Finance, the Visa team, Mohammad Khalil or the Snowflake team are not here; they do not stop a ticket.

Each row has a recommendation. Say yes, or say otherwise — either way it takes one pass.

---

## A · Three that change what gets built

These change the model or the page, so DNA needs the answer in the ticket, not after it.

| # | Question | Recommend | What changes |
|---|---|---|---|
| **A1** | **Does P&C save a review status against a case?** Marking a case *Under review / Escalated / Closed*, with an assignee and a note. A write-back makes this an application rather than a dashboard. *(COS O2 — the spec says the Snowflake team must know before they build)* | **Yes.** Auditors work cases one at a time over a month; without it, two people work the same row and neither can tell. One writable table, `T_CASE_REVIEW`, and it never touches a computed column | With: ①A ships `T_CASE_REVIEW`, and ② gets the review filter and assignee column. Without: both come out, and the page is read-only |
| **A2** | **May a verifier's redacted quote be shown on the page?** The AI verifier reads complaint threads and staff notes and returns a quote with names, phones and ids replaced by `[placeholder]` at the model. Showing it is what makes a verdict checkable. *(COS O12, and the same question in three other specs)* | **Yes, quote only, in the drill-down.** The redaction happens at the model, before the text leaves; the alternative is a verdict nobody can audit. **Not** in the CSV export | With: the drill-down shows the quote. Without: verdict and category only, and a reviewer must open ERP to check any verdict |
| **A3** | **Where does the assurance surface live?** The tie-outs, the baseline comparison and the coverage tables have no home since the Assurance tab came out. Every spec requires its tie-out be **displayed**, and a non-zero variance is itself a finding | **A collapsed strip at the top of each audit tab** — silent and grey when everything ties, a red bar when it does not. Costs nothing when things are fine, and cannot be missed when they are not | ② needs the strip in scope. Without it the dashboard computes tie-outs and shows them nowhere, and an unmeasured leg reads exactly like a working check |

---

## B · Nine that move a number

Answering these changes a figure in a ticket's acceptance criteria, so they are worth settling first.

| # | Question | Recommend | Money |
|---|---|---|---|
| **B1** | **R-visa: are the three refund-before-duplicate cases corrections or duplicates?** Currently held blocked as correction cycles — she paid, was partly refunded, paid again. *(R-visa §6.9)* | **Keep them blocked.** A refund that predates the second payment reads as a correction cycle, and the conservative call is the publishable one | Treating them as confirmed adds **AED 1,330.50** to Duplicated and **AED 618.50** to Refunded |
| **B2** | **R-visa: are cleaners in scope?** Head `149` covers cleaners, whom `OWNER_TYPE = 'HOUSEMAID'` selects. *(R-visa §6.10)* | **In.** The company paid a residence-visa fee for a person it sponsors. That is the same failure whatever the job title | Changes the population, not a headline. 211 transactions on head 149, zero negatives |
| **B3** | **R-visa: confirm duplicates are treated as loss.** The ruling stands, and the evidence is now stronger than when it was given — recovery is **partial by design**, ~239.50 against a 443.50 fee, and **never full in 15 of 15 observed cases.** *(R-visa §6.1)* | **Confirm.** The ~204 residue per case is unrecoverable, so a refunded duplicate is still a loss | Underpins `RV.M3` — **AED 16,853.50** |
| **B4** | **R-visa: is the S1 re-payer defect one process defect or twenty findings?** An initial request is opened for a maid whose renewal is already in flight, and the fee is charged again. *(R-visa §6.14)* | **One process defect.** The exposure is AED 8,870 either way; filing it as twenty findings means nobody is asked to fix the cause, and the cause is a missing ERP guard | AED 8,870, and whether a guard gets requested |
| **B5** | **R-visa: does overstay belong to this check?** The Security Room roadmap says yes; the spec moved it off on the Alert-931 tariff evidence — R-visa is marked *"May include Fines? = FALSE"*, and overstay has its own column and its own sibling checks. *(R-visa §6.17)* | **Keep it off, and correct roadmap row #12.** R-visa keeps the Modification-fine leg only | Prevents the same overstay money being counted here and in the CC/MV overstay checks |
| **B6** | **R-visa: accept R1 as an ERP gap?** The roadmap wants a rejected-R-visa refund check at 60 days. The ERP exposes no rejection status and no refund-request field for R-visa, so it cannot be built from the warehouse. *(R-visa §6.18)* | **Accept as carried out of coverage**, and raise the ERP change separately. Entry visa and medical both have this check; R-visa cannot | Nothing today. It stops the leg being silently absent |
| **B7** | **LAWP: proceed on the `HOUSEMAID_TYPE` proxy for PAWP?** There is no reliable bundle-level flag; the real one is an ingestion ask. *(LAWP open 1)* | **Yes, with the caveat printed on the tab.** The alternative is not running the check | Some PAWP bundles sit in the population and nobody can say how many |
| **B8** | **E-ID: is the amber duplicate band worth chasing?** Gaps of 121–599 days — an early re-application, not the 0–120 duplicate cluster and not the 600+ renewal cycle. *(E-ID open 3)* | **Yes, keep it amber and route it to the verifier.** It is the band the verifier exists to resolve | **47 pairs, AED 16,633.77** |
| **B9** | **Medical: how far back should recovery run?** Findings exist from 2024, but the portal window for claiming a 2024 refund has almost certainly closed. *(Medical §14)* | **Show 2024 separately, labelled "historical leak, not recoverable".** Keep `MED.M1` at Jan 2025 onward so the headline stays collectable | Protects **AED 39,910** from being read as larger than it is |

---

## C · Six that decide who works a row

No money moves. Each one decides whether a red row has somebody to go to.

| # | Question | Recommend |
|---|---|---|
| **C1** | **R-visa: who owns the preventive guard?** Detection is P&C's and settled. The guard sits at one identified place — the *"Apply for R-visa"* task, in both the initial and renewal pipelines. *(R-visa §6.4 — Hassan / Malaz)* | **Recommend it to whoever owns that task; do not block the report on it.** P&C detects, the ERP team prevents |
| **C2** | **R-visa: who owns the term-mismatch class?** 25 cases, a different kind of loss from duplication, and currently nobody's. *(R-visa §6.15)* | **P&C holds it, Visa acts on it** — same split as every other refund leg |
| **C3** | **R-visa: do single-payment cases with an unexplained amount belong to anyone?** 221 population payments sit at amounts the fee schedule rejects. They are not duplicates, so no test here looks at them, and the **price-accuracy audit they belong to does not exist**. *(R-visa §6.11)* | **Name them as out of scope now, and raise the price-accuracy check as a separate roadmap item.** Do not widen this one |
| **C4** | **COS: who corrects a wrongly-headed charge?** R7 found 3 since Dec 2025. Is one re-posted to the right head, or only reported? *(COS O4)* | **Report only.** Re-posting is an accounting correction and belongs to whoever owns the ledger, not to the audit |
| **C5** | **COS: does a credit note raised against an overstay fine count as relief?** Today only a reduction **on the fine** clears a case; a credit note is displayed and clears nothing. *(COS O11)* | **Leave as is.** If it changes, it needs a formula and a matching rule, and until then such a case correctly reads red |
| **C6** | **COS: should `COLLECTED` accept a payment on any of the maid's non-fake contracts, or only the one running on the charge date?** *(COS O9)* | **Any contract.** Narrowing it risks dropping a payment made by the prior client after a handover. One July case, AED 400, is matched this way |

---

## D · Seven confirmations

Nothing changes if you agree. They are here so nobody discovers them later.

| # | Item | Confirm |
|---|---|---|
| **D1** | **Entry visa: nobody expects a backfill before 2025-09-05.** No dated immigration rejection exists earlier, so nothing before it can be audited. *(EV O4)* | ✅ |
| **D2** | **Entry visa: the roadmap's AED 12,929,222 is not recoverable.** Measured exposure is **AED 137,043** over 12.3 months — about **94× smaller**. The roadmap figure must never be quoted as recoverable. *(EV O5)* | ✅ and correct the roadmap |
| **D3** | **Entry visa: a negative "days unclaimed" needs a rule.** 19 refund claims are dated **before** their turn-down stamp, up to 74 days. Probably the same posting-lag family. *(EV O2b)* | **Display as `0` and flag the row**, rather than showing a negative age |
| **D4** | **COS: the R1 window has fired twice in nine months** and the prior-month lookback has never added a case. Over ten years the same maid was charged twice inside 90 days 26 times, so the rule is real but rare. *(COS O5)* | ✅ keep, revisit if it stays empty |
| **D5** | **COS: only July has been worked case by case.** R10 was found in August and R5 has never fired, so two of the ten rules rest on aggregates. *(COS O10)* | ✅ acknowledged on the tab |
| **D6** | **E-ID: the 5 `UNCLASSIFIED` rows, AED 3,295.85** — name them, or confirm they park as pending. *(E-ID open 2)* | **Park as pending.** A rising unclassified count is the signal that the expense names changed again |
| **D7** | **E-ID: 52 repeat-E-ID requests in `MAID_SERVICES` have no matching charge** — the only independent completeness check audit 3 has. *(E-ID open 5)* | ✅ publish the count on the tab |

---

## Not ours — for information

These are real and they are somebody else's. None stops a ticket being filed.

| Item | Owner | Worth |
|---|---|---|
| **Does MOHRE insurance attach to the paperwork or to the person?** | Mohammad Khalil | **AED 383,177.57** |
| What does a one-year E-ID cost? | Visa team | Decides whether E-ID's 58 term cases are a finding at all |
| Sign off the R-visa fee schedule, the 50-dirham step, `293.50` and the refund amounts | Finance | Every R-visa money figure |
| Do failed Credit_Card charges reverse outside the ERP? | Finance / card-flow owner | AED 4,878.50, 11 cases at once |
| `Active_Visa` and `Another_Issue` — turn-downs or not? | Visa team | Would widen entry visa `EV.M1` |
| Is the 2020 batch reading correct? · Long-gap cases (N2) | Visa team | 18 and 12 R-visa cases |
| Reconcile COS `M1`/`M8` against the approved P&L lines | Snowflake team | `OPENFLOW_DB` is not readable under `MONEY_CONTROL_ROLE` |
| Ingest the MV client recharge route | Snowflake team | AED 58,649.84 across 131 E-ID cases |

---

**Once A, B, C and D are answered I fold every one into the tickets** — A1 and A2 change ①A's scope,
A3 changes ②'s, B1–B9 change acceptance criteria, C1–C6 fill the `ACTION_OWNER` column — and then
the pack is ready to file.
