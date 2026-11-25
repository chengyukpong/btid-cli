import { ProjectSchema, TaskSchema, UserSchema } from '@chengyukpong/btid-core'
import {
  PATHS,
  VERB_NAMES,
  exampleOf,
  isVerb,
  pathsOf,
  rulesFor,
  summaryOf,
  verbsAt,
  type Rule,
} from './grammar'
import {
  CONCEPTS,
  EXIT_CODES,
  FLAG_HELP,
  GLOBAL_HELP,
  PLAN_FILE,
  USAGE_LINE,
  VERB_GROUPS,
  VERB_HELP,
  type FlagHelp,
} from './help-text'
import { CLI_VERSION, MANIFEST_VERSION } from './version'
import { usage, type Verb, type VerbContext } from './verb'

/** What a verb does to the store: nothing, one commit, a change to the session, or nothing that outlives the machine. */
type Kind = 'reads' | 'writes' | 'session' | 'binary'

/**
 * The kind of a verb.
 *
 * The order matters. `noStore` is a property of a *rule*, not a verb: `show` has a `show cache` rule that needs no store, and
 * asking "does any rule set noStore" would classify the whole verb as binary — which is what happened the first time.
 * A verb is binary only when **all** of its shapes are.
 */
const kindOf = (verb: string): Kind => {
  const rules = rulesFor(verb)
  if (rules.length === 0) return 'binary'
  if (rules.every((rule) => rule.handler.noStore === true)) return 'binary'
  if (rules.every((rule) => rule.handler.session === true)) return 'session'
  if (rules.some((rule) => rule.handler.writes === true)) return 'writes'
  return 'reads'
}

/** The verb's own sentence, falling back to its first handler's if somebody added a verb without one (a test forbids it). */
const verbSummary = (verb: string): string => VERB_HELP[verb] ?? summaryOf(verb)

/** What the kind means in one phrase, for the top of `help <verb>`. */
const KIND_WORDS: Record<Kind, string> = {
  reads: 'READS — asks the store, writes nothing',
  writes: 'WRITES — stages a change and commits once; --dry-run shows it without the commit',
  session: 'CHANGES THE SESSION — nothing staged, nothing committed',
  binary: 'ABOUT THE BINARY OR THE CACHE — needs no store',
}

/**
 * The line under a verb's name.
 *
 * `plan` writes but takes no `--dry-run`: it stages a whole file and commits at the end, and what it offers instead is
 * `--preview`, which runs nothing at all. The generic WRITES sentence promised a flag the verb refuses — the first thing
 * anybody tries, and the first thing that fails.
 */
const kindWords = (verb: string): string =>
  verb === 'plan'
    ? 'WRITES — one commit at the end; --preview reads the file and runs nothing'
    : KIND_WORDS[kindOf(verb)]

/** One rule's flags, described. Order is the handler's, so `edit` lists its fields in the order the row holds them. */
const flagsOfRule = (rule: Rule): FlagHelp[] =>
  Object.entries(rule.handler.flags ?? {}).map(([name, kind]) => ({
    name,
    takes: kind === 'value' ? 'value' : 'none',
    what: FLAG_HELP[name] ?? '(no description yet)',
  }))

/** The union of a verb's flags across its paths, described once each. */
const flagsOfVerb = (verb: string): FlagHelp[] => {
  const seen = new Map<string, FlagHelp>()
  for (const rule of rulesFor(verb)) {
    for (const flag of flagsOfRule(rule)) if (!seen.has(flag.name)) seen.set(flag.name, flag)
  }
  return [...seen.values()]
}

/** `--name <value>` or `--name`, unless the flag has a spelling of its own (`-v`). */
const flagText = (flag: FlagHelp): string =>
  flag.spell ?? (flag.takes === 'value' ? `--${flag.name} <value>` : `--${flag.name}`)

/**
 * The help page: one long page, not a lookup.
 *
 * It prints the whole table — every verb with the paths it takes, and every path with the verbs valid on it — because
 * reading it should cost one command, not a question per combination. There is deliberately no `btid help <path>`: a path
 * is data, and the command you run when you are lost must not require typing the thing you are lost about. The refusals
 * carry a path's verbs instead.
 *
 * The words come from `help-text.ts`, so the page is complete or a test fails — a verb with no sentence, or a flag with no
 * description, is a bug rather than a gap somebody is expected to live with.
 */
export const helpText = (): string => {
  const verbWidth = Math.max(...VERB_NAMES.map((verb) => verb.length), 8)
  const pathWidth = Math.max(...PATHS.map((path) => path.length))
  const flagWidth = Math.max(...GLOBAL_HELP.map((flag) => flagText(flag).length))
  const termWidth = Math.max(...CONCEPTS.map((concept) => concept.term.length))

  const verbsByGroup = VERB_GROUPS.flatMap((group) => [
    `  ${group.kind}`,
    ...group.verbs.map((verb) => `    ${verb.padEnd(verbWidth, ' ')}  ${verbSummary(verb)}`),
    '',
  ])

  return [
    `btid ${CLI_VERSION} — the BTID terminal`,
    '',
    `usage: ${USAGE_LINE}`,
    '',
    'A verb is what you do; a path is what you do it to. Nothing is both.',
    '',
    'WORDS',
    ...CONCEPTS.map((concept) => `  ${concept.term.padEnd(termWidth, ' ')}  ${concept.what}`),
    '',
    'VERBS',
    ...verbsByGroup,
    'VERBS × PATHS',
    ...VERB_NAMES.map((verb) => {
      const paths = pathsOf(verb)
      return `  ${verb.padEnd(verbWidth, ' ')}  ${paths.length === 0 ? '(no path)' : paths.join(' · ')}`
    }),
    '',
    'PATHS × VERBS',
    ...PATHS.map((path) => `  ${path.padEnd(pathWidth, ' ')}  ${verbsAt(path).join(', ')}`),
    '',
    'GLOBAL FLAGS — on every command',
    ...GLOBAL_HELP.map((flag) => `  ${flagText(flag).padEnd(flagWidth, ' ')}  ${flag.what}`),
    '',
    'EXIT CODES',
    ...EXIT_CODES.map((entry) => `  ${String(entry.code).padEnd(2, ' ')}  ${entry.when}`),
    '',
    'NEXT',
    '  btid help <verb>   one verb: every usage line, its flags, an example',
    '  btid help --json   the manifest: every rule with the flags it takes',
    '  btid plan          a file of commands, run in order against one store',
  ].join('\n')
}

/**
 * One field of a row, as the schema that validates it describes it.
 *
 * The list is read off `btid-core`'s own zod objects by `toJSONSchema()`, so there is no second definition of what a task is:
 * a field the store validates is a field an agent can name in `--fields` the day it lands, and a field that disappears
 * disappears here too.
 */
export interface FieldManifest {
  name: string
  type: string
  required: boolean
  values?: string[]
}

const fieldsOf = (schema: { toJSONSchema(): unknown }): FieldManifest[] => {
  const json = schema.toJSONSchema() as {
    properties?: Record<string, { type?: string; enum?: unknown[]; anyOf?: { type?: string }[] }>
    required?: string[]
  }
  const required = new Set(json.required ?? [])
  return Object.entries(json.properties ?? {}).map(([name, spec]) => {
    const type = spec.type ?? spec.anyOf?.map((part) => part.type).filter(Boolean).join('|') ?? 'unknown'
    const values = Array.isArray(spec.enum) ? spec.enum.map((value) => String(value)) : undefined
    return {
      name,
      type,
      required: required.has(name),
      ...(values === undefined ? {} : { values }),
    }
  })
}

/** The three row types, each with the fields its schema holds. */
export const TYPES = [
  { type: 'task', fields: fieldsOf(TaskSchema) },
  { type: 'project', fields: fieldsOf(ProjectSchema) },
  { type: 'person', fields: fieldsOf(UserSchema) },
] as const

/**
 * The manifest, version 3: **one entry per rule**, each with the flags *that rule* takes.
 *
 * Version 2 listed a verb's flags unioned over its paths, which was enough to describe a grammar where every verb meant the
 * same thing everywhere — and wrong the moment a reader asked "may I pass `--percent` to `edit project/<id>`?". It may not,
 * and v2 could not say so. Here a verb's `paths[]` carries the usage line and the flags of each shape, so an agent can
 * check its own command before running it.
 *
 * `version` is this CLI's; `manifest` is the shape's. They move for different reasons, so a consumer can pin either.
 */
export const manifest = (): unknown => ({
  name: 'btid',
  version: CLI_VERSION,
  manifest: MANIFEST_VERSION,
  usage: USAGE_LINE,
  verbs: VERB_NAMES.map((verb) => {
    const kind = kindOf(verb)
    return {
      verb,
      summary: verbSummary(verb),
      kind,
      writes: kind === 'writes',
      session: kind === 'session',
      example: exampleOf(verb) ?? null,
      // `plan`'s argument is a file, and a file needs its grammar in the manifest too: an agent reads this, not `docs/`.
      ...(verb === 'plan' ? { file: PLAN_FILE } : {}),
      paths: rulesFor(verb).map((rule) => ({
        path: rule.path,
        usage: rule.handler.usage,
        flags: flagsOfRule(rule).map((flag) => ({ name: flag.name, value: flag.takes === 'value', what: flag.what })),
      })),
    }
  }),
  paths: PATHS.map((path) => ({ path, verbs: verbsAt(path) })),
  globals: GLOBAL_HELP.map((flag) => ({ name: flag.name, value: flag.takes === 'value', what: flag.what })),
  exitCodes: EXIT_CODES.map((entry) => ({ code: entry.code, when: entry.when })),
  types: TYPES,
})

/** `btid help <verb>`: what it does to the store, every usage line, its flags with descriptions, and an example. */
const verbPage = (context: VerbContext, verb: string): number => {
  const flags = flagsOfVerb(verb)
  const width = Math.max(...flags.map((flag) => flagText(flag).length), 0)
  context.out.line(`${verb} — ${verbSummary(verb)}`)
  context.out.line(`  ${kindWords(verb)}`)
  context.out.line('')
  // One block per shape: the usage line, then what *that* shape does — `add task/<id>/comment` and
  // `remove project/<id>/member` are different acts that share a verb.
  const shapes = rulesFor(verb)
  for (const rule of shapes) {
    context.out.line(`  ${rule.handler.usage}`)
    if (shapes.length > 1) context.out.line(`      ${rule.handler.summary}`)
  }
  context.out.line('')
  if (flags.length === 0) {
    context.out.line('  FLAGS  none — everything this verb needs is in the path or the data')
  } else {
    context.out.line('  FLAGS')
    for (const flag of flags) context.out.line(`    ${flagText(flag).padEnd(width, ' ')}   ${flag.what}`)
  }

  // A plan is the one verb whose input is a file, so its page has to teach the file: the grammar, then a whole example that
  // runs. Without this the page named `seed.btid` and never said what a `seed.btid` looks like.
  if (verb === 'plan') {
    context.out.line('')
    context.out.line('  FILE')
    for (const line of PLAN_FILE.grammar) context.out.line(`    ${line}`)
    context.out.line('')
    context.out.line('  A WHOLE FILE')
    for (const line of PLAN_FILE.example) context.out.line(`    ${line}`)
  }

  const example = exampleOf(verb)
  if (example !== undefined) {
    context.out.line('')
    context.out.line(`  EXAMPLE  ${example}`)
  }
  context.out.line('')
  const globals = GLOBAL_HELP.map((flag) => (flag.takes === 'value' ? `--${flag.name}` : flag.spell ?? `--${flag.name}`))
  context.out.line('  Every command also takes: ' + globals.join(', '))
  return 0
}

export const help: Verb = {
  name: 'help',
  summary: 'Print the grammar, or explain one verb.',
  usage: 'btid help [verb] [--json]',
  flags: { json: 'boolean' },
  noStore: true,
  async run(context: VerbContext) {
    if (context.json) {
      context.out.json(manifest())
      return 0
    }
    if (context.args.length === 0) {
      context.out.line(helpText())
      return 0
    }

    const wanted = context.args.join(' ')
    if (isVerb(wanted)) return verbPage(context, wanted)

    // The path roots, read off the tree at call time (help is loaded while the table is still being built).
    const pathWords = new Set(PATHS.map((path) => path.split('/')[0]!))

    // An old two-word verb in the data slot: name the new `help` form rather than treating it as a topic.
    if (context.args.length === 2 && pathWords.has(context.args[0]!) && isVerb(context.args[1]!)) {
      return usage(`the grammar is btid help ${context.args[1]}`, context.out, context.json)
    }
    // A path is data, not a help topic. There is deliberately no `btid help <path>`.
    if (pathWords.has(wanted) || wanted.includes('/')) {
      return usage(`“${wanted}” is a path, not a verb. btid help takes a verb: btid help edit.`, context.out, context.json)
    }
    return usage(`no verb called “${wanted}”. Run btid help.`, context.out, context.json)
  },
}

/** Re-exported so a test can render rows the same way the verbs do. */
export { printRows } from './verb'
