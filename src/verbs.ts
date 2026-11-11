import { BOARD_SORTS, EXPECT } from 'btid-core'
import type { BoardSort, CreateProjectInput, CreateTaskInput, Store, Task, TaskHandle } from 'btid-core'
import { has, readBatch, textOf, type BatchItem } from './batch'
import { cacheRoot, clearCache, listCache } from './snapshot'
import { dayOf, describeStore } from './output'
import { CLI_VERSION, MANIFEST_VERSION, versionLine } from './version'
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

/** `a,b,c` as a list, trimmed, blanks dropped. */
const listOf = (text: string): string[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')

const priorityOf = (text: string): 'low' | 'medium' | 'high' | 'urgent' | null =>
  text === 'low' || text === 'medium' || text === 'high' || text === 'urgent' ? text : null

const statusOf = (text: string): Task['status'] | null =>
  text === 'backlog' || text === 'todo' || text === 'in_progress' || text === 'done' ? text : null

/** `--tracked on` / `--tracked off`; anything else is a usage error the helper cannot raise, so it returns undefined. */
const booleanFlag = (flags: VerbContext['flags'], name: string): boolean | null | undefined => {
  const value = flags[name]
  if (value === undefined) return null
  if (value === 'on' || value === true) return true
  if (value === 'off' || value === false) return false
  return undefined
}

const stringFlag = (flags: VerbContext['flags'], name: string): string | null => {
  const value = flags[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * One commit per successful write, named after the verb and the row.
 *
 * Also the only place a verb learns the new commit sha, which is what lets the caller refresh the snapshot instead of dropping
 * it: `dry-run` writes nothing and says what it would have; a real write records what the engine returned.
 */
async function commit(context: VerbContext, message: string): Promise<number | null> {
  if (context.flags['dry-run'] === true) {
    context.out.line(`would commit: ${message}`)
    return null
  }
  context.committed = await context.store.commit(message)
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

/** One change, as both a flag-driven verb and a `--file` item produce it. */
interface EditItem {
  id: string
  patch: Record<string, unknown>
  note?: string
}

/**
 * The `--file` shape for an edit: the core's own input, one per line.
 *
 * `{"id": "alpha-a1b2", "patch": {"endDate": "2026-11-20"}, "note": "Client moved it."}`
 *
 * It is deliberately the command's input rather than a second dialect: the same object `store.updateTasks` takes, so a file
 * is a list of calls, not a schema of its own.
 */
function readEdits(context: VerbContext, file: string): { items: EditItem[] } | { message: string } {
  let items: BatchItem[]
  try {
    items = readBatch(file)
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  const edits: EditItem[] = []
  for (const [index, item] of items.entries()) {
    const at = index + 1
    if (!has(item, 'id')) return { message: `item ${at} has no id.` }
    const id = String(item['id'] ?? '')
    const patch = item['patch']
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return { message: `item ${at} has no "patch" object.` }
    }
    const note = textOf(item, 'note')
    edits.push({ id, patch: patch as Record<string, unknown>, ...(note === null ? {} : { note }) })
  }
  return { items: edits }
}

/** `edit <id>` for one, `edit 3 tasks` for several: the commit message a batch deserves. */
const editMessage = (items: readonly EditItem[], noun: string, prefix = 'edit'): string =>
  items.length === 1 ? `${prefix} ${items[0]!.id}` : `${prefix} ${items.length} ${noun}`

/** The `--note` flag, if there is one: the one field an edit takes outside its patch. */
const noteOf = (context: VerbContext): { note?: string } => {
  const note = stringFlag(context.flags, 'note')
  return note === null ? {} : { note }
}

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
  summary: 'Capture a task, or a list of them from --file, in one commit.',
  usage:
    'btid task new (--project <id> --title <title> | --file <path|->) [--priority low|medium|high|urgent] [--json] [--dry-run]',
  flags: { project: 'value', title: 'value', priority: 'value', file: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    if (file !== null) return captureBatch(context, file)

    const projectId = stringFlag(context.flags, 'project')
    const title = stringFlag(context.flags, 'title')
    if (projectId === null) return usage('btid task new needs --project <id>', context.out, context.json)
    if (title === null) return usage('btid task new needs --title <title>', context.out, context.json)

    const priorityText = stringFlag(context.flags, 'priority')
    const priority = priorityText === null ? null : priorityOf(priorityText)
    if (priorityText !== null && priority === null) {
      return usage(`--priority “${priorityText}” is not one of low, medium, high, urgent`, context.out, context.json)
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

/**
 * `--file`: many tasks, one command, one commit.
 *
 * The store does the deciding — it builds every row first and stages none of them if one refuses (`at` says which). What is
 * left here is the terminal's share: turning the file's fields into the command's input, and refusing a field this build
 * cannot spell as a *usage* error, because a shape mistake is not the store's rule.
 */
async function captureBatch(context: VerbContext, file: string): Promise<number> {
  let items: BatchItem[]
  try {
    items = readBatch(file)
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error), context.out, context.json)
  }

  const fallbackProject = stringFlag(context.flags, 'project')
  const inputs: CreateTaskInput[] = []

  for (const [index, item] of items.entries()) {
    const at = index + 1
    // A key that is absent is a shape mistake (the terminal's); a key with a blank value is a value the store refuses
    // (`TITLE_REQUIRED`, `PROJECT_MISSING`), and it must say so in its own words.
    const hasProject = has(item, 'projectId')
    const projectId = hasProject ? String(item['projectId'] ?? '') : fallbackProject
    if (projectId === null) {
      return usage(`item ${at} has no projectId. Add one, or pass --project to fill it in for the whole file.`, context.out, context.json)
    }
    if (!has(item, 'title')) return usage(`item ${at} has no title. The key must be present, even if the store will refuse the value.`, context.out, context.json)
    const title = String(item['title'] ?? '')

    const priorityText = textOf(item, 'priority')
    const priority = priorityText === null ? null : priorityOf(priorityText)
    if (priorityText !== null && priority === null) {
      return usage(`item ${at}: priority “${priorityText}” is not one of low, medium, high, urgent.`, context.out, context.json)
    }

    const assignee = textOf(item, 'assigneeId')
    inputs.push({
      projectId,
      title,
      ...(priority === null ? {} : { priority }),
      ...(assignee === null ? {} : { assigneeId: assignee }),
    })
  }

  const result = context.store.createTasks(inputs)
  if (!result.ok) return refusal(result, context.out, context.json)

  const rows = result.value.map((handle) => handle.row!)
  if (context.flags['dry-run'] === true) {
    for (const row of rows) context.out.line(`would capture  ${row.taskId}   ${row.title}`)
    context.out.line(`(${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}, nothing written)`)
    return 0
  }

  const committed = await commit(context, `capture ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}`)
  if (committed !== null && committed !== 0) return committed

  if (context.json) context.out.json(rows)
  else {
    for (const row of rows) context.out.line(`captured  ${row.taskId}   ${row.status}   ${row.title}`)
    context.out.line(`${rows.length} ${rows.length === 1 ? 'task' : 'tasks'} in one commit`)
  }
  return 0
}

const taskPromote: Verb = {
  name: 'task promote',
  summary: 'Move a captured item onto the board. Needs a title, an owner, both dates, an estimate and a definition of done.',
  usage: 'btid task promote <id> [--status todo|in_progress|done] [--json] [--dry-run]',
  flags: { status: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid task promote <id>', context.out, context.json)

    const statusText = stringFlag(context.flags, 'status')
    if (statusText !== null && statusText !== 'todo' && statusText !== 'in_progress' && statusText !== 'done') {
      return usage(`--status “${statusText}” is not one of todo, in_progress, done`, context.out, context.json)
    }

    const result =
      statusText === null ? context.store.task(id).promote() : context.store.task(id).promote(statusText)
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `promote ${id}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else context.out.line(`promoted  ${result.value.taskId}   ${result.value.status}   rev ${result.value.rev}`)
    return 0
  },
}

const taskEdit: Verb = {
  name: 'task edit',
  summary: 'Change a task, or a list of them from --file, in one commit.',
  usage:
    'btid task edit (<id> [fields] | --file <path|->) [--title t] [--description t] [--dod t] [--status s] [--priority p] [--assignee id] [--start day] [--end day] [--percent n] [--estimate days|none] [--tracked on|off] [--small on|off] [--blocked on|off] [--blocked-reason t] [--blocked-by ids|none] [--labels a,b] [--note text] [--json] [--dry-run]',
  flags: {
    title: 'value',
    description: 'value',
    dod: 'value',
    status: 'value',
    priority: 'value',
    assignee: 'value',
    start: 'value',
    end: 'value',
    percent: 'value',
    estimate: 'value',
    tracked: 'value',
    small: 'value',
    blocked: 'value',
    'blocked-reason': 'value',
    'blocked-by': 'value',
    labels: 'value',
    note: 'value',
    file: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    let items: EditItem[]

    if (file !== null) {
      const read = readEdits(context, file)
      if ('message' in read) return usage(read.message, context.out, context.json)
      items = read.items
    } else {
      const id = context.args[0]
      if (id === undefined) return usage('btid task edit <id>', context.out, context.json)
      const built = taskPatchFromFlags(context)
      if ('message' in built) return usage(built.message, context.out, context.json)
      if (Object.keys(built.patch).length === 0) {
        return usage(
          `btid task edit needs at least one field to change. It takes ${Object.keys(taskEdit.flags ?? {})
            .filter((flag) => flag !== 'dry-run' && flag !== 'note' && flag !== 'file')
            .map((flag) => `--${flag}`)
            .join(', ')}.`,
          context.out,
          context.json,
        )
      }
      items = [{ id, patch: built.patch, ...noteOf(context) }]
    }

    // One call either way: a single edit is a one-item batch, so there is one code path and one commit per command.
    const result = context.store.updateTasks(items as Parameters<Store['updateTasks']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: items.length > 1 })

    const rows = result.value.map((handle) => handle.row!)
    const committed = await commit(context, editMessage(items, 'tasks'))
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(rows)
    else for (const row of rows) context.out.line(`edited  ${row.taskId}   rev ${row.rev}`)
    return 0
  },
}

/** The flags of `task edit`, as an update patch. Shared by the single form; a file speaks the core's input directly. */
function taskPatchFromFlags(context: VerbContext): { patch: Record<string, unknown> } | { message: string } {
  const patch: Record<string, unknown> = {}
  const title = stringFlag(context.flags, 'title')
  if (title !== null) patch['title'] = title
  const statusText = stringFlag(context.flags, 'status')
  if (statusText !== null) {
    const status = statusOf(statusText)
    if (status === null) return { message: `--status “${statusText}” is not one of backlog, todo, in_progress, done` }
    patch['status'] = status
  }
  const priorityText = stringFlag(context.flags, 'priority')
  if (priorityText !== null) {
    const priority = priorityOf(priorityText)
    if (priority === null) return { message: `--priority “${priorityText}” is not one of low, medium, high, urgent` }
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
      return { message: `--percent “${percent}” is not a whole number between 0 and 100` }
    }
    patch['percentComplete'] = value
  }

  // The estimate is a number of days, or `none` to clear it. It is how a task is booked, so it belongs on the verb that
  // changes everything else about the row.
  const estimate = stringFlag(context.flags, 'estimate')
  if (estimate !== null) {
    if (estimate === 'none') patch['estimateDays'] = null
    else {
      const value = Number(estimate)
      if (!Number.isInteger(value) || value < 0) {
        return { message: `--estimate “${estimate}” is not a whole number of days, or none` }
      }
      patch['estimateDays'] = value
    }
  }

  const description = stringFlag(context.flags, 'description')
  if (description !== null) patch['description'] = description === 'none' ? '' : description
  const dod = stringFlag(context.flags, 'dod')
  if (dod !== null) patch['definitionOfDone'] = dod === 'none' ? '' : dod
  const labels = stringFlag(context.flags, 'labels')
  if (labels !== null) patch['labels'] = labels === 'none' ? [] : listOf(labels)
  const blockedBy = stringFlag(context.flags, 'blocked-by')
  if (blockedBy !== null) patch['blockedBy'] = blockedBy === 'none' ? [] : listOf(blockedBy)
  const blockedReason = stringFlag(context.flags, 'blocked-reason')
  if (blockedReason !== null) patch['blockedReason'] = blockedReason === 'none' ? '' : blockedReason

  // Three booleans the row owns. `on`/`off` rather than a bare flag, because "clear the block reason" and "set tracked" are
  // different intents, and a bare `--blocked` cannot say which it meant.
  for (const [flag, field] of [
    ['tracked', 'tracked'],
    ['small', 'isSmall'],
    ['blocked', 'blocked'],
  ] as const) {
    const value = booleanFlag(context.flags, flag)
    if (value === undefined) return { message: `--${flag} takes on or off` }
    if (value !== null) patch[field] = value
  }

  return { patch }
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
  summary: 'Start a project, or a list of them from --file. The manager’s act.',
  usage:
    'btid project new (<key> <name> | --file <path|->) [--start day] [--end day] [--description text] [--json] [--dry-run]',
  flags: { start: 'value', end: 'value', description: 'value', color: 'value', file: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    if (file !== null) return startBatch(context, file)

    const [key, ...rest] = context.args
    if (key === undefined || rest.length === 0) return usage('btid project new <key> <name>', context.out, context.json)
    const name = rest.join(' ')

    const start = stringFlag(context.flags, 'start')
    const end = stringFlag(context.flags, 'end')
    const description = stringFlag(context.flags, 'description')
    const color = stringFlag(context.flags, 'color')
    const result = context.store.createProject({
      id: key,
      name,
      ...(start === null ? {} : { startDate: start }),
      ...(end === null ? {} : { endDate: end }),
      ...(description === null ? {} : { description }),
      ...(color === null ? {} : { color }),
    })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `project ${result.value.id}`)
    if (committed !== null && committed !== 0) return committed
    if (context.json) context.out.json(result.value.row)
    else context.out.line(`project  ${result.value.id}   ${result.value.row?.name ?? name}`)
    return 0
  },
}

/** `--file`: many projects, one command, one commit, nothing staged if any item is refused. */
async function startBatch(context: VerbContext, file: string): Promise<number> {
  let items: BatchItem[]
  try {
    items = readBatch(file)
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error), context.out, context.json)
  }

  const inputs: CreateProjectInput[] = []
  for (const [index, item] of items.entries()) {
    const at = index + 1
    if (!has(item, 'id')) return usage(`item ${at} has no id.`, context.out, context.json)
    if (!has(item, 'name')) return usage(`item ${at} has no name.`, context.out, context.json)
    const id = String(item['id'] ?? '')
    const name = String(item['name'] ?? '')

    const start = textOf(item, 'startDate')
    const end = textOf(item, 'endDate')
    const description = textOf(item, 'description')
    const color = textOf(item, 'color')
    inputs.push({
      id,
      name,
      ...(start === null ? {} : { startDate: start }),
      ...(end === null ? {} : { endDate: end }),
      ...(description === null ? {} : { description }),
      ...(color === null ? {} : { color }),
    })
  }

  const result = context.store.createProjects(inputs)
  if (!result.ok) return refusal(result, context.out, context.json)

  const rows = result.value.map((handle) => handle.row!)
  if (context.flags['dry-run'] === true) {
    for (const row of rows) context.out.line(`would start  ${row.id}   ${row.name}`)
    context.out.line(`(${rows.length} ${rows.length === 1 ? 'project' : 'projects'}, nothing written)`)
    return 0
  }

  const committed = await commit(context, `start ${rows.length} ${rows.length === 1 ? 'project' : 'projects'}`)
  if (committed !== null && committed !== 0) return committed

  if (context.json) context.out.json(rows)
  else {
    for (const row of rows) context.out.line(`project  ${row.id}   ${row.name}`)
    context.out.line(`${rows.length} ${rows.length === 1 ? 'project' : 'projects'} in one commit`)
  }
  return 0
}

const projectEdit: Verb = {
  name: 'project edit',
  summary: 'Change a project, or a list of them from --file, in one commit. The manager’s act.',
  usage:
    'btid project edit (<id> [fields] | --file <path|->) [--name text] [--start day|none] [--end day|none] [--description text] [--status active|archived] [--color #hex] [--members ids|none] [--labels a,b|none] [--json] [--dry-run]',
  flags: {
    name: 'value',
    start: 'value',
    end: 'value',
    description: 'value',
    status: 'value',
    color: 'value',
    members: 'value',
    labels: 'value',
    file: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    let items: EditItem[]

    if (file !== null) {
      const read = readEdits(context, file)
      if ('message' in read) return usage(read.message, context.out, context.json)
      items = read.items
    } else {
      const id = context.args[0]
      if (id === undefined) return usage('btid project edit <id>', context.out, context.json)
      const built = projectPatchFromFlags(context)
      if ('message' in built) return usage(built.message, context.out, context.json)
      if (Object.keys(built.patch).length === 0) {
        return usage('btid project edit needs at least one field to change', context.out, context.json)
      }
      items = [{ id, patch: built.patch }]
    }

    const result = context.store.updateProjects(items as Parameters<Store['updateProjects']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: items.length > 1 })

    const rows = result.value.map((handle) => handle.row!)
    const committed = await commit(context, editMessage(items, 'projects', 'project edit'))
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(rows)
    else for (const row of rows) context.out.line(`edited  ${row.id}   ${row.name}`)
    return 0
  },
}

/** The flags of `project edit`, as an update patch. */
function projectPatchFromFlags(context: VerbContext): { patch: Record<string, unknown> } | { message: string } {
  const patch: Record<string, unknown> = {}
  const name = stringFlag(context.flags, 'name')
  if (name !== null) patch['name'] = name
  const description = stringFlag(context.flags, 'description')
  if (description !== null) patch['description'] = description
  const start = stringFlag(context.flags, 'start')
  if (start !== null) patch['startDate'] = start === 'none' ? null : start
  const end = stringFlag(context.flags, 'end')
  if (end !== null) patch['endDate'] = end === 'none' ? null : end
  const color = stringFlag(context.flags, 'color')
  if (color !== null) patch['color'] = color
  const members = stringFlag(context.flags, 'members')
  if (members !== null) patch['members'] = members === 'none' ? [] : listOf(members)
  const labels = stringFlag(context.flags, 'labels')
  if (labels !== null) patch['labels'] = labels === 'none' ? [] : listOf(labels)
  const statusText = stringFlag(context.flags, 'status')
  if (statusText !== null) {
    if (statusText !== 'active' && statusText !== 'archived') {
      return { message: `--status “${statusText}” is not one of active, archived` }
    }
    patch['status'] = statusText
  }
  return { patch }
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
  summary: 'Add somebody to the roster, or a list of them from --file. The manager’s act.',
  usage:
    'btid person new (<login> | --file <path|->) [--name "Display Name"] [--role member|manager] [--json] [--dry-run]',
  flags: { name: 'value', role: 'value', file: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    if (file !== null) return joinBatch(context, file)

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

/** `--file`: many people, one command, one commit, nothing staged if any item is refused. */
async function joinBatch(context: VerbContext, file: string): Promise<number> {
  let items: BatchItem[]
  try {
    items = readBatch(file)
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error), context.out, context.json)
  }

  const inputs: { login: string; displayName?: string; role?: 'member' | 'manager' }[] = []
  for (const [index, item] of items.entries()) {
    const at = index + 1
    if (!has(item, 'login')) return usage(`item ${at} has no login.`, context.out, context.json)
    const login = String(item['login'] ?? '')

    const roleText = textOf(item, 'role')
    if (roleText !== null && roleText !== 'member' && roleText !== 'manager') {
      return usage(`item ${at}: role “${roleText}” is not one of member, manager.`, context.out, context.json)
    }
    const name = textOf(item, 'displayName')
    inputs.push({
      login,
      ...(name === null ? {} : { displayName: name }),
      ...(roleText === null ? {} : { role: roleText }),
    })
  }

  const result = context.store.createPersons(inputs)
  if (!result.ok) return refusal(result, context.out, context.json)

  const rows = result.value.map((handle) => handle.row!)
  if (context.flags['dry-run'] === true) {
    for (const row of rows) context.out.line(`would add  ${row.id}   ${row.displayName}`)
    context.out.line(`(${rows.length} ${rows.length === 1 ? 'person' : 'people'}, nothing written)`)
    return 0
  }

  const committed = await commit(context, `add ${rows.length} ${rows.length === 1 ? 'person' : 'people'}`)
  if (committed !== null && committed !== 0) return committed

  if (context.json) context.out.json(rows)
  else {
    for (const row of rows) context.out.line(`person  ${row.id}   ${row.role}`)
    context.out.line(`${rows.length} ${rows.length === 1 ? 'person' : 'people'} in one commit`)
  }
  return 0
}

const personEdit: Verb = {
  name: 'person edit',
  summary: 'Change somebody, or a list of them from --file, in one commit. The manager’s act.',
  usage:
    'btid person edit (<id> [fields] | --file <path|->) [--name text] [--handle login] [--role member|manager] [--active on|off] [--json] [--dry-run]',
  flags: { name: 'value', handle: 'value', role: 'value', active: 'value', file: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const file = stringFlag(context.flags, 'file')
    let items: EditItem[]

    if (file !== null) {
      const read = readEdits(context, file)
      if ('message' in read) return usage(read.message, context.out, context.json)
      items = read.items
    } else {
      const id = context.args[0]
      if (id === undefined) return usage('btid person edit <id>', context.out, context.json)
      const built = personPatchFromFlags(context)
      if ('message' in built) return usage(built.message, context.out, context.json)
      if (Object.keys(built.patch).length === 0) {
        return usage('btid person edit needs at least one field to change', context.out, context.json)
      }
      items = [{ id, patch: built.patch }]
    }

    const result = context.store.updatePersons(items as Parameters<Store['updatePersons']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: items.length > 1 })

    const rows = result.value.map((handle) => handle.row!)
    const committed = await commit(context, editMessage(items, 'people', 'person edit'))
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(rows)
    else {
      for (const row of rows) {
        context.out.line(`edited  ${row.id}   ${row.displayName}   ${row.role}${row.active ? '' : ' (inactive)'}`)
      }
    }
    return 0
  },
}

/** The flags of `person edit`, as an update patch. */
function personPatchFromFlags(context: VerbContext): { patch: Record<string, unknown> } | { message: string } {
  const patch: Record<string, unknown> = {}
  const name = stringFlag(context.flags, 'name')
  if (name !== null) patch['displayName'] = name
  const handle = stringFlag(context.flags, 'handle')
  if (handle !== null) patch['githubHandle'] = handle
  const roleText = stringFlag(context.flags, 'role')
  if (roleText !== null) {
    if (roleText !== 'member' && roleText !== 'manager') {
      return { message: `--role “${roleText}” is not one of member, manager` }
    }
    patch['role'] = roleText
  }
  const active = booleanFlag(context.flags, 'active')
  if (active === undefined) return { message: '--active takes on or off' }
  if (active !== null) patch['active'] = active
  return { patch }
}


// --- cache --------------------------------------------------------------------------

const cacheShow: Verb = {
  name: 'cache show',
  summary: 'Where the store snapshot lives, and what is in it. Needs no store.',
  usage: 'btid cache show [--json]',
  async run(context) {
    const root = context.cacheDir
    const entries = listCache(root)
    if (context.json) {
      context.out.json({
        dir: root,
        entries: entries.map((entry) => ({ name: entry.name, bytes: entry.bytes, modified: entry.modified.toISOString() })),
        bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      })
      return 0
    }
    context.out.line(`cache  ${root}`)
    if (entries.length === 0) {
      context.out.line('       nothing cached: the first read will load the store and keep a snapshot')
      return 0
    }
    for (const entry of entries) {
      const when = entry.modified.toISOString().slice(0, 16).replace('T', ' ')
      context.out.line(`  ${entry.name}  ${Math.max(1, Math.round(entry.bytes / 1024))} KB  ${when}`)
    }
    context.out.line(`${entries.length} ${entries.length === 1 ? 'file' : 'files'}, ${Math.max(1, Math.round(entries.reduce((total, entry) => total + entry.bytes, 0) / 1024))} KB`)
    return 0
  },
}

const cacheClear: Verb = {
  name: 'cache clear',
  summary: 'Delete every store snapshot. Needs no store; the next read rebuilds them.',
  usage: 'btid cache clear [--json]',
  async run(context) {
    const root = context.cacheDir
    const before = listCache(root)
    const { removed, bytes } = clearCache(root)
    if (context.json) {
      context.out.json({ dir: root, removed, bytes })
      return 0
    }
    if (before.length === 0) context.out.line(`cache  ${root}`)
    if (removed === 0) {
      context.out.line('nothing to clear: the cache was already empty')
      return 0
    }
    context.out.line(`cleared ${removed} ${removed === 1 ? 'snapshot' : 'snapshots'}, ${Math.max(1, Math.round(bytes / 1024))} KB`)
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

const version: Verb = {
  name: 'version',
  summary: 'Which btid this is, and which schema it speaks.',
  usage: 'btid version [--json]',
  async run(context) {
    const line = versionLine(EXPECT)
    if (context.json) {
      context.out.json({ btid: CLI_VERSION, coreSchema: EXPECT, manifest: MANIFEST_VERSION })
      return 0
    }
    context.out.line(line)
    return 0
  },
}

/** The registry: what the parser dispatches on, and what `btid help` reads. */
export const VERBS: readonly Verb[] = [
  taskLs,
  taskShow,
  taskPromote,
  taskNew,
  taskEdit,
  projectLs,
  projectNew,
  projectEdit,
  personLs,
  personNew,
  personEdit,
  storeWhoami,
  storeInit,
  cacheShow,
  cacheClear,
  version,
]

export const findVerb = (name: string): Verb | undefined => VERBS.find((verb) => verb.name === name)
