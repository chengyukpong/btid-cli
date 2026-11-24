# The store is switched, not flagged

- **Status:** backlog
- **Created:** 2026-11-25T02:10:00+08:00
- **Finished:** —
- **Approved:** —

## Description

Proposed by the user, as a grammar change:

```
init store yuk-org/btid-data3
switch store yuk-org/btid-data4
```

and delete the global `--store` flag.

Today the store is resolved from three sources — `--store`, `BTID_STORE`, `~/.config/btid/config.json` — and **any**
successful command writes the resolved location back to the config file, so `--store` reads as a per-command flag but
behaves as a permanent switch. That is the mismatch: a flag looks like a side trip, and it isn't.

`switch store` would make the persistence the verb's whole job, which is the same shape `advance store` and
`impersonate person/<id>` already have: a session act (`session: true`), no rows staged, nothing committed, and it earns
its place in a plan.

## The shape

| Verb | Path | Argument | Effect |
|---|---|---|---|
| `init` | `store` | `owner/repo[@ref]` | create a store in that repository (config + roster with you as manager) |
| `switch` | `store` | `owner/repo[@ref]` | point this session at it, and remember it |
| `whoami` | — | — | say which store answered, and from where |

- Both take the target as a **positional** argument, like `advance store <instant>`, rather than a flag: it is the verb's
  object, not a modifier of some other verb.
- `init store` replaces `new store`. "new" reads as "create a row named store"; `init` says what it initialises. The old
  spelling should be refused with a message naming the new one — the same hard-cut rule `docs/grammar.md` already carries
  for `store init` → `new store`, which this would reverse.
- `switch store` **opens the store before saving it**: one `head()` request. A typo must not brick every later command by
  writing a location that does not open.

## About deleting `--store`

The case for: with the flag gone, "which store" can only change through a verb that says so, and no command can quietly
read one store and write another. That matches the existing rule that there is no default store at all.

The cost, which needs a decision: without `--store` there is **no way to point a single command at another store** — the
`btid ls task --store other/team` side trip disappears, and so does a CI pipeline parameterised by a flag. Two ways to
keep that door open:

1. **`BTID_STORE` stays, and stops persisting.** The environment is a session's own business; only `switch store` writes
   the config file. Scripts keep working, and nothing is remembered behind the person's back.
2. **A temporary switch**: `switch store x/y --once` (or `--no-save`), refused for `init`.

My preference is (1): it needs no new flag, it makes `switch store` the single writer, and env-as-session is a rule people
already understand.

## What breaks

- `btid new store` and `--store` — both refused with the replacement named, not silently accepted (the migration rule in
  `docs/grammar.md`).
- The config-file write moves out of `rememberLogin` into `switch store`; the login/token-fingerprint caching stays where it
  is.
- `resolveStore` loses its flag branch, and `BTID_STORE` stops being written back. Existing configs keep working: a saved
  store is still the saved store.
- Version: a breaking grammar change, so 0.22.0, and the docs table gains the two rows.

## How to verify

```
btid init store yuk-org/btid-data3          # manager chengyukpong, people 1, projects 0
btid switch store yuk-org/btid-data4        # validates, then remembers
btid whoami                                  # (file), not (flag)
BTID_STORE=yuk-org/btid-data3 btid whoami    # (env), and the config still points at data4 afterwards
btid ls task --store yuk-org/other           # refused: usage, naming `switch store`
```
