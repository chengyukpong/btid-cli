# The lockfile pins tarballs that are not in the repository

- **Status:** backlog
- **Created:** 2026-11-25T10:22:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`npm ci` cannot install this repo, and cannot on any machine but the one that wrote the lockfile:

```
npm error code EINTEGRITY
npm error sha512-gLZrFhi1m///…Zng== integrity checksum failed when using sha512:
npm error   wanted sha512-gLZrFhi1m///…Zng==
npm error   but got sha512-OABCIiKTeOcd…RjKA== (60250 bytes)
```

The two `file:` dependencies are **local build artifacts**:

| dependency | lives in | tracked? |
|---|---|---|
| `btid-core@0.32.2` | `../btid-core/release/btid-core-0.32.2.tgz` | **no** — `release/` is gitignored there |
| `githubdb@2.2.0` | `../githubdb/release/githubdb-2.2.0.tgz` | **no** — `.gitignore:14:/release` |

`package-lock.json` records a sha512 for each — hashes of tarballs that exist only on one machine. On this one, `githubdb` was
last packed on **2026-11-12 12:14** and `btid-core` on **2026-11-19 10:46**; both are different bytes from what the lock expects,
so every install fails. `--force` does not help: npm validates `file:` tarballs against the lock the same way it does registry
ones.

The workaround used to get the checkout building again: `npm install --no-package-lock`, which resolves from `package.json` and
leaves the committed lock alone. That is a workaround, not a fix — the next `npm ci` fails again.

## Why it happened

Both tarballs were **repacked under the same version number** at some point (that is what the mismatch proves), and a `file:`
dependency carries its bytes, not its identity. Two builds of `2.2.0` are indistinguishable to npm except by hash.

## Steps

- [ ] Decide where the truth is. Either `release/*.tgz` are **artifacts of the repo** — then they belong in git (or in a release
      download) and the lock is meaningful — or they are **machine-local builds** — then the lock must not record their
      integrity, and a fresh clone has to build them (`npm run release` in each upstream) before `npm ci` can run.
- [ ] If the lock keeps them: stop repacking the same version. A rebuilt artifact gets a new version, so a lock written against
      it stays true; `btid-cli`'s own `scripts/release.mjs` now cuts a stable `btid-cli.tgz`, which is the same hazard one layer
      out.
- [ ] Whatever is chosen, `AGENTS.md` should say how a fresh checkout gets its `node_modules`: which tarballs to build first, in
      which order (`githubdb` → `btid-core` → `btid-cli`), because "npm ci then npm test" is the instruction everybody assumes
      and it does not work today.

## How to verify

- `npm ci` in `btid-cli` on a machine that did not write the lock, from a clean `node_modules`.
- After the fix, the same command should either succeed or say which tarball to build first — not fail with a checksum.
