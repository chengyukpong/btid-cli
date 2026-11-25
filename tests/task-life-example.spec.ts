import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { EXPECT } from '@chengyukpong/btid-core'
import { run } from '../src/cli'
import { consoleOutput } from '../src/output'
import { FakeClient, Lines } from './support'

// The example in `examples/task-life.btid` is documentation, and documentation that does not run is a lie. This test is the
// one that keeps it honest: it runs the shipped file against a seeded store and asserts the history it produced.

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

type Row = {
  status: string
  percentComplete: number
  blocked: boolean
  blockedReason: string
  createdAt: string
  firstPromotedAt: string | null
  activities: { day: string; steps: { step: string; name: string; state: string }[] }[]
  steps: { id: string; name: string; done: boolean; doneAt: string | null }[]
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

const rows = (): Record<string, Row> =>
  JSON.parse(client.files.get('projects/alpha/tasks.json') ?? '{}') as Record<string, Row>

describe('examples/task-life.btid', () => {
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'btid-life-'))
    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', { [managerRow.id]: managerRow, [ivanRow.id]: ivanRow })
    client.put('projects/alpha/project.json', { alpha: project })
    lines = new Lines()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('runs, and leaves the history it describes', async () => {
    // The shipped file, copied into the workspace as the CLI would receive it.
    const plan = join(workspace, 'task-life.btid')
    cpSync(new URL('../examples/task-life.btid', import.meta.url), plan)

    const code = await btid(['plan', plan])
    assert.equal(code, 0, lines.text)

    const [row] = Object.values(rows())
    assert.ok(row !== undefined)

    // One row, eight days, in order — the point of the exercise.
    assert.deepEqual(
      row.activities.map((entry) => entry.day),
      ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19'],
    )
    assert.equal(row.createdAt, '2026-09-11T09:12:00.000+08:00')
    assert.equal(row.firstPromotedAt, '2026-09-12T10:40:00.000+08:00')
    assert.equal(row.status, 'done')
    assert.equal(row.percentComplete, 100)
    assert.deepEqual(row.steps.map((step) => step.name), [
      'Write the notes',
      'Tag the build',
      'Announce it',
      'Thank the reviewer',
    ])
    assert.deepEqual(row.steps.map((step) => step.done), [true, true, true, true])

    // Each tick lands on the day it happened, and names the step it was for — the 13th's step ticked on the 15th, while
    // three later steps already existed. That is the whole point of binding the write: the tick is not "the last step".
    const stepsOn = (day: string) => row.activities.find((entry) => entry.day === day)?.steps ?? []
    assert.deepEqual(stepsOn('2026-09-15').map((step) => [step.name, step.state]), [['Write the notes', 'ticked']])
    assert.equal(stepsOn('2026-09-15')[0]?.step, row.steps[0]?.id)
    assert.deepEqual(stepsOn('2026-09-18').map((step) => step.name), ['Tag the build'])
    assert.deepEqual(stepsOn('2026-09-19').map((step) => step.name), ['Announce it', 'Thank the reviewer'])

    // Each finished step says the day it finished — the row's own answer, not only the activity log's.
    assert.deepEqual(
      row.steps.map((step) => step.doneAt?.slice(0, 10)),
      ['2026-09-15', '2026-09-18', '2026-09-19', '2026-09-19'],
    )

    // And the block was lifted on the 18th, so the reason went with it: a finished row does not still say why it was stuck.
    assert.equal(row.blocked, false)
    assert.equal(row.blockedReason, '')
  })

  it('ticks the step it names, not the last one added', async () => {
    const plan = [
      'advance store 2026-09-11T09:00:00+08:00',
      'let t = new task --project alpha --title "Two steps"',
      'let first = new task/$t.id/step --name "First"',
      'let second = new task/$t.id/step --name "Second"',
      // The later step first, then the earlier one: a binding that quietly meant "the last added" would fail here.
      'advance store 2026-09-12T09:00:00+08:00',
      'tick task/$t.id/step/$second.id',
      'advance store 2026-09-13T09:00:00+08:00',
      'tick task/$t.id/step/$first.id',
    ].join('\n')
    const file = join(workspace, 'two-steps.btid')
    writeFileSync(file, `${plan}\n`)

    const code = await btid(['plan', file])
    assert.equal(code, 0, lines.text)

    const [row] = Object.values(rows())
    assert.ok(row !== undefined)
    assert.deepEqual(row.steps.map((step) => [step.name, step.done]), [
      ['First', true],
      ['Second', true],
    ])
    const stepsOn = (day: string) => row.activities.find((entry) => entry.day === day)?.steps ?? []
    assert.deepEqual(stepsOn('2026-09-12').map((step) => step.name), ['Second'])
    assert.deepEqual(stepsOn('2026-09-13').map((step) => step.name), ['First'])
  })
})
