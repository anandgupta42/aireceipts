---
id: SPEC-0091
title: "Verification evidence — recorded TypeScript check chronology"
status: building
milestone: M6
depends: [SPEC-0054]
---

# SPEC-0091: Verification evidence

## Purpose

Help a developer inspect a recorded TypeScript check after a later TypeScript edit,
or a recorded tool error, without claiming code is untested or defective. The user
authorized the bounded verification-chronology implementation in the five-step
research plan on 2026-09-22. This slice extends existing opt-in details, not a new
command or controller. I1: deterministic local facts, no model/network calls. I2:
no new dollars. I3: each fact identifies its captured turn and literal command
scope. I4: no transcript data sent. I5: shared renderer and golden-gated output.
I6: no judgment about correctness, necessity, or model quality.

## Requirements

- **R1 — One exact command family and one adapter.** Recognize only Claude Code
  parent-session real `Bash` calls with the literal command `npx tsc --noEmit` (outer whitespace
  permitted), with `run_in_background` absent or false. Chaining, pipelines,
  shell wrappers, environment prefixes, extra flags, and other adapters abstain.
  `ToolCall.shell/status/startedAt/endedAt` are the evidence seam
  (`src/parse/types.ts:58`); Claude maps linked `tool_result.is_error` into status
  (`src/parse/claudeCode.ts:460`). A status describes the tool result, not proof
  that TypeScript was installed or any particular project was checked. Never
  infer success from output text, including a quoted “passed”.
- **R2 — Neutral chronology only.** Use the latest recognized completed call.
  An `error` status records a tool error. An `ok` status yields a finding only
  if a later completed successful named `Edit`/`Write` targeted a `.ts`, `.tsx`,
  `.mts`, or `.cts` path and its start is strictly after the check's recorded end.
  No file path is exported. Require actual finite start/end timestamps and
  nonnegative intervals. Use captured turn indices, never an assumed Git revision
  or project scope. The finding is about the literal command in captured parent
  calls, not equivalent checks, external CI, children, or overall verification.
- **R3 — Abstain on incomplete chronology.** Any running/unknown tool status,
  dropped transcript records, a later uncompleted matching command, or ambiguous
  check ordering suppresses the finding. Failed edits and documentation-only
  edits do not trigger the successful-check chronology. A later completed
  matching call is the latest observation; an earlier failure is not declared
  repaired. Commands are never executed by this analyzer.
- **R4 — Standalone optional evidence.** A small pure analyzer in
  `src/analysis/verification.ts` produces optional evidence attached by one
  registration in `buildReceiptModel` (`src/receipt/model.ts:313`). The evidence
  remains outside `WasteLine`, money arithmetic, and flagged-pattern totals.
  An optional versioned JSON field records command, outcome, check turn and edit
  turn, plus scope. Missing evidence omits the field, preserving existing bytes.
- **R5 — Details-only presentation.** A new small presenter returns existing
  `note` blocks; one registration in `detailsBlocks`
  (`src/receipt/present.ts:404`) serves text/SVG/PNG equally. No default receipt,
  statusline, handoff, or PR summary changes. All lines fit 50 columns. Exact
  copy/design requires the lead's Fable review before integration.
- **R6 — Prove on real execution and adversarial evidence.** Execute actual
  TypeScript checks in a disposable workload, make an actual typed-source edit,
  capture a real vendor-recorded session, and run the built CLI on it. Derive a
  sanitized replay fixture preserving actual tool outcomes and timing; label
  its provenance without exposing raw private content. Test
  parser→model→CLI→text/JSON/SVG and render a PNG for visual review. Update
  details and JSON docs in the same PR; no raw command output in telemetry.

## Design — lead-arranged Claude Fable review

Details-only, plain notes at the end of DETAILS, one shared presenter:

```text
VERIFICATION EVIDENCE
npx tsc --noEmit..........tool result ok (turn 2)
TS edit after it........................turn 3
no later matching result recorded
(recorded calls only; external checks unknown)
```

For a latest tool error, substitute `tool result error (turn 2)` and omit
the edit line. These strings describe adapter outcomes, not compiler exit-code
proof. Both the user-visible label and JSON preserve the exact recognized command.
This proposal can be
narrowed during review without inventing broader command equivalence.

## Scenarios

- **Given** a completed recognized tool success and a later successful TypeScript
  edit, **when** details render, **then** the two captured turns are identified.
- **Given** a later matching completed success, **then** it becomes the latest
  observation and no earlier error is asserted unresolved.
- **Given** output says “passed” but structured status says error, **then** the
  result remains a tool error.
- **Given** external CI, prose claims, a docs-only edit, an unfinished call, or
  dropped records, **then** no broader correctness verdict appears.

## Non-goals

General shell parsing; inferring project/revision coverage; comparing different
commands; counting unrecorded CI; diagnosing errors from stdout; automatic reruns;
new flags; savings advice; default warnings; new telemetry dimensions; aggregate
subagent verification. The current status contract is deliberately weaker than
an authenticated compiler exit code.

## Test matrix

| Requirement | Case | Expected |
|---|---|---|
| R1 | exact Bash + foreground; chained/wrapped/background/MCP/other adapter | only exact foreground call eligible |
| R2 | success→typed edit; success→docs edit; failed edit; overlapping timestamps | eligible chronology only |
| R2 | error→later success; error output contains passed | latest observation; structured status authoritative |
| R3 | running/missing status; truncated/drop; missing time; out-of-order checks | abstain |
| R4 | standalone model/JSON + comparison export | strict schema; no money/flagged-pattern contribution |
| R5 | default/details/text/SVG/PNG | opt-in only; shared copy; ≤50 columns; golden evidence |
| R6 | actual disposable tsc check/edit/recheck workflow and CLI | factual execution capture; no network/model in product |

## Success criteria

- [x] Independent Fable design findings resolved.
- Final independent implementation review must be recorded with the PR before publication.
- [x] Actual workload replay, CLI E2E, and visual artifact inspected.
- [x] Exact positive/negative matrix passes without relaxed assertions.
- Required before publication: `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
  `node scripts/verify-goldens.mjs`,
  `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
  `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` pass unmasked, with actual
  results recorded in the PR (test workers may be limited under contention).

## Validation

2026-09-22 S1: actual adapter status/timing seams inspected through the graph.
Success is intentionally tool success, not parsed prose or implied compiler
coverage. S2: lead-arranged independent Claude Fable 5.1 review on 2026-09-22
authored the copy above; actual model confirmed by the lead from the response.
Accepted: literal foreground command, structured tool outcome, fixed literal scope,
no paths, external-check limitation, no handoff. Turn order is primary; timestamps
only veto a putative chronology. Narrower initial slice retained: TypeScript files
only, first later edit only, no check-only success section or earlier-success table;
ambiguous/incomplete chronology omits the finding instead of creating extra notes.
The lead explicitly directed implementation after this design review. S3: developer
resuming after edits is the intended user; real frequency is not yet established.
Cheapest experiment is the bounded replay plus real workload field coverage;
kill the actionable wording if scope/outcomes cannot support it. The result is
opt-in factual chronology, never a default accusation. Do-nothing leaves users
to inspect the transcript manually. Real Fable workload recorded an actual check
then actual TypeScript edit; the adapter and analyzer identified turns 2 and 3.
S4: spec lint passed. User authorized this bounded implementation; status building,
not shipped. Additional adversarial implementation review remains required before
PR publication and its exact reviewed commit will be recorded in the PR.

Live acceptance: the real vendor session ran the literal foreground typecheck,
then edited a TypeScript function. The built CLI on an isolated copy of the
original capture emitted check turn 2 / edit turn 3; its PNG was inspected for
clipping, accurate copy, scope limitation, and tokens-only honesty. Resuming that
same Fable session for a second real literal check with no later edit removed
the finding. The committed fixture preserves actual call/result timing and
structured outcomes with paths/prose sanitized; its adjacent provenance note
distinguishes controlled evidence from natural-use prevalence. Text and both SVG
themes are byte-pinned. The CLI E2E uses its own build directory to avoid a race
with the existing built-CLI suite's clean build.

Docs panel A: independent Claude Fable 5.1 cold-reader context ran the local
`node dist/cli.js --demo` equivalent of the README quickstart (distribution
installation was not under review). Fixed its two medium findings: clarify JSON
zero-based versus display one-based turns, and document the error variant.
Also fixed its lower-severity scope/footer/help clarity findings. Documentation
is a subsection of the existing receipt guide, avoiding a new navigation page.
Panel B correctness and final independent code review are recorded in the PR.

Independent Fable 5.1 implementation review of `9286a41` reran all gates and
found the same existing help-phrase contract failure (2,262 / 2,263 tests pass).
Restored `classic template only`, preserving its assertion and golden contract.
Strengthened the money-invariance test with an explicitly synthetic, nonzero
priced control; the real capture stays untouched and tokens-only. Also excluded
sidechain sessions so the emitted parent-call scope stays literal. Review found
no model/network calls, invented dollars, path exposure, or prose-based verdicts.
The final corrected commit is re-reviewed before publication; PR records carry
its SHA and actual completed gate results.

The lead reassigned this unchanged scope to SPEC-0091 after the cross-worktree
inventory found another open PR reserving 0085–0088. This is identifier-only;
prior review records retain their historical spec number and reviewed commit.
