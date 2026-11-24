# The CLI can say a newer release exists

- **Status:** backlog
- **Created:** 2026-11-25T01:05:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`btid` is installed from a GitHub release asset (`releases/latest/download/btid-cli.tgz`), so nothing tells a person when
the asset under them is old — no `npm outdated`, no registry to ask. The CLI knows its own `CLI_VERSION`
(`src/version.ts`) and the repository it came from, so it can compare them and say one line.

The rule this must not break: **the CLI's output is what other programs parse**. A notice is stderr, after the command's
own result, and never in `--json`.

## Shape

1. **Ask GitHub, cheaply.** `HEAD https://github.com/<owner>/<repo>/releases/latest` and read the `Location` header
   (`…/releases/tag/v0.22.0`). One request, no token, no API quota. The JSON API (`/releases/latest`) is the fallback if
   the redirect ever stops carrying the tag — but it is rate-limited to 60/hour unauthenticated, so it is second choice.
2. **Check at most every 12 h**, cached in the existing cache root (`snapshot.ts` → `cacheRoot()`), as
   `update.json`: `{ checkedAt, latest }`. The first command of a session pays ~200 ms; the next 500 do not.
3. **Only when someone is watching**: `process.stdout.isTTY`, not `--json`, not CI (`CI` env), and honour
   `BTID_NO_UPDATE_CHECK=1`. Failures are silent — an offline machine must not print a warning about being offline.
4. **Say it once, on stderr**, after the result:

   ```
   btid 0.22.0 is available (0.21.0 here)
     npm i -g https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz
   ```

   Exit code unchanged.
5. **An explicit door** for scripts and the curious: `btid version --check` (same comparison, no cache, exit 0 either way).

## Why a notice and not a self-updater

Running `npm i -g` from inside `btid` would need to know how it was installed (npm, pnpm, a tarball, a copied file) and
would mutate the user's global prefix. The install command is one line; printing it is honest, and it keeps this repository
free of package-manager logic — the same reason no rule lives here.

## Tests

- tag parsing and comparison, including `v0.22.0` vs `0.21.0` and a prerelease (`v0.22.0-rc.1` is not an update);
- the cache: a fresh `checkedAt` skips the request, a stale one asks;
- `--json` never carries the notice, whatever the TTY;
- a failing/slow request prints nothing and does not change the exit code.

`src/update.ts` takes its clock and fetch as arguments, so none of the above needs a network or a real TTY.

## Open choices for the user

- Cache window: 12 h as written, or once a day?
- Notice only, or also a `btid update` verb that prints the command for the way this copy was installed?
- Print in `--verbose` even when the cache is cold, so the check is visible while debugging?
