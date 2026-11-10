# Tasks

One file per unit of work; one command from the user per file. A file is the work log, not a design doc: when a decision
is confirmed, it becomes a page under `docs/` and the task links to it.

Nothing is coded until the user has approved the `todo/` item. The approval date goes in the file, and the steps are the
approved scope.

| Folder | Meaning |
|---|---|
| `backlog/` | captured, not scoped or scheduled |
| `todo/` | scoped and waiting for the user's approval to start |
| `in-progress/` | approved and being worked |
| `done/` | approved by the user and filed under `done/{yyyy-MM}/` |

Every task contains at least its name, description, created date, finished date, steps, and how to verify. Start from
[`_template.md`](_template.md).

Dates are recorded to the second, with the offset the store itself uses: `2026-10-30T00:39:12+08:00`. A day is too coarse
for two events that happen minutes apart.

- A task moves with `git mv` between folders, and its `Status:` line changes with it.
- `Finished:` is stamped when the agent hands the work over, while the file is still in `in-progress/`. `Approved:` is
  stamped when the user signs off, and only then does the file move to `done/{yyyy-MM}/` — so the two times record how
  long a finished result waited for review.
- Keep one work per file. A second, unrelated fix gets its own task.
- The log is history, not specification: confirmed decisions belong in `docs/`.
