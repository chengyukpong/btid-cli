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

## Status

**Seed.** Nothing is implemented yet. It is built after `btid-core`, deliberately: the core is what this project is a
proof of, so it has to exist first.

## What it is not

Not a second source of truth, not a daemon, not a sync engine. It reads and writes the store through the engine, one
commit at a time, the same as the app in a browser.
