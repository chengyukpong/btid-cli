# The terminal front end, verb by verb

- **Status:** done
- **Created:** 2026-11-11T01:36:00+08:00
- **Started:** 2026-11-11T14:20:00+08:00
- **Finished:** 2026-11-11T18:56:00+08:00
- **Approved:** 2026-11-11T19:00:00+08:00

## Description

`btid`, a terminal front end over `btid-core`. Its first job is not convenience — it is **proof**: if this CLI can move
a tracked task's end day without a note, the rule is still buried in the SPA's stores; if it cannot, the rule really does
live in the core.

The session it has to be able to produce is written down in [`docs/session.md`](../docs/session.md): whoami, ls, show,
move, edit, step, comment, promote, week — with every refusal printed in the core's words.

## Built (2026-11-11T14:35)

The scaffold, the config, the sign-in, and every verb the core can support today:

| | |
|---|---|
| **scaffold** | `package.json` with a `btid` bin, `tsconfig`, Vitest; `btid-core` and `githubdb` from `file:` beside it |
| **config** | `--store owner/repo[@branch]` → `BTID_STORE` → `~/.config/btid/config.json`; **no default repository**, and the refusal says all three |
| **sign-in** | `gh auth token`, then `BTID_TOKEN`, then a refusal naming both; the login comes from `GET /user` and is passed as `claim`, so the roster decides what it means |
| **verbs** | `task ls` (query + board order + `--fields`), `task show`, `task new`, `task edit` (with `--note`), `project ls`, `project new`, `person ls`, `person new`, `store whoami`, `store init`, `help` |
| **output** | a table by default; `--json` prints the core's own object; `--fields` projects both the same way |
| **exit codes** | `0` ok · `1` a refusal (with the core's code) · `2` usage · faults keep the engine's numbers (`5` no store, `4` conflict, `2` version) |
| **help** | generated from the one registry the parser reads; `help --json` is the manifest (`verbs`, flags, exit codes) |

```
$ node dist/bin.js help task edit
btid task edit <id> [--title t] … [--note text] [--json] [--dry-run]
  flags: --title, --status, --priority, --assignee, --start, --end, --percent, --note, --dry-run

$ node dist/bin.js help --json | jq '.verbs | length'
10
```

17 tests, all against a real `btid-core` and a real `githubdb` database with only the network replaced:

- `task ls` filters with the core's grammar and refuses `status=nonsense` as `QUERY_INVALID` rather than listing everything;
- `task show` says `TASK_NOT_FOUND` instead of throwing;
- `task new` writes exactly one commit, named after the row;
- **`task edit --end` on a tracked task exits 1 with the core's sentence and commits nothing** — the proof this project exists for;
- `--note` turns that into one commit, and the store's file carries the new date;
- `--dry-run` prints `would commit: …` and writes nothing;
- a member creating a project is refused by the core, not by a flag;
- `--fields` projects table and JSON identically, and an unknown name is a usage error listing the real fields;
- `help` and `help --json` need no store; a fault exits 5, not 1.

### Not built, because the core has no verb for it

`task promote`, `task move`, `task step`, `task comment`, `task archive`, `project edit|archive`, `person edit`, and
`task week`/`stats`. Each waits on one `btid-core` command; writing the rule here is the one thing this project must not do.

## Steps

- [ ] Scaffold: `package.json`, `tsconfig`, a `bin` entry, `btid` resolving as a command
- [ ] Configuration: `--store owner/repo@branch` → `BTID_STORE` → config file; no default repository
- [ ] Sign-in: `gh auth token`, then the device flow, then a refusal naming which of the two is missing
- [ ] Read verbs: `whoami`, `ls`, `show`, `week` — one load, no commit
- [ ] Actor resolution before every command: token → `GET /user` → login → roster row → identity; no roster row is a refusal naming the way out
- [ ] Every `new` takes `--file <json>` (or `-` for stdin): the command's input, not the row — no id, no timestamps
- [ ] Write verbs: `move`, `edit`, `promote`, `step add|done`, `comment`, `project new|archive` — one command, one `flush`, one commit
- [ ] `--json` on every verb, asserting on the core's plain result rather than on a rendering
- [ ] `group=projectId|status|assigneeId|priority|label` as a **query term** (the parser already fills `groupBy`), with a flat table until the sectioned rendering lands
- [ ] `[order]` accepts a composite (`endDate,priority`) and `-` for descending; nulls sort last
- [ ] `--fields a,b` on every read: projects the same object for the table and for `--json`; an unknown field is a usage error listing what the rows have
- [ ] `btid help`, `btid help <type>`, `btid help <type> <verb>`, and `--help` on any verb — all generated from the one command registry the parser reads
- [ ] `btid help --json` emits that registry, for shell completion
- [ ] `btid help --json`: one manifest — verbs, arguments, input schemas, query keys, exit codes — generated from the registry
- [ ] `--dry-run` on every write: run the command, print the result, skip the one `flush`
- [ ] `--json` failures are data: `{"error":{"kind":"refused","message":"…"}}` with exit 1
- [ ] Exit codes: `0` ok, `1` a refusal, `2` usage

## How to verify

`btid show T-42` against a throwaway store prints the task and makes no commit; `btid edit T-42 --end 2026-11-14` on a
tracked task exits 1 with the core's sentence; adding `--note` writes exactly one commit whose message names the verb
and the id.

## Blocked on

`btid-core`'s commands — `updateTask`, `promoteTask`, `addStep`, `tickStep`, `addComment`, `createProject`, `saveProject`, `archiveProject`, `joinRoster`, and `actorFor` (the roster lookup with its refusal). No `bootstrapRoster`: the manager arrives with the store, via `btid init`.
The queries already exist. Writing verbs before the commands exist would mean implementing rules here, which is the one
thing this project must not do.
