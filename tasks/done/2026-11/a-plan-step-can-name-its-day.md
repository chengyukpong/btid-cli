# A plan step can name its day

- **Status:** done
- **Created:** 2026-11-18T12:03:48+08:00
- **Finished:** 2026-11-18T12:21:18+08:00
- **Approved:** 2026-11-18T13:05:00+08:00

## Description

`btid plan` runs a file of verbs against one open store; every step was stamped with the wall clock, so a seeded demo store
had a single day in it — all six events of a realistic history landing in one activity record, and one point on the timeline.

The fix is a **verb**, not a plan-file field (the user's call, and the better one): `advance store <instant>` moves the clock
for the steps that follow, so the plan language needed no new syntax at all.

```
advance store 2026-09-11T09:12:00+08:00
let t = new task --project alpha --title "Cut the release"
edit task/$t.id --assignee ivan --start 2026-09-14 --end 2026-09-18 --estimate 3 --dod "It ships."
advance store 2026-09-12T10:40:00+08:00
promote task/$t.id
advance store 2026-09-13T14:05:00+08:00
new task/$t.id/step --name "Write the notes"
```

## What landed

- `advance store <instant>` — a `Verb` in `src/verbs.ts`, one row in `src/grammar.ts`, and the help page grows it
  automatically from that table. Exit codes: `0` moved, `1` refused (the core's sentence and code), `2` no instant given.
- `tests/advance-clock.spec.ts`: a plan that walks three days, and the two refusals.
- `docs/grammar.md`: the verb in the table (nineteen → twenty), and a *Seeding a history* section with the example above and
  the honesty limit — the rows are historical, the commits are not.

## Found while building

1. **A plan refuses a non-write step** — "a plan runs commands; 'advance' is a report". So the verb had to be `writes: true`
   even though it stages no row. Its own line is therefore swallowed inside a plan, which is right: the transcript still
   prints `ok 4 advance store`, and the effect shows up in the rows the following steps write.
2. **A step's name is a flag, not a positional** — `new task/<id>/step --name "Write the notes"`.
3. **`btid-core` is consumed as a tarball**, so the core's change needed the family's packaging step before this repository
   could see it: bump to 0.30.0, build, pack, reinstall. A source change in the library is invisible to a front end until
   that happens.

## Pre-existing failure, not fixed here

`tests/btid.spec.ts > keeps the version it prints in step with package.json` fails: `src/version.ts` says `0.19.2` and
`package.json` says `0.20.0`. HEAD disagreed before this task began, so it is a separate command — the version the binary
prints is behind the package. Recorded rather than folded in.

## How to verify

- `npx vitest run` → **104 of 105 passing**, the one failure being the version drift above.
- `tests/advance-clock.spec.ts` → the plan exits 0, the task's activity days are `09-11`, `09-12`, `09-13`, and a plan that
  walks backwards is refused at step 2.
