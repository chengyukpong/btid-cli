# A plan can act as somebody

- **Status:** done
- **Created:** 2026-11-18T13:42:28+08:00
- **Finished:** 2026-11-18T13:48:39+08:00
- **Approved:** 2026-11-18T18:50:09+08:00

## Description

The plan runner refused every identity-changing verb by name:

```
a plan runs as one login; “impersonate” would change who that is
```

That guard was written while there was no verb for it, and it was the right guard then: a plan that could quietly change who
it wrote as is a plan that forges history. But a **seed** is exactly the case where changing it is the point, and the rule
that makes it safe belongs in the core, not in a front-end name-match.

## The verb

```
impersonate person/<id>      act as that person from here on
impersonate stop             back to the account the CLI signed in as
```

Two rows in the grammar table, one new path in the tree (`stop` — a fixed object rather than a row class; `matchPath` only
walks `PATHS`, so it has to be there), and both declared `writes: true` because a plan refuses a report as a step. Neither
stages a row nor commits: the plan's stream of commands simply continues, attributed differently.

## What landed

- `personImpersonate` and `storeStopImpersonating` in `src/verbs.ts`, two rules in `src/grammar.ts`.
- **The name-match guard is deleted**, and with it the parenthetical in `plan.ts`'s header that said a plan cannot change
  identity. The sentence it guarded is now a rule with a code, in the package that owns rules.
- `tests/impersonate-plan.spec.ts`: three people write three tasks and each `createdById` is the one the plan named; a
  member's plan stops at the step with `(NOT_MANAGER)` and writes nothing; an unknown person is `PERSON_NOT_FOUND`
  verbatim.
- `docs/grammar.md`: the verb in the table (twenty → twenty-one) and a paragraph in *Seeding a history* — including what
  attribution does **not** change: the commit author is the account whose token wrote it.

## Found while building

1. **The manifest test pins the path tree's size** (`12`, "the path tree is indexed once"). Adding `stop` made it 13; the
   test is an inventory and was updated, as the refusal-code inventory was.
2. **`impersonate person` with no id** is answered by the resolver, not by the handler: *"person does not take
   impersonate. It takes ls, new."* — true, and slightly misleading, but it is the message every verb gets for a shape it
   does not take, so it was left alone rather than special-cased.

## How to verify

`npx vitest run` → **109 of 110** in this package (the failure is the pre-existing version drift). The attribution case
asserts `{ 'The policy': 'ivan-petrov', 'The bundle': 'mei-tan', 'The cutover': 'chengyukpong' }` after three
impersonations and a stop.
