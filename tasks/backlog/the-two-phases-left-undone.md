# The two phases the speed work left undone

- **Status:** backlog
- **Created:** 2026-11-11T19:02:00+08:00
- **Finished:** —
- **Approved:** —

## Description

The snapshot closed the read path (~3.0 s → ~0.9 s) and the write path learned to refresh it (~6.5 s → ~5.0 s warm). Two
phases of the plan were not built, and are recorded here so closing the task did not quietly drop them.

## Steps

- [ ] **Batch mode — one process, many commands.** `btid batch` reading NDJSON from stdin, opening the store once and running
      the verbs in order, with `--commit-at-end` so a seed is one commit. This is the only thing that removes the ~2.5 s
      *fixed* cost per command; a 10-task seed measured at 49 s with the snapshot, and should be ~3 s with a batch.
      - The seam exists in miniature: each verb's commit goes through one helper, so deferring it is a context flag rather
        than a rewrite (`deferring commits` was prototyped and reverted, in `docs/lifecycle-of-a-task.md`'s history).
- [ ] **A short TTL on the tree listing, for reads only.** Within the TTL a burst of reads costs no request at all; writes
      never trust it, because a write's commit is a compare-and-swap against the real head.

## How to verify

`BTID_TIMING=1` on the commands, measured the same way as the table in the approved task: a 10-task seed and a 20-command read
loop, before and after.
