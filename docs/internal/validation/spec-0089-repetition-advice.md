# SPEC-0089 validation: neutral repetition advice

Date: 2026-09-22. Base: `34867fa8515230a9c283b1d40c975dca85487633`.

The only product change is two shared handoff advice strings. The repeated-call
detector, amount calculation, row label, recurrence gate and JSON schema remain unchanged.
The standing rule recommends reuse only when an earlier result answers the question
and is still current, permitting legitimate polls and checks against changed state.

## Local occurrence audit

The bounded convenience sample comprised the 80 most recent discovered Claude Code
sessions and 200 most recent Codex sessions, ordered by recorded start time and path
as a tie-breaker. Three Claude files above 64 MiB were excluded before parsing;
277 sessions were examined. A private manifest freezes the analyzed cohort.
Only aggregate evidence is retained here; no prompts, commands, output, session
identifiers or local paths are published.

| Source | Sessions | Tool calls | Recorded ok | Recorded error | Pending/absent |
|---|---:|---:|---:|---:|---:|
| Claude Code | 77 | 19,292 | 18,316 | 975 | 1 |
| Codex | 200 | 11,060 | 1,158 | 0 | 9,902 |

Nine consecutive identical-call runs occurred in eight sessions: three runs had
only recorded `ok` results and six had no terminal outcome. None was all-error.
An independent scan using the existing tool-name/normalized-input identity was
cross-checked against the real detector. The status counts describe adapter output,
not subprocess exit codes or task correctness. In particular, Codex result coverage
is limited; unknown outcomes must not be promoted to failures.

This sample establishes that the failure-specific instruction is unsupported in
observed cases. It does not establish whether any repeated call was unnecessary,
a population precision rate, a causal improvement, or recoverable dollars. The new
positive repeated-failure detector and outcome-count export proposal were deferred.

## Actual CLI and visual checks

All eight flagged real parent transcripts were processed by the built `dist/cli.js`
with `--handoff`: eight exit-zero results, eight neutral instructions, zero old
failure instructions. A test-only Node preload redirected `os.homedir()` to a
temporary discovery root containing one unchanged transcript copy at a time.
`HOME` and `CODEX_HOME` were not reassigned. Parsing, detection, pricing, CLI dispatch
and rendering were real; there were no detector or renderer mocks. Telemetry was
disabled and output was captured in memory for aggregate assertions. Temporary
copies were removed. This validates parent-transcript advice, not adjacent-child
discovery or full-history performance.

A normal unisolated `--handoff <session>` attempt exceeded the 180-second test bound:
explicit selection eagerly loads the full local history. It is recorded as an
existing discovery limitation, not hidden by the isolated checks or changed in this
PR. No claim is made that the ordinary command met a latency target.

The synthetic handoff terminal capture was rasterized and inspected: the neutral
instruction fits the existing width, the cost qualification remains visible, and
no text overlaps. The product's existing compare SVG containing the same loop row
was rasterized and inspected; the preserved label, amount and turn detail remain
readable. No private transcript was used for public screenshots. The guide's
example is copied verbatim from the generated synthetic handoff golden.

## Regression and gate record

Nine targeted regression cases cover successful rereads, successful and pending
polls, deliberate negative tests, absent/mixed results, intervening edit/input
changes, conditional reuse, and priced status-invariance of handoff JSON. Existing handoff, PR and built-CLI assertions retain
their strength and adopt the new literal copy. The only changed golden is the one
handoff instruction in `goldens/handoff-claude-code-loop-bash-5x.txt`; the other 101
artifacts are byte-identical. Ten golden-verification runs are byte-identical.

Typecheck, lint, spec lint and hygiene passed. The initial full suite passed 2,230
of 2,232 tests: generated docs were briefly stale before regeneration, and an
existing 200ms statusline timing assertion took 388ms under concurrent load. Docs
were regenerated; the timing assertion was not weakened. The final full rerun with `npx vitest run --maxWorkers=2` passed all 147 files and
2,232 tests (exit 0), including the unchanged timing test. Independent Fable review of the initial commit also passed all 2,232 tests with one
worker, all 102 goldens and ten deterministic runs. Its low-priority feedback added
a ninth regression case comparing real priced amounts and the complete handoff
JSON across status variants. Final delta review is recorded in the PR comment.
