import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { EXPECT } from 'btid-core'
import { run } from '../src/cli'
import { consoleOutput } from '../src/output'
import { FakeClient, Lines } from './support'

// `impersonate` is what makes a seeded history *attributed*: the plan says who did the work, and the rows believe it. The
// runner used to refuse every identity-changing verb by name; these are the three things that must now be true instead.

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  displayName: id,
  githubHandle: id,
  role: 'member',
  active: true,
  avatarUrl: null,
  ...over,
})

const project = {
  id: 'alpha',
  name: 'alpha',
  description: '',
  status: 'active',
  ownerId: 'chengyukpong',
  members: ['chengyukpong', 'ivan-petrov', 'mei-tan'],
  color: '#18bf76',
  labels: [] as string[],
  startDate: '2026-11-02',
  endDate: '2026-11-30',
  createdAt: '2026-11-18T11:53:48.952+08:00',
  updatedAt: '2026-11-18T12:55:16.000+08:00',
}

type Row = { title: string; createdById: string; updatedBy: string }

let client: FakeClient
let lines: Lines
let workspace: string
let login = 'chengyukpong'

const btid = (argv: string[]) =>
  run({
    argv: ['--store', 'yuk-org/btid-ete-data', ...argv],
    env: { BTID_TOKEN: 'test-token' },
    out: consoleOutput((text) => lines.write(text)),
    clientFor: () => client,
    tokenFor: () => 'test-token',
    loginFor: async () => login,
    configPath: join(workspace, 'config.json'),
    cacheDir: workspace,
  })

const rows = (): Record<string, Row> =>
  JSON.parse(client.files.get('projects/alpha/tasks.json') ?? '{}') as Record<string, Row>

describe('impersonate in a plan', () => {
  beforeEach(() => {
    login = 'chengyukpong'
    workspace = mkdtempSync(join(tmpdir(), 'btid-as-'))
    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', {
      chengyukpong: person('chengyukpong', { role: 'manager' }),
      'ivan-petrov': person('ivan-petrov'),
      'mei-tan': person('mei-tan'),
    })
    client.put('projects/alpha/project.json', { alpha: project })
    lines = new Lines()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('attributes each write to the person the plan names, and hands the store back', async () => {
    const plan = [
      'advance store 2026-11-09T09:00:00+08:00',
      'impersonate person/ivan-petrov',
      'new task --project alpha --title "The policy"',
      'impersonate person/mei-tan',
      'new task --project alpha --title "The bundle"',
      'unimpersonate',
      'new task --project alpha --title "The cutover"',
    ].join('\n')
    const file = join(workspace, 'as.btid')
    writeFileSync(file, `${plan}\n`)

    const code = await btid(['plan', file])
    assert.equal(code, 0, lines.text)

    const byTitle = Object.fromEntries(Object.values(rows()).map((row) => [row.title, row.createdById]))
    assert.deepEqual(byTitle, {
      'The policy': 'ivan-petrov',
      'The bundle': 'mei-tan',
      'The cutover': 'chengyukpong',
    })
  })

  it('refuses the whole plan at the step where a member tries to act as somebody', async () => {
    login = 'ivan-petrov'
    const plan = [
      'impersonate person/mei-tan',
      'new task --project alpha --title "Somebody else\'s work"',
    ].join('\n')
    const file = join(workspace, 'member.btid')
    writeFileSync(file, `${plan}\n`)

    const code = await btid(['plan', file])
    assert.equal(code, 1)
    // The core's sentence and code, and the CLI's own line saying where it stopped.
    assert.match(lines.text, /only the manager can change who a write is attributed to/i)
    assert.match(lines.text, /\(NOT_MANAGER\)/)
    assert.match(lines.text, /no\s+1\s+impersonate person\/mei-tan\s+\(refused\)/)
    assert.equal(Object.keys(rows()).length, 0)
  })

  it('refuses somebody who is not on the roster', async () => {
    const code = await btid(['impersonate', 'person/nobody'])
    assert.equal(code, 1)
    // The core's sentence and code, verbatim: this front end adds a position, never a paraphrase.
    assert.match(lines.text, /Person nobody is not on the roster\./)
    assert.match(lines.text, /\(PERSON_NOT_FOUND\)/)
  })
})
