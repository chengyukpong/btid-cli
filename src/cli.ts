import { GithubClient, exitCodeFor } from 'githubdb'
import type { Store } from 'btid-core'
import { initStore, openStore, exitCodeOf, StoreFaultError, isStoreFault } from 'btid-core'
import { resolveToken, whoAmI } from './auth'
import { readConfigFile, resolveStore, type StoreLocation } from './config'
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
  /** The login behind the token. Defaults to `GET /user`; a test names it instead. */
  loginFor?: () => Promise<string>
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
async function connect(
  location: StoreLocation,
  token: string,
  login: string,
  creating: boolean,
  clientFor: RunOptions['clientFor'],
): Promise<Store> {
  const client =
    clientFor === undefined
      ? new GithubClient({ owner: location.owner, repo: location.repo, ref: location.ref, token })
      : clientFor(location, token)

  // The claim is the login the token belongs to: the roster decides what it means, and a login the roster has never seen
  // is written down as a member on the way in. Creating is the one case where the row it writes is the manager's.
  if (creating) return initStore({ client, claim: login })
  return openStore({ client, claim: login })
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

  // `help` and `version` answer questions about the binary, so neither requires a store.
  if (verb.name === 'help' || verb.name === 'version') {
    try {
      return await verb.run({
        store: undefined as never,
        location: { owner: '', repo: '', ref: '' },
        source: 'flag',
        args: rest,
        flags,
        out,
        json,
      })
    } catch (error) {
      return fault(error, out, json)
    }
  }

  const resolved = resolveStore({ ...(typeof flags['store'] === 'string' ? { store: flags['store'] } : {}) }, env, readConfigFile())
  if (resolved === null) {
    out.line(
      'No store. Pass --store owner/repo[@branch], set BTID_STORE, or write ~/.config/btid/config.json. ' +
        'There is no default repository on purpose.',
    )
    return 2
  }

  let store: Store
  try {
    const token = options.tokenFor === undefined ? resolveToken(undefined, env).token : options.tokenFor()
    const login = options.loginFor === undefined ? await whoAmI(token) : await options.loginFor()
    store = await connect(resolved.store, token, login, verb.name === 'store init', options.clientFor)
  } catch (error) {
    return fault(error, out, json)
  }

  try {
    const code = await verb.run({
      store,
      location: resolved.store,
      source: resolved.from,
      args: rest,
      flags,
      out,
      json,
    })
    if (code !== 0) return code
    return 0
  } catch (error) {
    return fault(error, out, json)
  } finally {
    // Which store answered is worth one line of stderr on a bad day, and worth none on a good one.
    if (process.env['BTID_DEBUG'] === '1') process.stderr.write(`store ${describeStore(resolved.store)}\n`)
  }
}

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
