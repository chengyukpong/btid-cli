/**
 * Is there a newer release than this copy?
 *
 * `btid` is installed from a GitHub release asset, so nothing else tells a person their copy is old — there is no registry
 * to ask and no `npm outdated` line for it. `btid version` asks once a day and says so.
 *
 * The question is asked of GitHub's redirect rather than its API: `HEAD /releases/latest` answers `302` with
 * `/releases/tag/v0.22.0` in `Location`. One request, no token, no rate limit — the JSON API allows 60 an hour
 * unauthenticated, which a shared machine or a CI box could reach by accident.
 *
 * Everything here takes its clock, its fetch and its cache path as arguments, so the tests need neither a network nor a
 * real day to pass.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Where the releases live. */
export const REPO = 'chengyukpong/btid-cli'

/** The asset whose name never changes, so this URL is the same in every version. */
export const INSTALL_URL = `https://github.com/${REPO}/releases/latest/download/btid-cli.tgz`

/** A day: the answer is kept, not re-asked on every command. */
export const CHECK_WINDOW_MS = 24 * 60 * 60 * 1000

/** A slow network must not hold up `btid version`; past this the answer is "unknown", not "waiting". */
const TIMEOUT_MS = 800

export interface UpdateReading {
  /** What this copy is. */
  current: string
  /** The newest release's version, or `null` when it could not be found (offline, blocked, no releases). */
  latest: string | null
  /** Whether `latest` is newer than `current`. */
  newer: boolean
  /** When the answer was obtained, or `null` when nothing was asked and nothing was cached. */
  checkedAt: number | null
}

interface CachedCheck {
  checkedAt: number
  latest: string | null
}

/** `0.22.0` from a release URL: `…/releases/tag/v0.22.0` → `0.22.0`. Anything else is `null`. */
export function parseReleaseTag(location: string | null | undefined): string | null {
  if (typeof location !== 'string') return null
  const match = /\/releases\/tag\/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(location.trim())
  return match?.[1] ?? null
}

/**
 * Compare two versions, numerically: `-1`, `0` or `1`.
 *
 * Only major.minor.patch is compared, so a pre-release tag (`0.22.0-rc.1`) is not an update over `0.22.0` — the stable
 * release is what this notice is about.
 */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string): number[] => {
    const core = value.split('-')[0] ?? ''
    return core.split('.').map((part) => {
      const number = Number.parseInt(part, 10)
      return Number.isFinite(number) ? number : 0
    })
  }
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index] ?? 0
    const other = b[index] ?? 0
    if (one !== other) return one > other ? 1 : -1
  }
  return 0
}

/** Whatever is on disk, as a check — anything unreadable is a cache miss rather than a crash. */
export function readUpdateCache(raw: string | null): CachedCheck | null {
  if (raw === null || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const checkedAt = record['checkedAt']
    const latest = record['latest']
    if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return null
    if (latest !== null && typeof latest !== 'string') return null
    return { checkedAt, latest: latest as string | null }
  } catch {
    return null
  }
}

export const writeUpdateCache = (check: CachedCheck): string =>
  JSON.stringify({ checkedAt: check.checkedAt, latest: check.latest })

const readFile = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Best effort: a cache that cannot be written costs a request next time, which is not worth an error. */
const writeFile = (path: string, text: string): void => {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  } catch {
    /* read-only home, a full disk: the command still works */
  }
}

/** The newest release tag, or `null` when GitHub did not answer in time or did not redirect where expected. */
async function fetchLatest(
  repo: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`https://github.com/${repo}/releases/latest`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    // A redirect is the normal answer; a followed `200` would mean the Location was already consumed.
    return parseReleaseTag(response.headers.get('location')) ?? parseReleaseTag(response.url) ?? null
  } catch {
    return null
  }
}

export interface UpdateOptions {
  current: string
  /** Where the day's answer is kept. No path means ask every time, which only tests want. */
  cachePath?: string
  now?: number
  fetchImpl?: typeof fetch
  repo?: string
  env?: NodeJS.ProcessEnv
  /** Skip the cache and ask — `--fresh` on the command line. */
  fresh?: boolean
}

/**
 * The check, as `btid version` runs it.
 *
 * A cached answer younger than a day is used as-is; otherwise GitHub is asked once and the answer kept — including a
 * failure, so a machine that is offline for a week does not pay 800 ms on every command.
 */
export async function checkForUpdate(options: UpdateOptions): Promise<UpdateReading> {
  const env = options.env ?? process.env
  const current = options.current
  const now = options.now ?? Date.now()
  const repo = options.repo ?? REPO

  const unknown = (checkedAt: number | null): UpdateReading => ({ current, latest: null, newer: false, checkedAt })

  // Off is off: no cache read, no request, no notice.
  if (env['BTID_NO_UPDATE_CHECK'] === '1' || env['BTID_NO_UPDATE_CHECK'] === 'true') return unknown(null)

  const cached = options.cachePath === undefined ? null : readUpdateCache(readFile(options.cachePath))
  if (!options.fresh && cached !== null && now - cached.checkedAt < CHECK_WINDOW_MS) {
    return {
      current,
      latest: cached.latest,
      newer: cached.latest !== null && compareVersions(cached.latest, current) > 0,
      checkedAt: cached.checkedAt,
    }
  }

  const latest = await fetchLatest(repo, options.fetchImpl ?? fetch, TIMEOUT_MS)
  if (options.cachePath !== undefined) writeFile(options.cachePath, writeUpdateCache({ checkedAt: now, latest }))
  return {
    current,
    latest,
    newer: latest !== null && compareVersions(latest, current) > 0,
    checkedAt: now,
  }
}

/**
 * What `btid version` prints about it: nothing when this copy is current, two lines when it is not.
 *
 * A function rather than three `out.line` calls in the verb, so the wording is testable without a terminal.
 */
export function updateNotice(reading: UpdateReading): string[] {
  if (!reading.newer || reading.latest === null) return []
  return [
    `latest  ${reading.latest} is available (this copy is ${reading.current})`,
    `        npm i -g ${INSTALL_URL}`,
  ]
}
