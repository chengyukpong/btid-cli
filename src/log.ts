import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LogEntry, LogSink } from 'btid-core'

/**
 * Where the CLI's log goes.
 *
 * One line per interface call, tab-separated, because a log a person greps should not need a parser: `cut -f3` is the verbs, and
 * `column -t -s$'\t'` is a table. The fields are the core's — this file only decides how they read on a line and which file they
 * land in.
 */
export const formatEntry = (entry: LogEntry): string =>
  [entry.at, entry.actor, entry.verb, entry.subject, entry.result, `${String(entry.ms)}ms`, entry.detail].join('\t')

/** The first line of a new file, so a reader three weeks later knows what the columns are. */
export const HEADER = ['# at', 'actor', 'verb', 'subject', 'result', 'ms', 'detail'].join('\t')

/** `btid-20261115.log`: the local day, because the person reading it counts days in their own timezone. */
export const defaultLogPath = (dir: string, at: Date = new Date()): string => {
  const day = `${String(at.getFullYear())}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`
  return join(dir, `btid-${day}.log`)
}

export const stderrSink =
  (write: (text: string) => void): LogSink =>
  (entry) => {
    write(`${formatEntry(entry)}\n`)
  }

/**
 * A file sink that appends, and **never fails a command**.
 *
 * A full disk, a read-only directory, a path somebody typed wrong: none of those are reasons to lose the table the user asked
 * for. The first failure says so once on stderr and the sink goes quiet for the rest of the process — warning on every line
 * would be its own kind of noise.
 */
export const fileSink = (path: string, warn: (text: string) => void): LogSink => {
  let ready = false
  let dead = false
  return (entry) => {
    if (dead) return
    try {
      if (!ready) {
        mkdirSync(dirname(path), { recursive: true })
        appendFileSync(path, `${HEADER}\n`)
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
