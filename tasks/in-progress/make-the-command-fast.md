# Make the command fast — at the CLI layer

- **Status:** in-progress
- **Created:** 2026-11-11T17:10:00+08:00
- **Finished:** —
- **Approved:** —

## The measurement

Reported by the operator agent against a real store, and confirmed here:

| operation | time |
|---|---|
| `btid version` (no store, no auth) | 0.14 s |
| `btid help` | 0.19 s |
| `store whoami` (a read) | 3.0 s |
| `task edit --dry-run` | 2.9 s |
| `task edit` (a real write, 1 commit) | 6.5 s |
| a 10-task seed | ~60 s |

The number that explains it is **~0.6 s per GitHub request** (measured: `GET /user` 0.58 s, `gh auth token` 0.07 s). Every
command pays round trips:

```
read  3.0 s  = 0.15 process + 0.07 gh + 0.6 /user + 0.6 tree + (files × 0.6) blobs
write 6.5 s  = read side + 0.6 blob + 0.6 tree + 0.6 commit + 0.6 ref
```

The fixed cost is ~2.5 s before the command does anything, repeated per command.

## The decision: do it here, not in the engine

`githubdb` has a seam for exactly this: **`StoreClient`** — `tree`, `blob`, `commit`, `head`, `tag`, `untag`. The engine
cannot tell a caching client from the real one, so the whole of the optimisation can live in this package and the engine
keeps owning the store's meaning.

Three phases, all in the CLI, in this order:

### P1 — cache what cannot go stale (the blob cache)

A blob's **content is its sha**, so a blob cache cannot go stale — only grow. `CachingClient` writes blob text under the OS
cache directory keyed by sha and reads it back before asking GitHub.

- Cold read: unchanged (tree + blobs), and the cache fills.
- **Warm read: tree + cache hits → one request, ~0.7 s** (from 3.0 s).
- Writes benefit too: a commit re-reads the tree and any blob it just wrote is already local.
- Keyed by sha, so two repositories cannot collide; bounded by an LRU cap; `BTID_NO_CACHE=1` disables it,
  `BTID_CACHE_DIR` moves it.

### P2 — one process, many commands (the batch mode)

`btid batch` reads **NDJSON commands from stdin**, opens the store once, and runs them in order. One process, one token, one
login, one load — which removes the *fixed* 2.5 s per command rather than a request.

```console
$ printf '%s\n' \
  '{"verb":"task new","projectId":"alpha","title":"One"}' \
  '{"verb":"task new","projectId":"alpha","title":"Two"}' \
  | btid batch --commit-at-end
captured  alpha-n0qz
captured  alpha-c3d4
2 tasks in one commit
```

`--commit-each` (the default) keeps one-verb-one-commit; `--commit-at-end` makes a seed one commit, which the core already
supports. A refused line is reported and the batch continues (`--stop-on-refusal` to change that), because an agent sending
twenty lines wants nineteen successes and a list, not a rollback.

**Expected:** a 10-task seed from ~60 s to ~3 s; a read loop from ~60 s to ~5 s.

### P3 — a TTL on reads only (the tree cache)

The tree listing is what costs the last request per read. A short TTL (5 s) on the listing, used **only by verbs that do not
write**, makes a burst of reads nearly free: `ls` then `show` then `ls` costs one request, not three.

- **Writes never use the stale tree.** A write needs the real head for the compare-and-swap that turns a concurrent writer
  into `CONFLICT` rather than a silent overwrite. The CLI knows which verbs write (`writes: true`), so it passes
  `allowStale: false` for those and the caching client obeys.
- `--fresh` bypasses both caches for one call; `BTID_TIMING=1` prints the phases and whether each came from cache.

**Expected:** within the TTL, a read is process start only (~0.15 s).

## Built: the snapshot (P1, 2026-11-11T17:00)

The SPA's approach, moved to the terminal, because it is the same problem: a process that wants the store should not pay
GitHub to hand it over again.

- **`btid-core` 0.6.0** — `Store.snapshot()` gives the rows, the engine's `seen` listing, and the schema version;
  `openStore({ snapshot })` hydrates from them instead of loading, refusing a snapshot from another format or schema. The
  caller owns the commit claim, because the caller is the one that asked the branch head.
- **`btid-cli` 0.3.0** — the snapshot lives in the user's cache directory, one file per `owner__repo__branch`. A command
  reads the head (**one** request), compares it with the snapshot, and either hydrates or loads. A write drops the file,
  because after a commit those rows describe the store *before* it. `--fresh` bypasses it; `BTID_NO_CACHE=1` disables it.

```
first read   tree + one per file            ~3.0 s
second read  head only, then hydrate        ~0.9 s
write        as before, then drop           ~6 s
```

Two things the implementation taught, worth keeping:

- **The engine keys its collections by their plural** (`persons`, `projects`, `tasks` — `pluralOf` is `${cls}s`). Handing
  `hydrate()` the class names does not throw; it produces a store where every collection is empty. A test now asserts a
  resumed store has its projects, not just its people.
- **The snapshot is worth exactly what its commit claim is worth.** It is checked against the head on every command and
  dropped on every write; a snapshot is never the authority on whether it is current.

Still open in this task: **P2, the batch mode** (`btid batch` reading NDJSON, one process for many commands), which removes
the fixed 2.5 s per command rather than one request; and **P3**, the read-only TTL on the tree listing, which makes a burst of
reads cost one request instead of one each.

## What is not in scope, and why

- **Engine changes (inline tree content, engine-side caches).** A write in three requests instead of N+3 is a real win, but it
  changes the engine's write path — a different risk class, and not this package's decision to make.
- **A daemon.** It would beat all three phases, and it buys a socket, a lifecycle, a lock file and a security question to save
  150 ms per command. The batch mode gets most of it with none of it.
- **A faster parser or a smaller bundle.** Measured 0.15 s. That is the wrong 2 %.

## How to verify

`BTID_TIMING=1` prints `auth`, `load`, `command`, `commit` and which cache answered. The task is done when the table at the
top can be rewritten with the same store and the same method.
