# Market evidence and product opportunities for aireceipts

> Baseline correction: the initial code audit used the older `a56a6a7` checkout. Current `origin/main` at `34867fa` has substantial additional implementations. [Current-main reconciliation](Current%20Main%20Reconciliation.md) and the revised delivery plan supersede any older-code gap or new-feature claim below. Provider and research-source findings remain separately dated.

Research date: 2026-09-22. This is a research proposal, not an approved spec or implementation commitment. Evidence is from the worktree's AGENTS.md, SPEC-0000, README, and the primary sources linked below. Competitor capabilities are documented claims inspected online, not hands-on validation. Repository default branches and vendor documentation can change; this is a dated snapshot, not a historical release audit.

## Recommendation

Concentrate on **an auditable explanation of one avoidable cost, followed by a measured workflow experiment**. Complete attribution confidence before adding more advice. Then test cache economics, observed failure/recovery episodes, and overlapping-opportunity accounting. Extend the existing `compare` and handoff rather than launching another cost dashboard.

The reviewed market already offers local multi-agent totals, terminal status lines, cache counters, quota forecasts, workflow traces, and optimization advice. Neither “local” nor “multi-agent” nor “find waste” establishes uniqueness. A plausible position is a small, offline, reproducible artifact that connects usage evidence, honest uncertainty, and a specific next experiment. That position remains a hypothesis requiring user testing.

## What the market already does

| Product | Observed capability | Relationship to aireceipts |
|---|---|---|
| [ccusage](https://github.com/ccusage/ccusage) | Local usage; unified daily, weekly, monthly and session reports across 18 named coding sources; statusline, cache tiers, JSON, custom prices and offline cached pricing. | Direct competitor for “what did I spend?” Multi-agent support and a terminal report are crowded. |
| [Tokscale](https://github.com/junhoyeo/tokscale) | Broad local-source ingestion, some provider/API sync paths, terminal views and leaderboard. Documented pricing resolution includes overrides, aliases and fuzzy matching; quota values are labeled vendor-reported. | Direct competitor for cross-agent visibility. Its breadth is a reason to prioritize depth and explicit matching semantics, not race adapter counts. |
| [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Version 4 documentation describes official-limit capture, labeled fallback estimates, local historical reporting, forecasts, and versioned machine-readable output. | Direct adjacent competitor for local usage operations. Confidence labels and offline history are already present elsewhere. |
| [claude-receipts](https://github.com/chrishutchinson/claude-receipts) | SessionEnd hook, HTML/console/thermal output; uses ccusage for session cost and token data. | Direct overlap in receipt aesthetics and automatic delivery. A receipt image alone is weak differentiation. |
| [Langfuse](https://langfuse.com/coding-agents) | Coding-agent hooks/gateway integrations; tool calls, retries, spend, context and skills analysis; session comparison and experiments. | Broader observability product with real coding-agent overlap. Its deployment/workflow differs from a standalone file-reading CLI. |
| [Helicone](https://docs.helicone.ai/features/advanced-usage/caching) | Gateway response caching, request-derived cache keys, cache-hit reporting and time/cost savings views. | Broader API observability/control product. Request interception changes execution; aireceipts observes existing local evidence. |
| [AgentOps-AI](https://github.com/AgentOps-AI/agentops) | SDK instrumentation, execution graphs, model cost tracking, framework integrations, hosted or self-hosted app/backend. | Broader agent-development platform; useful prior art for spans and outcomes, not a drop-in local transcript receipt. |
| [AgentSight](https://github.com/eunomia-bpf/agentsight) | System tracing plus native session-file modes; local top/report/visual replay without eBPF on supported platforms; eBPF captures process/files/TLS boundaries. | Emerging adjacent competitor in local behavior analysis. “No SDK” is not an exclusive advantage. |
| [Azure AgentOps Accelerator](https://github.com/Azure/agentops) | Foundry-oriented evaluation, baseline comparisons, local result files and PR-friendly release evidence. | Distinct from AgentOps-AI. Useful evidence-artifact precedent, but targets enterprise agent operation. |
| [Infracost](https://github.com/infracost/infracost) | Infrastructure cost breakdown/diff and PR comment workflow. | Adjacent workflow precedent, not an AI session-cost competitor. |

The most relevant competitive pressure is Langfuse's explicit move into coding-agent workflow improvement, not only generic LLM observability. Its coding-agent page discusses repeated file reads, unused tools, shorter prompts and evaluating skill changes. aireceipts should avoid claiming that other tools show totals but never explain behavior. The narrower distinction is the constraints and evidence quality of the delivered artifact.

The [Langfuse pricing model](https://langfuse.com/docs/observability/features/token-and-cost-tracking) also illustrates why “cost” needs provenance: usage/cost can be ingested or inferred; ingested values take priority; pricing tiers can depend on context or request metadata. Its documentation notes that model-definition changes affect new generations. This supports storing the exact local pricing snapshot and method, not assuming two historical reports are comparable merely because their model names match.

## User jobs worth serving

1. **API-paying individual:** “Which observed behavior accounts for this expensive session, and what should I change first?” Deliver one high-confidence episode with attributable cost and source references.
2. **Subscription user:** “Did this workflow consume avoidable quota or time?” Show tokens and observed quota evidence separately from API-equivalent dollars. Do not treat list-price estimates as their invoice or imply lower tokens necessarily mean a lower subscription payment.
3. **Maintainer reviewing agent work:** “What did implementation and verification actually cost, and what evidence supports the result?” Attach a compact local artifact to the existing PR workflow, retaining uncertainty around session/commit attribution.
4. **Developer tuning instructions or tools:** “Did the new workflow reduce resource use without weakening verification?” Compare explicit runs with the same task definition and acceptance checks.
5. **Small team without an observability deployment:** “Can we agree on an auditable method while keeping transcripts local?” Exchange redacted evidence summaries and versioned JSON, with no account or hosted collection requirement.

These jobs require different denominators. Cost/session, cost/accepted task, tokens/verification run and elapsed time answer different questions. “Cheaper” must always identify which resource, which unit of work, and which acceptance condition.

## Prioritized analysis hypotheses

### P0: Validate and extend the existing uncertainty explanation

Current main already has CostEstimate, priced/unpriced coverage, request-level pricing and documented floor semantics. Audit and extend these contracts rather than inventing a second confidence system. A money line should have a drill-down linking usage event(s), adapter method, dated price row, tier information, allocation method and exclusions. The first useful distinction is observed vendor usage versus arithmetic cost versus allocation versus hypothetical repricing. Missing usage and unmatched prices must stay visible.

Add a small reconciliation view: priced usage, unpriced usage, duplicated observations excluded, unattributed cost and invariant failures. Coverage needs named denominators: known events covered by pricing is not “percentage of total spend known,” because unknown-event cost cannot be measured. Carry stable source IDs and local content hashes, never transcript excerpts in adoption telemetry.

**User decision:** trust the total, investigate missing data, or decline to use the number for a comparison.

**Value gate:** run existing self-check expectations and independent real transcripts; every nonzero cost explains its inputs; totals reconcile exactly; unsupported usage produces an explicit limitation. A blocker is evidence that unknown or dropped usage can silently appear as zero.

**Kill/defer criterion:** defer cosmetic confidence scores that do not change decisions. Do not collapse heterogeneous uncertainty into an unexplained 0–100 score.

### P1: Report net cache economics, not just cache-hit percentage

Current main already shows cache composition, TTL writes and read-only discount arithmetic under details. The useful increment is a net write-adjusted same-input comparison where all affected categories are observed. A high hit percentage can coexist with costly cache writes, large repeated context, or model changes.

For the same observed input volumes, let the uncached baseline be the dated ordinary-input price applied to all eligible input tokens. Subtract actual eligible input cost to obtain a **net cache price difference**. This is arithmetic, not a claim that disabling caching preserves all behavior or latency. A negative difference is valid. Keep output costs outside this comparison.

[Anthropic's caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) distinguishes write durations and read prices, with model-specific exceptions. Therefore read/write multipliers must come from cited dated rows; do not hard-code one universal cache discount. If the transcript cannot distinguish write duration, show the known evidence and range or tokens, consistent with existing price rules.

Potential episode detectors: repeated cache creation after interruptions, sudden input/cached-token discontinuities, or heavy context replay after compaction. These are correlations. They do not prove TTL expiration, prefix mutation or avoidable cache invalidation without corresponding request evidence.

**User decision:** measure an instruction-layout change, reduce repeated context, or preserve a productive long-lived session.

**Value gate:** reviewers correctly distinguish gross read discount from net cache benefit on positive and negative examples; arithmetic reconciles; source semantics are verified for each adapter.

**Kill/defer criterion:** no exact savings number where missing cache tier or token semantics can materially change its sign.

### P1: Explain failure and recovery with narrow, observable episodes

Move beyond “repeated command” toward a local sequence such as: command returns a recognized failure; the same command repeats under demonstrably unchanged relevant inputs; a later configuration fix precedes success. Capture the episode and its attributed spend without asserting that all failed attempts were unnecessary.

Keep categories narrow: missing executable, missing file, authentication failure, unsupported CLI flag, or an identical failing test with observed unchanged inputs. A red test in test-driven development is not a mistake. Repeated tests after edits are verification. Transient network failures can justify retries. Shell equivalence and environment changes are hard; unknown state should lower confidence or suppress “avoidable” wording.

Add a verification-evidence view: observed checks, observed exit codes, timing relative to the last attributable edit, and unknowns. “No test run observed” is valid; “code is untested” is not. A passing test before the final edit is stale evidence, not proof of a defect.

**User decision:** add a prerequisite check, correct an environment assumption, or run the missing post-edit check.

**Value gate:** independently labeled real episodes and clean negative cases; record precision with denominators and ambiguity, not just hand-authored fixtures. Review every claimed mistake.

**Kill/defer criterion:** suppress any category repeatedly confusing legitimate debugging or verification with waste. Do not optimize by recommending fewer checks without equivalent acceptance evidence.

### P1: Make overlapping opportunities impossible to add twice

A repeated-tool turn can belong to both a loop finding and a context-refill finding, while some of its input is also cached. The current trivial-span rule requires a tool-free turn, so it cannot overlap a loop on that same turn. Summing independently advertised savings is misleading.

Represent each opportunity as evidence event IDs, the cost components it affects, an intervention and prerequisites. Present individual arithmetic scenarios separately. Only combine actions when a deterministic composition exists: remove a repeated turn first, then reprice remaining eligible usage, with cache effects identified as unknown unless modeled from sufficient data. Keep the existing non-additive warnings first. A future affected-spend union must use canonical atoms of usage-event ID, priced component and allocation slice; an event-level total otherwise includes unrelated output or other tools' shares. Affected spend is not guaranteed savings.

Distinguish *what happened* from *what an intervention changes*. Parent and child-agent costs are accounting partitions; workflow phases and tool groups are alternative views. They must not be stacked as independent costs.

**User decision:** pick one intervention and understand its maximum exposed spend.

**Value gate:** adding identical or subset atom coverage leaves the union unchanged; partially overlapping coverage increases it only by newly covered atoms. Every combined estimate explains composition and cannot exceed its modeled baseline. Defer combined amounts until users need them and allocation semantics support them.

**Kill/defer criterion:** ship separate scenarios if interactions cannot be defended. A large “total potential savings” number is not worth false precision.

### P2: Turn compare into a local workflow experiment record

The existing `compare` is an important starting point. Add optional user-authored experiment metadata: task ID, starting revision, agent/model versions, configuration hash, intervention, explicit acceptance checks and declared exclusions. Import run evidence; do not execute models or purchase test runs inside aireceipts.

A useful comparison includes total cost, unpriced tokens, elapsed duration, verification evidence, and recovery episodes. Include failed and abandoned attempts in the experiment ledger. Otherwise “cost per successful task” rewards systems whose expensive failures were omitted. If all attempts are known and acceptance is consistently applied, report total spend divided by accepted tasks alongside completion rate and sample count.

Do not match unrelated tasks automatically by embedding or model judgment. Prefer controlled paired tasks, rotated order and multiple repetitions; display distributions and uncertainty when samples support them. Changed provider prices require a common dated repricing scenario shown separately from original-run cost. Test outcomes are limited evidence of quality, not proof of correctness.

[Claude Code's official cost guidance](https://code.claude.com/docs/en/costs) recommends context management, narrower tools/instructions, focused delegation and model selection. Those are useful candidate interventions, not aireceipts-specific savings evidence. Its guidance also makes clear that teams multiply context; delegation can isolate verbose results while increasing total agent work. Measure both total cost and elapsed time.

**Value gate:** at least several independent users can answer whether a specific workflow change helped, with all attempts and acceptance checks visible.

**Kill/defer criterion:** if setup is more effort than the tuning decision warrants, retain a small JSON sidecar and documented manual protocol rather than building experiment infrastructure.

## Onboarding and distribution without expanding the product boundary

The shipped `setup`, integrations, SessionEnd hook, handoff and PR export already provide distribution surfaces. Improve the first result: “We found these supported sessions; here is the latest receipt; this is the strongest supported finding; here is the command to inspect its evidence.” If no finding is justified, say so.

Use the default receipt for one concise finding; detailed evidence belongs behind an explicit command/JSON field. A page of warnings will train people to ignore the tool. Keep integration installation consent-based and show the exact local file changes.

A reproducible, sanitized “known good / known misleading” transcript corpus can explain the methodology and invite contributions. Include missing-price, stale-verification, subagent duplication and overlapping-opportunity examples. Credit competing tools fairly. Publish a compatibility page that names what is observed per adapter and what is unavailable, instead of implying equal depth.

For adoption, use the already approved coarse feature telemetry only. Proposed new event enums or payloads require normal schema/spec review. Do not send cost, transcript hashes, paths, task labels, commands or validation results. Local studies can generate opt-in summaries that users deliberately share, but there is no implied permission to upload them.

Measure activation as a successful supported-session receipt, finding inspection as an explicitly invoked evidence view, and repeat use through the approved pseudonymous/coarse mechanism. None of these proves savings. For product value, recruit a small consenting pilot and ask participants to keep local experiment records; only collect manually approved aggregates.

Suggested pilot gates, **targets rather than observed results**: 12 participants spanning API and subscription users; at least 8 complete first-run onboarding unassisted; at least 6 inspect a finding; at least 4 perform a defined workflow experiment; at least 3 repeat use in week two. For any claimed savings, require unchanged acceptance conditions and all attempts included. If users only export an image once, improve recurring decision value before adding features.

## Delivery sequence and unknowns

1. Reconcile current dated-price conflicts and remaining SPEC-0044 self-check acceptance evidence; reuse the existing cost-model docs and evidence contract.
2. Collect a permissioned, independent corpus and label cache/failure/verification opportunities before committing to detectors.
3. Spec one narrow cache-economics or recovery slice, selected by real incidence and precision.
4. Preserve current maximum-class pattern accounting; add atom-level union only if a new user need justifies it.
5. Pilot lightweight experiment records through existing compare/handoff.
6. Expand adapters or distribution only when they unblock demonstrated user jobs.

The largest unknown is transcript sufficiency: request-level cache semantics, relevant file state, checks executed outside the agent, and exact outcome evidence may be absent. Another is willingness to act: users may enjoy receipts but avoid controlled experiments. This research did not benchmark competitors, measure users, or demonstrate achieved savings. Lack of a feature in a reviewed README is not evidence that no product offers it.

## Primary source register

All pages below were inspected on **2026-09-22**; access date applies to every entry. Paraphrases above are deliberately short and do not reproduce vendor claims as independently verified outcomes.

1. [ccusage repository](https://github.com/ccusage/ccusage) — supported sources, offline mode, reporting.
2. [Tokscale repository](https://github.com/junhoyeo/tokscale) — source modes, pricing resolution, quotas.
3. [Claude Code Usage Monitor repository](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) — v4 trust labels and local history.
4. [claude-receipts repository](https://github.com/chrishutchinson/claude-receipts) — receipt/hook precedent.
5. [Langfuse coding-agent product page](https://langfuse.com/coding-agents) — direct workflow-optimization overlap.
6. [Langfuse token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — ingestion, inference, model tiers.
7. [Helicone caching documentation](https://docs.helicone.ai/features/advanced-usage/caching) — gateway response cache mechanism.
8. [AgentOps-AI repository](https://github.com/AgentOps-AI/agentops) — SDK/platform scope.
9. [AgentSight repository](https://github.com/eunomia-bpf/agentsight) — local session and system tracing modes.
10. [Azure AgentOps Accelerator repository](https://github.com/Azure/agentops) — evaluation and release-evidence artifacts.
11. [Infracost repository](https://github.com/infracost/infracost) — breakdown/diff/comment workflow.
12. [Claude Code cost documentation](https://code.claude.com/docs/en/costs) — vendor workflow guidance.
13. [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — cache accounting and limitations.
