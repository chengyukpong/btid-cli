# The package ships one file

- **Status:** done
- **Created:** 2026-11-24T23:40:00+08:00
- **Finished:** 2026-11-25T03:50:00+08:00
- **Approved:** 2026-11-25T03:50:00+08:00

## Description

`npm pack` produced a **1.5 MB** tarball for a 380 KB CLI. The measured breakdown:

| What | Files | Size |
|---|---|---|
| `node_modules/zod` (bundled, pulled in by core *and* githubdb) | 840 | 6,005 KB |
| `node_modules/btid-core` | 182 | 769 KB |
| `node_modules/githubdb` | 48 | 196 KB |
| the CLI itself (`dist/`) | 45 | 380 KB |

`bundleDependencies` was shipping the whole dependency *tree* — including zod's `src/` and its unused `v3/`. The cost was
paid by every `npm i -g`.

## What changed

- **esbuild bundles `src/bin.ts` into `dist/bin.bundle.js`** — one file, `--minify --platform=node --target=node20`,
  CommonJS, the shebang from `bin.ts` kept. Tree-shaking does the rest: only the exports the CLI actually calls survive.
- **`bin` points at the bundle; `files` ships the bundle and nothing else.**
- **No runtime dependencies at all.** `btid-core` and `githubdb` are build-time inputs now (`devDependencies`), because
  they are *inside* the bundle. `bundleDependencies` is gone, so no `file:` specifier is ever published.
- **`prepack`, not `prepare`** — building belongs to packing/publishing, not to installing. A consumer's `npm i` no longer
  runs `tsc`.
- `prepare` → `prepack` also means the published tarball is always built from source, never from a stale `dist/`.

## Numbers

| | Before | After |
|---|---|---|
| packed | 1,439 KB | **149 KB** |
| unpacked | 7,196 KB | **637 KB** |
| files | 1,102 | **3** (bundle, README, package.json) |
| installed packages | 4 | **1** |

The bundle is 631 KB minified. `zod` is most of it: zod 4's barrel exports are not fully tree-shakeable, so the CLI carries
the parts of it that `btid-core`'s schema helpers reach. Cutting further would mean importing from `zod/v4/...` subpaths
inside `btid-core`, which is not this repository's call.

## How to verify

```
npm run build && node dist/bin.bundle.js --help      # the bundle runs
npm run typecheck && npm test                        # 121 tests
npm pack --dry-run --json                            # 149 KB, 3 files
```

And the install, done in a throwaway directory:

```
npm pack → npm i <tarball>   # "added 1 package"; node_modules holds btid-cli alone
node node_modules/btid-cli/dist/bin.bundle.js --help
```

## Not done

`private: true` is still set, so this is not published. Publishing is a separate decision, and the manifest still needs
`license`, `repository` and a `-g` install path chosen (npmjs, GitHub Packages, or a Release tarball).
