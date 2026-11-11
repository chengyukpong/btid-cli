#!/usr/bin/env node
import { run } from './cli'

/**
 * `btid`, as a command.
 *
 * All the work is in `run`, which takes its arguments rather than reading `process.argv` — that is what lets the tests
 * drive it with a fake repository and no network. This file exists so the package has a `bin`.
 */
run({ argv: process.argv.slice(2) })
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
