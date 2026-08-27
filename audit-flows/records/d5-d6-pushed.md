# D5 and D6 — pushed 2026-08-27

Both landed as a **new wrapper node**, not an in-place edit.

## Why a node instead of editing the wrapper in place

`jsCode` is a single parameter: changing three lines of the wrapper means rewriting the whole
node, ~700 lines of parity-guarded core included, with em-dashes and escaped regexes
throughout. A transcription slip there is exactly what `test-node-parity.js` exists to catch,
and I would have been relying on your test to catch my own typo.

So D5 and D6 went into **`Apply Scope & Gap Rules`**, sitting between `Score Contract Month`
and `Write Case Row`. Both are presentation rules — they change how a scored row is shown,
not how it is scored — so the placement is honest rather than merely convenient.

**Parity holds by construction: `Score Contract Month` was never written to.** Verified after
the push — its parameter set is still `jsCode, mode, notes`, the wrapper boundary appears
exactly once, and the core above it is 554 lines, `sha 94f9b4c6`. Only the node's position and
its node-group membership changed.

## D6 — the gap was never *clamped*, it was never *assigned*

An overpaid month concludes CLEAN at gate 6, which returns **before** `out.gap` is ever set,
so the writer's `typeof out.gap === 'number' ? out.gap : 0` supplied the zero. Every
overpayment reported a gap of exactly 0.

The node now carries the signed difference — negative means the client paid more than the plan
expected.

**One correction to the draft in the patch-kit README.** That version applied the difference
whenever both figures were known. That is wrong on a contract's **first month**: the core
suppresses the amount comparison there (`amountTestable = isNum(expected) && !isStartMonth`),
because a partial first month can legitimately receive less than a full instalment and still
be CLEAN. The draft would have printed a positive gap on those clean rows — re-manufacturing
the exact false-red shape D14 and D2 just removed. The shipped version reconstructs
`isStartMonth` and suppresses the gap there too.

That reconstruction duplicates one line of core logic in the wrapper, which is a real cost and
is called out in the node's comments: if the core's definition of a start month changes, this
must follow it.

If the paired-item lookup fails, the gap is left exactly as scored and the row says so in
`caps` — a silent wrong gap is worse than a loud unchanged one.

## D5 — a scoping decision is not a review queue

Gates 1 and 2 conclude INCONCLUSIVE for contracts outside the population entirely (not an MV
contract, the owner account) and for months outside the contract's life. The `STATE` map sent
all of them to `pending` / "Awaiting reviewer": 211 out-of-scope contract-months in a queue
nobody watches, 181 with `needs_human` false, so nothing would ever have summoned a reviewer.

They now conclude `state = 'out_of_scope'`, `verdict = 'Out of scope'`.

**Scoped to gates 1 and 2 only, deliberately.** Gate `surface` (ERP unreadable), gate 5
(`is_pre_collected` unreadable) and gate 4's no-rows-no-expectation are *also* inconclusive and
they **belong** in the reviewer queue — they are things the check could not READ, not things it
declined to JUDGE. Testing `state === 'pending'` instead would have hidden real read failures
behind a scope label, which is the worse error.

## The consequence I did not leave silent

D5 means `green + red + pending` no longer sums to `cases_written`. Left alone, a reader would
have discovered that by subtraction. So:

- **Stage 2 `Chunk Summary`** now reads the post-rule node (reading the scorer would have
  counted every out-of-scope row as pending and undone the change one node upstream) and
  counts `outOfScope` separately.
- **Stage 3 `Aggregate Run`** counts it and declares it in `notes`: *"N contract-month(s)
  concluded OUT OF SCOPE at gate 1 or 2 … so those three deliberately do not sum to it."*
- **Stage 3 `Run Report`** surfaces `total_out_of_scope`.

No Runs-table column was added — that needs a schema change — so the count rides in `notes`
(a real 950-char column) and in the report payload.

Checked first: **Stage 1 does not consume the chunk tallies**, only `ok === true` and the chunk
count, so no sum assertion breaks.

`outstanding_aed` was deliberately left as `g > 0`: now that gaps are signed, letting an
overpayment on one contract cancel a shortfall on another would understate the exposure.

## Verification

- Core untouched, confirmed post-push (parameters `jsCode, mode, notes`; core 554 lines,
  `sha 94f9b4c6`).
- All three edited/new bodies parse (`new Function`).
- **16/16 unit tests on the new node**, covering every gate shape: gates 1 and 2 go out of
  scope; `surface`, 5 and 4 stay in the reviewer queue; overpayment yields −200 where it used
  to yield 0; a partial START month yields no invented gap at gates 6 and 7; reds at 8 and 17
  keep their existing gaps; gate 15 now shows the real in-flight gap; rounding is 2dp with no
  float dust; a failed lookup leaves the gap alone and says so.

**Not run from here:** the 140-test offline suite and `test-node-parity.js`. Parity should pass
untouched — the core is byte-for-byte what it was — and that is the claim worth confirming
first.
