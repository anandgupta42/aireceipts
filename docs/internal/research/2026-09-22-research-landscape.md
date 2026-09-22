# Competitive landscape research: what other tools surface that aireceipts does not

Date: 2026-09-22. Scope: aireceipts is an open-source, local, deterministic CLI that reads AI coding-agent transcripts off disk (Claude Code, Codex, Cursor, Gemini CLI, opencode) plus git history, and prints a cost receipt: per-tool cost/time breakdown, waste lines, cheaper-model price-delta arithmetic, subagent rollups, a handoff block, PR receipts, a statusline, weekly summaries, and a compare command. Hard invariants: zero model calls in the product path, deterministic, never fabricates a dollar figure, facts not rankings.

Framing used throughout: for every insight, the load-bearing question is whether it is computable purely offline from (a) a local transcript file and (b) git history, with no live API, proxy, telemetry backend, ticketing system, or survey. That is the bar aireceipts itself has to clear.

---

## A. Open-source Claude Code / Codex / Cursor / opencode usage and cost trackers

The category is large and dominated by ccusage, which now reads 18+ agent formats. The offline/online line is sharp: everything about tokens, per-model cost, cache read/write, 5-hour billing blocks, burn rate, session/project/daily rollups, and tool-call counts is computed by many tools purely from local files, exactly aireceipts' territory. Everything about subscription-quota percentage, rate-limit reset windows, prepaid credit balances, and team/org spend rollups needs a vendor API, OAuth token, or browser cookie and cannot be done offline.

Selected tools:

- **ccusage** (github.com/ryoppippi/ccusage, ~16.5k stars, ccusage.com). Daily/weekly/monthly/session/5-hour-block reports, per-model breakdown, cache-creation vs cache-read split, project grouping, statusline integration. Purely local JSONL. Offline: yes. Stops at accounting, no waste detection.
- **Claude-Code-Usage-Monitor** (github.com/Maciek-roboblog/Claude-Code-Usage-Monitor). Live burn-rate (tokens/min), time-to-limit forecasting, plan-limit auto-detection via P90, model-distribution bar. Offline: mostly yes for burn rate and forecasts (timestamp math); plan-limit ground truth needs Claude's live rate_limits signal, so partly.
- **claude-monitor** (github.com/szaher/claude-monitor). Local web dashboard via hooks: tool-usage success/failure rates per tool, per-project cost, activity log. Offline: yes. The tool-success-rate angle is a genuinely useful axis most others lack.
- **ccflare** (github.com/snipeship/ccflare). A proxy for multi-account load balancing with live request/latency data. Offline: no, it is architecturally a live interceptor, not a log reader.
- **codex-usage-tracker** (github.com/douglasmonsky/codex-usage-tracker). Exposes usage "facts" over an MCP surface backed by SQLite so an agent can query its own usage. Offline: yes. Novel interface idea (query via MCP rather than print a report).
- **codex-cost-tracker** (github.com/haiggoh/codex-cost-tracker). Local estimates kept rigorously separate from OpenAI's authoritative Admin API numbers; never merges the two. Offline: estimates yes, authoritative actuals no. Good reference for honest estimate-vs-actual labeling, which matches aireceipts' own provenance discipline.
- **Cursor trackers** (Dwtexe/cursor-stats, ofershap/cursor-usage, claudio-silva/cursor-usage-enricher, and others). Cursor does not write full local transcripts the way CLI agents do, so nearly every Cursor tool reads Cursor's account/Admin API instead. Offline: no, across the board. ofershap/cursor-usage is worth noting separately: it is the clearest eng-manager play in the whole survey (per-member spend, edit accept/reject rate, three-layer anomaly detection with Slack alerts, per-user spend limits) but is entirely Cursor Enterprise Admin API bound.
- **opencode trackers**: ocsight (github.com/heyhuynhgiabuu/ocsight, fully local, budgets, most-expensive-session ranking, export to csv/json/markdown) and opencode-tokenscope (github.com/ramtinJ95/opencode-tokenscope, deepest single-session breakdown: cache hit rate, effective input rate, estimated savings, and a context-cost attribution showing how many tokens are burned by tool definitions, environment context, and skill/subagent catalogs versus actual conversation). Tokenscope's context-cost attribution is the closest thing in the whole survey to aireceipts' waste framing and is worth stealing directly.
- **tokscale** (github.com/junhoyeo/tokscale). Ten-view TUI across 40+ agents: model/daily/hourly/monthly/session views, per-project and per-git-repo rollups, a GitHub-style contribution-graph "Wrapped" view, and an opt-in global leaderboard. Offline: local views yes; subscription-quota view and Cursor/Trae/Warp numbers no (API sync). The gamified contribution-graph and per-repo rollup are notable UX ideas nobody else has.
- **Dicklesworthstone/coding_agent_usage_tracker (caut)**. One CLI across 16+ providers giving "Session 72% left / Weekly 41% left / Credits 112.4 left" in one glance. Cost via local JSONL scan (offline yes); rate-limit percentages and credit balances via API/cookies (offline no). Cleanly illustrates the offline/online split in one tool.

Cross-cutting finding: nobody in this category does deterministic, git-anchored waste detection or PR receipts. That remains aireceipts' clearest whitespace versus the entire OSS tracker ecosystem.

---

## B. LLM observability platforms (Helicone, LangSmith, Langfuse, Braintrust, Portkey, OpenRouter, W&B Weave, plus Arize Phoenix, Traceloop/OpenLLMetry, Lunary)

Structural finding: every one of these is a runtime-instrumentation product. To produce a cost number it must sit in the request path, as a proxy (Helicone, Portkey, OpenRouter), an SDK wrapper (LangSmith, Langfuse, Braintrust, W&B Weave, Lunary), or OpenTelemetry auto-instrumentation (Arize Phoenix, Traceloop). None of them read an agent's transcript already on disk. Their marquee attribution dimensions (per-end-user, per-prompt-version, per-feature, eval-score-vs-cost) assume a production app serving many users with a versioned prompt library and an eval harness, none of which exists for a single developer's coding session, so those insights are inapplicable rather than merely unavailable.

What is genuinely worth citing as prior art:

- **Braintrust's "cost per successful outcome"**: spend divided by requests that clear a quality-scorer bar. Requires their eval harness (offline: no) but is the most sophisticated cost framing found and validates the "cost tied to outcome, not to tokens" thesis aireceipts already embodies through waste lines.
- **OpenRouter's Activity Dashboard**: blended dollars-per-million-tokens and cache-hit-rate as headline metrics, computed because OpenRouter is the biller for every model it routes. Offline: partly, computable from a transcript if it logs cache tokens (Claude Code does).
- **Langfuse** is the closest philosophical cousin: open-source, self-hostable, price-table-driven cost math identical in spirit to aireceipts. But it still wants you to send it generations via SDK; aireceipts finds them on disk.
- **Arize Phoenix**: open-source, OTel-native, free to self-host, with a built-in model-pricing table matching aireceipts' design pattern, but built around instrumenting a running app with spans rather than reading an agent's own log.

None of these platforms has a "waste" concept (retry loops, needless model upgrades, redundant re-reads). All report spend, and at most one (Braintrust) reports cost against a quality bar. This is a second independent confirmation of aireceipts' whitespace.

---

## C. OpenTelemetry GenAI semantic conventions and Claude Code's native OTel export

### OTel GenAI spec (opentelemetry.io/docs/specs/semconv/gen-ai/, github.com/open-telemetry/semantic-conventions-genai)

Defines a vendor-neutral vocabulary: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, token usage split into `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read.input_tokens`, `cache_write.input_tokens`, `reasoning.output_tokens`, plus agent/tool attributes (`gen_ai.agent.name`, `gen_ai.tool.name`, `gen_ai.conversation.id`) and metrics such as `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, `gen_ai.invoke_agent.inference_calls`, `gen_ai.invoke_agent.tool_calls`.

The key gap: **the OTel GenAI spec defines zero cost or pricing attributes anywhere**, in spans or metrics. It standardizes the inputs to cost (tokens, model id) but deliberately leaves the dollar conversion to the backend. This is exactly the missing derivation layer aireceipts fills, and it is true industry-wide, not an oversight specific to any one vendor.

Genuinely live-only signals in the spec that a transcript cannot reconstruct: true streaming latency (`time_to_first_token`, `time_per_output_token`), and raw request/response HTTP bodies. Everything else (token counts, cache split, reasoning tokens, tool-call counts, agent/tool nesting) is reconstructable from a JSONL transcript's ordering and content.

### Claude Code's own OTel export (official doc: code.claude.com/docs/en/monitoring-usage)

Enabled via `CLAUDE_CODE_ENABLE_TELEMETRY=1`. Notably, **Claude Code does emit cost in USD natively** as a metric, `claude_code.cost.usage`, computed internally, unlike the generic OTel spec. Full metric list: `claude_code.session.count`, `claude_code.lines_of_code.count` (added/removed), `claude_code.pull_request.count`, `claude_code.commit.count`, `claude_code.cost.usage`, `claude_code.token.usage` (input/output/cacheRead/cacheCreation), `claude_code.code_edit_tool.decision` (accept/reject with a source taxonomy: config, hook, user_permanent, user_temporary, user_abort, user_reject), `claude_code.active_time.total` (user vs cli).

Events: `claude_code.user_prompt`, `claude_code.assistant_response`, `claude_code.tool_result` (with `duration_ms`, `success`, `error_type`), `claude_code.tool_decision`, `claude_code.api_request`. All correlated via `prompt.id` and `message.uuid`, the latter of which is the same field persisted in the on-disk JSONL transcript aireceipts already reads.

What a transcript can reproduce versus what it cannot:

- Reproducible from transcript plus git alone: token usage and cache split, cost (same math Claude Code itself runs), lines of code added/removed (via diff), commit counts, tool-call success/failure (mostly), and per-subagent/skill/MCP-server cost attribution (the `query_source`, `agent.name`, `skill.name`, `mcp_server.name` labels are reconstructable from JSONL structure).
- Not reproducible from a transcript: `active_time.total` (user-vs-idle time is live UI keystroke instrumentation, genuinely unique and high-value for an eng manager, and structurally impossible to fake from a log), the fine-grained accept/reject `source` taxonomy (config vs hook vs user_permanent), true per-token streaming latency, and pull-request counts (need a git remote or `gh`, not pure transcript).

Strategic framing for the report: the honest contrast is not "cost is impossible without a proxy," since Claude Code's own telemetry proves cost is knowable. The honest contrast is that Claude Code's cost telemetry requires a running OTLP collector, a backend, opt-in environment variables, and org-level configuration, and it only covers Claude Code. aireceipts computes the same cost numbers offline, deterministically, from files already on disk, across five different agents, with git context, and with no backend to stand up.

---

## D. FinOps-for-AI frameworks and unit economics

### FinOps Foundation

- **FinOps for AI** (finops.org/framework/technology-categories/ai/): an official framework category naming cost-per-token, cost-per-inference, cost-per-API-call as core unit metrics, alongside business KPIs (ROI vs expectations, time to first prompt) that need external targets aireceipts cannot supply. Cost-per-token/inference/API-call: computable offline, yes.
- **Tokenomics: Managing AI Value in SaaS** (finops.org/wg/token-economics-saas/): the single best external validation of aireceipts' reason to exist, stated plainly as "the token is the billing unit, not the value unit." Proposes cost-per-successful-outcome, counting only runs whose output clears a quality bar. Computable offline: partly, the cost side yes, the quality-floor signal needs to come from git (did it merge, did tests pass) rather than the transcript, which is effectively what aireceipts' waste lines already approximate.
- **FOCUS spec** (focus.finops.org, the vendor-neutral billing normalization schema): as of versions 1.3 to 1.4 it has **no native GenAI or token columns**, with support only via a generic custom-columns escape hatch. GenAI-native columns are on the roadmap, not shipped. This is a real, current gap aireceipts sits in front of: it could plausibly emit FOCUS-shaped rows as an interop story later, but this is not close to current scope.

### Unit-economics metrics for coding agents specifically (the highest-value subsection)

- **Cost per merged PR**: (usegitai.com, cloudzero.com) total spend attributable to a set of PRs divided by the number that actually merged. Computable offline: yes, mostly, cost from the transcript, merge status from git, and aireceipts' existing PR-attach pipeline already does the attribution step. This is the single strongest, most defensible unit metric found in the entire survey and squarely in aireceipts' wheelhouse.
- **Cost per merged feature** (blog.insight-services-apac.dev, "Token Price Is the Wrong Number"): an independent study that priced the same feature spec across a dozen agent harnesses and found costs ranging from about $2.81 to $33.38 and 26 to 176 minutes for the identical outcome, a roughly 2.5x swing from the harness alone holding the model constant. It explicitly splits "coding cost" from "gate cost" (review cycles), showing cheaper models push cost upstream into more review cycles. This is the best single external citation for the report; it independently proves aireceipts' cost-per-outcome thesis and quantifies the harness effect aireceipts could visualize via its compare command.
- **Cost per accepted/net line shipped**: approximate version is feasible (transcript cost divided by net lines surviving in the merged commit), true line-level AI-authorship provenance is harder.
- **Cost per ticket closed**: needs Jira in the general case, but the codebase's own commit convention (`type: [AI-1234] description`) means a ticket id is sometimes recoverable from git alone, giving a partial path without a Jira connector.
- **Per-developer, per-repo showback**: aireceipts already attributes cost to a developer (session author) and a repo/branch for free, without any tagging pipeline, which is exactly the FinOps "showback" maturity stage most vendors need a whole allocation layer to reach.
- **Budget, forecast, and anomaly detection**: aireceipts' waste lines already function as a session-level anomaly detector; cross-session trend forecasting and monthly budget enforcement are credible roadmap extensions, not current strength, and would require aggregating past receipts over time, which is local data aireceipts already generates.

---

## E. Developer productivity research tying AI spend to outcomes (DORA, SPACE, GitClear, DX, Faros, Jellyfish, LinearB)

Framing: aireceipts' transcript plus git gives two things these platforms mostly lack or must estimate: exact per-session dollar cost, and ground-truth AI authorship (the transcript is the literal record of which edits the agent made). What it structurally lacks is the org-wide layer these platforms are built on: fleet-scale PRs, ticketing, CI/CD, incidents, and survey data.

- **DORA** (dora.dev): the authoritative four-keys framework. The 2025 report quantified that a 25 percent increase in AI adoption correlates with a 1.5 percent decrease in delivery throughput and a 7.2 percent decrease in delivery stability, attributed to AI-driven larger batch sizes and a "verification tax." Computable offline: no, these are fleet-level deploy/incident correlations, structurally out of reach for a single session.
- **SPACE framework**: the intellectual guardrail that any single-number AI-productivity claim is suspect; by its own logic a transcript covers at most the Activity and Efficiency dimensions of five. Gives aireceipts license to be honest about being an activity/cost instrument, not a full productivity measure.
- **GitClear** (gitclear.com): the most methodologically similar research to aireceipts, using git history alone (code churn, copy-paste vs moved-line ratio, duplication) to argue AI-assisted code quality is degrading; churn rose from 4.5 to 5.7 percent between 2023 and 2024, and duplicated 5+ line blocks rose roughly 8x. Computable offline: yes for the churn/duplication mechanics, since it is pure git analysis; the difference is that GitClear infers AI authorship by correlation across a huge corpus, while aireceipts' transcript knows ground truth for the sessions it has, so aireceipts could out-perform GitClear's own attribution accuracy on the data it has access to.
- **DX** (getdx.com): the closest philosophical competitor found in the whole survey. Runs a local filesystem daemon to detect AI-authored code without exfiltrating it, and defines an "AI code retention" metric (what survives to production after developer rewrites). This is the same local-agent-authorship-detection move aireceipts makes, but as paid enterprise SaaS aggregating a whole org plus survey data; aireceipts is local, free, per-session, and adds real dollar cost DX has to get from aggregated vendor APIs.
- **Faros AI**: a 2026 report across roughly 22,000 developers found AI-code acceptance rose from about 20 to 60 percent while incidents per PR rose about 243 percent and review time rose about 442 percent, evidence for the "activity up, stability down" pattern. Its "cost-per-verified-outcome" framing is conceptually identical to aireceipts' territory for a single session, just computed from aggregated vendor logs at fleet scale instead of locally per session.
- **Jellyfish**: pairs an AI Token Spend dashboard with org-wide delivery outcomes for a finance/executive audience; token-spend tracking overlaps aireceipts, but the value-add is joining spend to org financials, out of reach for a local tool.
- **LinearB**: defines a precise, git-computable "rework rate" (changes to code younger than 21 days) and reports, from over 8 million PRs, that AI-assisted PRs merge at about 33 percent versus 84 percent for manual PRs. The rework-rate definition is directly portable: aireceipts could compute it from git alone and attribute it to AI-authored lines using transcript ground truth.

---

## Prioritized top 20 insights aireceipts could add

Ranked by a mix of offline computability, distinctiveness versus the field above, and value to a developer or eng manager. Items already covered by aireceipts today (per-tool cost/time, waste lines, model price-delta, subagent rollups, PR receipts) are excluded; these are genuinely new ground.

1. **Cost per merged PR / cost per merged commit.** Independently validated by three separate sources (Git AI, the "cost to a merged feature" study, and FinOps tokenomics) as the single most defensible AI unit-economics metric, and aireceipts' PR-attach pipeline already has the attribution machinery to compute it. Highest priority.
2. **Context-cost attribution**: what fraction of a session's tokens went to tool definitions, system prompt, skills catalog, and environment context versus actual conversation. Directly modeled on opencode-tokenscope, fully offline, and a genuinely new waste-detection angle nobody else in the aireceipts category ships.
3. **Cache hit rate and realized cache savings**, computed as cache-read tokens over total input tokens, with a dollar figure for what was saved versus paying fresh-input price. Every serious tracker in category A and several in category B surface this; aireceipts likely has the raw numbers already and is not stating the ratio explicitly.
4. **Retry-loop / inference-call-count per turn**, mirroring OTel's `gen_ai.invoke_agent.inference_calls` and `tool_calls` counts, as an explicit waste signal for thrash and stuck loops, distinct from existing waste checks.
5. **Code churn / rework rate**, defined as the percentage of AI-authored lines modified or reverted within a short window (LinearB uses 21 days, GitClear uses about 2 weeks), computed from git alone but with aireceipts' unique advantage of ground-truth AI authorship rather than GitClear's statistical inference.
6. **Per-skill and per-MCP-server cost attribution**, going one level finer than existing subagent rollups, matching Claude Code's own `skill.name` and `mcp_server.name` telemetry fields, reconstructable from JSONL structure without needing OTel.
7. **Reasoning/thinking-token cost split**, isolating `reasoning.output_tokens` as its own line item where the agent logs it, since extended-thinking spend is often invisible in a flat token total.
8. **Most-expensive-sessions ranking / cost percentile view**, modeled on ocsight's `sessions top --cost`, useful for triage across a week or a repo.
9. **Cost per net line shipped (approximate)**, transcript cost divided by net lines surviving in the attributed merged commit, clearly labeled as an approximation given true line-level provenance is hard.
10. **Copy-paste vs moved-line duplication ratio**, borrowed directly from GitClear's git-only methodology, as a code-quality companion to the existing cost receipt.
11. **Historical trend and month-end budget projection**, aggregating aireceipts' own past receipts locally (no new data source needed) to flag pace against a user-set monthly budget, the way ocsight and credit-forecaster-style tools do.
12. **Session-to-session cost anomaly flagging**, a local day-over-day or week-over-week spike check over aireceipts' own historical receipts, distinct from the existing single-session waste lines.
13. **Per-developer and per-repo showback rollup**, aggregating multiple sessions by git author and by repository, which is the FinOps showback maturity stage and needs no tagging pipeline since git already has the dimensions.
14. **Tool-call success/failure rate per tool**, modeled on claude-monitor, useful for spotting which tools an agent struggles with independent of cost.
15. **Blended dollars-per-million-tokens**, OpenRouter's headline efficiency number, as a normalized cross-session or cross-model comparison figure.
16. **5-hour billing-block / burn-rate live view**, matching ccusage and Claude-Code-Usage-Monitor, useful specifically for the statusline surface aireceipts already has.
17. **Cost-to-merge including review cycles**, splitting "coding cost" from "gate cost" per the insight-services study, computable only when a review pass itself ran through a logged agent session, otherwise partial.
18. **Harness/agent comparison view for the same task**, extending the existing compare command with the insight-services finding that harness choice alone produces a 2.5x cost swing holding the model constant, making a structured multi-agent-on-one-task comparison a natural fit.
19. **Contribution-graph style year-in-review**, an opt-in, purely cosmetic rollup in the spirit of tokscale's "Wrapped," low effort and high shareability, not a core analytical addition but cheap to add.
20. **Accept/reject decision rate for edits**, approximated from transcript signals of which proposed edits were kept versus undone, acknowledging this is weaker than Claude Code's own live permission-decision telemetry and should be labeled as an approximation.

## What is explicitly out of reach offline (worth stating plainly rather than overclaiming)

Subscription-quota percentage and rate-limit reset windows, prepaid credit balances, true per-token streaming latency, active-versus-idle user time, DORA's four keys (deployment frequency, change failure rate, time to restore), PR revert/review-time data that lives only in a PR platform, ticket-status data that lives only in Jira (absent a commit-tag shortcut), and any fleet-scale benchmark requiring many developers' data at once. All of these require a live API, a ticketing system, or aggregated telemetry a purely local, deterministic tool cannot obtain.
