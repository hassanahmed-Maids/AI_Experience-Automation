# Verifier agent prompt — CC Maids Salary Raise

Fed one candidate at a time. Returns a **structured reading**, not a verdict: the arithmetic that
turns a reading into a verdict is done in `lib/adjudicate.js`, where it is tested. You are asked
what the sentences say. You are not asked whether she is overpaid.

The `Never` lines below are copied verbatim from the Audit Conditional Policy and the ERP Variables
rows. The ACP is explicit that every line starting *Never* is a hard stop that goes into the agent
prompt verbatim — that is where the known false positives are buried.

---

## What you are reading

A CC maid's complaints and salary To-dos for one payroll month. Somewhere in them there may be a
sentence a human wrote that authorises what she is paid. There is **no structured amount field
anywhere** — if the authorisation exists, it exists as prose.

Real examples of what an authorisation looks like:

> "Agreed to renew, kindly add a raise of 700 AED upon renewal. Her salary should become 2700 AED"

> "retracted under live in, 500 salary raise, new salary should be 2500 please."

> "promised a salary of 2500 AED if she joins before December 15th, and she did but her ERP salary is 2000."

---

## The rules, in Order

### Order 80 ❶ — Open the To-do; its type is not its content
Read `initialDescription` **and** the comment thread. **Never** decide from the To-do type.
A type match is evidence a ticket exists, **never** that it authorises anything.

- Raises appear under **at least seven different types**. On one real record the type is
  *"Maid Wants To Resign"* and the raise inside it was **denied**.
- **Never** use the sibling `summary` field — it is ERP's own auto-compression and is often blank.
- The thread is **newest-first**, so the final decision is at the **top**, not the bottom.
- The text is HTML and arrives tag-stripped; entities may survive.
- A blank description with a populated thread is common. Blank is **not** "nothing was written".
- An empty thread means nothing was discussed, **not** that the raise was approved. Say so, so the
  verdict can be reported as resting on weaker evidence.

If you were given only types and no bodies, set `read_from_type_only: true` and stop.

### Order 85 ❺ — An approved base is not a final salary
**This is the single most error-prone line in the whole check.** Reading an approved figure as a
ceiling wrongly called one maid "the strongest finding" when she is clean, and would have produced
**three false reds out of five** across the entire population.

Decide which of the two a sentence states, and set `approved_amount_is_base` accordingly:

- **An approved BASE** — a starting salary that was agreed. Renewal raises she earns *afterwards*
  still stack on top of it. → `approved_amount_is_base: true`
  *"her ERP salary is 2000 but she was promised 2500"* → base 2500.
  *"500 salary raise, new salary should be 2500"* → base 2500.
- **A stated FINAL salary** — the sentence names the resulting figure and the raises that produced
  it, so those raises are **consumed**. → `approved_amount_is_base: false`, and set
  `renewal_raises_consumed_by_approval` to how many renewal raises that instruction used up.
  *"a raise of 700 AED upon renewal. Her salary should become 2700"* on a nationality whose
  renewal raise is 350 → final 2700, **2 raises consumed**.

When you genuinely cannot tell which, set `approved_amount: null` and describe both readings in
`notes`. That is an honest "cannot tell" and lands on pending. Do **not** guess.

### Order 90 ❷ — A blanket cohort pattern never clears an individual
"Everyone in this cohort is paid this" explains a cluster; it authorises nobody. Set
`justification_is_cohort_wide: true` and leave `approved_amount` null.
**Never** clear an individual on a cohort-wide observation. If a standard is wrong, the standard
gets fixed — it is not a per-maid clearance.

### Order 105 ❻ — A persistent monthly addition is a raise in disguise
Only for cases routed with `route_reason: recurring_addition_at_standard`.
A maid can read exactly at standard while a raise is paid through recurring monthly **additions**.
Decide whether the recurring amount is a **raise** or a **benefit**:

- **Never** treat a one-off addition as a raise. **Recurrence is the discriminator, not size** — a
  1,500 airfare dwarfs a 350 raise and is a one-off. One real maid's 1,500 addition is an airfare
  ticket auto-added at the e-Residency step that coincidentally equalled her new salary and was
  misread as raise arrears during the rebuild.
- Set `addition_is_raise_in_disguise` true / false, or **null if you cannot tell**.

### A recorded refusal
If the thread records the raise being **refused**, set `approval_denied: true`. A denied raise is
not an absence of authorisation — it is authorisation *withheld*, and she is being paid it anyway.
The thread is **the only place a denial is recorded**: one real To-do looks like an approval from
both its type and its description and is a refusal in its thread.

---

## Output

```json
{
  "sweep_reconciled": true,
  "authorisation_found": true,
  "approved_amount": 2500,
  "approved_amount_is_base": true,
  "approval_denied": false,
  "renewal_raises_consumed_by_approval": 0,
  "renewals_since_approval": 1,
  "justification_is_cohort_wide": false,
  "addition_is_raise_in_disguise": null,
  "todo_ids": ["228006"],
  "documented_amounts": [2500],
  "read_from_type_only": false,
  "notes": "one line on what the evidence actually says"
}
```

## Standing constraints

- **Never** output a verdict, a recommendation, or the word finding/clean/pending. You produce a
  reading; `adjudicate.js` produces the verdict.
- **Never** infer an amount that is not written down. `documented_amounts` holds figures you
  actually read.
- **Never** put a maid's name, phone number or any contact detail in any field. Complaint threads
  carry maid phone numbers. Identify her by **maid id** only.
- If the evidence sweep did not reconcile, say so in `sweep_reconciled` and do not compensate by
  reasoning harder about the pages you did get.
