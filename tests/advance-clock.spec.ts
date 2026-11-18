import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it } from 'vitest'
import { EXPECT } from 'btid-core'
import { run } from '../src/cli'
import { consoleOutput } from '../src/output'
import { FakeClient, Lines } from './support'

// A seeded history is the one thing a plan can do that a single verb cannot: a plan shares one open store across its
// steps, so `advance store` moves the clock the following steps stamp with. This test is the shape of a demo store.

const managerRow = {
  id: 'chengyukpong',
  displayName: 'Cheng',
  githubHandle: 'chengyukpong',
  role: 'manager',
  active: true,
  avatarUrl: null,
}

const ivanRow = {
  id: 'ivan',
  displayName: 'Ivan',
  githubHandle: 'ivan',
  role: 'member',
  active: true,
  avatarUrl: null,
}

const project = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'active',
  ownerId: 'chengyukpong',
  members: ['ivan', 'chengyukpong'],
  color: '#1867C0',
  labels: [],
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  createdAt: '2026-09-01T09:00:00+08:00',
  updatedAt: '2026-09-01T09:00:00+08:00',
}

let client: FakeClient
let lines: Lines
let workspace: string

const btid = (argv: string[]) =>
  run({
    argv: ['--store', 'chengyukpong/btid-data', ...argv],
    env: { BTID_TOKEN: 'test-token' },
    out: consoleOutput((text) => lines.write(text)),
    clientFor: () => client,
    tokenFor: () => 'test-token',
    loginFor: async () => 'chengyukpong',
    configPath: join(workspace, 'config.json'),
    cacheDir: workspace,
  })

/** The task rows as the fake repository holds them, which is what a later `openStore` would read. */
const rows = (): Record<string, { activities?: { day: string }[]; createdAt?: string }> =>
  JSON.parse(client.files.get('projects/alpha/tasks.json') ?? '{}') as Record<
    string,
    { activities?: { day: string }[]; createdAt?: string }
  >

describe('a plan that seeds a week', () => {
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'btid-seed-'))
    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', { [managerRow.id]: managerRow, [ivanRow.id]: ivanRow })
    client.put('projects/alpha/project.json', { alpha: project })
    lines = new Lines()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('stamps each step with the day the plan says it happened', async () => {
    const plan = [
      '# A week of work, written in one run.',
      'advance store 2026-09-11T09:12:00+08:00',
      'let t = new task --project alpha --title "Cut the release"',
      'edit task/$t.id --assignee ivan --start 2026-09-14 --end 2026-09-18 --estimate 3 --dod "It ships."',
      'advance store 2026-09-12T10:40:00+08:00',
      'promote task/$t.id',
      'advance store 2026-09-13T14:05:00+08:00',
      'new task/$t.id/step --name "Write the notes"',
    ].join('\n')
    const file = join(workspace, 'seed.btid')
    writeFileSync(file, `${plan}\n`)

    const code = await btid(['plan', file])
    assert.equal(code, 0, lines.text)

    // Both clock steps ran, in the order the plan gives them.
    assert.match(lines.text, /ok\s+1\s+advance store/)
    assert.match(lines.text, /ok\s+4\s+advance store/)

    const [row] = Object.values(rows())
    assert.ok(row !== undefined)
    // Created on the 11th, promoted on the 12th, a step added on the 13th: three days, not one.
    assert.equal(row.createdAt, '2026-09-11T09:12:00.000+08:00')
    assert.deepEqual(
      (row.activities ?? []).map((entry) => entry.day),
      ['2026-09-11', '2026-09-12', '2026-09-13'],
    )
  })

  it('refuses a plan that walks its own clock backwards, and says which step', async () => {
    const plan = [
      'advance store 2026-09-12T10:40:00+08:00',
      'advance store 2026-09-11T10:40:00+08:00',
    ].join('\n')
    const file = join(workspace, 'backwards.btid')
    writeFileSync(file, `${plan}\n`)

    const code = await btid(['plan', file])
    assert.equal(code, 1)
    // The core's sentence, and the CLI's own line saying where it was refused.
    assert.match(lines.text, /time moves forward/i)
    assert.match(lines.text, /no\s+2\s+advance store\s+\(refused\)/)
  })

  it('refuses an instant that is not one', async () => {
    const code = await btid(['advance', 'store', 'next tuesday'])
    assert.equal(code, 1)
    assert.match(lines.text, /is not a moment this store can read/i)
  })

  it('asks for the argument rather than guessing a day', async () => {
    const code = await btid(['advance', 'store'])
    assert.equal(code, 2)
    assert.match(lines.text, /usage: btid advance store 2026-09-12T10:40:00\+08:00/)
  })
})
