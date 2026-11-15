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
- **`--log-file [path]`** appends to a file. **With no path, the name is `btid.log` in the cache directory**
  (`BTID_CACHE_DIR`, else `%LOCALAPPDATA%\btid\cache`, else `~/.cache/btid`).
- Both together write the same entry to both, in the order given.

## Rotation, changed at the user's request (2026-11-15T19:40)

The first version named the file `btid-{yyyyMMdd}.log` and started a new one each day. The user asked for the simpler shape: **one
live file, `btid.log`, and a dated archive.** Before the day's first line is written, a `btid.log` whose own creation date is not
today is renamed to `btid-{thatDate}.log`, and today starts a fresh `btid.log`.

- **The date comes from the file's own header** (`# created 20261114`), which survives a copy, a restore or a sync — not from
  `stat`, which a copy rewrites. A file with no header (one written by 0.19.0) falls back to its birth time, then its modification
  time, and is left alone if that is today.
- **A byte-order mark is stripped before parsing.** Found the hard way: a `btid.log` written by PowerShell carries one, `^` does
  not match through it, and the file rotated under *today's* date instead of its own.
- **An archive is never overwritten.** A second rotation for the same day goes to `btid-20261114-2.log`.
- **A file that cannot be renamed is not a failure.** On Windows an open file cannot be renamed; the rotation is skipped with one
  warning and the lines keep going into the file it could not move. Losing a rotation is cheaper than losing the log.
- No size ceiling, no count to keep, no compression: a log that needs a policy is a log nobody reads, and the shell can rotate a
  directory of dated files any way its owner likes.

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

## What rotation measures (2026-11-15T19:43)

```
$ echo "# created 20261114 ..." > ~/.cache/btid/btid.log     # a file from yesterday
$ btid ls task --log-file
$ ls ~/.cache/btid
  btid.log            # fresh, "# created 20261115", today's entries
  btid-20261114.log   # yesterday's 66 bytes, untouched
```

Five tests in `tests/rotation.spec.ts`, eleven in the log area, 95 in the project: a stale file is archived under its own day;
a file created today is appended to, with one header; a name clash becomes `-2`; a headerless file is judged by its dates and
keeps its lines; and a sink that cannot write warns once and goes quiet.

## The flag was the friction (2026-11-15T19:59)

Reported as "I ran `btid ls task` and saw no new log" — the honest answer is that the flag *is* the switch, and forgetting it is the
design failing at the keyboard, not the user failing to read the docs. So the same two sinks can now be switched on for a shell
session instead of a command:

```console
set BTID_LOG_FILE=1            :: every command in this window appends to btid.log
set BTID_LOG_FILE=D:\trace.log  :: …to that file instead, rotated by the same rule
set BTID_VERBOSE=1              :: …and to stderr, without touching the file
setx BTID_LOG_FILE 1            :: once, for every window from now on
```

A flag still wins over the environment, because an explicit path is the more specific instruction; the test asserts both the
switch and the precedence. 96 tests.

## System time, not UTC (2026-11-15T20:03)

The first entries said `11:59:19.714Z` to somebody whose clock said `19:59` — correct, and useless for reading. `at` is now local
ISO 8601 **with its offset**, so it is both comparable with a wall clock and unambiguous:

```
2026-11-15T20:03:49.181+08:00   chengyukpong   openStore   yuk-org/btid2-data3@main   ok   2ms   hydrated from the snapshot
```

Two things fixed while there: the stamp is the moment the call **started** (it was taken when the entry was emitted, which made
the field's documentation a lie), and `localIso` lives in `btid-core` so the file, the header and the panel cannot format times
differently. The file is still written in **completion** order, so the closing `command` entry — stamped with the earliest start —
sits last; that is the one place the order and the stamps disagree, and it is a summary line by design.
