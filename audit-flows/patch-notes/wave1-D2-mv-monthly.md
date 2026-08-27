# Wave 1 · D2 — MV Monthly Payment · Stage 2 (`CopNHNsXUzFO59bW`) · node **Score Contract Month**

> ## ⚠ DO NOT APPLY THIS IN n8n
>
> Both edits land in the **scoring core**, above the `// ── n8n Stage 2 wrapper ──`
> line. That core is kept byte-identical to `audit/mv-monthly-payment/scorer.stage2.js`
> so the 140-test offline suite can run against it — and the node's own note is
> explicit that even *a comment only n8n has would break that*.
>
> **Apply both edits to `audit/mv-monthly-payment/scorer.stage2.js`, run the 140-test
> suite, then push the core back to the node.**
>
> Editing the node first would put the shipped body and the tested source out of
> sync, which is the one thing that file's whole convention exists to prevent.

Grounding: 240 real contract-months of ledger rows from execution 94336
(2026-08-19). The finding that shapes this patch:

> **Exactly one `monthly_payment` row per contract-month — 240 of 240, zero
> exceptions.** Each row carries `amountOfPayment`, which is what the client was
> invoiced for that month. Schedules run ~120 months out: future months sit as
> `PDC`, past ones as `RECEIVED` or `DELETED` (100 / 38 / 102 in the sample).

So "that month's own scheduled amount" is unambiguous, and it is already in the
payload the scorer reads to compute `paid_total`. **No salary lookup is needed** —
ruling 2 of 25 Aug speaks of "the salary embedded in that month's schedule row",
but the ledger row carries no salary field. It carries the billed total, which is
the figure the comparison actually wants.

---

## Edit A — new helper, beside `sumReceived`

**Insert after `function sumReceived(rows) { … }`:**
```js
// The month's BILLED total. One monthly_payment row per contract-month is the
// observed shape (240 of 240 in execution 94336), so this is normally a single
// row's amountOfPayment; it sums defensively in case a month ever carries more.
//
// DELETED is excluded on purpose: a deleted instalment is a WITHDRAWN bill, not
// a bill of zero. A month whose only row is DELETED therefore has no ledger
// expectation and falls through to the plan, where gates 4 and 8 judge it
// exactly as they do today. (Rule ⓴ - a withdrawn instalment is not an unpaid
// month - is a separate, unbuilt change and is deliberately NOT smuggled in
// here.)
function scheduledForMonth(rowsInMonth) {
  // A REPLACED dead row is the same bill as its successor, not a second bill.
  // Measured across 11,501 contract-months / 102 contracts: 987 months carry
  // more than one monthly row, and every dead row inside them is
  // BOUNCED + replaced === true - 85 of 85, no exceptions. Summing those
  // alongside their replacement doubles the month's bill and manufactures a
  // shortfall exactly equal to the bounced instalment. That mistake produced 85
  // false reds in this sample, i.e. worse than the 42 this patch removes.
  const live = rowsInMonth.filter(function (p) {
    const s = statusOf(p);
    if (s === 'DELETED') return false;
    if (STATUS_DEAD.indexOf(s) !== -1 && p.replaced === true) return false;
    return true;
  });
  if (!live.length) return { amount: null, rowCount: 0, allDeleted: rowsInMonth.length > 0 };
  let total = 0;
  for (const p of live) {
    const a = parseMoney(p.amountOfPayment);
    if (!isNum(a)) return { amount: null, rowCount: live.length, unreadable: true };
    total += a;
  }
  return { amount: Math.round(total * 100) / 100, rowCount: live.length, allDeleted: false };
}
```

---

## Edit B — read the rows first, then take the expectation from them

**Find:**
```js
  out.gatesRun.push('9', '11', '12');
  const exp = deriveExpected(contract);
  out.expected = exp.expected;
  out.expectedSource = exp.source;
  if (exp.crossCheckOk === false) {
    out.caps.push('split does not reconcile with currentPayment.amountValue');
    out.needsVerifier = true;
  }

  const rows = monthRows(payments, mk);
  if (rows.unassignable.length) {
    out.caps.push(rows.unassignable.length + ' monthly row(s) carry no dateOfPayment');
    out.needsVerifier = true;
  }

  const received = sumReceived(rows.inMonth);
```

**Replace with:**
```js
  out.gatesRun.push('9', '11', '12');

  // Rows are read BEFORE the expectation now, because the month's ledger row IS
  // the expectation. Reordered 2026-08-26.
  const rows = monthRows(payments, mk);
  if (rows.unassignable.length) {
    out.caps.push(rows.unassignable.length + ' monthly row(s) carry no dateOfPayment');
    out.needsVerifier = true;
  }

  // --- EXPECTATION: what the client was BILLED for this month --------------
  // Was: currentPayments[].workerSalary + visaFees - the contract plan as it
  // stands TODAY, applied to a month in the past. When a maid's salary rose in
  // July, every earlier month read short by the difference; 42 of 42
  // amount-mismatch reds were clients who had been billed an amount and had paid
  // exactly that amount to the dirham.
  //
  // Now: the month's own monthly_payment row. Ruling 2 of 2026-08-25,
  // implemented against the real ledger - the row carries no salary field, it
  // carries the invoiced total, which is the figure the comparison wants.
  const plan = deriveExpected(contract);
  const sched = scheduledForMonth(rows.inMonth);
  out.scheduledAmount = sched.amount;
  out.scheduledRowCount = sched.rowCount;

  let exp;
  if (isNum(sched.amount)) {
    exp = { expected: sched.amount, source: 'ledger: monthly_payment row for ' + mk };
  } else {
    // Ruling 2's accepted residual, recorded on the row rather than argued away:
    // with no live schedule row the fallback reproduces the original
    // point-in-time bug, and a gap resting on it reds like any other.
    exp = { expected: plan.expected, source: plan.source ? 'fallback ' + plan.source : null };
    if (isNum(plan.expected)) {
      out.caps.push('no live schedule row for ' + mk + ' - expectation fell back to the current plan, which cannot see a past salary');
    }
  }
  out.expected = exp.expected;
  out.expectedSource = exp.source;

  // Rule ❾ (Order 180) - the plan's internal cross-check, now a HARD gate but
  // correctly scoped. The plan is no longer the basis, so its failing to
  // reconcile with itself only endangers a verdict when the fallback is
  // carrying the month.
  if (plan.crossCheckOk === false) {
    out.caps.push('split does not reconcile with currentPayment.amountValue');
    out.needsVerifier = true;
    if (!isNum(sched.amount)) {
      return conclude(VERDICT.INCONCLUSIVE, '9',
        'the contract plan does not reconcile with itself and there is no schedule row to fall back on', {
        needsVerifier: true,
      });
    }
  }

  // The plan and the invoice disagreeing IS a real signal - the company raised a
  // salary and went on billing the old figure - but it is a billing failure, and
  // pricing was ruled permanently out of scope for this check on 2026-08-17
  // ("we don't care about the pricing, as long as the client paid what he was
  // supposed to pay, mark it as closed"). So it is recorded and handed to a
  // human, and it never opens a case here. See OPEN QUESTION in the patch notes.
  if (isNum(sched.amount) && isNum(plan.expected) && cmpMoney(plan.expected, sched.amount) !== 0) {
    out.billedVsPlanGap = Math.round((plan.expected - sched.amount) * 100) / 100;
    out.caps.push('the plan derives ' + plan.expected + ' for this month but the client was billed ' +
      sched.amount + ' - a BILLING discrepancy, not a collection one');
    out.needsVerifier = true;
  }

  const received = sumReceived(rows.inMonth);
```

Everything downstream keeps working unchanged: `exp.expected` is still the name
gates 6, 7, 15, 4, 8 and `amountTestable` read.

---

## Notes

**No schema change.** `Write Case Row` maps an explicit field list, so
`scheduledAmount` and `billedVsPlanGap` are internal only — the information
reaches the table through `caps` (a real column, 900 chars) and
`expected_source`. Deliberate: adding columns to the Cases table is a separate
change, and this flow already warns that a verdict computed and then lost is the
worst outcome available.

**Two conflicts resolved in favour of the older ruling.** Build Defects D2 says
the plan-vs-invoice disagreement "is the finding". The 2026-08-17 ruling says a
mispriced-but-paid plan is clean, "full stop", and calls pricing permanently out
of scope for this check. The patch records the disagreement and raises a hand
without opening a case — which satisfies both.

---

## MEASURED — gate 17 is unreachable, and that is now a finding not a question

The earlier draft of this patch left gate 17's reachability open. It has since
been measured offline against **11,501 real contract-months / 102 contracts**,
aggregated from the retained ledger reads of executions 94327–94336.

| basis | gate 17 fires |
|---|---|
| sum of all non-DELETED rows *(the first draft of this patch)* | **85** — all of them bounce/replace pairs, i.e. false |
| excluding dead rows with `replaced === true` *(shipped version above)* | **0** |

So under the corrected basis, "the client paid less than they were billed" does
not occur once in 11,501 contract-months. A monthly instalment clears or it
bounces; it is never partly paid. The 42 amount-mismatch reds were 100% artefact
of the point-in-time salary, and removing that artefact leaves the gate with no
live population at all.

**This is the D4 shape again**, and standing rule ③ applies: a red verdict needs
at least one real case. Gate 17 should be recorded as *measured unreachable on
102 contracts / 11,501 contract-months (2026-08-26)* — retained as a guard, like
❼'s "genuine fail-safe with no live case", but never again cited as a source of
findings. It stays in the chain; what changes is that the page stops implying it
finds things.

No ruling is needed to ship the patch — the 42 stop either way. The ruling that
is still owed is only whether gate 17 is tombstoned or retained as a guard, and
that is a page edit, not a build change.

## Acceptance

- Contracts 1014340, 1047402, 1047611 and 1048662 go clean.
- `amount mismatch` count falls from 42 towards zero on a re-run of the same window.
- Every row scored from the ledger carries `expected_source` beginning `ledger:`.
- Rows on the fallback say so in `expected_source` and in `caps`.
- Count gate-17 fires and report them — see the open question.
