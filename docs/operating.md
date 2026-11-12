# Operating a store from an agent

`btid` is meant to be driven by an agent as readily as by a person: every verb is one command from `btid-core`, every
refusal carries a code, and `btid help --json` is the manifest a program should read before its first call.

This page is the hand-off. It assumes a repository the operator may write to, and a GitHub token that may write to it.

## 0. How it is installed on this machine (2026-11-11)

`npm install -g .` from this checkout, which makes the `btid` command a **symlink to this directory**:

```
btid-cli@0.1.0 -> C:\workspace\dsh\btid3\btid-cli
```

Three consequences, all worth knowing before operating:

- **A change to this checkout is a change to `btid`.** No reinstall and no rebuild needed for the CLI's own code — `btid` runs
  this `dist/`. But the core arrives as a **published artifact**, `release/btid-core-0.6.0.tgz` (`file:` in
  `package.json`), the same way `githubdb` does: after changing `btid-core`, bump its version, `npm pack` into `release/`,
  repoint the CLI's dependency and reinstall. That is the distribution being exercised rather than assumed.
- **Moving or deleting the checkout breaks the command.** `npm uninstall -g btid-cli` and reinstall from the new location.
- **The name was taken.** The previous product, `btid@0.4.0` (the local-app tracker, superseded by `btid2`), was installed
  globally under the same command. It has been uninstalled, and reinstalling it later would take the name back.

Sign-in needs no setup on this machine: `gh` is signed in, so `BTID_TOKEN` can be left unset.

### Why the second command is fast

The first read in a session pays for the store; the ones after it do not. `btid` keeps a **snapshot** of the rows beside the
commit they were read at, the same way the SPA keeps one for the next tab. A command then makes **one** request — the branch
head — and either hydrates the rows it already has or loads the store afresh:

| | requests | time here |
|---|---|---|
| first read (cold) | tree + one per file + head | ~3.0 s |
| second read (snapshot) | head only | ~0.9 s |
| a write (warm) | head + commit + one tree to refresh the snapshot | ~5 s |
| a write (cold) | tree + files + commit + tree | ~6.5 s |

- The file is **gzipped above 2 KB** and plain JSON below it — gzip by magic bytes, not by a flag, so a snapshot written by an
  older build still opens, and a small one stays readable with `cat`. A store is a tenth of its size on disk, which is what
  `btid2` found for the same JSON.
- `--fresh` ignores the snapshot for one call and writes a new one from a real load.
- `BTID_NO_CACHE=1` turns it off for a session; `BTID_CACHE_DIR` moves it.
- `btid cache show` prints the directory and what is in it; `btid cache clear` deletes every snapshot — both work with no
  store and no token. A snapshot that will not decode is deleted on sight rather than parsed and rejected on every command.
- **A write refreshes the snapshot rather than dropping it.** The commit sha comes back from the write itself, so the rows
  need no request; the listing is re-read with **one** tree call, because `githubdb`'s post-write baseline is built from paths
  rather than shas (filed as a task there). A loop of writes therefore stays warm: ~5 s each instead of ~6.5 s.
- The commit is a claim, and it is checked against the head every time — a snapshot is never trusted on its own.

### Which build is answering?

```console
$ btid version
btid 0.1.0 · btid-core schema v1 · manifest 1

$ btid version --json
{"btid":"0.1.0","coreSchema":1,"manifest":1}
```

Three numbers, and they move for different reasons: the CLI's version moves when a verb is added, `coreSchema` is the store
version this build speaks (a store at another version is refused, not migrated), and `manifest` is the shape of
`btid help --json`. A report of a bug should carry this line — it says what the caller believed it was talking to.

## 1. Install it, or run it from the checkout

The published artifact is **[release/btid-cli-0.3.0.tgz](release/btid-cli-0.3.0.tgz)** — **self-contained**: `btid-core 0.6.0`
and `githubdb 2.1.0` are bundled, so it installs anywhere, with no checkout beside it:

```console
$ npm install -g ./btid-cli-0.3.0.tgz
$ btid version
btid 0.3.0 · btid-core schema v1 · manifest 1
```

That is what "publish" means while no registry is available; `btid-core/docs/distribution.md` records the registry checklist.


```console
$ npm install -g .          # from the btid-cli checkout; `prepare` builds `dist/`
$ btid help --json | jq '.verbs | length'
10
```

or, without installing:

```console
$ node /path/to/btid-cli/dist/bin.js help
```

## 2. Say where the store is, and who you are

```console
$ export BTID_STORE=yuk-org/btid-store@main      # owner/repo[@branch] — there is no default on purpose
$ export BTID_TOKEN=$(gh auth token)             # or leave it out and let the CLI use the gh session
$ btid store whoami
store    yuk-org/btid-store@main (env)
handle   chengyukpong
role     manager
people   1
projects 0
```

The repository must already exist and the token must have `Contents: write`. Creating a repository is GitHub's job, not
this CLI's; creating the **store inside it** is `btid store init`.

## 3. Create a store, once

```console
$ btid store init
init  yuk-org/btid-store@main
      manager chengyukpong
```

Two commits: `githubdb.json` naming the schema version, then `people.json` holding you as the manager. A second `store
init` on the same repository is refused — a store's version is not something to re-decide by rerunning a command.

## 4. The loop an agent actually runs

```console
$ btid project new alpha "Alpha One" --start 2026-10-26 --end 2026-11-23   # key normalised: Alpha → alpha
$ btid task new --project alpha --title "Check the header budgets"
captured  alpha-n0qz   backlog   Check the header budgets

$ btid task ls projectId=alpha status=backlog
$ btid task show alpha-n0qz
$ btid task edit alpha-n0qz --end 2026-11-20 --note "Client moved the review."
```

Every write is **one commit**, named after the verb and the row (`capture alpha-n0qz`, `edit alpha-n0qz`). There is no
autosave and no batch: a verb that succeeds has already written, and a verb that refuses has written nothing.

### Seed a store one row at a time

A store is not useful until it has a project, a roster and a dozen tasks, and every one of them is a command:

```console
$ btid project new alpha "Alpha One" --start 2026-10-26 --end 2026-11-23
project  alpha   Alpha One

$ btid person new ivan --name Ivan
person  ivan   Ivan   member

$ btid task new --project alpha --title "Check the header budgets"
captured  alpha-n0qz   backlog   Check the header budgets
$ btid task new --project alpha --title "Write the failing test" --priority urgent
captured  alpha-c3d4   backlog   Write the failing test
```

**One row, one command, one commit.** There is no `--file` anywhere in this CLI: a list of changes is a *sequence*, and the
verb that runs a sequence is `plan` — designed, not yet built. Until it exists, seeding a store is one command per row, and the
core still holds the batch form (`createTasks`, `updateTasks`, …) for whoever builds that.

### A plan runs a file of commands

One file, one process, one store. A plan is a list of steps run in order — create, edit, delete, and `show` — with the id a
step produced usable by the next one:

```
# seed.btid
let ivan  = person new ivan --name Ivan
let gamma = project new gamma "Gamma" --start 2026-11-03 --end 2026-12-18
let task  = task new --project $gamma.id --title "First task"
            task edit $task.id --assignee $ivan.id --start 2026-11-09 --end 2026-11-13 --estimate 2 --dod "Done."
            task promote $task.id
```

```console
$ btid plan seed.btid
ok   1  person new
ok   2  project new
ok   3  task new
ok   4  task edit
ok   5  task promote
5 steps, 5 ran, 0 refused
```

- **`let <name> =`** binds the step's **result**, not an id: `$task.id` reads a field, `$task` alone is refused
  (*"is a result, not a value — write $task.id"*), and a field the row does not have is refused with the list of the ones it does.
- **A line is `verb args flags`,** parsed by the same flag parser the terminal uses. `#` comments, blank lines ignored, and
  shell syntax — `&&`, `|`, `;`, `>`, `$(…)`, `$ENV` — refused **by name**, because a file that looks like a shell script and
  is not one is worse than either.
- **The plan is checked before anything runs:** an unknown verb, an unknown flag, a bare reference, or a step that only reports
  (`task ls`) fails with exit `2` and no request.
- **`--commit=each`** (the default) commits per step, so progress is real and a refusal leaves what already happened;
  **`--commit=end`** writes once, so a failure leaves the store untouched — the summary says *"nothing was written"*.
- One identity: the token's. There is no `--as`, and a step that would change who is asking is refused.
- `--dry-run` prints the steps and runs nothing (not even a `show`); `--quiet` reduces the transcript; `--json` emits the steps
  and their results.

The same file may be JSON — `{"steps": [{"let": "task", "verb": "task new", "flags": {…}}, {"verb": "task promote", "args": [{"$ref": "task.id"}]}]}`
— which is what a machine generating a plan should write.

### Every editable field has a flag

Nothing is settable only by editing JSON. The three `edit` verbs cover the three rows:

| verb | flags |
|---|---|
| `task edit` | `<id>` + `--title --description --dod --status --priority --assignee --start --end --percent --estimate --tracked --small --blocked --blocked-reason --blocked-by --labels` (+ `--note` for a tracked end-day move) |
| `project edit` | `--name --start --end --description --status --color --members --labels` |
| `person edit` | `--name --handle --role --active` |

**Deleting** exists for all three types, and asks first — `--yes` is required, because deleting is the one action with no undo:

```console
$ btid task remove alpha-a1b2                 # exits 2: "deletes a row and cannot be undone. Pass --yes to mean it."
$ btid task remove alpha-a1b2 --yes
removed  alpha-a1b2   Check the header budgets

$ btid project remove alpha --yes             # refused: PROJECT_NOT_EMPTY, "still holds 3 tasks… remove it with --cascade"
$ btid project remove alpha --yes --cascade   # and its tasks with it
removed  alpha   Alpha One   and 3 tasks

$ btid person remove ivan --yes               # refused: PERSON_IN_USE while they hold work
```

A person who has left is **deactivated** (`person edit --active off`), not deleted: removing somebody who is still an assignee or
an owner would leave rows naming a ghost. And the two reads a plan uses to reuse an existing row exist too — `project show <id>`,
`person show <id|handle>` — alongside `task show`.

**Every verb changes one row.** An edit takes an id and its fields, a creation takes one row's worth of flags, and there is no
list form on any of them: several changes in sequence are what `plan` will do, and a second list format on the verbs was a
dialect pretending to be a feature.

`none` clears a nullable field (`--estimate none`, `--labels none`, `--start none`). On/off flags take `on` or `off` — a bare
flag cannot say whether you meant to set or clear.

**An unknown flag is refused (exit 2), naming what the verb does take.** A typo used to be ignored, which read as "needs at
least one field to change" — the wrong sentence for the wrong problem.

Two values the store decides, not the flag:

- a **short task** (`--small on`) books clock times: `--start 2026-11-10T09:00 --end 2026-11-10T13:00` is a four-hour
  booking, and day dates are refused by the schema;
- a **tracked** task's end day needs `--note`, and that is asked before the schema is reached.

**A captured item becomes board work by promotion, not by a status flag.** Editing `--status todo` on a backlog row is refused —
  the rule is `NOT_ALLOWED` with *"Promote the item to move it onto the board."* — and the verb that does it is:

```console
$ btid task promote alpha-b9z9              # lands in todo
$ btid task promote alpha-b9z9 --status in_progress
promoted  alpha-b9z9   in_progress   rev 1
```

The gate is the SPA's: a title, an owner, both dates, an estimate and a definition of done. Missing any of them is
`PROMOTION_INCOMPLETE` with the sentence the card shows (*"Before promotion: add an estimate and a definition of done."*).
Promoting twice is refused (`ALREADY_PROMOTED`) — after the first crossing, `task edit --status` is the way to move columns.

**Give a project its window, or it cannot take work.** A task needs a project with both dates, so a project created without
them refuses every capture with `PROJECT_NOT_READY` — deliberately, but a wall if you meet it afterwards. `project edit` is
the way to add the window later, and it is the same command that renames or re-dates:

```console
$ btid project edit alpha --start 2026-10-26 --end 2026-11-23
edited  alpha   Alpha One

$ btid project edit alpha --end 2026-10-01
refused: A project cannot end (2026-10-01) before it starts (2026-10-26). (PROJECT_WINDOW_INVALID)
```

Use `--dry-run` to check a write without committing it:

```console
$ btid task edit alpha-n0qz --title "Renamed" --dry-run
would commit: edit alpha-n0qz
```

## 5. Where the field names come from

There is no hand-kept list, because a hand-kept list is a second definition of what a task is. The fields are read off
`btid-core`'s own zod schemas by `toJSONSchema()` and published in the manifest:

```console
$ btid help --json | jq '.types[] | "\(.type): \(.fields | length) fields"'
task: 29 fields
project: 13 fields
person: 6 fields

$ btid help --json | jq '.types[0].fields[] | select(.name == "status")'
{"name":"status","type":"string","required":true,"values":["backlog","todo","in_progress","done"]}
```

and the same thing for a person to read:

```console
$ btid help task
task fields (29), as the store validates them:
  id                string      required
  taskId            string      required
  projectId         string      required
  firstPromotedAt   string|null required
  title             string      required
  …
  status            string      required  one of: backlog, todo, in_progress, done
```

So `--fields endDate,percentComplete` is checkable before the call rather than by failing it, and a field the store starts
validating is a field you can name the day it lands here.

## 6. Read the answer, not the prose

`--json` prints the core's own object or a refusal as data:

```console
$ btid task ls projectId=alpha --json
[{"id":"alpha-n0qz","taskId":"alpha-n0qz","status":"backlog", …}]

$ btid task edit alpha-a1b2 --end 2026-11-20 --json
{"error":{"kind":"refused","code":"END_DATE_NEEDS_REASON","message":"Changing the end day of a tracked task needs a reason."}}
```

| exit | means | the agent should |
|---|---|---|
| `0` | done, and (for a write) already committed | continue |
| `1` | **refused** — a rule said no; nothing was written | read `code` / `message`, change the input or ask the person |
| `2` | usage — the terminal could not parse the flags | fix the call; `btid help <verb>` is the answer |
| `4` | conflict — somebody else committed first | reopen and retry; the write was not attempted |
| `5` | there is no store in that repository | run `btid store init`, once |
| `2` (fault) | the store is at another schema version | do not migrate by hand; report it |

The codes worth branching on today: `END_DATE_NEEDS_REASON`, `TITLE_REQUIRED`, `TASK_NOT_FOUND`, `PROJECT_MISSING`,
`PROJECT_NOT_READY`, `PERSON_EXISTS`, `NOT_MANAGER`, `NOT_ALLOWED`, `QUERY_INVALID`.

## 7. What an agent must not do

- **Do not write the store's files yourself.** No `git` commits into the store, no editing `people.json` by hand: the rules
  that make a row valid, the activity log, and the revision are the core's, and a hand-written row is a store that the app
  will refuse to load later.
- **Do not retry a refusal unchanged.** A refusal is a rule; the same call gets the same answer. Change the input — a
  `--note`, a different day, a task that exists.
- **Do not invent a verb.** `btid help --json` lists what exists. `promote`, `step`, `comment` and `archive` are not built
  yet; they wait on `btid-core` commands, and doing them by hand in git is the failure this CLI exists to prevent.

## 8. The manifest

```console
$ btid help --json
{"name":"btid","version":1,
 "verbs":[{"name":"task ls","summary":"…","usage":"…","writes":false,"flags":[…]}, …],
 "exitCodes":{"ok":0,"refused":1,"usage":2}}
```

`writes: true` marks the verbs that commit. A caller that wants to be sure it is reading rather than writing can filter on
that field, which is the one thing the shape promises: **reading and writing look different**.
