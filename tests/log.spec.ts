import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, it } from 'vitest'
import { EXPECT } from 'btid-core'
import { run } from '../src/cli'
import { consoleOutput } from '../src/output'
import { dayKey, defaultLogPath, headerFor } from '../src/log'
import { FakeClient, Lines } from './support'

// The CLI's log, end to end: the flags choose sinks, the core supplies the entries, and stdout is never touched by either.
// The command under test is `ls task`, chosen because it reads the store (so there is an `openStore` entry) and prints a table.

const managerRow = {
  id: 'chengyukpong',
  displayName: 'Cheng One',
  githubHandle: 'chengyukpong',
  role: 'manager',
  active: true,
  avatarUrl: null,
}

const project = {
  id: 'alpha',
  name: 'Alpha One',
  description: 'The project this test is about.',
  status: 'active',
  ownerId: 'chengyukpong',
  members: [],
  color: '#1867C0',
  labels: [],
  startDate: '2026-10-26',
  endDate: '2026-11-23',
  createdAt: '2026-11-01T09:00:00+08:00',
  updatedAt: '2026-11-01T09:00:00+08:00',
}

const task = {
  id: 'alpha-a1b2',
  taskId: 'alpha-a1b2',
  projectId: 'alpha',
  firstPromotedAt: '2026-11-01T09:00:00+08:00',
  title: 'Write the failing test',
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
}
describe('the CLI log', () => {
  let workspace: string
  let client: FakeClient

  const dispatch = async (
    argv: readonly string[],
    extra: { stderr?: Lines; cacheDir?: string } = {},
  ): Promise<{ code: number; stdout: Lines; stderr: Lines }> => {
    const stdout = new Lines()
    const stderr = extra.stderr ?? new Lines()
    const code = await run({
      argv: ['--store', 'chengyukpong/btid-data', ...argv],
      env: { BTID_TOKEN: 'test-token' },
      out: consoleOutput((text) => stdout.write(text)),
      stderr: (text) => stderr.write(text),
      configPath: join(workspace, 'config.json'),
      cacheDir: extra.cacheDir ?? workspace,
      tokenFor: () => 'ghp_test',
      loginFor: async () => 'chengyukpong',
      clientFor: () => client as never,
    })
    return { code, stdout, stderr }
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'btid-cli-log-'))
    client = new FakeClient()
    client.put('githubdb.json', { schemaVersion: EXPECT })
    client.put('people.json', { chengyukpong: managerRow })
    client.put('projects/alpha/project.json', { alpha: project })
    client.put('projects/alpha/tasks.json', { 'alpha-a1b2': task })
    writeFileSync(
      join(workspace, 'config.json'),
      JSON.stringify({ store: 'chengyukpong/btid-dev', login: 'chengyukpong' }),
    )
  })

  it('writes nothing anywhere unless asked', async () => {
    const { code, stdout, stderr } = await dispatch(['ls', 'task'])
    assert.equal(code, 0)
    assert.match(stdout.text, /alpha-a1b2/)
    assert.equal(stderr.text, '')
    assert.equal(existsSync(join(workspace, 'btid.log')), false, 'no file unless asked for')
  })

  it('--verbose puts the entries on stderr and leaves stdout exactly as it was', async () => {
    const quiet = await dispatch(['ls', 'task'])
    const { code, stdout, stderr } = await dispatch(['ls', 'task', '--verbose'])

    assert.equal(code, 0)
    assert.equal(stdout.text, quiet.stdout.text, 'stdout is data: --verbose changes none of it')
    assert.match(stderr.text, /openStore/)
    assert.match(stderr.text, /command/)
    // The seven fields, tab separated: at, actor, verb, subject, result, ms, detail.
    const line = stderr.text.split('\n').find((one) => one.includes('openStore'))
    assert.ok(line)
    assert.equal(line.split('\t').length, 7)
  })

  it('--log-file with no path writes btid.log in the cache directory, with a dated header', async () => {
    const { code, stderr } = await dispatch(['ls', 'task', '--log-file'])
    assert.equal(code, 0)
    assert.equal(stderr.text, '', 'the file sink is silent when it works')

    const path = defaultLogPath(workspace)
    assert.match(path, /btid\.log$/)
    assert.equal(existsSync(path), true)

    const written = readFileSync(path, 'utf8').trimEnd().split('\n')
    assert.match(written[0] ?? '', /^# created \d{8}/)
    assert.ok(written.some((line) => line.includes('\topenStore\t')))
    assert.ok(written.some((line) => line.includes('\tcommand\t')))
  })

  it('--log-file <path> uses that path, and --verbose --log-file writes both', async () => {
    const target = join(workspace, 'deep', 'trace.tsv')
    const { code, stderr } = await dispatch(['ls', 'task', '--verbose', '--log-file', target])
    assert.equal(code, 0)
    assert.match(stderr.text, /openStore/)
    assert.equal(existsSync(target), true)
    const lines = readFileSync(target, 'utf8').trimEnd().split('\n')
    assert.match(lines[0] ?? '', /^# created \d{8}/)
    assert.ok(lines.length >= 4, 'two header lines, the open, and the command')
  })

  it('keeps stdout parseable as JSON with --verbose on', async () => {
    const { code, stdout, stderr } = await dispatch(['ls', 'task', '--json', '--verbose'])
    assert.equal(code, 0)
    assert.match(stderr.text, /openStore/)
    const parsed = JSON.parse(stdout.text.trimEnd()) as unknown
    assert.ok(Array.isArray(parsed), 'the pipe still gets JSON, and only JSON')
  })

  it('a log file that cannot be written is one warning, and the command still answers', async () => {
    // A directory where the file should be: opening it for append fails, every time.
    const blocked = join(workspace, 'not-a-file')
    writeFileSync(blocked, 'a file, not a directory')
    const target = join(blocked, 'trace.tsv')

    const { code, stdout, stderr } = await dispatch(['ls', 'task', '--log-file', target])
    assert.equal(code, 0, 'the table is what was asked for; the log is a courtesy')
    assert.match(stdout.text, /alpha-a1b2/)
    assert.match(stderr.text, /logging off/)
    assert.equal(stderr.text.trimEnd().split('\n').length, 1, 'one warning, not one per line')
  })
})
