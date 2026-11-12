# The grammar

```
btid <verb> <path> [data] [--flags]
```

Settled 2026-11-12. This page is the specification the CLI is being rebuilt against; the CLI on this machine still speaks
the older `<class> <verb> <id>` form until 0.12.0 lands.

Why this shape: **verbs are a small closed set, paths are data.** Nothing is both, so no word means two things — which removes
the namespace problem a path-first grammar has, and removes the "default verb" question entirely, because a verb is required
by position.

## Verbs — fourteen, no two-word ones

| verb | what it does | paths it takes |
|---|---|---|
| `ls` | list | `task` · `project` · `person` · `task/<id>/step` · `task/<id>/label` |
| `show` | read one | `task/<id>` · `project/<id>` · `person/<id>` · `task/<id>/step/<step-id>` · `store` · `cache` |
| `new` | create — the store mints the id | `task` · `project` · `person` · `store` · `task/<id>/step` |
| `edit` | change fields | `task/<id>` · `project/<id>` · `person/<id>` |
| `promote` | the one crossing onto the board | `task/<id>` |
| `remove` | delete a row, or detach a label | `task/<id>` · `project/<id>` · `person/<id>` · `task/<id>/step/<step-id>` · `task/<id>/label/<name>` |
| `add` | attach what already exists (a label from the project's vocabulary) | `task/<id>/label` |
| `rename` | rename a step | `task/<id>/step/<step-id>` |
| `done` · `undo` | tick / untick a step | `task/<id>/step/<step-id>` |
| `clear` | drop every snapshot | `cache` |
| `plan` | run a file of commands | *(a file, not a path)* |
| `version` · `help` | about the binary | — |

The verb set is closed. Adding one is a decision about the grammar, not about a resource — which is the whole point: a resource
grows a *path*, not a verb.

## Paths — the store, as a tree

```
task                                     every task
task/<id>                                one task
task/<id>/step                           that task's checklist
task/<id>/step/<step-id>                 one step
task/<id>/label                          the labels on that task
task/<id>/label/<name>                   one of them (only where a name is an id, see below)
project                                  · project/<id>
person                                   · person/<id>
store                                    the store itself
cache                                    the snapshot cache
```

Segment names are nouns, never verbs. A path segment that is an id is either minted by the store (`alpha-n7qk`, `st-a1b2`) or,
for a project key, validated against the same rule it always was (`PROJECT_KEY_INVALID`).

## Data is named

Everything after the path is `--flag value`. There are no bare positionals, so nothing depends on the order of arguments that
are not the path:

```console
$ btid new project --key alpha --name "Alpha One" --start 2026-10-26 --end 2026-11-23
$ btid new person --handle ivan --name Ivan --role member
$ btid new task --project alpha --title "Check the header budgets"
$ btid edit task/alpha-n7qk --estimate 4 --dod "Both columns line up."
```

`ls` is the exception the terminal already had: its terms are the core's query grammar, and they are positional by design
(`status=todo`, not `--status=todo`), because the core parses them.

## Labels are the one path segment that is text

`add task/<id>/label ui` and `remove task/<id>/label ui` take the name as **data**, because a label *is* its text and text may
contain spaces or `/`. So `task/<id>/label/<name>` appears in the `remove` row above only as the conceptual shape; the CLI
accepts the name as an argument on every label verb, never as a path segment.

## The life of a task, in this grammar

```console
btid new task --project alpha --title "Check the header budgets"        # → alpha-n7qk
btid edit task/alpha-n7qk --assignee chengyukpong
btid edit task/alpha-n7qk --start 2026-11-09 --end 2026-11-13 --estimate 4 --dod "…"
btid promote task/alpha-n7qk
btid add task/alpha-n7qk/label ui
btid new task/alpha-n7qk/step --name "Measure the header at 1440"       # → st-a1b2
btid done task/alpha-n7qk/step/st-a1b2
btid undo task/alpha-n7qk/step/st-a1b2
btid remove task/alpha-n7qk/label ui
btid edit task/alpha-n7qk --status done --percent 100
btid remove task/alpha-n7qk --yes
btid show task/alpha-n7qk
btid ls task projectId=alpha status=todo
btid plan seed.btid
```

## Plans use the same grammar

A plan line is a command with `let` and `$var.field` in front, so the two cannot drift:

```
let task = new task --project alpha --title "Check the header budgets"
           edit task/$task.id --estimate 4 --dod "…"
           promote task/$task.id
           new task/$task.id/step --name "Measure the header at 1440"
```

Interpolation happens before parsing, and an id is path-safe (`alpha-n7qk`), so a substituted id cannot change what the line
means. `$task` alone is refused — a result is not a value.

## Refusals, and what they teach

| mistake | the answer |
|---|---|
| `btid task` | `usage: “task” is a path, not a verb. Try: btid ls task projectId=alpha` |
| `btid show task` | `usage: “task” is a list; name one row: btid show task/<id>` |
| `btid ls task/<id>` | `usage: “task/<id>” is one row; use show` |
| `btid edit task/alpha-n7qk bogus` | `usage: edit task/alpha-n7qk takes --title, --status, …` (its own flags) |
| `btid done task/alpha-n7qk` | `usage: done applies to a step: done task/<id>/step/<step-id>` |
| a verb unknown at that path | the verbs valid **at that path**, not the whole registry |

Every refusal names what to type instead. A grammar nobody can guess is a grammar that has to teach, and this is where it does.

## What changes, and what it costs

| today | becomes |
|---|---|
| `task new --project a --title t` | `new task --project a --title t` |
| `task ls status=todo` | `ls task status=todo` |
| `task show <id>` / `task/<id>` | `show task/<id>` |
| `task promote <id>` | `promote task/<id>` |
| `task remove <id> --yes` | `remove task/<id> --yes` |
| `task label add <id> ui` | `add task/<id>/label ui` |
| `task step new <id> --name x` | `new task/<id>/step --name x` |
| `task step done <id> <st-id>` | `done task/<id>/step/<st-id>` |
| `store init` / `store whoami` | `new store` / `show store` |
| `cache show` / `cache clear` | `show cache` / `clear cache` |

- **Breaking.** 0.12.0, hard cut: the old spellings are refused with a message naming the new one, not silently accepted.
- **One resolver, no second implementation.** The verb bodies keep reading their own arguments; the resolver matches
  `verb + path`, then calls the existing command with the path's ids in place. Nothing about the rules moves.
- **The manifest becomes grammar-shaped** (`help --json`, version 2): verbs with the paths each applies to, because an agent
  needs to know which combinations are legal, not just which words exist.

## Build order

1. **Resolver and tables** — verbs × paths, the refusal messages, `--help` per combination.
2. **Tests migrated** to the new spelling, unchanged in what they assert about the store.
3. **Docs rewritten** — this page is the source, `operating.md` and the lifecycle runbook follow it.
4. **Manifest v2**, then 0.12.0 packed.
