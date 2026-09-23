# Research validation and review

Date: 2026-09-22. Delivery baseline: freshly fetched `origin/main`, `34867fa8515230a9c283b1d40c975dca85487633`. Initial historical audit baseline: `a56a6a7689dba82d8eef256c1c6e9127065a24af`.
Research branch: `research/ai-cost-optimization-20260922`.

## Scope

Six research documents contain approximately 16,100 words and link 40 distinct primary-source URLs. This seventh document records verification. Three specialist agents researched in parallel; the lead performed code inspection, additional primary-source research and synthesis. All agents then performed bounded adversarial reviews.

The bundle contains proposals and evidence, not approved implementation specs. No product source, price rows, skills or existing spec status was modified. No release, PR publication, paid model experiment or private-transcript value study was performed.

## Current-main verification

All commands below ran in the new worktree after advancing it to current main and installing its locked dependencies. Exit codes were inspected directly from the execution tool; no command was piped through a summarizing filter.

| Command | Exit | Result |
|---|---:|---|
| `npx tsc --noEmit` | 0 | Passed |
| `npx eslint . --max-warnings 0` | 0 | Passed |
| `npx vitest run` | 0 | 146 files, 2,224 tests passed |
| `node scripts/verify-goldens.mjs` | 0 | 102 artifacts byte-identical |
| `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs` | 0 | All 10 runs byte-identical |
| `node scripts/spec-lint.mjs` | 0 | 78 specs OK |
| `node scripts/hygiene.mjs` | 0 | Passed |

The first attempted reuse of the original checkout's dependencies failed typechecking because `@types/node` was unavailable. That temporary symlink was removed, and the new worktree received its own lockfile-based `npm ci --ignore-scripts` installation. The initial older-baseline verification then passed 1,306 tests and 95 goldens. After discovering newer main, the worktree was advanced with `git reset --keep origin/main`, preserving only the research documents, and dependencies were installed again. The successful results in the table are the later current-main run. No dependency manifest or lockfile was edited by this task.

These checks establish the baseline and unchanged receipt contracts. They do not establish that proposed detectors work, that users save money, or that all price applicability gaps are resolved. No new implementation tests were written for these research-only documents.

## Review corrections incorporated

1. **Invalid overlap example:** current tool-free trivial spans cannot overlap a tool-call loop on the same turn. Replaced with loop/context-refill overlap.
2. **Incorrect union invariant:** a partially overlapping finding may add newly covered spend. Idempotence applies to identical/subset coverage, not every overlap.
3. **Wrong union granularity:** event-level union can sweep in unrelated output or tool allocations. Future combined totals need billed components/allocation slices; initial work retains non-additive flags.
4. **Inconsistent reliability gates:** 30 pilot cases or 90% precision cannot certify near-zero false positives. Harmonized default-label requirements and explicitly separated arithmetic, finding reliability and intervention value.
5. **Practical value:** the intervention gate must clear a predeclared meaningful reduction, not merely a statistically positive change.
6. **Scope creep:** a universal event schema, reconstructed prompt ledger and generalized tariff platform are not prerequisites. Narrowed the first slice to one demonstrated ambiguity and observable fields.
7. **Causal language:** model-switch and child spend are decomposition until a controlled comparison supports overhead/effect claims.
8. **Missing-price selection bias:** primary reporting retains every assigned attempt. A restricted priced cohort is sensitivity/descriptive analysis unless eligibility was fixed before assignment.
9. **Baseline mismatch:** the initial feature branch lagged main substantially. Freshly fetched main was independently inspected, the worktree advanced, recommendations revised to credit shipped features, and all required checks rerun. A dedicated reconciliation records current source references.
10. **Qualified-floor wording:** unknown pricing must never silently become known zero; omitted components may contribute zero to an explicitly qualified floor while retaining their usage and caveats.

Final current-main review found one remaining wording issue about qualified floors (item 10), which the lead corrected. Earlier reviews and the main reconciliation also removed redundant implementation proposals. The failure/evaluation reviewer independently checked the illustrative IID precision calculation: 299 all-correct observations give `0.05^(1/299) ≈ 0.99003085`; correlated sessions do not satisfy that model automatically.

## Evidence limits and document integrity

Provider documentation and competitor repositories were opened, not merely taken from search snippets. The market review reports documented capabilities, not hands-on execution. Research studies' limitations are retained, including task scope, historical model versions, selection, grader validity and infrastructure effects.

Code claims are anchored to inspected symbols at their explicitly named historical or current baseline; current-main reconciliation takes precedence. A missing schema dimension is not itself proof of a wrong real receipt. The current 25-entry evaluation manifest is useful regression evidence but not a substitute for independent real-world labels.

Before delivery, all seven Markdown documents were checked for trailing whitespace, unresolved placeholders, broken relative Markdown links and internal citation artifacts. The source and Obsidian copies were compared byte-for-byte. The original checkout's pre-existing modifications remain outside this worktree's research diff.

Vault destination: `/Users/anandgupta/obsidian/altimate/Research/AI Cost Optimization and Mistake Prevention/`.
