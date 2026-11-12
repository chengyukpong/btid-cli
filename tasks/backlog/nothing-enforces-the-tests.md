# Nothing enforces the tests

- **Status:** backlog
- **Created:** 2026-11-12T18:15:00+08:00
- **Finished:** —
- **Approved:** —

## Description

`githubdb` has 221 tests, `btid-core` 447 and `btid-cli` 64 — all green because somebody ran them, not because anything makes it
happen. There is no CI, no pre-push hook and no command that runs all three in order, so "the suite is green" is a claim about a
moment, and the moment is whenever I last typed `npm test`.

That is the weakest link in everything built today: three repos, two tarballs consumed over `file:`, and a CLI whose tests only
see a fake repository.

## Steps

- [ ] A single command at the level above the three repos — `btid check` or a small script — that runs typecheck and tests in
      dependency order (`githubdb` → `btid-core` → `btid-cli`), and stops at the first failure.
- [ ] Decide what a CI would be: GitHub Actions on push is the obvious answer, given the code already lives there. What it must
      do: build `githubdb`, pack it, install it into `btid-core`, build, pack, install into `btid-cli`, test. That chain is the
      thing that breaks quietly today.
- [ ] Add the chain to `AGENTS.md` so a change to one repo is known to require the others.

## How to verify

One command from the workspace root runs all three suites in dependency order and exits non-zero on the first failure; a CI run
on a pushed commit does the same against a clean checkout.
