import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import {
  CHECK_WINDOW_MS,
  INSTALL_URL,
  checkForUpdate,
  compareVersions,
  parseReleaseTag,
  readUpdateCache,
  updateNotice,
  writeUpdateCache,
} from '../src/update'

// `btid version` says whether a newer release exists. The two things worth pinning: it must not ask more than once a
// day, and it must never turn a slow or dead network into a failed command.

const TAG_URL = 'https://github.com/chengyukpong/btid-cli/releases/tag/v0.22.0'

/** A fetch that answers like GitHub's redirect, and counts how often it was asked. */
function redirecting(location: string | null, calls: { count: number }): typeof fetch {
  return (async () => {
    calls.count += 1
    return new Response(null, { status: 302, headers: location === null ? {} : { location } })
  }) as unknown as typeof fetch
}

function failing(): typeof fetch {
  return (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
}

describe('the version comparison', () => {
  it('compares numerically, not as text', () => {
    assert.equal(compareVersions('0.22.0', '0.21.0'), 1)
    assert.equal(compareVersions('0.21.0', '0.22.0'), -1)
    assert.equal(compareVersions('0.21.0', '0.21.0'), 0)
    // 0.9 is older than 0.10: the classic string-comparison trap.
    assert.equal(compareVersions('0.10.0', '0.9.0'), 1)
  })

  it('does not call a pre-release an update over the stable one', () => {
    assert.equal(compareVersions('0.22.0-rc.1', '0.22.0'), 0)
  })

  it('reads the tag out of a release URL and nothing else', () => {
    assert.equal(parseReleaseTag(TAG_URL), '0.22.0')
    assert.equal(parseReleaseTag('https://github.com/o/r/releases/tag/0.22.0'), '0.22.0')
    assert.equal(parseReleaseTag('https://github.com/o/r/releases/tag/v0.22.0-rc.1'), '0.22.0-rc.1')
    assert.equal(parseReleaseTag('https://github.com/o/r/releases'), null)
    assert.equal(parseReleaseTag(null), null)
  })
})

describe('the cache', () => {
  it('round-trips, and treats anything unreadable as a miss', () => {
    const text = writeUpdateCache({ checkedAt: 1_700_000_000_000, latest: '0.22.0' })
    assert.deepEqual(readUpdateCache(text), { checkedAt: 1_700_000_000_000, latest: '0.22.0' })
    assert.equal(readUpdateCache(null), null)
    assert.equal(readUpdateCache('not json'), null)
    assert.equal(readUpdateCache('{"checkedAt":"yesterday","latest":"0.22.0"}'), null)
  })
})

describe('checking for an update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'btid-update-'))
  const cachePath = join(dir, 'update.json')

  it('asks GitHub once and keeps the answer for a day', async () => {
    const calls = { count: 0 }
    const first = await checkForUpdate({
      current: '0.21.0',
      cachePath,
      now: 1_700_000_000_000,
      fetchImpl: redirecting(TAG_URL, calls),
    })
    assert.deepEqual({ latest: first.latest, newer: first.newer }, { latest: '0.22.0', newer: true })
    assert.equal(calls.count, 1)

    // A second command inside the day uses the file: same answer, no request.
    const second = await checkForUpdate({
      current: '0.21.0',
      cachePath,
      now: 1_700_000_000_000 + CHECK_WINDOW_MS - 1,
      fetchImpl: redirecting(TAG_URL, calls),
    })
    assert.equal(second.latest, '0.22.0')
    assert.equal(calls.count, 1)
  })

  it('asks again once the day is over, or when asked to', async () => {
    const calls = { count: 0 }
    await checkForUpdate({
      current: '0.21.0',
      cachePath,
      now: 1_700_000_000_000 + CHECK_WINDOW_MS,
      fetchImpl: redirecting(TAG_URL, calls),
    })
    assert.equal(calls.count, 1)

    await checkForUpdate({ current: '0.21.0', cachePath, fresh: true, fetchImpl: redirecting(TAG_URL, calls) })
    assert.equal(calls.count, 2)
  })

  it('says nothing when the network is down, and does not keep asking', async () => {
    const quietCache = join(dir, 'offline.json')
    const reading = await checkForUpdate({ current: '0.21.0', cachePath: quietCache, now: 1, fetchImpl: failing() })
    assert.equal(reading.latest, null)
    assert.equal(reading.newer, false)
    assert.deepEqual(updateNotice(reading), [])

    // The failure is cached: the next command reads the file instead of waiting on the network again.
    assert.deepEqual(JSON.parse(readFileSync(quietCache, 'utf8')), { checkedAt: 1, latest: null })
  })

  it('is switched off entirely by BTID_NO_UPDATE_CHECK', async () => {
    const calls = { count: 0 }
    const reading = await checkForUpdate({
      current: '0.21.0',
      cachePath: join(dir, 'off.json'),
      env: { BTID_NO_UPDATE_CHECK: '1' },
      fetchImpl: redirecting(TAG_URL, calls),
    })
    assert.equal(calls.count, 0)
    assert.equal(reading.latest, null)
  })
})

describe('the notice', () => {
  it('prints the remote version and the one command that installs it', () => {
    const lines = updateNotice({ current: '0.21.0', latest: '0.22.0', newer: true, checkedAt: 0 })
    assert.equal(lines.length, 2)
    assert.match(lines[0] ?? '', /0\.22\.0 is available \(this copy is 0\.21\.0\)/)
    assert.equal(lines[1]?.trim(), `npm i -g ${INSTALL_URL}`)
  })

  it('says nothing when this copy is current, or when the answer is unknown', () => {
    assert.deepEqual(updateNotice({ current: '0.21.0', latest: '0.21.0', newer: false, checkedAt: 0 }), [])
    assert.deepEqual(updateNotice({ current: '0.21.0', latest: null, newer: false, checkedAt: 0 }), [])
  })
})
