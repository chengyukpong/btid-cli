# btid-cli

The same tracker, from a terminal.

```
BTID-CLI ──► BTID-Core ──► githubdb
```

It exists to prove the boundary. If this CLI can move a tracked task's end day without a note, the rule is still buried
in the SPA's stores; if it cannot, the rule really does live in the core — and then the core is a thing both front ends
can trust.

## What it does

- **Read**: list tasks by project, by person, by signal; show one task with its steps, comments and activity; the week's
  activity.
- **Write**: the same commands the SPA calls — promote, move, archive, add a step, tick a step, comment, update — each
  one going through `btid-core`, with the same refusals in the same words.

Nothing is re-implemented here. A verb is a thin parse of arguments, one call, and output.

## Install

The package is one file with no dependencies, published as a GitHub release asset rather than to a registry:

```
# the newest release — the asset name does not change between versions
npm i -g https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz

# or one version, pinned
npm i -g https://github.com/chengyukpong/btid-cli/releases/download/v0.21.0/btid-cli-0.21.0.tgz

btid --help
```

No token, no registry, no `file:` dependencies: `btid-core`, `githubdb` and `zod` are tree-shaken into `dist/bin.bundle.js`
at build time (`npm run build`), so installing adds exactly one package.

`btid version` also says when a newer release exists — it asks GitHub at most once a day, keeps the answer beside the
snapshot cache, and prints the install command only when there is something to install:

```
$ btid version
btid 0.21.0 · btid-core schema v3 · manifest 3
latest  0.22.0 is available (this copy is 0.21.0)
        npm i -g https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz
```

`--json` never asks (machine output stays offline and unchanged), `--fresh` asks again, and `BTID_NO_UPDATE_CHECK=1` turns
the check off entirely.

`releases/latest/download/<name>` resolves the newest release but not a newest filename — which is why every release carries
the same bytes twice: `btid-cli-<version>.tgz` as the record, and `btid-cli.tgz` as the moving copy. `npm run release` cuts a
release with both; `docs/releasing.md` is the rule.

## Signing in

No browser relay, no GitHub App: a token from `gh auth token` when `gh` is signed in, otherwise a device flow so the CLI
works on a machine that has never had `gh`. Either way the token stays local.

## Why the second command is fast

A read keeps a **snapshot** of the store beside the commit it was read at — the same trick `btid2` uses for the next browser
tab — so the next command asks for the branch head and nothing else. `docs/operating.md` has the table; `--fresh` and
`BTID_NO_CACHE=1` are the escapes.

## The grammar

**[docs/grammar.md](docs/grammar.md)** — `btid <verb> <path> [data]`. Fifteen verbs, a path tree, and data always named:
`promote task/alpha-n7qk`, `add task/alpha-n7qk/label ui`, `done task/alpha-n7qk/step/st-a1b2`. Settled 2026-11-12 and
shipped in 0.12.0 as a hard cut: the old `task promote alpha-n7qk` spellings are refused with a message naming the new form.

## One task, end to end

[`docs/lifecycle-of-a-task.md`](docs/lifecycle-of-a-task.md) follows a single imaginary task from `new task` to `edit
task/alpha-n7qk --status done`: every command, every refusal at the moment it happens, the row's state after each one, and
the two lifecycle moments (archive, delete) that still have no verb.

## Driving it from an agent

[`docs/operating.md`](docs/operating.md) is the hand-off: install, where the store is, the loop, what the exit codes mean,
what an agent must not do — and the manifest it should read before its first call.

### The field names

There is no hand-kept list: the fields are read off `btid-core`'s own zod schemas by `toJSONSchema()` and published, so
`--fields` is checkable before the call rather than by failing it.

```console
$ btid help --json | jq '.types[] | "\(.type): \(.fields | length) fields"'
task: 29 fields
project: 13 fields
person: 6 fields

$ btid help --json | jq '.types[0].fields[] | select(.name == "status")'
{"name":"status","type":"string","required":true,"values":["backlog","todo","in_progress","done"]}

$ btid help task            # the same list, for a person to read
task fields (29), as the store validates them:
  id                string      required
  …
  status            string      required  one of: backlog, todo, in_progress, done
```

A field the store starts validating is a field this CLI can name the day it lands — there is no third place to update.

## Status

**Every row type can be created, changed, shown and deleted.** Fifteen verbs — `ls`, `show`, `new`, `edit`, `promote`,
`remove`, `add`, `rename`, `done`, `undo`, `clear`, `plan`, `whoami`, `version`, `help` — over the path tree in the grammar;
70 tests against a real `btid-core` and a real `githubdb` database with only the network replaced. `comment` and `archive`
wait on one core command each; writing the rule here is the one thing this project must not do. A project takes its window
at creation (`--start --end`) or later (`edit project/<id>`), because a project without both dates refuses every capture. A
verb changes **one row** and commits once. A sequence of rows is `btid plan` — a file of commands run in order against one
store, with `let`/`$task.id` threading ids between steps.

## What it is not

Not a second source of truth, not a daemon, not a sync engine. It reads and writes the store through the engine, one
commit at a time, the same as the app in a browser.

## For an agent

If you are a model using this CLI rather than a person reading about it, do not learn it from this file — it is prose, and
prose goes stale. Ask the binary:

```
$ btid version            # which build this is, and which schema it speaks
$ btid help --json        # verbs × paths, flags, the row fields, and the exit codes
$ btid help edit          # one verb's paths, flags and an example
```

Then the loop, which never needs English:

```
1. read btid help --json                       → what exists, what it takes, what the rows look like
2. btid <verb> <path> … --dry-run --json       → would this work? (runs the command, commits nothing)
3. btid <verb> <path> … --json                 → do it; on a refusal, exit 1 and the core's sentence in "message"
```

Two rules for this file, then: **examples here stay few**, because every line in a README is a test nobody runs; and the
manifest, not this page, is what an agent should trust. If the two ever disagree, `btid help --json` is right — it is
generated from the table the parser reads.