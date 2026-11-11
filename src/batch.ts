import { readFileSync } from 'node:fs'

/**
 * Batch input: the same fields one verb takes, a list of them, and one commit.
 *
 * A seed is the reason this exists. A store is not useful until a project, a roster and a dozen tasks are in it, and a CLI
 * that needs sixteen processes to answer that is a CLI an agent will get wrong. The shape is deliberately the *command's*
 * input — no ids, no timestamps, no owner — because those are the store's to mint.
 */

/** One item, as the file holds it: the verb's own flags, spelled as the row's fields. */
export type BatchItem = Record<string, unknown>

export class BatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BatchError'
  }
}

/**
 * Read a batch from a path, or from stdin for `-`.
 *
 * Accepted shapes: a bare array, or `{"items": [...]}`. Anything else is refused rather than guessed: a file that is one
 * object is a mistake someone will make, and the message says which two shapes exist.
 */
export function readBatch(path: string): BatchItem[] {
  const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new BatchError(`--file ${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
      ? ((parsed as { items: unknown[] }).items as unknown[])
      : null

  if (list === null) {
    throw new BatchError(
      `--file ${path} must be a JSON array of items, or an object with an "items" array. ` +
        'One item is still a one-element array.',
    )
  }
  if (list.length === 0) throw new BatchError(`--file ${path} holds no items.`)

  return list.map((item, at) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new BatchError(`--file ${path}: item ${at + 1} is not an object.`)
    }
    return item as BatchItem
  })
}

/** A string field of an item, trimmed; absent and blank both mean "not given". */
export const textOf = (item: BatchItem, key: string): string | null => {
  const value = item[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** A number field of an item, or null when absent. */
export const numberOf = (item: BatchItem, key: string): number | null => {
  const value = item[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** True when the item carries a key at all — used to distinguish "unchanged" from "cleared". */
export const has = (item: BatchItem, key: string): boolean => Object.prototype.hasOwnProperty.call(item, key)
