import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { localIso, type LogEntry, type LogSink } from 'btid-core'

/**
 * Where the CLI's log goes.
 *
 * One line per interface call, tab-separated, because a log a person greps should not need a parser: `cut -f3` is the verbs, and
 * `column -t -s$'\t'` is a table. The fields are the core's — this file only decides how they read on a line and which file they
 * land in.
 */
export const formatEntry = (entry: LogEntry): string =>
  [entry.at, entry.actor, entry.verb, entry.subject, entry.result, `${String(entry.ms)}ms`, entry.detail].join('\t')

/** `20261115`, from a date's own day — local, because the person reading the file counts days in their timezone. */
export const dayKey = (at: Date): string =>
  `${String(at.getFullYear())}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`

/** The file's first line: when it was created, and what the columns are. Rotation reads the date back from here. */
export const headerFor = (at: Date): string =>
  [`# created ${dayKey(at)} ${localIso(at)}`, ['# at', 'actor', 'verb', 'subject', 'result', 'ms', 'detail'].join('\t')].join(
    '\n',
  )

/** The date a file was created, from its own header: the one fact a copy or a move preserves. */
export const createdOn = (path: string): string | null => {
  try {
    // A byte-order mark is what a Windows editor leaves behind, and `^` does not match through it: the file would fall back to
    // its birth date and rotate under the wrong day.
    const first = (readFileSync(path, 'utf8').split('\n', 1)[0] ?? '').replace(/^\uFEFF/, '')
    const match = /^# created (\d{8})/.exec(first)
    return match === null ? null : (match[1] ?? null)
  } catch {
    return null
  }
}

/**
 * `btid.log` → `btid-20261114.log` for a file created on the fourteenth.
 *
 * Never overwrites: a second rotation on a day whose archive already exists goes to `btid-20261114-2.log`, because losing an
 * archive to a filename clash would be the one failure this whole file exists to avoid.
 */
export const archiveName = (path: string, day: string): string => {
  const dir = dirname(path)
  const ext = extname(path)
  const stem = basename(path, ext)
  const base = `${stem}-${day}`
  let candidate = join(dir, `${base}${ext}`)
  let n = 1
  while (existsSync(candidate)) {
    n += 1
    candidate = join(dir, `${base}-${String(n)}${ext}`)
  }
  return candidate
}

/**
 * Move yesterday's `btid.log` aside before today's first line is written.
 *
 * The rule is the user's, and it is deliberately the simple one: **one live file**, dated archives. No size ceiling, no count to
 * keep, no compressed history — a log that needs a policy is a log nobody reads, and the shell can rotate a directory of dated
 * files any way its owner likes.
 *
 * The date comes from the file's own header where possible (`# created 20261114`), because that survives a copy or a restore;
 * a file with no header — one written by an earlier build — falls back to its birth time, and then to its modification time.
 */
export const rotateIfStale = (path: string, at: Date, warn: (text: string) => void): void => {
  if (!existsSync(path)) return
  let day = createdOn(path)
  if (day === null) {
    try {
      const stat = statSync(path)
      const born = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime
      day = dayKey(born)
    } catch {
      return
    }
  }
  if (day === dayKey(at)) return

  try {
    renameSync(path, archiveName(path, day))
  } catch (error) {
    // A file somebody else has open on Windows cannot be renamed. Losing the rotation is better than losing the log: the next
    // command tries again, and the file keeps its lines in the meantime.
    warn(`log rotation skipped: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

export const defaultLogPath = (dir: string): string => join(dir, 'btid.log')

export const stderrSink =
  (write: (text: string) => void): LogSink =>
  (entry) => {
    write(`${formatEntry(entry)}\n`)
  }

/**
 * A file sink that appends, rotates once a day, and **never fails a command**.
 *
 * A full disk, a read-only directory, a path somebody typed wrong: none of those are reasons to lose the table the user asked
 * for. The first failure says so once on stderr and the sink goes quiet for the rest of the process — warning on every line
 * would be its own kind of noise.
 */
export const fileSink = (path: string, warn: (text: string) => void, at: () => Date = () => new Date()): LogSink => {
  let ready = false
  let dead = false
  return (entry) => {
    if (dead) return
    try {
      if (!ready) {
        mkdirSync(dirname(path), { recursive: true })
        rotateIfStale(path, at(), warn)
        // The header belongs to the **file**, not to the process: one per file, written when the file is new or empty. A header
        // per invocation would put a "created" line in the middle of the day every time a command ran — which is exactly what the
        // first version did, and why the log read as a series of files glued together.
        const fresh = !existsSync(path) || statSync(path).size === 0
        if (fresh) appendFileSync(path, `${headerFor(at())}\n`)
        ready = true
      }
      appendFileSync(path, `${formatEntry(entry)}\n`)
    } catch (error) {
      dead = true
      warn(`--log-file ${path}: ${error instanceof Error ? error.message : String(error)} (logging off)\n`)
    }
  }
}

/** Two sinks, in the order given: `--verbose --log-file x` writes the same line to both. */
export const both =
  (...sinks: readonly LogSink[]): LogSink =>
  (entry) => {
    for (const sink of sinks) sink(entry)
  }
