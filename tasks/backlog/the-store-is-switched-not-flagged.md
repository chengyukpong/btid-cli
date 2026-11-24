# The store is switched, and a plan may name its own

- **Status:** backlog
- **Created:** 2026-11-25T02:10:00+08:00
- **Finished:** —
- **Approved:** —

## Description

The store used to be resolvable three ways — `--store`, `BTID_STORE`, the saved config file — and **any** successful command
wrote the resolved location back to the config. So `--store` looked like a per-command flag and behaved as a permanent
switch: a flag that persists is a lie about what it does.

Three changes, settled with the user over two rounds:

```
btid init store yuk-org/btid-data3          # create the store in that repository, and remember it
btid switch store yuk-org/btid-data4        # point this machine at it, and remember it
btid plan seed.btid --store yuk-org/test    # run this plan against that store, remembering nothing
```

`--store` and `BTID_STORE` are gone everywhere else. `new store` is renamed `init store`.

## Why `plan --store` instead of a mid-plan `switch`

The first draft had `switch store x --session` as a plan step, which makes a store boundary in the middle of a run: deferred
writes (`--commit=end`) would have to be flushed at the boundary, and `let` bindings would have to be tagged with the store
that minted them so a cross-store reference could be refused. Real machinery for a case that does not need it.

A plan runs against **one** store, so let the invocation name it:

- one store per run, chosen at the edge — no boundary, no flush rule, no cross-store bindings;
- **the plan file stays portable**: a file of commands must not name a repository, or the same text means different work in
  different hands;
- `--store` survives as a **single-purpose flag on `plan`**, which is the narrowest possible home for it;
- nothing is remembered: the config file has one writer (`switch store`) and one creator (`init store`).

## Rules

- **`init store owner/repo[@ref]`** — creates the repository's store: `githubdb.json` at this build's version, then
  `people.json` with the caller as manager. Refuses a repository that already holds a store. Remembers it.
- **`switch store owner/repo[@ref]`** — **opens** it before saving (one `head()`), so a typo cannot brick every later
  command by writing a location that does not open. Nothing else writes the config's store.
- **`plan <file> --store owner/repo[@ref]`** — resolves to that store for the whole run and saves nothing. The store is
  validated before step 1, on the runner's existing rule that a flag the shape cannot do without is refused before
  anything starts: a typo must fail at step zero, not at step fourteen.
- **`--session` is not needed** and should never ship: it existed only to express the mid-plan switch this replaces.

## What breaks

- `--store` on every other verb, `BTID_STORE`, and `new store` — refused with the replacement named, not silently accepted
  (the hard-cut rule `docs/grammar.md` already carries).
- The config write moves out of `rememberLogin` into `switch store` / `init store`; the login + token-fingerprint caching
  stays where it is.
- `resolveStore` loses its flag and env branches; a saved store is still a saved store, so existing configs keep working.
- Version: **0.22.0**, a breaking grammar change. Two rows for the migration table in `docs/grammar.md`.

## How to verify

```
btid init store yuk-org/btid-data3           # manager you, people 1, projects 0; remembered
btid switch store yuk-org/btid-data4         # validated by opening, then saved
btid whoami                                  # (file) — and yuk-org/btid-data4
btid plan seed.btid --store yuk-org/btid-test  # runs there, config untouched afterwards
btid plan seed.btid --store yuk-org/typo     # refused before step 1
btid ls task --store yuk-org/btid-test       # usage: --store belongs to plan; use switch store
BTID_STORE=yuk-org/x btid whoami             # ignored — no env source any more
```
