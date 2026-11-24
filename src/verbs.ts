import { join } from 'node:path'
import { BOARD_SORTS, EXPECT, STATUS_LABELS, STATUS_ORDER } from 'btid-core'
import type { BoardSort, CreateProjectInput, CreateTaskInput, Project, Store, Task, TaskHandle, User } from 'btid-core'
import { readPlan, runPlan } from './plan'
import { cacheRoot, clearCache, listCache } from './snapshot'
import { dayOf, describeStore, rowFields, table, wrapText } from './output'
import { CLI_VERSION, MANIFEST_VERSION, versionLine } from './version'
import { checkForUpdate, updateNotice } from './update'
import type { Column, Field } from './output'
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
  // A plan with --commit=end keeps the message and writes once, at the end.
  if (context.defer !== undefined) {
    context.defer.push(message)
    return null
  }
  context.committed = await context.store.commit(message)
  return 0
}

// --- task ---------------------------------------------------------------------------

const taskColumns: readonly Column<Task>[] = [
  { title: 'ID', value: (row) => row.taskId },
  { title: 'STATUS', value: (row) => STATUS_LABELS[row.status].toLowerCase() },
  { title: 'PRIORITY', value: (row) => row.priority },
  { title: 'OWNER', value: (row) => row.assigneeId ?? '—' },
  { title: 'END', value: (row) => dayOf(row.endDate) },
  { title: 'DONE', value: (row) => `${row.percentComplete}%` },
  { title: 'TITLE', value: (row) => row.title },
]

// A row's own fields, under the names the store gives them: `show` prints what the object holds, and nothing it computed.
// Empty is absence, so a null, a blank string and an empty list print nothing rather than a dash.

const TASK_FIELDS: readonly Field<Task>[] = [
  { label: 'projectId', value: (row) => row.projectId },
  { label: 'status', value: (row) => row.status },
  { label: 'priority', value: (row) => row.priority },
  { label: 'assigneeId', value: (row) => row.assigneeId },
  { label: 'startDate', value: (row) => row.startDate },
  { label: 'endDate', value: (row) => row.endDate },
  { label: 'estimateDays', value: (row) => (row.estimateDays === null ? null : `${row.estimateDays} md`) },
  { label: 'percentComplete', value: (row) => `${row.percentComplete}%` },
  { label: 'tracked', value: (row) => (row.tracked ? 'yes' : null) },
  { label: 'isSmall', value: (row) => (row.isSmall ? 'yes' : null) },
  { label: 'blocked', value: (row) => (row.blocked ? 'yes' : null) },
  { label: 'blockedReason', value: (row) => row.blockedReason },
  { label: 'blockedBy', value: (row) => (row.blockedBy.length === 0 ? null : row.blockedBy.join(', ')) },
  { label: 'labels', value: (row) => (row.labels.length === 0 ? null : row.labels.join(', ')) },
  { label: 'definitionOfDone', value: (row) => row.definitionOfDone },
  { label: 'description', value: (row) => row.description },
  { label: 'createdById', value: (row) => row.createdById },
  { label: 'firstPromotedAt', value: (row) => (row.firstPromotedAt === null ? null : row.firstPromotedAt.slice(0, 16)) },
  { label: 'createdAt', value: (row) => row.createdAt.slice(0, 16) },
  { label: 'updatedAt', value: (row) => row.updatedAt.slice(0, 16) },
  { label: 'updatedBy', value: (row) => row.updatedBy },
  { label: 'rev', value: (row) => String(row.rev) },
]

const PROJECT_FIELDS: readonly Field<Project>[] = [
  { label: 'description', value: (row) => row.description },
  { label: 'status', value: (row) => row.status },
  { label: 'ownerId', value: (row) => row.ownerId },
  { label: 'members', value: (row) => (row.members.length === 0 ? null : row.members.join(', ')) },
  { label: 'labels', value: (row) => (row.labels.length === 0 ? null : row.labels.join(', ')) },
  { label: 'color', value: (row) => row.color },
  { label: 'startDate', value: (row) => row.startDate },
  { label: 'endDate', value: (row) => row.endDate },
  { label: 'createdAt', value: (row) => row.createdAt.slice(0, 16) },
  { label: 'updatedAt', value: (row) => row.updatedAt.slice(0, 16) },
]

const PERSON_FIELDS: readonly Field<User>[] = [
  { label: 'githubHandle', value: (row) => `@${row.githubHandle}` },
  { label: 'role', value: (row) => row.role },
  { label: 'active', value: (row) => (row.active ? 'yes' : 'no') },
  { label: 'avatarUrl', value: (row) => row.avatarUrl },
]

/** The `--note` flag, if there is one: the one field an edit takes outside its patch. */
const noteOf = (context: VerbContext): { note?: string } => {
  const note = stringFlag(context.flags, 'note')
  return note === null ? {} : { note }
}

const taskLs: Verb = {
  name: 'ls task',
  summary: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  usage: 'btid ls task [query…] [order] [--fields a,b] [--json]',
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
  name: 'show task/<id>',
  summary: 'Read one row: its own fields, and its steps and history with --details.',
  usage: 'btid show task/<id> [--details] [--json]',
  flags: { details: 'boolean' },
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid show task/<id>', context.out, context.json)

    const handle = context.store.task(id)
    const row = handle.row
    if (row === undefined) {
      return refusal(
        { ok: false, code: 'TASK_NOT_FOUND', reason: `Task ${id} is not in the store.` },
        context.out,
        context.json,
      )
    }

    context.result = row
    if (context.json) {
      context.out.json({
        ...row,
        steps: handle.steps,
        diagnostics: handle.diagnostics.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          message: finding.message,
        })),
      })
      return 0
    }

    context.out.line(`${row.taskId}  ${row.title}`)
    for (const line of rowFields(row, TASK_FIELDS)) context.out.line(line)

    // Steps are a list beside the row and the log is its history, so neither is a field: `--details` is where they go.
    if (!context.details) return 0

    if (handle.steps.length > 0) {
      const progress = handle.progress
      context.out.line('')
      context.out.line(`  steps  ${progress.done}/${progress.total}`)
      for (const step of handle.steps) {
        // When it was finished, beside the tick: a date nobody can read is the same as no date, and this one used to be
        // permanently null.
        const finished = step.done && step.doneAt !== null ? `   done ${step.doneAt.slice(0, 10)}` : ''
        context.out.line(`    [${step.done ? 'x' : ' '}] ${step.id}  ${step.name}${finished}`)
      }
    }
    // Two words, because the levels mean different things to a person reading a terminal: a warning holds a save, an info is a
    // nudge they may accept.
    for (const finding of handle.diagnostics) {
      context.out.line(`  ${finding.severity === 'warning' ? 'warning' : 'info   '} ${finding.message}`)
    }

    if (row.comments.length > 0) {
      context.out.line('')
      context.out.line(`  comments  ${row.comments.length}`)
      for (const comment of row.comments) {
        context.out.line(`    ${comment.createdAt.slice(0, 16)}  ${comment.authorId}  ${comment.body}`)
      }
    }

    const entries = row.activities.slice(-5)
    if (entries.length > 0) {
      context.out.line('')
      context.out.line(`  history  the last ${entries.length} of ${row.activities.length}`)
      for (const entry of entries) {
        const names = entry.changes.map((change) => change.field).join(', ')
        context.out.line(`    ${entry.at.slice(0, 16)}  ${entry.editors.join(', ')}  ${names}`)
      }
    }
    return 0
  },
}

const taskNew: Verb = {
  name: 'new task',
  summary: 'Create a row — or the store itself; the store mints the id.',
  usage: 'btid new task --project <id> --title <text> [--priority low|medium|high|urgent] [--json] [--dry-run]',
  needs: ['project', 'title'],
  flags: { project: 'value', title: 'value', priority: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const projectId = stringFlag(context.flags, 'project')
    const title = stringFlag(context.flags, 'title')
    if (projectId === null || title === null) {
      return usage('btid new task --project <id> --title <text>', context.out, context.json)
    }
    const priorityText = stringFlag(context.flags, 'priority')
    const priority = priorityText === null ? null : priorityOf(priorityText)
    if (priorityText !== null && priority === null) {
      return usage(`--priority “${priorityText}” is not one of low, medium, high, urgent`, context.out, context.json)
    }

    const result = context.store.createTasks([
      { projectId, title, ...(priority === null ? {} : { priority }) },
    ] as Parameters<Store['createTasks']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `capture ${row.id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`captured  ${row.id}   ${row.status}   ${row.title}`)
    return 0
  },
}

const taskPromote: Verb = {
  name: 'promote task/<id>',
  summary: 'Move a captured task onto the board. Takes no attributes.',
  usage: 'btid promote task/<id> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid promote task/<id>', context.out, context.json)

      // One step up the ladder, and nothing else: there is no status to choose, so the gates cannot be walked around.
    const result = context.store.task(id).promote()
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `promote ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else context.out.line(`promoted  ${result.value.taskId}   ${result.value.status}   rev ${result.value.rev}`)
    return 0
  },
}

const taskDemote: Verb = {
  name: 'demote task/<id>',
  summary: 'Move a task one step back down the ladder. Takes no attributes.',
  usage: 'btid demote task/<id> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid demote task/<id>', context.out, context.json)

    // One step down, and never back up: a reason for reopening is a comment, so the pair of ladder verbs takes no flags.
    const result = context.store.task(id).demote()
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `demote ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else context.out.line(`demoted  ${result.value.taskId}   ${result.value.status}   rev ${result.value.rev}`)
    return 0
  },
}

const taskEdit: Verb = {
  name: 'edit task/<id>',
  summary: 'Change one row’s fields.',
  usage:
    'btid edit task/<id> [--title t] [--description t] [--dod t] [--priority p] [--assignee id] [--start day] [--end day] [--percent n] [--estimate days|none] [--tracked on|off] [--small on|off] [--blocked on|off] [--blocked-reason t] [--blocked-by ids|none] [--note text] [--json] [--dry-run]',
  flags: {
    title: 'value',
    description: 'value',
    dod: 'value',
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
    note: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid edit task/<id>', context.out, context.json)

    const built = taskPatchFromFlags(context)
    if ('message' in built) return usage(built.message, context.out, context.json)
    if (Object.keys(built.patch).length === 0) {
      return usage(
        `btid ${context.form} needs at least one field to change. It takes ${Object.keys(taskEdit.flags ?? {})
          .filter((flag) => flag !== 'dry-run' && flag !== 'note')
          .map((flag) => `--${flag}`)
          .join(', ')}.`,
        context.out,
        context.json,
      )
    }

    // The core's update command still takes a list — a plan will use that — but the verb edits one row, so the list here has
    // exactly one item and a refusal needs no item number.
    const result = context.store.updateTasks([{ id, patch: built.patch, ...noteOf(context) }] as Parameters<Store['updateTasks']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `edit ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`edited  ${row.taskId}   rev ${row.rev}`)
    return 0
  },
}

/** The flags of `task edit`, as an update patch. Shared by the single form; a file speaks the core's input directly. */
function taskPatchFromFlags(context: VerbContext): { patch: Record<string, unknown> } | { message: string } {
  const patch: Record<string, unknown> = {}
  const title = stringFlag(context.flags, 'title')
  if (title !== null) patch['title'] = title
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
  // Labels are a list with its own paths (`add/remove task/<id>/label`), not a field that a flag replaces wholesale.
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
  name: 'ls project',
  summary: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  usage: 'btid ls project [--fields a,b] [--json]',
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
  name: 'new project',
  summary: 'Create one row; the store mints the id.',
  usage:
    'btid new project --key <key> --name <text> [--start day] [--end day] [--description text] [--color #hex] [--members ids] [--json] [--dry-run]',
  needs: ['key', 'name'],
  flags: {
    key: 'value',
    name: 'value',
    start: 'value',
    end: 'value',
    description: 'value',
    color: 'value',
    members: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const key = stringFlag(context.flags, 'key')
    const name = stringFlag(context.flags, 'name')
    if (key === null || name === null) {
      return usage('btid new project --key <key> --name <text> --start <day> --end <day>', context.out, context.json)
    }

    const description = stringFlag(context.flags, 'description')
    const color = stringFlag(context.flags, 'color')
    // Members at birth, so a plan does not need a second commit before anybody can hold its work.
    const membersText = stringFlag(context.flags, 'members')
    const members = membersText === null || membersText === 'none' ? [] : listOf(membersText)
    const result = context.store.createProjects([
      {
        id: key,
        name,
        ...(stringFlag(context.flags, 'start') === null ? {} : { startDate: stringFlag(context.flags, 'start') as string }),
        ...(stringFlag(context.flags, 'end') === null ? {} : { endDate: stringFlag(context.flags, 'end') as string }),
        ...(description === null ? {} : { description }),
        ...(color === null ? {} : { color }),
        ...(members.length === 0 ? {} : { members }),
      },
    ] as Parameters<Store['createProjects']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `create project ${row.id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`project  ${row.id}   ${row.name}`)
    return 0
  },
}

const projectEdit: Verb = {
  name: 'edit project/<id>',
  summary: 'Change one row’s fields.',
  usage:
    'btid edit project/<id> [--name text] [--start day|none] [--end day|none] [--description text] [--status active|paused|done] [--color #hex] [--json] [--dry-run]',
  flags: {
    name: 'value',
    start: 'value',
    end: 'value',
    description: 'value',
    status: 'value',
    color: 'value',
    'dry-run': 'boolean',
  },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid edit project/<id>', context.out, context.json)

    const built = projectPatchFromFlags(context)
    if ('message' in built) return usage(built.message, context.out, context.json)
    if (Object.keys(built.patch).length === 0) {
      return usage(`btid ${context.form} needs at least one field to change`, context.out, context.json)
    }

    const result = context.store.updateProjects([{ id, patch: built.patch }] as Parameters<Store['updateProjects']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `project edit ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`edited  ${row.id}   ${row.name}`)
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
  // Members and labels are not fields here: they are lists with their own paths (`add/remove …/member`, `…/label`), and a
  // flag that replaced the whole list was a second door to the same fact. At birth they are still flags — `new project
  // --members` — because a project that cannot take work yet has no other moment to name them.
  const statusText = stringFlag(context.flags, 'status')
  if (statusText !== null) {
      if (statusText === 'archived') {
        // `archived` is not a project status: the model has active, paused and done, and archiving is a verb.
        return { message: `a project is not archived by a status; archive it instead: btid archive project/<id> --yes` }
      }
      if (statusText !== 'active' && statusText !== 'paused' && statusText !== 'done') {
        return { message: `--status “${statusText}” is not one of active, paused, done` }
    }
    patch['status'] = statusText
  }
  return { patch }
}


// --- person -------------------------------------------------------------------------

const personLs: Verb = {
  name: 'ls person',
  summary: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  usage: 'btid ls person [--fields a,b] [--json]',
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
  name: 'new person',
  summary: 'Create one row; the store mints the id.',
  usage: 'btid new person --handle <login> [--name text] [--role member|manager] [--json] [--dry-run]',
  needs: ['handle'],
  flags: { handle: 'value', name: 'value', role: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const login = stringFlag(context.flags, 'handle')
    if (login === null) return usage('btid new person --handle <login> [--name text] [--role member|manager]', context.out, context.json)

    const role = stringFlag(context.flags, 'role')
    if (role !== null && role !== 'member' && role !== 'manager') {
      return usage(`--role “${role}” is not one of member, manager`, context.out, context.json)
    }
    const displayName = stringFlag(context.flags, 'name')

    const result = context.store.createPersons([
      {
        login,
        ...(displayName === null ? {} : { displayName }),
        ...(role === null ? {} : { role: role as 'member' | 'manager' }),
      },
    ] as Parameters<Store['createPersons']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `add person ${row.id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`person  ${row.id}   ${row.displayName}   ${row.role}`)
    return 0
  },
}

const personEdit: Verb = {
  name: 'edit person/<id>',
  summary: 'Change one row’s fields.',
  usage:
    'btid edit person/<id> [--name text] [--handle login] [--role member|manager] [--active on|off] [--json] [--dry-run]',
  flags: { name: 'value', handle: 'value', role: 'value', active: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid edit person/<id>', context.out, context.json)

    const built = personPatchFromFlags(context)
    if ('message' in built) return usage(built.message, context.out, context.json)
    if (Object.keys(built.patch).length === 0) {
      return usage(`btid ${context.form} needs at least one field to change`, context.out, context.json)
    }

    const result = context.store.updatePersons([{ id, patch: built.patch }] as Parameters<Store['updatePersons']>[0])
    if (!result.ok) return refusal(result, context.out, context.json, { index: false })

    const row = result.value[0]!.row!
    const committed = await commit(context, `person edit ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = row
    if (context.json) context.out.json(row)
    else context.out.line(`edited  ${row.id}   ${row.displayName}   ${row.role}${row.active ? '' : ' (inactive)'}`)
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


/** The five verbs the plan design needed: three removals and two shows. */

const removeFlagHelp = 'refused without it: deleting is the one action with no undo'

const taskRemove: Verb = {
  name: 'remove task/<id>',
  summary: `Delete a row, detach a label, or remove a step. A row needs --yes (${removeFlagHelp}).`,
  usage: 'btid remove task/<id> --yes [--json] [--dry-run]',
  flags: { yes: 'boolean', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid remove task/<id> --yes', context.out, context.json)
    if (context.flags['yes'] !== true) {
      return usage(`btid remove task/<id> deletes a row and cannot be undone. Pass --yes to mean it.`, context.out, context.json)
    }

    const result = context.store.task(id).remove()
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `remove ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else context.out.line(`removed  ${result.value.taskId}   ${result.value.title}`)
    return 0
  },
}

const commentAdd: Verb = {
  name: 'add task/<id>/comment',
  summary: 'Say something on a task. Any member may comment on anybody’s work.',
  usage: 'btid add task/<id>/comment <text> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    // The text is the one free token, like a label's name: everything after the path, so it needs no quotes for one word and
    // no flag for several.
    const text = context.args.slice(1).join(' ').trim()
    if (id === undefined || text === '') return usage('btid add task/<id>/comment <text>', context.out, context.json)

    // Author and day come from the core: the CLI cannot sign a comment it was not given by the person typing it.
    const result = context.store.task(id).comment(text)
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `comment ${id}`)
    if (committed !== null && committed !== 0) return committed

    const comment = result.value.comments[result.value.comments.length - 1]!
    // `add` binds nothing, by the rule that shapes this grammar: its object is named by the caller, so there is no id to hand
    // back. The comment's own id goes to the transcript and to `--json`, which is output, not a binding.
    if (context.json) context.out.json(comment)
    else context.out.line(`commented  ${result.value.taskId}   ${comment.id}   ${comment.authorId}   ${comment.body}`)
    return 0
  },
}

const exemptionAdd: Verb = {
  name: 'add task/<id>/exemption',
  summary: 'Accept a nudge on a task, permanently, so it stops being raised.',
  usage: 'btid add task/<id>/exemption <CODE> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const code = context.args.slice(1).join(' ').trim()
    if (id === undefined || code === '') return usage('btid add task/<id>/exemption <CODE>', context.out, context.json)

    const result = context.store.task(id).exempt(code)
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `exempt ${id} ${code}`)
    if (committed !== null && committed !== 0) return committed

    const entry = result.value.exemptions.find((one) => one.code === code)
    if (context.json) context.out.json(entry ?? result.value)
    else {
      context.out.line(
        `exempted  ${result.value.taskId}   ${code}   ${entry === undefined ? '' : entry.by}   ${entry === undefined ? '' : entry.at.slice(0, 16)}`,
      )
    }
    return 0
  },
}

const exemptionRemove: Verb = {
  name: 'remove task/<id>/exemption',
  summary: 'Take an acceptance back, so the sentence is raised again.',
  usage: 'btid remove task/<id>/exemption <CODE> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const code = context.args.slice(1).join(' ').trim()
    if (id === undefined || code === '') return usage('btid remove task/<id>/exemption <CODE>', context.out, context.json)

    const result = context.store.task(id).unexempt(code)
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `unexempt ${id} ${code}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else context.out.line(`unexempted  ${result.value.taskId}   ${code}`)
    return 0
  },
}

const projectLabelAdd: Verb = {
  name: 'add project/<id>/label',
  summary: 'Add a label to the project’s vocabulary, so its tasks can use it.',
  usage: 'btid add project/<id>/label <name> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [id, label] = [context.args[0], context.args.slice(1).join(' ').trim()]
    if (id === undefined || label === '') return usage('btid add project/<id>/label <name>', context.out, context.json)

    const current = context.store.project(id).row
    if (current === undefined) return usage(`there is no project ${id}`, context.out, context.json)

    const result = context.store.project(id).update({
      labels: current.labels.includes(label) ? current.labels : [...current.labels, label],
    })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `label ${id} ${label}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else context.out.line(`labeled  ${result.value.id}   ${label}   ${result.value.labels.join(', ') || 'no labels'}`)
    return 0
  },
}

const projectLabelRemove: Verb = {
  name: 'remove project/<id>/label',
  summary: 'Take a label out of the project’s vocabulary.',
  usage: 'btid remove project/<id>/label <name> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [id, label] = [context.args[0], context.args.slice(1).join(' ').trim()]
    if (id === undefined || label === '') return usage('btid remove project/<id>/label <name>', context.out, context.json)

    const current = context.store.project(id).row
    if (current === undefined) return usage(`there is no project ${id}`, context.out, context.json)

    const result = context.store.project(id).update({ labels: current.labels.filter((one) => one !== label) })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `unlabel ${id} ${label}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else context.out.line(`unlabeled  ${result.value.id}   ${label}   ${result.value.labels.join(', ') || 'no labels'}`)
    return 0
  },
}

const projectMemberAdd: Verb = {
  name: 'add project/<id>/member',
  summary: 'Open a project to somebody on the roster.',
  usage: 'btid add project/<id>/member <person-id> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const member = context.args.slice(1).join(' ').trim()
    if (id === undefined || member === '') return usage('btid add project/<id>/member <person-id>', context.out, context.json)

    const before = context.store.project(id).row
    const result = context.store.project(id).addMember(member)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.updatedAt === result.value.updatedAt
    const committed = await commit(context, `member ${id} ${member}`)
    if (committed !== null && committed !== 0) return committed

    // `add` binds nothing: the person was named by the caller, so there is no id to hand back (see the rule in grammar.md).
    if (context.json) context.out.json(result.value)
    else if (unchanged) context.out.line(`unchanged  ${result.value.id}   ${member}`)
    else context.out.line(`member  ${result.value.id}   ${member}   ${result.value.members.join(', ') || 'nobody'}`)
    return 0
  },
}

const projectMemberRemove: Verb = {
  name: 'remove project/<id>/member',
  summary: 'Close a project to somebody. Their work stays assigned.',
  usage: 'btid remove project/<id>/member <person-id> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const member = context.args.slice(1).join(' ').trim()
    if (id === undefined || member === '') {
      return usage('btid remove project/<id>/member <person-id>', context.out, context.json)
    }

    const before = context.store.project(id).row
    const result = context.store.project(id).removeMember(member)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.updatedAt === result.value.updatedAt
    const committed = await commit(context, `unmember ${id} ${member}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else if (unchanged) context.out.line(`unchanged  ${result.value.id}   ${member}`)
    else context.out.line(`unmember  ${result.value.id}   ${member}   ${result.value.members.join(', ') || 'nobody'}`)
    return 0
  },
}

const projectArchive: Verb = {
  name: 'archive project/<id>',
  summary: 'Tag the store, then delete the project and its work. There is no unarchive.',
  usage: 'btid archive project/<id> --yes [--json] [--dry-run]',
  flags: { yes: 'boolean', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid archive project/<id> --yes', context.out, context.json)
    if (context.flags['yes'] !== true) {
      return usage(
        'btid archive project/<id> tags the store and then deletes the project and its tasks. There is no unarchive, so pass --yes to mean it.',
        context.out,
        context.json,
      )
    }

    // The core tags the commit it starts from, then stages the deletion; this commit is what makes the deletion real.
    const result = await context.store.archiveProject(id)
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `archive project ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else {
      const { project, tasks, tag } = result.value
      context.out.line(
        `archived  ${project.id}   ${project.name}   tag ${tag}${tasks > 0 ? `   and ${tasks} ${tasks === 1 ? 'task' : 'tasks'}` : ''}`,
      )
    }
    return 0
  },
}

const projectRemove: Verb = {
  name: 'remove project/<id>',
  summary: `Delete a row, detach a label, or remove a step. A row needs --yes (${removeFlagHelp}).`,
  usage: 'btid remove project/<id> --yes [--cascade] [--json] [--dry-run]',
  needs: ['yes'],
  flags: { yes: 'boolean', cascade: 'boolean', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid remove project/<id> --yes', context.out, context.json)
    if (context.flags['yes'] !== true) {
      return usage('btid remove project/<id> deletes a row and cannot be undone. Pass --yes to mean it.', context.out, context.json)
    }

    const result = context.store.project(id).remove({ cascade: context.flags['cascade'] === true })
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `remove project ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    const { project, tasks } = result.value
    if (context.json) context.out.json({ project, tasks })
    else {
      context.out.line(`removed  ${project.id}   ${project.name}${tasks > 0 ? `   and ${tasks} ${tasks === 1 ? 'task' : 'tasks'}` : ''}`)
    }
    return 0
  },
}

const personRemove: Verb = {
  name: 'remove person/<id>',
  summary: `Delete a row, detach a label, or remove a step. A row needs --yes (${removeFlagHelp}).`,
  usage: 'btid remove person/<id> --yes [--json] [--dry-run]',
  needs: ['yes'],
  flags: { yes: 'boolean', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid remove person/<id> --yes', context.out, context.json)
    if (context.flags['yes'] !== true) {
      return usage('btid remove person/<id> deletes a row and cannot be undone. Pass --yes to mean it.', context.out, context.json)
    }

    const result = context.store.person(id).remove()
    if (!result.ok) return refusal(result, context.out, context.json)

    const committed = await commit(context, `remove person ${id}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else context.out.line(`removed  ${result.value.id}   ${result.value.displayName}`)
    return 0
  },
}

/** One project, by key. The read a plan uses to reuse a row it did not create. */
const projectShow: Verb = {
  name: 'show project/<id>',
  summary: 'Read one row: its own fields, and its work with --details.',
  usage: 'btid show project/<id> [--details] [--json]',
  flags: { details: 'boolean' },
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid show project/<id>', context.out, context.json)

    const handle = context.store.project(id)
    const row = handle.row
    if (row === undefined) {
      return refusal({ ok: false, code: 'PROJECT_NOT_FOUND', reason: `Project ${id} is not in the store.` }, context.out, context.json)
    }

    const tasks = handle.tasks()
    context.result = row
    if (context.json) {
      context.out.json({ ...row, tasks: tasks.total })
      return 0
    }

    context.out.line(`${row.id}  ${row.name}`)
    for (const line of rowFields(row, PROJECT_FIELDS)) context.out.line(line)
    if (!context.details) return 0

    // Everything below is about several rows rather than about this one: how the work is spread, and the work itself.
    const owners = new Set(tasks.rows.map((task) => task.assigneeId).filter((candidate): candidate is string => candidate !== null))
    const counts = STATUS_ORDER.map((status) => [status, tasks.rows.filter((task) => task.status === status).length] as const)
      .filter(([, value]) => value > 0)
      .map(([status, value]) => `${value} ${STATUS_LABELS[status].toLowerCase()}`)
      .join(' · ')
    const effort = tasks.mandays()

    context.out.line('')
    context.out.line(
      `  work    ${tasks.total} ${tasks.total === 1 ? 'task' : 'tasks'}` +
        (owners.size === 0 ? '' : ` · assigned to ${owners.size} ${owners.size === 1 ? 'person' : 'people'}`),
    )
    if (counts !== '') context.out.line(`  status  ${counts}`)
    context.out.line(
      `  effort  ${effort.estimate} md estimated · ${effort.scheduled} md booked · ${effort.used} md used` +
        (effort.remaining === 0 ? '' : ` · ${effort.remaining} md left`),
    )

    if (tasks.total > 0) {
      context.out.line('')
      context.out.line(table(tasks.order('endDate').rows as Task[], taskColumns))
    }
    return 0
  },
}

/** One person, by roster id **or** GitHub handle — a plan author has one or the other. */
const personShow: Verb = {
  name: 'show person/<id>',
  summary: 'Read one row: its own fields, and the work it holds with --details.',
  usage: 'btid show person/<id> [--details] [--json]',
  flags: { details: 'boolean' },
  async run(context) {
    const who = context.args[0]
    if (who === undefined) return usage('btid show person/<id>', context.out, context.json)

    // A roster id is a slug of the login, so the two often coincide; the handle is checked too because a renamed person keeps
    // the id they were created with.
    const rows = context.store.all('person')
    const row = rows.find((person) => person.id === who) ?? rows.find((person) => person.githubHandle === who)
    if (row === undefined) {
      return refusal({ ok: false, code: 'PERSON_NOT_FOUND', reason: `Person ${who} is not on the roster.` }, context.out, context.json)
    }

    const handle = context.store.person(row.id)
    const tasks = handle.tasks()
    context.result = row
    if (context.json) {
      context.out.json({ ...row, tasks: tasks.total })
      return 0
    }

    context.out.line(`${row.id}  ${row.displayName}`)
    for (const line of rowFields(row, PERSON_FIELDS)) context.out.line(line)
    if (!context.details) return 0

    // What they are carrying, and the rows themselves — the same question a project's details answer.
    const counts = STATUS_ORDER.map((status) => [status, tasks.rows.filter((task) => task.status === status).length] as const)
      .filter(([, value]) => value > 0)
      .map(([status, value]) => `${value} ${STATUS_LABELS[status].toLowerCase()}`)
      .join(' · ')
    const effort = tasks.mandays(true)

    context.out.line('')
    context.out.line(`  work    ${tasks.total} ${tasks.total === 1 ? 'task' : 'tasks'} on the board`)
    if (counts !== '') context.out.line(`  status  ${counts}`)
    context.out.line(`  effort  ${effort.estimate} md estimated · ${effort.used} md used`)

    if (tasks.total > 0) {
      context.out.line('')
      context.out.line(table(tasks.order('endDate').rows as Task[], taskColumns))
    }
    return 0
  },
}

const plan: Verb = {
  name: 'plan',
  summary: 'Run a file of commands in order against one store, committing once at the end.',
  usage: 'btid plan <file|-> [--commit=end|each] [--continue] [--quiet] [--preview] [--store=owner/repo[@branch]] [--json]',
  flags: { commit: 'value', continue: 'boolean', quiet: 'boolean', preview: 'boolean', store: 'value' },
  writes: true,
  async run(context) {
    const file = context.args[0]
    if (file === undefined) return usage('btid plan <file|-> [--commit=each|end]', context.out, context.json)

    // The default is one commit for the whole plan: a plan is one intention, and a store half-built by an intention that
    // failed is worse than one that was never touched. `each` is the opt-in for watching a long plan land step by step.
    const commitFlag = stringFlag(context.flags, 'commit') ?? 'end'
    if (commitFlag !== 'each' && commitFlag !== 'end') {
      return usage(`--commit “${commitFlag}” is not one of end, each`, context.out, context.json)
    }

    let stdin = ''
    if (file === '-') {
      stdin = await new Promise<string>((resolve, reject) => {
        let text = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => (text += chunk))
        process.stdin.on('end', () => resolve(text))
        process.stdin.on('error', reject)
      })
    }

    let parsed: ReturnType<typeof readPlan>
    try {
      parsed = readPlan(file, stdin)
    } catch (error) {
      return usage(`the plan could not be read: ${(error as Error).message}`, context.out, context.json)
    }
    if ('message' in parsed) return usage(parsed.message, context.out, context.json)
    if (parsed.steps.length === 0) return usage('that plan has no steps', context.out, context.json)

    if (context.flags['preview'] === true) {
      for (const step of parsed.steps) {
        const name = step.name === undefined ? '' : `let ${step.name} = `
        const flags = Object.entries(step.flags)
          .map(([flag, value]) => (value === true ? `--${flag}` : `--${flag} ${String(value)}`))
          .join(' ')
        const path = step.path === '' ? '' : ` ${step.path}`
        context.out.line(`${String(step.at).padStart(2)}  ${name}${step.verb}${path} ${[...step.args, flags].filter((part) => part !== '').join(' ')}`.trimEnd())
      }
      context.out.line(`${parsed.steps.length} steps, nothing run`)
      return 0
    }

    const run = await runPlan(context, parsed, {
      commit: commitFlag,
      keepGoing: context.flags['continue'] === true,
    })

    if (context.json) {
      context.out.json({ ok: run.code === 0, steps: run.steps, ...(run.code === 0 ? {} : { code: run.code }) })
      return run.code
    }

    const ok = run.steps.filter((step) => step.ok).length
    const refused = run.steps.length - ok
    const notRun = parsed.steps.length - run.steps.length
    const nothingWritten = commitFlag === 'end' && refused > 0
    const parts = [
      `${parsed.steps.length} ${parsed.steps.length === 1 ? 'step' : 'steps'}`,
      `${ok} ok`,
      `${refused} refused`,
      ...(notRun > 0 ? [`${notRun} not run`] : []),
    ]
    context.out.line(`${parts.join(', ')}${nothingWritten ? ' — nothing was written' : ''}`)
    return run.code
  },
}

// --- labels -------------------------------------------------------------------------

/**
 * Labels are data, never a segment.
 *
 * `add task/<id>/label ui` and `remove task/<id>/label ui` take the name as an argument, because a label *is* its text
 * and text may contain spaces or `/`; a path segment would need an escaping rule. `--labels` on `edit task/<id>` replaces
 * the whole list, which is the wrong tool for "this task is also urgent" — these two change one label, and say `unchanged`
 * when the row already agrees, so a script that re-runs need not read first.
 */
const labelAdd: Verb = {
  name: 'add task/<id>/label',
  summary: 'Attach a label that already exists in the project’s vocabulary.',
  usage: 'btid add task/<id>/label <name> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const label = context.args.slice(1).join(' ').trim()
    if (id === undefined || label === '') return usage('btid add task/<id>/label <name>', context.out, context.json)

    const before = context.store.task(id).row
    const result = context.store.task(id).addLabel(label)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `label ${id} ${label}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else if (unchanged) context.out.line(`unchanged  ${result.value.taskId}   ${label}`)
    else {
      context.out.line(
        `labeled  ${result.value.taskId}   ${label}   ${
          result.value.labels.length === 0 ? 'no labels' : result.value.labels.join(', ')
        }`,
      )
    }
    return 0
  },
}

const labelRemove: Verb = {
  name: 'remove task/<id>/label',
  summary: 'Detach one label from a task. The project keeps it.',
  usage: 'btid remove task/<id>/label <name> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const label = context.args.slice(1).join(' ').trim()
    if (id === undefined || label === '') return usage('btid remove task/<id>/label <name>', context.out, context.json)

    const before = context.store.task(id).row
    const result = context.store.task(id).removeLabel(label)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `unlabel ${id} ${label}`)
    if (committed !== null && committed !== 0) return committed

    if (context.json) context.out.json(result.value)
    else if (unchanged) context.out.line(`unchanged  ${result.value.taskId}   ${label}`)
    else {
      context.out.line(
        `unlabeled  ${result.value.taskId}   ${label}   ${
          result.value.labels.length === 0 ? 'no labels' : result.value.labels.join(', ')
        }`,
      )
    }
    return 0
  },
}

/** The labels on one task: the collection `ls task/<id>/label` reads. */
const labelLs: Verb = {
  name: 'ls task/<id>/label',
  summary: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  usage: 'btid ls task/<id>/label [--json]',
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid ls task/<id>/label', context.out, context.json)
    const row = context.store.task(id).row
    if (row === undefined) {
      return refusal(
        { ok: false, code: 'TASK_NOT_FOUND', reason: `Task ${id} is not in the store.` },
        context.out,
        context.json,
      )
    }
    if (context.json) {
      context.out.json(row.labels)
      return 0
    }
    context.out.line(row.labels.length === 0 ? `no labels  ${id}` : `labels  ${id}   ${row.labels.join(', ')}`)
    return 0
  },
}

// --- steps --------------------------------------------------------------------------

/** The checklist, with the id visible because it is the only thing that addresses a step. */
function printStepAnswer(
  context: VerbContext,
  task: Task,
  unchanged: boolean,
  what: string,
  removed?: { id: string; name: string },
): number {
  if (context.json) {
    context.out.json(task)
    return 0
  }
  if (unchanged) {
    context.out.line(`unchanged  ${task.taskId}   ${what}`)
    return 0
  }
  // Nothing is gone silently: the removed step is named, with the id and the name that would recreate it.
  if (removed !== undefined) context.out.line(`removed  ${removed.id}  "${removed.name}"`)
  const total = task.steps.length
  const done = task.steps.filter((step) => step.done).length
  const listed = task.steps.map(
    (step, index) => `${String(index + 1).padStart(2)}. ${step.done ? '[x]' : '[ ]'} ${step.id}  ${step.name}`,
  )
  context.out.line(`step  ${task.taskId}   ${total === 0 ? 'no steps' : `${done}/${total} done`}`)
  for (const line of listed) context.out.line(`  ${line}`)
  return 0
}

/** The checklist `ls task/<id>/step` reads. */
const stepLs: Verb = {
  name: 'ls task/<id>/step',
  summary: 'List rows: tasks, projects, people, or a task’s steps and labels.',
  usage: 'btid ls task/<id>/step [--json]',
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid ls task/<id>/step', context.out, context.json)
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
      context.out.json(handle.steps)
      return 0
    }
    return printStepAnswer(context, row, false, id)
  },
}

/** One step, by its id — never by its position, which changes when another step is removed. */
const stepShow: Verb = {
  name: 'show task/<id>/step/<step-id>',
  summary: 'Read one row.',
  usage: 'btid show task/<id>/step/<step-id> [--json]',
  async run(context) {
    const [id, stepId] = [context.args[0], context.args[1]]
    if (id === undefined || stepId === undefined) {
      return usage('btid show task/<id>/step/<step-id>', context.out, context.json)
    }
    const row = context.store.task(id).row
    if (row === undefined) {
      return refusal(
        { ok: false, code: 'TASK_NOT_FOUND', reason: `Task ${id} is not in the store.` },
        context.out,
        context.json,
      )
    }
    const step = row.steps.find((candidate) => candidate.id === stepId.trim())
    if (step === undefined) {
      const has = row.steps.length === 0 ? 'none' : row.steps.map((candidate) => `${candidate.id} ${candidate.name}`).join('; ')
      return refusal(
        { ok: false, code: 'STEP_NOT_FOUND', reason: `No step “${stepId}” on ${id}. It has: ${has}.` },
        context.out,
        context.json,
      )
    }
    context.result = step
    if (context.json) context.out.json(step)
    else {
      context.out.line(`${step.id}  ${step.name}`)
      context.out.line(`  ${step.done ? 'done' : 'open'}`)
    }
    return 0
  },
}

const stepNew: Verb = {
  name: 'new task/<id>/step',
  summary: 'Create one row; the store mints the id.',
  usage: 'btid new task/<id>/step --name <text> [--json] [--dry-run]',
  needs: ['name'],
  flags: { name: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const name = stringFlag(context.flags, 'name')
    if (id === undefined || name === null) return usage('btid new task/<id>/step --name <text>', context.out, context.json)

    const handle = context.store.task(id)
    const before = handle.row
    const result = handle.addStep(name)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `step new ${id}`)
    if (committed !== null && committed !== 0) return committed

    // What a plan binds is the row the verb **made**, not the task it made it on. A step is addressed by its id, that id is
    // minted here, and a plan that cannot name it can never finish it three days later. `addStep` hands back the task, so
    // the step is the one that was not there before. The JSON answer stays the task: this changes what a plan binds, and
    // nothing that a person or an agent reads.
    const added = result.value.steps.find((step) => !(before?.steps ?? []).some((old) => old.id === step.id))
    context.result = added ?? result.value
    return printStepAnswer(context, result.value, unchanged, name)
  },
}

const stepMove: Verb = {
  name: 'move task/<id>/step/<step-id>',
  summary: 'Move a step to a position. A position past the end means last.',
  usage: 'btid move task/<id>/step/<step-id> --to <n> [--json] [--dry-run]',
  needs: ['to'],
  flags: { to: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const id = context.args[0]
    const step = context.args[1]
    const toText = stringFlag(context.flags, 'to')
    if (id === undefined || step === undefined || toText === null) {
      return usage('btid move task/<id>/step/<step-id> --to <n>', context.out, context.json)
    }
    // A destination is a number, so a typo is refused here rather than clamped into "last" by the core.
    const to = Number(toText)
    if (!Number.isFinite(to) || toText.trim() === '') {
      return usage(`--to takes a whole number, not “${toText}”`, context.out, context.json)
    }

    const before = context.store.task(id).row
    const result = context.store.task(id).moveStep(step, to)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `move ${id} ${step} to ${to}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    if (context.json) context.out.json(result.value)
    else if (unchanged) context.out.line(`unchanged  ${result.value.taskId}   ${step}   already there`)
    else {
      const order = result.value.steps.map((one) => one.id).join(', ')
      context.out.line(`moved  ${result.value.taskId}   ${step}   ${to}   ${order}`)
    }
    return 0
  },
}

const stepRename: Verb = {
  name: 'rename task/<id>/step/<step-id>',
  summary: 'Rename one step.',
  usage: 'btid rename task/<id>/step/<step-id> --name <text> [--json] [--dry-run]',
  needs: ['name'],
  flags: { name: 'value', 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [id, stepId] = [context.args[0], context.args[1]]
    const name = stringFlag(context.flags, 'name')
    if (id === undefined || stepId === undefined || name === null) {
      return usage('btid rename task/<id>/step/<step-id> --name <text>', context.out, context.json)
    }

    const handle = context.store.task(id)
    const before = handle.row
    const result = handle.renameStep(stepId, name)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `step rename ${id} ${stepId}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    return printStepAnswer(context, result.value, unchanged, name)
  },
}

/** `done` and `undo` are each other's inverse: the state is a boolean, so nothing is lost either way. */
const tickVerb = (done: boolean): Verb => ({
  name: `${done ? 'tick' : 'untick'} task/<id>/step/<step-id>`,
  summary: done ? 'Tick one step.' : 'Untick one step.',
  usage: `btid ${done ? 'tick' : 'untick'} task/<id>/step/<step-id> [--json] [--dry-run]`,
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [id, stepId] = [context.args[0], context.args[1]]
    if (id === undefined || stepId === undefined) {
      return usage(`btid ${done ? 'tick' : 'untick'} task/<id>/step/<step-id>`, context.out, context.json)
    }

    const handle = context.store.task(id)
    const before = handle.row
    const result = handle.setStepDone(stepId, done)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `step ${done ? 'tick' : 'untick'} ${id} ${stepId}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    return printStepAnswer(context, result.value, unchanged, stepId)
  },
})

const tickStep = tickVerb(true)
const untickStep = tickVerb(false)

const stepRemove: Verb = {
  name: 'remove task/<id>/step/<step-id>',
  summary: 'Delete a row, detach a label, or remove a step. A row needs --yes.',
  usage: 'btid remove task/<id>/step/<step-id> [--json] [--dry-run]',
  flags: { 'dry-run': 'boolean' },
  writes: true,
  async run(context) {
    const [id, stepId] = [context.args[0], context.args[1]]
    if (id === undefined || stepId === undefined) {
      return usage('btid remove task/<id>/step/<step-id>', context.out, context.json)
    }

    const handle = context.store.task(id)
    const before = handle.row
    const removed = before?.steps.find((step) => step.id === stepId.trim())
    const result = handle.removeStep(stepId)
    if (!result.ok) return refusal(result, context.out, context.json)

    const unchanged = before !== undefined && before.rev === result.value.rev
    const committed = await commit(context, `step remove ${id} ${stepId}`)
    if (committed !== null && committed !== 0) return committed

    context.result = result.value
    return printStepAnswer(context, result.value, unchanged, stepId, removed)
  },
}

// --- cache --------------------------------------------------------------------------

const cacheShow: Verb = {
  name: 'show cache',
  summary: 'Read one row.',
  usage: 'btid show cache [--json]',
  noStore: true,
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
  name: 'clear cache',
  summary: 'Drop every snapshot. The next read rebuilds them.',
  usage: 'btid clear cache [--json]',
  noStore: true,
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
  name: 'whoami',
  summary: 'Say which store this session points at, and who it acts as.',
  usage: 'btid whoami [--json]',
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
  name: 'init store',
  summary: 'Create a store in a repository: the config, and a roster holding you as manager.',
  usage: 'btid init store <owner/repo[@branch]> [--json]',
  writes: true,
  async run(context) {
    // The store is already created by the time a verb runs (the dispatcher uses initStore for this verb), so there is
    // nothing to write here — saying who it made is the whole answer. The location is saved by the dispatcher.
    const actor = context.store.actor
    if (context.json) {
      context.out.json({ created: true, store: context.location, manager: actor })
      return 0
    }
    context.out.line(`init  ${describeStore(context.location)}`)
    context.out.line(`      manager ${context.store.handle ?? '(unknown)'}`)
    return 0
  },
}

const storeSwitch: Verb = {
  name: 'switch store',
  summary: 'Point this machine at another store, and remember it.',
  usage: 'btid switch store <owner/repo[@branch]> [--json]',
  async run(context) {
    // The dispatcher has already opened it — opening is the validation, so a typo fails here rather than saving a
    // location every later command would choke on — and saved it, because switching is what this verb is for.
    if (context.json) {
      context.out.json({ store: context.location, manager: context.store.handle })
      return 0
    }
    context.out.line(`store  ${describeStore(context.location)}  (saved)`)
    context.out.line(`       manager ${context.store.handle ?? '(unknown)'}`)
    return 0
  },
}

const storeAdvance: Verb = {
  name: 'advance store',
  summary: "Move the store's clock forward, so the work that follows is stamped with that day.",
  usage: 'btid advance store <instant> [--json]',
  // A session act, not a write: it stages no row and commits nothing. It used to declare `writes: true` so that a plan
  // would accept it — the lie that `session` exists to end.
  session: true,
  async run(context) {
    const when = context.args[0]
    if (when === undefined || when.trim() === '') {
      return usage('btid advance store 2026-09-12T10:40:00+08:00', context.out, context.json)
    }

    const result = context.store.advanceTo(when)
    if (!result.ok) return refusal(result, context.out, context.json)

    // Nothing is staged and nothing is committed: the pin lives in this process's store, so the verb earns its keep as a
    // step inside a plan — the one place where a sequence of commands shares a store. On its own it changes nothing that
    // outlives the command, which the summary says by calling it "the work that follows".
    if (context.json) context.out.json({ at: result.value.at })
    else context.out.line(`clock  ${result.value.at}`)
    return 0
  },
}

const personImpersonate: Verb = {
  name: 'impersonate person/<id>',
  summary: 'Act as somebody on the roster: every write after this is theirs. The manager may.',
  usage: 'btid impersonate person/<id> [--json]',
  // A session act: it changes what the rows *after* it record, which is the whole reason a seeded plan needs it. Nothing is
  // committed for it, and a plan's stream of commands simply continues.
  session: true,
  async run(context) {
    const id = context.args[0]
    if (id === undefined) return usage('btid impersonate person/<id>', context.out, context.json)

    const result = context.store.impersonatePerson(id)
    if (!result.ok) return refusal(result, context.out, context.json)

    if (context.json) context.out.json(result.value)
    else context.out.line(`acting as  ${result.value.id}   ${result.value.role}`)
    return 0
  },
}

const unimpersonate: Verb = {
  name: 'unimpersonate',
  summary: 'Stop acting as somebody: the roster account comes back.',
  usage: 'btid unimpersonate [--json]',
  // Pathless: the act ends an impersonation rather than addressing a row, which is why it is a verb here and not a "stop"
  // path under `impersonate`. The tree holds nouns; "stop" was the only mode in it.
  session: true,
  async run(context) {
    context.store.stopImpersonating()
    const actor = context.store.actor
    if (context.json) context.out.json({ actor })
    else context.out.line(`acting as  ${actor?.id ?? '(nobody)'}   ${actor?.role ?? ''}`.trimEnd())
    return 0
  },
}

const version: Verb = {
  name: 'version',
  summary: 'Which btid this is, which schema it speaks, and whether a newer release exists.',
  usage: 'btid version [--json]',
  noStore: true,
  async run(context) {
    const line = versionLine(EXPECT)
    if (context.json) {
      context.out.json({ btid: CLI_VERSION, coreSchema: EXPECT, manifest: MANIFEST_VERSION, log: context.logTarget })
      return 0
    }
    context.out.line(line)

    // Once a day — the answer is cached under the same root as the snapshots, and a failure is cached too, so an offline
    // machine pays for the attempt once rather than on every command. `--json` never reaches this: machine output stays
    // offline, instant and unchanged. `--fresh` asks again.
    const reading = await checkForUpdate({
      current: CLI_VERSION,
      cachePath: join(context.cacheDir, 'update.json'),
      fresh: context.flags['fresh'] === true,
    })
    for (const notice of updateNotice(reading)) context.out.line(notice)

    // Where the log is going, said out loud: "there is no log" and "the log is somewhere else" look identical otherwise.
    context.out.line(
      context.logTarget.enabled && context.logTarget.path !== null
        ? `log  ${context.logTarget.path}`
        : 'log  off  (--no-log, or BTID_LOG=0)',
    )
    return 0
  },
}

/**
 * The handlers, by implementation. The grammar table carries the ones that apply to a verb × path; nothing dispatches on
 * these names, so the table is still the only list of what a person may type.
 */
export const HANDLERS = {
  taskLs,
  taskShow,
  taskNew,
  taskEdit,
  taskPromote,
  taskDemote,
  commentAdd,
  taskRemove,
  projectLs,
  projectShow,
  projectNew,
  projectEdit,
  projectArchive,
  exemptionAdd,
  exemptionRemove,
  projectMemberAdd,
  projectMemberRemove,
  projectLabelAdd,
  projectLabelRemove,
  projectRemove,
  personLs,
  personShow,
  personNew,
  personEdit,
  personRemove,
  labelLs,
  labelAdd,
  labelRemove,
  stepLs,
  stepShow,
  stepNew,
  stepRename,
  stepMove,
  tickStep,
  untickStep,
  stepRemove,
  cacheShow,
  cacheClear,
  storeInit,
  storeSwitch,
  storeWhoami,
  storeAdvance,
  personImpersonate,
  unimpersonate,
  plan,
  version,
} as const
