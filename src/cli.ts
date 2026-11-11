import { GithubClient, exitCodeFor } from 'githubdb'
import type { Store, StoreBackend } from 'btid-core'
import { initStore, openStore, exitCodeOf, StoreFaultError, isStoreFault } from 'btid-core'
import { resolveToken, whoAmI } from './auth'
import { cachedLogin, configPath, readConfigFile, rememberLogin, resolveStore, type StoreLocation } from './config'
import { cacheRoot, dropSnapshot, readSnapshot, snapshotPath, writeSnapshot } from './snapshot'
import { ALL_VERBS } from './help'
import { consoleOutput, describeStore, type Output } from './output'
import { findVerb } from './verbs'
import type { Verb } from './verb'

/**
 * The entry point: parse, open, dispatch, turn the answer into an exit code.
 *
 * Nothing here knows a rule. It knows three things a terminal must: where the store is, who is asking, and how to turn
 * "the store refused" into a number a script can branch on.
 */

export interface RunOptions {
  /** `process.argv.slice(2)`. */
  argv: readonly string[]
  env?: NodeJS.ProcessEnv
  out?: Output
  /** Injected for tests: a client that answers without the network. */
  clientFor?: (store: StoreLocation, token: string) => GithubClient
  tokenFor?: () => string
  /** The login behind the token. Defaults to `GET /user` (or the cached answer); a test names it instead. */
  loginFor?: () => Promise<string>
  /** Where the config file is. A test points it somewhere disposable. */
  configPath?: string
  /** Store the snapshot nowhere: the store is loaded. `--fresh` and `BTID_NO_CACHE=1` both use it. */
  fresh?: boolean
  /** Where snapshots live. A test points it at a disposable directory instead of the user's cache. */
  cacheDir?: string
  fetchImpl?: typeof fetch
}

interface Parsed {
  flags: Record<string, string | boolean>
  args: string[]
}

/** `--flag value`, `--flag=value`, `--flag` as true, and everything else positional. */
export function parseFlags(argv: readonly string[]): Parsed {
  const flags: Record<string, string | boolean> = {}
  const args: string[] = []
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at]!
    if (!word.startsWith('--')) {
      args.push(word)
      continue
    }
    const body = word.slice(2)
    const equals = body.indexOf('=')
    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1)
      continue
    }
    const next = argv[at + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next
      at += 1
    } else {
      flags[body] = true
    }
  }
  return { flags, args }
}

/** The verb a person typed: two words for most, one for `help`. */
function findVerbFor(args: readonly string[]): { verb: Verb | undefined; rest: string[] } {
  for (const length of [2, 1]) {
    const name = args.slice(0, length).join(' ')
    const verb = ALL_VERBS.find((candidate) => candidate.name === name)
    if (verb !== undefined) return { verb, rest: args.slice(length) }
  }
  return { verb: undefined, rest: [...args] }
}

/**
 * Open the store the flags/env/config name, as whoever the token says.
 *
 * `store init` is the one verb that creates rather than opens — the caller decides which, and this returns either way.
 */
/**
 * Open the store, from the snapshot when the head says it is still true.
 *
 * The extra request is the point: **one** head read decides between hydrating rows the previous command already had and
 * loading the store from GitHub. A read becomes ~0.9 s instead of ~3.0 s, and a miss costs the load it would have done anyway.
 */
async function connect(
  location: StoreLocation,
  token: string,
  login: string,
  creating: boolean,
  options: Pick<RunOptions, 'clientFor' | 'fresh' | 'cacheDir'>,
): Promise<Opened> {
  const client =
    options.clientFor === undefined
      ? new GithubClient({ owner: location.owner, repo: location.repo, ref: location.ref, token })
      : options.clientFor(location, token)

  const path = snapshotPath(location.owner, location.repo, location.ref, options.cacheDir ?? cacheRoot())

  // The claim is the login the token belongs to: the roster decides what it means, and a login the roster has never seen
  // is written down as a member on the way in. Creating is the one case where the row it writes is the manager's.
  if (creating) {
    const created = await initStore({ client, claim: login })
    dropSnapshot(path)
    return { store: created, client, snapshotPath: path }
  }

  const read = options.fresh === true ? { snapshot: null, broken: false } : readSnapshot(path)
  const stored = read.snapshot

  // An unreadable file is deleted here rather than ignored: left alone it would be parsed and rejected on every command.
  if (read.broken) dropSnapshot(path)

  if (stored !== null) {
    // One request, and it is the one that decides everything: if the branch has not moved, these rows are the store.
    const head = await client.head().catch(() => null)
    if (head !== null && head === stored.commit) {
      return { store: await openStore({ client, claim: login, snapshot: stored }), client, snapshotPath: path }
    }
  }

  return { store: await openStore({ client, claim: login }), client, snapshotPath: path }
}

/** What a command needs after the store is open: the store, the client that can say where the branch is, and the cache path. */
interface Opened {
  store: Store
  client: StoreBackend
  snapshotPath: string
}

/**
 * The login behind the token: an injected answer, then the cache, then GitHub.
 *
 * The cache is keyed by a fingerprint of the token itself, so a new credential is a cache miss rather than the wrong person.
 */
async function loginFor(
  token: string,
  config: ReturnType<typeof readConfigFile>,
  options: RunOptions,
): Promise<string> {
  if (options.loginFor !== undefined) return options.loginFor()
  const remembered = cachedLogin(config, token)
  return remembered ?? whoAmI(token)
}

export async function run(options: RunOptions): Promise<number> {
  const out = options.out ?? consoleOutput()
  const env = options.env ?? process.env
  const parsed = parseFlags(options.argv)
  const flags = parsed.flags
  // `btid --version` is what a person types first; it is the `version` verb under another name.
  const args =
    parsed.args.length === 0 && (flags['version'] === true || flags['v'] === true) ? ['version'] : parsed.args
  const json = flags['json'] === true

  const { verb, rest } = findVerbFor(args)
  if (verb === undefined) {
    out.line(args.length === 0 ? helpOrNothing(out) : `btid: unknown command “${args.join(' ')}”. Run btid help.`)
    return args.length === 0 ? 0 : 2
  }

  // A flag the verb does not declare is a mistake, not something to ignore: silently dropping it is how a typo becomes
  // "needs at least one field to change", which is the wrong sentence for the wrong problem.
  const global = new Set(['store', 'json', 'help', 'v', 'version', 'fresh'])
  const declared = new Set([...Object.keys(verb.flags ?? {}), ...global])
  const unknownFlags = Object.keys(flags).filter((flag) => !declared.has(flag))
  if (unknownFlags.length > 0) {
    const known = Object.keys(verb.flags ?? {}).filter((flag) => !global.has(flag))
    const names = unknownFlags.map((flag) => `--${flag}`).join(', ')
    out.line(
      `usage: ${verb.name} does not take ${names}. It takes ${known.length === 0 ? 'no flags' : known.map((flag) => `--${flag}`).join(', ')}.`,
    )
    return 2
  }

  // `--help` on any verb is its usage line, and nothing else happens.
  if (flags['help'] === true) {
    out.line(verb.usage)
    return 0
  }

  // These answer questions about the binary or the cache, so none of them requires a store.
  if (STORE_LESS.has(verb.name)) {
    try {
      return await verb.run({
        store: undefined as never,
        location: { owner: '', repo: '', ref: '' },
        source: 'flag',
        cacheDir: options.cacheDir ?? cacheRoot(),
        args: rest,
        flags,
        out,
        json,
      })
    } catch (error) {
      return fault(error, out, json)
    }
  }

  const configFile = options.configPath === undefined ? configPath() : options.configPath
  const config = readConfigFile(configFile)
  const resolved = resolveStore({ ...(typeof flags['store'] === 'string' ? { store: flags['store'] } : {}) }, env, config)
  if (resolved === null) {
    out.line(
      'No store. Pass --store owner/repo[@branch], set BTID_STORE, or write ~/.config/btid/config.json. ' +
        'There is no default repository on purpose.',
    )
    return 2
  }

  let opened: Opened
  try {
    const token = options.tokenFor === undefined ? resolveToken(undefined, env).token : options.tokenFor()
    const login = await loginFor(token, config, options)
    opened = await connect(resolved.store, token, login, verb.name === 'store init', {
      ...(options.clientFor === undefined ? {} : { clientFor: options.clientFor }),
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      fresh: options.fresh === true || flags['fresh'] === true,
    })
    // Remember the answer for the next command: one saved request per invocation, and the token is fingerprinted so a
    // different credential never inherits somebody else's name.
    rememberLogin(login, token, resolved.store, configFile)
  } catch (error) {
    return fault(error, out, json)
  }

  const { store } = opened

  try {
    const code = await verb.run({
      store,
      location: resolved.store,
      source: resolved.from,
      cacheDir: options.cacheDir ?? cacheRoot(),
      args: rest,
      flags,
      out,
      json,
    })
    if (code !== 0) return code

    // Keep the snapshot unless this command wrote: after a commit these rows describe the store *before* it. A read leaves
    // them true, and the next command skips the load entirely.
    if (verb.writes === true) dropSnapshot(opened.snapshotPath)
    else if (options.fresh !== true && flags['fresh'] !== true) {
      const head = await opened.client.head().catch(() => null)
      if (head !== null) writeSnapshot(opened.snapshotPath, { ...store.snapshot(), commit: head })
    }
    return 0
  } catch (error) {
    return fault(error, out, json)
  } finally {
    // Which store answered is worth one line of stderr on a bad day, and worth none on a good one.
    if (process.env['BTID_DEBUG'] === '1') process.stderr.write(`store ${describeStore(resolved.store)}\n`)
  }
}

/** The verbs that must work with no store and no token at all. */
const STORE_LESS = new Set(['help', 'version', 'cache show', 'cache clear'])

/** A fault is not a refusal: its code maps to an exit number, and `--json` carries it as data. */
function fault(error: unknown, out: Output, json: boolean): number {
  if (isStoreFault(error)) {
    if (json) out.json({ error: { kind: 'fault', code: error.code, message: error.message } })
    else out.line(`error: ${error.message.split('\n')[0]}  (${error.code})`)
    return exitCodeOf(error)
  }
  if (error instanceof StoreFaultError) return exitCodeOf(error)
  if (error instanceof Error && error.name === 'AuthError') {
    if (json) out.json({ error: { kind: 'auth', message: error.message } })
    else out.line(`error: ${error.message}`)
    return 2
  }
  const message = error instanceof Error ? error.message : String(error)
  if (json) out.json({ error: { kind: 'unexpected', message } })
  else out.line(`error: ${message}`)
  // Mirrors the engine's numbering for anything it classifies; otherwise the generic failure code.
  return typeof error === 'object' && error !== null ? exitCodeFor(error) : 1
}

const helpOrNothing = (out: Output): string => {
  const width = Math.max(...ALL_VERBS.map((verb) => verb.name.length))
  return [
    'btid — the BTID terminal',
    '',
    ...ALL_VERBS.map((verb) => `  ${verb.name.padEnd(width, ' ')}  ${verb.summary}`),
    '',
    'Run btid help, or btid help <verb>.',
  ].join('\n')
}
