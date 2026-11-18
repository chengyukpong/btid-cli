# The grammar

```
btid <verb> <path> [data] [--flags]
```

Settled 2026-11-12, revised 2026-11-18 (the session verbs, and the verbs that were field changes in disguise). This page
describes the CLI as it is, not as it is being built towards.

Why this shape: **verbs are a small closed set, paths are data.** Nothing is both, so no word means two things — which removes
the namespace problem a path-first grammar has, and removes the "default verb" question entirely, because a verb is required
by position.

## The table — 21 verbs, 15 paths, 46 rules

Read off the same table the dispatcher uses, so it cannot drift from the code. A rule is one *verb × path* pair; the flags
are the ones that pair takes, and the five pathless verbs appear with *(none)*.

| verb | path | what it does | flags |
|---|---|---|---|
| `ls` | `task` | List rows: tasks, projects, people, or a task’s steps and labels. | `--fields` `--order` |
| `ls` | `project` | List rows: tasks, projects, people, or a task’s steps and labels. | `--fields` |
| `ls` | `person` | List rows: tasks, projects, people, or a task’s steps and labels. | `--fields` |
| `ls` | `task/<id>/step` | List rows: tasks, projects, people, or a task’s steps and labels. | — |
| `ls` | `task/<id>/label` | List rows: tasks, projects, people, or a task’s steps and labels. | — |
| `show` | `task/<id>` | Read one row: its own fields, and its steps and history with --details. | `--details` |
| `show` | `project/<id>` | Read one row: its own fields, and its work with --details. | `--details` |
| `show` | `person/<id>` | Read one row: its own fields, and the work it holds with --details. | `--details` |
| `show` | `task/<id>/step/<step-id>` | Read one row. | — |
| `show` | `cache` | Read one row. | — |
| `new` | `task` | Create a row — or the store itself; the store mints the id. | `--project` `--title` `--priority` `--dry-run` |
| `new` | `project` | Create one row; the store mints the id. | `--key` `--name` `--start` `--end` `--description` `--color` `--members` `--dry-run` |
| `new` | `person` | Create one row; the store mints the id. | `--handle` `--name` `--role` `--dry-run` |
| `new` | `store` | Create one row; the store mints the id. | — |
| `new` | `task/<id>/step` | Create one row; the store mints the id. | `--name` `--dry-run` |
| `advance` | `store` | Move the store's clock forward, so the work that follows is stamped with that day. | — |
| `impersonate` | `person/<id>` | Act as somebody on the roster: every write after this is theirs. The manager may. | — |
| `edit` | `task/<id>` | Change one row’s fields. | `--title` `--description` `--dod` `--priority` `--assignee` `--start` `--end` `--percent` `--estimate` `--tracked` `--small` `--blocked` `--blocked-reason` `--blocked-by` `--note` `--dry-run` |
| `edit` | `project/<id>` | Change one row’s fields. | `--name` `--start` `--end` `--description` `--status` `--color` `--dry-run` |
| `edit` | `person/<id>` | Change one row’s fields. | `--name` `--handle` `--role` `--active` `--dry-run` |
| `archive` | `project/<id>` | Tag the store, then delete the project and its work. There is no unarchive. | `--yes` `--dry-run` |
| `promote` | `task/<id>` | Move a captured task onto the board. Takes no attributes. | `--dry-run` |
| `demote` | `task/<id>` | Move a task one step back down the ladder. Takes no attributes. | `--dry-run` |
| `add` | `task/<id>/comment` | Say something on a task. Any member may comment on anybody’s work. | `--dry-run` |
| `add` | `task/<id>/exemption` | Accept a nudge on a task, permanently, so it stops being raised. | `--dry-run` |
| `remove` | `task/<id>/exemption` | Take an acceptance back, so the sentence is raised again. | `--dry-run` |
| `remove` | `task/<id>` | Delete a row, detach a label, or remove a step. A row needs --yes. | `--yes` `--dry-run` |
| `remove` | `project/<id>` | Delete a row, detach a label, or remove a step. A row needs --yes. | `--yes` `--cascade` `--dry-run` |
| `remove` | `person/<id>` | Delete a row, detach a label, or remove a step. A row needs --yes. | `--yes` `--dry-run` |
| `remove` | `task/<id>/step/<step-id>` | Delete a row, detach a label, or remove a step. A row needs --yes. | `--dry-run` |
| `remove` | `task/<id>/label` | Detach one label from a task. The project keeps it. | `--dry-run` |
| `remove` | `project/<id>/member` | Close a project to somebody. Their work stays assigned. | `--dry-run` |
| `remove` | `project/<id>/label` | Take a label out of the project’s vocabulary. | `--dry-run` |
| `add` | `task/<id>/label` | Attach a label that already exists in the project’s vocabulary. | `--dry-run` |
| `add` | `project/<id>/member` | Open a project to somebody on the roster. | `--dry-run` |
| `add` | `project/<id>/label` | Add a label to the project’s vocabulary, so its tasks can use it. | `--dry-run` |
| `rename` | `task/<id>/step/<step-id>` | Rename one step. | `--name` `--dry-run` |
| `move` | `task/<id>/step/<step-id>` | Move a step to a position. A position past the end means last. | `--to` `--dry-run` |
| `tick` | `task/<id>/step/<step-id>` | Tick one step. | `--dry-run` |
| `untick` | `task/<id>/step/<step-id>` | Untick one step. | `--dry-run` |
| `clear` | `cache` | Drop every snapshot. The next read rebuilds them. | — |
| `plan` | *(none)* | Run a file of commands in order against one store, committing once at the end. | `--commit` `--continue` `--quiet` `--preview` |
| `whoami` | *(none)* | Say which store this session points at, and who it acts as. | — |
| `unimpersonate` | *(none)* | Stop acting as somebody: the roster account comes back. | — |
| `version` | *(none)* | Which btid this is, and which schema it speaks. | — |
| `help` | *(none)* | Print the grammar, or explain one verb. | `--json` |

**Global, on every row:** `--store` `--json` `--help` `--version` `-v` `--fresh` `--verbose` `--log-file` `--no-log`.

**Four kinds of path, and one kind of nothing.** A *collection* (`task`), a *row shape* (`task/<id>`), a *membership*
(`task/<id>/label`, `project/<id>/member`, `task/<id>/exemption`), or a *singleton* (`store`, `cache`). The pathless verbs —
`plan`, `whoami`, `unimpersonate`, `version`, `help` — address the session or the binary rather than a row, which is why
`unimpersonate` is a verb and not a "stop" path: a mode is not data.

**`new` mints an id, so it returns the row; `add` addresses something the caller names, so it does not.** That is the whole
rule behind the two verbs, and why there is no `addNew`: a label, a member, an exemption code and a comment body are named by
the person typing, while a task, project, person and step get ids from the store. A plan can bind what `new` made
(`let t = new task …`, then `$t.id`) and cannot bind what `add` attached — there is nothing to bind.

**A project is born delegable.** `new project --members ivan,gary` fills the list in the same commit — birth is the one
moment a flag is right for a list — and afterwards membership moves one person at a time, through
`add/remove project/<id>/member`. Archiving is not one of those values: a project has `active`, `paused` and `done`, and
`--status archived` is refused with the verb that does archive it.

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
Reaching `done` sets it to 100, and a reopening leaves it where it was, since the work really did get that far.

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
reading it should cost one command, not a question per combination. It also carries the words a newcomer needs before the table
makes sense: what a store is, where ids come from, what `data` and `--flag` mean, the **query** form `ls` alone speaks, every
global flag, and **every exit code** (0 ok, 1 refused, 2 usage or a schema mismatch, 3 a row the store rejects, 4 a conflict, 5
no store).

`btid help <verb>` gives that verb one page: whether it reads, writes or changes the session, **every usage line** — one per
shape, each with its own sentence, because `add task/<id>/comment` and `add project/<id>/label` are different acts that share a
verb — its flags with a description each, and one example.

The page is complete by construction rather than by diligence: `src/help-text.ts` holds a sentence per verb and a line per flag,
and `tests/help.spec.ts` fails when a verb or a flag lands without one. A verb described by "whichever of its handlers was
registered first" is the bug that check exists to catch — `add` read *"Say something on a task"* until it was.

There is deliberately no `btid help <path>`. A path is data, and a help command that took a path would make the one command you
run when you are lost depend on typing the thing you are lost about. The **refusals** carry the path's verbs instead: a wrong
verb at a known path answers with the verbs valid there, which is the moment you actually need it.

## What a command does to the store

Three kinds, and a plan treats them differently:

| kind | verbs | a plan may contain it | commits |
|---|---|---|---|
| reads | `ls`, `show`, `whoami` | yes | no |
| writes | everything else | yes | one, at the end or per step |
| **session** | `advance`, `impersonate`, `unimpersonate` | yes | **nothing** |

A session act stages no row and commits nothing — it changes what the rows *after* it record, or when they were recorded. It is
neither a write nor a read, and saying so is what `Rule.handler.session` is for: before that field existed, `advance store` and
`impersonate` declared `writes: true` so the plan runner would accept them, which was a comment apologising for a flag. The
manifest reports it (`"session": true`) and the help page says it in words.

## The life of a task, in this grammar

```console
btid new task --project alpha --title "Check the header budgets"        # → alpha-n7qk
btid edit task/alpha-n7qk --assignee chengyukpong
btid edit task/alpha-n7qk --start 2026-11-09 --end 2026-11-13 --estimate 4 --dod "…"
btid promote task/alpha-n7qk
btid add task/alpha-n7qk/label ui
btid new task/alpha-n7qk/step --name "Measure the header at 1440"       # → st-a1b2
btid tick task/alpha-n7qk/step/st-a1b2
btid untick task/alpha-n7qk/step/st-a1b2
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
| `btid tick task/alpha-n7qk` | `usage: tick applies to a step: tick task/<id>/step/<step-id>` |
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
let s1 = new task/$t.id/step --name "Write the notes"
advance store 2026-09-15T17:05:00+08:00
tick task/$t.id/step/$s1.id
```

**A step is named, not numbered.** `tick` takes a step's id — the position is refused, because it changes when a step is
removed — and the id is minted at the moment the step is created. So the plan binds the write (`let s1 = …`) and refers to
it later as `$s1.id`. Every verb binds the row it *made*: a plan can therefore tick the step it added two days ago, not just
the last one it added.

**And who did it.** `impersonate person/<id>` attributes every write after it to that person — `createdById`, `updatedBy`,
and the activity log's `by`. `unimpersonate` goes back to the account the CLI signed in as — a pathless verb, because the act
has no object.

```
advance store 2026-11-11T14:30:00+08:00
impersonate person/ivan-petrov
new task/$t.id/step --name "Write the relay config"
unimpersonate
```

Only the manager may act as somebody else; the id must name a person who is still on the roster; and the act is never
persisted — a plan ends, and the next command is the manager again. The permission checks downstream run **as that person**,
so acting as a member means a member's power. That is what makes the attribution believable rather than merely relabelled.

What it does not change is the **commit author**: that is the account whose token wrote it. The rows say who did the work,
the commits say who wrote them — a seed is attributed history, not forged history.

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
| `task step done <id> <st-id>` | `tick task/<id>/step/<st-id>` |
| `store init` / `store whoami` | `new store` / `whoami` |
| `cache show` / `cache clear` | `show cache` / `clear cache` |

- **Breaking.** 0.12.0, hard cut: the old spellings are refused with a message naming the new one, not silently accepted.
- **One resolver, no second implementation.** The verb bodies keep reading their own arguments; the resolver matches
  `verb + path`, then calls the existing command with the path's ids in place. Nothing about the rules moves.
- **The manifest becomes grammar-shaped** (`help --json`): verbs with the paths each applies to, because an agent needs to know
  which combinations are legal, not just which words exist. **Version 3** carries the flags, usage line and kind of each path —
  v2 unioned a verb's flags, so it could not answer *"may I pass `--percent` to `edit project/<id>`?"* (no), and it reported
  session acts as writes.

## Build order

1. **Resolver and tables** — verbs × paths, the refusal messages, `--help` per combination.
2. **Tests migrated** to the new spelling, unchanged in what they assert about the store.
3. **Docs rewritten** — this page is the source, `operating.md` and the lifecycle runbook follow it.
4. **Manifest v2**, then 0.12.0 packed.
