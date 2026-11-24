# The test fixture expired on 23 November

- **Status:** done
- **Created:** 2026-11-24T15:52:00+08:00
- **Finished:** 2026-11-24T16:02:00+08:00
- **Approved:** 2026-11-24T17:23:46+08:00

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

- [x] Anchor the fixture to the day the test runs: a `day(offset)` helper at the top of the spec, project `day(-29) → day(30)`,
      task `TASK_START = day(-3) → TASK_END = day(3)`, both named constants so the assertions that print a date read the same
      value rather than a second literal.
- [x] The dated **arguments** in the same file: `PROJECT_START`/`PROJECT_END` (`day(-20) → day(20)`) for the projects a test
      creates or edits, `day(-2) → day(6)` for the task windows an edit test moves, and the three `plan` scripts now interpolate
      the same helpers (`${day(-20)}`, `${day(-3)}`) instead of carrying 2026-11-03/2026-12-18.
- [x] **Relative dates, not a frozen clock.** `vi.setSystemTime` would fix the file, but it fixes it *silently*: every test would
      then run on a made-up day while the product runs on the real one, and the next expiry would be invisible again. Arithmetic
      keeps the suite honest about the day it actually runs on.
- [x] `npm test` green — **119 passing, 8 files** — and the reason is recorded in `nothing-enforces-the-tests.md`.
- [x] `release/btid-cli-0.21.0.tgz` packed, installed into a scratch directory and run there:
      `btid 0.21.0 · btid-core schema v1 · manifest 3`.

## How to verify

- `npm test` — 119 passing (the state this was recorded in was 83 passing, 5 failing on `PROJECT_PAST_END`).
- `npm run build && node dist/bin.js version` — passes either way, which is what proved the red was the fixture, not the product.
- The tarball is self-contained: `node_modules/btid-core/package.json` and `node_modules/githubdb/package.json` are inside it, and
  it runs with no checkout beside it.

## What this leaves

`release/` had stopped at **0.19.1** while `package.json` said 0.21.0 — two versions were never packed, so nothing could consume
them over `file:`. 0.21.0 is packed now; 0.20.0 was skipped and is not recoverable from this tree (its sources are in the
history, not in a tarball).

The small-task test still books `2026-11-10T09:00 → 13:00`, a fixed past day. It passes because no rule refuses a short booking
in the past — but it is the same shape of rot, one rule away from failing. Left as it is rather than churned in the same commit;
the next person should know it is the remaining fixed date in this file.

