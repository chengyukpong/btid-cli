import { execFileSync } from 'node:child_process'

/**
 * Who is signing in, and how this CLI finds out.
 *
 * The order is the one written down in `docs/sign-in.md`: the `gh` session this machine already has, then a device flow
 * (not implemented yet — it needs a client id, which is a decision nobody has made), then a refusal that says which of the
 * two is missing. Nothing here reads a token from the repository or writes one to it.
 */

export interface AuthAttempt {
  token: string
  /** How the token was found, for `whoami` to report. */
  via: 'gh'
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/** `gh auth token`, or null when `gh` is missing or signed out. */
export function ghToken(): string | null {
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return token === '' ? null : token
  } catch {
    return null
  }
}

/**
 * A token, or a refusal that names both halves.
 *
 * The refusal is worth its length: "not signed in" without saying *what to sign in to* is the error message people paste
 * into chat instead of fixing.
 */
export function resolveToken(token: string | undefined, env: NodeJS.ProcessEnv): AuthAttempt {
  if (token !== undefined && token.trim() !== '') return { token: token.trim(), via: 'gh' }
  const fromEnv = env['BTID_TOKEN']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return { token: fromEnv.trim(), via: 'gh' }
  const found = ghToken()
  if (found !== null) return { token: found, via: 'gh' }
  throw new AuthError(
    'No GitHub token. Either sign in with `gh auth login` (this CLI uses that session), or set BTID_TOKEN. ' +
      'The device flow is not built yet, so one of those two is the ways in.',
  )
}

/**
 * The login behind a token.
 *
 * One request, and the only place this package talks to GitHub about anything other than a store: identity is not
 * something a repository client can answer for itself.
 */
export async function whoAmI(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new AuthError(
      `GitHub refused the token (${response.status}). Check that it has \`repo\` scope and has not expired.`,
    )
  }
  const body = (await response.json()) as { login?: unknown }
  if (typeof body.login !== 'string' || body.login === '') {
    throw new AuthError('GitHub answered /user without a login, so there is nobody to sign in as.')
  }
  return body.login
}
