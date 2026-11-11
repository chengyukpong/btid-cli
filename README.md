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

## Signing in

No browser relay, no GitHub App: a token from `gh auth token` when `gh` is signed in, otherwise a device flow so the CLI
works on a machine that has never had `gh`. Either way the token stays local.

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

**The verbs the core can support are built, and installed.** `task ls|show|new|edit`, `project ls|new|edit`, `person ls|new|edit`,
`store whoami|init`, `version`, `help`, and `--file` batch creation on every `new` — 48 tests against a real `btid-core` and a real `githubdb` database with only the
network replaced. `promote`, `move`, `step`, `comment` and `archive` wait on one core command each; writing the rule here is
the one thing this project must not do. A project takes its window at creation (`--start --end`) or later (`project edit`),
because a project without both dates refuses every capture. Every `new` also takes `--file`: a JSON array seeded in one
commit, all or nothing, with the refusal naming the item that failed.

## What it is not

Not a second source of truth, not a daemon, not a sync engine. It reads and writes the store through the engine, one
commit at a time, the same as the app in a browser.

## For an agent

If you are a model using this CLI rather than a person reading about it, do not learn it from this file — it is prose, and
prose goes stale. Ask the binary:

```
$ btid version            # which build this is, and which schema it speaks
$ btid help --json        # every verb, its flags, the row fields, and the exit codes
$ btid help task          # one type's fields, as a page
$ btid help task ls       # one verb's usage and flags
```

Then the loop, which never needs English:

```
1. read btid help --json                       → what exists, what it takes, what the rows look like
2. btid <type> <verb> … --dry-run --json       → would this work? (runs the command, commits nothing)
3. btid <type> <verb> … --json                 → do it; on a refusal, exit 1 and the core's sentence in "message"
```

Two rules for this file, then: **examples here stay few**, because every line in a README is a test nobody runs; and the
manifest, not this page, is what an agent should trust. If the two ever disagree, `btid help --json` is right — it is
generated from the table the parser reads.