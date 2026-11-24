#!/usr/bin/env node
/**
 * Cut a GitHub release for the version in package.json.
 *
 * Publishing is explicit, so this script is only ever run by hand (`npm run release`). It does four things and stops if any
 * of them fails:
 *
 *   1. packs the package (`npm pack` runs `prepack` → tsc + esbuild, so the tarball is always built from source);
 *   2. publishes it twice under the release: `btid-cli-<version>.tgz`, which is the record of that version, and
 *      `btid-cli.tgz`, which is always the newest — so one URL survives every release:
 *      https://github.com/<owner>/<repo>/releases/latest/download/btid-cli.tgz
 *   3. makes the tag `v<version>` and the release, or adds the assets to it if it already exists;
 *   4. prints the pinned and the latest URLs, so the notes can be copied from the output.
 *
 * The stable name is the whole point. `/releases/latest/download/<name>` resolves the *latest* release but not a *latest*
 * filename: with only the versioned asset, that URL dies at the next version.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.version
const tag = `v${version}`
const staging = join(root, '.tmp')

/** Run a command in the repo, echoing it, and stop the release if it fails. */
function run(command, args, options = {}) {
  const shown = [command, ...args].join(' ')
  process.stdout.write(`release: ${shown}\n`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options })
  if (result.status !== 0) {
    process.stderr.write(`release: "${shown}" failed with ${result.status ?? 'no status'}\n`)
    process.exit(1)
  }
  return result
}

/** The output of a command, trimmed, or '' when it fails (used for questions, never for steps). */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  return result.status === 0 ? result.stdout.trim() : ''
}

mkdirSync(staging, { recursive: true })
for (const name of [`btid-cli-${version}.tgz`, 'btid-cli.tgz']) rmSync(join(staging, name), { force: true })

// 1. Pack. `--pack-destination` keeps the tarball out of the working tree, where it would show up as untracked.
run('npm', ['pack', '--pack-destination', staging])
const packed = join(staging, `btid-cli-${version}.tgz`)
if (!existsSync(packed)) {
  process.stderr.write(`release: npm pack did not produce ${packed}\n`)
  process.exit(1)
}

// 2. The stable copy. Same bytes, a name that does not change.
copyFileSync(packed, join(staging, 'btid-cli.tgz'))

// 3. The release. `gh release create` fails when the tag already exists, which is the case when a release is being
//    refreshed (a rebuilt tarball, a fixed note), so that path adds assets instead of refusing.
const remote = capture('git', ['remote', 'get-url', 'origin']).replace(/\.git$/, '')
const slug = remote.replace(/^.*github\.com[/:]/, '')

if (capture('gh', ['release', 'view', tag, '--json', 'tagName']) === '') {
  run('gh', [
    'release',
    'create',
    tag,
    join(staging, `btid-cli-${version}.tgz`),
    join(staging, 'btid-cli.tgz'),
    '--title',
    `${manifest.name} ${version}`,
    '--notes',
    notesFor(slug),
  ])
} else {
  process.stdout.write(`release: ${tag} exists — replacing its assets\n`)
  run('gh', ['release', 'upload', tag, join(staging, `btid-cli-${version}.tgz`), join(staging, 'btid-cli.tgz'), '--clobber'])
}

// 4. Say where it is.
process.stdout.write(
  [
    '',
    `release: ${tag} is up for ${slug}`,
    `  pinned: https://github.com/${slug}/releases/download/${tag}/btid-cli-${version}.tgz`,
    `  latest: https://github.com/${slug}/releases/latest/download/btid-cli.tgz`,
    '',
  ].join('\n'),
)

/** The release body: the same two lines every time, with the version and the repository filed in. */
function notesFor(slug) {
  const size = Math.round(readFileSync(packed).length / 1024)
  const pinned = `https://github.com/${slug}/releases/download/${tag}/btid-cli-${version}.tgz`
  const latest = `https://github.com/${slug}/releases/latest/download/btid-cli.tgz`
  return [
    manifest.description,
    '',
    `One file, no dependencies: \`dist/bin.bundle.js\`, ${size} KB packed, with \`btid-core\`, \`githubdb\` and \`zod\` tree-shaken into it.`,
    '',
    'This version:',
    '',
    '```',
    `npm i -g ${pinned}`,
    '```',
    '',
    'Or always the newest — the name does not change between releases:',
    '',
    '```',
    `npm i -g ${latest}`,
    '```',
  ].join('\n')
}
