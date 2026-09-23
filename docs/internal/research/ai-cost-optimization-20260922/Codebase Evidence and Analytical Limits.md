# aireceipts: historical implementation evidence and analytical limits

> Baseline correction: the initial code audit used the older `a56a6a7` checkout. Current `origin/main` at `34867fa` has substantial additional implementations. [Current-main reconciliation](Current%20Main%20Reconciliation.md) and the revised delivery plan supersede any older-code gap or new-feature claim below. Provider and research-source findings remain separately dated.

Research date: 2026-09-22. Baseline: `a56a6a7689dba82d8eef256c1c6e9127065a24af`.
Worktree: `research/ai-cost-optimization-20260922`.

This is a historical read-only implementation assessment of the initial checkout, not a bug-fix spec or a claim that real users were misbilled. Symbol discovery and source inspection used codebase-memory-mcp, freshly indexed for this worktree. Config, specs, and corpus manifests were read directly. The original worktree has uncommitted changes; this research uses its committed HEAD and the user-provided constitution. It does not incorporate those unrelated edits.

## Existing capabilities worth extending

The product already has vendor adapters, dated cited price rows, per-tool attribution, three waste analyses, comparative receipts, weekly aggregation, handoffs, budget/statusline integration, and PR attribution. Adding another spend chart or another generic cheaper-model recommendation would duplicate substantial existing work.

| Capability | Inspected implementation | What it establishes |
|---|---|---|
| Normalized usage | `src/parse/types.ts:44` (`TokenUsage`) | Input, output, cache read, cache creation, optional 5m/1h creation subsets, total |
| Tool events | `src/parse/types.ts:58` (`ToolCall`) | Name, input/output, optional status, shell marker, genuine start/end timestamps |
| Turns | `src/parse/types.ts:78` (`Turn`) | Index, optional timestamp/model/usage/output tokens, tool calls |
| Price schema | `src/pricing/types.ts:21` (`PriceRow`) | Flat input/output/cache rates plus date interval and citations |
| Cost arithmetic | `src/pricing/resolve.ts:107` (`costOf`) | Disjoint normalized token buckets priced and added; cached-rate fallback exists |
| Attribution | `src/pricing/attribution.ts:64` (`attributeByTool`) | A turn's cost is divided equally among its tool calls; tool-free turns use the thinking/reply category |
| Repeated calls | `src/pricing/waste.ts:86` (`detectStuckLoops`) | Consecutive equal tool names and normalized inputs, minimum run of three |
| Repricing | `src/pricing/waste.ts:137` (`detectTrivialSpans`) | Tool-free turns with at most 120 output tokens repriced against a lower-input-rate model |
| Context refill | `src/pricing/waste.ts:241` (`detectContextThrash`) | Refill after clustered compactions; unioned prompt-side token windows avoid repeated counting within a finding |
| Weekly overlap | `src/aggregate/waste.ts:70` (`aggregateWaste`) | Existing non-additive flags for overlap between context-thrash and other classes |
| Receipt assembly | `src/receipt/model.ts:200` (`buildReceiptModel`) | One shared model, existing parse-drop/cache-tier caveats; loop/trivial span turn indices are not retained in the displayed finding shape |
| Comparison | `src/receipt/compare.ts:17` (`compareDeltaLine`) | Descriptive cost/token ratio; explicitly declines a direct priced/unpriced comparison |
| Discovery | `src/parse/load.ts:18` (`listFullSessions`) | Loads summaries through a cache; adapter-level exceptions become empty lists |

Line references are for the baseline commit, not promises about future line numbers.

## Six findings that materially change the roadmap

### 1. Provenance must come before stronger savings claims

The usage and price types lack explicit billing basis, service tier, modality, context-length tariff dimensions, request-level price provenance, and a reasoning-output subset. Some adapters retain relevant raw information, but the shared contract cannot represent these distinctions comprehensively.

`data/prices/google.json` explicitly omits Gemini Pro models because tiered context prices cannot be represented honestly. Conversely, the GPT-5.5 entry in `data/prices/openai.json` stores short-context rates while its own citation mentions a long-context tariff. This asymmetry warrants a scoped audit. It does not establish that a particular transcript crossed the threshold or that any invoice was wrong.

The useful fix is not to add guessed rates. It is to record supported tariff applicability, refuse an exact dollar total when required dimensions are missing, and show the priced subtotal and unpriced usage separately. A `lower-bound` label is valid only if missing charges are known to be nonnegative; an unknown discount or service tier can move the actual cost in either direction.

SPEC-0044 is already building and records unfinished self-check/cost-model documentation plus a deeper discovery load-failure gap. Finish and verify that work before presenting a new optimization layer as trustworthy. Its dated implementation notes are evidence of past work and known gaps, not proof that every checklist item is currently complete.

### 2. Repeated input does not prove wasted work

`flattenCalls` (`src/pricing/waste.ts:52`) retains normalized input and cost shares but drops status/output from the detector's working representation. `detectStuckLoops` consequently cannot distinguish three legitimate polling calls from three identical failures using outcomes. It also cannot establish whether external state changed between calls.

This is an implementation-derived counterexample, not a measured false-positive rate. The next research task should label real repeated-call sequences independently, with negative cases for polling, retries after a state change, flaky tests, rate-limit recovery, and explicit repeated measurements. A higher-confidence finding requires stable command identity plus observed failure and state evidence; otherwise use neutral repeated-call wording or abstain.

The sum attributed to a repeated-call run includes the first call. Even if a later retry was avoidable, the first failed attempt may have been necessary discovery. Report observed spend in the sequence; never equate the whole amount with recoverable savings.

### 3. Short output is an inadequate routing signal

The current repricing rule checks output length, tool absence, priced usage, and a cheaper input rate. It does not measure task difficulty, reasoning effort, answer correctness, or the user's acceptance. A short security decision and a short acknowledgment can satisfy the same length rule.

`cheapestCurrentRow` (`src/pricing/resolve.ts:123`) chooses by input price, not by the complete token mix. It selects an open-ended current row, rather than a date-matched historical alternative. These choices can be valid for an explicitly labeled current-price illustration, but cannot justify a cheapest-total-cost claim or a historical counterfactual.

The active engine spec already calls this **re-priced trivial spans**, not proven routable spend (`specs/SPEC-0001-m1-receipt-engine.md:48`). Preserve that restraint and make future candidate routing an experiment suggestion. Calculate any arithmetic alternative using the complete eligible token mix and explicit tariff/date assumptions. Do not turn an existing heuristic into an automated router.

### 4. Attributed tool cost is not the tool's marginal cost

The shared attribution function deliberately divides each turn's model cost evenly across calls. A read tool may appear to cost money because of the allocation convention, while its output adds input tokens on later turns. Conversely, a tool can consume external compute whose price never appears in the transcript.

A future tool-output analysis should keep three separate quantities: direct recorded tool charges, allocated model spend, and observed output size. An optional replay-exposure estimate needs evidence that a specific result remained in subsequent prompts, plus cache status and compatible tokenization. Without that evidence, bytes/characters are honest and marginal dollars are not.

### 5. Preserve evidence through rendering; do not add overlapping amounts

The raw stuck-loop and trivial-span findings already carry turn indices, but receipt assembly drops those indices for those two kinds. The context-thrash finding retains them. Preserve stable source references consistently in a future versioned analytical export; do not create a competing renderer.

Weekly aggregation already labels certain overlaps as non-additive. Extend this existing mechanism instead of announcing overlap detection as a new feature. For a deduplicated total, calculate a union of actual billed token/cost atoms. Do not union whole turns if one detector covers prompt tokens only and another covers only an equal-share tool allocation. Do not mix observed spend with alternative-price arithmetic in the same sum.

### 6. An evaluation fixture is not an independent value study

`eval/corpus.json` has 25 entries at the baseline. Its introductory text says expected findings were verified against detector output. The manifest is useful for regression checks; it does not establish independently labeled precision on real workloads. This is a limitation of what the manifest proves, not a claim that its fixtures were all generated or mislabeled.

The repo's `/improve` and `/add-waste-check` skills already demand real occurrences, negative examples, non-redundancy, and value gates. Make those requirements measurable: label a holdout without showing detector output, split by task/repository rather than random turns, report abstentions and false-alert frequency, and keep implementation-authored goldens separate from the value corpus.

## Proposed analytical contract

Extend existing normalized events and receipt exports incrementally after a draft spec is approved. A finding should carry:

- Stable local evidence references and a deterministic detector/version identifier.
- Which prerequisites were observed, missing, or inferred.
- A factual description and one suggested action, with its applicability.
- Amount semantics: observed allocated spend, API list-price equivalent, arithmetic scenario, measured experimental difference, or unknown.
- Token/cost atom coverage and overlap references.
- Known negative cases and why this instance passed or why the detector abstained.

Keep observed facts, heuristic interpretations, and interventions separate. Confidence should begin as explainable categories, not an uncalibrated numeric score. A suggestion can be useful with no dollar estimate.

Unknown is not zero: unknown timestamps prevent a duration claim; unknown success prevents a failure claim; unknown price applicability prevents an exact-dollar claim. A cumulative vendor usage field must be differenced according to that vendor's semantics, with reset/dedup handling, before treating it as a request increment.

For reproducibility, retain the transcript digest, parser version, analysis-policy version, cited price-bundle digest, explicit effective date, and user-supplied configuration. These are local artifacts. Do not export raw commands, paths, prompts, or guessable hashes through telemetry. Public exports need explicit redaction and should prefer receipt-local opaque references over content hashes.

## What has not been established

No private transcript corpus was sampled for this research. No provider bills were reconciled. No optimization was deployed, and no model was run for an outcome comparison. Therefore this report makes no measured claim about user savings, detector precision, or achievable acceptance-rate improvements.

The plan's first measurement gate exists to discover those facts. Existing product tests can establish baseline behavior and protect contracts; passing them cannot substitute for that measurement.
