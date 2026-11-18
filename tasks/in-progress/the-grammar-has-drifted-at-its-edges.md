# The grammar has drifted at its edges

- **Status:** in-progress
- **Created:** 2026-11-18T14:12:09+08:00
- **Finished:** 2026-11-18T14:56:00+08:00
- **Approved:** —

## Description

A full review of the command grammar, prompted by the shape getting harder to hold while adding session verbs. The centre is
sound — verb-first, a closed verb set, paths as data, refusals as values with codes, and a manifest in both directions. What
has drifted is at the edges: the two session acts, three facts that have two doors, and documentation that stopped being true.

Numbers, read off the built table rather than the prose: **23 verbs, 13 paths, 44 rules.** `docs/grammar.md` says
*twenty-one verbs* and its table has **19 rows** — missing `undo`, `exempt`, `unexempt`. (The count has been wrong by two
since before the session verbs: it said *nineteen* when 21 existed.)

## Findings

| # | finding | kind |
|---|---|---|
| 1 | `grammar.md` claims 21 verbs; there are 23, and its table is missing three | docs |
| 2 | `grammar.md:7` says the CLI "still speaks the older form until 0.12.0 lands" — it is 0.20.0 | docs |
| 3 | `advance`, `archive`, `promote` have no example anywhere; 17 of 44 rules have none | docs |
| 4 | `new store` and the three session verbs are the only writes without `--dry-run` | consistency |
| 5 | Session acts lie about `writes`: `advance store` and `impersonate` stage nothing but must claim to write | design |
| 6 | `stop` is a **mode** in a tree of data — the only verb whose two paths are different kinds | design |
| 7 | Two doors for one fact: `edit --members` **replaces**, `add/remove …/member` **increments**; same for labels | design |
| 8 | `--dry-run` means two things: on a verb "do it, don't commit"; on `plan` "print the steps, run nothing" | design |
| 9 | `ls` alone speaks `key=value` filters; every other field is a flag | syntax |
| 10 | `done` the verb vs `done` the status: a step finishes with `done`, a task by `promote` reaching `done` | naming |
| 11 | `clear cache` and `archive project/<id>` are one-path verbs where `remove` already exists | naming |
| 12 | The tree never says what kind of word a path is: collection / row shape / singleton / mode | docs |
| 13 | `help --json` unions a verb's flags across its paths, so an agent cannot tell `--percent` is task-only | manifest |
| 14 | Exit `2` covers both usage errors **and** faults, so a caller cannot branch without reading prose | contract |
| 15 | Naming a thing is a flag in one place (`new …/step --name`) and positional in another (`add …/label ui`) | syntax |
| 16 | **Proposed by the user:** retire `exempt`/`unexempt` for `add task/<id>/exempt <code>` and `remove task/<id>/exempt <code>` | naming |

## Decisions (settled 2026-11-18, by the user)

1. **The exempt rename (16), with the noun:** `add task/<id>/exemption <code>` and `remove task/<id>/exemption <code>`.
   `exempt` and `unexempt` retire.
2. **No mode in the tree (6):** pathless **`unimpersonate`** replaces `impersonate stop`. `impersonate person/<id>` stays.
3. **One door per membership (7):** sub-paths increment, flags only at birth (`new project --members`); `--members` and
   `--labels` leave `edit`.
4. **`--dry-run` (8):** `plan` takes **`--preview`**; `--dry-run` keeps one meaning everywhere.
5. **`done`/`undo` become `tick`/`untick` (10, 17):** steps keep verbs of their own, and `edit` does not reach into a
   step. `edit …/step --done` is abandoned — and with it the boolean-spelling question, which no longer has a customer.
6. **`comment` retires (18):** `add task/<id>/comment "…"`.

## The rule behind `new` and `add` (settled 2026-11-18)

> **`new` mints an id, so it returns the row. `add` addresses something the caller already names, so there is nothing to
> return.**

That is why `addNew` is not needed: the distinction is not "create versus attach", it is **who supplies the identity**. A
label, a member, an exemption code and a comment body are all named by the person typing; a task, a project, a person and a
step get ids from the store. `new` therefore returns a bindable object (`let t = new task …` in a plan), and `add` returns
success and nothing else.

Two consequences to check in code when this is built:

- **`add`-family verbs should not set `context.result`.** Today `taskComment` and `projectMemberAdd` do; `labelAdd` already
  does not. The rule makes them agree.
- **`new`-family verbs must set it.** `stepNew` does since the binding fix — that change was this rule arriving early.

## The shape after these decisions

| | before | after |
|---|---:|---:|
| verbs | 23 | **21** |
| paths | 13 | **14** |
| rules | 44 | **44** |

Verbs left: `add` `advance` `archive` `clear` `demote` `edit` `help` `impersonate` `ls` `move` `new` `plan` `promote`
`remove` `rename` `show` `tick` `unimpersonate` `untick` `version` `whoami`.

The direction is legible: **`edit` changes the fields of a thing, `add`/`remove` put a named thing on a row and take it off,
`new` creates and returns, `promote`/`demote` walk the ladder, and the pathless verbs are about the session and the binary.**
`tick`/`untick` are the step's own two gestures — the only verbs that survive as a pair besides the ladder itself.

## One confirmation before the code

**`tick`/`untick` are two verbs on `task/<id>/step/<step-id>`** — renamed `done`/`undo`, keeping their own names instead of
moving a `--done` flag onto `edit`. If that reading is right, steps keep the four verbs they have (`tick`, `untick`,
`rename`, `move`) and `edit` stays what it is today: the fields of a task, project or person. If instead the intent is a
flag on `edit`, this item reopens and the boolean question comes back with it.

## Not this task

Already filed elsewhere, and not to be duplicated here:

- `--` as end-of-options, diagnostics on stderr, boolean flags taking a value, and the stale count in `README.md` —
  `the-cli-does-not-follow-the-conventions.md`.
- `archive task/<id>`, `ls task/<id>/comment`, `move …/step --before|--after` — `the-verbs-the-lifecycle-still-needs.md`.

## Steps

- [ ] Settle the five decisions above, in one conversation.
- [x] Docs truth pass (1, 2, 3, 12) — the table is now generated from the dispatcher's own rules, so it cannot drift again.
- [x] The exempt rename (16), with the noun decided: `add/remove task/<id>/exemption <code>`.
- [x] One door per membership (7) — and the door that was missing: project labels had **no** path, only `edit --labels`, so a
      decision to remove that flag first needed `add/remove project/<id>/label` to exist.
- [x] `--preview` on `plan` (4); `--dry-run` now means one thing everywhere.
- [x] `done`/`undo` → `tick`/`untick` (10), and `comment` → `add task/<id>/comment` (18).
- [x] `unimpersonate` (6) — pathless, and `stop` is out of the tree.
- [x] **`session` as a third kind on `Rule`** (5) — done in `the-help-page-is-the-front-door`, together with the manifest work.
- [x] **Manifest v3: flags per path** (13) — done there too.

## What landed (2026-11-18)

| | before | now |
|---|---:|---:|
| verbs | 23 | **21** |
| paths | 13 | **15** |
| rules | 44 | **46** |

Retired: `exempt`, `unexempt`, `comment`, `done`, `undo`, and the `stop` path. Added: `tick`, `untick`, `unimpersonate`,
`add/remove task/<id>/exemption`, `add task/<id>/comment`, `add/remove project/<id>/label`.

Also in this pass:

- **`add` binds nothing.** `taskComment` and `projectMemberAdd` set `context.result`; `labelAdd` did not. All three agree now,
  by the rule that `new` mints an id and `add` names one — so a plan can no longer bind what `add` attached.
- **A duplicate rule.** Regenerating the table from `RULES` found `impersonate person/<id>` registered **twice** (the old
  `stop` line replaced by a copy of its neighbour). The table surfaced it; nothing else would have.
- **The version drift is fixed.** `src/version.ts` said 0.19.2 while `package.json` said 0.20.0, so one test had been failing
  for several releases. Both are 0.21.0 now — the right number for a breaking change.
- **The doc's table** is 46 rows, verb · path · what it does · flags, generated from the same rules the dispatcher reads.

## How to verify

`npx vitest run` → **110 of 110**. `npx tsc --noEmit` clean. `btid help` lists 21 verbs; `btid help --json` reports
`paths.length === 15`.

