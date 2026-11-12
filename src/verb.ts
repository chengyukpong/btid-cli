import type { Store } from 'btid-core'
import type { CommandResult } from 'btid-core'
import type { Output } from './output'
import { table, type Column } from './output'

/**
 * What a verb is, and what it may do.
 *
 * A verb is `parse → one core call → print`. It may not decide a rule: everything that could refuse is the core's, and the
 * verb's only job with a refusal is to print its sentence and exit 1. `usage` is the exception — a flag the verb cannot
 * parse is the terminal's business, and it exits 2.
 */

export interface VerbContext {
  store: Store
  /** Where the store is: `whoami` says it, and nothing else needs to. */
  location: { owner: string; repo: string; ref: string }
  /** Which of the three sources named it. */
  source: 'flag' | 'env' | 'file'
  /** Where snapshots live — the default for this machine, or wherever a test pointed it. */
  cacheDir: string
  /**
   * The commit the verb made, set by its one `commit()` call.
   *
   * `null` when there was nothing to write (the engine says so), `undefined` when the verb did not write at all. The
   * dispatcher uses it to keep the snapshot current instead of throwing it away — a write has the new head in hand, which is
   * the one moment the cache can be refreshed for free.
   */
  committed?: string | null
  /**
   * What the step produced, set by the verb itself: the row a create or edit wrote, the row a removal removed.
   *
   * This is what `let` binds in a plan — a result, not an id — so `$task.id` reads a field of a real row rather than a string
   * the plan invented.
   */
  result?: unknown
  /**
   * Set by a plan running with `--commit=end`: the commit is not made, its message is kept here, and one commit carries them
   * all when the last step succeeds.
   */
  defer?: string[]
  /** Whatever followed the verb, positionally. */
  args: readonly string[]
  /** `--flag value`, `--flag=value`, and bare `--flag` as `true`. */
  flags: Readonly<Record<string, string | boolean>>
  out: Output
  /** True when `--json` was given: every verb must honour it. */
  json: boolean
}

export interface Verb {
  /** `task ls`, `store init` — what a person types. */
  name: string
  /** One line, for `btid help`. */
  summary: string
  /** For `btid help <verb>`, and for the manifest an agent reads. */
  usage: string
  /** Named flags, with whether they take a value. Anything else is a usage error. */
  flags?: Readonly<Record<string, 'value' | 'boolean'>>
  /** Reads run without a token when the store can be opened anonymously; writes always need one. */
  writes?: boolean
  run(context: VerbContext): Promise<number>
}

/** Print a refusal and return the exit code. The sentence is the core's; this only chooses the number. */
export function refusal<T>(
  result: CommandResult<T>,
  out: Output,
  json: boolean,
  options: { index?: boolean } = {},
): number {
  if (result.ok) return 0
  // A batch refusal carries `at`, and it is printed the way a person reads a list — "item 2" — because the alternative is
  // somebody bisecting a JSON file to find which line the store objected to. A one-item edit is not a list, so the caller can
  // ask for the sentence alone.
  const at = options.index === false ? undefined : (result as { at?: number }).at
  if (json) {
    out.json({
      error: {
        kind: 'refused',
        code: result.code,
        message: result.reason,
        ...(at === undefined ? {} : { at }),
      },
    })
  } else {
    out.line(`refused: ${at === undefined ? '' : `item ${at}: `}${result.reason} (${result.code})`)
  }
  return 1
}

/** A usage mistake: the terminal's, not the store's. */
export function usage(message: string, out: Output, json: boolean): number {
  if (json) out.json({ error: { kind: 'usage', message } })
  else out.line(`usage: ${message}`)
  return 2
}

/** `--fields title,status` selects columns; the names are the row's own, in camelCase. */
export function fieldsOf(flags: Readonly<Record<string, string | boolean>>): string[] | null {
  const raw = flags['fields']
  if (typeof raw !== 'string' || raw.trim() === '') return null
  return raw
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field !== '')
}

/**
 * The columns for `--fields`, read off the rows rather than a list kept here: a field that exists in the core is a field
 * this CLI can print the day it lands.
 */
export function columnsFor<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  fields: readonly string[] | null,
  defaults: readonly Column<TRow>[],
): { columns: Column<TRow>[]; unknown: string | null } {
  if (fields === null || fields.length === 0) return { columns: [...defaults], unknown: null }
  const sample = rows[0]
  if (sample === undefined) {
    // Nothing to read the shape off; accept the names and print an empty table.
    return { columns: fields.map((field) => ({ title: field, value: () => '' })), unknown: null }
  }
  const known = new Set(Object.keys(sample))
  const unknown = fields.find((field) => !known.has(field))
  if (unknown !== undefined) return { columns: [], unknown }
  return {
    columns: fields.map((field) => ({
      title: field,
      value: (row) => render((row as Record<string, unknown>)[field]),
    })),
    unknown: null,
  }
}

/** A cell: null and undefined are a dash, objects are JSON, everything else its own text. */
export const render = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Print rows as a table, or as JSON when asked. */
export function printRows<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  fields: readonly string[] | null,
  defaults: readonly Column<TRow>[],
  out: Output,
  json: boolean,
): number {
  const { columns, unknown } = columnsFor(rows, fields, defaults)
  if (unknown !== null) {
    const known = rows[0] === undefined ? '(no rows to read the shape from)' : Object.keys(rows[0]).join(', ')
    return usage(`--fields names “${unknown}”, which these rows do not have. They have: ${known}`, out, json)
  }
  if (json) {
    out.json(
      fields === null
        ? rows
        : rows.map((row) => Object.fromEntries(fields.map((field) => [field, (row as Record<string, unknown>)[field]]))),
    )
    return 0
  }
  out.line(table(rows, columns))
  return 0
}
