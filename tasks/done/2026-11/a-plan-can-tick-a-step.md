# A plan can tick a step

- **Status:** done
- **Created:** 2026-11-18T12:30:00+08:00
- **Finished:** 2026-11-18T12:33:41+08:00
- **Approved:** 2026-11-18T13:05:00+08:00

## Description

A plan could add a step but not finish one. `done task/<id>/step/<step-id>` needs the step's **id** — the core refuses a
position on purpose, because the number changes when a step is removed — and a plan could not obtain that id:

- `let s = new task/<id>/step --name "…"` bound `context.result`, and `stepNew` set that to the **task** `addStep()`
  returned, not the step it created.
- Interpolation reads one field of a bound object (`$s.id`), never into an array, so the step inside the task was
  unreachable as well.

The example plan worked around it with `--percent`: a story about progress that never finishes a step.

## The fix

**A verb binds the row it made.** `stepNew` already holds the task before and after the write, so the created step is the one
present in `after` and absent in `before`:

```ts
const added = result.value.steps.find((step) => !(before?.steps ?? []).some((old) => old.id === step.id))
context.result = added ?? result.value
```

No output contract changed: `--json` still prints the task (`printStepAnswer`), and `context.result` is read only by
`plan.ts` when it binds a name.

## Steps

- [x] `stepNew` binds the created step; the JSON answer is still the task.
- [x] `examples/task-life.btid` tells a fuller life: four named steps, ticked on the 15th, 18th and 19th, with `--percent`
      kept only as the progress the board reads.
- [x] `tests/task-life-example.spec.ts`: the 13th's step is ticked on the 15th *while three later steps exist*, and its
      activity entry names that step's id — the proof that the binding is the write, not "the last one added".
- [x] A second case ticks the later step first and the earlier one afterwards, so a binding that quietly meant "last added"
      fails loudly.
- [x] `docs/grammar.md`: the seeding example uses `let s1 = …` / `done …/$s1.id`, and says why a step is named rather than
      numbered.

## Found while building

1. **The activity word is `ticked`, not `done`.** `ActivityStep.state` comes from `STEP_STATES` (`ticked` / `unticked` /
   `added` / `removed` / `unchanged`), so a test asserting `'done'` fails even though the tick landed.
2. **`step.doneAt` is never written.** The schema has `doneAt: timestamp.nullable().default(null)` and `createStepRow`
   starts it at `null`, but no command sets it — so a finished step cannot say *when* it was finished, and the only record of
   "the 15th" is the day entry in the activity log. That is a separate command (set it on tick, clear it on untick, stamped
   from the store's clock so a seed can backdate it), not this one.
3. **Unblocking keeps the last reason.** `--blocked off` clears the flag but leaves `blockedReason`, so the finished row in
   this example still reads "waiting for sign-off". Defensible as the last stated reason; it looks stale on a done row.

## How to verify

- `npx vitest run` → **106 of 107 passing**; the one failure is the pre-existing version drift
  (`src/version.ts` 0.19.2 vs `package.json` 0.20.0). `tsc --noEmit` clean.
- `btid show task/<id> --details` after the example → `steps 4/4`, each `[x]`, and `history the last 5 of 8` with the
  ticks on 15, 18 and 19 September.
