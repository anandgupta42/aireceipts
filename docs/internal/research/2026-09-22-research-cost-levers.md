# AI coding-agent cost levers: what a transcript-reading receipt can measure, recommend, or automate

Research date: 2026-09-22. Scope: every concrete, evidence-backed lever for lowering AI coding-agent spend, and for each one what `aireceipts` can compute deterministically from transcript fields, what the receipt line or handoff tip should say, and what it cannot honestly claim.

House rules applied throughout: facts not rankings; every dollar comes from a cited price row times a transcript token count; counterfactuals are labelled as price arithmetic under a stated assumption (same pattern as the existing "cheaper model" line); no claim that a change "would have succeeded".

Existing detectors (so recommendations below are marked NEW or EXTEND): stuck loops, same-file re-reads, trivial spans, context thrash, price-delta footnote (`src/pricing/waste.ts`); cost shape with top turns, late turns, pre-edit share (`src/pricing/costShape.ts`); budgets (`src/budget/`); week aggregation (`src/aggregate/week.ts`); subagent split (`src/receipt/subagents.ts`); quota window (`src/cli/quotaWindow.ts`). `TokenUsage` already carries `cacheRead`, `cacheCreation`, `cacheCreation5m`, `cacheCreation1h`; reasoning tokens are currently folded into `output` for Codex, Gemini and opencode.

---

## 0. The single most important fact

In agentic coding, input dominates cost, and most input is re-reading the growing conversation.

- Anthropic's Claude Code docs: "Claude Code sends your full conversation with every request ... a one-line question in a session that has been open all day still draws usage for the whole conversation." https://code.claude.com/docs/en/costs
- Bai, Pei, Brynjolfsson, Pentland et al., "How Do AI Agents Spend Your Money?" (arXiv 2604.22750): agentic tasks use about 3,500x the tokens of single-turn reasoning; input dominates cost even with caching; cache reads are the largest cost category in every phase; spend is heavy-tailed; the same task varies about 2x run to run; more tokens do NOT correlate with higher accuracy (accuracy peaks at intermediate spend); high-cost failed runs show about 50% repeated file actions. https://arxiv.org/html/2604.22750.pdf
- Vantage: input outnumbers output 20 to 25x in agentic sessions, about 85% of session cost. https://www.vantage.sh/blog/agentic-coding-costs

Implication for the receipt: the cost of a session is driven by (context size) x (number of requests) x (price per cached token), plus cache-miss rebuilds. Every lever below attacks one of those factors.

---

## 1. Prompt caching economics

### 1a. Anthropic (Claude Code, opencode on Anthropic, Cursor on Anthropic)

Facts (vendor docs):

| Item | Value | Source |
|---|---|---|
| 5-minute cache write | 1.25x base input | https://platform.claude.com/docs/en/about-claude/pricing |
| 1-hour cache write | 2x base input | same |
| Cache read | 0.1x base input; 0.05x on Opus 5.5; 0.025x on Fable 5.1 / Mythos 5.1 | same |
| Break-even | 5m TTL pays off after 1 read; 1h TTL after 2 reads | same |
| Min cacheable prefix | 512 (Fable 5.x, Opus 5.x) / 1,024 (Sonnet 5, 4.x) / 2,048 / 4,096 (Haiku 4.5, Opus 4.5 and 4.6) | https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching |
| Hierarchy | tools, then system, then messages; a change at one level invalidates it and everything after | same |
| Lookback | 20 blocks per breakpoint; max 4 breakpoints | same |
| Usage fields | `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`; total input = read + creation + input | same |

Claude Code TTL defaults (https://code.claude.com/docs/en/prompt-caching):

- Subscription within plan usage: main conversation gets 1h; subagents, compaction, titles get 5m.
- Usage credits, API key, or cloud provider: 5m everywhere by default.
- Overrides: `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL` (main), `subagentPromptCacheTtl` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H=1`, `FORCE_PROMPT_CACHING_5M=1`.

What breaks the cache in Claude Code (same page): switching models (each model has its own cache; includes `opusplan` toggles, skills with a `model:` frontmatter, automatic fallback), changing effort level (except Fable 5.1 first-party), turning on fast mode (header is part of cache key), connecting/disconnecting MCP servers whose tools are loaded into the prefix (deferred tools are safe), enabling plugins that bring MCP servers, denying a whole tool when tool search is off, compaction (by design), dropping accumulated images, upgrading Claude Code, idle past TTL, and gateways that strip `cache_control` (whole history billed uncached every turn). Cache is scoped per working directory, so worktrees do not share each other's cache. Things that do NOT break it: editing repo files, editing CLAUDE.md mid-session (it simply does not apply until `/clear`/`/compact`), permission mode changes, skills, `/rewind`, spawning subagents.

Anthropic runs alerts and declares SEVs on Claude Code's own prompt cache hit rate, and designed plan mode, deferred tools and compaction specifically to protect the prefix. https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/

Claude Code itself now prints `Prompt cache (main): N requests, X% of input tokens from cache, K misses ... likely cause: ...` in `/usage` and counts a request as a miss when it "re-processed more than 5% and at least 2,000 tokens of what it could have read from cache". https://code.claude.com/docs/en/costs  This is a vendor-published miss definition aireceipts can adopt verbatim and cite.

Expected savings: caching turns a re-read from 1.0x to 0.1x (or 0.05x/0.025x) of input price, so in a long session the difference between a 95% and an 80% cached share is large. Vendor docs do not publish a target hit rate. Community reports of well-behaved Claude Code sessions sit above 90% read share (the example line in the docs shows 91%).

What aireceipts can compute deterministically (per assistant request, Claude Code fields above; `message.id` dedupe already exists):

1. `total_in_i = input_i + cache_read_i + cache_creation_i`
2. Cache read share = `sum(cache_read) / sum(total_in)` (session and per-model).
3. Write/read ratio = `sum(cache_creation) / sum(cache_read)`. High and persistent means the prefix keeps changing.
4. Miss detection (adopt Claude Code's published rule): readable_i = `total_in_{i-1} + output_{i-1}` approximated by the previous request's full prefix on the same model and same session chain. Missed_i = `max(0, readable_i - cache_read_i)`. Flag a miss when Missed_i > 5% of readable_i AND >= 2,000 tokens.
5. Money lost to a miss (pure price arithmetic): `Missed_i x (write_rate_or_input_rate - cache_read_rate)` using the row that priced the turn. Use the 5m or 1h write rate per the transcript's ephemeral split.
6. Cause attribution, all from transcript facts, in precedence order:
   - "idle past TTL": gap between `timestamp_{i-1}` and `timestamp_i` exceeds the TTL shown by the ephemeral split (5m or 60m).
   - "model switch": `message.model` differs from the previous main-chain request.
   - "compaction (expected rebuild)": a compaction boundary sits between i-1 and i (already parsed as `Compaction`).
   - "session resumed": first request after a resume marker.
   - otherwise "prefix changed (cause not visible in transcript)". Do not guess MCP or upgrade causes unless the transcript records a version change (`version` field on Claude Code lines can be compared; a version change between requests is a fact).
7. TTL counterfactual (arithmetic, labelled): for sessions written at 5m, sum the misses whose idle gap was between 5 and 60 minutes; compare `extra cost of writing every cache write at 2x instead of 1.25x` versus `rebuild cost avoided`. Output both numbers, never a verdict of "you should".
8. Gateway stripping signature: many requests with `cache_read = 0` and `cache_creation = 0` on a model that supports caching and a prefix above the minimum. That is a fact pattern worth one caveat line ("no cache tokens reported on N requests").

Receipt line examples:

- `cache   91% of input served from cache (1.9M of 2.1M tokens)`
- `cache misses   3 rebuilds, $1.84 at list price: 2 after >5 min idle, 1 after model switch (opus->sonnet at 14:02)`
- Handoff tip: `2 cache rebuilds followed idle gaps of 7 and 22 min. This session wrote at the 5-minute TTL. At list price, 1-hour writes would have added $0.41 in write premium and avoided $1.52 of rebuilds. Setting: promptCacheTtl=1h.`

Cannot honestly claim: the true cause of an unattributed miss (MCP reconnects, CLI upgrades mid-session are invisible unless logged); that a different TTL "saves" money on future sessions; cache behavior on gateways or Bedrock where rules differ; subscription dollars (on a plan, the cache affects quota burn, not the bill).

### 1b. OpenAI (Codex)

Facts (https://developers.openai.com/api/docs/guides/prompt-caching): caching is automatic for prompts of 1,024+ tokens. GPT-5.6+: cache read 0.1x, cache write 1.25x, retention at least 30 minutes. GPT-5.5 and earlier: no write charge, reads discounted per model (0.1x on current GPT-5.x rows, https://developers.openai.com/api/docs/pricing). Retention `in_memory` is typically 5 to 10 minutes idle (up to 1h) or `24h` extended. Usage fields `input_tokens_details.cached_tokens` and `cache_write_tokens`. Cache breaks on model change, tool definitions/order/schema, `reasoning.effort`, `text.verbosity`, `parallel_tool_calls`, `text.format`, compaction. Traffic above about 15 rpm per prefix can overflow to cold machines.

Codex rollout fields (`~/.codex/sessions/.../rollout-*.jsonl`): `token_count` events with `total_token_usage` and `last_token_usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`); newer builds emit `token_usage_record` with `cache_write_input_tokens`. Note input_tokens INCLUDES cached tokens in Codex (already handled in `src/parse/codex.ts`). Community parsers have shipped 3.7x overcount bugs on the streaming snapshot format (https://github.com/getagentseal/codeburn/issues/1380), so any cache metric must use per-turn deltas of the cumulative counter, not sum the snapshots.

aireceipts can compute: cached share `cached_input_tokens / input_tokens`; misses using the same readable-prefix method; effort changes between turns (`turn_context` carries model and effort) as a named miss cause.

### 1c. Google Gemini (Gemini CLI)

Facts (https://ai.google.dev/gemini-api/docs/caching, https://ai.google.dev/gemini-api/docs/pricing): implicit caching is automatic on Gemini 2.5+; minimum 2,048 tokens (2.5) or 4,096 (3.x Pro/Flash). Cached input on current Flash lists at $0.075 vs $0.75 input (0.1x); 3.1 Pro $0.20 vs $2.00. Explicit caches add storage ($0.50 or $4.50 per MTok per hour) which a CLI transcript never shows. Gemini CLI records `tokens.cached` and `tokens.thoughts` per message (parsed today).

aireceipts can compute cached share only; there is no write count, so no miss-dollar line. Say so.

---

## 2. Model routing and tiering

Facts:

| Model | In / Out per MTok | Cache read |
|---|---|---|
| Fable 5.1 | $10 / $50 | $0.25 |
| Opus 5.5 | $4 / $20 | $0.20 |
| Opus 4.x (4.5 to 4.8), Opus 5 | $5 / $25 | $0.50 |
| Sonnet 5 | $2 / $10 | $0.20 |
| Sonnet 4.5 / 4.6 | $3 / $15 | $0.30 |
| Haiku 4.5 | $1 / $5 | $0.10 |
| GPT-5.5 | $5 / $30 | $0.50 |
| GPT-5.4 / mini / nano | $2.50/$15, $0.75/$4.50, $0.20/$1.25 | 0.1x |
| GPT-5.3-codex | $1.75 / $14 | $0.175 |

Sources: https://platform.claude.com/docs/en/about-claude/pricing, https://developers.openai.com/api/docs/pricing. Note the Claude 4.7+ tokenizer produces about 30% more tokens for the same text, so per-token price comparisons across tokenizer generations understate real deltas (pricing page note).

Knobs:

- Claude Code: `/model`, `--model`, `ANTHROPIC_MODEL`, `model` in settings, `opusplan` (Opus in plan mode, Sonnet executing), `CLAUDE_CODE_SUBAGENT_MODEL`, `model: haiku` in subagent frontmatter, `ANTHROPIC_DEFAULT_HAIKU_MODEL` for background tasks, `availableModels` + `enforceAvailableModels` for admins. https://code.claude.com/docs/en/model-config
- Anthropic's own guidance: "Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions or multi-step reasoning ... For simple subagent tasks, specify `model: haiku`." And for agent teams: "Use Sonnet for teammates." https://code.claude.com/docs/en/costs
- Codex: `model`, `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`, profiles. https://learn.chatgpt.com/docs/config-file/config-reference
- Codex plan quotas differ by model by roughly an order of magnitude per tier (the smallest GPT-6 model gets about 20x the 5-hour messages of the mid model on the same plan). https://learn.chatgpt.com/docs/pricing
- Anthropic's recommended pattern is to switch models via subagents, never mid-conversation, because a mid-session switch rebuilds the whole cache. https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/

Evidence on savings:

- RouteLLM (LMSYS): up to 85% cost reduction at 95% of GPT-4 quality on MT-Bench; 45% on MMLU; 35% on GSM8K. https://github.com/lm-sys/routellm  (chat benchmarks, not agentic coding; cite as directional only).
- Practitioner reports of routing Claude Code subagents to Haiku: 40% to 60% lower bills (https://www.makeuseof.com/claude-codes-grunt-work-to-subagents-reduce-token-billing-usage/, https://medium.com/@roanmonteiro/claude-code-subagent-model-routing-stop-paying-for-opus-on-haiku-work-ee76dc32cb88). Anecdotal.
- Model efficiency differs even at similar price: the Bai et al. paper found some models spend about 1.5M more tokens per task than others on the same SWE-bench problems.

What aireceipts can compute:

- Spend by model, by main vs subagent (sidechain), by subagent type (Claude Code `isSidechain`, agent name where present). EXTEND `subagents.ts`.
- Price delta per subagent: "these subagent tokens on Haiku 4.5 list = $Y" (existing price-delta pattern; EXTEND to per-subagent granularity).
- Read-only subagents: a subagent whose tool calls are all Read/Grep/Glob/LS/WebFetch and no Edit/Write/Bash-mutation, running on an Opus/Fable-class model. That is a structural fact. Tip: "3 read-only subagents ran on Opus 5.5 ($2.10). Same tokens at Haiku 4.5 list: $0.52. Setting: `model: haiku` in the agent file."
- Model switches in the main chain and the rebuild dollars they caused (ties to 1a).
- `opusplan` users: count plan-mode toggles as model switches.

Cannot claim: that the cheaper model would have produced the same result; "the frontier model was unnecessary". The line stays arithmetic.

### 2b. Effort / reasoning / thinking

Facts:

- Claude Code thinking tokens bill as output; default budget "can be tens of thousands of tokens per request"; lower via `/effort` (low, medium, high, xhigh, max), `CLAUDE_CODE_EFFORT_LEVEL`, `MAX_THINKING_TOKENS` on fixed-budget models. Changing effort mid-session rebuilds the cache on most models. https://code.claude.com/docs/en/costs, https://code.claude.com/docs/en/model-config
- Anthropic: Opus 4.5 at medium effort matched Sonnet 4.5's best SWE-bench Verified score with 76% fewer output tokens. https://www.anthropic.com/news/claude-opus-4-5
- Codex: `model_reasoning_effort`, `plan_mode_reasoning_effort`, `model_verbosity`. Practitioner report: 40 to 60% savings on routine tasks going medium to low; reasoning tokens 1x to 3x multiplier by effort. https://codex.danielvaughan.com/2026/06/10/codex-cli-token-consumption-diagnosis-reduction-quota-drain-practitioner-toolkit/

What aireceipts can compute: reasoning share of output and its dollars where the transcript separates it (Codex `reasoning_output_tokens`, Gemini `thoughts`, opencode `tokens.reasoning`). Requires a NEW optional `reasoning` sub-bucket of output in `TokenUsage` (subset, never added twice). Claude Code transcripts do not separate thinking tokens from output, so for Claude the receipt must say "thinking not separable in this transcript". Effort level per turn is available in Codex `turn_context`; report effort mix and effort changes (cache-miss cause).

Cannot claim: that lower effort would have been sufficient.

---

## 3. Context management

Facts:

- Clear between unrelated tasks; `/clear` "costs nothing" while `/compact` is itself a large request (it re-reads the conversation; cheap only while the cache is warm). Run compaction at natural breaks, or `/rewind` to reuse an already-cached prefix. https://code.claude.com/docs/en/costs, https://code.claude.com/docs/en/prompt-caching
- "Unexpectedly high spend on an API or cloud-provider plan usually traces back to long sessions that were never cleared or to Opus left as the default model." https://code.claude.com/docs/en/costs
- CLAUDE.md is loaded every session; keep it under 200 lines; move workflow instructions into skills (loaded on demand). same page.
- MCP: tool definitions are now deferred by default in Claude Code (tool search); Anthropic measured about 134k tool-definition tokens dropping to about 5k (85%) with tool search, and a 150k to 2k (98.7%) example with code-execution-style MCP. https://www.anthropic.com/engineering/advanced-tool-use, https://www.anthropic.com/engineering/code-execution-with-mcp. Where tools still load into the prefix (gateways, `alwaysLoad`, older Vertex models, Codex without scoping), a GitHub MCP server can add about 55k tokens per request; scoping it to 3 tools dropped it to about 3k. https://dev.to/kenimo49/your-mcp-server-eats-55000-tokens-before-your-agent-says-a-word-i-measured-the-real-cost-19l8, https://codex.danielvaughan.com/2026/06/10/codex-cli-token-consumption-diagnosis-reduction-quota-drain-practitioner-toolkit/
- Prefer CLIs (`gh`, `aws`) over MCP; disable unused servers. https://code.claude.com/docs/en/costs
- Hooks that filter tool output (test runner failures only) cut context "from tens of thousands of tokens to hundreds". Delegate verbose operations (tests, logs, docs) to subagents so only a summary returns. same page.
- Codex `tool_output_token_limit` caps stored tool output; `model_auto_compact_token_limit` controls compaction. https://learn.chatgpt.com/docs/config-file/config-reference
- Quality angle: Chroma's "Context Rot" study found all 18 tested models degrade as input length grows. https://www.trychroma.com/research/context-rot  So smaller context is not only cheaper; it is not a quality sacrifice.
- Agent teams use about 7x the tokens of a standard session when teammates run in plan mode. https://code.claude.com/docs/en/costs
- Worktrees: each working directory has a separate cache, so N parallel worktree sessions each pay their own prefix writes. https://code.claude.com/docs/en/prompt-caching

What aireceipts can compute (all from token fields, no content inspection needed):

1. Baseline overhead = `total_in` of the first main-chain request (system + tools + CLAUDE.md + first prompt). Carry cost of baseline = baseline x (requests - 1) x cache_read_rate + one write. Fact line: `baseline context 41k tokens, carried on 212 requests: $2.60`. NEW. In week view, compare baseline across repos (a repo with 3x the baseline is a CLAUDE.md/MCP candidate).
2. Per-tool-result carry cost: delta_i = `total_in_i - total_in_{i-1} - output_{i-1}` is the size of new content entering at request i (mostly tool results). Carry cost = delta_i x (number of later requests until next compaction/clear) x cache_read_rate + write. Rank the top 3 tool results by carry cost and name the tool and path/command (already in tool-call inputs). EXTEND the planned "oversized results" check. Tip: `Bash(npm test) result added 38k tokens and was carried 64 more requests: $1.10. A filter hook or subagent keeps it out of the main context.`
3. Context growth curve: cost per request at start vs end; the late-turn share already exists in cost shape. EXTEND with "marginal cost of a one-line prompt now" = next request's expected input (last `total_in`) x read rate. That is an honest, forward-looking fact: `each new message in this session now re-reads 380k tokens (~$0.10 at cache price)`.
4. Topic-shift heuristic for `/clear`: NOT deterministic from tokens alone. A safe proxy: long idle gap (>TTL) followed by a new user prompt in a large context, which is exactly the "resume from summary" case Claude Code itself offers. Tip language: "after a 43 min break, the next message re-wrote 310k tokens ($1.40). `/clear` or resume-from-summary avoids carrying it."
5. Compaction cost: the summarization request tokens (Claude Code records compaction boundaries; the compaction call itself may not be in the main transcript) plus the rebuild after. Report count and position ("auto-compacted twice, mid-task").
6. MCP: count `mcp__<server>__<tool>` calls per server; flag servers configured but never called only if the transcript lists them (Claude Code does not log the server list, so this is NOT computable from the transcript; `aireceipts setup` could read `.mcp.json` locally as a separate, clearly-labelled fact).
7. Images: count image blocks; they are a documented cache-drop cause.
8. Parallel/worktree sessions: same repo, overlapping time windows, different cwd; sum of first-request writes. Fact only.

Cannot claim: that specific content was unnecessary; that compaction lost information; token attribution to a specific MCP server's schema (definitions are not in the transcript).

---

## 4. Pricing-plan arbitrage

Facts:

- Claude plans: Pro $20/mo ($17 annual), Max 5x $100, Max 20x $200; Team Standard $25 ($20 annual), Team Premium $125 ($100 annual); Enterprise $20/seat plus usage at API rates. Limits reset on a rolling 5-hour window plus weekly caps. https://claude.com/pricing, https://intuitionlabs.ai/articles/claude-max-plan-pricing-usage-limits
- On a subscription, Claude Code's `/usage` dollar figure "isn't relevant for billing purposes". Main-conversation cache TTL is 1h within plan usage and drops to 5m on usage credits. https://code.claude.com/docs/en/costs
- Codex: Plus $20, Pro $100+ (5x or 20x), Business $20/user; per-5h message allowances differ by model; API-key usage is billed separately at API rates. https://learn.chatgpt.com/docs/pricing
- Batch API: 50% off input and output (Anthropic, OpenAI, Gemini). Interactive agents cannot use it; offline jobs built directly on the API can. https://platform.claude.com/docs/en/about-claude/pricing
- Long-context: Claude 4.6+ bills the full 1M window at standard rates. OpenAI charges 2x above the long-context threshold (GPT-5.5 row is priced for under 272k). Gemini 3.1 Pro doubles input above 200k ($2 to $4) and output ($12 to $18). https://developers.openai.com/api/docs/pricing, https://ai.google.dev/gemini-api/docs/pricing
- Fast mode: Opus 5.5 $8/$40 (2x standard), OpenAI fast 4x. Turning it on mid-session also rebuilds the cache. https://platform.claude.com/docs/en/about-claude/pricing, https://code.claude.com/docs/en/prompt-caching
- Priority tiers: Gemini priority 1.8x; OpenAI flex = batch price for latency-tolerant work. Data residency `inference_geo: "us"` is 1.1x on Claude 4.6+.
- Regional cloud endpoints on Bedrock/Vertex carry a 10% premium over global endpoints.

What aireceipts can compute:

- API-equivalent spend per rolling 5-hour window and per calendar month at list price (EXTEND `quotaWindow.ts`). Fact line for subscribers: `this month at API list price: $1,240. Max 20x lists at $200/mo.` and the reverse for API users: `this month at API list price: $180; Max 5x lists at $100`. No claim about whether limits would have been hit.
- Turns above a vendor long-context threshold and the surcharge they paid, when the price table carries tiered rows (NEW rows needed in `data/prices/openai.json` and `google.json`).
- Fast-mode and data-residency multipliers only if the transcript records them (Claude Code usage objects include `service_tier`; `speed`/`inference_geo` presence must be verified per version before claiming). If unknown, the receipt must not apply them.
- Headless sessions (`claude -p`, `codex exec`, Agent SDK entrypoints) that recur on a schedule: count and cost. Tip: "recurring non-interactive jobs are candidates for a Batch API pipeline at 50% list"; only when the job is built on the API, never for Claude Code itself.

Cannot claim: real subscription quota consumption (weights are not published); negotiated enterprise rates (unless the user supplies a `modelPricing`-style override); that switching plans saves money for the user's future months.

---

## 5. Behavioral levers

| Lever | Evidence | Deterministic transcript signal | Receipt/tip wording |
|---|---|---|---|
| Specific prompts, not "improve this codebase" | Claude Code costs doc | Read/Grep calls before first edit; pre-edit share (exists) | `62% of spend came before the first edit` (exists) |
| Plan mode for complex work, course-correct early with Esc and `/rewind` | Claude Code costs doc | Rewinds and interrupts are visible in Claude Code transcripts | Fact count only |
| Grep/LSP before read; code-intelligence plugins | Claude Code costs doc | Whole-file reads of large files (read result delta size); repeated reads (exists) | `4 whole-file reads over 20k tokens` |
| Filter test/log output | Claude Code costs doc; Codex toolkit (`cargo test` 60 to 90% noise) | Bash result delta size by command family (test runners, build, logs) | Top tool result by carry cost (see 3.2) |
| Short sessions (5 to 15 turns) | Codex toolkit practitioner report | Requests per session, context at end | Only facts |
| Targeted tests instead of full suite | Practitioner consensus | Repeated full test-runner commands with large outputs | Stuck-loop detector covers retries (exists) |
| Stop redundant exploration | Bai et al.: failed high-cost runs show ~50% repeated file actions | Same-file re-reads (exists), stuck loops (exists) | exists |
| Background idle burn (`/loop`, goal check-ins, cross-session messages, teammates) | Claude Code costs doc "Why usage climbs in a long session" | Requests with no preceding human prompt within N minutes, recurring on an interval | `18 requests fired while you were idle (scheduled loop): $3.10` NEW |

---

## 6. Organizational levers and published numbers

Published per-developer numbers:

- Anthropic: about $13 per developer per active day, $150 to $250 per developer per month across enterprise deployments, and under $30 per active day for 90% of users. https://code.claude.com/docs/en/costs
- Anthropic rate-limit sizing per user: 200k to 300k TPM for 1 to 5 users, down to 10k to 15k TPM for 500+ users. same page.
- Uber (CTO, reported May/June 2026): burned the 2026 AI coding budget in four months as Claude Code adoption rose from 32% to 84% of about 5,000 engineers; average $150 to $250 per engineer per month, power users $500 to $2,000; now caps spend at $1,500 per employee per month per agentic tool. https://techcrunch.com/2026/06/02/uber-caps-employee-ai-spending-after-blowing-through-budget-in-four-months/, https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/
- Microsoft Experiences + Devices (reported June 2026): per-engineer API cost $500 to $2,000 per month after a flat-seat pilot hid consumption; directed migration to Copilot CLI by 2026-06-30. https://www.forbes.com/sites/jonmarkman/2026/06/01/microsoft-ends-claude-code-licenses-as-it-pushes-copilot-cli/, https://thenextweb.com/news/microsoft-claude-code-retreat-ai-cost
- Anthropic enterprise consumption guide for budgeting seats: https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide

Lesson from both: consumption was invisible until the bill. The pain is visibility and attribution, which is aireceipts' core.

Org levers:

- Budgets per repo/team with alerts (Console workspace spend limits, Team/Enterprise spend limits, gateway caps, OTel metrics `claude_code.cost.usage` with `model`, `query_source`, `effort`, `agent.name`, `mcp_server.name` attributes). https://code.claude.com/docs/en/monitoring-usage
- `modelPricing` managed setting so Claude Code reports at contracted rates. aireceipts should support an equivalent local override file so its dollars match contracts, still citing the source.
- Default-model policy via `availableModels`; subagent model defaults.
- Per-PR cost gates in CI: aireceipts already attaches PR receipts and has budgets; a gate can fail or warn when a PR's attributed spend exceeds a repo threshold.
- Cost per merged PR benchmark: no vendor publishes one. aireceipts can compute it from its own data (sum of attributed session cost / merged PRs) and must label it as the team's own baseline, not an industry benchmark.

---

## 7. Session-level anomaly detection

Evidence: spend is heavy-tailed across tasks and runs (Bai et al.); a CTO spent $1,200 in a two-hour demo session (Fortune, above); Claude Code flags behaviors above 10% of recent usage (long context, cache misses) in `/usage`.

Deterministic metrics:

1. Concentration: share of session cost in the top 5% of requests; share in top 3 turns (exists as top-turns fact). Gini coefficient is fine internally but show "top 3 turns = 41% of cost".
2. Burn rate: $ per wall-clock minute over rolling 10-minute windows; flag windows above 3x the session median (a fixed, documented threshold). Name what happened in the spike window (tools, delta sizes, misses).
3. Cost cliffs: single request cost above k x session median, with cause decomposition (big write, big output, miss).
4. Session vs own history: session cost vs the user's trailing 30-day p90 for the same repo (week data, local only). Fact: "this session: $38, your p90 for this repo: $9".
5. Runaway loops: exists (stuck loops, context thrash).
6. Idle background burn (see section 5).

---

## Ranked top 15 cost insights to add to the receipt

Ranking weighs: dollars at stake (from the evidence above), deterministic computability from existing parsed fields, and actionability via a single named setting or habit.

1. **Cache-miss rebuild dollars with cause** (NEW). Adopt Claude Code's published miss rule (>5% and >=2,000 tokens); price missed tokens at write minus read rate; cause = idle past TTL, model switch, compaction, resume, or "not visible". Largest avoidable line in long sessions, all from usage fields and timestamps.
2. **Cache read share and write/read ratio** (NEW). One line: `91% of input from cache`. Anthropic SEVs on this metric internally; it is the health metric for everything else.
3. **Carry cost of the biggest tool results** (EXTEND oversized-results plan). Delta tokens x requests carried x read rate; names the command or path. Directly actionable: filter hook, subagent, or `tool_output_token_limit`.
4. **Baseline context overhead and its carry cost** (NEW). First-request prefix size times requests. Catches bloated CLAUDE.md/AGENTS.md, loaded MCP schemas and plugins without needing to see them.
5. **Marginal cost of the next message** (NEW). Last `total_in` x read rate; the honest "why `/clear` now" nudge, stated as a fact about the next request.
6. **Idle-gap rebuilds and the TTL arithmetic** (NEW). For 5m-TTL sessions: rebuilds after 5 to 60 min gaps vs 1h write premium, both in dollars, pointing to `promptCacheTtl`.
7. **Subagent spend by model with read-only flag and price delta** (EXTEND subagents + price delta). `3 read-only subagents on Opus: $2.10; at Haiku list: $0.52`.
8. **Mid-session model/effort/fast-mode switches** (NEW). Each switch as a counted event with its rebuild dollars.
9. **Reasoning-token share and dollars** (NEW bucket; Codex, Gemini, opencode). Effort mix per turn for Codex. Claude says "not separable".
10. **Cost concentration and burn-rate spikes** (EXTEND cost shape). Top-3-turn share plus spike windows at 3x median burn, with the tool activity in the window.
11. **Idle background requests** (NEW). Requests with no human prompt nearby recurring on an interval (loops, check-ins, teammates), summed.
12. **Compaction count, timing, and cost** (EXTEND). "auto-compacted twice mid-task" plus the summarization/rebuild dollars; tip to compact at breaks or `/rewind`.
13. **Long-context surcharge paid** (NEW price rows). OpenAI above threshold and Gemini above 200k; Claude line states "no long-context surcharge on this model" as a fact.
14. **Subscription vs API arithmetic per 5h window and month** (EXTEND quota window). API-list-equivalent dollars next to the plan's list price, no verdict.
15. **Cache-disabled / gateway-stripped signature** (NEW caveat). Requests above the model's minimum prefix with zero cache read and write, a strong signal of a misconfigured gateway where the whole history bills uncached.

## Top 5 for the `week` / manager view

1. **Cost per active developer-day and per month vs published baselines**. Show the team's distribution next to Anthropic's cited figures ($13/active day average, 90% under $30/day, $150 to $250/month), labelled as vendor-published, with the team's own p50/p90.
2. **Spend by repo with baseline-overhead comparison**. Repos whose first-request prefix is multiples of the others point to CLAUDE.md/MCP bloat; this is where one config change pays across every session.
3. **Cache health league table by repo and by developer machine**. Read share and miss dollars by cause; "idle past TTL" and "model switch" totals map to two settings (`promptCacheTtl`, default model policy).
4. **Model mix and subagent routing price delta**. Share of spend on frontier vs mid vs small models, main vs subagent, with the arithmetic delta for read-only subagents on frontier models.
5. **Heavy-tail sessions and cost per merged PR**. Top 5% sessions' share of weekly spend, each linked to its receipt, plus the team's own cost-per-merged-PR trend (own baseline, never an industry benchmark).

## What aireceipts must never claim (summary)

- That a cheaper model, lower effort, shorter context or different TTL would have produced the same outcome.
- Causes of cache misses that the transcript does not show.
- Subscription quota math (weights are unpublished) or negotiated prices (unless the user supplies an override file).
- Industry "cost per PR" benchmarks (none published by vendors).
- Anecdotal savings percentages (RouteLLM, practitioner blogs) as expected savings for this user; they may appear only as cited context in docs, never in a receipt line.

## Source list

Vendor docs
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/prompt-caching
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/monitoring-usage
- https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/
- https://www.anthropic.com/engineering/advanced-tool-use
- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://www.anthropic.com/news/claude-opus-4-5
- https://claude.com/pricing
- https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/pricing
- https://learn.chatgpt.com/docs/pricing
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://ai.google.dev/gemini-api/docs/caching
- https://ai.google.dev/gemini-api/docs/pricing

Research
- https://arxiv.org/html/2604.22750.pdf (How Do AI Agents Spend Your Money?)
- https://arxiv.org/html/2605.09104v1 (Token Economics for LLM Agents)
- https://arxiv.org/abs/2606.01326 (Minification: 42% input reduction, 12-point resolve drop)
- https://www.trychroma.com/research/context-rot
- https://github.com/lm-sys/routellm

Industry reporting and practitioner posts
- https://techcrunch.com/2026/06/02/uber-caps-employee-ai-spending-after-blowing-through-budget-in-four-months/
- https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/
- https://www.forbes.com/sites/jonmarkman/2026/06/01/microsoft-ends-claude-code-licenses-as-it-pushes-copilot-cli/
- https://thenextweb.com/news/microsoft-claude-code-retreat-ai-cost
- https://www.vantage.sh/blog/agentic-coding-costs
- https://codex.danielvaughan.com/2026/06/10/codex-cli-token-consumption-diagnosis-reduction-quota-drain-practitioner-toolkit/
- https://dev.to/kenimo49/your-mcp-server-eats-55000-tokens-before-your-agent-says-a-word-i-measured-the-real-cost-19l8
- https://github.com/getagentseal/codeburn/issues/1380
- https://www.makeuseof.com/claude-codes-grunt-work-to-subagents-reduce-token-billing-usage/
- https://intuitionlabs.ai/articles/claude-max-plan-pricing-usage-limits
