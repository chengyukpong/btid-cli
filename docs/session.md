# A session, before any of it exists

What `btid` should feel like, written as the transcript it has to produce. It is a specification: every line below is
either output or a refusal the core already owns the words for, and each verb is `parse → one command → print`.

The store is `yuk-org/btid-store`, the person is `chengyukpong`, and the terminal is a laptop that already has `gh`
signed in — the first of the three sign-in attempts in [`sign-in.md`](sign-in.md).

---

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
$ btid ls --mine
ID       TITLE                                 PROJECT  STATUS       DAYS  DUE
T-42     Short tasks in hours                  Alpha    in progress  0.5   today
T-77     Board page render time                Alpha    todo         1.5   Fri 14 Nov
T-91     The store refuses a stale write       Beta     backlog      —     —
```

The `DAYS` column is `estimateDays`, and a small task shows its hours-only booking as the fraction it is stored as.
`DUE` says what the board says: `today`, `Fri 14 Nov`, or `—` when nothing is promised.

```
$ btid ls --project alpha --status done --since 2026-11-01
```

Filters are the same words the app's filters use, because they are answered by the same query in `btid-core`. A flag
here that the app cannot express is a flag that will disagree with it.

## 3. One task, in full

```
$ btid show T-42
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
$ btid move T-42 done
error: Refusing to finish T-42: 2 of 3 steps are still open.
```

That is `btid-core`'s refusal, printed verbatim. The CLI has no opinion about steps; it printed what the command
returned, and exited 1.

```
$ btid edit T-42 --end 2026-11-14
error: Changing the end day of a tracked task needs a reason. Pass --note, or untrack it first.
```

This is the sentence the whole extraction was for. In the app it lived in a store, so a CLI would have had to remember
to ask. Here the command refuses on its own, and the CLI's only job is to have a way to pass the note:

```
$ btid edit T-42 --end 2026-11-14 --note "the PM half moved to Friday"
edited T-42 · endDate 2026-11-11T12:00 → 2026-11-14T17:00 · 1 commit
```

`· 1 commit` is literal: one command, one `flush`. The next line in the terminal could be `git log` in the repository
and it would show that one commit with the note in it.

## 5. Work in progress, from the keyboard

```
$ btid step add T-42 "The board draws a half day"
step added · 3 of 4 · 1 commit

$ btid step done T-42 4
step 4 done · 4 of 4 · 1 commit

$ btid comment T-42 "Half day drawn; the estimate reads 3h of an 8h day."
commented · 1 commit
```

Three commands, three commits, three lines. No verb does two things, because a verb that does two things cannot be
undone in one.

## 6. Promotion, and what it costs

```
$ btid promote T-91
error: Before promotion: add a title, an owner, a start date, an end date, an estimate and a definition of done.
```

The gate is the core's, in the core's words. The CLI does not count what is missing and it does not phrase the list.

```
$ btid edit T-91 --assignee ivan --start 2026-11-17 --end 2026-11-19 --estimate 3 --dod "A stale write is refused, not lost."
edited T-91 · 4 fields → 1 commit

$ btid promote T-91
promoted T-91 · backlog → todo · 1 commit
```

## 7. The week, which is a query and not a command

```
$ btid week
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

$ btid project new gamma "Gamma"
error: Only the manager can create projects.

$ btid project new gamma "Gamma" --color '#7E57C2'
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
$ btid init yuk-org/btid-store
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

## What the transcript pins down

**The actor is resolved before every command, and in two steps.** The token answers *who GitHub says you are*; the
roster answers *who you are here*. A login with no roster row is a refusal naming the way out — ask a manager. Nothing is
read or written before that, which is why no verb takes an `--as`: a flag that claims another identity is a flag that
lies about who did the work, and every activity row in the store records one.

**Every `new` takes a file.** Creation is the one verb whose input is a shape rather than a value, so it does not take a
pile of flags — it takes JSON:

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

**Naming.** The binary is `btid`; a verb is one word (`ls`, `show`, `move`, `edit`, `promote`, `step`, `comment`,
`week`, `whoami`). Two-word verbs are the exception (`step add`), and only where the noun is shared.

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

