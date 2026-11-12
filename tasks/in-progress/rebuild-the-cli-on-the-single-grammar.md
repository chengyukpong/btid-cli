# Rebuild the CLI on the single grammar

- **Status:** in-progress
- **Created:** 2026-11-12T18:02:00+08:00
- **Started:** 2026-11-12T18:02:00+08:00
- **Finished:** —
- **Approved:** —

## Description

The CLI speaks `<class> <verb> <id> [--flags]` today, which made `step` and `label` nouns in the verb slot, grew a two-word verb
for every resource, and left three spellings of "delete" (`task remove`, `task step remove`, `task label remove`). The grammar
settled on 2026-11-12 is **`btid <verb> <path> [data]`** — fourteen verbs, a path tree, data always named. It is specified in
[docs/grammar.md](../../docs/grammar.md), and the lifecycle runbook
[docs/lifecycle-of-a-task.md](../../docs/lifecycle-of-a-task.md) is already written in it.

This task is the rebuild: resolver, the verb × path table, the tests migrated behind it, the manifest at version 2, and 0.12.0.
**Hard cut** — the old spelling is refused with a message naming the new form. There is no compatibility shim and no branch:
`main` is where it lands.

## Steps

- [ ] `src/grammar.ts`: the verb × path table. Each rule is `{ verb, path, command, args(ids, rest), summary }`, where `command`
      is the verb object that implements it today (`task edit`) and `args` places the path's ids where that object reads them.
- [ ] `resolve(words, findVerb)`: verb, then path, then data. Ids come from the **shape's placeholders** (`<id>`, `<step>`), never
      from guessing which segment looks like a noun. Refusals name the alternative: `"task" is a path, not a verb`,
      `task/<id> does not take "ls". It takes show, edit, promote, remove.`
- [ ] `cli.ts`: dispatch through the resolver; `--help` renders `btid <verb> <path>` plus that command's flags.
- [ ] Usage strings in `verbs.ts` rewritten to the path form; `project new` takes `--key/--name`, `person new` takes `--handle`.
- [ ] `help` and the manifest at version 2: verbs with the paths each applies to, plus `grammar` and `paths`. `help <verb>` lists
      that verb's paths. **`commandFor(verb)` must tolerate `help`/`plan`/`version`**, whose commands are not in `VERBS` — that
      lookup was the crash in the abandoned attempt.
- [ ] `plan.ts`: a step is `verb + path + data`. Line form `edit task/$task.id --estimate 4`; JSON form
      `{ verb, path, args, flags }`. References **inside** a path are interpolated (`$task.id` → the id) before routing; a bare
      `$task` is still refused as "a result, not a value".
- [ ] Tests migrated to the new spelling: 64 assertions, same store behaviour, no old-form calls left.
- [ ] `docs/operating.md` rewritten to the grammar; the "two grammars" note removed from the runbook.
- [ ] 0.12.0, artifact packed.

## How to verify

`btid ls task status=todo`, `btid show task/<id>`, `btid edit task/<id> --estimate 4`, `btid promote task/<id>`,
`btid add task/<id>/label ui`, `btid new task/<id>/step --name "…"`, `btid done task/<id>/step/<step-id>`,
`btid remove task/<id> --yes`, `btid plan seed.btid`, and `btid help --json` describing paths — all against the store fixture,
with the suite green and `btid help` listing verbs × paths rather than a flat list of two-word names.

## What the first attempt learned

Written down because it was abandoned deliberately, not for lack of a plan:

1. **Ids come from the shape's placeholders.** Deriving them from "which segments are not nouns" excluded every id, because an
   id always follows a noun.
2. **References inside a path need interpolation**, not whole-string matching: `task/$task.id` is text with a reference in it.
3. **The manifest crashes on `help`/`plan`/`version`** unless the command lookup falls back, because their commands are outside
   `VERBS`.
4. **Migration order:** tests first, then the table. The table's rules were discovered by watching tests fail, which cost a round
   trip; four target-grammar tests written up front would have pinned them.
