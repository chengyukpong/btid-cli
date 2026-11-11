import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the store is.
 *
 * No default repository: a CLI that guesses which store you meant is a CLI that writes to the wrong one. The order is
 * flag, then environment, then the config file — most specific first, and the last of them is the only one that survives a
 * new shell.
 */
export interface StoreLocation {
  owner: string
  repo: string
  ref: string
}

export interface Config {
  store: StoreLocation
}

/** `owner/repo` or `owner/repo@branch`. */
export function parseStore(text: string): StoreLocation | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const at = trimmed.lastIndexOf('@')
  const [scope, ref = 'main'] = at === -1 ? [trimmed, 'main'] : [trimmed.slice(0, at), trimmed.slice(at + 1)]
  const parts = scope.split('/')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null
  return { owner: parts[0]!, repo: parts[1]!, ref: ref === '' ? 'main' : ref }
}

export const configPath = (home: string = homedir()): string =>
  join(home, '.config', 'btid', 'config.json')

/** The config file's store, or null when there is none or it does not parse. A broken file is not worth an error page. */
export function readConfigFile(path: string = configPath()): Config | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const store = (parsed as Record<string, unknown>)['store']
    if (typeof store !== 'string') return null
    const location = parseStore(store)
    return location === null ? null : { store: location }
  } catch {
    return null
  }
}

/**
 * Resolve the store from the three sources, in order.
 *
 * Returns the location and where it came from, so `btid store whoami` can say which of the three answered — a person who
 * thought they were pointed at staging should be able to see that they were not.
 */
export function resolveStore(
  flags: { store?: string },
  env: NodeJS.ProcessEnv,
  file: Config | null,
): { store: StoreLocation; from: 'flag' | 'env' | 'file' } | null {
  if (flags.store !== undefined) {
    const location = parseStore(flags.store)
    return location === null ? null : { store: location, from: 'flag' }
  }
  const fromEnv = env['BTID_STORE']
  if (fromEnv !== undefined) {
    const location = parseStore(fromEnv)
    return location === null ? null : { store: location, from: 'env' }
  }
  return file === null ? null : { store: file.store, from: 'file' }
}
