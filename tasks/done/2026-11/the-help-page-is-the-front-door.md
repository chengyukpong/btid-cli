# The help page is the front door

- **Status:** done
- **Created:** 2026-11-18T15:24:00+08:00
- **Finished:** 2026-11-18T15:52:00+08:00
- **Approved:** 2026-11-18T18:50:09+08:00

## Description

The two findings the grammar pass left open, plus the thing they were symptoms of: a person could not learn this CLI from
`btid help`. The page printed the verbs × paths table and a summary line per verb, and stopped. What a flag meant, what an
exit code meant, where an id comes from, what `data` is — all of it required reading `src/`.

Three surfaces, one problem: `help`, the manifest behind `help --json`, and the `writes` flag that made session acts lie.

## What landed

**1. `session` is a third kind on `Verb`.** `advance store`, `impersonate` and `unimpersonate` change the session — the clock,
or who the writes are attributed to — and stage nothing. They used to declare `writes: true` with a comment apologising for it,
because the plan runner accepted only writes and reads. Now:

- `plan.ts` accepts `writes || session || read` as a step, and prints a session act's line straight through instead of buffering
  it for a commit that will never come.
- the manifest reports `"kind": "session"` and `"session": true, "writes": false`.

**2. Manifest v3: flags per path.** v2 listed a verb's flags unioned across its shapes, which cannot answer *"may I pass
`--percent` to `edit project/<id>`?"* — it may not. Each `verbs[].paths[]` now carries its own `usage`, `flags` (with a
description each) and the verb's `kind`, `example` and `summary`. The manifest also publishes `globals` and `exitCodes`, so an
agent gets the same facts the page gives a person.

**3. `help` is a page, not a legend.** `src/help-text.ts` holds the words — a sentence per verb, a line per flag, the exit codes,
the concepts — and `tests/help.spec.ts` fails when a verb or flag lands without one. `btid help` now carries: what a store is,
where ids come from, what `data` and `--flag` mean, the `key=value` query form, the verbs grouped by what they do, the two
tables, every global flag with a description, **all six exit codes** (it previously claimed three), and where to go next.
`btid help <verb>` gives each shape its own usage line and sentence, every flag described, and an example.

## Found while building

1. **A verb was described by whichever handler registered first.** `summaryOf` read `rulesFor(verb)[0].handler.summary`, so
   `add` read *"Say something on a task"* and `remove` read *"Take an acceptance back"* — one shape speaking for five. The fix
   is a verb-level line (`VERB_HELP`) plus per-shape lines on the verb page.
2. **The exit codes on the page were wrong.** It said `0 ok, 1 refused, 2 usage`; the store's own `exitCodeOf` also uses 3
   (invalid row, failed migration), 4 (conflict), 5 (no store). A person scripting against `btid` needs those by number.
3. **`-v` was rendered `--v`.** The global flag list is names, not spellings, and `v` is an alias. `FlagHelp` grew an optional
   `spell` for the one case where the flag is not `--<name>`.
4. **`show` and `clear` were both classified "binary".** `noStore` is a property of a *rule*, not a verb, and asking "does any
   rule set noStore" made `show` binary because `show cache` needs no store. The test that now pins it asserts `show` is a
   read and `clear` (cache-only) is the binary one — the kind is decided by **all** of a verb's shapes.

## How to verify

`npx vitest run` → **118 of 118** (110 before; 8 new help-completeness tests). `npx tsc --noEmit` clean.

```
btid help            # the whole page: words, verbs, tables, globals, exit codes, next
btid help add        # five shapes, each with its own sentence; one flag, described
btid help advance    # CHANGES THE SESSION — nothing staged, nothing committed
btid help --json     # manifest 3: kind, and flags per path
```
