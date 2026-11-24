# A plan file's grammar is not in `btid help`

- **Status:** backlog
- **Created:** 2026-11-24T17:02:00+08:00
- **Finished:** —
- **Approved:** —

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

- [ ] `btid help plan` (and the same node in `help --json`) prints the **file grammar**: `#` comments, `let <name> = <verb>
      <path> [--flags]`, `$name.id` interpolation, bare steps after the first, quoting, blank lines — with one complete four-line
      example instead of the single shell line it has now.
- [ ] Say what `--preview` guarantees, and make it guarantee more: validate required flags and unknown flags per step, so a
      preview that passes means the file *could* run. If it stays syntactic, the help must say "preview reads the file, it does
      not check refusals".
- [ ] The "WRITES" banner is wrong on `plan`: it has no `--dry-run`. Either give it one or suppress the line for this verb.
- [ ] Fix `docs/operating.md`'s example to the accepted word order — or accept both orders in the parser, which is friendlier for
      anyone who learned the docs first.

## How to verify

- `btid help plan` alone contains enough to write a file that runs: a reader with no access to `tests/` or `docs/` should manage
  `let p = new project …` / `let t = new task --project $p.id …` / `edit task/$t.id …` / `promote task/$t.id`.
- `btid plan <missing-a-flag> --preview` exits non-zero, or the help says plainly that it will not.
