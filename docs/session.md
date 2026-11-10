# A session, before any of it exists

What `btid` should feel like, written as the transcript it has to produce. It is a specification: every line below is
either output or a refusal the core already owns the words for, and each verb is `parse → one command → print`.

The store is `yuk-org/btid-store`, the person is `chengyukpong`, and the terminal is a laptop that already has `gh`
signed in — the first of the three sign-in attempts in [`sign-in.md`](sign-in.md).

---

## 0. The grammar

Every verb is a **type**, a **verb**, and then its arguments:

```
btid <type> <verb> [query] [order] [--fields a,b,c] [--json]

  type   task | project | person | store
  verb   ls | show | new | edit | ...        (per type, below)
```

| type | reads | writes |
| --- | --- | --- |
| `task` | `ls`, `show`, `week`, `stats` | `new`, `edit`, `move`, `promote`, `step add\|done`, `comment`, `archive` |
| `project` | `ls`, `show` | `new`, `edit`, `archive` |
| `person` | `ls`, `show` | `new` (join), `edit` (role, active) |
| `store` | `whoami` | `init` |

Reads share one shape, which is the whole point of the standardisation:

```
btid task ls [query] [order] [--fields a,b] [--json]
btid project ls [query] [order] [--json]
btid person ls [query] [order] [--json]

btid task show <id> [--json]
btid project show <id> [--json]
btid person show <login> [--json]
```

`[query]` is the app's own filter syntax; `[order]` is one bare token — `endDate`, `endDate,priority`, or
`-priority,endDate` — bare because query terms always carry an `=`, so the two cannot be confused, and neither needs
quoting. `--json` prints the rows unchanged.

**`[order]` is a list, not a field.** `endDate,priority` sorts by the first and then the other; a leading `-` reverses
that key, so `-priority,endDate` is most urgent first and earliest promise second. It is still one token — no `=` in it —
so it cannot collide with a query term, and a composite order is what most real questions want.

**Nulls sort last in both directions.** A task with no end date is not "earliest", it is unplanned, and burying it is the
only reading that does not lie.

### `--fields`: the row is the core's, the columns are the terminal's

The core answers with whole rows, and it should — a projection in the core would be a second definition of what a task is,
and the first front end to want one more field would edit it. But a table of six columns out of twenty is what a terminal
is for, so the CLI projects:

```
$ btid task ls projectId=alpha --fields title,status,endDate
TITLE    STATUS       END DATE
task1    in progress  Tue 25 Nov

$ btid task ls projectId=alpha --fields title,status,endDate --json
[{"title":"task1","status":"in_progress","endDate":"2026-11-25T17:00"}]
```

Four rules, and they are what keeps this from becoming a second schema:

- **Field names are the row's own**, in camelCase — `endDate`, `definitionOfDone`, `estimateDays`, `firstPromotedAt`. No
  aliases, because an alias is a second name for something that already has one.
- **`--fields` projects `--json` too.** One projection, two renderings: what the table shows and what the script gets are
  the same object, so they cannot drift.
- **An unknown field is a usage error (`2`), and the message lists the fields the rows actually have** — read off the rows,
  not from a hand-kept list, so a new field in the core appears in the CLI the day it lands there.
- **No computed columns.** `--fields` selects; it never calculates. `days` is `estimateDays` rendered, `due` is
  `endDate` rendered, and both are **default** columns rather than fields you can ask for — a terminal that invents
  `velocity` is a terminal disagreeing with the app.

Defaults, per type, so the common case needs no flags:

| type | default columns |
| --- | --- |
| `task` | `id`, `title`, `status`, `assigneeId`, `estimateDays`, `endDate` |
| `project` | `id`, `name`, `status`, `startDate`, `endDate`, `ownerId` |
| `person` | `id`, `role`, `active`, `githubHandle` |

`show` prints everything and takes `--fields` for the same reason: a script that wants two fields from one task should not
have to `jq` a full row to get them.

Three verbs sit outside the table because they are not about one type: `btid whoami` (the session), `btid task week` and
`btid task stats` (reports over tasks, which is what they are about).
## 1. Who am I, and where am I pointing

Every command resolves the **actor** first, before it touches the store: the token proves *who GitHub says you are*
(`GET /user`), and the roster decides *who you are in this store*. Two different questions, and a command that answered
only the first would let a stranger act.

```
$ btid whoami
chengyukpong            manager          GitHub CLI token, 40 characters, expiring 2026-12-09
yuk-org/btid-store@main 2 projects, 10 tasks, roster of 5
```

The first column is the GitHub login, the second is the roster's role for it. A login that is not on the roster is a
refusal, not a quiet session:

```
$ btid whoami
chengyukpong            not on this store's roster
error: Your GitHub account (@chengyukpong) is not on yuk-org/btid-store's roster. Ask a manager to add you.
```

Two lines when it works, and the second one is the part people forget: a command that ran against the wrong repository is
the failure this output exists to prevent. The token's **length and expiry** are shown, never the token.

```
$ btid whoami --json
{"login":"chengyukpong","role":"manager","token":{"source":"gh","expires":"2026-12-09"},"store":{"owner":"yuk-org","repo":"btid-store","branch":"main"}}
```

`--json` is offered by every verb. A CLI that can only print tables cannot be scripted, and the first thing anyone does
with a terminal tool is put it in a `for` loop.

## 2. What is on my plate

```
$ btid task ls assigneeId=me -priority,endDate
ID       TITLE                                 PROJECT  STATUS       DAYS  DUE
T-42     Short tasks in hours                  Alpha    in progress  0.5   today
T-77     Board page render time                Alpha    todo         1.5   Fri 14 Nov
T-91     The store refuses a stale write       Beta     backlog      —     —
```

The `DAYS` column is `estimateDays`, and a small task shows its hours-only booking as the fraction it is stored as.
`DUE` says what the board says: `today`, `Fri 14 Nov`, or `—` when nothing is promised. The trailing `due` is the order.

```
$ btid task ls projectId=alpha status=done updatedAt>=2026-11-01 title
```

Filters are the same words the app's filters use, because they are answered by the same query in `btid-core`. A flag
here that the app cannot express is a flag that will disagree with it — which is why there are none.

## 3. One task, in full

```
$ btid task show T-42
T-42  Short tasks in hours                          Alpha · in progress · high
      owner chengyukpong · created 2026-11-09 by chengyukpong
      start 2026-11-11T09:00   end 2026-11-11T12:00   booked 3h of 8h

  Steps (2 of 3)
  [x] Schema accepts the flag
  [x] Hours survive the round trip
  [ ] The board draws a half day

  Comments (1)
  2026-11-10  chengyukpong  The PM half starts at 13:00, per the decision on T-31.

  Activity (4)
  2026-11-10  percentComplete 40 → 60
  2026-11-10  endDate 2026-11-12 → 2026-11-11T12:00
```

Read-only, one load, one commit not made. Note that the small task's booking is printed as hours, not as `0.375` — the
storage unit is mandays, and the terminal is a place to convert it back.

## 4. Moving a task — and the rule that proves the boundary

```
$ btid task edit T-42 --end 2026-11-14
error: This task is tracked: moving its end date to a later day needs a reason.
```

This is the sentence the whole extraction was for. In the app it lived in a store, so a CLI would have had to remember
to ask. Here the command refuses on its own, and the CLI's only job is to have a way to pass the note:

```
$ btid task edit T-42 --end 2026-11-14 --note "the PM half moved to Friday"
edited T-42 · endDate 2026-11-11T12:00 → 2026-11-14T17:00 · 1 commit
```

Note what the first transcript got wrong before this was checked against the code: there is **no** "2 of 3 steps are still
open" refusal. Unticked steps on a finished task are a warning the board shows, not a gate — so `btid move T-42 done`
succeeds and the CLI prints the warning beside it rather than pretending the command refused.

`· 1 commit` is literal: one command, one `flush`. The next line in the terminal could be `git log` in the repository
and it would show that one commit with the note in it.

## 5. Work in progress, from the keyboard

```
$ btid task step add T-42 "The board draws a half day"
step added · 3 of 4 · 1 commit

$ btid task step done T-42 4
step 4 done · 4 of 4 · 1 commit

$ btid task comment T-42 "Half day drawn; the estimate reads 3h of an 8h day."
commented · 1 commit
```

Three commands, three commits, three lines. No verb does two things, because a verb that does two things cannot be
undone in one.

## 6. Promotion, and what it costs

```
$ btid task promote T-91
error: Before promotion: add a title, an owner, a start date, an end date, an estimate and a definition of done.
```

The gate is the core's, in the core's words. The CLI does not count what is missing and it does not phrase the list.

```
$ cat t91.json
{ "assigneeId": "ivan", "startDate": "2026-11-17", "endDate": "2026-11-19",
  "estimateDays": 3, "definitionOfDone": "A stale write is refused, not lost." }

$ btid task edit T-91 --file t91.json
edited T-91 · 5 fields → 1 commit

$ btid task promote T-91
promoted T-91 · backlog → todo · 1 commit
```

## 7. The week, which is a query and not a command

```
$ btid task week
Alpha
  T-42  Short tasks in hours    in progress   3h of 8h booked
  T-77  Board page render time  todo          1.5 md
Beta
  T-91  The store refuses…      todo          3 md
```

Read-only. No flag on this verb writes anything, and there is no verb whose read is also a write — a CLI that syncs
while you look at it is a daemon.

---

---

## 8. A project, which is a manager's act

```
$ btid project ls
ID      NAME    OWNER          TASKS  CREATED
alpha   Alpha   chengyukpong   6      2026-11-03
beta    Beta    yukfile        4      2026-11-05

$ btid project new --file projects/gamma.json
error: Only the manager can create projects.

$ btid project new --file projects/gamma.json --color '#7E57C2'
created gamma · owner chengyukpong · 1 commit

$ btid project new --file projects/gamma.json
created gamma · owner chengyukpong · 1 commit
```

`canWriteConfig` decides, in the core, exactly as it decides the roster — but only after the CLI has established **who
is asking**, which it must do before every write. The refusal above is the core's sentence, the same one the app's toast
shows, and the CLI adds nothing to it.

A project is also the only thing that can be **archived**, which is the one command in this front end that both tags and
deletes:

```
$ btid project archive gamma
archived gamma · tag archive/gamma-2026-11-11 · 6 tasks deleted · 1 commit
```

The tag is what makes it survivable: the rows are gone from the branch and the commit that held them is named.

## 9. Starting a store, which is where the manager comes from

A store created by `githubdb init` is empty — no people, no projects. The app's rule is that a signed-in account gets a
**member** row, and the roster's rule is that only a **manager** may write the roster. Put together, the first account to
arrive becomes a member, nobody is a manager, and nobody can ever appoint one. The SPA escapes this only because its store
was seeded by a script; a CLI handed a fresh store would walk straight into it.

**So `init` requires a manager, and the manager is the operator running it.** There is no separate bootstrap verb to
remember, and no moment at which a store exists without somebody able to administer it:

```
$ btid store init yuk-org/btid-store
created yuk-org/btid-store at v1 · chengyukpong is its manager · 1 commit
```

That one command is `githubdb`'s `initStore` plus one roster row — the operator, as manager — and it is the only place a
person row is written without a manager already existing. Which makes the invariant readable:

> **A store always has a manager, because creating the store and appointing the first one are the same act.**

The last-manager guard from the other side is what keeps it true afterwards: no write may leave the roster with no active
manager. Every other person arrives through `joinRoster`, as a member, and a manager promotes them.

**What it costs the implementation:** one commit rather than two, which means `githubdb`'s `initStore` has to accept the
rows a store begins with — `initStore(registry, { client, expect, data })` — instead of always writing `emptyData`. That is
a small, well-shaped addition to the engine (a minor version), and it is worth more than the alternative of initialising
and then writing a second commit that a reader would have to know to expect.

**What it removes:** `bootstrapRoster` does not exist as a command, here or in the core. §1's "two ways out" becomes one:

```
error: Your GitHub account (@chengyukpong) is not on yuk-org/btid-store's roster. Ask a manager to add you.
```

The way out is a person, which is what a roster is for.

---

## 10. The whole life of one task, start to finish

The flow a person actually performs, in order, with the files it needs. Every line is one command and one commit, and
every refusal is the core's.

```
$ cat alpha.json
{ "id": "alpha", "name": "Alpha", "startDate": "2026-11-01", "endDate": "2026-12-31" }

$ btid project new --file alpha.json
created alpha · owner chengyukpong · 1 commit
```

The dates are in the file for one reason: without them `captureRefusal` refuses to let the project take work at all —
*"Alpha needs a start date and an end date before it can take new work."* The app asks for them a step later; the file
just carries them from the start.

```
$ cat t1.json
{ "projectId": "alpha", "title": "task1", "priority": "high" }

$ btid task new --file t1.json
created alpha-1 · backlog · 1 commit
```

A new task is always `backlog` and belongs to a project; the id is minted (`<project>-<n>`) and never re-minted.

```
$ btid task promote alpha-1
error: Before promotion: add a title, an owner, a start date, an end date, an estimate and a definition of done.
```

All six fields, in the core's words. Filling them is one edit, so it takes a file too:

```
$ cat t1-fields.json
{
  "assigneeId": "chengyukpong",
  "startDate": "2026-11-11",
  "endDate": "2026-11-18",
  "estimateDays": 3,
  "definitionOfDone": "task1 is visible on the board with a date and an owner."
}

$ btid task edit alpha-1 --file t1-fields.json
edited alpha-1 · 5 fields · 1 commit

$ btid task promote alpha-1
promoted alpha-1 · backlog → todo · 1 commit
```

```
$ btid task edit alpha-1 --tracked
edited alpha-1 · tracked false → true · 1 commit

$ btid task move alpha-1 in-progress
moved alpha-1 · todo → in progress · 1 commit
```

`in-progress` is accepted and normalised to the stored `in_progress` — a spelling convenience at the argument layer, not a
rule. The status itself is just a field; nothing refuses this move.

```
$ btid task edit alpha-1 --end 2026-11-25
error: This task is tracked: moving its end date to a later day needs a reason.

$ btid task edit alpha-1 --end 2026-11-25 --note "the client review moved a week"
edited alpha-1 · endDate 2026-11-18T17:00 → 2026-11-25T17:00 · 1 commit
```

That pair is the boundary in one screen. The CLI did not decide that a note was needed — it passed `--note` through and
printed what came back.

```
$ btid task edit alpha-1 --progress 100
edited alpha-1 · percentComplete 60 → 100 · 1 commit
```

Progress is not a move: it is a field, and finishing is a status. They are separate commands because they are separate
decisions.

```
$ btid task move alpha-1 done
moved alpha-1 · in progress → done · 1 commit
```

Nothing gates this one. The steps, if any are open, come back as a warning printed under the line — the board would show
the same thing, and a warning is not a refusal.

```
$ btid task show alpha-1
alpha-1  task1                                    Alpha · done · high
         owner chengyukpong · created 2026-11-11 by chengyukpong
         start 2026-11-11T09:00   end 2026-11-25T17:00   estimate 3 md

  Activity (7)
  2026-11-11  created
  2026-11-11  promoted  backlog → todo
  2026-11-11  tracked   false → true
  2026-11-11  status    todo → in progress
  2026-11-11  endDate   2026-11-18T17:00 → 2026-11-25T17:00   "the client review moved a week"
  2026-11-11  percentComplete  60 → 100
  2026-11-11  status    in progress → done
```

Seven commits for seven writes, and the note is in the history where a reviewer will look for it. That is the whole
point of the split: `git log` of the store repository is the audit trail, and it does not care which front end wrote it.
## 11. Queries: one syntax, and it is the app's

Reading is the half of a tracker people use most, so it gets **one** shape rather than a flag per thought:

```
$ btid task ls                              # the whole store, one flat table
$ btid task ls projectId=alpha                 # one project
$ btid task ls assigneeId=me status=todo       # narrow inside it
$ btid task ls endDate<=2026-11-15 labels=urgent # the signals the board draws
$ btid task ls text=auth updatedAt>=2026-11-01  # free text, and recency
$ btid task ls group=status                 # sectioned, by one of the board's groupings
```

**Grouping is a query term, not a flag** — `group=projectId`, `group=status`, `group=assigneeId`, `group=priority`,
`group=label` — because the board already has that vocabulary and `readCompactQuery` already parses it into `groupBy`.
Deferred: the **sectioned rendering**. Today a `group=` query still filters and orders correctly and prints one flat table,
so nothing is silently wrong; the grouped layout arrives with the verb, and it will need no grammar change because the
intent is already in the parsed query.

That is not a syntax invented for the terminal. `btid-core` already parses it — `readFilterQuery(text, lookups)` is what
turns the app's URL fragment into a scope and a narrowing — so a link copied out of the browser is a query the CLI
understands, character for character. The CLI's job is to split argv on spaces, join it back, and hand it over.

The two lookups it has to supply are the store's own: `projectId=alpha` resolves a project **name** to its id, `assigneeId=cheng`
a GitHub handle to a person id. They come from the rows just loaded, never from a hardcoded map — which is why a store
with a project called `auth` and a person called `auth` is a question the core answers, not the CLI.

```
$ btid task ls projectId=alpha status=in-progress
ID       TITLE                        OWNER          DUE         DAYS
alpha-1  task1                        chengyukpong   Tue 25 Nov  3

3 of 10 tasks · project Alpha · status in progress
```

The footer is `describeFilters`'s sentence. It exists because the most common misreading of a filtered list is that the
store is nearly empty — the sentence says what was hidden, in the same words the app's filter chips use.

**The verbs that read, and what each answers:**

| verb | the core it calls | answers |
| --- | --- | --- |
| `btid task ls [query] [order]` | `readFilterQuery` + `taskFilters` + `boardSort` | which tasks, in board order |
| `btid task show <id>` | one row | one task: fields, steps, comments, activity |
| `btid task stats [query]` | `summarise` | counts and mandays by status, priority, project |
| `btid task week [--weeks n]` | `weekActivity` | what closed or fell due this week, back `n` weeks |
| `btid person show <login>` | `personActivities` | what one person did, week by week |
| `btid project ls` / `show <id>` | project rows | the portfolio |
| `btid people` | roster rows | who is on it, their role, active or not |
| `btid whoami` | roster row for the token's login | who you are here, and what you may do |

```
$ btid task stats projectId=alpha
Alpha                        6 tasks   2 done   3 in progress   1 todo
  mandays                    booked 11.5 / estimated 14          (1 short task booked in hours)

$ btid task week --weeks 3
              W44      W45      W46
finished      2        1        0
due           3        2        1
```

```
$ btid person show chengyukpong
chengyukpong · manager · active
  this week   3 edits   1 comment   2 steps ticked   task1 finished
```

**Three rules that keep queries honest:**

- **A query verb never writes.** No `sync`, no `flush`, no scheduled commit — the transcript's read verbs are read-only by
  construction, not by care. A CLI that saves while you look at it is a daemon, and this is not one.
- **`--json` prints the core's rows unchanged.** The table is a rendering of the same array, so a test asserts on the JSON
  and the human output cannot drift from it.
- **Ordering is the board's, not the terminal's.** `boardSort` decides, because two front ends sorting a list differently
  is the same class of bug as two front ends wording a refusal differently.
## 12. `btid help`, and why it is generated

```
$ btid help
btid — the tracker, from a terminal

  btid <type> <verb> [query] [order] [--fields a,b] [--json]
  btid whoami

  task      ls show week stats | new edit move promote step comment archive
  project   ls show           | new edit archive
  person    ls show           | new edit
  store     whoami            | init

  btid help task ls      one verb, with its arguments and an example
  btid help task         every verb of a type
```

```
$ btid help task ls
btid task ls [query] [order] [--fields a,b] [--json]

  List tasks. One load, no commit.

  query    projectId= assigneeId= status= priority= labels= text= tracked= blocked=
           group= (projectId|status|assigneeId|priority|label)
           updatedAt>=DAY  updatedAt<=DAY  endDate<=DAY
  order    endDate | updatedAt | priority | title | id     (comma for a composite, `-` for descending)

  $ btid task ls projectId=alpha status=todo due

  --fields limits the columns and the JSON alike; --json prints rows unchanged.
```

**The help text is generated from the same table that parses the arguments.** One registry of `type → verb → { usage,
arguments, example }`, and the parser, the help and the future shell completion all read it. Hand-written help is a
second specification, and the second specification is always the one that goes stale — which is exactly the failure this
project exists to prevent, one layer down.

Three conventions:

- **`--help` is the same page.** `btid task ls --help` prints what `btid help task ls` prints, because a person who types
  the wrong thing should not have to learn a second command to find out.
- **`btid help --json`** emits the registry: `[{type, verb, usage, arguments, example}]`. That is what a completion script
  consumes, and it costs nothing because the registry already exists.
- **Help never lists refusals.** Those come from `btid-core` at run time, in the core's words; a help page that quoted them
  would be a second copy free to drift. It says what the verb takes, not what it may say no to.
## 13. What an agent needs, which is not a README

A person learns a CLI by using it. An agent learns it by reading **one machine-readable thing** and trusting it, because it
cannot afford to discover behaviour by failing at it: every wrong guess is a round trip, and a write it guesses wrong at is a
commit somebody has to undo.

So the CLI's contract has to be *askable*, not documented:

```
$ btid help --json
{
  "version": "0.1.0",
  "types": {
    "task": {
      "verbs": {
        "ls":     { "usage": "...", "arguments": {...}, "example": "...", "reads": true,  "writes": false },
        "edit":   { "usage": "...", "input": { "$ref": "#/schemas/taskInput" }, "writes": true },
        "promote":{ ... , "requires": ["title","assigneeId","startDate","endDate","estimateDays","definitionOfDone"] }
      }
    }
  },
  "schemas": { "task": { ...JSON Schema... }, "project": {...}, "person": {...} },
  "query":   { "keys": {...}, "orders": [...], "groups": [...] },
  "exit":    { "0": "ok", "1": "refused", "2": "usage" }
}
```

Four things make that worth more than prose, and each is a rule rather than a feature:

- **It is generated from the registry the parser reads.** A help file written by hand is a second specification, and the
  second one goes stale — which is the failure this whole family of projects exists to prevent. `btid help --json` and
  `btid help task ls` are two renderings of one table.
- **The schemas are the core's own, exported as JSON Schema.** `TaskSchema`, `ProjectSchema`, `UserSchema` are zod objects;
  the core can render them, so the agent learns the *fields* — `endDate`, `estimateDays`, the `status` and `priority`
  enums — from the same definitions the store validates with. A hand-written list of fields would be a fifth copy of what a
  task is.
- **Every write has `--dry-run`.** Cheap here for the reason the whole design is layered: a command never flushes, the CLI
  does. So a dry run runs the command, prints its result — refusal or not — and skips the one call that commits. An agent
  can therefore *ask* "would this work?" without writing anything, which is the single most valuable property a CLI can
  offer to something that is not sure.
- **Failures are data too.** With `--json`, a refusal prints `{"error": {"kind": "refused", "message": "<the core's words>"}}`
  and exits 1; a usage error prints its own shape and exits 2. An agent that has to parse English to tell "the rule said no"
  from "I typed it wrong" will eventually get it wrong.

**What is deliberately *not* offered:** a natural-language or "smart" interface. The agent reads the manifest and composes
commands; the CLI stays a compiler for arguments. A tool that guesses what you meant cannot be tested, and this one is
tested by asserting on `--json`.

**And the README points at the manifest, it does not replace it.** `README.md` carries one short "For an agent" section —
run `btid help --json`, then the three-step loop — because a model that lands in this repository needs to know the binary
can be asked. Everything it *then* needs comes from the binary. A README describing the verbs would be a second
specification, and the one nobody regenerates.

**The one thing that stays human:** the refusal sentences. They come from `btid-core`, so the CLI cannot promise their
wording in a manifest without duplicating it. It promises the *shape* of a refusal and the exit code, and leaves the words
to the core that owns them.

---

## What the transcript pins down

**The actor is resolved before every command, and in two steps.** The token answers *who GitHub says you are*; the
roster answers *who you are here*. A login with no roster row is a refusal naming the way out — ask a manager. Nothing is
read or written before that, which is why no verb takes an `--as`: a flag that claims another identity is a flag that
lies about who did the work, and every activity row in the store records one.

**Every verb that takes more than one field takes a file.** `new` is the obvious case, but filling six fields of a task is
the same problem, so `edit` accepts one too. One field gets a flag; a shape gets JSON.

```
$ btid task new --file tasks/short-hours.json
created T-92 · Short hours survive the round trip · Alpha · 1 commit

$ btid task new -            # the same, from stdin
$ btid project new --file projects/gamma.json
```

The file is **the command's input, not the row**: no `id`, no `createdAt`, no `updatedAt`, no activity — the core mints
those, the same way it does for the app's dialog. `--file -` reads stdin, so `jq … | btid task new -` works, and a bad
field is refused by the schema with the field named rather than by a flag parser guessing.

Flags stay for the small edits (`--end`, `--note`, `--estimate`), because a `--file` for one field is worse than a flag.

**Naming.** The binary is `btid`, then a **type** (`task`, `project`, `person`, `store`), then a verb (`ls`, `show`, `new`,
`edit`, …). Three levels, always — no verb exists at the top level except `whoami`, so a person who has learned one command
can guess the next one.

**The store is configuration, in that order:** `--store owner/repo@branch`, then `BTID_STORE`, then a config file at a
documented path; no config is an error naming all three. Never a default repository — the transcript's second line of
`whoami` exists for this failure, and a wrong default would make it the common case.

**Exit codes:** `0` success, `1` the core refused (the sentence is the output), `2` usage error — as `AGENTS.md` already
says. A script can tell "the rule said no" from "you typed it wrong" without parsing English. **One question left open:**
a store or token failure currently lands on `2` as well, and it may deserve a code of its own — a wrong repository is not
a typo, and a script may want to retry a network failure but never a usage one. Not decided, so not invented here.

**One mutation is one commit**, and the message is the verb and the id: `btid: move T-42 to in progress`. The same
shape the app writes, so `git log` reads the same whichever front end made the change.

**Every refusal is the core's words.** If a verb has to explain something the core did not say, the sentence belongs in
the core.

## What this needs from `btid-core`, and does not have yet

**An actor resolution it can call.** `personFor(people, login)` already exists and answers "is this account on the
roster?" — but the refusal sentence is a rule, so the core owes a command-shaped helper (`actorFor(db, login)` returning
the identity or a refusal), not a sentence written in the CLI.

**A store creation it can call.** §9 puts the first manager into `init`, in one commit, which needs `githubdb`'s
`initStore` to accept the rows a store begins with. That is an engine change before the CLI can have an `init` verb.

The commands: `updateTask` (with the note rule and the steps gate), `promoteTask`, `addStep`, `tickStep`, `addComment`,
`createProject`, `saveProject`, `archiveProject`, `joinRoster`. The queries it already has. `bootstrapRoster` is gone —
§9 explains why the manager now arrives with the store.

Until those exist, every write verb in this document is a promise the CLI cannot keep — so the order is commands first,
then the verbs, then this transcript becomes a test.

