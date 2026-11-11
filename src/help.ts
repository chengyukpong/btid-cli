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

export const manifest = (from: readonly Verb[] = VERBS): unknown => ({
  name: 'btid',
  version: 1,
  verbs: from.map((verb) => ({
    name: verb.name,
    summary: verb.summary,
    usage: verb.usage,
    writes: verb.writes === true,
    flags: flagNames(verb).map((flag) => ({ name: flag, value: (verb.flags ?? {})[flag] === 'value' })),
  })),
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
      const verb = VERBS.find((candidate) => candidate.name === wanted)
      if (verb === undefined) return usage(`no verb called “${wanted}”. Run btid help.`, context.out, false)
      context.out.line(verb.usage)
      context.out.line(`  ${verb.summary}`)
      const flags = flagNames(verb)
      if (flags.length > 0) context.out.line(`  flags: ${flags.map((flag) => `--${flag}`).join(', ')}`)
      return 0
    }
    context.out.line(helpText())
    return 0
  },
}

export const ALL_VERBS: readonly Verb[] = [...VERBS, help]

/** Re-exported so a test can render rows the same way the verbs do. */
export { printRows } from './verb'
