import { GithubClient, exitCodeFor } from 'githubdb'
import type { Store, StoreBackend } from 'btid-core'
import { initStore, openStore, exitCodeOf, StoreFaultError, isStoreFault, type LogSink } from 'btid-core'
import { both, defaultLogPath, fileSink, stderrSink } from './log'
import { resolveToken, whoAmI } from './auth'
import { cachedLogin, configPath, readConfigFile, rememberLogin, resolveStore, type StoreLocation } from './config'
import { cacheRoot, dropSnapshot, readSnapshot, snapshotPath, writeSnapshot } from './snapshot'
import { resolve } from './grammar'
import { helpText } from './help'
import { consoleOutput, describeStore, type Output } from './output'
import type { VerbContext } from './verb'
import { usage } from './verb'

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
  /** Where diagnostics go. Injected by a test that asserts on them; `process.stderr` otherwise. */
  stderr?: (text: string) => void
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
  options: Pick<RunOptions, 'clientFor' | 'fresh' | 'cacheDir'> & { log?: LogSink; loads: { count: number } },
): Promise<Opened> {
  const label = describeStore(location)
  // The engine's `commit: N file(s)` line comes from the *client*, not from the engine the core builds — so the sink goes here
  // too, as an entry of its own. One stream, in order, rather than a second one a reader would have to interleave.
  const engineSink = options.log
  const engineLog = (line: string): void => {
    // The engine says two things worth an entry — what a commit carried, and that there was nothing to carry. Its other lines are
    // progress for a debugging session (`5 file(s) match no class template`, then one line per path), and an entry per path is
    // not a brief detail; a log that needs scrolling to find the command has stopped being a log.
    if (!/commit: |nothing to commit/.test(line)) return
    options.log?.({
      at: new Date().toISOString(),
      actor: 'client',
      verb: 'engine',
      subject: label,
      result: 'ok',
      ms: 1,
      detail: line.trim(),
    })
  }
  const client =
    options.clientFor === undefined
      ? new GithubClient({ owner: location.owner, repo: location.repo, ref: location.ref, token, log: engineLog })
      : options.clientFor(location, token)

  const path = snapshotPath(location.owner, location.repo, location.ref, options.cacheDir ?? cacheRoot())

  // The claim is the login the token belongs to: the roster decides what it means, and a login the roster has never seen
  // is written down as a member on the way in. Creating is the one case where the row it writes is the manager's.
  if (creating) {
    options.loads.count += 1
    const created = await initStore({
      client,
      claim: login,
      label,
      ...(options.log === undefined ? {} : { log: options.log }),
      engineLog,
    })
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
      options.loads.count += 1
      return {
        store: await openStore({
          client,
          claim: login,
          snapshot: stored,
          label,
          ...(options.log === undefined ? {} : { log: options.log }),
          engineLog,
        }),
        client,
        snapshotPath: path,
      }
    }
  }

  options.loads.count += 1
  return {
    store: await openStore({
      client,
      claim: login,
      label,
      ...(options.log === undefined ? {} : { log: options.log }),
      engineLog,
    }),
    client,
    snapshotPath: path,
  }
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

  // --- the log: built here, because it must exist before the store does -----------------------------------------
  //
  // Two sinks, both opt-in: `--verbose` to stderr (so a piped `--json` keeps its pipe), `--log-file [path]` to a file. With no
  // path the name is `btid-{yyyyMMdd}.log` in the cache directory, so a day's commands are one file.
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(text))
  const verbose = flags['verbose'] === true
  const logFlag = flags['log-file']
  const logPath =
    logFlag === true
      ? defaultLogPath(options.cacheDir ?? cacheRoot())
      : typeof logFlag === 'string'
        ? logFlag
        : null
  const sinks = [verbose ? stderrSink(stderr) : null, logPath === null ? null : fileSink(logPath, stderr)].filter(
    (sink): sink is LogSink => sink !== null,
  )
  const log: LogSink | undefined =
    sinks.length === 0
      ? undefined
      : sinks.length === 1
        ? sinks[0]
        : both(...sinks)
  const startedAt = Date.now()
  const loads = { count: 0 }

  let code = 2
  try {
    code = await dispatch(options, out, env, flags, parsed.args, log, loads)
    return code
  } finally {
    // One closing entry per command: the per-call entries say what the store did, not what the user asked for.
    log?.({
      at: new Date(startedAt).toISOString(),
      actor: 'cli',
      verb: 'command',
      subject: parsed.args.join(' '),
      result: String(code),
      ms: Math.max(1, Date.now() - startedAt),
      detail: `${String(loads.count)} load${loads.count === 1 ? '' : 's'}`,
    })
  }
}

/** What `run` used to be: parse, open, dispatch, return the exit code. The log is threaded through, not global. */
async function dispatch(
  options: RunOptions,
  out: Output,
  env: NodeJS.ProcessEnv,
  flags: Record<string, string | boolean>,
  parsedArgs: readonly string[],
  log: LogSink | undefined,
  loads: { count: number },
): Promise<number> {
  // `btid --version` is what a person types first; it is the `version` verb under another name.
  const args =
    parsedArgs.length === 0 && (flags['version'] === true || flags['v'] === true) ? ['version'] : [...parsedArgs]
  const json = flags['json'] === true

  // One tree: the verb, then one path token, then data. The resolver either matches a rule or teaches the new spelling.
  const resolution = resolve(args)
  if (resolution.kind === 'empty') {
    out.line(helpText())
    return 0
  }
  if (resolution.kind === 'refusal') return usage(resolution.message, out, json)

  const { rule, path, ids, data } = resolution
  const handler = rule.handler
  const form = rule.path === null ? rule.verb : `${rule.verb} ${path}`

  // A flag the verb does not declare is a mistake, not something to ignore: silently dropping it is how a typo becomes
  // "needs at least one field to change", which is the wrong sentence for the wrong problem.
  const global = new Set(['store', 'json', 'help', 'v', 'version', 'fresh', 'verbose', 'log-file'])
  const declared = new Set([...Object.keys(handler.flags ?? {}), ...global])
  const unknownFlags = Object.keys(flags).filter((flag) => !declared.has(flag))
  if (unknownFlags.length > 0) {
    // `promote` is the crossing and nothing else; a status is a different verb's business, and the sentence says which.
    if (rule.verb === 'promote') {
      const flag = unknownFlags[0]!
      const value = flags[flag]
      return usage(`promote takes no attributes; edit ${path} --${flag}${value === true ? '' : ` ${String(value)}`}`, out, json)
    }
    const known = Object.keys(handler.flags ?? {}).filter((flag) => !global.has(flag))
    const names = unknownFlags.map((flag) => `--${flag}`).join(', ')
    out.line(
      `usage: ${path === '' ? rule.verb : `${rule.verb} ${path}`} does not take ${names}. It takes ${known.length === 0 ? 'no flags' : known.map((flag) => `--${flag}`).join(', ')}.`,
    )
    return 2
  }

  // `--help` on any verb is its usage line, and nothing else happens.
  if (flags['help'] === true) {
    out.line(handler.usage)
    return 0
  }

  // These answer questions about the binary or the cache, so none of them requires a store.
  if (handler.noStore === true) {
    try {
      return await handler.run({
        store: undefined as never,
        location: { owner: '', repo: '', ref: '' },
        source: 'flag',
        cacheDir: options.cacheDir ?? cacheRoot(),
        details: flags['details'] === true,
        args: rule.args(ids, data),
        path,
        form,
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
    opened = await connect(resolved.store, token, login, rule.verb === 'new' && rule.path === 'store', {
      ...(options.clientFor === undefined ? {} : { clientFor: options.clientFor }),
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      fresh: options.fresh === true || flags['fresh'] === true,
      ...(log === undefined ? {} : { log }),
      loads,
    })
    // Remember the answer for the next command: one saved request per invocation, and the token is fingerprinted so a
    // different credential never inherits somebody else's name.
    rememberLogin(login, token, resolved.store, configFile)
  } catch (error) {
    return fault(error, out, json)
  }

  const { store } = opened

  try {
    const context: VerbContext = {
      store,
      location: resolved.store,
      source: resolved.from,
      cacheDir: options.cacheDir ?? cacheRoot(),
      details: flags['details'] === true,
      args: rule.args(ids, data),
      path,
      form,
      flags,
      out,
      json,
    }
    const code = await handler.run(context)
    if (code !== 0) return code

    // Keep the snapshot true, whichever way this command went.
    //
    // A read leaves it exactly as it was. A write has just committed, so the engine's rows and its listing are the new
    // state — and the verb hands back the commit sha. That is a snapshot refresh with **no request at all**, which is what
    // keeps a loop of writes from paying for a cold load on every one of them.
    if (options.fresh !== true && flags['fresh'] !== true) {
      if (handler.writes !== true) {
        const head = await opened.client.head().catch(() => null)
        if (head !== null) writeSnapshot(opened.snapshotPath, { ...store.snapshot(), commit: head })
      } else if (typeof context.committed === 'string') {
        // The rows are the engine's own after a write, but its listing is not something to keep: `githubdb`'s post-write
        // baseline is built from the paths it wrote, not their shas (recorded as a task in that repository). One tree request
        // makes the snapshot's `seen` authoritative, which is what a later write's conflict check relies on — still one
        // request instead of the five a reload costs.
        const listing = await opened.client.tree().catch(() => null)
        if (listing === null) dropSnapshot(opened.snapshotPath)
        else {
          writeSnapshot(opened.snapshotPath, {
            ...store.snapshot(),
            seen: listing.entries.map((entry) => [entry.path, entry.sha] as [string, string]),
            commit: context.committed,
          })
        }
      } else if (context.committed === null) {
        // Nothing was written, so the head has not moved and the snapshot is still true. Leave it.
      } else {
        // The verb wrote through something other than `commit()`; the safe answer is to forget the file.
        dropSnapshot(opened.snapshotPath)
      }
    }
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
