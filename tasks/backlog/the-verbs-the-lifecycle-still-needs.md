# The verbs the lifecycle still needs

- **Status:** backlog
- **Created:** 2026-11-11T19:02:00+08:00
- **Updated:** 2026-11-12T18:15:00+08:00
- **Finished:** —
- **Approved:** —

## Description

The terminal front end shipped and was approved with a known hole: four lifecycle moments have no verb, so they can only be
done in the SPA — or by hand, which is the thing this project exists to prevent. `docs/lifecycle-of-a-task.md` names them, and
`alpha-qkka` sits in the test store as the proof: a row I created to run the walkthrough and cannot take back.

Two of them are period-ends (archive, delete); two are the middle of the work (steps, comments). The row already carries
`steps`, `comments` and `archivedAt`; what is missing is the command.

## Steps

Done since this was written — `task remove` (0.10.0), `task step new|rename|done|undo|remove` (0.11.0), labels one at a time
(0.11.0), and `--file` removed from every verb. What is left is three verbs, each waiting on one core command
(`the-three-commands-the-model-still-lacks` in btid-core):

- [ ] **`archive task/<id>`** — sets `archivedAt`; the row leaves the board and the counts and stays in the store. Needs
      `archiveTask`.
- [ ] **`add task/<id>/comment <text>`** and **`ls task/<id>/comment`** — the one change any member may make to anybody's task.
      Needs `commentOnTask`.
- [ ] **`move task/<id>/step/<step-id> --before <step-id> | --after <step-id>`** — reordering without a `seq` field. Needs
      `moveTaskStep`.

Spelled here in the grammar of `docs/grammar.md`; while the CLI still speaks the old one, these are `task archive`,
`task comment` and `task step move`.

## How to verify

`btid task archive alpha-qkka` takes the walkthrough row off the board and leaves it in the store; `btid task remove alpha-qkka
--yes` removes it and the commit says so. A member can comment on somebody else's task and nothing else.
