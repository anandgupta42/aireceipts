# aireceipts improvement plan (2026-09-22, rev 2)

Revision 2 applies the 21 findings of the Codex review. Short names for the sources: **deep-dive** (`2026-09-22-appinsights-deep-dive.md`), **mistakes** (`...-research-agent-failure-modes.md`), **levers** (`...-research-cost-levers.md`) and **telemetry** (`...-research-telemetry-program.md`) are in this folder. **landscape** (a survey of what other tools surface) and **parallel** (an independent deep-research report) name third-party products, so they are kept out of the public repo, in the maintainer's research vault under `Research/aireceipts-improvement-plan-2026-09/`.

**SPEC inventory.** 0085 is the next unused id locally.

- `specs/` and the cached `origin/main` end at 0081.
- 0082, 0083 and `review-patterns.json` are on `origin/feat/m5-opencode-discovery` and in the `aireceipts-handoff-coverage` worktree.
- 0084 is the draft in the `fix_onboarding` worktree.
- At 2026-09-22T20:22Z, `gh` showed PR #254 `OPEN` and `CONFLICTING`, last updated 2026-07-13. No open PR was titled SPEC-008x.
- Reviewer note: the reviewer's sandbox could not reach `gh`, but this session could. **Verify live before presenting.**

This plan numbers only 0085 to 0088. Everything else is an amendment to an existing spec or an unnumbered backlog item.

## 1. Executive summary

1. **Raise retention from 90 to 180 days first.** The purge starts about 2026-09-30, and nothing else here blocks it.
2. **Decide the cheaper-model policy (decision 0) before merging the price PR.** The PR is commit 4fe98fd: 31 new ids (13 Anthropic, 10 OpenAI, 8 Google), drift down from 19 to 0.
3. **Ship a one-PR SPEC-0043 amendment before v0.12.0.** It adds `cliVersion` and `installHash` to `receipt_generated`. Without it, the release's coverage effect cannot be measured.
4. **Cut v0.12.0 through the full release checklist,** then the maintainer publishes.
5. **Ship a defensive install-id fix now; investigate the root cause separately.** Success is measured by identity preservation, not "zero churn."
6. **Disclose ingestion geo in `docs/telemetry.md` now.**
7. **Merge PR #254 only after its telemetry passes I4.** Its raw `findingCount` must become a bucket first. New checks depend on the registry in #254.
8. **SPEC-0085:** telemetry hygiene v2, with statusline dedupe, three separate datasets and the dead fields wired.
9. **SPEC-0086:** cited model aliases plus a named unpriced-model line. It never prices an unknown model from a sibling (I2).
10. **SPEC-0087 (cache facts) and SPEC-0088 (context carry):** every dollar carries one SPEC-0083 impact role, and unlike roles are never summed.
11. **Verification, risky-command and retry ideas become SPEC-0083 registry amendments,** entered in `shadow` state.
12. **Attach failure is unproven.** A manual org-repo check this week decides whether it is a bug.

## 2. Where the evidence points

| # | Observation | Number | Source | Status |
|---|---|---|---|---|
| 1 | Receipts with tool calls and zero priced rows rose | 23/522 Jul, 56/136 Aug, 58/104 Sep | deep-dive section 8 | observed |
| 1a | Cause: tables missing new models, or installs on old versions | cannot be split, because `receipt_generated` lacks `cliVersion` | deep-dive section 8 | **hypotheses** |
| 2 | No release since 2026-07-13; one retained hook install runs 0.8.0 | 70 installs on 0.11.0 | deep-dive section 3 | observed |
| 3 | New organic installs | 36 in Jul 5 to 18, 7 in the 9 weeks since | deep-dive section 2 | observed |
| 4 | Installs active 7+ days all use statusline or hook | week+1 retention 1/19 and 3/17 | deep-dive exec 5 | observed; the causal link is a **hypothesis** |
| 5 | Statusline rows are emitted twice per poll | 413,607 plus 413,602 | deep-dive section 13 | observed |
| 6 | Dead signals | `agentType` unknown on 100%; `parse_failure` has no caller; hook paths are suppressed | deep-dive section 14 | observed |
| 7 | 0 `pr --post` rows since 2026-07-19 | 0 rows | deep-dive section 10 | observed; attach failure **unproven** |
| 8 | Cache reads are the largest cost category in agent sessions | literature | levers section 0 | external evidence |

## 3. Workstreams

### A. Price freshness and model coverage

- **Price PR.** Commit 4fe98fd in this worktree does four things. The rolling-issue workflow in it is implemented and merges with the PR.
  - Adds 31 ids.
  - Removes the cancelled Sonnet 5 rise.
  - Applies the GPT-5.6 cuts.
  - Closes DeepSeek's flat rows on 2026-08-15.
- **Golden change.** Six Codex goldens change in the two lines that use `cheapestCurrentRow`: the "same tokens on" comparison and the trivial-spans `≈` estimate. The lowest current input rate is now `gpt-6-luna`, not `gpt-5.4-mini`.
- **Deferred rows.** `gpt-5.4-nano`, `gpt-5-mini` and `gpt-5-nano` wait on decision 0.
- **Discovery triage.** The first commit (4fe98fd) counted 94 by hiding dated snapshots, provider-prefixed aliases and anything with a `deprecation_date`. The review commit (498f90e) stops hiding: it counts 140 as of 2026-09-22T20:25Z, 133 new ids plus 7 dated snapshots of priced models, lists 35 retired ids without counting them, and excludes only `ft:` fine-tune rows and non-text modes (image, audio, embedding, realtime, moderation, ocr). Most of the 133 are legacy OpenAI chat ids (gpt-3.5, gpt-4, gpt-4o families) and Gemini previews. The `update-prices` loop owns triage, and the maintainer approves via button 2. Each discovery ends up supported with a cited row, omitted with a reason, or irrelevant.
- **SPEC-0086.**
  - A cited `aliases` array per model row. An alias resolves only when a vendor page lists that id as the same model at the same price.
  - No suffix stripping. Provider-prefixed Bedrock and Vertex ids stay unresolved.
  - A cross-vendor alias uniqueness test.
  - An unpriced-model line: `model <id> not in bundled price tables (2026-09-22); tokens only`. It is computed from the session date and the table date only (I1, I5).
  - It splits **coverage eligibility** (the row prices the session) from **comparison eligibility** (the row may be the cheaper-model candidate), per decision 0.
- **Policy.** Cut a price-only patch release within 7 days of any merged price PR.
- **Acceptance:**
  - 0 untriaged discoveries.
  - Every model id in the maintainer's 30-day corpus resolves or is `omitted` with a reason.
  - After release, the `none` share on v0.12.0 receipts with tool calls is under 10%. This is measured only once at least 100 such receipts from at least 10 distinct non-maintainer installs exist. Until then the result is "insufficient sample."
  - Upgrade exposure is reported alongside: the share of receipts on v0.12.0. This separates hypothesis 1a's two causes.
- **Invariants:** I2 and I3 hold, because aliases are cited and there is no fallback. I5 holds, because the goldens are reviewed.
- **Telemetry:**
  - `receipt_generated.cliVersion` and `installHash`, through the SPEC-0043 amendment.
  - `unpricedModelFamily`, a vendor enum.
  - `priceTableAgeBucket`.
- **Effort:** S for the PR and release, M for SPEC-0086.

### B. Telemetry hygiene (SPEC-0085, amends SPEC-0043)

| Change | Vehicle | Effort |
|---|---|---|
| Retention to 180 days; a 1 GB/day cap with an alert | Azure, maintainer, now | S |
| `receipt_generated` gets `cliVersion` and `installHash` | one-PR SPEC-0043 amendment; a v0.12.0 prerequisite | S |
| **Defensive identity fix.** If JSON parses but counters or `schemaVersion` fail validation, keep a valid `installId`. Malformed JSON cannot yield the old UUID, so move the file aside, mint a new id, and record `installIdSource` (`existing|new|recovered_after_corrupt`). Needs fixtures for bad JSON, bad counters, and two concurrent writers. | one PR (`fix-issue`) | S |
| **Root cause.** Find which writer produces the shape the parser rejects: a dev build, tests using the real HOME, or a truncated write. | investigation | S to M |
| Geo disclosure now; blanking via the `ai.location.ip` override is decision 4 | docs PR, then SPEC-0085 | S |
| Emit `integration_surface_rendered` only when its state changes | SPEC-0085 | S |
| Hourly statusline activity heartbeat. Counters live in `state.json` across poll processes. A completed hour flushes on the next hour's first poll, so a final hour with no later poll is never sent, which is documented. No latency statistics. | SPEC-0085 | S to M |
| `cli_run.agentType`; `recordParseFailure` called from each adapter | SPEC-0084 R1c; SPEC-0085 | S |
| `pr_attach_completed` (`trigger=pre_push|ci`, bounded `result`) with no repo or org identity. Amends the hook-suppression contract at `src/cli/index.ts`. | SPEC-0085 | S |
| `pricedRowCoverage=n/a` for zero-tool receipts; no sends from `0.0.0` or git-checkout builds; a `record*` and docs parity test | SPEC-0085 | S |

**Datasets.** Each dataset is defined separately. Churn is evaluated on raw data before any exclusion.

- **Adoption:** excludes `isCI`, the maintainer hashes, the 2026-07-11 matrix sweep, and hashes whose first event is `unavailable`.
  - Human WAU and hook WAU (`invokedBy`) are separate series.
  - Statusline-only activity has its own retention series.
  - Activation is the first successful `receipt_generated` with tool calls.
  - Power install is 5 or more active days in a trailing 28.
  - Retention is the HEART week-over-week cohort grid.
- **Reliability:** all non-CI rows, maintainer included. It covers exit classes, `parse_failure` and statusline success.
- **CI:** `isCI=true` rows only. It covers `pr-check` and the CI half of `pr_attach_completed`.
- Every event any metric needs carries `installHash`, `cliVersion` and `isCI`: `receipt_generated`, `activation_milestone`, `hook_configured` and `pr_attach_completed`.

- **Acceptance:**
  - Statusline rows per active install fall by 95% or more.
  - In new versions, `installIdSource=existing` exceeds 99% of runs, and the `recovered_after_corrupt` rate is reported.
  - A test proves `parse_failure` has a caller.
  - The parity test is green.
- **Invariants:** I4 holds, because all fields are bounded enums. `--telemetry-show` prints the new payloads, and the kill switches still win.

### C. New facts and checks (SPEC-0087, SPEC-0088, SPEC-0083 amendments)

**Preconditions:**

- PR #254 lands only after its R13 `findingCount` becomes a zero-inclusive bucket (`0|1|2-3|4-10|>10`), its disclosure is updated, leakage tests are added, it is rebased, and `review-pr` passes.
- If those do not pass, C waits. This work is not scheduled for a single week.

**Integration.** Warnings extend the SPEC-0083 registry:

- new entries start in `shadow` (R7)
- the one canonical `recommendation` string (R3) feeds the slip mapping in `handoff.ts`, with no second wording table
- impact uses R10 roles

**Promotion gates** (R7):

- a frozen-corpus audit with at least 20 positives per supported source family and at least 30 adversarial boundary negatives
- zero predicate mismatches
- at most 10% materially inapplicable recommendations
- at least 300 evaluated field rows, recorded as a separate unavailable-rate per family

Descriptive metrics such as cache share are receipt facts, not warnings. They are golden-gated, not registry-promoted.

**Dollar roles** (R10): *observed-attributed* allocates real spend, *observed-window* is real spend in a window with no avoidability claim, *same-token-reprice* is cited arithmetic on the same tokens, and *none* prints no dollar. Estimated tokens (chars/4) always carry `≈`. Overlapping findings are resolved by registry supersession before any subtotal. Unlike roles are never summed, and no number is labeled saved or avoidable.

| # | Item | Predicate (unknown states in brackets) | Role | Vehicle |
|---|---|---|---|---|
| 1 | Cache write after idle gap | Claude Code only. Codex only where `cache_write_input_tokens` exists; otherwise, and for Gemini: unavailable. For consecutive main-chain requests on one model, readable = prior request's input + cacheRead + cacheCreation + output, and missed = max(0, readable minus cacheRead). The rule fires when missed ≥ max(2,000, 5% of readable) and the gap exceeds the TTL. The TTL is 1h if only `cacheCreation1h`>0, 5m if only 5m. [Mixed or no split: TTL unknown. Compaction, model or version change: attributed to that cause, not idle.] Source: levers 1a, mistakes P3. | same-token-reprice: missed x (write rate minus read rate) | 0087 |
| 2 | Cache read share | cacheRead / (input + cacheRead + cacheCreation), per model. [Fields absent: not shown.] Gemini shows read share only. | descriptive, none | 0087 |
| 3 | TTL arithmetic | For 5m sessions: rebuilds after 5 to 60 min gaps against the 1h write premium. Both numbers shown, conditional. | same-token-reprice | 0087 |
| 4 | Large tool result | Estimated output ≥10k tokens (≈). A truncation marker is a separate count that makes no size claim. Carry = estimate x later main-chain requests until compaction, at the read rate. Subagent contexts are separate. | observed-attributed, ≈ | 0088 |
| 5 | Duplicate unchanged read | Read-class tools per vendor map; shell reads only via the SPEC-0083 R4 lexer. Same (path, offset, limit) and output hash, in the same context, with no compaction between. Post-compaction re-reads are a separate count. Extends SPEC-0068 and stays outside waste math. | none (tokens ≈) | 0088 |
| 6 | First-request input | input + cacheRead + cacheCreation of the first main-chain request. This includes the first prompt. Carry = that x (requests minus 1) x read rate, conditional on the prefix persisting and stopping at compaction. [Usage absent: unavailable.] | same-token-reprice, conditional | 0088 |
| 7 | Edit-fail retries | At least 3 edit-class calls (vendor map) on one present path with explicit `error` status within 10 flattened calls; `running` is not failure. Superseded by R6 `repeated-identical-error` when they overlap. | observed-attributed | registry amendment |
| 8 | Last change unchecked | This is the existing R7 `last-change-not-checked` (shadow). Amend it to add lint and config exclusions per mistakes P4. | none | registry amendment |
| 9 | Risky commands | Lexer-parsed shell matches from the mistakes P9 list: `rm -rf` outside cwd, `git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore .`, `git branch -D`, `filter-repo`, `DROP`, `TRUNCATE`, `kubectl delete`, `terraform destroy`, and force push to a branch the session did not create [branch origin unknown: say so]. Outcome is one of `ran` (ok), `failed` (error), `blocked` (denial marker) or `unknown` (running or missing). | none | registry amendment |

**Backlog (unnumbered).** Each idea enters the registry as `shadow` when picked up: retry storms, test reruns with no edits between, denial churn, test-weakening markers, subagent depth, read-class-only subagents (priced against the decision-0 comparison row), edit reverts, model or effort switches, and the marginal cost of the next message. Sources: mistakes P6 to P8 and P10 to P12, levers #5 and #8.

**Not to build** (mistakes section 4; levers "never claim"): hallucinated-API verdicts, intent or overreach judgments, completion-claim scans (which rules out parallel #15), CLAUDE.md-violation checks, per-MCP-server attribution, context-rot claims, hardcoding detection, "should have stopped" calls, and any claim that another model, effort or TTL would have succeeded.

- **Invariants:** I1 holds, because the rules are structural. I2 and I3 hold through the roles and labels. I5 holds through goldens. I6 holds, because there are no rankings. Paths respect `--no-details` on PR surfaces.

### D. Local merged-session subtotal (backlog, unnumbered)

This is a subtotal, not unit economics. There is no per-PR denominator offline.

- **Definition:** a session counts once when at least one commit attributed to it (SPEC-0072, including patch-id recovery) is reachable from the local default-branch ref. The ref SHA and snapshot time are printed.
- **Deduplication:** by session id, with subagents rolled into their parent. A session is assigned to the week of its last turn.
- **Squash merges:** these break ancestry and patch-id matching. Such sessions count as `merge status unknown`, and the unknown count prints beside the subtotal.
- **Other offline slices:** spend by repo and model, cache facts by repo, and the top-5% session share. Per-PR cost, review time and remote reverts need `gh`, so they stay on the explicit `pr` surface. Active time, quota % and DORA keys are out of reach (landscape).

### E. Prevention lines in the handoff block

Each promoted registry entry's canonical `recommendation` must fit the slip's 48-character limit (SPEC-0059 R3):

| Entry | Line | Chars |
|---|---|---|
| cache write after idle gap | `Resume large sessions before the cache expires` | 46 |
| large tool result | `Filter large tool output before it lands` | 40 |
| duplicate read | `Ask for a line range instead of a full re-read` | 46 |
| last change unchecked | `Run the check again after the final edit` | 40 |

- **Settings are optional experiments.** A setting such as `promptCacheTtl=1h` appears only in docs, beside the conditional TTL arithmetic.
- **Model names are observed and priced, not tiered.** Any model mention uses the observed id and a cited price, for example `ran on claude-opus-5-5 ($4/$20 per MTok)`. It never uses tier words.
- **Invariants:** I3 and I6.

### F. Growth and onboarding

1. **Attach check this week, with local evidence.** The two flows are separate:
   - The typed `pr --post` flow has telemetry, and it shows 0 rows since 2026-07-19.
   - The hook flow writes `refs/aireceipts/*` on push, then CI posts. Its telemetry is suppressed.

   In one hooked org clone, push a branch and capture three things: the ref, the CI run log and the comment. Only a missing link in that chain makes this a bug.
2. **SPEC-0084 (button 1).** R1 first, then R2 and R3. The setup and pointer output changes are golden-gated.
3. **Hook version.** The SessionEnd command is the unversioned `npx aireceipts-cli --mini` (`src/hook/settings.ts:8`). The pre-push hook already uses `@latest`. Work proceeds in three steps:
   - First find how npx resolved 0.8.0 for the retained install. A global install and the npx cache are both **hypotheses**.
   - If needed, amend the install-hook contract to a new command string.
   - Keep recognizing the legacy string for idempotency and uninstall. `install-hook` migrates existing entries and `setup` reports them.

   If decision 2 depends on upgrading retained users, do this before v0.12.0.
4. **Empty `mini` receipts.** Suppress a receipt only when every usage field sums to 0 tokens. Sessions with nonzero tokens or cost always render. The deep-dive's 22% counts zero-tool sessions with 0 or 1 turns, which is a different set. This is golden-gated.
5. **Backlog, statusline incremental parse.** Cache key: device, inode, size, mtime, a head and tail 4 KB hash, and the parser version. Required tests prove cached and full parse are equivalent across append, truncation, replacement, equal-size rewrite and parser change. The performance gate is a repeatable local benchmark on 1, 10 and 50 MB fixtures, cold and warm, at p50 and p95. It replaces telemetry latency targets.
6. **Monitored outcomes, not completion gates:** weekly new clean installs, always-on activation per cohort, and `pr_attach_completed` success rate.

## 4. Sequenced roadmap

| Order | Item | Vehicle |
|---|---|---|
| **Now 1** | Retention 180 days, daily cap | Azure |
| Now 2 | Decision 0, then triage and merge the price PR | button 2 |
| Now 3 | SPEC-0043 amendment (`cliVersion`, `installHash`); defensive identity fix; geo docs | one PR each |
| Now 4 | Attach check (F1) and hook-version investigation (F3) | investigation |
| Now 5 | **Release v0.12.0.** Checklist: main CI green; version matches; `/release-manager` `VERDICT: GO` for the exact SHA; `preflight-release.mjs` exits 0; changelog; `/review-docs`; specs flipped; inventory updated; release PR; **maintainer publishes** | agent prepares |
| **Next 6** | PR #254: bucket `findingCount`, rebase, review; merge only if the gates pass | existing PR |
| Next 7 | SPEC-0085 | spec |
| Next 8 | SPEC-0086 | spec |
| Next 9 | SPEC-0084 R1 to R3; hook migration if not earlier; empty-`mini` suppression | spec, one PR each |
| Next 10 | SPEC-0087 | spec, needs #254 |
| **Later 11** | SPEC-0088; registry amendments 7 to 9 | spec, amendments |
| Later 12 | Backlog: statusline parse, merged-session subtotal, next-tier checks | select, then spec |

## 5. Maintainer decisions (recommended option first)

0. **Cheaper-model candidate policy.** (a) Comparison-eligible rows kept as cited data per vendor family; the three deferred OpenAI rows land as coverage-only. (b) Today's rule: lowest current input rate. (c) Cheapest model the session's agent can select, which needs cited per-agent lists.
1. **DeepSeek time-of-day pricing.** (a) Tokens-only, as current policy requires. (b) An off-peak `≥` floor, a **proposed** amendment to the omitted-model policy in the price-table README that is not permitted today. (c) A `time_of_day_tiers` schema plus a cited holiday calendar (L).
2. **v0.12.0 scope.** (a) Price PR, SPEC-0043 amendment and identity fix. (b) Also wait for SPEC-0084 R1.
3. **Statusline telemetry.** (a) Hourly activity heartbeat, with performance gated by the local benchmark. (b) (a) plus a disclosed bucketed share of polls over 2s. (c) 1-in-50 sampling, which undercounts installs (telemetry B0).
4. **Geo.** (a) Disclose now and blank it in SPEC-0085. (b) Disclose only.
5. **Promotion field minimum.** (a) 300 evaluated rows. (b) The R7 corpus audit only.
6. **Vendor spend figures in `week`, such as $13 per active day.** (a) Omit. (b) Cited footnote.
7. **Retention.** (a) 180 days. (b) 90 days plus vault exports.

## 6. Risks and what we will not do

**Risks and mitigations:**

- **#254 may carry I4-violating telemetry.** The bucket precondition blocks the merge until it is fixed.
- **New lines may be noise or wrong.** The R7 audits and shadow state gate them. Low prevalence alone is not treated as noise.
- **Summing roles could imply savings.** R10 and supersession prevent it.
- **Alias mistakes could produce wrong dollars.** Citations and the uniqueness test prevent them.
- **Telemetry changes could read as tracking.** Bounded enums, same-PR disclosure and `--telemetry-show` address this. Heartbeats send less data.

**We will not** price unknown models from siblings, add model calls or product-path network, rank models, agents or developers, claim another setup would have succeeded, publish a cost-per-PR benchmark, do subscription quota math, build new receipt templates (4 uses in 82 days), or switch telemetry vendors (App Insights costs about $0 today, telemetry B4).
