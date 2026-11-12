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
const { join } = require('node:path') as typeof import('node:path')

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
    configPath: join(workspace, 'config.json'),
    cacheDir: workspace,
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

  it('takes a single object as a one-item list', async () => {
    const path = await batchFile('single.json', { projectId: 'alpha', title: 'One' })
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages[0], 'capture 1 task')
  })

  it('still prefers the wrapper when an object has an "items" array', async () => {
    const path = await batchFile('wrapped-two.json', {
      items: [
        { projectId: 'alpha', title: 'One' },
        { projectId: 'alpha', title: 'Two' },
      ],
    })
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages[0], 'capture 2 tasks')
  })

  it('takes a single edit as one object too', async () => {
    const path = await batchFile('one-edit.json', { id: 'alpha-a1b2', patch: { percentComplete: 30 } })
    const code = await btid(['task', 'edit', '--file', path])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages[0], 'edit alpha-a1b2')
    assert.equal(client.json('projects/alpha/tasks.json')['alpha-a1b2']!['percentComplete'], 30)
  })

  it('refuses an empty list, because a file with nothing in it is a mistake', async () => {
    const path = await batchFile('empty.json', [])
    const code = await btid(['task', 'new', '--file', path])
    assert.equal(code, 2)
    assert.match(lines.text, /holds no items/)
  })

  it('writes nothing with --file and --dry-run', async () => {
    const path = await batchFile('dry.json', [{ projectId: 'alpha', title: 'One' }, { projectId: 'alpha', title: 'Two' }])
    const code = await btid(['task', 'new', '--file', path, '--dry-run'])
    assert.equal(code, 0)
    assert.match(lines.text, /would capture/)
    assert.equal(client.messages.length, 0)
  })

  it('edits every field the row lets a person change', async () => {
    const code = await btid([
      'task', 'edit', 'alpha-a1b2',
      '--title', 'Renamed',
      '--description', 'A better one.',
      '--dod', 'Both columns line up.',
      '--estimate', '3',
      '--percent', '25',
      '--tracked', 'off',
      '--blocked', 'on',
      '--blocked-reason', 'Waiting for the header',
      '--blocked-by', 'alpha-c3d4',
      '--labels', 'ui,billing',
      '--start', '2026-11-10',
      '--end', '2026-11-20',
      '--priority', 'urgent',
      '--status', 'in_progress',
      '--note', 'Everything at once.',
    ])
    assert.equal(code, 0, lines.text)
    const row = client.json('projects/alpha/tasks.json')['alpha-a1b2']!
    assert.equal(row['title'], 'Renamed')
    assert.equal(row['description'], 'A better one.')
    assert.equal(row['definitionOfDone'], 'Both columns line up.')
    assert.equal(row['estimateDays'], 3)
    assert.equal(row['percentComplete'], 25)
    assert.equal(row['tracked'], false)
    assert.equal(row['blocked'], true)
    assert.equal(row['blockedReason'], 'Waiting for the header')
    assert.deepEqual(row['blockedBy'], ['alpha-c3d4'])
    assert.deepEqual(row['labels'], ['ui', 'billing'])
    assert.equal(row['startDate'], '2026-11-10')
    assert.equal(row['endDate'], '2026-11-20')
    assert.equal(row['priority'], 'urgent')
    assert.equal(row['status'], 'in_progress')
  })

  it('books a short task in hours, which is the only shape the store accepts', async () => {
    const code = await btid([
      'task', 'edit', 'alpha-a1b2',
      '--small', 'on',
      '--start', '2026-11-10T09:00',
      '--end', '2026-11-10T13:00',
      '--estimate', 'none',
      '--note', 'Booked in hours.',
    ])
    assert.equal(code, 0, lines.text)
    const row = client.json('projects/alpha/tasks.json')['alpha-a1b2']!
    assert.equal(row['isSmall'], true)
    assert.equal(row['startDate'], '2026-11-10T09:00')
    assert.equal(row['endDate'], '2026-11-10T13:00')
  })

  it('lets the store refuse a short task with day dates, as a fault rather than a rule', async () => {
    const code = await btid([
      'task', 'edit', 'alpha-a1b2',
      '--small', 'on',
      '--start', '2026-11-10',
      '--end', '2026-11-20',
      '--note', 'Trying to book a day as a short task.',
    ])
    assert.equal(code, 3, 'a schema refusal is a fault: exit 3, like the engine')
    assert.match(lines.text, /INVALID_ROW|not valid v1 data/)
  })

  it('adds a task’s new label to its project, in the same commit', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--labels', 'ui,billing'])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages.length, 1, 'one commit covers the task and the project')
    assert.deepEqual(client.json('projects/alpha/tasks.json')['alpha-a1b2']!['labels'], ['ui', 'billing'])
    assert.deepEqual(client.json('projects/alpha/project.json')['alpha']!['labels'], ['ui', 'billing'])
  })

  it('clears nullable fields with none', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--estimate', 'none', '--labels', 'none', '--blocked-by', 'none'])
    assert.equal(code, 0, lines.text)
    const row = client.json('projects/alpha/tasks.json')['alpha-a1b2']!
    assert.equal(row['estimateDays'], null)
    assert.deepEqual(row['labels'], [])
    assert.deepEqual(row['blockedBy'], [])
  })

  it('refuses a flag the verb does not take, instead of ignoring it', async () => {
    const code = await btid(['task', 'edit', 'alpha-a1b2', '--estimatee', '3'])
    assert.equal(code, 2)
    assert.match(lines.text, /task edit does not take --estimatee/)
    assert.match(lines.text, /--estimate/)
  })

  it('answers --help on a verb without touching the store', async () => {
    const code = await btid(['task', 'edit', '--help'])
    assert.equal(code, 0)
    assert.match(lines.text, /btid task edit \(<id>|--file/)
    assert.equal(client.messages.length, 0)
  })

  it('edits a project’s colour, members and labels', async () => {
    const code = await btid([
      'project', 'edit', 'alpha',
      '--color', '#FF8800',
      '--members', 'ivan',
      '--labels', 'ui,infra',
    ])
    assert.equal(code, 0, lines.text)
    const project = client.json('projects/alpha/project.json')['alpha']!
    assert.equal(project['color'], '#FF8800')
    assert.deepEqual(project['members'], ['ivan'])
    assert.deepEqual(project['labels'], ['ui', 'infra'])
  })

  it('edits a person: name, handle, role, active', async () => {
    client.put('people.json', {
      chengyukpong: managerRow,
      ivan: { ...managerRow, id: 'ivan', displayName: 'Ivan', githubHandle: 'ivan', role: 'member' },
    })
    const code = await btid(['person', 'edit', 'ivan', '--name', 'Ivan Ivanovich', '--handle', 'ivan-dev', '--role', 'manager', '--active', 'off'])
    assert.equal(code, 0, lines.text)
    const roster = client.json('people.json')['ivan']!
    assert.equal(roster['displayName'], 'Ivan Ivanovich')
    assert.equal(roster['githubHandle'], 'ivan-dev')
    assert.equal(roster['role'], 'manager')
    assert.equal(roster['active'], false)
    assert.equal(roster['id'], 'ivan', 'the id is not re-slugged')
  })

  it('edits a list of tasks from --file, in one commit', async () => {
    const path = await batchFile('edits.json', [
      { id: 'alpha-a1b2', patch: { percentComplete: 40, title: 'Renamed' } },
      { id: 'alpha-a1b2', patch: { percentComplete: 80 } },
    ])
    const code = await btid(['task', 'edit', '--file', path])
    assert.equal(code, 0, lines.text)
    assert.equal(client.messages.length, 1, 'one commit for the list')
    assert.equal(client.messages[0], 'edit 2 tasks')
    const row = client.json('projects/alpha/tasks.json')['alpha-a1b2']!
    assert.equal(row['title'], 'Renamed')
    assert.equal(row['percentComplete'], 80, 'the second item saw the first')
  })

  it('says which item of an edit list refused, and writes nothing', async () => {
    const path = await batchFile('bad-edits.json', [
      { id: 'alpha-a1b2', patch: { percentComplete: 10 } },
      { id: 'alpha-a1b2', patch: { endDate: '2026-11-20' } },
    ])
    const code = await btid(['task', 'edit', '--file', path, '--json'])
    assert.equal(code, 1)
    assert.deepEqual(lines.json[0], {
      error: {
        kind: 'refused',
        code: 'END_DATE_NEEDS_REASON',
        message: 'Changing the end day of a tracked task needs a reason.',
        at: 2,
      },
    })
    assert.equal(client.messages.length, 0)
    assert.equal(client.json('projects/alpha/tasks.json')['alpha-a1b2']!['percentComplete'], 0)
  })

  it('edits projects and people from --file too', async () => {
    // The roster is written before the first command, not between two: a store mutated behind a snapshot's back is a store
    // the snapshot is right to disbelieve, and that would be the test lying rather than the CLI misbehaving.
    client.put('people.json', {
      chengyukpong: managerRow,
      ivan: { ...managerRow, id: 'ivan', displayName: 'Ivan', githubHandle: 'ivan', role: 'member' },
    })
    const projects = await batchFile('project-edits.json', [
      { id: 'alpha', patch: { color: '#FF8800' } },
      { id: 'alpha', patch: { labels: ['ui'] } },
    ])
    assert.equal(await btid(['project', 'edit', '--file', projects]), 0, lines.text)
    assert.equal(client.messages.at(-1), 'project edit 2 projects')

    const people = await batchFile('people-edits.json', [
      { id: 'ivan', patch: { displayName: 'Ivan Ivanovich' } },
      { id: 'ivan', patch: { role: 'manager' } },
    ])
    assert.equal(await btid(['person', 'edit', '--file', people]), 0, lines.text)
    assert.equal(client.messages.at(-1), 'person edit 2 people')
    const ivan = client.json('people.json')['ivan']!
    assert.equal(ivan['displayName'], 'Ivan Ivanovich')
    assert.equal(ivan['role'], 'manager')
  })

  it('promotes a backlog item onto the board, in one commit', async () => {
    client.put('projects/alpha/tasks.json', {
      'alpha-a1b2': task(),
      'alpha-b9z9': task({
        id: 'alpha-b9z9',
        taskId: 'alpha-b9z9',
        title: 'Backlog item',
        status: 'backlog',
        firstPromotedAt: null,
        estimateDays: 2,
        definitionOfDone: 'It works.',
      }),
    })
    const code = await btid(['task', 'promote', 'alpha-b9z9'])
    assert.equal(code, 0, lines.text)
    assert.match(lines.text, /promoted {2}alpha-b9z9/)
    assert.equal(client.messages.length, 1)
    assert.equal(client.messages[0], 'promote alpha-b9z9')

    const row = client.json('projects/alpha/tasks.json')['alpha-b9z9']!
    assert.equal(row['status'], 'todo')
    assert.ok(typeof row['firstPromotedAt'] === 'string', 'the crossing is recorded')
  })

  it('refuses to promote an item that is missing what the board needs, in the gate’s words', async () => {
    client.put('projects/alpha/tasks.json', {
      'alpha-a1b2': task(),
      'alpha-m1ss': task({
        id: 'alpha-m1ss',
        taskId: 'alpha-m1ss',
        title: 'Half a task',
        status: 'backlog',
        firstPromotedAt: null,
        estimateDays: null,
        definitionOfDone: '',
      }),
    })
    const code = await btid(['task', 'promote', 'alpha-m1ss', '--json'])
    assert.equal(code, 1)
    const error = (lines.json[0] as { error: { code: string; message: string } }).error
    assert.equal(error.code, 'PROMOTION_INCOMPLETE')
    assert.match(error.message, /Before promotion: add/)
    assert.equal(client.messages.length, 0, 'nothing committed')
  })

  it('refuses a promotion twice, and points at the status change instead', async () => {
    client.put('projects/alpha/tasks.json', {
      'alpha-a1b2': task(),
      'alpha-b9z9': task({
        id: 'alpha-b9z9',
        taskId: 'alpha-b9z9',
        title: 'Backlog item',
        status: 'backlog',
        firstPromotedAt: null,
        estimateDays: 2,
        definitionOfDone: 'It works.',
      }),
    })
    assert.equal(await btid(['task', 'promote', 'alpha-b9z9']), 0)
    lines.written.length = 0
    const again = await btid(['task', 'promote', 'alpha-b9z9', '--json'])
    assert.equal(again, 1)
    const error = (lines.json[0] as { error: { code: string } }).error
    assert.equal(error.code, 'ALREADY_PROMOTED')
  })

  it('shows a project and a person, by id and by handle', async () => {
    assert.equal(await btid(['project', 'show', 'alpha']), 0, lines.text)
    assert.match(lines.text, /alpha {2}Alpha One/)
    assert.match(lines.text, /tasks 1/)

    lines.written.length = 0
    assert.equal(await btid(['person', 'show', 'chengyukpong']), 0, lines.text)
    assert.match(lines.text, /chengyukpong {2}Cheng/)

    lines.written.length = 0
    assert.equal(await btid(['person', 'show', 'chengyukpong', '--json']), 0)
    const row = lines.json[0] as { id: string; githubHandle: string; tasks: number }
    assert.equal(row.githubHandle, 'chengyukpong')
    assert.equal(row.tasks, 1)
  })

  it('says a project or person is gone instead of throwing', async () => {
    assert.equal(await btid(['project', 'show', 'nope']), 1)
    assert.match(lines.text, /PROJECT_NOT_FOUND/)
    lines.written.length = 0
    assert.equal(await btid(['person', 'show', 'nobody']), 1)
    assert.match(lines.text, /PERSON_NOT_FOUND/)
  })

  it('deletes a task only when --yes is given, and cannot bring it back', async () => {
    const refused = await btid(['task', 'remove', 'alpha-a1b2'])
    assert.equal(refused, 2)
    assert.match(lines.text, /cannot be undone. Pass --yes to mean it/)

    lines.written.length = 0
    const code = await btid(['task', 'remove', 'alpha-a1b2', '--yes'])
    assert.equal(code, 0, lines.text)
    assert.match(lines.text, /removed {2}alpha-a1b2/)
    assert.equal(client.messages.at(-1), 'remove alpha-a1b2')
    assert.equal(client.files.has('projects/alpha/tasks.json'), false, 'a file with no rows is gone')
  })

  it('refuses to delete a project that still holds tasks, and takes them when cascading', async () => {
    const refused = await btid(['project', 'remove', 'alpha', '--yes'])
    assert.equal(refused, 1)
    assert.match(lines.text, /PROJECT_NOT_EMPTY/)
    assert.match(lines.text, /still holds 1 task/)

    lines.written.length = 0
    const cascaded = await btid(['project', 'remove', 'alpha', '--yes', '--cascade'])
    assert.equal(cascaded, 0, lines.text)
    assert.match(lines.text, /removed {2}alpha {3}Alpha One {3}and 1 task/)
    assert.equal(client.messages.at(-1), 'remove project alpha')
  })

  it('refuses to delete somebody who is still on work', async () => {
    client.put('people.json', {
      chengyukpong: managerRow,
      ivan: { ...managerRow, id: 'ivan', displayName: 'Ivan', githubHandle: 'ivan', role: 'member' },
      idle: { ...managerRow, id: 'idle', displayName: 'Idle', githubHandle: 'idle', role: 'member' },
    })
    const refused = await btid(['person', 'remove', 'chengyukpong', '--yes'])
    assert.equal(refused, 1)
    assert.match(lines.text, /PERSON_IN_USE/)

    lines.written.length = 0
    assert.equal(await btid(['person', 'remove', 'idle', '--yes']), 0, lines.text)
    assert.equal(client.messages.at(-1), 'remove person idle')
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
      configPath: join(workspace, 'empty-config.json'),
      cacheDir: workspace,
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

  it('remembers the login and skips GET /user the next time', async () => {
    const { readFileSync } = await import('node:fs')
    let asked = 0
    const call = (argv: string[]) =>
      run({
        argv: ['--store', 'chengyukpong/btid-data', ...argv],
        env: { BTID_TOKEN: 'test-token' },
        out: consoleOutput((text) => lines.write(text)),
        clientFor: () => client,
        tokenFor: () => 'test-token',
        configPath: join(workspace, 'config.json'),
      cacheDir: workspace,
        cacheDir: workspace,
    cacheDir: workspace,
        loginFor: async () => {
          asked += 1
          return 'chengyukpong'
        },
      })

    assert.equal(await call(['store', 'whoami']), 0)
    assert.equal(asked, 1)
    const written = JSON.parse(readFileSync(join(workspace, 'config.json'), 'utf8')) as {
      store: string
      login: string
      tokenFingerprint: string
    }
    assert.equal(written.login, 'chengyukpong')
    assert.equal(written.store, 'chengyukpong/btid-data@main')
    assert.match(written.tokenFingerprint, /^[0-9a-f]{16}$/)
    assert.doesNotMatch(written.tokenFingerprint, /test-token/, 'the token itself is not stored')
  })

  it('ignores a cached login that belongs to a different token', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      join(workspace, 'config.json'),
      JSON.stringify({ store: 'chengyukpong/btid-data@main', login: 'someone-else', tokenFingerprint: 'deadbeefdeadbeef' }),
      'utf8',
    )
    let asked = 0
    const code = await run({
      argv: ['--store', 'chengyukpong/btid-data', 'store', 'whoami'],
      env: { BTID_TOKEN: 'test-token' },
      out: consoleOutput((text) => lines.write(text)),
      clientFor: () => client,
      tokenFor: () => 'test-token',
      configPath: join(workspace, 'config.json'),
      cacheDir: workspace,
    cacheDir: workspace,
      loginFor: async () => {
        asked += 1
        return 'chengyukpong'
      },
    })
    assert.equal(code, 0)
    assert.equal(asked, 1, 'the stale cache is not trusted')
  })

  it('answers a second read from the snapshot, with one head request', async () => {
    const { readdirSync } = await import('node:fs')
    // The first read loads the store and writes a snapshot beside the config.
    assert.equal(await btid(['store', 'whoami']), 0)
    const snapshots = readdirSync(workspace).filter((name) => name.endsWith('.snapshot.json'))
    assert.equal(snapshots.length, 1, 'one snapshot per store')

    // A client that refuses to list or read blobs: only a resumed store can answer.
    // Only head() and commit() are usable: a resumed store must not list the branch or read a file.
    const deaf = {
      tree: async (): Promise<never> => {
        throw new Error('the tree was listed')
      },
      blob: async (): Promise<never> => {
        throw new Error('a blob was read')
      },
      head: () => client.head(),
      commit: (files: Parameters<FakeClient['commit']>[0], message: string) => client.commit(files, message),
      tag: (name: string, sha: string) => client.tag(name, sha),
      untag: (name: string) => client.untag(name),
    }
    const calls: string[] = []
    lines.written.length = 0
    const code = await run({
      argv: ['--store', 'chengyukpong/btid-data', 'task', 'ls'],
      env: { BTID_TOKEN: 'test-token' },
      out: consoleOutput((text) => lines.write(text)),
      clientFor: () => {
        calls.push('client')
        return deaf as unknown as FakeClient
      },
      tokenFor: () => 'test-token',
      loginFor: async () => 'chengyukpong',
      configPath: join(workspace, 'config.json'),
      cacheDir: workspace,
    })
    assert.equal(code, 0, lines.text)
    assert.match(lines.text, /Write the failing test/, 'the rows came from the snapshot')
  })

  it('refreshes the snapshot with the commit a write just made, so the loop stays warm', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    assert.equal(await btid(['store', 'whoami']), 0)
    const name = readdirSync(workspace).find((entry) => entry.endsWith('.snapshot.json'))!
    const before = JSON.parse(readFileSync(join(workspace, name), 'utf8')) as { commit: string }

    assert.equal(await btid(['task', 'new', '--project', 'alpha', '--title', 'After a write']), 0)

    const survivors = readdirSync(workspace).filter((entry) => entry.endsWith('.snapshot.json'))
    assert.equal(survivors.length, 1, 'the file is still there')
    const after = JSON.parse(readFileSync(join(workspace, survivors[0]!), 'utf8')) as { commit: string }

    // The fake client's commits are c1, c2, …: a refresh records the one the write produced, not the one before it.
    assert.equal(before.commit, 'c0')
    assert.equal(after.commit, client.messages.length > 0 ? `c${client.messages.length}` : 'c0')
    assert.notEqual(after.commit, before.commit, 'the snapshot moved with the commit')
  })

  it('a second write reads no blobs, because the snapshot it resumes from is the one it just wrote', async () => {
    assert.equal(await btid(['store', 'whoami']), 0)
    assert.equal(await btid(['task', 'new', '--project', 'alpha', '--title', 'One']), 0)

    // Every blob read from here fails: only a resumed store can finish the command.
    let blobs = 0
    const counting = {
      tree: () => client.tree(),
      blob: async (sha: string) => {
        blobs += 1
        return client.blob(sha)
      },
      head: () => client.head(),
      commit: (files: Parameters<FakeClient['commit']>[0], message: string) => client.commit(files, message),
      tag: (name: string, sha: string) => client.tag(name, sha),
      untag: (name: string) => client.untag(name),
    }

    lines.written.length = 0
    const code = await run({
      argv: ['--store', 'chengyukpong/btid-data', 'task', 'new', '--project', 'alpha', '--title', 'Two'],
      env: { BTID_TOKEN: 'test-token' },
      out: consoleOutput((text) => lines.write(text)),
      clientFor: () => counting as unknown as FakeClient,
      tokenFor: () => 'test-token',
      loginFor: async () => 'chengyukpong',
      configPath: join(workspace, 'config.json'),
      cacheDir: workspace,
    })
    assert.equal(code, 0, lines.text)
    assert.equal(blobs, 0, 'the store was hydrated, not read')
  })

  it('--fresh ignores the snapshot and writes a new one from a real load', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    assert.equal(await btid(['store', 'whoami']), 0)
    const path = join(workspace, readdirSync(workspace).find((name) => name.endsWith('.snapshot.json'))!)
    const before = JSON.parse(readFileSync(path, 'utf8')) as { commit: string }

    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', { [managerRow.id]: managerRow })
    client.put('projects/alpha/project.json', { alpha: project })
    client.put('projects/alpha/tasks.json', {})

    lines.written.length = 0
    const code = await btid(['task', 'ls', '--fresh'])
    assert.equal(code, 0, lines.text)
    assert.match(lines.text, /no rows/, 'it read the new store rather than the snapshot')
    assert.equal(typeof before.commit, 'string')
  })

  it('says where the cache is and what is in it, with no store', async () => {
    const call = (argv: string[], cacheDir: string) =>
      run({
        argv,
        env: {},
        out: consoleOutput((text) => lines.write(text)),
        cacheDir,
      })

    assert.equal(await call(['cache', 'show'], workspace), 0)
    assert.match(lines.text, /nothing cached/)

    // A real snapshot, written by a read against the fake store.
    assert.equal(await btid(['store', 'whoami']), 0)
    lines.written.length = 0
    assert.equal(await call(['cache', 'show', '--json'], workspace), 0)
    const shown = lines.json[0] as { dir: string; entries: { name: string; bytes: number }[]; bytes: number }
    assert.equal(shown.entries.length, 1)
    assert.match(shown.entries[0]!.name, /chengyukpong__btid-data__main\.snapshot\.json/)
    assert.ok(shown.bytes > 0)
  })

  it('clears the cache, and says so the second time too', async () => {
    assert.equal(await btid(['store', 'whoami']), 0)
    const { readdirSync } = await import('node:fs')
    assert.equal(readdirSync(workspace).filter((name) => name.endsWith('.snapshot.json')).length, 1)

    lines.written.length = 0
    const code = await run({
      argv: ['cache', 'clear'],
      env: {},
      out: consoleOutput((text) => lines.write(text)),
      cacheDir: workspace,
    })
    assert.equal(code, 0)
    assert.match(lines.text, /cleared 1 snapshot/)
    assert.equal(readdirSync(workspace).filter((name) => name.endsWith('.snapshot.json')).length, 0)

    lines.written.length = 0
    assert.equal(await run({ argv: ['cache', 'clear'], env: {}, out: consoleOutput((text) => lines.write(text)), cacheDir: workspace }), 0)
    assert.match(lines.text, /nothing to clear/)
  })

  it('deletes a snapshot it cannot decode, instead of failing or ignoring it forever', async () => {
    const { readdirSync, writeFileSync, readFileSync } = await import('node:fs')
    assert.equal(await btid(['store', 'whoami']), 0)
    const name = readdirSync(workspace).find((entry) => entry.endsWith('.snapshot.json'))!
    const path = join(workspace, name)

    // A truncated write: the file is there, and it is not a snapshot.
    writeFileSync(path, readFileSync(path).subarray(0, 40))

    lines.written.length = 0
    const code = await btid(['store', 'whoami'])
    assert.equal(code, 0, 'the command still works: the store is loaded')
    const survivors = readdirSync(workspace).filter((entry) => entry.endsWith('.snapshot.json'))
    assert.equal(survivors.length, 1, 'and a fresh snapshot replaced it')
    const fresh = JSON.parse(readFileSync(join(workspace, survivors[0]!), 'utf8')) as { commit: string }
    assert.equal(typeof fresh.commit, 'string')
  })

  it('refuses without a store, naming the three ways to give one', async () => {
    const code = await run({
      argv: ['task', 'ls'],
      env: {},
      out: consoleOutput((text) => lines.write(text)),
      configPath: join(workspace, 'empty-config.json'),
      cacheDir: workspace,
    })
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
