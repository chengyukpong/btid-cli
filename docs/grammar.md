# The grammar

```
btid <verb> <path> [data] [--flags]
```

Settled 2026-11-12. This page is the specification the CLI is being rebuilt against; the CLI on this machine still speaks
the older `<class> <verb> <id>` form until 0.12.0 lands.

Why this shape: **verbs are a small closed set, paths are data.** Nothing is both, so no word means two things — which removes
the namespace problem a path-first grammar has, and removes the "default verb" question entirely, because a verb is required
by position.

## Verbs — twenty, no two-word ones

| verb | what it does | paths it takes |
|---|---|---|
| `ls` | list | `task` · `project` · `person` · `task/<id>/step` · `task/<id>/label` |
| `show` | read one — its own fields; `--details` adds what is beside it | `task/<id>` · `project/<id>` · `person/<id>` · `task/<id>/step/<step-id>` · `cache` |
| `new` | create — the store mints the id | `task` · `project` · `person` · `store` · `task/<id>/step` |
| `edit` | change fields | `task/<id>` · `project/<id>` · `person/<id>` |
| `advance` | move the store's clock forward, so the steps after it are stamped with that day | `store` |
| `promote` | one step up the ladder: backlog → todo → in progress → done — takes no attributes | `task/<id>` |
| `demote` | one step back down the ladder — takes no attributes | `task/<id>` |
| `archive` | tag the store, then delete a project and its work — there is no unarchive | `project/<id>` |
| `comment` | say something on a task — the text is the free token | `task/<id>` |
| `remove` | delete a row, or detach a label | `task/<id>` · `project/<id>` · `person/<id>` · `task/<id>/step/<step-id>` · `task/<id>/label` |
| `add` | attach what already exists (a label from the project's vocabulary) | `task/<id>/label` |
| `rename` | rename a step | `task/<id>/step/<step-id>` |
| `move` | move a step to a position — `--to <n>`, and past the end means last | `task/<id>/step/<step-id>` |
| `done` · `undo` | tick / untick a step | `task/<id>/step/<step-id>` |
| `clear` | drop every snapshot | `cache` |
| `plan` | run a file of commands | *(a file, not a path)* |
| `whoami` | who you are, and where you are pointing | — |
| `version` · `help` | about the binary | — |

**A project is born delegable.** `new project --members ivan,gary` fills the list in the same commit, so a plan need not
create and then edit before anybody can hold its work — and `edit project/<id> --members none` empties it again.
Archiving is not one of those values: a project has `active`, `paused` and `done`, and `--status archived` is refused
with the verb that does archive it.

**`archive` is the one verb that is not a field change.** It tags the store at the commit it starts from — `archive-<UTC>`,
the state about to be deleted — then removes the project and its tasks. The tag is the copy, so **there is no
unarchive**: getting a project back is `git checkout` on the tag, not a verb. It refuses when the store holds uncommitted
changes, because the tag would name a commit that does not contain them, and a plan refuses it for the same reason.

**A read prints the row, and nothing it computed.** `show task/<id>` prints the fields the store holds, by the names it
holds them under, and leaves out the ones that are empty — what a reader would find in `--json`. The counts, the effort,
the checklist and the history are all about more than this one row, so they wait for `--details`. One flag for every read,
because the question is always the same: *show me what is beside this row*.

The verb set is closed. Adding one is a decision about the grammar, not about a resource — which is the whole point: a resource
grows a *path*, not a verb. `plan`, `whoami`, `version` and `help` are the four that name no path, because none of them is
about a row: they are about a file, a session, or the binary.

**The ladder is written by verbs, and only by them.** `promote` walks `backlog → todo → in progress → done` one step per
call; `demote` walks it back. Neither takes an attribute, so each step has one spelling and one gate:

```
btid promote task/alpha-n7qk      # backlog → todo        the six fields
btid promote task/alpha-n7qk      # todo → in progress    not blocked
btid promote task/alpha-n7qk      # in progress → done    every step ticked
btid demote  task/alpha-n7qk      # done → in progress    no attribute, no note
```

`edit` **does not take `status`** — a patch that carries one is refused with a sentence naming the ladder, because otherwise
the gates are advisory and any front end could walk the row up in one write. `percentComplete` is a fact and stays an edit;
`done` sets it to 100, and a reopening leaves it where it was, since the work really did get that far.

## Paths — the store, as a tree

```
task                                     every task
task/<id>                                one task
task/<id>/step                           that task's checklist
task/<id>/step/<step-id>                 one step
task/<id>/label                          the labels on that task
project                                  · project/<id>
project/<id>/member                       who a project is open to — `add` and `remove`, one name at a time
person                                   · person/<id>
store                                    the store itself: `new store` is the only verb that takes it
cache                                    the snapshot cache
```

Segment names are nouns, never verbs. A path segment that is an id is either minted by the store (`alpha-n7qk`, `st-a1b2`) or,
for a project key, validated against the same rule it always was (`PROJECT_KEY_INVALID`).

There is no `task/<id>/label/<name>`. A label **is** its text, and text may contain spaces or `/`, so a label name is data on
every verb that touches one (`add task/<id>/label ui`, `remove task/<id>/label ui`) and never a path segment. The path stops at
the collection.

## Data is named

Everything after the path is `--flag value`, with **two exceptions**, both deliberate:

```console
$ btid new project --key alpha --name "Alpha One" --start 2026-10-26 --end 2026-11-23
$ btid new person --handle ivan --name Ivan --role member
$ btid new task --project alpha --title "Check the header budgets"
$ btid edit task/alpha-n7qk --estimate 4 --dod "Both columns line up."
```

- **`ls` takes the core's query grammar positionally** (`status=todo`, not `--status=todo`), because the core parses that
  text and a flag would be a second spelling of it.
- **A label name is bare data** (`add task/<id>/label ui`), because a label *is* its text: flag-naming it would suggest a
  field called `label`, and the value is the whole point.

Neither exception depends on *order* — each is the single trailing datum a verb takes — so the property that matters is kept:
nothing after a path is positional in the sense that moving it changes the meaning.

## Labels are data, never a segment

`add task/<id>/label ui` and `remove task/<id>/label ui` take the name as **data**, because a label *is* its text and text may
contain spaces or `/`. The path stops at the collection — `task/<id>/label` — and the name is an argument on every label verb.
A grammar that made the name a segment would need an escaping rule for `/`, and a store that permits `ui/web` as a label should
not have to explain itself.

## Help is one long page, not a lookup

`btid help` prints the whole table — every verb with the paths it takes, and every path with the verbs valid on it — because
reading it should cost one command, not a question per combination. `btid help <verb>` adds that verb's flags and one example.

There is deliberately no `btid help <path>`. A path is data, and a help command that took a path would make the one command you
run when you are lost depend on typing the thing you are lost about. The **refusals** carry the path's verbs instead: a wrong
verb at a known path answers with the verbs valid there, which is the moment you actually need it.

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
btid promote task/alpha-n7qk                     # the last step: done, and percent 100
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
| `btid promote task/alpha-n7qk --status done` | `usage: promote takes no attributes; btid promote twice moves it to in progress` |
| `btid show store` | `usage: “store” has no show — btid whoami says who you are, btid new store creates one` |
| a verb unknown at that path | the verbs valid **at that path**, not the whole registry |

Every refusal names what to type instead. A grammar nobody can guess is a grammar that has to teach, and this is where it does.

## Seeding a history

`advance store <instant>` moves the store's clock; every step after it is stamped with that moment. It is the manager's to
move, and — after the first move — forward only. The first move is the exception on purpose: a store seeded in November
about September has to begin in the past.

```
advance store 2026-09-11T09:12:00+08:00
let t = new task --project alpha --title "Cut the release"
edit task/$t.id --assignee ivan --start 2026-09-14 --end 2026-09-18 --estimate 3 --dod "It ships."
advance store 2026-09-12T10:40:00+08:00
promote task/$t.id
advance store 2026-09-13T14:05:00+08:00
new task/$t.id/step --name "Write the notes"
```

The rows and their activity days follow the clock — six days of work become six records rather than one with an edit count.
The **commits** do not: the engine stamps them when they are written, so a store seeded today shows today's commits
containing September's work. Backdating a commit would be rewriting history, which is not what a seed is for.

## What changes, and what it costs

| today | becomes |
|---|---|
| `task new --project a --title t` | `new task --project a --title t` |
| `task ls status=todo` | `ls task status=todo` |
| `task show <id>` / `task/<id>` | `show task/<id>` |
| `task promote <id>` | `promote task/<id>` |
| `task promote <id> --status s` | `promote task/<id>` until it reaches `s`; `edit --status` no longer moves the ladder |
| `task remove <id> --yes` | `remove task/<id> --yes` |
| `task label add <id> ui` | `add task/<id>/label ui` |
| `task step new <id> --name x` | `new task/<id>/step --name x` |
| `task step done <id> <st-id>` | `done task/<id>/step/<st-id>` |
| `store init` / `store whoami` | `new store` / `whoami` |
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
