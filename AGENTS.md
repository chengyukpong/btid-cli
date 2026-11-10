# Working agreements

This project is the **terminal front end**. It parses arguments, calls one command in `btid-core`, and prints the result.

## Thin by design

- **No rule is implemented here.** If a verb needs a condition — a note before moving a tracked task's end day, a gate
  before promoting, a shape exemption — that condition is already in `btid-core`'s command. A second copy here is the bug
  this project exists to catch: the day the CLI and the app disagree, the boundary has failed.
- **One verb is: parse → one command → print.** If a verb needs two commands and a decision between them, that decision
  belongs in the core as its own command.
- **One mutation is one commit.** `createDatabase` → command → `db.flush({ message })` with a message that names the verb
  and the id, the same shape the app writes.
- **Refusals are printed verbatim.** The words come from the core, so they match the app; do not paraphrase them here.

## Signing in

- **`gh auth token` first**, when `gh` is signed in; **device flow** otherwise, for a machine that has never had `gh`. No
  browser relay and no GitHub App — the app's sign-in path does not apply to a terminal.
- A token is never written into the repository, never echoed, and never printed by `--verbose`. It goes in memory or in
  the OS credential store, and nowhere else.
- The store location (owner, repo, branch) is configuration, not a secret, but it still does not belong in a commit that
  only meant to add a verb.

## Output

- **Machine-readable first**: `--json` prints the plain result the core returned, and is what tests assert on.
- Human output is a rendering of that same result, so the two cannot drift.
- Exit codes: `0` success, `1` a refusal from the core (with its message), `2` a usage error.

## Tests

- This project tests **argument parsing and output shape**, not rules. The rules are tested in `btid-core`, without a
  browser and without a terminal.
- A test that needs a real repository is an integration test and says so; it runs against a throwaway store, never
  against a live one.

## Ask before you push or publish

- **Pushing is explicit.** Commit freely; `git push` only when asked.
- **Publishing is explicit too.** Getting the binary or the npm package into someone else's hands is a decision for the
  user, not a step in a task.

## Where documentation lives

- **Entry points** — `README.md` and `AGENTS.md`.
- **Docs** — `docs/` holds decisions and specifications once they are confirmed, one topic per page. No subfolders.
- **Tasks** — `tasks/` holds the work log, one file per command; the workflow is in `tasks/README.md`, the fields in
  `tasks/_template.md`.

## Task workflow

- **One task per command.** Every command becomes one file under `tasks/`; unrelated work gets its own. A bug fix is a
  command too.
- **Record first.** New work goes to `backlog/`; a further discussion of a task that is not done is appended to it, and
  the agent reports that it was recorded.
- **The user schedules.** The agent does not choose the next task.
- **Confirm before coding.** A scheduled task moves to `todo/`, and only after the user confirms does it move to
  `in-progress/` and work start.
- **Describing is not starting.** An instruction that says what should happen is a go-ahead only when the task is
  already in `in-progress/`; otherwise it is written into the task and the agent waits.
- **Done is the user's call.** `Finished:` is stamped at handover, still in `in-progress/`; the file moves to
  `done/{yyyy-MM}/` and `Approved:` is stamped only when the user signs off.
