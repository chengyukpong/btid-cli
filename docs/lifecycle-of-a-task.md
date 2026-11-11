# The life of one task, from the terminal

One row — `alpha-n7qk`, *"Check the header budgets"* — followed from the command that creates it to the command that closes
it. Every command below is real, every output is what the CLI prints today (`btid 0.5.0`, `btid-core 0.9.0`), and every
refusal is one you can reproduce.

The task is imaginary; the rules are not.

---

## The row this is about

| | |
|---|---|
| project | `alpha` — *Alpha One*, window `2026-10-26 → 2026-11-23` |
| id | `alpha-n7qk` (minted at capture, never changes) |
| who | `chengyukpong`, the store's manager |

---

## 0. Before the task — one command each, once

```console
$ export BTID_STORE=yuk-org/btid-store@main     # or --store on every command
$ btid store init
init  yuk-org/btid-store@main
      manager chengyukpong

$ btid project new alpha "Alpha One" --start 2026-10-26 --end 2026-11-23
project  alpha   Alpha One
```

The project's window is not decoration: **a project without both dates refuses every capture** (`PROJECT_NOT_READY`), so a
project is created *with* its dates or it cannot hold work.

---

## 1. Capture — the row exists, and it is not yet work

```console
$ btid task new --project alpha --title "Check the header budgets"
captured  alpha-n7qk   backlog   Check the header budgets
```

**State after**: `status backlog`, `firstPromotedAt null`, `rev 0`, `percentComplete 0`, no steps, empty log. Stage:
`unclaimed` — nobody is on it yet.

The id is minted from the project (`alpha-` + four characters) and is never re-minted: there is no command that changes it,
because every reference to the task would break.

---

## 2. Claim — somebody owns it

```console
$ btid task edit alpha-n7qk --assignee chengyukpong
edited  alpha-n7qk   rev 1
```

**State after**: `assigneeId chengyukpong`, `rev 1`. Stage: `claimed`. Still `backlog`, still not board work — this is the
person who will do it, recorded before it starts.

---

## 3. Getting ready — the six things promotion will check

```console
$ btid task edit alpha-n7qk \
    --start 2026-11-09 --end 2026-11-13 \
    --estimate 4 \
    --dod "Both header columns line up at 1440 and 1280."
edited  alpha-n7qk   rev 2
```

**State after**: window set, `estimateDays 4`, a definition of done, `rev 2`.

If you ask to promote too early, the CLI tells you exactly what is missing, not that something is:

```console
$ btid task promote alpha-n7qk
refused: Before promotion: add an estimate and a definition of done. (PROMOTION_INCOMPLETE)
```

That sentence comes from `promotionHint` — the same one the SPA's card shows — so a person switching front ends reads the
same reason. Nothing was written.

**A short task is a different shape**: `--small on` books clock times, and day dates are refused by the schema —

```console
$ btid task edit alpha-n7qk --small on --start 2026-11-09 --end 2026-11-13
error: cannot update this task row: it is not valid v1 data  (INVALID_ROW)     # exit 3
$ btid task edit alpha-n7qk --small on --start 2026-11-09T09:00 --end 2026-11-09T13:00 --note "Four hours, not a day."
edited  alpha-n7qk   rev 3
```

Eight hours for a `09:00` start, four for `13:00`: the cap is arithmetic on the start, not a number to keep in step.

---

## 4. Promote — the one crossing onto the board

```console
$ btid task promote alpha-n7qk
promoted  alpha-n7qk   todo   rev 3
```

**State after**: `status todo`, `firstPromotedAt 2026-11-11T…`, `rev 3`, stage `promoted`.

Two things are now true that were not before:

- the row is **board work** — it appears in any `btid task ls` that filters on status;
- **status edits are legal**. Before promotion they are not:

```console
# before promotion, on a backlog row:
$ btid task edit alpha-n7qk --status todo
refused: Promote the item to move it onto the board. (NOT_ALLOWED)
```

Promotion also refuses a second crossing, and points at the right verb:

```console
$ btid task promote alpha-n7qk
refused: alpha-n7qk is already on the board (todo). Change its status instead of promoting it again. (ALREADY_PROMOTED)
```

**A demotion keeps its history**: moving a promoted row back to `backlog` makes its stage `demoted`; promoting it again
*does not* rewrite `firstPromotedAt`, so the task's first day on the board is still its first day.

---

## 5. Work — the ordinary edits, and the one rule that bites

```console
$ btid task edit alpha-n7qk --status in_progress
edited  alpha-n7qk   rev 4

$ btid task edit alpha-n7qk --percent 40
edited  alpha-n7qk   rev 5

$ btid task edit alpha-n7qk --blocked on --blocked-reason "Waiting for the header spec"
edited  alpha-n7qk   rev 6

$ btid task edit alpha-n7qk --blocked off --blocked-reason none
edited  alpha-n7qk   rev 7
```

**Blocked is a flag, not a column**: the task stays `in_progress`; what changes is that it says why it cannot move.
`btid task show` prints the block, and the row's log holds the day it started — that is what `blockedSince` reads.

**The rule that started all of this** — a tracked task's end day needs a reason:

```console
$ btid task edit alpha-n7qk --tracked on --end 2026-11-16
refused: Changing the end day of a tracked task needs a reason. (END_DATE_NEEDS_REASON)
$ echo $?
1

$ btid task edit alpha-n7qk --end 2026-11-16 --note "The header spec slipped a week."
edited  alpha-n7qk   rev 8
```

The note is not commentary stored beside the task: it is part of the **change** in the row's own log, so the question *"why
did this move?"* is answered where the move is.

**Who may edit** is a rule, not a UI state. As a member:

```console
$ btid task edit alpha-n7qk --title "Mine now"
refused: alpha-n7qk is assigned to chengyukpong; only they or the manager can change it. (NOT_ALLOWED)
```

The exception is a comment — any member may add one to any task.

---

## 6. Finish

```console
$ btid task edit alpha-n7qk --status done --percent 100
edited  alpha-n7qk   rev 9
```

Nothing completes by itself: `percentComplete` is a number a person sets, and steps are ticked, not inferred. A `done` task
stays on the board and in every count until it is archived or deleted.

---

## Where the row stands

```console
$ btid task show alpha-n7qk
alpha-n7qk  Check the header budgets
  project alpha   status done   owner chengyukpong   100%
  window  2026-11-09 → 2026-11-16   estimate 4
```

| | after capture | after claim | after ready | after promote | now |
|---|---|---|---|---|---|
| status | backlog | backlog | backlog | todo | **done** |
| stage | unclaimed | claimed | claimed | promoted | promoted |
| firstPromotedAt | — | — | — | set | **unchanged** |
| rev | 0 | 1 | 2 | 3 | **9** |
| commits | 1 | 2 | 3 | 4 | **10** |

One command, one commit: ten commands, ten commits, each named after the verb and the row — `capture alpha-n7qk`,
`promote alpha-n7qk`, `edit alpha-n7qk`. `git log` in the store is the audit trail, and the row's own `activities` is the same
story told per field.

---

## After the task: not built yet

Two lifecycle moments have no verb, and the plan for them is worth stating so nobody invents a workaround:

| what | rule that exists | verb planned |
|---|---|---|
| **archive** (set `archivedAt`, hide from the board, keep the row) | — | `btid task archive <id>` |
| **delete** (remove the row; the one action with no undo) | `canDeleteTask`: the manager, the assignee, or the creator while unpromoted | `btid task remove <id> [--yes]` |

Until then both are the SPA's, or a hand-written commit — which is exactly what this project exists to prevent, so neither
should be done by hand in a store that matters.

Also unbuilt, and part of the same story: `task step add|done` and `task comment` — the row carries `steps` and `comments`
today, but no CLI verb writes them.

---

## The same life, written as a script

Because every edit takes `--file`, the middle of this — claim, ready, work — is one command when there are several tasks:

```json
[
  { "id": "alpha-n7qk", "patch": { "assigneeId": "chengyukpong", "startDate": "2026-11-09",
    "endDate": "2026-11-13", "estimateDays": 4,
    "definitionOfDone": "Both header columns line up at 1440 and 1280." } }
]
```

```console
$ btid task edit --file ready.json
edited  alpha-n7qk   rev 2
$ btid task promote alpha-n7qk
promoted  alpha-n7qk   todo   rev 3
```

A single object is a one-item list, so a script editing exactly one task needs no brackets. Promotion has no file form yet;
it is one row at a time (`task promote <id>`), which is the next thing to add if seeds of twenty tasks become normal.
