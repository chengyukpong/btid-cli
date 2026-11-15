import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, it } from 'vitest'
import type { LogEntry } from 'btid-core'
import { fileSink } from '../src/log'

// One live file, dated archives: `btid.log` today, `btid-20261114.log` once tomorrow's first line arrives. The rule is the user's
// and it is deliberately the simple one — no size ceiling, no count to keep — so the tests are about the two ways a simple
// rotator goes wrong: renaming something that was not yesterday's, and losing an archive to a name clash.

const entry = (detail: string): LogEntry => ({
  at: new Date().toISOString(),
  actor: 'chengyukpong',
  verb: 'commit',
  subject: 'store x/y',
  result: 'ok',
  ms: 3,
  detail,
})

const on = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h, 0, 0)

describe('the log rotator', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btid-rotate-'))
    path = join(dir, 'btid.log')
  })

  it('renames yesterday’s file to its own day, and today starts a fresh btid.log', () => {
    writeFileSync(path, '# created 20261114 2026-11-14T09:00:00Z\n# at\ta\nyesterday’s line\n')

    fileSink(path, () => undefined, () => on(2026, 11, 15, 19))(entry('today’s first line'))

    const archive = join(dir, 'btid-20261114.log')
    assert.equal(existsSync(archive), true, 'the old file is kept, under its own date')
    assert.match(readFileSync(archive, 'utf8'), /yesterday’s line/)

    const today = readFileSync(path, 'utf8')
    assert.match(today, /^# created 20261115/)
    assert.match(today, /today’s first line/)
    assert.equal(today.includes('yesterday’s line'), false, 'the live file holds today only')
  })

  it('leaves a file created today alone, and appends to it', () => {
    const sink = fileSink(path, () => undefined, () => on(2026, 11, 15, 9))
    sink(entry('before'))
    sink(entry('after'))

    assert.equal(existsSync(join(dir, 'btid-20261115.log')), false)
    const written = readFileSync(path, 'utf8')
    assert.equal(written.match(/# created/g)?.length, 1, 'one header, one file')
    assert.match(written, /before[\s\S]*after/)
  })

  it('never overwrites an archive: a clash gets a -2', () => {
    writeFileSync(path, '# created 20261114\nold line\n')
    writeFileSync(join(dir, 'btid-20261114.log'), '# created 20261114\nan earlier archive\n')

    fileSink(path, () => undefined, () => on(2026, 11, 15, 8))(entry('new'))

    assert.match(readFileSync(join(dir, 'btid-20261114.log'), 'utf8'), /an earlier archive/)
    assert.match(readFileSync(join(dir, 'btid-20261114-2.log'), 'utf8'), /old line/)
  })

  it('judges a file with no created line by its own dates, and keeps its lines', () => {
    // Written a moment ago, so its birth date is today: nothing to rotate, nothing lost.
    writeFileSync(path, '# at\ta\nfrom an older build\n')

    fileSink(path, () => undefined, () => on(2026, 11, 15, 12))(entry('after'))

    assert.equal(existsSync(join(dir, 'btid-20261115.log')), false)
    const written = readFileSync(path, 'utf8')
    assert.match(written, /from an older build/)
    assert.match(written, /after/)
  })

  it('turns rotation off, not the command, when the file cannot be renamed or written', () => {
    const warned: string[] = []
    // A directory where the file should be: appending fails on the first entry.
    const blocked = join(dir, 'not-a-file')
    writeFileSync(blocked, 'a file, not a directory')

    const sink = fileSink(join(blocked, 'btid.log'), (text) => warned.push(text), () => on(2026, 11, 15, 12))
    sink(entry('first'))
    sink(entry('second'))

    assert.equal(warned.length, 1, 'one warning, then silence')
    assert.match(warned[0] ?? '', /logging off/)
  })
})
