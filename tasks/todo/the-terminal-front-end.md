# The terminal front end, verb by verb

- **Status:** todo
- **Created:** 2026-11-11T01:36:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`btid`, a terminal front end over `btid-core`. Its first job is not convenience — it is **proof**: if this CLI can move
a tracked task's end day without a note, the rule is still buried in the SPA's stores; if it cannot, the rule really does
live in the core.

The session it has to be able to produce is written down in [`docs/session.md`](../docs/session.md): whoami, ls, show,
move, edit, step, comment, promote, week — with every refusal printed in the core's words.

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
