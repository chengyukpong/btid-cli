import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { decodeSnapshot, encodeSnapshot } from './snapshot-codec'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoreSnapshot } from 'btid-core'

/**
 * The store, kept between commands — the browser's trick, with a file instead of IndexedDB.
 *
 * `btid2` does not ask GitHub for the store every time a tab opens: it keeps the rows with the commit they were read at, and
 * lets the head poll decide whether the claim still holds. The same thing works here, and it is the difference between three
 * seconds and one:
 *
 * ```
 * today   process 0.15 + gh 0.07 + /user 0.6 + tree 0.6 + blob 0.6 × files   ≈ 3.0 s
 * cached  process 0.15 + gh 0.07 + head 0.6 + hydrate                          ≈ 0.9 s
 * ```
 *
 * What is kept is a **snapshot**, not a cache: the rows, the listing they were read from (path → blob sha, which is what lets
 * a write refuse a file somebody else moved), the schema version, and the commit. The commit is the only claim about
 * freshness, and it is checked against the branch head rather than trusted — by this package, once, before the store is opened.
 */

/** Where the snapshot lives. `BTID_CACHE_DIR` moves it; `BTID_NO_CACHE=1` turns it off. */
export const cacheRoot = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string => {
  const explicit = env['BTID_CACHE_DIR']
  if (explicit !== undefined && explicit.trim() !== '') return explicit
  const local = env['LOCALAPPDATA']
  if (local !== undefined && local.trim() !== '') return join(local, 'btid', 'cache')
  const xdg = env['XDG_CACHE_HOME']
  if (xdg !== undefined && xdg.trim() !== '') return join(xdg, 'btid')
  return home === '' ? join(tmpdir(), 'btid-cache') : join(home, '.cache', 'btid')
}

export const cacheEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env['BTID_NO_CACHE'] !== '1'

/**
 * One file per store, named after the repository and the branch.
 *
 * A ref is part of the name because `main` and a release branch are different stores, and a snapshot that ignored which one
 * it came from would hand `main`'s rows to a release check.
 */
export const snapshotPath = (
  owner: string,
  repo: string,
  ref: string,
  root: string = cacheRoot(),
): string => join(root, `${owner}__${repo}__${ref}.snapshot.json`)

/** The stored snapshot, or null when there is none, it will not parse, or caching is off. */
export function readSnapshot(path: string, env: NodeJS.ProcessEnv = process.env): StoreSnapshot | null {
  if (!cacheEnabled(env) || !existsSync(path)) return null
  try {
    // gzipped or not, decided by the bytes: a file the previous build wrote still reads.
    return decodeSnapshot(readFileSync(path)) as StoreSnapshot
  } catch {
    // A half-written, hand-edited or truncated file is a miss, not an error: the cost of a miss is one load.
    return null
  }
}

/**
 * Keep a snapshot for next time.
 *
 * Written beside the target and renamed, so a command killed mid-write cannot leave a file that parses as half a store.
 * Best effort: a read-only cache directory costs one load, not a failed command.
 */
export function writeSnapshot(path: string, snapshot: StoreSnapshot): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    // Gzipped above a threshold, plain below it — see snapshot-codec.ts for why both are on purpose.
    writeFileSync(temp, encodeSnapshot(snapshot))
    renameSync(temp, path)
  } catch {
    // Nothing to do: the next command pays for a load.
  }
}

/**
 * Forget the snapshot — what a write does, because after a commit the rows this file describes are the rows before it.
 *
 * The alternative is re-reading the store right after committing, which costs the round trips the next command would have
 * spent anyway; a deletion makes the *next* command pay, and only if it needs the store.
 */
export function dropSnapshot(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Already gone is the state we wanted.
  }
}
