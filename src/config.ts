import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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
  /**
   * Who the cached token belonged to, and a fingerprint of the token itself.
   *
   * `GET /user` is one of the three round trips every command paid for before it could touch the store. A login cannot be
   * *derived* from a token, so the only way to skip the call is to remember the answer — and the only safe way to remember it
   * is to remember which token it was the answer for.
   */
  login?: string
  tokenFingerprint?: string
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
    const record = parsed as Record<string, unknown>
    const store = record['store']
    if (typeof store !== 'string') return null
    const location = parseStore(store)
    if (location === null) return null
    const login = typeof record['login'] === 'string' && record['login'] !== '' ? record['login'] : undefined
    const tokenFingerprint =
      typeof record['tokenFingerprint'] === 'string' && record['tokenFingerprint'] !== ''
        ? record['tokenFingerprint']
        : undefined
    return {
      store: location,
      ...(login === undefined ? {} : { login }),
      ...(tokenFingerprint === undefined ? {} : { tokenFingerprint }),
    }
  } catch {
    return null
  }
}

/** Sixteen hex characters of the token's sha256: enough to tell two tokens apart, useless as a token. */
export const fingerprintOf = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 16)

/**
 * Remember who a token belongs to, so the next command can skip `GET /user`.
 *
 * Best effort: a config directory that cannot be written (a locked-down machine, a read-only home) must not fail the
 * command. The cost of not remembering is one request, not a broken CLI.
 */
export function rememberLogin(
  login: string,
  token: string,
  store: StoreLocation | null,
  path: string = configPath(),
): void {
  try {
    const existing = readConfigFile(path)
    const next = {
      ...(store === null ? {} : { store: `${store.owner}/${store.repo}@${store.ref}` }),
      ...(existing !== null && store === null ? { store: `${existing.store.owner}/${existing.store.repo}@${existing.store.ref}` } : {}),
      login,
      tokenFingerprint: fingerprintOf(token),
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch {
    // Nothing to do: the login is an optimisation, and the next run will ask GitHub again.
  }
}

/** The remembered login, when it was remembered for this exact token. */
export const cachedLogin = (config: Config | null, token: string): string | null =>
  config !== null && config.login !== undefined && config.tokenFingerprint === fingerprintOf(token)
    ? config.login
    : null

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
