# The release folder says what shipped

- **Status:** done
- **Created:** 2026-11-25T04:10:00+08:00
- **Finished:** 2026-11-25T22:05:00+08:00
- **Approved:** 2026-11-25T22:05:00+08:00

## Description

`release/` is the repository's record of what shipped, one tarball per version. Two things were wrong with it:

1. **`btid-cli-0.21.0.tgz` was 1.4 MB** — packed from a working tree that predated `build: the package ships one bundle`
   (55f5385), while the release asset of the same name is the **149 KB** bundle. The folder and the release disagreed about
   what 0.21.0 was.
2. **`0.22.0` had no entry at all**, because the release script packs into `.tmp` and never touched `release/`.

A folder that names a version is a claim about that version, so the fix is to make the claim true rather than to delete it.

## What was done

- **0.21.0 repacked from its tag**, not from the working tree: `git worktree add ../btid-cli-wt-021 v0.21.0`, `npm install`,
  `npm run build`, `npm pack`. Result: **149 KB, 3 files** (`dist/bin.bundle.js`, `package.json`, `README.md`) — the same
  shape as the release asset. The worktree was removed afterwards.
- **0.22.0 packed** from the tree that was the version under release: **151 KB**.
- **`scripts/release.mjs` now writes `release/`** (`npm run release` copies the pinned tarball there), so the folder can no
  longer drift from the assets.
- **`docs/releasing.md`** records the rule and the worktree recipe for repairing an old version.

Checked end to end: the 0.22.0 tarball installs into a scratch directory in 812 ms, `added 1 package`, and
`btid version --json` answers `{"btid":"0.22.0","coreSchema":1,"manifest":3}` from it.

## Not changed, deliberately

The 23 older tarballs (0.2.0 … 0.19.1, ~1.3 MB each) are left as they are. They are not wrong: those versions really were
un-bundled, so the folder is telling the truth about them, and rewriting history for size would make the record less
accurate, not more.

## Where it lives

- `release/btid-cli-0.21.0.tgz`, `release/btid-cli-0.22.0.tgz`
- `scripts/release.mjs`, `docs/releasing.md`
