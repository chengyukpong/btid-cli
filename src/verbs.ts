import { BOARD_SORTS } from 'btid-core'
import type { BoardSort, Store, Task, TaskHandle } from 'btid-core'
import { dayOf, describeStore } from './output'
import type { Column } from './output'
import { fieldsOf, printRows, refusal, usage, type Verb, type VerbContext } from './verb'

/**
 * The verbs, one per thing a person can type.
 *
 * Every one of them is `parse → one core call → print`. Where a flag has to be turned into a command input that is the
 * terminal's shape; where the answer can be refused, the sentence and the code come from the core untouched.
 */

const ORDER_ALIASES: Record<string, BoardSort> = {
  updated: 'updated',
  updatedAt: 'updated',
  priority: 'priority',
  endDate: 'endDate',
  due: 'endDate',
  progress: 'progress',
}

const priorityOf = (text: string): 'low' | 'medium' | 'high' | null =>
  text === 'low' || text === 'medium' || text === 'high' ? text : null

const statusOf = (text: string): Task['status'] | null =>
  text === 'backlog' || text === 'todo' || text === 'in_progress' || text === 'done' ? text : null

const stringFlag = (flags: VerbContext['flags'], name: string): string | null => {
  const value = flags[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** One commit per successful write, named after the verb and the row. */
async function commit(context: VerbContext, message: string): Promise<number | null> {
  if (context.flags['dry-run'] === true) {
    context.out.line(`would commit: ${message}`)
    return null
  }
  await context.store.commit(message)
  return 0
}

// --- task ---------------------------------------------------------------------------

const taskColumns: readonly Column<Task>[] = [
  { title: 'ID', value: (row) => row.taskId },
  { title: 'STATUS', value: (row) => row.status },
  { title: 'PRIORITY', value: (row) => row.priority },
  { title: 'OWNER', value: (row) => row.assigneeId ?? '—' },
  { title: 'END', value: (row) => dayOf(row.endDate) },
  { title: 'DONE', value: (row) => `${row.percentComplete}%` },
  { title: 'TITLE', value: (row) => row.title },
]

const taskLs: Verb = {
  name: 'task ls',
  summary: 'List tasks, optionally filtered by a query.',
  usage: 'btid task ls [query…] [order] [--fields a,b] [--json]',
  flags: { fields: 'value', order: 'value' },
  async run(context) {
    const words = [...context.args]
    const orderFlag = stringFlag(context.flags, 'order')
    if (orderFlag !== null) words.push(orderFlag)

    // Everything is the core's grammar: filters are `key=value`, a bare word is the order. One parser, one set of meanings.
    const read = context.store.query(words.join(' '))
    if (!read.ok) return refusal(read, context.out, context.json)

    const orderWord = words.find((word) => !word.includes('=') && !word.includes('>') && !word.includes('<'))
    let view = read.value
    if (orderWord !== undefined) {
      const sort = ORDER_ALIASES[orderWord]
      if (sort === undefined) {
        return usage(
          `--order “${orderWord}” is not one this build sorts by. Try one of: ${BOARD_SORTS.map((option) => option.id).join(', ')}.`,
          context.out,
          context.json,
        )
      }
      view = view.order(sort)
    }

    return printRows(view.rows as Task[], fieldsOf(context.flags), taskColumns, context.out, context.json)
  },
}

const taskShow: Verb = {
  name: 'task show',
  summary: 'Print one task, with its steps and the last change.',
  usage: 'btid task show <id> [--json]',
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid task show <id>', context.out, context.json)

    const handle = context.store.task(id)
    const row = handle.row
    if (row === undefined) {
      return refusal(
        { ok: false, code: 'TASK_NOT_FOUND', reason: `Task ${id} is not in the store.` },
        context.out,
        context.json,
      )
    }

    if (context.json) {
      context.out.json({ ...row, steps: handle.steps, warnings: handle.warnings.map((warning) => warning.message) })
      return 0
    }

    context.out.line(`${row.taskId}  ${row.title}`)
    context.out.line(
      `  project ${row.projectId}   status ${row.status}   owner ${row.assigneeId ?? '—'}   ${row.percentComplete}%`,
    )
    context.out.line(`  window  ${dayOf(row.startDate)} → ${dayOf(row.endDate)}   estimate ${row.estimateDays ?? '—'}`)
    if (handle.steps.length > 0) {
      const progress = handle.progress
      context.out.line(`  steps   ${progress.done}/${progress.total}`)
      for (const step of handle.steps) context.out.line(`    [${step.done ? 'x' : ' '}] ${step.name}`)
    }
    for (const warning of handle.warnings) context.out.line(`  warning ${warning.message}`)
    return 0
  },
}

const taskNew: Verb = {
  name: 'task new',
  summary: 'Capture a task in a project.',
  usage: 'btid task new --project <id> --title <title> [--priority low|medium|high] [--json] [--dry-run]',
  flags: { project: 'value', title: 'value', priority: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const projectId = stringFlag(context.flags, 'project')
    const title = stringFlag(context.flags, 'title')
    if (projectId === null) return usage('btid task new needs --project <id>', context.out, context.json)
    if (title === null) return usage('btid task new needs --title <title>', context.out, context.json)

    const priorityText = stringFlag(context.flags, 'priority')
    const priority = priorityText === null ? null : priorityOf(priorityText)
    if (priorityText !== null && priority === null) {
      return usage(`--priority “${priorityText}” is not one of low, medium, high`, context.out, context.json)
    }

    const result = context.store.createTask({
      projectId,
      title,
      ...(priority === null ? {} : { priority }),
    })
    if (!result.ok) return refusal(result, context.out, context.json)

    const row = result.value.row!
    const committed = await commit(context, `capture ${row.taskId}`)
    if (committed !== null && committed !== 0) return committed
    if (context.json) context.out.json(row)
    else context.out.line(`captured  ${row.taskId}   ${row.status}   ${row.title}`)
    return 0
  },
}

const taskEdit: Verb = {
  name: 'task edit',
  summary: 'Change a task. A tracked end day needs --note.',
  usage:
    'btid task edit <id> [--title t] [--status s] [--priority p] [--assignee id] [--start day] [--end day] [--percent n] [--note text] [--json] [--dry-run]',
  flags: {
    title: 'value',
    status: 'value',
    priority: 'value',
    assignee: 'value',
    start: 'value',
    end: 'value',
    percent: 'value',
    note: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid task edit <id>', context.out, context.json)

    const patch: Record<string, unknown> = {}
    const title = stringFlag(context.flags, 'title')
    if (title !== null) patch['title'] = title
    const statusText = stringFlag(context.flags, 'status')
    if (statusText !== null) {
      const status = statusOf(statusText)
      if (status === null) return usage(`--status “${statusText}” is not one of backlog, todo, in_progress, done`, context.out, context.json)
      patch['status'] = status
    }
    const priorityText = stringFlag(context.flags, 'priority')
    if (priorityText !== null) {
      const priority = priorityOf(priorityText)
      if (priority === null) return usage(`--priority “${priorityText}” is not one of low, medium, high`, context.out, context.json)
      patch['priority'] = priority
    }
    const assignee = stringFlag(context.flags, 'assignee')
    if (assignee !== null) patch['assigneeId'] = assignee === 'none' ? null : assignee
    const start = stringFlag(context.flags, 'start')
    if (start !== null) patch['startDate'] = start
    const end = stringFlag(context.flags, 'end')
    if (end !== null) patch['endDate'] = end
    const percent = stringFlag(context.flags, 'percent')
    if (percent !== null) {
      const value = Number(percent)
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        return usage(`--percent “${percent}” is not a whole number between 0 and 100`, context.out, context.json)
      }
      patch['percentComplete'] = value
    }

    if (Object.keys(patch).length === 0) {
      return usage('btid task edit needs at least one field to change', context.out, context.json)
    }

    const note = stringFlag(context.flags, 'note')
    const result = context.store
      .task(id)
      .update(patch as Parameters<TaskHandle['update']>[0], note === null ? {} : { note })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `edit ${id}`)
    if (committed !== null && committed !== 0) return committed
    if (context.json) context.out.json(result.value)
    else context.out.line(`edited  ${result.value.taskId}   rev ${result.value.rev}`)
    return 0
  },
}

// --- project ------------------------------------------------------------------------

const projectLs: Verb = {
  name: 'project ls',
  summary: 'List projects.',
  usage: 'btid project ls [--fields a,b] [--json]',
  flags: { fields: 'value' },
  async run(context) {
    const rows = context.store.all('project')
    const columns: readonly Column<(typeof rows)[number]>[] = [
      { title: 'ID', value: (row) => row.id },
      { title: 'NAME', value: (row) => row.name },
      { title: 'OWNER', value: (row) => row.ownerId },
      { title: 'START', value: (row) => dayOf(row.startDate) },
      { title: 'END', value: (row) => dayOf(row.endDate) },
    ]
    return printRows(rows, fieldsOf(context.flags), columns, context.out, context.json)
  },
}

const projectNew: Verb = {
  name: 'project new',
  summary: 'Start a project. The manager’s act.',
  usage: 'btid project new <key> <name> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [key, ...rest] = context.args
    if (key === undefined || rest.length === 0) return usage('btid project new <key> <name>', context.out, context.json)
    const name = rest.join(' ')

    const result = context.store.createProject({ id: key, name })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `project ${result.value.id}`)
    if (committed !== null && committed !== 0) return committed
    if (context.json) context.out.json(result.value.row)
    else context.out.line(`project  ${result.value.id}   ${result.value.row?.name ?? name}`)
    return 0
  },
}

// --- person -------------------------------------------------------------------------

const personLs: Verb = {
  name: 'person ls',
  summary: 'List the roster.',
  usage: 'btid person ls [--fields a,b] [--json]',
  flags: { fields: 'value' },
  async run(context) {
    const rows = context.store.all('person')
    const columns: readonly Column<(typeof rows)[number]>[] = [
      { title: 'ID', value: (row) => row.id },
      { title: 'NAME', value: (row) => row.displayName },
      { title: 'HANDLE', value: (row) => row.githubHandle },
      { title: 'ROLE', value: (row) => row.role },
      { title: 'ACTIVE', value: (row) => (row.active ? 'yes' : 'no') },
    ]
    return printRows(rows, fieldsOf(context.flags), columns, context.out, context.json)
  },
}

const personNew: Verb = {
  name: 'person new',
  summary: 'Add somebody to the roster. The manager’s act.',
  usage: 'btid person new <login> [--name "Display Name"] [--role member|manager] [--json] [--dry-run]',
  flags: { name: 'value', role: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const login = context.args[0]
    if (login === undefined) return usage('btid person new <login>', context.out, context.json)

    const roleText = stringFlag(context.flags, 'role')
    if (roleText !== null && roleText !== 'member' && roleText !== 'manager') {
      return usage(`--role “${roleText}” is not one of member, manager`, context.out, context.json)
    }

    const name = stringFlag(context.flags, 'name')
    const result = context.store.createPerson({
      login,
      ...(name === null ? {} : { displayName: name }),
      ...(roleText === null ? {} : { role: roleText as 'member' | 'manager' }),
    })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `person ${login}`)
    if (committed !== null && committed !== 0) return committed
    if (context.json) context.out.json(result.value.row)
    else context.out.line(`person  ${result.value.row?.id ?? login}   ${result.value.row?.role ?? 'member'}`)
    return 0
  },
}

// --- store --------------------------------------------------------------------------

const storeWhoami: Verb = {
  name: 'store whoami',
  summary: 'Say which store this session is pointed at, and who it acts as.',
  usage: 'btid store whoami [--json]',
  async run(context) {
    const actor = context.store.actor
    const people = context.store.all('person').length
    const projects = context.store.all('project').length

    if (context.json) {
      context.out.json({ store: context.location, from: context.source, handle: context.store.handle, actor, people, projects })
      return 0
    }
    context.out.line(`store    ${describeStore(context.location)} (${context.source})`)
    context.out.line(`handle   ${context.store.handle ?? '(unknown)'}`)
    context.out.line(`role     ${actor === null ? '(not on the roster)' : actor.role}`)
    context.out.line(`people   ${people}`)
    context.out.line(`projects ${projects}`)
    return 0
  },
}

const storeInit: Verb = {
  name: 'store init',
  summary: 'Create a store: the config, and you as its manager.',
  usage: 'btid store init [--json]',
  writes: true,
  async run(context) {
    // The store is already created by the time a verb runs (the dispatcher uses initStore for this verb), so there is
    // nothing to write here — saying who it made is the whole answer.
    const actor = context.store.actor
    if (context.json) {
      context.out.json({ created: true, manager: actor })
      return 0
    }
    context.out.line(`init  ${describeStore(context.location)}`)
    context.out.line(`      manager ${context.store.handle ?? '(unknown)'}`)
    return 0
  },
}

/** The registry: what the parser dispatches on, and what `btid help` reads. */
export const VERBS: readonly Verb[] = [
  taskLs,
  taskShow,
  taskNew,
  taskEdit,
  projectLs,
  projectNew,
  personLs,
  personNew,
  storeWhoami,
  storeInit,
]

export const findVerb = (name: string): Verb | undefined => VERBS.find((verb) => verb.name === name)
