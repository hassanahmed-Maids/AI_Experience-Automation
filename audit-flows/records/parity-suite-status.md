# `test-node-parity.js` and the 140-test suite — I cannot run either

## Why

Neither exists anywhere this session can reach. Checked, not assumed:

- **`/home/user/AI_Experience-Automation`** — the CustomerIO migration repo. Contents are
  `.claude/`, `docs/`, `scripts/`, `CLAUDE.md`, `.env.example`. No `audit/`, no `n8n/`, no
  `package.json`, no test runner.
- **Whole filesystem** — `find /` for `test-node-parity.js`, `build-score-node.js`,
  `scorer.stage2.js` returns **one** hit, and it is not a source file: it is the *deployed CC
  Price node body* I pulled out of n8n earlier today to build the D14 patch kit.
- **Repos this session can attach** — `list_repos` returns exactly two:
  `hassanahmed-Maids/AI_Experience-Automation` and `Maids-cc-ppss/PPSS-Plugin`. The scorer
  repo is neither.

So the honest answer is: **not run.** What follows is what I could substitute, and what it
does and does not cover.

## What I ran instead

### 1. Parity, argued from the push itself — not from inspection

`update_workflow` is operation-based, not a document replace: nodes no operation names are
carried through by the server untouched. **Not one operation in the D5/D6 push targeted
`Score Contract Month`.** The eight were: two `setNodePosition` (Write Case Row, Chunk
Summary), one `addNode`, three connection ops, one `setNodeParameter` on Chunk Summary's
`jsCode`, one `setNodeGroups`.

Confirmed after the fact: the node's parameter set is still exactly `jsCode, mode, notes` —
no key added, none dropped.

### 2. Parity, spot-diffed against n8n's own pre-push record

I pulled version `5d397345` (the state before the push) from n8n's version history and
checked **25 distinctive lines** of its `Score Contract Month` body against the post-push
core — chosen to cover the fragile things: every em-dash reason string, the escaped regexes
(`/[^0-9.\-]/g`, `/^(\d{4})-(\d{2})/`, the `MONTHLY_BUCKET` alternation), and all 21
`conclude()` call sites.

**25 of 25 match exactly.** One initially reported missing; that was my anchor written with
4 spaces where the nested `if` indents to 6 — my transcription, not a difference in the file.

Post-push core: **554 lines, 15 em-dashes, 18 function declarations, 21 `conclude()` sites,
`sha256` prefix `94f9b4c6`.**

This is strong evidence, not proof. Proof is your parity test, which compares the node
against what `build-score-node.js` generates — a comparison I cannot make without the
generator.

### 3. The 140-test suite is not the right gate for this change anyway

That suite exercises `scorer.stage2.js` — the **core**. The core did not change, so the
suite's result cannot have changed. It also would not have covered D5 or D6, which are
wrapper rules and live outside what it tests.

What does cover them is the **16-test file** shipped with the last message, run against the
deployed node body: gates 1 and 2 out of scope; `surface`, 5 and 4 still in the reviewer
queue; overpayment −200 where it used to be 0; no invented gap on a partial start month at
gates 6 and 7; reds at 8 and 17 unchanged; gate 15's real in-flight gap; 2dp rounding; failed
lookup leaves the gap alone and says so. **16/16.**

## What you need to run, and what I expect

```
node n8n/build-score-node.js     # CC Price only - unrelated to today's MV change
node test-node-parity.js         # THE gate for MV Stage 2
npm test                         # or however the 140-test suite is invoked
```

Expected: **both pass unchanged.** Neither the MV core nor `scorer.stage2.js` was touched
today. If parity fails on MV Stage 2, something other than this push moved it — and I would
want to see the diff, because nothing here should have.

Note the parity test compares the node to the generator's output. If it has ever been run
against a node whose *wrapper* differed from the generator's wrapper template, it is
whole-body after all and this change would trip it — in which case D5/D6 belong in whatever
template emits the wrapper, and I will move them.

## Still unrun from earlier waves

The D14, D2 and D13 appliers in the patch kit were verified by reproducing the deployed
bodies byte-for-byte and by measurement against real ERP/ledger data, but their suites — the
140 tests, the Terminated HM 79 assertions, and parity — are on your side too.
