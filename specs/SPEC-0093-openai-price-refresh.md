---
id: SPEC-0093
title: Cite observed OpenAI prices and GPT-6 context tiers
status: draft
milestone: M2
depends: [SPEC-0005]
---

# SPEC-0093: Cite observed OpenAI prices and GPT-6 context tiers

## Purpose

Extend the reviewed per-request context-tier schema to the cited GPT-6 Standard
API rows and add current OpenAI model prices without claiming that today's rates
applied at model launch. This protects I1 (deterministic, offline arithmetic),
I2 (no price without a dated matching row), I3 (cited numbers), I4 (local-first),
I5 (stable output), and I6 (facts rather than model rankings).

## Requirements

- **R1 — Observation date.** New rows without dated historical rate evidence begin
  on the date the official pricing page was observed. Earlier sessions remain
  tokens-only. A launch announcement establishes model availability, not price
  history.
- **R2 — GPT-6 tiers.** Use the existing `context_tiers` schema for Astra, Sol,
  and Luna. Select the long-context tier only above 272,000 prompt-input tokens,
  applying the cited full-request input, cached-input, cache-write, and output
  rates. The boundary and both tiers need official sources in each row.
- **R3 — Cited current rows.** Add exact model ids only when an official OpenAI
  source supports every populated rate. Unknown or unpriced dates abstain.
- **R4 — No new product behavior.** The resolver in `src/pricing/resolve.ts` and
  `src/pricing/calculate.ts` keeps the SPEC-0005 lower-bound cost language and
  existing provider restrictions. The table supplies data; it never calls a
  model or fetches pricing at runtime.

## Scenarios

- **Given** a GPT-5.2 Codex session before the observed rate date, **when**
  pricing resolves, **then** it returns no dollar price.
- **Given** a GPT-6 Sol request at or below 272,000 input tokens, **when** it is
  priced, **then** it uses the short tier; above that boundary it uses the cited
  long tier for the full request.
- **Given** an unknown OpenAI id, **when** it is priced, **then** it stays
  tokens-only.

## Non-goals

Historical rate backfill without dated rate evidence; Batch, Flex, Priority,
regional, or subscription pricing; invoice reconciliation; model rankings or
claims about task success.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 earlier date | New model before observed rate | No price |
| R2 boundary | GPT-6 at 272,000 / 272,001 input | Short / long tier |
| R3 unknown and citations | Unlisted model id; new rows | No price; official source, date, excerpt |
| R4 existing path | Resolver and output goldens | No runtime fetch or contract change |

## Success criteria

- [ ] Maintainer approves this draft before the GPT-6 tier rows merge.
- [ ] Tests cover the observation-date abstention and GPT-6 tier boundary.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      and `node scripts/verify-goldens.mjs` pass unmasked; remaining AGENTS.md
      verification gates pass and CI is green.
