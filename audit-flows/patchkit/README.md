# Patch kit — the four defects behind the parity guard

Four scripts, no repo access needed. Each one **asserts every anchor matches exactly
once, syntax-checks the result, and writes `<file>.patched` — or writes nothing and
exits 1.** It never edits in place, so a drifted source fails loudly instead of half-
applying.

The anchors were lifted from the *deployed node bodies*, which state they are inlined
verbatim from these sources. If an anchor misses, your source has drifted from what is
running in n8n, and that is worth knowing before anything else.

```
node apply-D14-cc-price.mjs      <scorer-month.js> <build-score-node.js>
node apply-D2-mv-scorer.mjs      <audit/mv-monthly-payment/scorer.stage2.js>
node apply-D13-terminated-hm.mjs <the Terminated HM offline scorer>
```

Then, per the CC header: `node n8n/build-score-node.js && node test-node-parity.js`,
plus the 140-test MV suite and the Terminated HM 79 assertions.

---

## Verification already done here

| | Check | Result |
|---|---|---|
| **D14** | Applier run against the real deployed body | Reproduces the patched body byte-for-byte, `sha 6a9a9552` — the same one verified earlier |
| **D14** | Cross-check logic vs 60 live contracts (exec 94326) | **38 agree, 0 fire, 22 no ERP figure.** All ten bounded-line contracts pass unflagged |
| **D2** | Shipped `scheduledForMonth` vs 11,501 real contract-months | **0 gate-17 fires**, including all 987 multi-row months. 612 fall back to the plan |
| **D13** | Applier run against the live body | Reproduces the unit-tested region, `sha ab04e7cc` |
| **D13** | `netReversals` unit test, 5 cases | Maid 29463 nets (fee 271.20, flagged above floor); best-fit picks 1,300 over 3,000; no-counterpart and no-Ex-ref park correctly |

What I could **not** do: run your 140-test suite, the 79 assertions, or
`test-node-parity.js`. Those are the gate.

---

## D2 — read this before you apply it

**The first version of this patch was wrong and would have shipped 85 new false reds.**
It summed every non-DELETED row, which counts a bounced instalment *and* the replacement
raised against it — doubling the month's bill and inventing a shortfall exactly equal to
the bounce. Across 11,501 contract-months, every dead row inside a multi-row month is
`BOUNCED` with `replaced === true`, 85 of 85. The shipped version excludes them. If you
see a `scheduledForMonth` without that exclusion, it is the bad draft.

**Gate 17 is now measured unreachable.** 0 fires in 11,501 contract-months under the
corrected basis. A monthly instalment clears or it bounces; it is never partly paid. So
the 42 amount-mismatch reds were 100% artefact, and removing the artefact leaves the gate
with no live population — the same shape as D4's gate 7. Standing rule ③ says a red needs
a real case, so gate 17 wants recording as *measured unreachable on 102 contracts /
11,501 contract-months (2026-08-26)*, retained as a guard but no longer cited as a source
of findings. That is a page edit, not a build change, and it does not block shipping.

**Two rulings collide and I resolved it toward the older one.** Build Defects D2 says the
plan-vs-invoice disagreement "is the finding". The 2026-08-17 ruling says a
mispriced-but-paid plan is clean, "full stop", and puts pricing permanently out of this
check's scope. The patch records the disagreement on the row and sets `needs_human`, but
never opens a case. Flip it if you disagree — it is one `if`.

---

## D5 and D6 — not in this kit, and not behind the guard

Both live in the **n8n wrapper**, below the `// ── n8n Stage 2 wrapper ──` line that marks
the end of the byte-identical core. Neither needs `scorer.stage2.js` touched.

**D6** — the gap is never *clamped*; it is never *assigned*. An overpaid month concludes
clean at gate 6, which is before `out.gap` is set, so the writer's default supplies the 0:

```js
gap: typeof out.gap === 'number' ? out.gap : 0,
```

Fix in the wrapper — carry the signed gap when both figures are known:

```js
gap: (typeof out.expected === 'number' && typeof out.received === 'number')
  ? Math.round((out.expected - out.received) * 100) / 100
  : (typeof out.gap === 'number' ? out.gap : 0),
```

**D5** — gate 2 concludes `INCONCLUSIVE`, which the wrapper's `STATE` map sends to
`pending` / "Awaiting reviewer" with `needs_human` false: 211 out-of-scope contract-months
parked in a queue nobody watches, 181 with the flag down. Fix in the wrapper by giving
gate 2 its own state rather than the reviewer queue — CC Price already treats scope as a
third outcome, so the precedent is in the same codebase:

```js
const monthKeyed = out.monthUnderTest || inp.auditedMonth;
// D5: a scoping decision is not a review queue.
const isOutOfScope = out.gate === '2' || out.gate === '1';
const stateOut = isOutOfScope ? 'out_of_scope' : (STATE[out.verdict] || 'pending');
const verdictOut = isOutOfScope ? 'Out of scope' : (DISPLAY[out.verdict] || String(out.verdict || ''));
```
…then use `verdictOut` / `stateOut` in the returned row.

**I did not push either**, for one reason: I cannot tell whether `test-node-parity.js`
compares only the core or the whole node body. If it is core-scoped, say so and both go in
within a minute — they touch no source file. If it compares the whole body, they belong in
whatever template generates the wrapper.

Note that D5 changes what Stage 3 counts: out-of-scope rows stop landing in `pending`, so
`green + red + pending` becomes less than `cases_written`. That is informative rather than
wrong — it is exactly how CC Price reports scope — but the Stage 3 summary does not
surface an out-of-scope count yet.

---

## Order

1. **D14** — 145 wrong reds, the largest single reduction available.
2. **D2** — 42 wrong reds, and it converts them into a real finding about stale billing.
3. **D13** — one false duplicate; the duplicate list goes 8 → 7 maids.
4. **D5 / D6** — wrapper-only, waiting on the parity-scope answer.
