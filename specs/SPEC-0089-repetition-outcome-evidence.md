---
id: SPEC-0089
title: "Keep repeated-call advice neutral"
status: building
milestone: M5
depends: [SPEC-0013, SPEC-0059]
---

# SPEC-0089: Keep repeated-call advice neutral

## Purpose

An identical-call pattern is not evidence of repeated failure. The existing detector
(`src/pricing/waste.ts:105`) groups consecutive identical calls without inspecting
recorded status, while the handoff tells users to change or stop after identical
failures. A bounded local audit of 277 real sessions found nine repeated-call runs:
three with only recorded `ok` results, six with no terminal outcome, and none with
every call recorded as an error. Keep the pattern and its accounting; correct the
two advice strings that infer failure. A new repeated-failure detector is deferred.

The maintainer authorized this scoped research implementation on 2026-09-22,
including real-workload checks, Fable review, visual tests and PRs. This spec records
that authorization for the neutral correction, not approval of unrelated scope.

## Requirements

- **R1 — Neutral slip advice.** Replace the repeated-call slip instruction with
  `check whether repeated calls were needed`. It must not infer failure from
  repetition. The same shared string applies to handoff and PR slips.
- **R2 — Conditional reuse rule.** The recurring-pattern standing rule asks whether
  the earlier result answers the question and is still current before reuse. It
  must not instruct users to stop a legitimate poll or expected-failure experiment.
- **R3 — Preserve the contract.** Keep the detector, thresholds, row label, badge,
  turn detail, costs, identifiers, JSON shape and recurrence gate unchanged.
  Repetition cost is allocated observed pattern cost, not recoverable dollars.
- **R4 — Real and adversarial validation.** Check successful reads, polling,
  expected failures, pending/absent results, mixed outcomes and intervening edits.
  Run the built CLI on the privately manifested real cases; retain only content-free
  aggregate evidence. Review a synthetic terminal/SVG rendering. No population
  precision or savings claim follows from this convenience sample.
- **R5 — Documentation and goldens.** Update current handoff guidance and affected
  golden outputs. Historical specs/design mockups remain historical. Run repository
  verification with unmasked exit statuses.

## Invariants

I1: deterministic local strings, zero model/network calls in the product path.
I2: no price changes or fabricated dollars. I3: existing traceable pattern-cost
interpretation remains; no avoided-dollar or failure claim. I4: local-first,
unchanged escapable content-free telemetry. I5: deliberate byte-stable golden
changes. I6: facts, no model/agent rankings or correctness judgments.

## Design

Claude Fable (`claude-fable-5-1`, lead-coordinated design review, 2026-09-22) chose
the smallest correction: exactly two static advice strings. Keep `Read loop ×3`,
its badge, turn detail and amount unchanged. Add no new UI block or outcome schema.

- Slip: `check whether repeated calls were needed`.
- Standing rule: `Before repeating a tool call with identical input, check whether the earlier result already answers it. If it does and is still current, reuse it.`

The second sentence qualifies Fable's original unconditional reuse wording so
legitimate polling and changed state remain allowed. This qualification is called
out for final independent review. Outcome-count exports and a positive error branch
are deferred: this audit establishes the advice defect, not benefit from a new
schema or a real repeated-error occurrence.

## Scenarios

- Given three successful reads, when handed off, the advice asks whether the calls
  were needed without saying they failed.
- Given three pending polls or deliberate negative tests, the same neutral
  instruction appears; neither error status nor output text creates a stop rule.
- Given mixed or absent statuses, repetition remains a structural fact only.
- Given two attempts, an edit, then another attempt, the unchanged detector does
  not invent a three-call run across the edit.
- Given a recurring pattern, the standing rule permits a new call when the old
  answer is insufficient or no longer current.

## Non-goals

New detectors, status inference, output parsing, adapter repair, outcome-count
exports, live execution control, model routing, new telemetry, pricing changes,
and causal or automatic-savings claims. Do not modify skills or approve a release.

## Test matrix

| Requirement | Input | Expected |
|---|---|---|
| R1 | Successful, polling, pending, absent, mixed and explicit-error runs | Same neutral handoff; no failure claim |
| R2 | Recurring repeated calls | Conditional reuse; existing recurrence threshold |
| R3 | All statuses varied with fixed usage | Same finding membership, cost and JSON |
| R3 | Different tool/input/edit interrupts calls | No invented three-call run |
| R4 | Real manifest | Built CLI exit, neutral instruction, no raw evidence published |
| R4 | Synthetic visual | Readable terminal/SVG and unchanged row layout |
| R5 | Current guide, intentional golden changes | Exact shared copy and deterministic output |

## Success criteria

- [x] Successful/pending/expected-failure runs receive no unsupported failure advice.
- [x] Detector, pricing, JSON contract and recurrence behavior remain unchanged.
- [x] Real workload CLI checks and visual terminal/SVG review are recorded.
- [x] Full repository verification passes with unmasked exit statuses.

## Validation

2026-09-22 — S1: unchanged pricing/schema/detector; no inferred failures or new
content export. The change corrects an observed interpretation error.

S2: independent Fable design review chose the neutral correction and deferred the
unobserved positive branch. The coordinating agent accepted that scoped design.
The final independent Fable review accepted the conditional-reuse qualification
and passed all gates on the initial implementation. The metadata/test follow-up
receives a focused delta review recorded on the PR.

S3: adapter-based audit examined 77 Claude Code and 200 Codex sessions (30,352
calls); three Claude files over 64 MiB were excluded. Nine existing structural
runs occurred in eight sessions: three all-`ok`, six without a terminal outcome.
None were all-error, despite 975 error calls elsewhere. Independent grouping was
cross-checked against the actual detector. This does not prove repetitions were
necessary or estimate a population rate; it demonstrates why repetition alone
cannot establish failure. A docs-only warning leaves the erroneous action copy in
the actual handoff. Verdict: build this neutral correction; defer the error branch.

S4: spec lint passes. See [the validation record](../docs/internal/validation/spec-0089-repetition-advice.md) for bounded real-workload evidence, visual checks, deliberate golden changes and test limitations. Final gates and independent code review are recorded on the PR.
