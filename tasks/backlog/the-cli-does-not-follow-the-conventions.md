# The CLI does not follow the conventions everyone else follows

- **Status:** backlog
- **Created:** 2026-11-12T18:15:00+08:00
- **Finished:** —
- **Approved:** —

## Description

Three gaps against the standards in `docs/grammar.md`'s neighbourhood — POSIX Utility Syntax Guidelines, GNU option
conventions and the CLI Guidelines — plus two small inaccuracies. None of them is a missing capability; each is a place where a
person who knows CLI conventions would be surprised.

| gap | standard | what it costs today |
|---|---|---|
| `--` is not treated as end-of-options | POSIX Guideline 10 | an id, label or title starting with `-` has no spelling at all: `btid edit task/<id> --title "--urgent"` is a usage error |
| diagnostics go to **stdout** | GNU, clig | `btid ls task --json \| jq` is safe only because a refusal produces no data; a refusal should not be in the data stream |
| booleans take a value (`--tracked on`) | GNU `--no-<flag>` | every boolean needs two words, and `--tracked` alone reads as "true" in every other CLI |
| `btid help help` says *"no verb called help"* | consistency | `help` is in `ALL_VERBS` but not in `VERBS`, which `help`'s own lookup reads |
| README says 21 verbs | accuracy | there are 24 (`plan`, `label`, `step` landed) |

## Steps

- [ ] Teach `parseFlags` to stop at `--`: everything after it is a positional, including words that start with `--`.
- [ ] Give the output channel two streams — data on stdout, diagnostics (`usage:`, `refused:`, `fault:`) on stderr — and make the
      tests assert the split rather than a single buffer.
- [ ] Accept `--no-<flag>` for every declared boolean, keeping `on|off` as the synonym it already is.
- [ ] `help help`: look the word up in `ALL_VERBS`, and print the grammar line for it.
- [ ] README's status paragraph: 24 verbs, and the numbers re-checked rather than remembered.

## How to verify

`btid edit task/alpha-a1b2 --title -- --draft` writes the title `--draft`; `btid task` writes its refusal to stderr and exits 2
with an empty stdout; `btid edit task/<id> --no-tracked` clears the flag; `btid help help` prints something sensible.
