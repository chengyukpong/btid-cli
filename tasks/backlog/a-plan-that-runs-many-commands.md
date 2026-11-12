# A plan that runs many commands

- **Status:** backlog
- **Created:** 2026-11-12T10:30:00+08:00
- **Finished:** —
- **Approved:** —

## What is being designed

One file, one process, one store: a **plan** that creates, edits and removes rows of every type in order.

```console
$ btid plan seed.json
store init                              ok
person new  ivan                        ok   ivan
project new alpha "Alpha One"           ok   alpha
task new    Header budgets              ok   alpha-n7qk
task edit   alpha-n7qk --estimate 4     ok   rev 1
task promote alpha-n7qk                 ok   todo
task remove alpha-n7qk --yes            ok   gone
7 steps, 6 written, 1 refused, 41 s
```

This is the **Command pattern at the CLI's edge**: the verbs already are command objects (`{ name, flags, run(context) }` in
one registry), so what is missing is the *invoker* — something that reads a list of them, in order, against one opened store,
and reports what happened. No rule moves into the plan file; a step is a call, never a condition.

It is also the missing half of the speed work: `--file` batches *one verb over many rows*; a plan runs *many verbs over one
store*, which is the only way to stop paying the ~2.5 s fixed cost per command.

## The file

A JSON document, not NDJSON, because a plan has a beginning (`store init`, a project, a roster) and steps that need ids the
store has not minted yet.

```json
{
  "about": "Seed Alpha One with its first task, then retire it",
  "steps": [
    { "name": "ivan", "verb": "person new", "args": ["ivan"], "flags": { "displayName": "Ivan" } },
    { "verb": "project new", "args": ["alpha", "Alpha One"], "flags": { "start": "2026-11-03", "end": "2026-12-18" } },
    { "name": "task", "verb": "task new", "flags": { "project": "alpha", "title": "Header budgets" } },
    { "verb": "task edit", "args": [{ "$ref": "task" }],
      "flags": { "assignee": "ivan", "start": "2026-11-09", "end": "2026-11-13", "estimate": 4,
                 "dod": "Both header columns line up." } },
    { "verb": "task promote", "args": [{ "$ref": "task" }] }
  ]
}
```

Rules for the file, and they are the whole of its grammar:

- **`verb`** is one of the sixteen in `btid help --json`, spelled exactly as there. An unknown verb is a usage error *before
  anything runs* — the plan is checked completely, then executed.
- **`args`** and **`flags`** are the verb's own, so a plan is a call list, not a dialect.
- **`name`** names a step whose created row later steps need. It is called `name` and not `as` on purpose: `as` reads as
  *act as*, and identity is the one thing a plan may not touch (below).
- **`{"$ref": "name"}`** resolves to that row's id (`alpha-n7qk`, `ivan`, `alpha`). Nothing else is dynamic — no expressions,
  no field lookups — because a plan that computes is a language, and this project does not need another one.
- A **single object** instead of `steps` is a one-step plan, matching `--file`'s courtesy.

## Identity: one login, never switched

**A plan has no way to say who it runs as.** Not a step, not a flag, not a field — the identity is the token's login, and that
is the whole rule.

- No `--as somebody`, and no step that names an identity; a plan step is a *call*, and a call cannot be made "as" anybody but
  the caller.
- The runner refuses an identity-changing verb **before the first request**: `impersonate`, `signout`, and anything the
  manifest ever grows that would move the actor, are a plan-check failure (`2`), not a step.
- The reason is the audit trail the store already keeps. Every row records `createdById`/`updatedBy`, every commit records
  the token's author: a plan able to switch identity would let one credential author work as another, and the store would
  say so with a straight face.

The core still has `Store.impersonate()` — it exists for the SPA's "view as", which is a *reading* tool — but nothing in this
package, and nothing in a plan, can reach it.

## Two front ends, one step list

A plan written as **CLI lines** is the shape most people mean by "a list of commands", and it costs almost nothing, because the
CLI already owns the parser: a line is `verb + args + flags`, read by the same `parseFlags` every single command uses. So the
design takes both spellings and compiles them to one `Step`:

```
# seed.btid — a plan as commands, one per line
name=ivan   person new ivan --name Ivan
            project new alpha "Alpha One" --start 2026-11-03 --end 2026-12-18
name=task   task new --project alpha --title "Header budgets"
            task edit $task --assignee ivan --estimate 4 --start 2026-11-09 --end 2026-11-13
            task promote $task
            task remove $task --yes
```

- **`name=<id>`** at the start of a line names the row the step creates; a bare line is unnamed.
- **`$name`** interpolates that row's id, in an argument or a flag value. Interpolation happens **before** parsing, and an id
  is `alpha-n7qk` — letters, digits and one dash — so it cannot change what the line means.
- `#` starts a comment; blank lines are ignored.
- **A line is only `verb + args + flags`.** Pipes, `&&`, `;`, redirections and environment variables are **refused by name**
  (`usage: a plan line cannot use "&&"; a plan is not a shell`) rather than half-supported, because a file that looks like a
  shell script and is not one is worse than either.

Both files compile to the same `Step` and go through the same runner: the JSON form for a machine that wants unambiguous
values, the line form for a person who wants to copy a command out of `docs/lifecycle-of-a-task.md` and run it. `btid plan
check <file>` accepts either and prints the compiled steps, which is also how a plan is reviewed before it runs.

## How it runs

| | |
|---|---|
| **process** | one. One token, one login, one store load, one snapshot at the end. |
| **order** | strictly sequential; step *n+1* sees everything step *n* wrote. |
| **commits** | `--commit=each` (default) writes after every step, so the plan's progress is real and a failure leaves what already happened; `--commit=end` writes once, so the plan is all-or-nothing. |
| **failure** | stop at the failing step and report its index and the refusal's own code and sentence; `--continue` carries on and reports every failure at the end. Exit `1` if any step refused, `2` if the plan itself is malformed. |
| **output** | one line per step, in order; `--json` prints NDJSON, one object per step (`{"step":3,"verb":"task new","ok":true,"id":"alpha-n7qk"}`), so a caller does not parse prose. |
| **dry run** | `--dry-run` prints the plan with refs unresolved-as-names and writes nothing; with `--commit=end` it is an exact preview of what would happen. |

`$ref` and `--commit=end` interact in one place worth naming: a step that fails *after* other steps have been staged leaves
staged rows in the batch. Under `--commit=end` the plan discards them (nothing is committed), and under `--commit=each` the
failure stops the run with earlier steps already written. Both are honest; the default is `each` because it makes partial
progress visible instead of surprising.

## What the plan needs that does not exist yet

Three verbs, all of them the same shape as the ones already there:

- **`task remove <id> --yes`** — `canDeleteTask` exists (the manager, the assignee, or the creator while unpromoted) and has
  never been called. Deleting is the one action with no undo.
- **`project remove <id> --yes`** — manager's act. Refused while the project still holds tasks unless `--force`, because a
  project row is what makes its tasks readable.
- **`person remove <id> --yes`** — manager's act. Refused while the person is an assignee or a project owner, so a roster row
  cannot vanish out from under work already promised.

`task archive` is deliberately *not* a step in this design's first cut: archive and delete are different answers, and archive
is a status change (`archivedAt`), not a removal. It follows the same pattern when it lands.

## In code

```
src/plan.ts        the file: parse, check every verb and flag, resolve refs
src/plan-run.ts    the invoker: open once, run steps, commit per policy, report
src/cli.ts         one new branch: `plan` is store-less until the first step that writes
```

The invoker does not know any verb's rules — it hands each step to the same `run(context)` the single commands use, with the
same registry `btid help --json` is built from. `--commit=each` uses the normal commit helper; `--commit=end` sets the
context's deferral flag so each verb's commit becomes a recorded message, and one commit writes them all.

## Open questions, for the design to settle before code

1. **Default commit policy.** `each` is safer to reason about; `end` is the speed win and matches "a seed is one commit".
   I would keep `each` as the default and make `--commit=end` explicit, so nobody gets all-or-nothing by accident.
2. **`--continue` or stop?** Stop is the default. A plan is a story; continuing past a failed step usually means editing rows
   that were never created.
3. **Where do plan files live?** Anywhere (`btid plan ./x.json`, `-` for stdin). A plan is not part of the store; it is a
   record of how a store was built, and committing it beside the store's own repository is the caller's choice.
4. **Should a plan be able to nest?** No. A plan calling a plan is a build system, and this is a CLI.
5. **Should a plan be able to say who it runs as?** No, and that is a decision rather than an omission: no `--as`, no
   impersonation step, and the check refuses one before anything runs.
6. **Which spelling is canonical?** Two front ends, one step list: line files (reusing the CLI's own parser) and JSON files
   (unambiguous values) both compile to the same steps. If only one survives review, keep the line form — it cannot drift from
   the CLI's grammar, because it *is* that grammar.

## How to verify

`btid plan seed.json --dry-run` prints seven steps and writes nothing; the real run creates a person, a project and a task,
edits and promotes it, removes it, and leaves exactly the rows the plan named — checked with `btid task ls` and `btid store
whoami` afterwards. `--commit=end` against the same file leaves one commit; `--commit=each` leaves seven. A step naming a
verb that does not exist fails before the first request.
