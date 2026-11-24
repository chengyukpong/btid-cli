# Releasing

The CLI is distributed as a **GitHub release asset**, not through a registry. A release carries the same tarball under two
names, and the pair is what makes both `pinned` and `latest` installs possible.

## The two names

| Asset | Purpose | URL |
|---|---|---|
| `btid-cli-<version>.tgz` | the record of exactly what that version was | `/releases/download/v<version>/btid-cli-<version>.tgz` |
| `btid-cli.tgz` | always the newest | `/releases/latest/download/btid-cli.tgz` |

GitHub's `/releases/latest` resolves the newest **release**, not the newest **filename**. With only the versioned asset, the
"latest" URL would work until the next version and then 404. The stable copy is one extra file per release and removes that
whole class of broken link.

A release is **excluded from `latest`** if it is a draft or a pre-release, so a release candidate is simply marked
`--prerelease` and the stable URL keeps pointing at the last good one.

## The script

```
npm run release
```

`scripts/release.mjs`, in order:

1. `npm pack --pack-destination .tmp` — `prepack` runs `tsc` + esbuild, so the tarball is always built from source, never
   from a stale `dist/`;
2. copies the tarball to `.tmp/btid-cli.tgz` (same bytes, stable name);
3. if `v<version>` does not exist, `gh release create` with both assets; if it does, `gh release upload --clobber`, which is
   how a rebuilt tarball or a corrected note is refreshed;
4. prints the pinned and latest URLs so the release notes and the README can be checked against them.

It reads the version from `package.json` — bump it, commit, then release. It never decides to publish on its own, and it
does not run in CI: **publishing is explicit**, per `AGENTS.md`.

## What it needs

- `gh` signed in with `repo` scope (`gh auth status`);
- the working tree pushed — `gh release create` tags the **remote** HEAD, so a release cut before a push describes code
  nobody else can fetch;
- `private: true` may stay in `package.json`: a release asset is not a registry publish.

## Verifying a release

```
gh release view v<version> --json assets      # both names, state "uploaded"
curl -sIL -o /dev/null -w '%{http_code}\n' \
  https://github.com/chengyukpong/btid-cli/releases/latest/download/btid-cli.tgz   # 200
npm i -g <the latest URL> && btid --help                                          # "added 1 package"
```

## History

- `v0.21.0` — first release. It shipped a 1.5 MB tarball because `bundleDependencies` carried zod's whole package; the
  same version was re-cut after the esbuild bundle landed, which is why the *release* was refreshed rather than given a new
  version number.
