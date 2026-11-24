# The release has a latest URL

- **Status:** in-progress
- **Created:** 2026-11-25T00:55:00+08:00
- **Finished:** 2026-11-25T01:15:00+08:00
- **Approved:** —

## Description

`v0.21.0` was cut by hand and carried one asset, `btid-cli-0.21.0.tgz`. That URL works forever, but its **name contains the
version**, so the "latest" form —

```
https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli-0.21.0.tgz
```

— would break at 0.22.0. GitHub resolves `/releases/latest` per *release*, not per *filename*; there is no dist-tag
equivalent, and `latest` simply means the newest non-draft, non-pre-release.

## What changed

1. **Every release now carries the tarball twice**: `btid-cli-<version>.tgz` (the record) and `btid-cli.tgz` (the moving
   copy). The stable URL is therefore version-free and permanent:
   `https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz`
2. **`scripts/release.mjs`** (`npm run release`) — packs, copies, creates the release or refreshes its assets with
   `--clobber`, and prints both URLs. It reads the version from `package.json`.
3. **`v0.21.0` was refreshed** rather than renumbered, so the first release already has the stable asset.
4. **`README.md`** gained an Install section with both commands; **`docs/releasing.md`** is the rule: the two names, why
   the stable one exists, what the script does, what it needs, and how to verify a release.
5. **`prepack` builds** — a release tarball can never come from a stale `dist/`.

## How to verify

```
gh release view v0.21.0 --json assets          # btid-cli-0.21.0.tgz and btid-cli.tgz, both "uploaded"
curl -sIL -o /dev/null -w '%{http_code}\n' \
  https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz     # 200
npm i -g <that URL> && btid --help             # "added 1 package", "btid 0.21.0 — the BTID terminal"
npm run release                                # re-running is safe: it refreshes the same tag
```

## Notes

- A draft or `--prerelease` release is excluded from `latest`, which is how a release candidate is published without moving
  the stable URL.
- The script's `spawnSync` calls pass `shell: true` on Windows, which npm warns about (`DEP0190`: arguments are concatenated,
  not escaped). The arguments are paths this script builds itself; the warning is noted rather than silenced.
- `release/btid-cli-0.21.0.tgz` in the repository is still the **old 1.5 MB build**. The release asset is the 149 KB bundle.
  Deciding what to do with the in-repo copy is a separate call.
