import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'vitest'
import { EXPECT } from 'btid-core'
import { CLI_VERSION } from '../src/version'
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
let workspace: string

/** Write a batch file and return its path. */
const batchFile = async (name: string, body: unknown): Promise<string> => {
  const { writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const path = join(workspace, name)
  await writeFile(path, JSON.stringify(body), 'utf8')
  return path
}

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
  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    workspace = await mkdtemp(join(tmpdir(), 'btid-batch-'))
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

  it('creates a project with a window, so the very next capture works', async () => {
    const code = await btid(['project', 'new', 'beta', 'Beta Two', '--start', '2026-11-02', '--end', '2026-11-30'])
    assert.equal(code, 0)
    assert.equal(client.json('projects/beta/project.json')['beta']!['startDate'], '2026-11-02')

    lines.written.length = 0
    const captured = await btid(['task', 'new', '--project', 'beta', '--title', 'First work'])
    assert.equal(captured, 0)
    assert.match(lines.text, /captured {2}beta-/)
  })

  it('refuses a window that ends before it starts, with the core’s sentence', async () => {
    const code = await btid(['project', 'new', 'beta', 'Beta', '--start', '2026-11-30', '--end', '2026-11-02'])
    assert.equal(code, 1)
    assert.match(lines.text, /PROJECT_WINDOW_INVALID/)
    assert.match(lines.text, /cannot end \(2026-11-02\) before it starts/)
    assert.equal(client.messages.length, 0)
  })

  it('gives an existing project its window with project edit, in one commit', async () => {
    const code = await btid(['project', 'edit', 'alpha', '--start', '2026-11-02', '--end', '2026-11-30'])
    assert.equal(code, 0)
    assert.equal(client.messages.length, 1)
    assert.match(client.messages[0]!, /^project edit alpha/)
    const project = client.json('projects/alpha/project.json')['alpha']!
    assert.equal(project['startDate'], '2026-11-02')
    assert.equal(project['endDate'], '2026-11-30')
  })

  it('says a project is gone instead of throwing', async () => {
    const code = await btid(['project', 'edit', 'nope', '--name', 'Anything'])
    assert.equal(code, 1)
    assert.match(lines.text, /PROJECT_NOT_FOUND/)
  })

  it('captures a list of tasks in one commit, from --file', async () => {
    const path = await batchFile('tasks.json', [
      { projectId: 'alpha', title: 'One' },
      { projectId: 'alpha', title: 'Two', priority: 'urgent' },
      { projectId: 'alpha', title: 'Three', assigneeId: 'chengyukpong' },
    ])
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages.length, 1, 'one commit for three tasks')
    assert.equal(client.messages[0], 'capture 3 tasks')
    assert.equal(Object.keys(client.json('projects/alpha/tasks.json')).length, 4, 'the fixture row plus three')
    assert.match(lines.text, /3 tasks in one commit/)
  })

  it('fills the project in from --project for a file that omits it', async () => {
    const path = await batchFile('titles.json', [{ title: 'One' }, { title: 'Two' }])
    const code = await btid(['task', 'new', '--project', 'alpha', '--file', path])
    assert.equal(code, 0)
    assert.equal(client.messages[0], 'capture 2 tasks')
  })

  it('says which item refused, and commits nothing at all', async () => {
    const path = await batchFile('bad.json', [
      { projectId: 'alpha', title: 'One' },
      { projectId: 'alpha', title: '   ' },
      { projectId: 'alpha', title: 'Three' },
    ])
    const at = client.messages.length
    const code = await btid(['task', 'new', '--file', path, '--json'])
    assert.equal(code, 1, lines.text)
    assert.deepEqual(lines.json[0], {
      error: { kind: 'refused', code: 'TITLE_REQUIRED', message: 'A task needs a title.', at: 2 },
    })
    assert.equal(client.messages.length, at, 'nothing was committed')
    assert.equal(Object.keys(client.json('projects/alpha/tasks.json')).length, 1, 'not even item 1 was written')
  })

  it('prints item N in the human refusal too', async () => {
    const path = await batchFile('bad2.json', [{ projectId: 'nope', title: 'Two' }])
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 1)
    assert.match(lines.text, /refused: item 1: Project nope is not in the store\. \(PROJECT_MISSING\)/)
  })

  it('starts a list of projects in one commit, each ready to take work', async () => {
    const path = await batchFile('projects.json', [
      { id: 'beta', name: 'Beta Two', startDate: '2026-11-02', endDate: '2026-11-30' },
      { id: 'gamma', name: 'Gamma Three', startDate: '2026-11-02', endDate: '2026-11-30' },
    ])
    const code = await btid(['project', 'new', '--file', path])
    assert.equal(code, 0)
    assert.equal(client.messages[0], 'start 2 projects')

    lines.written.length = 0
    const captured = await btid(['task', 'new', '--project', 'gamma', '--title', 'Work'])
    assert.equal(captured, 0, 'a project from the batch can take work immediately')
  })

  it('adds a roster in one commit, and refuses a duplicate inside it', async () => {
    const path = await batchFile('people.json', [
      { login: 'ada.lovelace', displayName: 'Ada Lovelace' },
      { login: 'grace', displayName: 'Grace Hopper' },
    ])
    assert.equal(await btid(['person', 'new', '--file', path]), 0, lines.text)
    assert.equal(client.messages[0], 'add 2 people')

    const again = await batchFile('people2.json', [
      { login: 'newcomer', displayName: 'Newcomer' },
      { login: 'ada.lovelace', displayName: 'Ada again' },
    ])
    lines.written.length = 0
    const code = await btid(['person', 'new', '--file', again, '--json'])
    assert.equal(code, 1, lines.text)
    const error = (lines.json[0] as { error: { code: string; at: number } }).error
    assert.equal(error.code, 'PERSON_EXISTS')
    assert.equal(error.at, 2)
  })

  it('accepts {"items": [...]} as well as a bare array', async () => {
    const path = await batchFile('wrapped.json', { items: [{ projectId: 'alpha', title: 'One' }] })
    assert.equal(await btid(['task', 'new', '--file', path]), 0)
    assert.equal(client.messages[0], 'capture 1 task')
  })

  it('refuses a file that is one object, and names the two shapes', async () => {
    const path = await batchFile('single.json', { projectId: 'alpha', title: 'One' })
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 2)
    assert.match(lines.text, /must be a JSON array of items, or an object with an "items" array/)
  })

  it('writes nothing with --file and --dry-run', async () => {
    const path = await batchFile('dry.json', [{ projectId: 'alpha', title: 'One' }, { projectId: 'alpha', title: 'Two' }])
    const code = await btid(['task', 'new', '--file', path, '--dry-run'])
    assert.equal(code, 0)
    assert.match(lines.text, /would capture/)
    assert.equal(client.messages.length, 0)
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

  it('says which btid it is, and which schema it speaks', async () => {
    assert.equal(await btid(['version']), 0)
    assert.match(lines.text, /^btid \d+\.\d+\.\d+ · btid-core schema v1 · manifest 1/)

    lines.written.length = 0
    assert.equal(await btid(['version', '--json']), 0)
    assert.deepEqual(lines.json[0], { btid: CLI_VERSION, coreSchema: EXPECT, manifest: 1 })
  })

  it('takes --version as the same question, and answers it without a store', async () => {
    const code = await run({
      argv: ['--version'],
      env: {},
      out: consoleOutput((text) => lines.write(text)),
    })
    assert.equal(code, 0)
    assert.match(lines.text, /^btid \d+\.\d+\.\d+/)
  })

  it('keeps the version it prints in step with package.json', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    assert.equal(CLI_VERSION, pkg.version, 'src/version.ts and package.json must agree')
  })

  it('publishes the field list in the manifest, read off the schemas the store validates with', async () => {
    assert.equal(await btid(['help', '--json']), 0)
    const manifest = lines.json[0] as {
      version: string
      manifest: number
      types: { type: string; fields: { name: string; type: string; required: boolean; values?: string[] }[] }[]
    }
    assert.equal(manifest.version, CLI_VERSION)
    assert.equal(manifest.manifest, 1)
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
