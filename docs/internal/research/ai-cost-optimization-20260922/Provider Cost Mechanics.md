# Provider cost mechanics: reliable accounting before optimization

> Baseline correction: the initial code audit used the older `a56a6a7` checkout. Current `origin/main` at `34867fa` has substantial additional implementations. [Current-main reconciliation](Current%20Main%20Reconciliation.md) and the revised delivery plan supersede any older-code gap or new-feature claim below. Provider and research-source findings remain separately dated.

Research date and source access date: **2026-09-22**. Scope: official OpenAI, Anthropic, and Google documentation, opened during research; no paid model calls. Recommendations below are proposals, not approved specs. Product grounding: `AGENTS.md`, `specs/SPEC-0000-product.md`, and the parent research agent's code inspection. Prices and product behavior are snapshots, not promises about historical sessions or future availability.

## Decision

Current main already implements an explicit Standard-API-equivalent basis, request-level tariff resolution and conservative floors. Prioritize conformance with current dated prices, then extend net cache economics and measured workflow comparisons. A superficially precise savings number is worse than an honest unknown when the transcript omits cache-write categories, service tier, geography, subscription treatment, or a long-context threshold. The opportunity is to explain **which observed behavior consumed resources, how confidently it can be priced, and what experiment would test an improvement**.

The highest-value finding is that API pricing and subscription credit accounting can differ even for cache writes on the same model. The second is that familiar caching and long-context rules already vary by model generation. Rules such as “OpenAI cache writes are free,” “all Claude cache reads cost one tenth,” or “Claude above 200k always costs extra” are unsafe as universal assumptions.

## What the opened primary sources establish

Each numbered entry gives a bounded source summary. Source-specific rates should become cited, dated data only through the repository's price-update process.

1. **OpenAI prompt caching.** GPT-5.6 and later use a 1.25× cache-write rate and a 0.1× read rate; cache writes replace the ordinary input rate for those tokens, rather than adding a second full charge. Earlier models have different behavior. Usage now includes `input_tokens_details.cache_write_tokens`. Newer models support explicit breakpoints and a minimum 30-minute cache lifetime. Exact prefix reuse matters. [Official prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).

2. **Anthropic prompt caching.** Five-minute writes cost 1.25× base input; one-hour writes cost 2×. Read ratios vary: the current table includes 0.025× and 0.05× exceptions alongside 0.1×. `input_tokens` excludes cache reads and writes; sum the three categories for total input. TTL begins at request start, so generation time consumes it. Token minima are model-specific. [Official prompt-caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

3. **Claude tariffs.** The current guide says Claude 4.6 and later include the full 1M context window at standard rates. Applicable US-only inference carries a 1.1× multiplier; fast mode and batch have separate applicability rules. The guide also warns that newer tokenizers change token volume for identical text. [Official Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

4. **Google API surfaces.** Current Interactions API documentation supports implicit caching, but directs explicit-cache users to `generateContent`. Its older API guide describes explicit-cache storage billed by tokens and TTL, with a default one-hour TTL. A cache object therefore has a lifecycle cost outside individual completion receipts. [Interactions caching](https://ai.google.dev/gemini-api/docs/caching), [generateContent caching](https://ai.google.dev/gemini-api/docs/generate-content/caching).

5. **Gemini tariff discontinuity.** The current Gemini 2.5 Pro standard table charges different input, cached-input, and output rates above 200k prompt tokens, and lists storage separately. Its batch cached-input and storage prices are unchanged from standard. Thus a blanket “halve the complete bill with batch” calculation would be wrong. [Official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

6. **OpenAI tariff dimensions.** The price table distinguishes short/long context and Standard/Batch/Flex/Fast modes, with regional modifiers and model-specific availability. A model-name-only lookup cannot represent all these choices. Do not infer a numerical long-context boundary from a table that does not establish that boundary. [Official API pricing](https://developers.openai.com/api/docs/pricing).

7. **OpenAI subscription distinction.** Codex credit billing explicitly has no separate cache-write charge; API-key usage follows API pricing. The documentation also says credit prices alone do not determine included subscription usage. Neither an API-equivalent amount nor a credit estimate proves a reduction in the user's subscription bill. [Official subscription and credit pricing](https://learn.chatgpt.com/docs/pricing).

8. **Claude session totals are estimates.** Claude Code computes local dollar figures from token counts and list prices, or configured organizational rates. Its docs identify the Console as authoritative for billing. A vendor CLI's own displayed total is useful reconciliation evidence, not automatically invoice truth. [Claude Code cost management](https://code.claude.com/docs/en/costs).

9. **Claude cache behavior depends on setup.** Main conversations within included subscription usage request a one-hour TTL by default; API/credit/cloud usage defaults to five minutes. Subagents have separate conversations and cache prefixes. Effort changes can invalidate caches, but current model/client exceptions exist. [Claude Code prompt caching](https://code.claude.com/docs/en/prompt-caching).

10. **Reasoning is billable resource usage.** OpenAI reasoning tokens are billed as output and occupy context despite not being directly visible. The reasoning guide also describes generation-specific carryover behavior. Visible answer length therefore cannot identify output cost or prove waste. [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#how-reasoning-works).

11. **Batch and Flex require workload fit.** OpenAI Batch offers a 50% discount and a completion window of up to 24 hours. Flex trades latency/availability for lower prices; its documented resource-unavailable errors are uncharged, and retrying at standard processing can change cost. These are properties of an execution mode, not retrospective proof that an interactive agent could use it. [Batch guide](https://developers.openai.com/api/docs/guides/batch), [Flex guide](https://developers.openai.com/api/docs/guides/flex-processing).

12. **Compaction is a state transition.** OpenAI compaction can run within a response and produces an opaque state item; observing the event does not reveal the retained semantic content. The guide presents context reduction as a quality/cost/latency tradeoff. [Compaction guide](https://developers.openai.com/api/docs/guides/compaction).

## Accounting model to make these facts usable

The initial old-checkout audit found a flat price schema and a GPT-5.5 short-context row. Current-main inspection supersedes those findings: context tiers, per-request identity and explicit cost-basis/coverage contracts are implemented, GPT-5.5 is deliberately omitted, and Codex reasoning is already included in output billing. Preserve these contracts. The remaining limitations include absent Codex write counters, commercial billing context and some diagnostic dimensions. See the current-main reconciliation for exact source references and two current-price conflicts.

Use the following as a target evidence map, not a prerequisite universal-schema rewrite. First audit field availability and extend existing usage/confidence types only for one demonstrated tariff ambiguity. Add further dimensions when a supported analysis needs them:

| Field group | Minimum evidence to retain | Failure behavior |
|---|---|---|
| Identity | Source event locator; provider request ID; session/parent IDs; adapter version | Explain possible overlap; never sum uncertain duplicates silently |
| Usage | Raw vendor counters; normalized disjoint buckets; final/cumulative/delta marker | Preserve unknown; absent is not zero |
| Tariff | Exact model/version; request timestamp; API surface; served tier; geography when material | No exact dollars if a material dimension is unresolved |
| Billing basis | API list-price equivalent, configured contract rate, subscription/credits, or unknown | Put basis beside the amount; avoid the label “you paid” |
| Context | Total model input, observed prefix fingerprints, compaction events, cache TTL where present | Counters remain useful; causal diagnosis may be unavailable |
| Outcome | Task identity, revision, command result, independent acceptance artifact | No claim of successful optimization from a lower receipt alone |

Use exact integer token counts and integer monetary units or rational rates, summing before display rounding. A normalized input identity is `I = U + R + W5 + W60 + Wother`, where the buckets are disjoint. Output reasoning is either a documented subset of output or a separate vendor bucket normalized into it; it is never blindly added again. Maintain the raw record so the mapping can be audited.

For a resolved tariff, `C_tokens = (U*pU + R*pR + Σ Wt*pWt + O*pO)/1e6`. Add tool/service/storage charges only when separately observed and supported. A known token subtotal can be displayed as a subtotal, but an unresolved component prevents calling it the complete total. OpenAI total input and Anthropic ordinary input cannot be interpreted identically. [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching), [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Keep two timestamps for price evidence: source observation and documented effective date. Today's webpage cannot prove what yesterday's tariff was. Never backfill a historical price solely from access date. Missing billed tier is especially important after fallback: the requested tier need not prove the served tier. A supported baseline can be offered explicitly as arithmetic, but should not masquerade as resolved billing.

## Cache economics: useful calculations and their limits

The following are original accounting derivations, conditional on the rates and request pattern supplied. They are not measured savings from aireceipts users.

For an identical prefix of `L` tokens, ordinary input rate `p`, write multiplier `w`, read multiplier `r`, and `N` total requests with one write followed by full hits:

`uncached = N*L*p/1e6`

`cached = L*p*(w + (N-1)*r)/1e6`

Caching is cheaper when `N > (w-r)/(1-r)`. With illustrative `w=1.25,r=0.1`, two requests suffice; with `w=2,r=0.1`, three suffice. These examples assume the prefix would otherwise be processed every time, no eviction, no extra output, and no behavior change. Additional rewrites reset the economics. This is a scenario calculator, not a directive to generate more requests.

For measured disjoint cache buckets, a transparent comparison to processing the **same observed tokens** uncached is:

`cache_delta = [R*(pU-pR) - Σ Wt*(pWt-pU)]/1e6`

It can be negative. Label it “same-token uncached arithmetic,” never “money you saved,” because some input might not exist without caching and actual billing may differ. Do not average per-request hit percentages: use `ΣR/ΣI`, disclose the population, and show cost beside hit rate. A huge cached prompt can have an excellent hit rate and still be unnecessarily expensive.

For explicit storage, use `S = ∫cached_tokens(t)*storage_rate(t) dt / 1e6`, with time measured in the rate's specified unit. Net input advantage over a stated baseline is avoided ordinary-input charges minus cached reads, storage, and any observed setup charges. If cache creation/deletion or TTL extension records are missing, storage cost is unknown; do not charge the entire object lifetime independently to every session using it.

TTL selection needs a timeline simulation over eligible unchanged prefixes, measured from request starts where required. Comparing one-hour versus five-minute TTLs should account for writes prevented, extra write price, partial-prefix changes, and session endings. “More than five minutes between replies” is insufficient: timestamps may describe tool completion rather than model request start, and the model may have changed.

A compression proposal needs the same discipline. Let `D` be expected input-cost reduction per future turn, `K` observed or scenario compaction/rewrite cost, and `n` future turns. Its simple monetary break-even is `n*D > K`; if `D <= 0`, it never breaks even under that scenario. This excludes quality and recovery costs until separately measured. A shorter cold prompt can cost more than a longer cached one. Never infer removed tokens from bytes in an encrypted compaction item.

## Proposed product analyses

### P0: Audit existing price coverage and billing-basis explanation

Reuse the existing CostEstimate and pricing-coverage contracts; audit remaining tariff conformance and effective dates rather than rebuilding the foundation. Explain the specific missing dimension and count affected requests/tokens. Show list-price equivalent separately from any observed bill or contract calculation. Keep subscription quota percentages as their own observation, not converted dollars.

Acceptance: every adversarial fixture with ambiguous tier, long-context eligibility, cache-write price, or account basis abstains appropriately; every fully supported fixture reconciles exactly before rounding. Historical unknowns remain unknown when the current price table changes. A user should be able to identify why two identical token totals price differently.

### P1: Net cache extension and disruption timeline

Extend existing cache detail/read-discount output with a write-adjusted net comparison where evidence is complete, with optional event markers for model changes, compaction, tool-definition changes, and inactivity. Report “cache reads fell after X,” not “X caused the miss,” unless the complete eligible prefix and provider rule establish it. Display the same-token arithmetic delta, including negative results.

Required fields: final per-request counters, request timestamps, resolved tariff, and optional context fingerprints. Common false positives: first requests, intentional new tasks, context growth, different subagent prefixes, platform routing, missing hidden instructions, and model/client exceptions. Prefix fingerprints remain local and should not be added to telemetry.

Experiment: analyze a consented local corpus and manually label disruption cases. Require high precision for named causes before putting them in the default receipt; otherwise retain them in an explanatory detail view. Measure how often the proposed action is available in the user's actual client, since a raw API capability may be inaccessible in a subscription CLI.

### P2: Model-switch and subagent cost decomposition

Measure the observed cost around switching models and starting children. Attribute child spend once; display parent/child hierarchy, observed cache-write costs, and concurrency. Repeated context ingestion requires actual input evidence. Compare a cheaper per-token model with the **full subsequent observed task cost**, rather than repricing the next answer alone. Routing can lose economically if cold context or additional turns dominate, but observed decomposition alone cannot establish marginal overhead or a switch's causal effect.

Required fields: parent-child identity, request-model sequence, cache counters, and task boundary. A child can be useful even if its first request is expensive; concurrency can reduce elapsed time while increasing total spend. Neither condition implies waste. Avoid replacing measured latency with the sum of overlapping child durations.

Experiment: paired tasks with fixed repository snapshot and acceptance criteria, one orchestration intervention at a time. Count all attempted children and failed runs. Report dollar-equivalent distribution, wall time, task completion, and recovery work together; publish no model ranking.

### P2: Reasoning and output-budget observability

Add reasoning share only when reported and normalized confidently. Combine it with stop reason, output cap, retries, and task outcome to identify candidate experiments. A request that reaches its cap and retries may warrant a larger cap; a short answer with many reasoning tokens may be entirely appropriate.

An advisory should read “high reasoning share; compare lower effort on this task family,” not “wasted thinking.” Count the entire experiment, including failed lower-effort runs and successful recovery. A settings change may also affect cache behavior, so record it alongside the result.

### P2: Context retention and compaction ledger

First expose existing context-thrash evidence, recorded compactions and reread counts. Defer a full retention ledger until captured successive prompts establish what was actually included. Stable local result fingerprints identify repeated output; they do not prove that output remained in later model inputs. Charge only measured token quantities; text matching cannot allocate provider token counts exactly across multimodal or hidden content.

Show post-compaction rereads and repeated searches as recovery indicators, not proof of memory loss. Files may have changed; verification may be intentional. Compare natural task-boundary handoffs, tool-output caps, and earlier compaction independently. Retain failed acceptance outcomes even when the shorter transcript looks cheaper.

### P3: Batch/Flex eligibility checklist and explicit-cache audit

Offer these only for API workflows with sufficient execution metadata. Candidate batch units must have independent inputs, tolerate delayed results, and use supported endpoints/models. An entire interactive coding session is normally a dependency chain, not a ready-made batch. Flex advisories need deadline tolerance and fallback accounting.

Explicit-cache audit requires cache-object lifecycle records, so defer it until imported evidence supports it. Idle storage can be a worthwhile finding, but absence of requests in one local transcript does not prove no other client used the cache. Avoid automatic deletions or provider changes; aireceipts can produce a local action plan without violating its zero-network product path.

## Mistakes to prevent in the optimization layer

1. **Overlapping savings.** A cache fix, context reduction, and model change can concern the same tokens. Give each scenario its own baseline or build one combined scenario; never sum independent upper bounds.
2. **Output-only denominators.** Include input, writes, tools, retries, and child calls. A cheap successful run selected from several failures is not a cheap attempt.
3. **Tokenizer equivalence.** Same-token model repricing is valid arithmetic but not a prediction for the same text or task. Keep that distinction visible.
4. **Averaging away hard tasks.** Report counts and distributions by a declared task family. An apparent average improvement may come from easier later tasks.
5. **Treating failure as billable by default.** Some errors are uncharged; interrupted streams may contain partial usage. Preserve the distinction between observed chargeable work, explicit zero, and unknown.
6. **Promoting API estimates to invoice facts.** Discounts, credits, taxes, platform markups, and subscription rules may be absent. Reconciliation is optional local evidence import, not silent online account inspection.
7. **Confusing access date and effective date.** Tariff updates must preserve historical rows and prove applicability. Model aliases can change beneath a stable name.
8. **Saving tokens by breaking the task.** Acceptance results and recovery cost belong in every cost experiment. A receipt cannot infer product quality from a successful process exit alone.

## Delivery gates and concrete research follow-up

First, investigate the current Sonnet 5 and GPT-5.6 Sol price-table conflicts and establish dated applicability. Only author a new narrow tariff-evidence specification if existing confidence, PricingUnit and context-tier contracts cannot cover a demonstrated case. Do not bundle advisory heuristics into this foundational change. Build a fixture matrix spanning provider, billing basis, cache-write generation, TTL, threshold boundary, missing metadata, streaming duplication, and parent-child overlap. Pin source evidence and raw input fixtures without credentials or private transcript content.

Second, produce a local corpus report showing **field coverage**, not assumed opportunity size: fraction of requests with exact model/date, served tier, total input, write TTL, parent identity, reasoning counts, and outcome artifact. This determines which analyses can ship immediately. No unsupported percentage savings should appear in the roadmap.

Third, trial the cache ledger with a small explicitly consented dataset. At least 30 independently labeled candidate cases plus noncandidate negatives can inform a pilot; they cannot certify near-zero false positives. Default exact arithmetic requires complete inputs and zero unsupported dollar claims. Named-cause or waste labels must pass the shared held-out, cluster-aware near-zero-false-positive gate in `Failure Prevention and Evaluation.md`; otherwise retain neutral observations in opt-in details. Report confidence intervals, abstentions and sample limitations.

Fourth, run opt-in paired workflow experiments only after a separate execution budget and credentials are authorized. Predefine acceptance tests, randomized order where practical, and stop rules. The default CLI remains a deterministic analyzer of completed local evidence. Ship an advisory when its prerequisites are observable and its wording survives counterexamples; keep lower-confidence hypotheses in the research report.

The strongest defensible improvement is a receipt that can say: **the tariff is known, these request categories explain the cost, this event coincided with a change, and this controlled comparison would tell us whether changing the workflow helps.** That is a concrete optimization system without pretending to know an unrun counterfactual.
