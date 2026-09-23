---
id: SPEC-0090
title: Report complete observed net cache price arithmetic
status: building
milestone: M83
depends: [SPEC-0054]
---

# SPEC-0090: Report complete observed net cache price arithmetic

## Purpose

Extend cache details with the read discount less observed write premiums. Gross read repricing can mislead a user when cache writes outweigh reads. The signed result describes the same observed tokens at cited Standard API rates; it is neither invoice savings nor a cost floor. The maintainer authorized this scoped research delivery plan on 2026-09-22 ("go ahead and do"), including real workloads, Fable review, visual tests and PRs. This document records that scope; it does not approve unrelated work.

## Requirements

- **R1** — Only coherent Claude Code request snapshots with explicit valid input/output/read/write and both TTL counters, whose TTL sum exactly equals writes, qualify. Preserve an optional per-snapshot completeness marker through the existing whole-snapshot selection. Aggregation does not invent completeness. Other adapters abstain.
- **R2** — Every usage-bearing request must resolve its own model/date/provider and cited context tier; any missing observation, dropped record, unattributed usage, contradiction or applicable rate makes the session net result unavailable. Never subtract two receipt floors. No partial subtotal presented as a session net result.
- **R3** — Compute `(reads*(input-readRate) - writes5m*(write5mRate-input) - writes1h*(write1hRate-input))/1e6`, retaining negative and zero results. Reuse the existing price resolver/context selector. Require a rate only for a nonzero bucket; generic write rate may match both TTLs if cited.
- **R4** — Add opt-in details copy and an optional structured JSON field, with an explicit arithmetic interpretation, excluded from total/waste/savings/handoff/PR aggregates. Parent-only when child transcripts exist. Preserve compact default output.
- **R5** — Verify positive, negative, zero and unavailable cases, real local transcript processing, independent Fable review, visual output and all repository gates. No private transcript contents or paths in public evidence.

## Invariants

I1: deterministic, zero model calls and network in the product path. I2: no fabricated dollar; dated cited matching rates only. I3: traceable arithmetic, never a proven savings claim. I4: local-first with unchanged disclosed escapable content-free telemetry. I5: byte-stable output with deliberate golden changes. I6: facts, no model or agent rankings.

## Scenarios

- Given reads outweigh write premiums, details reports a positive signed price difference and its exact interpretation.
- Given a cold cache with costly writes, details reports a negative difference, never clamps to zero.
- Given missing counters (including Codex writes), a missing price or one incomplete request among complete siblings, no net dollar is reported.
- Given duplicate streaming snapshots, the marker follows the selected whole usage vector; an incomplete later selected snapshot cannot inherit earlier completeness.

## Non-goals

Invoice reconciliation, subscription savings, cache hit causality, identifying cache invalidation, live provider calls, changing cache billing, cross-session caching, or extrapolating quality. No new command or flag. No automatic workflow intervention.

## Design

Claude Fable (`claude-fable-5-1`, local CLI design review, 2026-09-22) authored the design: place `cache vs uncached` directly after the gross read-repricing note; render `$1.87 lower`, `$0.42 higher`, or `$0.00` without a prefix. Add `(hypothetical no-cache price, same tokens)`, `(read discount minus write premium)`, and `(parent session; arithmetic, not a prediction)`. Omit incomplete text; retain unavailable reason in JSON. The parent qualification tightens the reviewed copy. Retain full floating-point rate arithmetic until symmetric display rounding; do not round individual requests to microdollars (fractional microdollars are real at some rates).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R3 Positive/negative/zero | Complete request, mixed TTL writes | Signed oracle arithmetic |
| R1 Missing observed counters | Missing read/write/TTL, unknown adapter | Unavailable, no net dollars |
| R2 Missing applicable rate | Nonzero bucket without citation | Unavailable |
| Context boundary | Requests above/below threshold | Per-request rates |
| Mixed completeness | Complete + incomplete request | Whole result unavailable |
| Malformed/snapshot | Contradiction, duplicate with different completeness | Fail closed; selected vector only |
| R4 Receipt surfaces | details/JSON/default | Explicit interpretation, unchanged compact receipt |
| R5 Real workload | Local vendor transcript through built CLI | Traceable arithmetic or honest abstention |

## Success criteria

- [x] All requirements covered by tests, mutation gate for new pricing logic.
- [x] Real workloads and visual output inspected; Fable review findings resolved.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`, `node scripts/verify-goldens.mjs`, determinism (10 runs), spec lint and hygiene pass with unmasked exits.

## Validation

Reuse audit: `ratesForUsage`, `resolvePrice`, `pricingUnitsForTurn`, `withTotal` and Claude whole-vector snapshot selection already exist. The current `cacheReadAtInputRateDelta` omits write premiums, so it cannot serve as a net calculation. Smallest useful extension is one pure pricing module plus details presentation, with a per-snapshot evidence marker rather than a general provenance rewrite. Independent critique by the failure-prevention agent (separate context, 2026-09-22) found no blocker and endorsed the value subject to the real-trace gate. It requested caution on generic write-rate applicability: existing PriceRow defines that field for writes without TTL-specific prices; Anthropic currently uses explicit TTL rates. Raw cohort observation: 39,371 of 39,375 snapshots carried explicit valid cache fields (duplicates included); full-session eligibility is checked separately. User authorization is the go-ahead recorded above; no agent approval of a broader scope is implied. Kill criterion: if no real trace has complete eligible observations, defer dollar presentation and retain evidence findings instead of weakening the rule.


Final validation at implementation commit `2d0f99e`: independent Claude Fable
(`claude-fable-5-1`) returned PASS after personally running tsc, ESLint,
147 files / 2,253 tests, 105 goldens, spec lint, hygiene and 10-run determinism,
all exit 0. New money-module mutation: 144/154 killed, 93.51%, gate exit 0.
Subsequent documentation-anchor/quoted-methodology corrections and an explicit
JSON interpretation assertion receive focused checks and exact-HEAD delta review.

Administrative numbering correction: a global inventory of 47 worktrees and
open PR reservations found SPEC-0083 already allocated elsewhere. This scoped
feature is SPEC-0090; no behavior, approval scope or evaluation criteria changed.
