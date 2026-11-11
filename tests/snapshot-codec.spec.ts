import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { COMPRESS_ABOVE, decodeSnapshot, encodeSnapshot, isGzipped } from '../src/snapshot-codec'

// The file is JSON, gzipped only when that is worth it, and the format is read off the bytes rather than a flag — so a
// snapshot the previous build wrote still opens, and a hand-edited one is a miss rather than a crash.

describe('snapshot codec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'btid-codec-'))

  it('keeps a small snapshot plain, so it can be read with cat', () => {
    const small = { format: 1, commit: 'abc', rows: {}, seen: [] }
    const bytes = encodeSnapshot(small)
    assert.equal(isGzipped(bytes), false)
    assert.equal(bytes.toString('utf8'), JSON.stringify(small))
    assert.deepEqual(decodeSnapshot(bytes), small)
  })

  it('gzip a snapshot worth compressing, and read it back unchanged', () => {
    const rows = {
      tasks: Object.fromEntries(
        Array.from({ length: 40 }, (_, at) => [
          `alpha-${String(at).padStart(4, '0')}`,
          { id: `alpha-${at}`, title: `A task with a reasonably long title, number ${at}`, status: 'todo' },
        ]),
      ),
    }
    const big = { format: 1, commit: 'abc', rows, seen: [['projects/alpha/tasks.json', 'sha']] }

    const bytes = encodeSnapshot(big)
    assert.equal(isGzipped(bytes), true, 'above the threshold it is gzip')
    assert.ok(bytes.byteLength < JSON.stringify(big).length, 'and it is actually smaller')
    assert.deepEqual(decodeSnapshot(bytes), big)
  })

  it('tells the two apart by magic bytes, not by a flag', () => {
    const plain = Buffer.from('{"format":1}')
    const gzipped = encodeSnapshot({
      rows: {
        tasks: Object.fromEntries(
          Array.from({ length: 60 }, (_, at) => [`t${at}`, { at, title: `Task number ${at} with a title long enough to compress` }]),
        ),
      },
      seen: [],
    })
    assert.equal(isGzipped(plain), false)
    assert.equal(isGzipped(gzipped), true)
    assert.equal(COMPRESS_ABOVE, 2_048)
  })

  it('round-trips through a file, which is how the CLI uses it', () => {
    const path = join(dir, 'snapshot.json')
    const value = { format: 1, commit: 'abc', rows: { tasks: { t1: { id: 't1' } } }, seen: [] }
    writeFileSync(path, encodeSnapshot(value))
    assert.deepEqual(decodeSnapshot(readFileSync(path)), value)
  })

  it('throws on bytes that are not a snapshot, so the caller can treat it as a miss', () => {
    assert.throws(() => decodeSnapshot(Buffer.from('not json at all')))
    assert.throws(() => decodeSnapshot(Buffer.from([0x1f, 0x8b, 0x00])))
  })
})
