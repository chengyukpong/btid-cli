# A plan file's grammar is not in `btid help`

- **Status:** done
- **Created:** 2026-11-24T17:02:00+08:00
- **Finished:** 2026-11-24T17:24:00+08:00
- **Approved:** 2026-11-24T17:23:46+08:00

## Description

Asked after seeding a project through `plan`: *"do u think an ai agent know how to write a plan by viewing help only?"* — and the
honest answer from the run that did it is **no, not from help alone**. What the help gives and what a plan file needs are two
different things, and the gap is exactly where an agent falls over.

### What help actually says

`btid help plan`:

```
plan — Run a file of commands in order against one store, committing once at the end.
  WRITES — stages a change and commits once; --dry-run shows it without the commit

  btid plan <file|-> [--commit=end|each] [--continue] [--quiet] [--preview] [--json]
  ...
  EXAMPLE  btid plan seed.btid
```

That is every flag and **nothing about the file**: no `let`, no `$name.id`, no `#`, no statement that a step is
`<verb> <path> [--flags]`. `btid help plan --json` is the same — a full manifest of verbs, paths, flags, exit codes and row
types, with `plan`'s `file` argument described only as `<file|->`.

The syntax exists, in `docs/operating.md`, and that copy is **stale**:

| `docs/operating.md` shows | the parser accepts |
|---|---|
| `let ivan = person new ivan --name Ivan` | `let ivan = new person --handle ivan --name Ivan` |
| `task edit $task.id --assignee …` | `edit task/$task.id --assignee …` |

An agent that trusts the docs writes a file the parser refuses: `usage: the grammar is btid edit task/<id>`. The run above only
succeeded because the test suite (`tests/btid.spec.ts`) happens to contain working plan files — which is not a discovery path
anybody outside this repository has.

### Two things that mislead

1. **`plan` refuses `--dry-run`**, which the shared "WRITES" banner above the verb advertises. The run tried it first and got
   `usage: plan does not take --dry-run. It takes --commit, --continue, --quiet, --preview.`
2. **`--preview` does not validate.** `let t = new task --title "No project"` previews as `1 steps, nothing run` — no complaint —
   and only fails at apply, as `usage: btid new task --project <id> --title <text>`, exit 2, nothing written. A preview that
   passes therefore means "the file parses", not "the plan can run", and nothing says so.

Good news for the same question: the *failure* messages do teach. `task edit x` → `usage: the grammar is btid edit task/<id>`;
`this is not a command` → `usage: no verb called "this". Run btid help.` Recovery from a wrong file is possible; writing the right
one is what is missing.

## Steps

- [x] `btid help plan` prints a **FILE** block: one step per line, `let <name> = <verb> …`, `$<name>.<field>`, `#` comments —
      then **A WHOLE FILE**, four lines that run. The words live in `help-text.ts` (`PLAN_FILE`), so the page and the manifest
      cannot drift: `help --json` carries the same block as `verbs[plan].file`.
- [x] `--preview` now validates. `Verb` grew `needs?: readonly string[]` — the flags a shape cannot do without — set on the
      eight rules that refuse without one (`new task` → `--project --title`, `new project` → `--key --name`, `new person` →
      `--handle`, `new task/<id>/step` and `rename` → `--name`, `move` → `--to`, `remove project|person` → `--yes`). `check()`
      refuses a step that is missing one, before the first request:
      `usage: step 1: new task needs --project — btid new task --project <id> --title <text> …`
- [x] The WRITES banner is per-verb now (`kindWords`): `plan` reads *"one commit at the end; --preview reads the file and runs
      nothing"* instead of promising a `--dry-run` it refuses.
- [x] `docs/operating.md`'s example was the **old word order** (`person new ivan`, `task edit $task.id`) and taught a file the
      parser refuses. Rewritten to the accepted form, and previewed to prove it parses.
- [x] Two tests: the plan page teaches the file (and no longer promises `--dry-run`), and a step missing a required flag is
      refused by `--preview` with exit 2 and nothing written.

## How to verify

- `btid help plan` — FILE + A WHOLE FILE, and `--preview reads the file and runs nothing`.
- `btid help --json | jq '.verbs[] | select(.verb=="plan").file'` — the same grammar, machine-readable.
- `printf 'let t = new task --title "No project"\n' > x.btid && btid plan x.btid --preview` — exit 2,
  `step 1: new task needs --project`, nothing run.
- `npm test` — 121 passing.

## What this leaves

`needs` covers the eight shapes whose handlers refuse a missing flag; a shape that gains one later must add it here too, and
nothing enforces that yet. The cheap guard is a test that walks every rule whose handler calls `usage(` after a flag check and
asserts it declares `needs` — worth doing when the list grows, or when one of them is added and a plan quietly stops being
caught.