import { readFileSync } from 'node:fs'
import type { Output } from './output'
import { findVerb, isPlanStep } from './verbs'
import type { Verb, VerbContext } from './verb'

/**
 * A plan: one file, one process, one store, a list of commands run in order.
 *
 * The file is either **commands** (one per line, parsed by the same flag parser the terminal uses) or **JSON** (the same
 * steps with unambiguous values). Both compile to the same `Step`, so the runner does not know which it was given — and a
 * line file cannot drift from the CLI's grammar, because it *is* that grammar.
 *
 * What a step may be is decided here, not by the runner: a mutation, a `show`, or `whoami`. A plan cannot list (`ls` is a
 * report), cannot change identity (there is no verb for it, and the check refuses one by name if one ever appears), and
 * cannot compute — a reference reads one field off the result of an earlier step, and that is all.
 */

export interface Step {
  /** The name the step's result is bound to: `let task = task new …`. */
  name?: string
  verb: string
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
 * `let <name> = <verb> …` binds the step's result; `#` starts a comment. Shell syntax is refused **by name** rather than
 * half-supported: a file that looks like a shell script and is not one is worse than either.
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

    const verb = findVerb(tokens[0]!)
    if (verb === undefined) {
      const two = tokens[1] === undefined ? '' : ` ${tokens[1]}`
      const twoWord = findVerb(`${tokens[0]}${two}`)
      if (twoWord === undefined) return { message: `no verb called “${tokens[0]}”` }
      const flags = flagsOf(twoWord, tokens.slice(2))
      if ('message' in flags) return flags
      steps.push({ ...(name === undefined ? {} : { name }), verb: twoWord.name, args: flags.args, flags: flags.flags, at: index + 1 })
      continue
    }

    const flags = flagsOf(verb, tokens.slice(1))
    if ('message' in flags) return flags
    steps.push({ ...(name === undefined ? {} : { name }), verb: verb.name, args: flags.args, flags: flags.flags, at: index + 1 })
  }

  return { steps }
}

/** The verb's own flags, read the way the terminal reads them: a flag it does not take is a usage error naming its flags. */
function flagsOf(
  verb: Verb,
  tokens: readonly string[],
): { args: string[]; flags: Record<string, string | boolean> } | { message: string } {
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  const known = verb.flags ?? {}

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
            ? `${verb.name} takes no flags, and “--${rawName}” is not one`
            : `${verb.name} does not take --${rawName}. It takes ${takes.join(', ')}.`,
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

/** The JSON form: `{"steps": […]}` or a bare array, with each step the same four keys. */
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
    const verb = findVerb(raw['verb'] as string)
    if (verb === undefined) return { message: `no verb called “${raw['verb']}”` }

    const args = raw['args']
    if (args !== undefined && !Array.isArray(args)) return { message: `step ${index + 1}: "args" must be a list` }
    const flags = raw['flags']
    if (flags !== undefined && (typeof flags !== 'object' || flags === null || Array.isArray(flags))) {
      return { message: `step ${index + 1}: "flags" must be an object` }
    }
    const unknown = Object.keys((flags ?? {}) as Record<string, unknown>).find((flag) => (verb.flags ?? {})[flag] === undefined)
    if (unknown !== undefined) {
      const takes = Object.keys(verb.flags ?? {}).map((flag) => `--${flag}`)
      return { message: `step ${index + 1}: ${verb.name} does not take --${unknown}. It takes ${takes.join(', ')}.` }
    }

    const name = raw['name'] ?? raw['let']
    parsed.push({
      ...(typeof name === 'string' ? { name } : {}),
      verb: verb.name,
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
    if (!isPlanStep(step.verb)) {
      return {
        message:
          step.verb.includes('impersonate') || step.verb.includes('signout')
            ? `a plan runs as one login; “${step.verb}” would change who that is`
            : `a plan runs commands; “${step.verb}” is a report`,
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

export interface PlanRun {
  /** The verb's own exit code, or `0`. */
  code: number
  /** Lines the plan printed, for the caller's summary. */
  steps: { at: number; verb: string; ok: boolean; code: number }[]
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
    const verb = findVerb(step.verb)!
    const resolved = resolve(step, bindings)
    if ('message' in resolved) {
      context.out.line(`usage: step ${step.at}: ${resolved.message}`)
      return { code: 2, steps: results }
    }

    const isRead = verb.writes !== true
    const buffer: string[] = []
    const sink: Output = isRead
      ? context.out
      : ({ line: (text: string) => buffer.push(text), json: (value: unknown) => buffer.push(JSON.stringify(value)) } as unknown as Output)
    const child: VerbContext = {
      ...context,
      args: resolved.args,
      flags: resolved.flags,
      out: sink,
      json: context.json && isRead,
      ...(options.commit === 'end' ? { defer: deferred } : {}),
    }

    let stepCode = 0
    try {
      stepCode = await verb.run(child)
    } catch (error) {
      context.out.line(`fault: step ${step.at}: ${(error as Error).message}`)
      return { code: 2, steps: results }
    }

    const ok = stepCode === 0
    if (!ok) for (const text of buffer) context.out.line(text)
    results.push({ at: step.at, verb: step.verb, ok, code: stepCode })
    if (ok && step.name !== undefined) bindings.set(step.name, child.result)
    if (!ok) {
      code = stepCode === 0 ? 1 : stepCode
      if (!options.keepGoing) break
    }
    if (isRead && !context.json && isReadOutput(step.verb)) {
      // The verb printed the row; keep the transcript readable by saying which step printed it.
      context.out.line(`  (step ${step.at})`)
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

const isReadOutput = (verb: string): boolean => verb.endsWith(' show') || verb.endsWith('whoami')

/** Resolve `$var.field` against the step's bindings. */
function resolve(
  step: Step,
  bindings: ReadonlyMap<string, unknown>,
): { args: string[]; flags: Record<string, string | boolean> } | { message: string } {
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

  const args: string[] = []
  for (const arg of step.args) {
    const value = one(arg)
    if (typeof value !== 'string') return value
    args.push(value)
  }
  const flags: Record<string, string | boolean> = {}
  for (const [flag, value] of Object.entries(step.flags)) {
    const resolved = one(value)
    if (typeof resolved !== 'string') return resolved
    flags[flag] = resolved
  }
  return { args, flags }
}
