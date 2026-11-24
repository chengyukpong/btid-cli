# The test fixture expired on 23 November

- **Status:** backlog
- **Created:** 2026-11-24T15:52:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`npm test` in this repo is **red as of 24 November**, five tests, all with the same sentence:

```
AssertionError: refused: Alpha One ended on 2026-11-23 and is still active.  (PROJECT_PAST_END)
```

Nothing in the CLI changed. The fixture in `tests/btid.spec.ts` is an **active project whose window is
`2026-10-26 → 2026-11-23`**, written when that window was in the future; the core has since grown `PROJECT_PAST_END` (an
active project may not end in the past), so every test that **edits that project** now gets a refusal instead of a result:

- adds and removes a project member one at a time
- takes the three statuses a project actually has
- adds a task's new label to its project
- adds and removes one label through the collection path
- edits a project's colour and opens it to somebody

The five tests that only edit *tasks* still pass: the fixture task's window (`2026-11-09 → 2026-11-13`) is checked against the
task's own rules, which do not refuse a past end the way a project's does.

## Why it matters beyond five red ticks

The build is fine — `npm run build` compiles, `node dist/bin.js version` prints
`btid 0.21.0 · btid-core schema v1 · manifest 3`, `help --json` answers. So the failures are not a regression and not a
packaging problem. They are the suite losing its meaning on a date nobody was watching, which is the same class of bug as a test
that only passes on a Tuesday.

## Steps

- [ ] Anchor the fixture to the day the test runs rather than to a fixed day: project `startDate = today - 29`,
      `endDate = today + 30`, task window inside it (e.g. `today - 3 → today + 3`), through one small `day(offset)` helper in
      the spec.
- [ ] Check the dated **arguments** in the same file (§`--start 2026-11-02 --end 2026-11-30`, `--end 2026-11-20`, the plan
      tests at 784/812/829) — each is self-consistent today, but any that ends up in the past will rot the same way.
- [ ] Consider a `vi.setSystemTime` for the whole file instead of relative dates: a frozen clock makes a dated fixture honest
      again, and it fails loudly rather than drifting. Whichever is chosen, say why in a comment beside the fixture — the next
      person will wonder why the dates are arithmetic.
- [ ] `npm test` green, and note in `nothing-enforces-the-tests.md` that this is the second reason that backlog item matters:
      nothing ran the suite, so nobody noticed the day it stopped passing.

## How to verify

- `npm test` — 83 passing, 5 failing on `PROJECT_PAST_END` (the state this was recorded in).
- `npm run build && node dist/bin.js version` — passes, which is what proves the red is the fixture, not the product.
