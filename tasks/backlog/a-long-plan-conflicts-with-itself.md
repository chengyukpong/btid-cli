# A long plan conflicts with its own commits

- **Status:** backlog
- **Created:** 2026-11-18T16:20:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`btid plan seed.btid --commit each` on a store with a warm snapshot ran 123 steps and then failed:

```
fault: step 167: projects/alpha/tasks.json changed since this store was read, so writing it would discard that change.
```

Nothing else was writing. The change was the plan's **own** commit from a few steps earlier: the engine's conflict check compares
the blob it read against the one on the branch, and inside a plan the post-commit snapshot refresh does not happen the way it
does for a single verb — `cli.ts` refreshes `seen` after one command, and the plan runner commits many without passing through
that path. The same plan with `--commit end` (one commit at the end) runs clean.

Two things worth separating:

1. **The conflict check is right.** Refusing to discard a change it did not see is the feature; the bug is that the store cannot
   see a change *it made itself* a moment ago.
2. **The fix belongs where the refresh is.** Either the plan runner refreshes after each commit (one tree request per commit, which
   is what a single write already costs), or `#commit` in a plan goes through the same path the dispatcher uses.

## How to reproduce

Any plan with more than about a hundred write steps and `--commit each` against a store whose snapshot exists. The ete seed
(`.tmp/seed-ete/01-tasks.btid`) is a real one: 148 steps.

## Not urgent, and worth knowing

`--commit each` is the honest choice for a seeded history — but `--commit end` produces the same *rows*, which is what a reader
sees. Until this is fixed, long seeds should run with the default.
