# Signing in from a terminal

The SPA signs in through a browser relay and a GitHub App. None of that applies to a CLI: there is no browser to redirect
to, no place to keep a client secret, and no Pages project to host a function. Decided 2026-11-10.

## The order of attempts

1. **`gh auth token`** — when the GitHub CLI is installed and signed in, the token is already on this machine, already
   scoped, and already the one the person uses for everything else. Nothing to configure.
2. **Device flow** — otherwise: print a code, open `https://github.com/login/device`, poll until the person approves.
   This is the path for a machine that has never had `gh`, and it needs a client id but no secret.
3. **Refuse clearly** — if both are unavailable (no `gh`, no network, no client id), say which of the two is missing and
   stop. Do not fall back to an unauthenticated request that will fail later with a worse message.

## What is never done

- **No token in the repository.** Not in a config file, not in a fixture, not in a test.
- **No token in output.** `--verbose` prints what was asked and what came back, never the credential; a request log
  redacts the `Authorization` header.
- **No silent re-auth.** If the token is refused, the error says so and the next command tries again; a CLI that quietly
  starts a device flow mid-command has done something the person did not ask for.

## Where the token goes

In memory for the life of the command. A credential store (the OS keychain, or `gh`'s own) is acceptable if a future
verb needs to persist it; a dotfile in the working tree is not.

## The store is configuration, not a secret

Owner, repo and branch are ordinary settings — flags, environment, or a config file at a documented path. They are still
not part of a commit that only meant to add a verb, because the next person's clone will not have that repository.
