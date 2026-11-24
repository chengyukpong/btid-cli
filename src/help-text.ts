/**
 * What `btid help` says.
 *
 * The grammar's table is generated from the rules, so it cannot go stale. The words around it cannot be generated — what a
 * flag means, what an exit code says, what a store is — so they live here, in one place, with a test that fails when a verb
 * or a flag appears without a sentence. `help` is the front door: a person should not have to read `src/` to use the tool.
 */

/** One flag, as `help <verb>` prints it. `takes: 'value'` renders as `--name <value>`. */
export interface FlagHelp {
  name: string
  takes: 'value' | 'none'
  what: string
  /** The literal spelling, when it is not `--<name>` — `-v` is not `--v`. */
  spell?: string
}

/**
 * Every flag the verbs take, in one sentence each.
 *
 * A flag means the same thing wherever it appears on purpose — `--dry-run` is not "sort of writes" on one verb and
 * "preview" on another — so this is a glossary rather than a per-verb list. A test asserts every flag in the table has a
 * line here.
 */
export const FLAG_HELP: Readonly<Record<string, string>> = {
  active: 'on|off — whether the person is still on the roster',
  assignee: '<person-id> — who holds the task',
  blocked: 'on|off — whether the task is waiting on something',
  'blocked-by': '<task-ids|none> — the tasks it waits for',
  'blocked-reason': '<text> — what it is waiting for, in words',
  cascade: 'delete the project’s tasks too',
  color: '<#rrggbb> — the project’s colour',
  commit: 'end|each — when a plan commits (default: end)',
  continue: 'keep going after a step is refused',
  description: '<text> — the longer description',
  details: 'add what sits beside the row: steps, comments, counts',
  dod: '<text> — the definition of done',
  'dry-run': 'do the work, but do not commit',
  end: '<day|instant|none> — when it is due',
  estimate: '<days|none> — how long it should take',
  fields: '<a,b> — print only these columns',
  handle: '<github-handle> — the person’s GitHub login',
  json: 'print the result as JSON',
  key: '<key> — the project’s short id, and the prefix of its task ids',
  members: '<person-ids> — who the project is open to, at birth',
  name: '<text> — the name',
  note: '<text> — why; needed to move a tracked task’s end date',
  order: '<word> — the sort, e.g. due or created',
  percent: '<0-100> — how far along it is',
  preview: 'print the plan’s steps and run nothing',
  priority: 'low|medium|high|urgent',
  project: '<key> — the project the task belongs to',
  quiet: 'print only the outcome',
  role: 'manager|member',
  small: 'on|off — measured in hours rather than days',
  start: '<day|instant|none> — when work begins',
  status: 'active|paused|done — the project’s state',
  title: '<text> — the task’s title',
  to: '<n> — the position to move it to; 1 is first',
  tracked: 'on|off — whether its dates are being tracked',
  yes: 'confirm a delete; there is no undo',
}

/** Flags every command accepts, wherever it appears in the grammar. */
export const GLOBAL_FLAGS: readonly string[] = [
  'store',
  'json',
  'fresh',
  'verbose',
  'log-file',
  'no-log',
  'help',
  'version',
]

/** The globals, spelled out: these are never on a verb's own usage line because they are always available. */
export const GLOBAL_HELP: readonly FlagHelp[] = [
  { name: 'store', takes: 'value', what: '<owner/repo> — which store; also BTID_STORE, or the saved one' },
  { name: 'json', takes: 'none', what: 'print the result as JSON' },
  { name: 'fresh', takes: 'none', what: 'ignore the cached snapshot and load from the store' },
  { name: 'verbose', takes: 'none', what: 'say what the command is doing' },
  { name: 'log-file', takes: 'value', what: '<path> — write this command’s log there' },
  { name: 'no-log', takes: 'none', what: 'do not write a log line for this command' },
  { name: 'help', takes: 'none', what: 'print help for this verb, and touch no store' },
  { name: 'version', takes: 'none', what: 'print the version', spell: '-v, --version' },
]

/**
 * What each exit code means.
 *
 * These are the store's codes, not invented here: `btid-core`'s `exitCodeOf` maps a fault to a number, and the CLI adds `1`
 * for a refusal and `2` for a usage error. A person scripting against this needs them by number, so they are on the page.
 */
export const EXIT_CODES: readonly { code: number; when: string }[] = [
  { code: 0, when: 'ok' },
  { code: 1, when: 'refused by a rule — the sentence names the rule, and its code is in brackets' },
  { code: 2, when: 'usage error; or the store speaks a different schema version' },
  { code: 3, when: 'a row the store will not accept, or a migration that failed' },
  { code: 4, when: 'somebody else wrote first — reload and try again' },
  { code: 5, when: 'there is no store at that location' },
]

/**
 * One sentence per verb — the *verb's* line, not its first handler's.
 *
 * A handler describes one shape (`add task/<id>/comment`), and a verb with five shapes would otherwise be described by
 * whichever rule happened to be registered first: `add` read "Say something on a task" for a year of this file's life.
 * A test asserts every verb has a line here.
 */
export const VERB_HELP: Readonly<Record<string, string>> = {
  add: 'Put a named thing on a row: a comment, an exemption, a label, a member.',
  advance: 'Move the store’s clock forward, so the work that follows is stamped with that day.',
  archive: 'Tag the store, then delete a project and its work. There is no unarchive.',
  clear: 'Drop every cached snapshot. The next read rebuilds them.',
  demote: 'Move a task one step back down the ladder.',
  edit: 'Change a row’s fields.',
  help: 'Print the grammar, or explain one verb.',
  impersonate: 'Act as somebody on the roster: every write after this is theirs. The manager may.',
  ls: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  move: 'Move a step to a position; past the end means last.',
  new: 'Create a row — or the store itself. The store mints the id and hands it back.',
  plan: 'Run a file of commands in order against one store, committing once at the end.',
  promote: 'Move a task one step up the ladder: backlog → todo → in progress → done.',
  remove: 'Take a named thing off a row, or delete the row itself (--yes).',
  rename: 'Rename a step.',
  show: 'Read one row; --details adds its steps, comments and history.',
  tick: 'Tick a step.',
  unimpersonate: 'Stop acting as somebody: the roster account comes back.',
  untick: 'Untick a step.',
  version: 'Which btid this is, and which schema it speaks.',
  whoami: 'Say which store this session points at, and who it acts as.',
}

/** The verbs, grouped the way a person thinks about them. Every verb appears exactly once; a test checks that. */
export const VERB_GROUPS: readonly { kind: string; verbs: readonly string[] }[] = [
  { kind: 'READ', verbs: ['ls', 'show', 'whoami'] },
  { kind: 'CREATE', verbs: ['new'] },
  { kind: 'CHANGE A ROW', verbs: ['edit', 'promote', 'demote', 'archive'] },
  { kind: 'PUT ON AND TAKE OFF', verbs: ['add', 'remove'] },
  { kind: 'A STEP', verbs: ['tick', 'untick', 'rename', 'move'] },
  { kind: 'THE SESSION', verbs: ['advance', 'impersonate', 'unimpersonate'] },
  { kind: 'A FILE OF COMMANDS', verbs: ['plan'] },
  { kind: 'THE CACHE', verbs: ['clear'] },
  { kind: 'THE BINARY', verbs: ['version', 'help'] },
]

/** The shape of a command, said once. */
export const USAGE_LINE = 'btid <verb> <path> [data] [--flags]'

/** What a person needs to know before the table makes sense. */
export const CONCEPTS: readonly { term: string; what: string }[] = [
  {
    term: 'store',
    what: 'owner/repo — a git repository of JSON rows. Every command reads it, changes one thing, and commits.',
  },
  { term: 'verb', what: 'what you do: ls, new, edit, add, tick, plan…' },
  { term: 'path', what: 'what you do it to: task, task/<id>, project/<id>, person/<id>, store, cache' },
  {
    term: '<id>',
    what: 'minted by the store: a task is alpha-n7qk, a project’s key is alpha, a step is st-a1b2, a person is their login',
  },
  { term: 'data', what: 'the words after the path: ids and names go here — add task/alpha-n7qk/label ui' },
  { term: '--flag', what: 'a named attribute: --name value or --name=value. Unknown flags are refused, never ignored.' },
  {
    term: 'query',
    what: 'ls only: key=value filters and a sort word — btid ls task projectId=alpha status=todo due',
  },
]

/**
 * What a plan **file** is, in the words `btid help plan` prints.
 *
 * This lives here, and not only in `docs/`, because the help page is the front door: a file format described only in a
 * document is a format half its readers cannot find, and the half that cannot find it writes a file the parser refuses. The
 * example is a whole file — four lines that run — rather than the one shell line the page used to print.
 */
export const PLAN_FILE = {
  grammar: [
    'one step per line: <verb> <path> [data] [--flags] — the same words you would type',
    'let <name> = <verb> …   binds what `new` returned, for later steps to address',
    '$<name>.<field>         a field of a bound result: $task.id, $project.key',
    '# a comment, to the end of the line — blank lines are ignored',
  ],
  example: [
    'let poc   = new project --key poc --name "Audit Log PoC" --start 2026-11-24 --end 2027-01-08',
    'let first = new task --project $poc.id --title "Write down what an audit event is"',
    '            edit task/$first.id --assignee elias --estimate 2 --dod "One page."',
    '            promote task/$first.id',
  ],
}