# A read is the row, and `--details` is what is beside it

- **Status:** done
- **Created:** 2026-11-15T01:00:00+08:00
- **Finished:** 2026-11-15T01:15:00+08:00
- **Approved:** 2026-11-15T01:16:00+08:00

> Written at handover, after the work: this one was built before it was recorded, which is the one step of the workflow it
> skipped. The record is here so the log does not claim the order was different.

## Why

`show` had become three different things at once: a row, a summary of several rows, and a list. `show project/<id>` printed
counts and a task table before the project's own description, `show task/<id>` printed a checklist but not the estimate, and
neither could be read as "what does the store hold for this row".

The instruction that settled it: **print just what is available in the object, and more only if `--details`.**

## What

- `show task/<id>`, `show project/<id>`, `show person/<id>` print the row's own fields, under the names the store gives
  them, in a column that lines up. Empty is absence: a null, a blank string and an empty list print nothing.
- `--details` adds what is *about* the row rather than *in* it — the checklist and history for a task, the counts, effort
  and task table for a project or a person.
- One flag for every read (`VerbContext.details`), because the question is the same each time.
- `rowFields` and `wrapText` live in `output.ts`; the field lists are `TASK_FIELDS`, `PROJECT_FIELDS`, `PERSON_FIELDS` in
  `verbs.ts`, so the page cannot invent a field the row does not have.
- `docs/grammar.md` states the rule; `help show` lists `--details` once for the three verbs that take it.

## How to verify

```console
$ btid show project/alpha            # fields only
$ btid show project/alpha --details  # + work, status, effort, the rows
$ btid show task/alpha-djnp --details # + steps, warnings, the last five edits
```

## What went wrong on the way

Two attempts to rewrite `verbs.ts` with PowerShell string replacement corrupted it — template literals and `\${}` do not
survive that path — and both had to be reverted with `git checkout --`. The third attempt used the editor and worked.
**Recorded because the next agent will be tempted by the same shortcut.**
