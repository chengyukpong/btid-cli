import type { StoreClient, CommitResult, FileChange, TagOptions, TreeListing } from 'githubdb'

/**
 * A repository that keeps its files in memory.
 *
 * The CLI's tests run the real `btid-core` against a real `githubdb` database with only the network replaced — that is the
 * point of the seam, and it is how a verb can be tested without a store somewhere on GitHub.
 */
export class FakeClient implements StoreClient {
  readonly files = new Map<string, string>()
  readonly messages: string[] = []

  async tree(): Promise<TreeListing> {
    return {
      truncated: false,
      entries: [...this.files.keys()].map((path) => ({ path, sha: path, mode: '100644' })),
    }
  }

  async blob(sha: string): Promise<string> {
    const text = this.files.get(sha)
    if (text === undefined) throw new Error(`no blob ${sha}`)
    return text
  }

  async commit(changes: readonly FileChange[], message: string): Promise<CommitResult> {
    this.messages.push(message)
    for (const change of changes) {
      if (change.content === null) this.files.delete(change.path)
      else this.files.set(change.path, change.content)
    }
    return {
      commitSha: `c${this.messages.length}`,
      parentSha: 'c0',
      written: changes.filter((change) => change.content !== null).map((change) => change.path),
      deleted: changes.filter((change) => change.content === null).map((change) => change.path),
    }
  }

  async head(): Promise<string> {
    return 'c0'
  }

  async tag(name: string, sha: string, options: TagOptions = {}): Promise<void> {
    void name
    void sha
    void options
  }

  async untag(name: string): Promise<void> {
    void name
  }

  put(path: string, value: unknown): void {
    this.files.set(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  json(path: string): Record<string, Record<string, unknown>> {
    const text = this.files.get(path)
    if (text === undefined) throw new Error(`no file ${path}`)
    return JSON.parse(text) as Record<string, Record<string, unknown>>
  }
}

/** Records what a verb printed, so a test can assert on the transcript rather than on the console. */
export class Lines {
  readonly written: string[] = []

  write = (text: string): void => {
    this.written.push(text)
  }

  get text(): string {
    return this.written.join('')
  }

  get json(): unknown[] {
    return this.written.filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown)
  }
}
