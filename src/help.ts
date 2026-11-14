import { ProjectSchema, TaskSchema, UserSchema } from 'btid-core'
import {
  PATHS,
  VERB_NAMES,
  exampleOf,
  isVerb,
  pathsOf,
  rulesFor,
  summaryOf,
  verbsAt,
} from './grammar'
import { CLI_VERSION, MANIFEST_VERSION } from './version'
import { usage, type Verb, type VerbContext } from './verb'

/** The flags a verb takes, unioned over its paths, so `help <verb>` can list them once. */
const flagsOfVerb = (verb: string): { name: string; value: boolean }[] => {
  const kinds = new Map<string, 'value' | 'boolean'>()
  for (const rule of rulesFor(verb)) {
    for (const [name, kind] of Object.entries(rule.handler.flags ?? {})) {
      if (!kinds.has(name)) kinds.set(name, kind)
    }
  }
  return [...kinds].map(([name, kind]) => ({ name, value: kind === 'value' }))
}

/**
 * The help page: one long page, not a lookup.
 *
 * It prints the whole table — every verb with the paths it takes, and every path with the verbs valid on it — because
 * reading it should cost one command, not a question per combination. There is deliberately no `btid help <path>`: a path
 * is data, and the command you run when you are lost must not require typing the thing you are lost about. The refusals
 * carry a path's verbs instead.
 */
export const helpText = (): string => {
  const verbWidth = Math.max(...VERB_NAMES.map((verb) => verb.length))
  const pathWidth = Math.max(...PATHS.map((path) => path.length))
  return [
    'btid — the BTID terminal',
    '',
    'usage: btid <verb> <path> [data] [--flags]',
    '',
    'VERBS × PATHS',
    ...VERB_NAMES.map((verb) => {
      const paths = pathsOf(verb)
      return `  ${verb.padEnd(verbWidth, ' ')}  ${paths.length === 0 ? '—' : paths.join(' · ')}`
    }),
    '',
    'PATHS × VERBS',
    ...PATHS.map((path) => `  ${path.padEnd(pathWidth, ' ')}  ${verbsAt(path).join(', ')}`),
    '',
    'VERBS',
    ...VERB_NAMES.map((verb) => `  ${verb.padEnd(verbWidth, ' ')}  ${summaryOf(verb)}`),
    '',
    'Exit codes: 0 ok, 1 refused, 2 usage. Every command takes --json.',
    'Run btid help <verb> for its flags and one example.',
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
 * The manifest, version 2: grammar-shaped.
 *
 * `version` is this CLI's; `manifest` is the shape's. They are separate numbers on purpose: a change to the CLI that adds a
 * verb moves the first, a change to the manifest that moves a field's meaning moves the second, and a consumer can pin
 * either without being told the other one moved.
 *
 * An agent needs to know which combinations are legal, not just which words exist: `verbs[]` says what each verb applies
 * to, and the `paths[]` index answers the other direction — which verbs are valid at a path.
 */
export const manifest = (): unknown => ({
  name: 'btid',
  version: CLI_VERSION,
  manifest: MANIFEST_VERSION,
  verbs: VERB_NAMES.map((verb) => ({
    verb,
    summary: summaryOf(verb),
    paths: pathsOf(verb),
    flags: flagsOfVerb(verb),
    writes: rulesFor(verb).some((rule) => rule.handler.writes === true),
  })),
  paths: PATHS.map((path) => ({ path, verbs: verbsAt(path) })),
  types: TYPES,
  exitCodes: { ok: 0, refused: 1, usage: 2 },
})

/** `btid help <verb>`: its paths, every usage line, its flags, and one example. */
const verbPage = (context: VerbContext, verb: string): number => {
  context.out.line(`${verb} — ${summaryOf(verb)}`)
  const paths = pathsOf(verb)
  context.out.line(`  paths: ${paths.length === 0 ? '(no path)' : paths.join(' · ')}`)
  for (const rule of rulesFor(verb)) {
    context.out.line(`  usage: ${rule.handler.usage}`)
  }
  const flags = flagsOfVerb(verb)
  if (flags.length > 0) context.out.line(`  flags: ${flags.map((flag) => `--${flag.name}`).join(', ')}`)
  const example = exampleOf(verb)
  if (example !== undefined) context.out.line(`  example: ${example}`)
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
