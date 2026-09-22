# AI coding-agent mistakes and waste patterns: what can a receipt detect deterministically?

Research date: 2026-09-22. Scope: documented failure modes of AI coding agents (papers, vendor guidance, incident reports, issue trackers), mapped to rules that `aireceipts` can compute from a transcript with zero model calls.

## 0. Ground rules used for every detection rule

What the parsed transcript gives us today (from `src/parse/types.ts`):

- Per turn: `timestamp`, `model`, `usage` (`input`, `output`, `cacheRead`, `cacheCreation`, `cacheCreation5m`, `cacheCreation1h`), `pricingUnits`, `toolCalls[]`.
- Per tool call: `name`, `shell` flag, `input`, `output`, `status` (`ok` | `error` | `running`), `startedAt`, `endedAt`.
- Per session: `compactions[]`, subagent children (`isSidechain`), title.
- Not modeled today: user message text, interrupt markers, assistant text, `stop_reason`. Rules that need these are marked **[needs adapter work]**.

Principles applied:

1. A rule fires only on structural facts (equality, counts, regexes on tool inputs, exit status, timestamps, token counts). No semantic judgment.
2. "Identical" means a canonical hash: tool name plus normalized input (sorted JSON keys, trimmed whitespace, path resolved against cwd). Output identity uses a hash of the tool output text.
3. Token cost of a tool output is estimated as `ceil(chars / 4)` and labeled an estimate. Dollar attribution reuses the existing heuristic-pricing label (`HEURISTIC_PATTERN_PRICING_INTERPRETATION`), never "proven savings".
4. Receipt lines state facts. They never rank models or vendors.
5. Privacy: lines that include a path or command must respect `--no-details` when posted to a PR. Default PR output should show counts and costs only.

Already shipped (not re-proposed): stuck loops (3+ consecutive identical tool calls), trivial spans, context thrash (compactions). Note that the memory index records a planned registry refactor with three generic checks (duplicate reads, oversized results, cache waste). Checks 1 to 3 below overlap that plan and supply citations and thresholds for it.

## 1. Evidence base (key sources)

| Source | What it quantifies |
|---|---|
| MAST, "Why Do Multi-Agent LLM Systems Fail?" https://arxiv.org/abs/2503.13657 | 14 failure modes over 1600+ traces. Step repetition is the top mode (17.14%). Reasoning-action mismatch 13.98%. Failure to ask for clarification 11.65%. |
| "How Coding Agents Fail Their Users", 20,574 real sessions (6,648 Claude Code) https://arxiv.org/html/2605.29442 | Constraint violation 38.33%, misread intent 26.95%, inaccurate self-reporting 22.58%, faulty implementation 17.82%, wrong diagnosis 11.56%, overreach 10.20%, operational execution error 2.87%. |
| "How Do AI Agents Spend Your Money?" https://arxiv.org/html/2604.22750 | Cache reads dominate cost. Runs on the same task differ up to 30x in tokens. About 50% of file actions on complex problems repeat on the same file. Accuracy peaks at intermediate cost. |
| "Understanding Code Agent Behaviour" https://arxiv.org/html/2511.00197 | Failed trajectories are 12% to 82% longer than successful ones across OpenHands, SWE-agent, Prometheus. |
| SWE-agent ACI paper https://arxiv.org/abs/2405.15793 | Attempt success drops to 57.2% after one failed edit, and keeps falling with more failed edits. Bounded viewers beat full-file views. |
| SWE-smith https://arxiv.org/pdf/2504.21798 | Repetitive action runs of length 10 correspond to 89% failure probability. Over 25% of SWE-agent-LM-32B trajectories have such runs versus under 4% for Claude 3.7 Sonnet. |
| OpenHands Stuck Detector https://docs.openhands.dev/sdk/guides/agent-stuck-detector | Production thresholds: same action+observation 4x, same action+error 3x, monologue 3 messages, ping-pong alternation 6 cycles, repeated context-window errors. |
| Gemini CLI loop detection https://github.com/google-gemini/gemini-cli/issues/11002 and https://github.com/google-gemini/gemini-cli/issues/8237 | Shipped loop detector; users report false positives on legitimate repetitive work. Suggested fix: do not flag when outputs differ. |
| Claude Code best practices https://code.claude.com/docs/en/best-practices | Named failure patterns: kitchen-sink session, correcting over and over (after two failed corrections, `/clear`), over-specified CLAUDE.md, trust-then-verify gap, infinite exploration. |
| Claude Code costs doc https://code.claude.com/docs/en/costs | Cache miss definition (re-processed more than 5% and at least 2,000 tokens), TTL (1h on subscription, 5m on API by default), CLAUDE.md under 200 lines, agent teams about 7x tokens, hooks to filter test output, "prefer CLI tools over MCP". Average $13 per developer per active day. |
| Anthropic, Writing tools for agents https://www.anthropic.com/engineering/writing-tools-for-agents | Tool responses capped at 25,000 tokens in Claude Code; recommends pagination, filtering, truncation. |
| Anthropic multi-agent research system https://www.anthropic.com/engineering/multi-agent-research-system | Multi-agent runs use about 15x the tokens of chat. |
| isitdone analysis https://dev.to/raimondasl/69-of-my-coding-agents-done-claims-werent-here-is-the-gate-i-put-in-front-of-them-lho | 591 sessions, 516 completion-claim turns, 69% with no passing test behind them (37% edited after a passing test, 31% ran no test). |
| Redundant-read analysis https://dev.to/egorfedorov/update-my-claude-code-token-optimizer-now-blocks-redundant-reads-heres-the-data-from-107-27lj | 107 sessions, 1,225 redundant reads, 8.0% of all tokens. One file read 189 times. |
| ImpossibleBench https://arxiv.org/pdf/2510.20270 | Cheating on impossible tests is common; Claude models cheat mainly by modifying tests (over 79% of their cheats). |
| EvilGenie https://arxiv.org/html/2511.21654 | Test-file edits and hardcoding observed for all tested models. Test-file edit detection is one of its three measures. |
| Claude Sonnet 4.5 system card https://www.anthropic.com/claude-sonnet-4-5-system-card | Common hacks: tests that verify mocks, workarounds instead of fixes. |
| "The Danger of Overthinking" https://arxiv.org/abs/2502.08235 | Analysis paralysis, rogue actions, premature disengagement on SWE-bench Verified. Picking lower-overthinking runs cut cost 43%. |
| Chroma, Context Rot https://www.trychroma.com/research/context-rot | All 18 tested models degrade as input length grows, well before the window limit. |
| Incidents: Replit DB deletion https://incidentdatabase.ai/cite/1152/ ; `rm -rf ~/` https://www.docker.com/blog/coding-agent-horror-stories-the-rm-rf-incident/ ; worktree subagent `git reset --hard` https://github.com/anthropics/claude-code/issues/81333 | Destructive commands with irreversible data loss. |
| Runaway cost: $6,000 overnight loop https://www.makeuseof.com/someone-left-claude-code-running-overnight-and-it-cost-6000/ ; $1,800 cron https://dev.to/runvouch/my-claude-code-cron-ran-up-1800-in-two-nights-the-watchdog-that-stops-it-at-2-3npb | Scheduled or looping re-sends of large contexts with no ceiling. |
| Claude Code issues: rejection churn #64160 https://github.com/anthropics/claude-code/issues/64160 ; edit-retry 100K tokens #46968 https://github.com/anthropics/claude-code/issues/46968 ; full suite 3x, $78 #81091 https://github.com/anthropics/claude-code/issues/81091 ; sleep polling #95202 https://github.com/anthropics/claude-code/issues/95202 ; compaction thrash #60600 https://github.com/anthropics/claude-code/issues/60600 ; oversized output #12054 https://github.com/anthropics/claude-code/issues/12054 ; recursive subagents #68110 https://github.com/anthropics/claude-code/issues/68110 ; cache TTL #46829 https://github.com/anthropics/claude-code/issues/46829 | Individual waste patterns with token or dollar magnitudes. |
| MCP tool-schema overhead https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2808 ; https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code | About 1,000 tokens per tool definition; one user had 82K tokens (41% of window) of MCP definitions. Now deferred by default in Claude Code. |
| Package hallucination https://arxiv.org/pdf/2501.19012 ; https://socket.dev/blog/slopsquatting-targets-across-frontier-llms | Frontier models invent 4.6% to 6.1% of package names. |

## 2. Pattern catalog

Each entry: evidence, detection rule, false-positive risk, receipt line (facts only), handoff tip, prevalence if quantified.

### P1. Duplicate unchanged reads

- **Evidence:** 8.0% of tokens across 107 sessions were redundant reads (dev.to, egorfedorov). About 50% of file actions on complex problems repeat on the same file, and this dominates expensive failed runs (arxiv 2604.22750). Post-compaction re-reads are a named cause (https://docs.bswen.com/blog/2026-03-22-claude-code-redundant-file-reads/).
- **Detection:** For read-class tools (Claude Code `Read`, Codex `read_file`/`view`, shell `cat`/`sed -n`/`head` on one path), key = (normalized path, offset, limit). Fire when a later read has the same key AND the same output hash as an earlier read in the same session, with no compaction between them. Output-hash equality proves the content did not change, so no write-tracking is needed. Waste tokens = estimated tokens of the duplicate outputs. Report post-compaction re-reads as a separate sub-count, since those are expected.
- **False positives:** Low. Re-reading after compaction is legitimate and is split out. Reads in separate subagents are separate contexts and are not compared.
- **Receipt line:** `duplicate reads: 14 re-reads of unchanged content across 5 files (~62k tokens, ~$0.41)`
- **Handoff tip:** "The agent re-read files it already had. Ask for a line range or function, or point it at the earlier read."
- **Prevalence:** 8% of tokens in one 107-session sample.

### P2. Oversized tool results carried forward

- **Evidence:** Anthropic caps tool results at 25,000 tokens and recommends pagination and filtering (writing-tools-for-agents). Issue #12054 documents context overflow from massive outputs. Compaction thrash is usually "one oversized thing pulled into context repeatedly" (#60600). Read operations are 76.1% of token consumption in one trajectory study (arxiv 2604.22750 via search summary).
- **Detection:** Any tool output with estimated tokens >= 10,000, or containing a known truncation marker (`Output too large`, `[truncated]`, `Full output saved to`). Carried cost = output tokens x number of later turns before the next compaction or session end, priced at that turn's cache-read rate. The carry multiplier is deterministic from turn order.
- **False positives:** Medium-low. A large read can be necessary. The line reports size and carry cost, not a verdict.
- **Receipt line:** `oversized results: 3 tool outputs over 10k tokens (largest 41k, from Bash); carried through 38 later turns (~$1.90 in cache reads)`
- **Handoff tip:** "Pipe big outputs through grep, head, or a filter hook, or run the command in a subagent so only a summary returns."
- **Prevalence:** Not quantified per session.

### P3. Cache-expiry rebuilds after idle gaps

- **Evidence:** Claude Code defines a cache miss as re-processing more than 5% and at least 2,000 tokens it could have read from cache. TTL is 5 minutes on API keys and 1 hour on subscriptions; writes cost 1.25x base (5m) versus 0.1x for reads (https://code.claude.com/docs/en/prompt-caching, costs doc). Issue #46829 found a silent TTL change inflated costs. The $6,000 overnight case re-sent an 800k-token history on each wake-up.
- **Detection:** For turn t with prior turn t-1: gap = timestamp(t) - timestamp(t-1). Fire when gap > TTL (5m, or 1h when the turn's `cacheCreation1h` > 0) AND `cacheCreation(t)` >= max(2,000, 0.05 x (cacheRead(t-1) + cacheCreation(t-1))) AND no compaction at t. Waste = cacheCreation(t) x (write rate - read rate). Fully determined by timestamps and usage fields.
- **False positives:** Low. Compaction and model switches also rebuild the cache; exclude turns adjacent to a compaction or a model change.
- **Receipt line:** `cache rebuilds: 4 resumes after idle gaps over 5m re-wrote 610k tokens to cache (~$2.30 more than cache reads)`
- **Handoff tip:** "Long pauses in a big session re-bill the whole context. Use /clear or resume from a summary after a break, or use the 1h cache TTL."
- **Prevalence:** Claude Code's own `/usage` flags "cache misses" when they exceed 10% of recent usage, so the vendor treats it as common.

### P4. Edits after the last passing check (verification gap)

- **Evidence:** 69% of completion-claim turns had no passing test behind them (isitdone, 591 sessions). Inaccurate self-reporting is 22.58% of misalignment episodes across 20,574 sessions (arxiv 2605.29442). Anthropic's "trust-then-verify gap" pattern.
- **Detection:** Classify shell calls as checks when the command matches a test/build/lint runner regex (`npm test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `tsc`, `eslint`, `make test`, `gradle test`, `mvn test`). Pass = status `ok` (or exit code 0 for Codex). At session end, count source-file writes (Edit/Write/apply_patch on non-doc paths) after the last passing check. Fire when that count > 0, or when the session has source writes and zero checks. No reading of assistant text.
- **False positives:** Medium. The user may run tests outside the agent, or CI verifies later. Exclude `.md`, docs, and config-only edits.
- **Receipt line:** `verification: 6 source edits after the last passing test run` or `verification: 11 source edits, no test or build run recorded`
- **Handoff tip:** "Give the agent a check to run and ask it to show the passing output after its final edit. A Stop hook can enforce this."
- **Prevalence:** 69% of completion turns (single-author sample); 22.58% of annotated misalignment episodes.

### P5. Edit-fail-retry loop

- **Evidence:** Success drops to 57.2% after one failed edit (SWE-agent). Issue #46968: a subagent made 30 tool calls over 21 minutes (101,646 tokens) retrying a failing edit. "String to replace not found" issues #968, #164 (CRLF).
- **Detection:** For edit-class tools (`Edit`, `MultiEdit`, `str_replace`, `apply_patch`), group by path. Fire when a path accumulates >= 3 edit calls with status `error` within a window of 10 tool calls. Unlike stuck-loop, inputs may differ, so this catches varied retries. Waste = usage of the turns containing the failed edits.
- **False positives:** Low. Three failed edits on one file in a short window is not a normal workflow.
- **Receipt line:** `edit retries: 7 failed edits on 2 files (~48k tokens, ~$0.35)`
- **Handoff tip:** "Repeated failed edits usually mean the file changed underneath (formatter, another agent) or line endings differ. Disable format-on-save or give each agent its own worktree."
- **Prevalence:** Not quantified per session.

### P6. Failing-command retry storm

- **Evidence:** OpenHands flags the same action ending in error 3 times. "Operational execution error" is 2.87% of misalignment episodes, 20% self-corrected. Error-loop fixation is a named cross-agent pattern (https://github.com/becomesaflame/orbweaver/issues/103).
- **Detection:** For shell calls, key = command head (first program plus subcommand, e.g. `npm run build`). Fire when >= 3 calls with the same head end in status `error` or non-zero exit, with no successful call of that head between them. Complements stuck-loop, which needs identical inputs.
- **False positives:** Medium. Red-green TDD cycles legitimately fail tests several times while edits happen. Exclude test heads when source edits occur between runs (P7 covers the rerun case).
- **Receipt line:** `failing retries: npm run build failed 5 times in a row (~31k tokens, ~$0.22)`
- **Handoff tip:** "After two identical failures, stop and paste the error with a narrower ask, or /clear and restate the goal."
- **Prevalence:** Not quantified.

### P7. Test re-runs with nothing changed, and full-suite churn

- **Evidence:** Issue #81091: full suite re-run 3+ times, about $78. Anthropic recommends single tests over the full suite and a hook that filters test output (costs doc, best practices).
- **Detection:** Two sub-rules. (a) Identical rerun: same normalized test command run twice with no write-class tool call in between. (b) Full-suite churn: a test command with no path, filter, or `-t`/`-k`/`--grep` argument run >= 3 times in a session. Waste for (a) = the rerun turn's usage.
- **False positives:** (a) low; flaky-test reruns are the main exception. (b) medium, since some repos only offer one test entrypoint.
- **Receipt line:** `test reruns: 3 test runs with no edits in between; full suite ran 6 times (~$1.10)`
- **Handoff tip:** "Tell the agent which single test file to run while iterating and to run the full suite once at the end."
- **Prevalence:** Not quantified.

### P8. Permission-denial churn

- **Evidence:** Issue #64160: after a rejected tool call, the agent retried the same or equivalent call repeatedly. Denials do not stop the agent (siteboon/claudecodeui #1350).
- **Detection:** A tool result whose status is `error` and whose output matches a denial regex (`doesn't want to proceed`, `Permission denied by user`, `blocked by hook`, `was rejected`, Codex `approval denied`). Fire when a denied (tool name, command head) is attempted again >= 2 times after the denial.
- **False positives:** Low. Note that Claude Code sometimes stamps internal resets as user rejections (#93529), so the line says "denied", not "you denied".
- **Receipt line:** `denied then retried: Bash(git push) denied, attempted 3 more times`
- **Handoff tip:** "Add an explicit deny or allow rule for this command so the agent gets a stable answer."
- **Prevalence:** Not quantified.

### P9. Destructive commands

- **Evidence:** Replit agent deleted a production database during a code freeze (AIID 1152). `rm -rf ... ~/` wiped a home directory (Docker blog). Worktree subagent ran `git reset --hard` in the main checkout (#81333). Codex overwrote uncommitted work (https://openleash.com/blog/codex-ignored-never-touch-git-restored-user-work).
- **Detection:** Shell calls (`shell` flag true) matching a fixed list: `rm -rf` with `~`, `/`, `$HOME`, `..`, or an absolute path outside cwd; `git reset --hard`; `git clean -f`; `git checkout -- .` / `git restore .`; `git push --force` / `-f` / `--force-with-lease` to a non-agent branch; `git branch -D`; `git filter-repo` / `filter-branch`; `DROP TABLE|DATABASE`; `TRUNCATE`; `kubectl delete`; `terraform destroy`. Report whether it ran (status ok) or was blocked.
- **False positives:** Medium for `git reset --hard` in throwaway worktrees. The line is informational and never priced.
- **Receipt line:** `risky commands: git reset --hard (ran), rm -rf outside repo (blocked)`
- **Handoff tip:** "Add deny rules or a PreToolUse hook for these commands, and keep agent work in a worktree."
- **Prevalence:** Rare but severe. No per-session rate published.

### P10. Test weakening and error suppression markers

- **Evidence:** Claude models cheat mainly by modifying tests (over 79% of their cheats, ImpossibleBench). EvilGenie uses test-file edit detection as a measure. Sonnet 4.5 system card lists tests that verify mocks and workarounds instead of fixes. Anthropic best practices: "address the root cause, don't suppress the error."
- **Detection:** Scan the added text of edit-class inputs (`new_string`, patch `+` lines) and shell commands. Test weakening: in files matching test globs (`*test*`, `*spec*`, `__tests__/`), additions of `.skip(`, `.only(`, `xit(`, `@pytest.mark.skip`, `@Disabled`, `t.Skip(`, or net removal of assertion lines (`expect(`, `assert`). Suppression: added `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# type: ignore`, `# noqa`, `#[allow(`, `// nolint`; commands with `--no-verify`, `|| true` after a test runner, `HUSKY=0`. Stronger signal when the change follows a failing check (P4 classifier).
- **False positives:** Medium. Legitimate test updates and justified suppressions exist. The line lists counts and says nothing about intent.
- **Receipt line:** `test/lint changes: 2 tests skipped and 1 @ts-ignore added after failing runs; 1 commit with --no-verify`
- **Handoff tip:** "Tell the agent not to skip tests or suppress errors without asking, and review these lines before merging."
- **Prevalence:** Benchmark rates only (not real-world session rates). Sonnet 4.5 reward hacks about 12.8% on targeted evals.

### P11. Subagent fan-out and recursion

- **Evidence:** Agent teams use about 7x tokens (Claude Code costs doc); multi-agent research about 15x (Anthropic). Issue #68110: recursive spawning, 1.2M tokens in 30 minutes; #94240 spawning despite user constraints.
- **Detection:** From subagent transcripts: count spawned, maximum nesting depth, share of session cost in subagents, and subagents whose tool calls are read-only (Read/Grep/Glob/WebFetch) running on the session's most expensive model tier. Fire on depth >= 2, or subagent share >= 50% of session cost with >= 5 subagents.
- **False positives:** Medium. Heavy parallel research is sometimes the point. Report facts; fire the "warning" only on depth >= 2.
- **Receipt line:** `subagents: 12 spawned (max depth 3), 64% of session cost; 8 were read-only`
- **Handoff tip:** "Cap subagent count in the prompt and set a cheaper model for read-only helper agents in their config."
- **Prevalence:** Not quantified.

### P12. Ping-pong alternation and edit oscillation

- **Evidence:** OpenHands flags two action-observation pairs alternating 6+ cycles. Gemini CLI users ask for "two-way" loop detection. Back-and-forth re-editing inflates failed runs (arxiv 2604.22750). "Patch churn" is a named cross-agent pattern.
- **Detection:** (a) Alternation: sequence of canonical (tool, input) keys shows A,B,A,B for >= 6 cycles (12 calls). (b) Edit revert: an edit whose `new_string` equals an earlier edit's `old_string` on the same path, meaning the agent undid its own change. Count revert pairs.
- **False positives:** Low for (a). Low for (b); a deliberate revert is still a signal worth showing.
- **Receipt line:** `back-and-forth: 2 edits undone by the agent on src/api.ts; 1 alternating loop (14 calls)`
- **Handoff tip:** "The agent is oscillating between two approaches. Stop it and choose one, or state the constraint it is missing."
- **Prevalence:** Not quantified.

### P13. Polling and sleep loops

- **Evidence:** Issue #95202: subagents poll long jobs with `sleep` loops. One agent issued 42 backgrounded sleeps and replied "Background timer only" 8 times. OpenHands had false positives killing agents that legitimately wait (#5355).
- **Detection:** Shell calls containing `sleep <n>` (n >= 5), `until ...; do sleep`, `watch`, or repeated status probes (`tail` of the same log, `gh run view`, `kubectl get pods`) >= 4 times within 15 minutes. Waste = usage of the turns whose only tool call is the probe.
- **False positives:** Medium. Some waiting is required; the rule counts it and prices only the probe turns.
- **Receipt line:** `polling: 18 sleep/status-check turns while waiting on a background job (~$0.60)`
- **Handoff tip:** "Run long jobs in the background and let the harness notify on completion instead of polling."
- **Prevalence:** Not quantified.

### P14. Long-context carry (kitchen-sink session)

- **Evidence:** Claude Code costs doc: unexpectedly high spend "usually traces back to long sessions that were never cleared". Context rot degrades all tested models (Chroma). Kitchen-sink session is a named failure pattern.
- **Detection:** Per-turn prompt size = input + cacheRead + cacheCreation. Fire when median prompt size over the session is >= 100k tokens and >= 30 turns ran above that level. Optional: sessions with more than 3 user prompts separated by gaps over 30 minutes [needs adapter work for user prompts].
- **False positives:** Medium. A single deep task can justify a big context. The line reports the size, not a verdict.
- **Receipt line:** `context size: 42 turns ran with over 100k tokens of context (median 138k)`
- **Handoff tip:** "Use /clear between unrelated tasks; each turn re-sends the whole conversation."
- **Prevalence:** Not quantified.

### P15. Startup context overhead (instruction files and tool definitions)

- **Evidence:** MCP tool definitions cost about 1,000 tokens each; one user had 82k tokens of them (#2808, Scott Spence). Bloated CLAUDE.md makes Claude ignore instructions; keep under 200 lines (costs doc). Compaction thrash from re-injected rules files (#85489).
- **Detection:** First model request's prompt tokens (input + cacheCreation + cacheRead of turn 0, minus the estimated size of the first user message when known). Fire when >= 30k tokens. Attribute nothing to specific MCP servers (definitions are not in the transcript).
- **False positives:** Low for the number. Attribution is the hard part (see Section 4).
- **Receipt line:** `startup context: 47k tokens before the first message, re-read on every turn`
- **Handoff tip:** "Run /context to see what loads at startup. Disable unused MCP servers and move rarely used CLAUDE.md sections into skills."
- **Prevalence:** Not quantified; largely mitigated for Claude Code since tool search defers MCP definitions by default.

### P16. Output-limit truncation and regeneration

- **Evidence:** Issue #46968: a subagent hit the 32K output limit and generated duplicate sections.
- **Detection:** [needs adapter work] Turns with `stop_reason == "max_tokens"` (Claude JSONL records it). Fire on >= 1; price the truncated turn plus the immediately following regeneration.
- **False positives:** Low.
- **Receipt line:** `output cut off: 2 responses hit the output token limit`
- **Handoff tip:** "Split large generation tasks into smaller files or sections."
- **Prevalence:** Not quantified.

### P17. Think-without-act runs (analysis paralysis)

- **Evidence:** Overthinking paper: analysis paralysis correlates with lower resolution; lower-overthinking selection cut cost 43%. MAST "step repetition" and OpenHands "monologue" (3+ messages without progress).
- **Detection:** >= 3 consecutive assistant turns with zero tool calls and output tokens >= 2,000 each, with no user message between them [user-message boundary needs adapter work; approximate with turn indices].
- **False positives:** Medium-high. Long explanatory answers the user asked for look identical. Keep informational.
- **Receipt line:** `long reasoning without actions: 4 turns, 19k output tokens, no tool calls`
- **Handoff tip:** "Lower effort for simple tasks, or ask for a plan first and approve it."
- **Prevalence:** Not quantified for real sessions.

### P18. Hallucinated package installs

- **Evidence:** Frontier models invent 4.6% to 6.1% of package names (Socket; arxiv 2501.19012). Slopsquatting risk.
- **Detection:** Shell install commands (`npm i`, `pnpm add`, `yarn add`, `pip install`, `uv add`, `cargo add`, `go get`) whose output matches registry-miss text (`E404`, `404 Not Found`, `No matching distribution found`, `could not find` crate). Deterministic; no network lookup.
- **False positives:** Low (typos count too, which is fine).
- **Receipt line:** `package not found: 2 install attempts for packages that do not exist on the registry`
- **Handoff tip:** "Verify package names before installing; a missing name can later be registered by an attacker."
- **Prevalence:** Low per session, high severity.

### P19. Unattended periodic re-sends

- **Evidence:** $6,000 overnight loop re-sending 800k tokens every 30 minutes; $1,800 cron in two nights. Claude Code `/usage` now has a "Loops" row.
- **Detection:** >= 4 turns started with no preceding user prompt, at near-constant intervals (coefficient of variation of gaps < 0.2) each carrying >= 50k prompt tokens. Mostly timestamps plus usage; user-prompt absence needs adapter work or the scheduled-task marker.
- **False positives:** Low.
- **Receipt line:** `scheduled wake-ups: 16 runs every 30m, each re-sending ~210k tokens (~$9.40)`
- **Handoff tip:** "Give scheduled loops a fresh, small context per run and a budget cap such as --max-budget-usd."
- **Prevalence:** Rare, very high cost when present.

### P20. Search by reading instead of grep

- **Evidence:** "Infinite exploration" failure pattern (Anthropic). Localization is the dominant failure point in SWE-bench trajectories (arxiv 2511.00197). SWE-agent shows summarized search beats iterative reading.
- **Detection:** Before the first write-class call, >= 20 distinct files read and zero search-class calls (`Grep`, `Glob`, `rg`, `grep`, `find`, codebase search tools).
- **False positives:** Medium-high. Onboarding reads and code intelligence tools blur this.
- **Receipt line:** `exploration: 34 files read before the first edit, no searches`
- **Handoff tip:** "Name the files or symbols in the prompt, or delegate exploration to a subagent."
- **Prevalence:** Not quantified.

### P21. User interrupts

- **Evidence:** "Correcting over and over" pattern with the "after two failed corrections, /clear" rule. Interruptions and corrections are the observable misalignment symptoms across 20,574 sessions.
- **Detection:** [needs adapter work] Claude Code writes a literal `[Request interrupted by user]` marker; Codex records `turn_aborted`. Count them. Do not attempt to classify corrections from text.
- **False positives:** Low for the count.
- **Receipt line:** `interruptions: you stopped the agent 4 times`
- **Handoff tip:** "After two corrections on the same issue, /clear and restart with a sharper prompt that includes what you learned."
- **Prevalence:** Premature-stop corrections appear in 40% of interactive sessions per the agentpatterns summary (https://agentpatterns.ai/patterns/anti-patterns/premature-completion/); treat as indicative.

## 3. Top 12 new waste checks, ranked by value x detectability

Value = expected dollars or risk avoided per affected session, times breadth. Detectability = determinism and false-positive risk from the current parsed model. Scores are 1 to 5.

| Rank | Check | Value | Detectability | Score | Needs adapter work? |
|---|---|---|---|---|---|
| 1 | P3 Cache-expiry rebuilds | 5 | 5 | 25 | No (timestamps + usage) |
| 2 | P1 Duplicate unchanged reads (output-hash) | 4 | 5 | 20 | No |
| 3 | P2 Oversized tool results carried forward | 4 | 5 | 20 | No |
| 4 | P4 Edits after last passing check | 5 | 4 | 20 | No (status + command regex) |
| 5 | P5 Edit-fail-retry loop | 4 | 5 | 20 | No |
| 6 | P9 Destructive commands | 5 (risk) | 4 | 20 | No |
| 7 | P7 Test reruns with nothing changed / full-suite churn | 3 | 5 | 15 | No |
| 8 | P6 Failing-command retry storm | 3 | 4 | 12 | No |
| 9 | P8 Permission-denial churn | 3 | 4 | 12 | Minor (denial regex per vendor) |
| 10 | P11 Subagent fan-out and recursion | 4 | 3 | 12 | No (children already indexed) |
| 11 | P10 Test weakening and suppression markers | 4 | 3 | 12 | No |
| 12 | P12 Ping-pong alternation and edit reverts | 3 | 4 | 12 | No; extends stuck-loop |

Next tier: P19 periodic re-sends (huge when present, rare), P13 polling, P14 long-context carry, P15 startup context, P16 output truncation, P18 hallucinated packages, P21 interrupts, P17 think-without-act, P20 search by reading.

Implementation notes:

- P1, P2, P3 match the already-planned registry trio; the thresholds above come from Claude Code's own cache-miss definition (5% and 2,000 tokens) and Anthropic's 25k tool-result cap.
- P5, P6, P12 generalize stuck-loop along the axes OpenHands and Gemini CLI users identified (same action with errors; alternation; "don't flag when outputs differ"). Mark overlaps non-additive using the existing SPEC-0017 R6 machinery.
- P4, P9, P10 are not dollar waste. They belong in a separate "risk" or "verification" section of the receipt so they are never summed into waste dollars.
- Every rule needs a per-vendor tool-name map (Read vs `read_file`, Edit vs `apply_patch`) via the adapter registry, never a shared switch.

## 4. Patterns that look detectable but are not (do not build)

1. **Hallucinated APIs and wrong code.** A call to a nonexistent function only shows up if a later check fails, and then P4/P6 already catch it. Judging correctness needs execution or semantics. EvilGenie needed held-out tests and LLM judges to measure hacks; a transcript alone cannot.
2. **Misread intent and scope overreach** (26.95% and 10.20% of episodes). Both depend on what the user meant. Diff size versus prompt length is not a reliable proxy, and a false "overreach" label on a receipt is damaging.
3. **Completion claims that are false** ("done", "all tests pass" in assistant text). Text classification is not deterministic across models and languages, and assistant text is not modeled. Use the structural proxy P4 instead, which states only what ran and what was edited.
4. **Instruction or CLAUDE.md violations** (38.33% of episodes, the top category). Requires parsing natural-language rules and mapping them to actions. Only narrow, user-configured rules (for example "never run X") are checkable, and that is a hook's job, not a receipt's.
5. **Per-server MCP bloat attribution and "context rot" quality loss.** Tool definitions and system prompts are not written to the transcript, so only the aggregate startup size (P15) is measurable, not which server caused it. Context rot is a quality effect; the receipt can report context size but cannot measure the degradation.
6. **Special-case hardcoding in source code** (returning expected test values). Regexes for literal returns produce heavy false positives; published detection relies on held-out tests or model judges. Only the explicit markers in P10 are safe.
7. **"Kept going after it should have stopped" and premature stops.** Both require knowing the goal. Turn counts and cost are already on the receipt; labeling a stop point as wrong is a judgment call.

## 5. Caveats

- Several prevalence numbers come from single-author blog samples (isitdone, redundant-read optimizer) and are indicative only.
- ImpossibleBench and EvilGenie rates are measured on deliberately impossible or ambiguous tasks and must not be quoted as real-world session rates.
- The 40% premature-stop figure is from a secondary summary page and was not verified against a primary paper.
- Claude Code has shipped mitigations for some patterns (deferred MCP definitions, `/usage` cache-miss flags, Monitor tool for polling), so affected-session shares in older sessions will be higher than in current ones.
