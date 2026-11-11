import { ProjectSchema, TaskSchema, UserSchema } from 'btid-core'
import { CLI_VERSION, MANIFEST_VERSION } from './version'
import { usage, type Verb, type VerbContext } from './verb'
import { VERBS } from './verbs'

/** Every flag name the registry knows, so `help` can be generated rather than kept in step by hand. */
const flagNames = (verb: Verb): string[] => Object.keys(verb.flags ?? {})

export const helpText = (from: readonly Verb[] = VERBS): string => {
  const width = Math.max(...from.map((verb) => verb.name.length))
  return [
    'btid — the BTID terminal',
    '',
    'usage: btid <type> <verb> [args] [flags]',
    '',
    ...from.map((verb) => `  ${verb.name.padEnd(width, ' ')}  ${verb.summary}`),
    '',
    'Every command reads `--json` and `--dry-run`. Exit codes: 0 ok, 1 refused, 2 usage.',
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
 * The manifest.
 *
 * `version` is this CLI's; `manifest` is the shape's. They are separate numbers on purpose: a change to the CLI that adds
 * a verb moves the first, a change to the manifest that moves a field's meaning moves the second, and a consumer can pin
 * either without being told the other one moved.
 */
export const manifest = (from: readonly Verb[] = VERBS): unknown => ({
  name: 'btid',
  version: CLI_VERSION,
  manifest: MANIFEST_VERSION,
  verbs: from.map((verb) => ({
    name: verb.name,
    summary: verb.summary,
    usage: verb.usage,
    writes: verb.writes === true,
    flags: flagNames(verb).map((flag) => ({ name: flag, value: (verb.flags ?? {})[flag] === 'value' })),
  })),
  types: TYPES,
  exitCodes: { ok: 0, refused: 1, usage: 2 },
})

const help: Verb = {
  name: 'help',
  summary: 'List the verbs, or explain one. --json emits the manifest.',
  usage: 'btid help [verb…] [--json]',
  flags: { json: 'boolean' },
  async run(context: VerbContext) {
    if (context.json) {
      context.out.json(manifest())
      return 0
    }
    const wanted = context.args.join(' ')
    if (wanted !== '') {
      const type = TYPES.find((candidate) => candidate.type === wanted)
      if (type !== undefined) {
        context.out.line(`${type.type} fields (${type.fields.length}), as the store validates them:`)
        const width = Math.max(...type.fields.map((field) => field.name.length))
        for (const field of type.fields) {
          const values = field.values === undefined ? '' : `  one of: ${field.values.join(', ')}`
          context.out.line(
            `  ${field.name.padEnd(width, ' ')}  ${field.type.padEnd(9, ' ')}  ${field.required ? 'required' : 'optional'}${values}`,
          )
        }
        return 0
      }
      const verb = VERBS.find((candidate) => candidate.name === wanted)
      if (verb === undefined) return usage(`no verb called “${wanted}”. Run btid help.`, context.out, false)
      context.out.line(verb.usage)
      context.out.line(`  ${verb.summary}`)
      const flags = flagNames(verb)
      if (flags.length > 0) context.out.line(`  flags: ${flags.map((flag) => `--${flag}`).join(', ')}`)
      context.out.line('  fields: btid help task | project | person, or btid help --json')
      return 0
    }
    context.out.line(helpText())
    return 0
  },
}

export const ALL_VERBS: readonly Verb[] = [...VERBS, help]

/** Re-exported so a test can render rows the same way the verbs do. */
export { printRows } from './verb'
