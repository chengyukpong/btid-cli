# The CLI's log sink

- **Status:** in-progress
- **Created:** 2026-11-15T19:26:00+08:00
- **Finished:** 2026-11-15T19:37:00+08:00
- **Approved:** —

## Description

`btid-core` 0.24.0 records one entry per interface call — start time, doer, verb, subject, result, duration, brief details
(`btid-core/tasks/in-progress/the-logger-seam-has-no-caller.md`). Nothing in this project supplies a sink for it yet, so the
answer to "why did that command take four seconds" is still a `Measure-Command` around a commit timestamp.

Two sinks, both opt-in, both plain functions:

- **`--verbose`** writes each entry to **stderr**, so a piped `--json` consumer keeps its pipe clean.
- **`--log-file [path]`** appends to a file. **With no path, the name defaults to `btid-{yyyyMMdd}.log` in the cache
  directory** (`BTID_CACHE_DIR`, else `%LOCALAPPDATA%\btid\cache`, else `~/.cache/btid`), so a day's commands are one file and
  a support request is one attachment.
- Both together write the same entry to both, in the order given.

## The line

Tab-separated, one entry per line, with a header on a new file — a log a person greps should not need a parser:

```
# at	actor	verb	subject	result	ms	detail
2026-11-15T19:41:07.123Z	chengyukpong	promote	task alpha-a1b2	ok	12ms	alpha-a1b2
2026-11-15T19:41:09.884Z	chengyukpong	commit	store yuk-org/btid2-data3	ok	1834ms	042a4cc13f...
```

One more entry closes every command: `verb: command`, `subject: <the typed line>`, `result: <exit code>`, `ms: <total>`,
`detail: N load(s)` — because the per-call entries do not say what the user actually asked for.

## Decisions

- **A log that cannot be written never fails a command.** A full disk, a read-only directory, a typo'd path: one line on stderr,
  the sink goes quiet, the table still prints. The user asked for data, not for a file.
- **The token never reaches a line.** The core prints none, and this project does not add any: it logs what it asked for, never
  what it authenticated with.
- **The engine's client gets the same sink.** `commit: 3 file(s) on top of 042a4cc` is written by `GithubClient`, not by the
  engine the core constructs, so `connect()` passes the sink to the client as well.
- **stdout stays data.** Diagnostics go to stderr or the file, never into the pipe.

## How to verify

```console
$ btid ls task --verbose 2>trace.txt     # trace has the entries, stdout is still the table
$ btid ls task --verbose --json          # stdout parses as JSON with --verbose on
$ btid ls task                           # no stderr output, and no file written
$ btid ls task --log-file                # ./<cache>/btid-20261115.log exists, header + entries
$ btid ls task --log-file trace.txt      # trace.txt instead of the default name
```

## What it measures (2026-11-15T19:37)

```
$ btid ls task --verbose 2>trace.txt     # trace: openStore ... ok 2339ms / command ls task 0 2587ms 1 load
$ btid ls task --log-file                # %LOCALAPPDATA%\btid\cache\btid-20261115.log, header + the same entries
$ btid ls task                           # nothing on stderr, no file
```

Six tests (`tests/log.spec.ts`), 90 in the project. The engine's chatter is filtered to the two lines worth an entry — what a
commit carried, and that there was nothing to carry — because `5 file(s) match no class template` followed by one line per path is
how a log stops being readable.
