import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { PATHS, RULES, VERB_NAMES, exampleOf } from '../src/grammar'
import { helpText, manifest } from '../src/help'
import {
  CONCEPTS,
  EXIT_CODES,
  FLAG_HELP,
  GLOBAL_FLAGS,
  GLOBAL_HELP,
  USAGE_LINE,
  VERB_GROUPS,
  VERB_HELP,
} from '../src/help-text'

/**
 * The help page is the front door: a person should be able to use the CLI without reading `src/`.
 *
 * These are not tests of prose — they are tests that *there is* prose. A verb, a flag or an exit code landing without a
 * sentence is the failure mode, and it is the one that actually happens: every verb in this file was added by somebody who
 * knew what it did, which is precisely why the gap goes unnoticed.
 */
describe('help is complete', () => {
  it('has one sentence per verb, and no sentence for a verb that does not exist', () => {
    assert.deepEqual(Object.keys(VERB_HELP).sort(), [...VERB_NAMES].sort())
    for (const verb of VERB_NAMES) assert.ok(VERB_HELP[verb]!.length > 10, `${verb} has no real sentence`)
  })

  it('groups every verb exactly once, which is what makes the page scannable', () => {
    const grouped = VERB_GROUPS.flatMap((group) => group.verbs)
    assert.deepEqual([...grouped].sort(), [...VERB_NAMES].sort())
    assert.equal(new Set(grouped).size, grouped.length, 'a verb is listed in two groups')
  })

  it('describes every flag any verb takes', () => {
    const undocumented = new Set<string>()
    for (const rule of RULES) {
      for (const flag of Object.keys(rule.handler.flags ?? {})) {
        if (FLAG_HELP[flag] === undefined) undocumented.add(flag)
      }
    }
    assert.deepEqual([...undocumented], [], 'a flag with no sentence is a help page nobody can use')
  })

  it('describes every global flag, and the list and the page agree', () => {
    assert.deepEqual(
      GLOBAL_HELP.map((flag) => flag.name),
      [...GLOBAL_FLAGS],
    )
    for (const flag of GLOBAL_HELP) assert.ok(flag.what.length > 5)
  })

  it('classifies a verb by all of its shapes, not by any one of them', () => {
    // `show` has a `show cache` rule that needs no store; that must not make the whole verb "binary". `clear` is cache-only,
    // so it is. This is the bug the first version of the classifier had.
    const byVerb = new Map(
      (manifest() as { verbs: { verb: string; kind: string }[] }).verbs.map((verb) => [verb.verb, verb.kind]),
    )
    assert.equal(byVerb.get('show'), 'reads')
    assert.equal(byVerb.get('ls'), 'reads')
    assert.equal(byVerb.get('clear'), 'binary')
    assert.equal(byVerb.get('version'), 'binary')
    assert.equal(byVerb.get('advance'), 'session')
    assert.equal(byVerb.get('impersonate'), 'session')
    assert.equal(byVerb.get('unimpersonate'), 'session')
    assert.equal(byVerb.get('edit'), 'writes')
  })

  it('gives every rule a usage line and a summary, and every verb an example', () => {
    for (const rule of RULES) {
      assert.match(rule.handler.usage, /^btid /, `${rule.verb} ${rule.path} has no usage line`)
      assert.ok(rule.handler.summary.length > 10, `${rule.verb} ${rule.path} has no summary`)
      // A usage line is the precise spec: it must name the path it belongs to, or it is a copy-paste.
      assert.ok(rule.handler.usage.includes(rule.verb), `${rule.verb} ${rule.path} usage does not name the verb`)
    }
    for (const verb of VERB_NAMES) assert.notEqual(exampleOf(verb), undefined, `${verb} has no example`)
  })

  it('renders one page that carries every verb, every path, every global, and the codes', () => {
    const text = helpText()
    for (const verb of VERB_NAMES) assert.ok(text.includes(verb), `the page omits ${verb}`)
    for (const path of PATHS) assert.ok(text.includes(path), `the page omits ${path}`)
    for (const flag of GLOBAL_HELP) assert.ok(text.includes(flag.what), `the page omits --${flag.name}`)
    for (const entry of EXIT_CODES) assert.ok(text.includes(String(entry.code)), `the page omits exit ${entry.code}`)
    for (const concept of CONCEPTS) assert.ok(text.includes(concept.what))
  })

  it('says what it is, and how to go deeper, in the first and last lines of the page', () => {
    const lines = helpText().split('\n')
    assert.match(lines[0]!, /^btid \d+\.\d+\.\d+ — the BTID terminal$/)
    assert.ok(lines.includes(`usage: ${USAGE_LINE}`))
    assert.ok(lines.some((line) => line.includes('btid help <verb>')))
    assert.ok(lines.some((line) => line.includes('btid help --json')))
  })

  it('publishes the exit codes and the globals to an agent, not only to a person', () => {
    const published = manifest() as {
      globals: { name: string; what: string }[]
      exitCodes: { code: number; when: string }[]
      verbs: { verb: string; paths: { path: string; flags: { name: string; what: string }[] }[] }[]
    }
    assert.deepEqual(
      published.exitCodes.map((entry) => entry.code),
      EXIT_CODES.map((entry) => entry.code),
    )
    assert.equal(published.globals.length, GLOBAL_HELP.length)
    for (const verb of published.verbs) {
      for (const shape of verb.paths) {
        for (const flag of shape.flags) assert.ok(flag.what.length > 5, `${verb.verb} --${flag.name} has no description`)
      }
    }
  })
})
