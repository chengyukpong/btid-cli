import { help } from './help'
import { HANDLERS } from './verbs'
import type { Verb } from './verb'

/**
 * The grammar: `btid <verb> <path> [data] [--flags]`.
 *
 * This table is the **only** list of verbs and paths. Dispatch reads it to find a handler, `help` reads it to print the
 * page, and `help --json` reads it to describe the grammar to a program. A rule carries its handler rather than a name
 * looked up later, because a table of strings is a second registry waiting to disagree with the first.
 *
 * A path is one argv token. Its ids are the segments under the shape's placeholders (`<id>`, `<step-id>`), never guessed
 * from what a segment looks like: an id always follows a noun, so "which segment is not a noun" excludes every id.
 */

/** Where the path's ids and the remaining data go, in the order the handler reads them. */
export type Place = (ids: readonly string[], data: readonly string[]) => string[]

const place: Place = (ids, data) => [...ids, ...data]

export interface Rule {
  /** One of the fifteen. */
  verb: string
  /** The path shape, or `null` for the four verbs that name no path. */
  path: string | null
  /** The body that implements this verb × path. */
  handler: Verb
  /** Place the path's ids in front of the data, where the body reads them. */
  args: Place
  /** One example, shown by `btid help <verb>`. Carried by the first rule of each verb. */
  example?: string
}

const { taskLs, taskShow, taskNew, taskEdit, taskPromote, taskDemote, taskRemove } = HANDLERS
const { projectLs, projectShow, projectNew, projectEdit, projectArchive, projectMemberAdd, projectMemberRemove, projectLabelAdd, projectLabelRemove, projectRemove } = HANDLERS
const { personLs, personShow, personNew, personEdit, personRemove } = HANDLERS
const { labelLs, labelAdd, labelRemove } = HANDLERS
const { stepLs, stepShow, stepNew, stepMove, stepRename, tickStep, untickStep, stepRemove } = HANDLERS
const { commentAdd, exemptionAdd, exemptionRemove } = HANDLERS
const { cacheShow, cacheClear } = HANDLERS
const { storeInit, storeSwitch, storeWhoami, storeAdvance, personImpersonate, unimpersonate } = HANDLERS
const { plan, version } = HANDLERS

/**
 * The path tree, in the order the help page prints it.
 *
 * A path segment is a noun. A label name is never a segment — a label *is* its text, and text may contain `/` — so the
 * tree stops at `task/<id>/label` and the name is data.
 */
export const PATHS: readonly string[] = [
  'task',
  'task/<id>',
  'task/<id>/step',
  'task/<id>/step/<step-id>',
  'task/<id>/label',
  // Things a task holds, each named by the caller rather than minted: a comment's body, an exemption's code.
  'task/<id>/comment',
  'task/<id>/exemption',
  'project',
  'project/<id>',
    'project/<id>/member',
  'project/<id>/label',
  'person',
  'person/<id>',
  'store',
  'cache',
]

/** The table. Grouped by verb, in the order docs/grammar.md lists the verbs. */
export const RULES: readonly Rule[] = [
  { verb: 'ls', path: 'task', handler: taskLs, args: place, example: 'btid ls task projectId=alpha status=todo' },
  { verb: 'ls', path: 'project', handler: projectLs, args: place },
  { verb: 'ls', path: 'person', handler: personLs, args: place },
  { verb: 'ls', path: 'task/<id>/step', handler: stepLs, args: place },
  { verb: 'ls', path: 'task/<id>/label', handler: labelLs, args: place },

  { verb: 'show', path: 'task/<id>', handler: taskShow, args: place, example: 'btid show task/alpha-n7qk' },
  { verb: 'show', path: 'project/<id>', handler: projectShow, args: place },
  { verb: 'show', path: 'person/<id>', handler: personShow, args: place },
  { verb: 'show', path: 'task/<id>/step/<step-id>', handler: stepShow, args: place },
  { verb: 'show', path: 'cache', handler: cacheShow, args: place },

  { verb: 'new', path: 'task', handler: taskNew, args: place, example: 'btid new task --project alpha --title "Check the header budgets"' },
  { verb: 'new', path: 'project', handler: projectNew, args: place },
  { verb: 'new', path: 'person', handler: personNew, args: place },
  // The store itself: creating one, and pointing this machine at one. Both name the target as their object.
  { verb: 'init', path: 'store', handler: storeInit, args: place, example: 'btid init store yuk-org/btid-data3' },
  { verb: 'switch', path: 'store', handler: storeSwitch, args: place, example: 'btid switch store yuk-org/btid-data4' },
  // Seeding a history: everything after this step is stamped with the day the plan says it happened.
  {
    verb: 'advance',
    path: 'store',
    handler: storeAdvance,
    args: place,
    example: 'btid advance store 2026-09-12T10:40:00+08:00',
  },
  // Seeding a history, the other half: everything after this step is attributed to somebody else.
  {
    verb: 'impersonate',
    path: 'person/<id>',
    handler: personImpersonate,
    args: place,
    example: 'btid impersonate person/ivan-petrov',
  },
  { verb: 'new', path: 'task/<id>/step', handler: stepNew, args: place },

  { verb: 'edit', path: 'task/<id>', handler: taskEdit, args: place, example: 'btid edit task/alpha-n7qk --estimate 4 --dod "Both columns line up."' },
  { verb: 'edit', path: 'project/<id>', handler: projectEdit, args: place },
  { verb: 'archive', path: 'project/<id>', handler: projectArchive, args: place, example: 'btid archive project/alpha-n7qk --yes' },
  { verb: 'edit', path: 'person/<id>', handler: personEdit, args: place },

  { verb: 'promote', path: 'task/<id>', handler: taskPromote, args: place, example: 'btid promote task/alpha-n7qk' },
  { verb: 'demote', path: 'task/<id>', handler: taskDemote, args: place, example: 'btid demote task/alpha-n7qk' },
  { verb: 'add', path: 'task/<id>/comment', handler: commentAdd, args: place, example: 'btid add task/alpha-n7qk/comment waiting on the review' },
  { verb: 'add', path: 'task/<id>/exemption', handler: exemptionAdd, args: place, example: 'btid add task/alpha-n7qk/exemption DEFINITION_REQUIRED' },
  { verb: 'remove', path: 'task/<id>/exemption', handler: exemptionRemove, args: place, example: 'btid remove task/alpha-n7qk/exemption DEFINITION_REQUIRED' },

  { verb: 'remove', path: 'task/<id>', handler: taskRemove, args: place, example: 'btid remove task/alpha-n7qk --yes' },
  { verb: 'remove', path: 'project/<id>', handler: projectRemove, args: place },
  { verb: 'remove', path: 'person/<id>', handler: personRemove, args: place },
  { verb: 'remove', path: 'task/<id>/step/<step-id>', handler: stepRemove, args: place },
  { verb: 'remove', path: 'task/<id>/label', handler: labelRemove, args: place },
  { verb: 'remove', path: 'project/<id>/member', handler: projectMemberRemove, args: place },

  { verb: 'add', path: 'task/<id>/label', handler: labelAdd, args: place, example: 'btid add task/alpha-n7qk/label ui' },
  { verb: 'add', path: 'project/<id>/member', handler: projectMemberAdd, args: place, example: 'btid add project/alpha-n7qk/member ivan' },
  { verb: 'add', path: 'project/<id>/label', handler: projectLabelAdd, args: place, example: 'btid add project/alpha-n7qk/label ui' },
  { verb: 'remove', path: 'project/<id>/label', handler: projectLabelRemove, args: place },

  { verb: 'rename', path: 'task/<id>/step/<step-id>', handler: stepRename, args: place, example: 'btid rename task/alpha-n7qk/step/st-a1b2 --name "Measure the header at 1440"' },
  { verb: 'move', path: 'task/<id>/step/<step-id>', handler: stepMove, args: place, example: 'btid move task/alpha-n7qk/step/st-a1b2 --to 1' },

  { verb: 'tick', path: 'task/<id>/step/<step-id>', handler: tickStep, args: place, example: 'btid tick task/alpha-n7qk/step/st-a1b2' },
  { verb: 'untick', path: 'task/<id>/step/<step-id>', handler: untickStep, args: place, example: 'btid untick task/alpha-n7qk/step/st-a1b2' },

  { verb: 'clear', path: 'cache', handler: cacheClear, args: place, example: 'btid clear cache' },

  { verb: 'plan', path: null, handler: plan, args: place, example: 'btid plan seed.btid' },
  { verb: 'whoami', path: null, handler: storeWhoami, args: place, example: 'btid whoami' },
  // No path, because the act has no object: it ends an impersonation rather than addressing a row. A "stop" path would have
  // been the only mode in a tree of nouns.
  { verb: 'unimpersonate', path: null, handler: unimpersonate, args: place, example: 'btid unimpersonate' },
  { verb: 'version', path: null, handler: version, args: place, example: 'btid version' },
  { verb: 'help', path: null, handler: help, args: place, example: 'btid help edit' },
]

/** The fifteen verbs, in table order. Derived, so it cannot disagree with the rules. */
export const VERB_NAMES: readonly string[] = [...new Set(RULES.map((rule) => rule.verb))]

export const isVerb = (word: string): boolean => VERB_NAMES.includes(word)

export const isPathless = (verb: string): boolean => {
  const rules = rulesFor(verb)
  return rules.length > 0 && rules.every((rule) => rule.path === null)
}

export const rulesFor = (verb: string): readonly Rule[] =>
  RULES.filter((rule) => rule.verb === verb)

export const ruleFor = (verb: string, shape: string | null): Rule | undefined =>
  RULES.find((rule) => rule.verb === verb && rule.path === shape)

/** The paths a verb takes, as shapes; the four pathless verbs have none. */
export const pathsOf = (verb: string): readonly string[] =>
  rulesFor(verb)
    .map((rule) => rule.path)
    .filter((path): path is string => path !== null)

/** The verbs valid at one path shape, in table order. */
export const verbsAt = (shape: string): readonly string[] =>
  RULES.filter((rule) => rule.path === shape).map((rule) => rule.verb)

/** The one-line summary of a verb: the handler carries it, so there is no second copy. */
export const summaryOf = (verb: string): string => rulesFor(verb)[0]?.handler.summary ?? ''

/** The one example `btid help <verb>` prints. */
export const exampleOf = (verb: string): string | undefined =>
  rulesFor(verb).find((rule) => rule.example !== undefined)?.example

export interface PathMatch {
  /** The canonical shape, e.g. `task/<id>`. */
  shape: string
  /** The ids, in the shape's order: `task/alpha-n7qk` → `['alpha-n7qk']`. */
  ids: string[]
}

/** Match one argv path token against the tree; a placeholder accepts any non-empty segment. */
export function matchPath(token: string): PathMatch | null {
  const parts = token.split('/')
  if (parts.some((part) => part === '')) return null
  for (const shape of PATHS) {
    const expected = shape.split('/')
    if (expected.length !== parts.length) continue
    const ids: string[] = []
    let matched = true
    for (let at = 0; at < expected.length; at += 1) {
      const segment = expected[at]!
      const part = parts[at]!
      if (segment.startsWith('<') && segment.endsWith('>')) {
        ids.push(part)
        continue
      }
      if (segment !== part) {
        matched = false
        break
      }
    }
    if (matched) return { shape, ids }
  }
  return null
}

export interface Resolved {
  kind: 'rule'
  rule: Rule
  /** The path token as typed ('' for a pathless verb). */
  path: string
  ids: string[]
  /** The words after the path. */
  data: string[]
}

export interface ResolveRefusal {
  kind: 'refusal'
  /** The sentence, without the `usage: ` prefix the caller adds. */
  message: string
}

export interface ResolveEmpty {
  kind: 'empty'
}

export type Resolution = Resolved | ResolveRefusal | ResolveEmpty

const quoted = (value: string): string => `“${value}”`

const listVerbs = (verbs: readonly string[]): string =>
  verbs.length === 0 ? 'nothing' : verbs.join(', ')

/**
 * Resolve argv words — verb, then path, then data — or teach.
 *
 * The refusal names the alternative rather than the registry: a wrong verb at a known path answers with the verbs valid
 * **there**, and an old spelling answers with the form that replaced it.
 */
export function resolve(words: readonly string[]): Resolution {
  if (words.length === 0) return { kind: 'empty' }
  const verb = words[0]!
  if (!isVerb(verb)) return { kind: 'refusal', message: oldSpelling(words) ?? `no verb called ${quoted(verb)}. Run btid help.` }

  const rule = rulesFor(verb)[0]!
  if (rule.path === null) {
    return { kind: 'rule', rule, path: '', ids: [], data: words.slice(1) }
  }

  if (words.length < 2) {
    return { kind: 'refusal', message: `${verb} needs a path. It takes: ${pathsOf(verb).join(', ')}.` }
  }

  const token = words[1]!
  const match = matchPath(token)
  if (match === null) {
    return {
      kind: 'refusal',
      message: `${quoted(token)} is not a path. The paths are: ${PATHS.join(', ')}.`,
    }
  }

  const found = ruleFor(verb, match.shape)
  if (found === undefined) {
    return { kind: 'refusal', message: wrongVerb(verb, match.shape) }
  }

  return { kind: 'rule', rule: found, path: token, ids: match.ids, data: words.slice(2) }
}

/** The verbs a path does take, or the sentence that explains why this verb is not one of them. */
function wrongVerb(verb: string, shape: string): string {
  const at = `btid ${verb} `
  switch (`${verb} ${shape}`) {
    case 'show task':
    case 'show project':
    case 'show person':
      return `${quoted(shape)} is a list; name one row: ${at}${shape}/<id>`
    case 'show task/<id>/step':
      return `${quoted(shape)} is a list; name one row: ${at}${shape}/<step-id>`
    case 'ls task/<id>':
      return `${quoted(shape)} is one row; use show`
    case 'done task/<id>':
    case 'undo task/<id>':
      return `${verb} applies to a step: ${verb} task/<id>/step/<step-id>`
    case 'show store':
      return `${quoted('store')} has no show — btid whoami says who you are, btid init store creates one`
    case 'new store':
      return `the grammar is btid init store owner/repo[@branch]`
    case 'new cache':
      return `${quoted('cache')} has no new — btid clear cache drops it, btid show cache reads it`
    default:
      return `${quoted(shape)} does not take ${quoted(verb)}. It takes ${listVerbs(verbsAt(shape))}.`
  }
}

/**
 * A short, deliberate map for the spellings the hard cut removes.
 *
 * This is not a compatibility shim: it never runs a command. It exists so the refusal can name the new form, which is
 * the only thing a person typing the old one needs to be told.
 */
function oldSpelling(words: readonly string[]): string | null {
  const [first, second, third] = words
  if (first === undefined) return null

  if (first === 'task' || first === 'project' || first === 'person') {
    const noun = first
    if (second === undefined) {
      return noun === 'task'
        ? '“task” is a path, not a verb. Try: btid ls task projectId=alpha'
        : `${quoted(noun)} is a path, not a verb. Try: btid ls ${noun}`
    }
    switch (second) {
      case 'ls':
        return `the grammar is btid ls ${noun}`
      case 'show':
        return `the grammar is btid show ${noun}/<id>`
      case 'new':
        return noun === 'project'
          ? 'the grammar is btid new project --key <key> --name <name>'
          : noun === 'person'
            ? 'the grammar is btid new person --handle <login> --name <name>'
            : 'the grammar is btid new task --project <id> --title <text>'
      case 'edit':
        return `the grammar is btid edit ${noun}/<id>`
      case 'promote':
        return 'the grammar is btid promote task/<id>'
      case 'remove':
        return `the grammar is btid remove ${noun}/<id> --yes`
      case 'label':
        if (third === 'add') return 'the grammar is btid add task/<id>/label <name>'
        if (third === 'remove') return 'the grammar is btid remove task/<id>/label <name>'
        break
      case 'step':
        switch (third) {
          case 'new':
          case 'add':
            return 'the grammar is btid new task/<id>/step --name <text>'
          case 'rename':
            return 'the grammar is btid rename task/<id>/step/<step-id> --name <text>'
          case 'done':
            return 'the grammar is btid done task/<id>/step/<step-id>'
          case 'undo':
            return 'the grammar is btid undo task/<id>/step/<step-id>'
          case 'remove':
            return 'the grammar is btid remove task/<id>/step/<step-id>'
          default:
            break
        }
        break
      default:
        break
    }
  }

  if (first === 'store') {
    if (second === 'whoami') return 'the grammar is btid whoami'
    if (second === 'init') return 'the grammar is btid init store owner/repo[@branch]'
    if (second === 'switch') return 'the grammar is btid switch store owner/repo[@branch]'
    return `${quoted('store')} is a path, not a verb. btid init store creates one; btid switch store points this machine at one`
  }
  if (first === 'cache') {
    if (second === 'show') return 'the grammar is btid show cache'
    if (second === 'clear') return 'the grammar is btid clear cache'
    return `${quoted('cache')} is a path, not a verb. Try: btid show cache`
  }

  return null
}
