---
id: SPEC-0092
title: Validate a local workflow-outcome sidecar with a controlled pilot
status: building
milestone: M4
depends: [SPEC-0000, SPEC-0001]
---

# SPEC-0092: Validate a local workflow-outcome sidecar

## Purpose

Pair existing compare receipts with separately measured task outcomes. A four-run,
two-task controlled coding pilot checks whether a local analyst sidecar retains
all assigned attempts and independent acceptance evidence. No product command is
added. See [preregistered protocol](../docs/internal/workflow-pilot-20260922/protocol.md).

## Validation

The maintainer explicitly authorized implementation of all five research-plan
steps, real workloads and PRs on 2026-09-22. The lead bounded this step to two tasks,
four runs and a validated analyst sidecar, with actual acceptance checks and no
causal cost claim. This records that authorization; it does not self-approve a
broader experiment or product surface. Protocol and hidden checks are committed
before execution; final independent review and measured results ride in this PR.

## Requirements

- **R1** — Preregister all four assignments before execution; paired snapshots,
  model/config and success criteria are equal except the focused-context sentence.
- **R2** — Retain every assigned attempt, failures, timeouts, repair and child
  coverage. Unknown usage or price does not remove an attempt from the denominator.
- **R3** — Outcomes come from actual independent acceptance tests and scope checks;
  never infer correctness from an agent's final prose or a receipt.
- **R4** — Validate sidecar completeness and constraints deterministically offline.
  Pair it with the existing product compare output, not a second pricing engine.
- **R5** — Publish measured descriptive results and limitations. Dollar savings,
  subtraction of floors and causal/quality claims are prohibited for this pilot.

## Invariants and design

I1: product remains deterministic, with zero model calls/network in its path;
manual trial executions are external evaluation, not aireceipts behavior.
I2: never fabricate dollars; absent tariffs stay tokens-only. I3: each observation
has a local execution/check artifact; no counterfactual quality claim. I4: local
artifacts only, no private transcript content or identifiers in public fixtures.
I5: receipt contract and goldens unchanged. I6: facts, not model/agent rankings.
Evidence, not judgment: only external checks establish their own tested scope.

The unchanged `src/receipt/compare.ts` renderCompare seam consumes two receipt
models. Existing `src/receipt/model.ts` buildReceiptModel and ClaudeCodeAdapter
supply those models; the sidecar adds declared task/attempt/outcome metadata in
`docs/internal/workflow-pilot-20260922/`, outside product imports and CLI dispatch.

## Scenarios

- Given a failed attempt, when summarizing outcomes, then retain its tokens/time
  and the assigned denominator.
- Given unknown tariff or child coverage, when analyzing, then record unknown and
  withhold complete-cost and causal claims.
- Given paired clean snapshots, when applying the intervention, then only the
  additional focused-context instruction differs.

## Non-goals

No new CLI command, detector, model router, agent controller, causal savings claim,
population inference or success grade. No private user corpus and no price changes.

## Test matrix

| Case | Expected |
|---|---|
| R1 Four distinct preregistered assignments | Validate |
| R2 Missing/duplicate assignment | Reject |
| R3 Failed check labeled accepted | Reject |
| R5 Unknown price asserted as savings | Reject |
| All assigned failures | Retain denominator; no cost/success ratio |
| R4 Invalid negative/nonfinite accounting/time count | Reject |

## Success criteria

- [x] Protocol and assignments preregistered before model execution.
- [x] All four real model attempts retained with independent acceptance evidence.
- [x] Sidecar validator positive and negative checks pass.
- [x] Existing compare output and measured, explicitly limited report attached.
- [x] Acceptance testing performed; typecheck, lint, full tests, goldens,
      determinism, spec lint and hygiene pass.
- [ ] Independent final review and CI green before handoff.
