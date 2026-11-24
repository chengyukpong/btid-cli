# `btid version` says a newer release exists

- **Status:** done
- **Created:** 2026-11-25T01:05:00+08:00
- **Finished:** 2026-11-25T03:50:00+08:00
- **Approved:** 2026-11-25T03:50:00+08:00

## Description

`btid` is installed from a GitHub release asset (`releases/latest/download/btid-cli.tgz`), so nothing else tells a person
their copy is old — no registry, no `npm outdated`. `btid version` now asks GitHub **once a day** and prints the install
command when there is something newer.

There is no `btid update` verb. A self-updater would have to know whether this copy came from npm, pnpm or a tarball, and
would mutate the user's global prefix; printing one command is honest, and keeps package-manager logic out of this repo.

## What it does

```
$ btid version
btid 0.21.0 · btid-core schema v3 · manifest 3
latest  0.22.0 is available (this copy is 0.21.0)
        npm i -g https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz
log  …
```

- **Asked of the redirect, not the API**: `HEAD /releases/latest` answers `302` with `/releases/tag/v0.22.0` in `Location`.
  One request, no token, no rate limit — the JSON API allows 60 an hour unauthenticated.
- **Kept for a day** in the cache root the snapshots already use (`context.cacheDir/update.json`). A cached answer is used
  as-is; after 24 h GitHub is asked again. `--fresh` asks now.
- **Failures are cached too**: a machine that is offline pays the 800 ms timeout once, not on every command.
- **Silent when there is nothing to say**: same version, no releases, no network → the output is exactly what it was
  before this change.
- **`--json` never asks.** Machine output stays offline, instant and unchanged — the notice is not a field.
- **`BTID_NO_UPDATE_CHECK=1`** turns the check off entirely, cache and request both.
- The command's exit code is unchanged: a version question cannot fail because GitHub is down.

## Where it lives

- `src/update.ts` — `parseReleaseTag`, `compareVersions`, the cache reader/writer, `checkForUpdate` (clock, fetch and cache
  path are arguments, so tests need no network and no day) and `updateNotice` (the two lines, testable without a terminal).
- `src/verbs.ts` — the `version` verb calls it after printing the version line.
- `src/help-text.ts`, `README.md` — the behaviour is stated where a person looks for it.

## How to verify

```
npm run typecheck && npm test        # 10 new tests in tests/update.spec.ts
npm run build && node dist/bin.bundle.js version          # 266 ms cold, 80 ms warm, no notice at 0.21.0
node dist/bin.bundle.js version --fresh                   # asks again
BTID_NO_UPDATE_CHECK=1 node dist/bin.bundle.js version    # no request
```

With a cache file naming a newer version (`{"checkedAt":<now>,"latest":"0.99.0"}`) the two notice lines appear — that is how
the printing path was checked without cutting a release.

## Notes

- A cache file written with a UTF-8 BOM is a **miss**, not a crash: `JSON.parse` refuses it, the check falls through to the
  network and rewrites the file. Costing one request is the right answer for a corrupt cache.
- The 800 ms cap is deliberate: `btid version` is often the first command a person types, and waiting on a dead network for
  a courtesy notice is worse than not having the notice.
