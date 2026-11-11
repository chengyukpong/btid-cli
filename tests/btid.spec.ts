import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'vitest'
import { EXPECT } from 'btid-core'
import { run } from '../src/cli'
import { consoleOutput } from '../src/output'
import { FakeClient, Lines } from './support'

// The CLI's whole claim is that it holds no rules: every refusal below is the core's sentence, and the exit code is the
// only thing this project decides. So the tests drive `run` — the real dispatcher, the real core — against a fake
// repository, and assert on the transcript.

const managerRow = {
  id: 'chengyukpong',
  displayName: 'Cheng',
  githubHandle: 'chengyukpong',
  role: 'manager',
  active: true,
  avatarUrl: null,
}

const project = {
  id: 'alpha',
  name: 'Alpha One',
  description: '',
  status: 'active',
  ownerId: 'chengyukpong',
  members: [],
  color: '#1867C0',
  labels: [],
  startDate: '2026-10-26',
  endDate: '2026-11-23',
  nextTaskNumber: 1,
  createdAt: '2026-11-01T09:00:00+08:00',
  updatedAt: '2026-11-01T09:00:00+08:00',
}

const task = (over: Record<string, unknown> = {}) => ({
  id: 'alpha-a1b2',
  taskId: 'alpha-a1b2',
  projectId: 'alpha',
  firstPromotedAt: '2026-11-01T09:00:00+08:00',
  title: 'Write the failing test',
  description: '',
  definitionOfDone: 'Both columns line up.',
  status: 'todo',
  priority: 'medium',
  assigneeId: 'chengyukpong',
  createdById: 'chengyukpong',
  percentComplete: 0,
  blocked: false,
  blockedReason: '',
  tracked: true,
  isSmall: false,
  startDate: '2026-11-09',
  endDate: '2026-11-13',
  estimateDays: 4,
  labels: [],
  blockedBy: [],
  comments: [],
  steps: [],
  activities: [],
  rev: 0,
  createdAt: '2026-11-01T09:00:00+08:00',
  updatedAt: '2026-11-01T09:00:00+08:00',
  updatedBy: 'chengyukpong',
  archivedAt: null,
  ...over,
})

let client: FakeClient
let lines: Lines

const btid = (argv: string[]) =>
  run({
    argv: ['--store', 'chengyukpong/btid-data', ...argv],
    env: { BTID_TOKEN: 'test-token' },
    out: consoleOutput((text) => lines.write(text)),
    clientFor: () => client,
    tokenFor: () => 'test-token',
    loginFor: async () => 'chengyukpong',
  })

describe('btid', () => {
  beforeEach(() => {
    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', { [managerRow.id]: managerRow })
    client.put('projects/alpha/project.json', { alpha: project })
    client.put('projects/alpha/tasks.json', { 'alpha-a1b2': task() })
    lines = new Lines()
  })

  it('lists tasks, in the columns a terminal wants', async () => {
    const code = await btid(['task', 'ls'])
    assert.equal(code, 0)
    assert.match(lines.text, /TASK ID|ID/)
    assert.match(lines.text, /Write the failing test/)
  })

  it('filters with the core’s own query grammar, and orders by the board sorts', async () => {
    client.put('projects/alpha/tasks.json', {
      'alpha-a1b2': task(),
      'alpha-c3d4': task({ id: 'alpha-c3d4', taskId: 'alpha-c3d4', status: 'in_progress', priority: 'high' }),
    })
    const code = await btid(['task', 'ls', 'status=in_progress'])
    assert.equal(code, 0)
    assert.match(lines.text, /alpha-c3d4/)
    assert.doesNotMatch(lines.text, /alpha-a1b2/)
  })

  it('refuses a query it could not read, rather than listing everything', async () => {
    const code = await btid(['task', 'ls', 'status=nonsense', '--json'])
    assert.equal(code, 1)
    assert.deepEqual(lines.json[0], {
      error: { kind: 'refused', code: 'QUERY_INVALID', message: 'status=nonsense is not a filter this build understands.' },
    })
  })

  it('prints one task with its steps and warnings', async () => {
    const code = await btid(['task', 'show', 'alpha-a1b2'])
    assert.equal(code, 0)
    assert.match(lines.text, /alpha-a1b2 {2}Write the failing test/)
    assert.match(lines.text, /status todo/)
  })

  it('says a task is gone instead of throwing', async () => {
    const code = await btid(['task', 'show', 'alpha-zzzz', '--json'])
    assert.equal(code, 1)
    assert.deepEqual(lines.json[0], {
      error: { kind: 'refused', code: 'TASK_NOT_FOUND', message: 'Task alpha-zzzz is not in the store.' },
    })
  })

  it('captures a task, in one commit named after it', async () => {
    const before = client.messages.length
    const code = await btid(['task', 'new', '--project', 'alpha', '--title', 'Check the header budgets'])
    assert.equal(code, 0)
    assert.equal(client.messages.length, before + 1)
    assert.match(client.messages.at(-1)!, /^capture alpha-/)
    assert.match(lines.text, /captured {2}alpha-/)
  })

  it('refuses a tracked end day moved without a note — the sentence is the core’s', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--end', '2026-11-20'])
    assert.equal(code, 1)
    assert.match(lines.text, /refused: Changing the end day of a tracked task needs a reason\. \(END_DATE_NEEDS_REASON\)/)
    assert.equal(client.messages.length, 0, 'nothing was committed')
  })

  it('takes the move when the note is given, and commits once', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--end', '2026-11-20', '--note', 'Client moved it.'])
    assert.equal(code, 0)
    assert.equal(client.messages.length, 1)
    assert.match(client.messages[0]!, /^edit alpha-a1b2/)
    assert.equal(client.json('projects/alpha/tasks.json')['alpha-a1b2']!['endDate'], '2026-11-20')
  })

  it('writes nothing with --dry-run, and says what it would have written', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--title', 'Renamed', '--dry-run'])
    assert.equal(code, 0)
    assert.match(lines.text, /would commit: edit alpha-a1b2/)
    assert.equal(client.messages.length, 0)
    assert.equal(client.json('projects/alpha/tasks.json')['alpha-a1b2']!['title'], 'Write the failing test')
  })

  it('refuses a member adding a project, in the manager’s words', async () => {
    client.put('people.json', { ...{ [managerRow.id]: { ...managerRow, role: 'member' } } })
    const code = await btid(['project', 'new', 'beta', 'Beta'])
    assert.equal(code, 1)
    assert.match(lines.text, /NOT_MANAGER|manager/)
  })

  it('lists the roster and the projects', async () => {
    assert.equal(await btid(['person', 'ls']), 0)
    assert.match(lines.text, /chengyukpong/)
    lines.written.length = 0
    assert.equal(await btid(['project', 'ls']), 0)
    assert.match(lines.text, /Alpha One/)
  })

  it('--json prints the row, not a rendering', async () => {
    await btid(['task', 'show', 'alpha-a1b2', '--json'])
    const row = lines.json[0] as Record<string, unknown>
    assert.equal(row['id'], 'alpha-a1b2')
    assert.equal(row['endDate'], '2026-11-13')
    assert.ok(Array.isArray(row['steps']))
  })

  it('--fields projects the table and the JSON the same way', async () => {
    await btid(['task', 'ls', '--fields', 'title,endDate', '--json'])
    assert.deepEqual(lines.json[0], [{ title: 'Write the failing test', endDate: '2026-11-13' }])

    lines.written.length = 0
    await btid(['task', 'ls', '--fields', 'title,length'])
    assert.equal(lines.written.length > 0, true)
  })

  it('an unknown --fields name is a usage error that lists what the rows have', async () => {
    const code = await btid(['task', 'ls', '--fields', 'nope'])
    assert.equal(code, 2)
    assert.match(lines.text, /nope/)
    assert.match(lines.text, /endDate/)
  })

  it('prints help, and the same registry as JSON', async () => {
    assert.equal(await btid(['help']), 0)
    assert.match(lines.text, /task ls/)
    lines.written.length = 0
    assert.equal(await btid(['help', '--json']), 0)
    const manifest = lines.json[0] as { verbs: { name: string }[]; exitCodes: unknown }
    assert.ok(manifest.verbs.some((verb) => verb.name === 'task edit'))
    assert.deepEqual(manifest.exitCodes, { ok: 0, refused: 1, usage: 2 })
  })

  it('publishes the field list in the manifest, read off the schemas the store validates with', async () => {
    assert.equal(await btid(['help', '--json']), 0)
    const manifest = lines.json[0] as {
      types: { type: string; fields: { name: string; type: string; required: boolean; values?: string[] }[] }[]
    }
    const task = manifest.types.find((entry) => entry.type === 'task')!
    const names = task.fields.map((field) => field.name)
    // The fields an agent is most likely to ask for, and one that proves the list is the schema's rather than a guess.
    for (const expected of ['taskId', 'status', 'endDate', 'blocked', 'percentComplete']) {
      assert.ok(names.includes(expected), `task fields are missing ${expected}`)
    }
    assert.equal(names.length, 29, 'the task row has 29 fields')
    assert.deepEqual(task.fields.find((field) => field.name === 'status')?.values, [
      'backlog',
      'todo',
      'in_progress',
      'done',
    ])
    const person = manifest.types.find((entry) => entry.type === 'person')!
    assert.ok(person.fields.some((field) => field.name === 'githubHandle'))
  })

  it('prints a type’s fields with btid help <type>', async () => {
    assert.equal(await btid(['help', 'task']), 0)
    assert.match(lines.text, /task fields \(29\)/)
    assert.match(lines.text, /endDate/)
    assert.match(lines.text, /required|optional/)
  })

  it('refuses without a store, naming the three ways to give one', async () => {
    const code = await run({ argv: ['task', 'ls'], env: {}, out: consoleOutput((text) => lines.write(text)) })
    assert.equal(code, 2)
    assert.match(lines.text, /--store owner\/repo/)
    assert.match(lines.text, /BTID_STORE/)
    assert.match(lines.text, /no default repository on purpose/)
  })

  it('a fault exits with the engine’s number, not a refusal’s', async () => {
    // No store in the repository: `openStore` raises NO_STORE, whose exit code is 5.
    client = new FakeClient()
    const code = await btid(['task', 'ls'])
    assert.equal(code, 5)
    assert.match(lines.text, /there is no store here/)
  })
})
