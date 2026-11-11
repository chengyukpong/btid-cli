# The verbs the lifecycle still needs

- **Status:** backlog
- **Created:** 2026-11-11T19:02:00+08:00
- **Finished:** —
- **Approved:** —

## Description

The terminal front end shipped and was approved with a known hole: four lifecycle moments have no verb, so they can only be
done in the SPA — or by hand, which is the thing this project exists to prevent. `docs/lifecycle-of-a-task.md` names them, and
`alpha-qkka` sits in the test store as the proof: a row I created to run the walkthrough and cannot take back.

Two of them are period-ends (archive, delete); two are the middle of the work (steps, comments). The row already carries
`steps`, `comments` and `archivedAt`; what is missing is the command.

## Steps

- [ ] **`task archive <id>`** — sets `archivedAt`; the row leaves the board and the counts, and stays in the store. One
      command, one commit, `ARCHIVE` in the activity log (the field is already in `ACTIVITY_FIELDS`).
- [ ] **`task remove <id> --yes`** — deletes the row. The rule exists (`canDeleteTask`: manager, assignee, or creator while
      unpromoted) and has never been called. Deleting is the one action with no undo, so `--yes` is required and the commit
      message names what went.
- [ ] **`task step add <id> --name`** and **`task step done <id> <step>`** — `newStep()` exists; the write goes through the
      row's log like any other change.
- [ ] **`task comment <id> --text`** — the one change any member may make to anybody's task (`commentsOnly` already allows it),
      so this verb also demonstrates that permission shape.
- [ ] Batch forms: `--file` on `archive` and `remove`, matching the creators and edits.

## How to verify

`btid task archive alpha-qkka` takes the walkthrough row off the board and leaves it in the store; `btid task remove alpha-qkka
--yes` removes it and the commit says so. A member can comment on somebody else's task and nothing else.
