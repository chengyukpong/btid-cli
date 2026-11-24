import { readFileSync } from 'node:fs'
import { isPathless, isVerb, resolve, type Rule } from './grammar'
import type { Output } from './output'
import type { VerbContext } from './verb'

/**
 * A plan: one file, one process, one store, a list of commands run in order.
 *
 * A step is the grammar's own `verb + path + data`, so the line form and the terminal cannot drift: the file is either
 * **commands** (one per line, parsed by the same flag parser) or **JSON** (the same steps with unambiguous values). Both
 * compile to the same `Step`, and the runner resolves each step through the one table in `grammar.ts`.
 *
 * What a step may be is decided here, not by the runner: a mutation, a `show`, or `whoami`. A plan cannot list (`ls` is a
 * report) — but it **can** change identity, through `impersonate`, which the core grants to the manager alone. That is what
 * makes a seeded history attributed to the people who did the work rather than to the login that wrote it.
 */

export interface Step {
  /** The name the step's result is bound to: `let task = new task --project alpha …`. */
  name?: string
  verb: string
  /** The path token, possibly containing a reference: `task/$task.id`. `''` for a pathless verb. */
  path: string
  args: string[]
  flags: Record<string, string | boolean>
  /** The line it came from, so a refusal can point at the file rather than at a step number. */
  at: number
}

export interface Plan {
  about?: string
  steps: Step[]
}

const MAX_LINES = 500

/** A reference: `$task.id`, or the JSON form `{"$ref": "task.id"}`. */
const REF = /^\$([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/

/** A reference anywhere in a string: a path is text with a reference inside it, not a reference by itself. */
const REF_IN_TEXT = /\$([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?/g

/** Split a command line the way the terminal would: quotes group, everything else is whitespace. */
export function tokenize(line: string): string[] | { message: string } {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!
    if (quote !== null) {
      if (char === quote) quote = null
      else if (char === '\\' && line[i + 1] === quote) {
        current += quote
        i += 1
      } else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started || current !== '') {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (quote !== null) return { message: `a quoted argument is not closed: ${line.trim()}` }
  if (started || current !== '') tokens.push(current)
  return tokens
}

/**
 * A plan as commands.
 *
 * `let <name> = <verb> <path> …` binds the step's result; `#` starts a comment. Shell syntax is refused **by name**
 * rather than half-supported: a file that looks like a shell script and is not one is worse than either.
 */
function parseLines(text: string): Plan | { message: string } {
  const steps: Step[] = []
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line === '' || line.startsWith('#')) continue
    if (steps.length >= MAX_LINES) return { message: `a plan is at most ${MAX_LINES} steps; this one is longer` }

    for (const shell of ['&&', '||', '|', ';', '>', '<', '`', '$(']) {
      if (line.includes(shell)) {
        return { message: `a plan line cannot use “${shell}”; a plan is not a shell` }
      }
    }
    // `$VAR` is environment syntax; `$name.field` is a plan reference. Only the second one is a thing.
    if (/\$[A-Z_]+/.test(line)) {
      return { message: 'a plan line cannot read the environment; a plan is not a shell' }
    }

    let rest = line
    let name: string | undefined
    const binding = /^let\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(rest)
    if (binding !== null) {
      name = binding[1]!
      rest = binding[2]!
    }

    const tokens = tokenize(rest)
    if (!Array.isArray(tokens)) return tokens
    if (tokens.length === 0) continue

    const verb = tokens[0]!
    if (!isVerb(verb)) {
      // An old spelling in a plan gets the same teaching the terminal gives one.
      const teaching = resolve(tokens)
      return {
        message:
          teaching.kind === 'refusal'
            ? teaching.message
            : `no verb called “${verb}”. A plan line is btid <verb> <path> [data].`,
      }
    }

    const pathless = isPathless(verb)
    const path = pathless ? '' : tokens[1]
    if (!pathless && path === undefined) return { message: `${verb} needs a path. Run btid help.` }

    const routed = pathless ? resolve([verb]) : resolve([verb, path!])
    if (routed.kind === 'refusal') return { message: routed.message }
    if (routed.kind !== 'rule') return { message: 'that plan has no steps' }

    const flags = flagsOf(routed.rule, pathless ? tokens.slice(1) : tokens.slice(2))
    if ('message' in flags) return flags
    steps.push({
      ...(name === undefined ? {} : { name }),
      verb: routed.rule.verb,
      path: path ?? '',
      args: flags.args,
      flags: flags.flags,
      at: index + 1,
    })
  }

  return { steps }
}

/** The verb's own flags, read the way the terminal reads them: a flag it does not take is a usage error naming its flags. */
function flagsOf(
  rule: Rule,
  tokens: readonly string[],
): { args: string[]; flags: Record<string, string | boolean> } | { message: string } {
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  const known = rule.handler.flags ?? {}
  const form = rule.path === null ? rule.verb : `${rule.verb} ${rule.path}`

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (!token.startsWith('--')) {
      args.push(token)
      continue
    }
    const [rawName, inline] = token.slice(2).split('=', 2) as [string, string | undefined]
    const kind = known[rawName]
    if (kind === undefined) {
      const takes = Object.keys(known).map((flag) => `--${flag}`)
      return {
        message:
          takes.length === 0
            ? `${form} takes no flags, and “--${rawName}” is not one`
            : `${form} does not take --${rawName}. It takes ${takes.join(', ')}.`,
      }
    }
    if (kind === 'boolean') {
      flags[rawName] = inline === undefined ? true : inline !== 'false'
      continue
    }
    const value = inline ?? tokens[i + 1]
    if (value === undefined) return { message: `--${rawName} needs a value` }
    flags[rawName] = value
    if (inline === undefined) i += 1
  }

  return { args, flags }
}

/** The JSON form: `{"steps": […]}` or a bare array, with each step `verb + path + args + flags`. */
function parseJson(text: string): Plan | { message: string } {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    return { message: `the plan is not JSON: ${(error as Error).message}` }
  }

  const steps: unknown[] = Array.isArray(document)
    ? document
    : typeof document === 'object' && document !== null && Array.isArray((document as { steps?: unknown }).steps)
      ? ((document as { steps: unknown[] }).steps as unknown[])
      : [document]

  const parsed: Step[] = []
  for (let index = 0; index < steps.length; index += 1) {
    const raw = steps[index] as Record<string, unknown> | null
    if (raw === null || typeof raw !== 'object' || typeof raw['verb'] !== 'string') {
      return { message: `step ${index + 1} has no "verb"` }
    }
    const verb = raw['verb'] as string
    if (!isVerb(verb)) return { message: `step ${index + 1}: no verb called “${verb}”` }

    const pathless = isPathless(verb)
    let path = ''
    if (!pathless) {
      const candidate = raw['path']
      if (candidate === undefined) return { message: `step ${index + 1} has no "path"` }
      path = typeof candidate === 'string' ? candidate : String(valueOf(candidate))
    }

    const routed = pathless ? resolve([verb]) : resolve([verb, path])
    if (routed.kind === 'refusal') return { message: `step ${index + 1}: ${routed.message}` }
    if (routed.kind !== 'rule') return { message: `step ${index + 1}: that step names nothing` }

    const args = raw['args']
    if (args !== undefined && !Array.isArray(args)) return { message: `step ${index + 1}: "args" must be a list` }
    const flags = raw['flags']
    if (flags !== undefined && (typeof flags !== 'object' || flags === null || Array.isArray(flags))) {
      return { message: `step ${index + 1}: "flags" must be an object` }
    }
    const unknown = Object.keys((flags ?? {}) as Record<string, unknown>).find(
      (flag) => (routed.rule.handler.flags ?? {})[flag] === undefined,
    )
    if (unknown !== undefined) {
      const takes = Object.keys(routed.rule.handler.flags ?? {}).map((flag) => `--${flag}`)
      const form = routed.rule.path === null ? routed.rule.verb : `${routed.rule.verb} ${routed.rule.path}`
      return { message: `step ${index + 1}: ${form} does not take --${unknown}. It takes ${takes.join(', ')}.` }
    }

    const name = raw['name'] ?? raw['let']
    parsed.push({
      ...(typeof name === 'string' ? { name } : {}),
      verb: routed.rule.verb,
      path,
      args: (args ?? []).map((arg) => {
        const value = valueOf(arg)
        return typeof value === 'string' ? value : String(value)
      }),
      flags: Object.fromEntries(
        Object.entries((flags ?? {}) as Record<string, unknown>).map(([flag, value]) => [flag, valueOf(value)]),
      ) as Record<string, string | boolean>,
      at: index + 1,
    })
  }
  return { ...(typeof (document as { about?: unknown }).about === 'string' ? { about: (document as { about: string }).about } : {}), steps: parsed }
}

/** A JSON step value: `{"$ref": "task.id"}` is the reference syntax, written as an object. */
const valueOf = (value: unknown): string | boolean => {
  if (value !== null && typeof value === 'object' && typeof (value as { $ref?: unknown }).$ref === 'string') {
    // The `$` matters: it is the reference syntax, and an id without it is a string that merely looks like one.
    return '$' + String((value as { $ref: string }).$ref)
  }
  return typeof value === 'boolean' ? value : String(value)
}

/** Read a plan from a path, or from stdin when the path is `-`. */
export function readPlan(path: string, stdin = ''): Plan | { message: string } {
  const text = path === '-' ? stdin : readFileSync(path, 'utf8')
  const trimmed = text.trimStart()
  const plan = trimmed.startsWith('{') || trimmed.startsWith('[') ? parseJson(text) : parseLines(text)
  if ('message' in plan) return plan
  return check(plan)
}

/**
 * Every step checked before the first request.
 *
 * The two rules that are not about spelling: a plan may not list, and it may not change identity. Both are refusals rather
 * than omissions, because a plan that could do either would be a different tool.
 */
export function check(plan: Plan): Plan | { message: string } {
  const bound = new Set<string>()
  for (const step of plan.steps) {
    const routed = step.path === '' ? resolve([step.verb]) : resolve([step.verb, step.path])
    if (routed.kind === 'refusal') return { message: `step ${step.at}: ${routed.message}` }
    if (routed.kind !== 'rule') return { message: `step ${step.at}: that step names nothing` }
    const { rule } = routed
      // A plan writes everything at the end, while an archive tags the commit it starts from - so the tag would name a
      // state the plan's own work is not in yet. Refused by name rather than left to fail inside the engine.
      if (rule.verb === 'archive') {
        return { message: `step ${step.at}: a plan commits at the end; archive tags the commit it starts from` }
      }

    const reads = rule.verb === 'show' || rule.verb === 'whoami'
    // A step is a command: one that writes, one that changes the session (`advance`, `impersonate`), or one that reads.
    // Anything else is a report, and a plan of reports is a file that does nothing.
    const command = rule.handler.writes === true || rule.handler.session === true
    if (!command && !reads) {
      return { message: `a plan runs commands; “${rule.verb}” is a report` }
    }

    // A flag the shape cannot do without, refused here rather than at the step that needs it: `--preview` promises to read the
    // file before anything runs, and a file that dies at step fourteen has not been read, it has been started.
    const missing = (rule.handler.needs ?? []).filter((flag) => step.flags[flag] === undefined)
    if (missing.length > 0) {
      const form = rule.path === null ? rule.verb : `${rule.verb} ${rule.path}`
      return {
        message: `step ${step.at}: ${form} needs ${missing.map((flag) => `--${flag}`).join(', ')} — ${rule.handler.usage}`,
      }
    }
    for (const [index, arg] of step.args.entries()) {
      const problem = checkRef(arg, bound)
      if (problem !== null) return { message: `step ${step.at}: ${problem}` }
      step.args[index] = arg
    }
    for (const [flag, value] of Object.entries(step.flags)) {
      if (typeof value !== 'string') continue
      const problem = checkRef(value, bound)
      if (problem !== null) return { message: `step ${step.at}: ${problem}` }
    }
    // A reference inside a path is text, not a whole value: `task/$task.id` is interpolated before routing.
    const pathProblem = step.path === '' ? null : checkRefsIn(step.path, bound)
    if (pathProblem !== null) return { message: `step ${step.at}: ${pathProblem}` }
    // A name is only usable from the step after the one that binds it.
    if (step.name !== undefined) {
      if (bound.has(step.name)) return { message: `step ${step.at}: “${step.name}” is already bound` }
      bound.add(step.name)
    }
  }
  return plan
}

/** A reference must name a variable that exists and a field; the value is resolved at run time, from the result. */
function checkRef(value: string, bound: ReadonlySet<string>): string | null {
  const match = REF.exec(value)
  if (match === null) return null
  const [, variable, field] = match
  if (!bound.has(variable!)) return `$: “${variable}” is not bound by an earlier step`
  if (field === undefined) return `$: “${value}” is a result, not a value — write ${value}.id`
  return null
}

/** Every reference inside a path segment: `task/$task.id` is fine, `task/$task` is not a value. */
function checkRefsIn(text: string, bound: ReadonlySet<string>): string | null {
  for (const match of text.matchAll(REF_IN_TEXT)) {
    const variable = match[1]!
    const field = match[2]
    if (!bound.has(variable)) return `$: “${variable}” is not bound by an earlier step`
    if (field === undefined) return `$: “${match[0]}” is a result, not a value — write ${match[0]}.id`
  }
  return null
}

export interface PlanRun {
  /** The verb's own exit code, or `0`. */
  code: number
  /** Lines the plan printed, for the caller's summary. */
  steps: { at: number; verb: string; path: string; ok: boolean; code: number }[]
}

/**
 * Run a plan.
 *
 * `commit: 'each'` lets every write commit as it happens — partial progress is real and visible. `commit: 'end'` defers them:
 * the messages are kept, nothing reaches the repository until the last step, and one commit writes them all. A failure under
 * `end` therefore leaves the store exactly as it was.
 */
export async function runPlan(
  context: VerbContext,
  plan: Plan,
  options: { commit: 'each' | 'end'; keepGoing: boolean },
): Promise<PlanRun> {
  const results: PlanRun['steps'] = []
  const bindings = new Map<string, unknown>()
  const deferred: string[] = []
  let code = 0

  for (const step of plan.steps) {
    const resolved = interpolate(step, bindings)
    if ('message' in resolved) {
      context.out.line(`usage: step ${step.at}: ${resolved.message}`)
      return { code: 2, steps: results }
    }

    // Route the interpolated path through the one resolver; its ids are what the handler reads in front of the data.
    const routed = resolved.path === '' ? resolve([step.verb]) : resolve([step.verb, resolved.path])
    if (routed.kind !== 'rule') {
      const message = routed.kind === 'refusal' ? routed.message : 'that step names nothing'
      context.out.line(`usage: step ${step.at}: ${message}`)
      return { code: 2, steps: results }
    }
    const { rule } = routed
    // Output from a read or a session act goes straight to the terminal — "acting as ivan-petrov" is the point of the step,
    // and a session act has no commit to print it after. A write's own line is buffered instead, because an uncommitted write
    // that prints as though it landed is the one lie this runner must not tell.
    const isRead = rule.handler.writes !== true && rule.handler.session !== true

    const buffer: string[] = []
    const sink: Output = isRead
      ? context.out
      : ({ line: (text: string) => buffer.push(text), json: (value: unknown) => buffer.push(JSON.stringify(value)) } as unknown as Output)
    const child: VerbContext = {
      ...context,
      args: rule.args(routed.ids, resolved.args),
      path: routed.path,
      form: rule.path === null ? rule.verb : `${rule.verb} ${routed.path}`,
      flags: resolved.flags,
      out: sink,
      json: context.json && isRead,
      ...(options.commit === 'end' ? { defer: deferred } : {}),
    }

    let stepCode = 0
    try {
      stepCode = await rule.handler.run(child)
    } catch (error) {
      context.out.line(`fault: step ${step.at}: ${(error as Error).message}`)
      return { code: 2, steps: results }
    }

    const ok = stepCode === 0
    const position = results.length + 1
    if (!ok) for (const text of buffer) context.out.line(text)
    const display = step.path === '' ? step.verb : `${step.verb} ${step.path}`
    if (!context.json && !context.flags['quiet']) {
      context.out.line(`${ok ? 'ok  ' : 'no  '}${String(position).padStart(2)}  ${display}${ok ? '' : `   (${stepCode === 2 ? 'usage' : 'refused'})`}`)
    }
    results.push({ at: step.at, verb: step.verb, path: step.path, ok, code: stepCode })
    if (ok && step.name !== undefined) bindings.set(step.name, child.result)
    if (!ok) {
      code = stepCode === 0 ? 1 : stepCode
      if (!options.keepGoing) break
    }
    if (isRead && !context.json && isReadOutput(rule)) {
      // The verb printed the row; keep the transcript readable by saying which step printed it.
      context.out.line(`  (step ${position})`)
    }
  }

  if (options.commit === 'end' && deferred.length > 0 && code === 0) {
    try {
      context.committed = await context.store.commit(deferred.join('; '))
    } catch (error) {
      context.out.line(`fault: the plan could not be committed: ${(error as Error).message}`)
      return { code: 2, steps: results }
    }
  }

  return { code, steps: results }
}

const isReadOutput = (rule: Rule): boolean => rule.verb === 'show' || rule.verb === 'whoami'

/** Interpolate `$var.field` in the path, the data and the flags — before the step is routed. */
function interpolate(
  step: Step,
  bindings: ReadonlyMap<string, unknown>,
): { path: string; args: string[]; flags: Record<string, string | boolean> } | { message: string } {
  const one = (value: unknown): string | { message: string } => {
    if (typeof value !== 'string') return String(value)
    const match = REF.exec(value)
    if (match === null) return value
    const [, variable, field] = match
    if (!bindings.has(variable!)) return { message: `“${variable}” is not bound by an earlier step` }
    const result = bindings.get(variable!)
    if (field === undefined) return { message: `“${value}” is a result, not a value — write ${value}.id` }
    if (result === null || typeof result !== 'object') return { message: `“${variable}” has no fields to read` }
    const fields = Object.keys(result as Record<string, unknown>)
    if (!fields.includes(field)) {
      return { message: `“${variable}” has no field “${field}”. It has: ${fields.join(', ')}` }
    }
    return String((result as Record<string, unknown>)[field])
  }

  // A path is text with a reference inside it: `task/$task.id` → `task/alpha-n7qk`. Whole-string `$task` in a path is
  // caught by `checkRefsIn`; here a MISSING binding is still worth a sentence rather than a path that quietly routes wrong.
  let path = step.path
  for (const match of step.path.matchAll(REF_IN_TEXT)) {
    const variable = match[1]!
    const field = match[2]
    if (field === undefined) return { message: `“${match[0]}” is a result, not a value — write ${match[0]}.id` }
    if (!bindings.has(variable)) return { message: `“${variable}” is not bound by an earlier step` }
    const result = bindings.get(variable)
    if (result === null || typeof result !== 'object') return { message: `“${variable}” has no fields to read` }
    const fields = Object.keys(result as Record<string, unknown>)
    if (!fields.includes(field)) {
      return { message: `“${variable}” has no field “${field}”. It has: ${fields.join(', ')}` }
    }
    path = path.replace(match[0], String((result as Record<string, unknown>)[field]))
  }

  const args: string[] = []
  for (const arg of step.args) {
    const value = one(arg)
    if (typeof value !== 'string') return value
    args.push(value)
  }
  const flags: Record<string, string | boolean> = {}
  for (const [flag, value] of Object.entries(step.flags)) {
      // A boolean flag stays a boolean: `true` stringified to "true" is not `=== true`, and every switch in the
      // handlers reads it that way. (Found by a seed plan whose `remove --yes` kept asking for `--yes`.)
      if (typeof value === 'boolean') {
        flags[flag] = value
        continue
      }
    const resolved = one(value)
    if (typeof resolved !== 'string') return resolved
    flags[flag] = resolved
  }
  return { path, args, flags }
}
