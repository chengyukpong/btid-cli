import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * The snapshot file: JSON, gzipped when it is worth it.
 *
 * The SPA does this (`btid2/src/stores/snapshot.ts`): a store is a few hundred kilobytes of JSON and about a tenth of that on
 * disk. The same arithmetic holds here — a seeded store is comfortably over the threshold, and the cost is a millisecond of
 * `zlib` against the half second the snapshot exists to save.
 *
 * Two details keep it from being a format decision:
 *
 * - **Detection is by magic bytes, not by a flag.** gzip starts `1f 8b`; JSON starts `{` (or whitespace). So a file written by
 *   the previous build still reads, and a compressed file needs no companion field to explain itself.
 * - **Small snapshots stay plain.** Below the threshold, compressing saves a few hundred bytes and costs the ability to
 *   `cat` the file, which is exactly what somebody debugging a bad cache wants to do.
 */

const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

/** Files at or above this size are compressed. Below it, plain JSON is smaller than the gzip header it would need. */
export const COMPRESS_ABOVE = 2_048

/** The text to write for a snapshot: gzipped when it is large enough, plain JSON when it is not. */
export function encodeSnapshot(value: unknown): Buffer {
  const json = JSON.stringify(value)
  const raw = Buffer.from(json, 'utf8')
  if (raw.byteLength < COMPRESS_ABOVE) return raw
  return gzipSync(raw, { level: 6 })
}

/** True when a file on disk is gzip, decided by its two magic bytes. */
export const isGzipped = (data: Buffer): boolean =>
  data.byteLength >= 2 && data[0] === GZIP_MAGIC_0 && data[1] === GZIP_MAGIC_1

/**
 * Parse whatever `encodeSnapshot` wrote.
 *
 * Throws when the bytes are not a snapshot at all — the caller treats that as a cache miss, which is the right answer for a
 * truncated write or a file somebody edited by hand.
 */
export function decodeSnapshot(data: Buffer): unknown {
  const text = isGzipped(data) ? gunzipSync(data).toString('utf8') : data.toString('utf8')
  return JSON.parse(text) as unknown
}
