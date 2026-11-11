/**
 * What goes to the terminal.
 *
 * Two shapes only: a table for a person, and JSON for a program — and the JSON is the core's own object, unprojected unless
 * `--fields` asked, so a script sees what the store holds rather than what a renderer decided to keep.
 */

export interface Output {
  line(text: string): void
  json(value: unknown): void
}

export const consoleOutput = (write: (text: string) => void = (text) => process.stdout.write(text)): Output => ({
  line: (text) => write(`${text}\n`),
  json: (value) => write(`${JSON.stringify(value)}\n`),
})

/** A column: its heading, and how one row reads in it. */
export interface Column<TRow> {
  title: string
  value: (row: TRow) => string
}

/** Columns as a table, padded to the widest cell, with a blank line before it when it is not the first thing printed. */
export function table<TRow>(rows: readonly TRow[], columns: readonly Column<TRow>[]): string {
  if (rows.length === 0) return 'no rows'
  const cells = rows.map((row) => columns.map((column) => column.value(row)))
  const widths = columns.map((column, at) =>
    Math.max(column.title.length, ...cells.map((line) => line[at]?.length ?? 0)),
  )
  const pad = (text: string, width: number): string => text.padEnd(width, ' ')
  const heading = columns.map((column, at) => pad(column.title, widths[at]!)).join('  ').trimEnd()
  const body = cells.map((line) => line.map((cell, at) => pad(cell, widths[at]!)).join('  ').trimEnd())
  return [heading, ...body].join('\n')
}

/** `2026-11-13T17:00` or `2026-11-13` as the day a person reads; anything else unchanged. */
export const dayOf = (value: string | null): string => (value === null ? '—' : value.slice(0, 10))

/** A percentage as the app writes it. */
export const percentOf = (value: number): string => `${value}%`

/** `owner/repo@ref`, so a session can say which store it is pointed at. */
export const describeStore = (store: { owner: string; repo: string; ref: string }): string =>
  `${store.owner}/${store.repo}@${store.ref}`
