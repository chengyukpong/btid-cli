/**
 * What this CLI is.
 *
 * `CLI_VERSION` is written here rather than read from `package.json` because the build's `rootDir` is `src/` — importing a
 * file from above it would change the emit layout. A test asserts the two agree, so the copy cannot drift silently.
 */
export const CLI_VERSION = '0.1.0'

/** The manifest's own shape version: bump it when a field of `btid help --json` changes meaning. */
export const MANIFEST_VERSION = 1

/** One line, for `btid version` and `--version`. */
export const versionLine = (coreSchema: number): string =>
  `btid ${CLI_VERSION} · btid-core schema v${coreSchema} · manifest ${MANIFEST_VERSION}`
