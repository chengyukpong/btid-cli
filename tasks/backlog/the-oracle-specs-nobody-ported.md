# The oracle specs nobody ported

- **Status:** backlog
- **Created:** 2026-11-12T18:15:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`btid2` is the frozen oracle, and its tests are the argument that the rules were moved rather than reinvented. Five of its specs
have no counterpart in `btid-core`, so nothing here would catch a divergence between the SPA and the core:

| spec | what it pins |
|---|---|
| `move-booking` | what happens to a booking when a task moves day |
| `bar-window` | how a bar is drawn and clipped at the project's window |
| `blocked-since` | the day a block began, read off the activity log |
| `end-date-history` | the end-day changes and their reasons, in order |
| `plan-span` | how a task's span is computed for the plan view |

Each is a rule that exists in the app; a rule that only the app tests is a rule the core is free to get wrong.

## Steps

- [ ] Read each spec in `btid2` and ask the AGENTS question: does this exercise a **rule** (belongs in the core) or a
      **component** (belongs in the front end)? Record the answer in this file before porting anything.
- [ ] Port the ones that are rules, keeping the oracle's expectations: a ported test that has to be rewritten is a report, not an
      edit.
- [ ] For the ones that turn out to be component behaviour, say so in `docs/task-lifecycle.md` or the relevant page, so the gap
      is a decision rather than an omission.

## How to verify

Each ported spec passes against `btid-core` with no Vue, no Pinia, no DOM; the file lists the five and what happened to each.
