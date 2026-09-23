---
id: SPEC-0094
title: "Telemetry hygiene v2: statusline heartbeat, live dead signals, attach events, dataset definitions"
status: draft
milestone: M6
depends: [SPEC-0002, SPEC-0043, SPEC-0064, SPEC-0073, SPEC-0075]
---

# SPEC-0094: Telemetry hygiene v2 (amends SPEC-0043)

## Purpose

Ninety days of production telemetry (maintainer vault,
`Research/aireceipts-improvement-plan-2026-09/`, "App Insights deep dive", sections 2, 13
and 14) show a stream dominated by noise and missing the signals decisions need.
Statusline polls are 99.6% of billed bytes, and every poll emits two near-identical rows,
a `cli_run` and an `integration_surface_rendered` (413,607 and 413,602 rows). One heavy
statusline install outweighs the rest of the product by 100x in any unweighted count.
`cli_run.agentType` is hard-coded `undefined` (`src/cli/index.ts:43`), so every row says
`unknown`. `recordParseFailure` (`src/telemetry/index.ts:135`) has no caller. The hidden
`hook pre-push` path records nothing (`src/cli/index.ts:22-30`) and `pr-check` is outside
the command enum, so the attach flow behind the org rollout is unmeasurable. Zero-tool
receipts report `pricedRowCoverage=none` (90 of 98), dev builds send to production (16
rows at `cliVersion=0.0.0`, 2 rows of an undocumented `card_generated` event), and
ingestion geo is stored without being needed.

This spec fixes those on the SPEC-0043 rails. It adds no new data class: every new field
is a bounded enum, a boolean, or one of the three identity fields SPEC-0043 already
permits (`cliVersion`, the salted `installHash`, `isCI`). Every change lands with its
`docs/telemetry.md` rows in the same PR, and the kill switches (`AIRECEIPTS_TELEMETRY=off`,
`DO_NOT_TRACK=1`) still win with zero network calls. Research basis: the improvement plan
(`docs/internal/research/2026-09-22-improvement-plan.md`, research worktree) section 3B,
decisions 3(a) and 4(a), and section 6.

Invariants touched: **I1** (telemetry stays out-of-band, bounded at 300ms, fail-safe;
nothing under `src/parse/**`, `src/pricing/**` or `src/receipt/**` imports
`src/telemetry/**`), **I4** (content-free, disclosed, escapable; total volume sent falls),
**I5** (no receipt byte changes; goldens untouched).

## Requirements

- **R1. Statusline dedupe and hourly heartbeat.** (decision 3(a))
  - **R1a. Local counters.** A `statusline` invocation no longer records a per-poll
    `cli_run`. It updates an optional `statusline` key in `~/.aireceipts/state.json`:
    the current UTC hour key, the raw poll and failed-poll counts, and the surface states
    and error classes already reported this hour. These raw values stay local, like
    `runCount` (SPEC-0043 R7). `schemaVersion` stays `1`: `parseState` treats any other
    version as corrupt (`src/telemetry/state.ts:39`), and an older CLI would then mint a
    new install id.
  - **R1b. Heartbeat.** A new event `statusline_heartbeat` is recorded on the first poll
    whose hour key differs from the stored one. It describes the stored, completed hour,
    and the counters reset. Fields: `cliVersion`, `os`, `nodeMajor`, `installHash`,
    `isCI`, `runOrdinalBucket` (the non-latency `cli_run` dimensions, so churn filters
    work for statusline-only installs); `pollCountBucket` {`1`, `2-10`, `11-50`,
    `51-200`, `>200`}; `failedPollCountBucket` {`0`, `1`, `2-10`, `>10`}; and
    `dayOffsetBucket` {`previous_hour`, `same_day`, `previous_day`, `older`}. The last
    field places the completed hour relative to the flush in UTC, so an analyst recovers
    the active day from the row's arrival time for every value except `older`. No hour,
    date or duration field is sent.
  - **R1c. Surface events.** `integration_surface_rendered` for `statusline` is recorded
    only when the poll's surface tuple (`inputMode`, `payloadValid`, `result`,
    `customFormat`, `scoped`, `configFile`) has not been reported in the current hour.
    "Changed since the last poll" would flood when two panes with different states
    alternate. `quota` keeps its per-run behavior.
  - **R1d. Flush only with something to send.** A statusline invocation flushes only
    when its queue is non-empty. All other polls make no network call. This replaces the
    `options.cwd === undefined` rule (`src/cli/commands/statusline.ts:259`), so scoped
    and unscoped polls follow one policy. The decision moves after `run`, because
    `main()` evaluates `shouldFlushTelemetry` before the command runs
    (`src/cli/index.ts:31`).
  - **R1e. Errors.** A thrown statusline error counts as a failed poll. It records
    `cli_error` only for an `errorClass` not yet reported this hour, so statusline
    `cli_error` rows mean "distinct failure classes per hour". Failure incidence is
    `failedPollCountBucket`.
  - **R1f. Accuracy contract.** State updates stay lock-free and last-write-wins
    (`src/telemetry/state.ts:97-115`). Under concurrent pollers, counts are lower
    bounds, and a heartbeat or surface event may be sent twice or not at all.
    Analysis counts distinct (`installHash`, attributed hour) pairs. A mixed-version
    machine can lose unflushed hours, current or completed, because an older
    `parseState` rebuilds the object without the new key (`state.ts:62`). A completed
    hour with no later poll is never sent. If the state update fails, the poll records
    nothing and does not flush. `docs/telemetry.md` states each of these limits.
  - **R1g. No latency.** The heartbeat carries no duration field and no share of slow
    polls. The local benchmark owns statusline performance.
  - **R1h. Disabled means untouched.** With telemetry disabled, the `statusline` key is
    neither created nor updated.
- **R2. Dead signals made live.**
  - **R2a. `agentType`.** `cli_run.agentType` and `cli_error.agentType` carry the
    resolved agent source. A command that renders sessions from exactly one agent sets
    it through a per-context seam modeled on `setExitClass`
    (`src/cli/exitClass.ts:7-15`), which `main()` reads when recording. Commands that
    parse nothing, or combine agents, keep `unknown`. For the same render it equals the
    value `receipt_generated` already derives (`src/cli/common/telemetry.ts:17`).
  - **R2b. `parse_failure` callers.** Claude Code, Codex, Gemini and opencode already
    count malformed records in `droppedRecords` (`src/parse/types.ts:222`); Cursor has
    its own skip paths. The first build step is an inventory, committed as a test
    fixture table, of each adapter's observable failure paths on a full load. Each path
    maps to a content-free shape from a closed per-adapter list, such as
    `claude-code:malformed_record` or `codex:unreadable_source`. Shapes attach to the
    loaded session and are never rendered or exported. One recording site under
    `src/cli/` calls `recordParseFailure` once per distinct (agent, shape) per run.
    Summary-cache hits (`src/parse/summaryCache.ts:115` strips full-load fields) and
    swallowed list failures (`src/parse/load.ts:62-70`) record nothing; this spec
    measures full loads only. `src/parse/**` never imports `src/telemetry/**`. Each
    adapter exports a short `adapterVersion` token.
  - **R2c. Identity on error events.** `parse_failure` and `cli_error` gain
    `cliVersion`, `installHash` and `isCI`, so the reliability dataset (R6) can separate
    CI and installs. Statusline polls record no `parse_failure`, because they re-read the
    same transcript every poll.
- **R3. Attach-path measurement and `invokedBy`.**
  - **R3a. Event.** New event `pr_attach_completed`: `trigger` {`pre_push`, `ci`};
    `result` {`attached`, `attached_push_failed`, `no_session`, `ref_write_failed`,
    `comment_posted`, `comment_found`, `missing_notice`, `missing_required`,
    `post_failed`, `invalid_context`, `internal_error`}; plus `cliVersion`,
    `installHash` and `isCI`. It carries no repo, org, branch, PR number, ref name,
    remote URL, commit SHA, or error text. A test pins which results each trigger can
    produce. Exactly one event is recorded per attempted run, and a thrown path records
    `internal_error`.
  - **R3b. Pre-push seam.** `pre_push` fires from `hook-pre-push` only after
    `shouldAttach` classifies a real branch push (`src/cli/commands/hook-pre-push.ts:147`).
    The hook's matcher is `Bash` (`src/hook/settings.ts:50`), so it runs on every agent
    shell call; non-push calls record nothing and never flush. `runPrDetailed` gains a
    structured `store=ref` outcome in `PrRunResult` (`src/pr/index.ts:86`); today the
    ref write and push report only through `deps.err` (`src/pr/index.ts:696-720`).
  - **R3c. Consent.** This amends the suppression contract (`src/cli/index.ts:22-30`;
    SPEC-0043's 2026-07-13 amendment). The hook still prints nothing, never writes a
    notice, records no `cli_run`, and exits 0 on every path. It sends
    `pr_attach_completed` only when `~/.aireceipts/telemetry.json` (under
    `AIRECEIPTS_HOME` when set) shows this user account has already seen the first-run
    notice. This matches the existing SessionEnd `--mini` hook, which already sends
    `cli_run` without user interaction. The same PR adds "sends one content-free event
    per branch push" to the hook's `network:` line in `integrations`
    (`src/setup/integrations.ts:124`) and to `docs/telemetry.md`.
  - **R3d. CI seam.** `ci` fires once per `pr-check` run
    (`src/cli/commands/pr-check.ts:152`). The early returns and the verdict paths each map
    to one result.
  - **R3e. `invokedBy`.** `cli_run` gains `invokedBy` {`human`, `hook`,
    `statusline_host`, `ci`}, a declared invocation context, never a verified one.
    Resolution order: `isCI` gives `ci`; `AIRECEIPTS_INVOKED_BY` of exactly `hook` or
    `statusline_host` gives that value, and any other value is ignored; a stdin payload
    the command already reads with `hook_event_name` gives `statusline_host` for `Status`
    and `hook` otherwise; else `human`. No command reads stdin only for telemetry. The
    installed SessionEnd command (`src/hook/settings.ts:8`) sets
    `AIRECEIPTS_INVOKED_BY=hook`. Install, uninstall and idempotency keep recognizing the
    legacy string, so existing installs report `human` until `setup` or `install-hook`
    is re-run. `docs/telemetry.md` states both limits.
- **R4. Honest coverage and no dev-build sends.**
  - **R4a.** `pricedRowCoverage` gains `n/a` for a render with zero tool rows
    (`src/cli/common/telemetry.ts:7`). `none` then means rows existed and none priced.
  - **R4b.** When the resolved connection string is the shipped default, telemetry is
    disabled if `getCliVersion()` returns its `0.0.0` fallback
    (`src/telemetry/helpers.ts:161`) or the package root (`helpers.ts:122`) contains a
    `.git` entry. An explicit `AIRECEIPTS_TELEMETRY_CONNECTION` still sends, so a
    maintainer can test against their own resource. A disabled dev build creates no
    install id.
- **R5. Schema, docs and example parity gate.** The hand-listed parity test
  (`src/telemetry/schemas.test.ts:43`) is replaced by one derived from
  `PROPERTIES_SCHEMA_BY_EVENT_NAME` (`src/telemetry/schemas.ts:358`). For every event, a
  `docs/telemetry.md` section exists, its field set equals the zod key set in both
  directions, and each enum field's documented values equal the schema's values. The
  tl;dr event count and list match `EVENT_NAMES`. Each event section carries one literal
  example payload, and the test validates it against the schema. `--telemetry-show`
  still prints only the current invocation's queue; it cannot preview a future
  heartbeat or hook event, so the docs examples are the preview for those, and the docs
  say so.
- **R6. Dataset definitions as documented KQL.** New
  `docs/internal/telemetry-datasets.md` defines named KQL:
  - **Raw churn first.** New hashes per day, and the share whose first event carrying
    `runOrdinalBucket` has `unavailable`, over unfiltered data.
  - **Adoption.** An install's first-seen time is its earliest `cli_run` or
    `statusline_heartbeat`. Exclusions: `isCI=true`; hashes whose first such event has
    `runOrdinalBucket=unavailable`; the 2026-07-11 version-matrix sweep, defined by
    first-seen day, `os` and lifetime active days; and maintainer hashes. Series:
    human and declared-hook WAU by `invokedBy`; statusline install-days from
    heartbeats; activation as the first `receipt_generated` whose
    `toolCallCountBucket` is not `0`; power installs at 5 or more active days in a
    trailing 28; a week-over-week cohort grid.
  - **Reliability.** Non-CI rows, maintainer included: `exitClass`, `cli_error`,
    `parse_failure`, and heartbeat `failedPollCountBucket`.
  - **CI.** `isCI=true` rows: `pr_attach_completed` with `trigger=ci`.
  - **Statusline row reduction.** Statusline rows per install per UTC arrival day,
    counting statusline `cli_run`, statusline `integration_surface_rendered`,
    `statusline_heartbeat`, and `cli_error` with `command=statusline`. The median across
    installs active on both versions is compared between v0.11.0 and the first release
    carrying R1.
  - **Rules.** Every exclusion is computable from stored fields. Maintainer hashes are
    the one list: a `let maintainer_hashes = dynamic([])` parameter whose values live in
    the maintainer vault, never in the repo. `invokedBy` splits apply only at or above
    the first release carrying R3e, and earlier rows form a `pre_invokedBy` series.
    `isCI` filters on `parse_failure` and `cli_error` apply only in versions carrying
    R2c. Heartbeats count as distinct (`installHash`, attributed hour) pairs.
  - A CI test checks every event and `customDimensions` field the KQL references exists
    in the schemas. CI cannot run KQL, so the maintainer runs each query once against
    the workspace before approval of the PR and records row counts in the PR.
- **R7. Ingestion geolocation blank.** (decision 4(a)) Every envelope carries
  `tags: { "ai.location.ip": "0.0.0.0" }` (`src/telemetry/sender.ts:33`), a constant
  never derived from the machine. Microsoft documents that ingestion geolocates from the
  sender's IP unless this tag is set, so the effect must be observed, not assumed. Gate:
  before merge, the maintainer sends one tagged envelope to the shipped resource and
  queries `client_City` and `client_CountryOrRegion` for it. If they are empty,
  `docs/telemetry.md` states that new versions store no geo and that the service still
  sees the HTTPS source IP. If not, R7 is dropped from the PR, the docs keep the
  disclosure, and decision 4 returns to the maintainer as option 4(b).

**Delivery slices.** One PR each, in order: A (R1, R4, R5), B (R2, R6), C (R3, R7).
Slice A carries the cost and analysis win on its own. B and C can be parked without
affecting A.

## Scenarios

- **Given** Claude Code polls `aireceipts statusline` for two hours with a valid stdin
  payload, **when** the first poll of hour three runs, **then** one
  `statusline_heartbeat` for hour two with `dayOffsetBucket: previous_hour` is flushed,
  no poll records `cli_run`, and one `integration_surface_rendered` was recorded per
  hour.
- **Given** a tmux `statusline --cwd` pane and a Claude Code pane poll alternately with
  two surface states, **when** they run for an hour, **then** the hour has about two
  `integration_surface_rendered` rows, a rare duplicate allowed under R1f, never one
  per poll.
- **Given** a machine that last polled Friday at 18:40 UTC and polls again Monday,
  **when** Monday's first poll runs, **then** Friday's hour flushes with
  `dayOffsetBucket: older` and carries no date.
- **Given** v0.11.0 writes `state.json` between two new-CLI polls, **when** the new CLI
  reads it, **then** the install id is unchanged, the file is not treated as corrupt, and
  the pending statusline hour is lost, as R1f documents.
- **Given** `aireceipts --session <id>` on a Codex session, **when** it renders,
  **then** `cli_run.agentType` is `codex` and equals `receipt_generated.agentType`.
- **Given** a Gemini transcript with one torn JSONL line loaded in full, **when**
  `aireceipts` renders it, **then** one `parse_failure` is queued with `agentType:
  gemini` and the identity fields, and the receipt bytes equal the telemetry-off render.
  The same session served from the summary cache records nothing.
- **Given** the PreToolUse hook receives `git status`, **when** it runs, **then** nothing
  is recorded or sent. **Given** `git push origin feat/x` from a user who has seen the
  notice, **then** one `pr_attach_completed {trigger: pre_push}` is sent with no branch,
  repo or SHA field.
- **Given** a user whose first aireceipts invocation ever is the committed hook,
  **when** it attaches a ref, **then** nothing is sent.
- **Given** `pr-check` in GitHub Actions posts the comment, **when** it exits, **then**
  one `pr_attach_completed {trigger: ci, result: comment_posted, isCI: true}` is sent.
- **Given** `npx aireceipts-cli --mini` launched by a reinstalled SessionEnd hook,
  **when** it runs, **then** `cli_run.invokedBy` is `hook`; from a legacy hook or a
  terminal, it is `human`.
- **Given** a `mini` receipt of a session with zero tool calls, **when** it renders,
  **then** `pricedRowCoverage` is `n/a`.
- **Given** `node dist/cli.js` run from a git checkout with no connection override,
  **when** any command runs, **then** zero network calls occur and no install id is
  created.
- **Given** a branch adds a schema field without a docs row or example, **when** CI
  runs, **then** the parity test fails naming the event and field.
- **Given** any path above under `DO_NOT_TRACK=1`, **when** it runs, **then** zero
  network calls occur and no `statusline` key is created.

## Non-goals

- **No sampling.** 1-in-N statusline sampling (decision 3(c)) undercounts installs, and
  installs are the unit every dataset counts.
- **No latency distribution telemetry.** No per-poll duration and no share of slow polls
  (decision 3(b) not taken). The local benchmark owns statusline performance.
  `cli_run.durationBucket` on other commands is unchanged.
- **No model or provider family field.** The plan's `unpricedModelFamily` idea was
  rejected by review: the family is derived from the transcript's model string, which is
  transcript-derived data under I4 even when bucketed. `priceTableAgeBucket` is also out.
- **No telemetry vendor change.** App Insights costs about $0 today (plan section 6).
- **No exact counts under concurrency.** File locking was rejected in SPEC-0043 R5/R7
  for the same stream; R1f's lower-bound contract applies instead.
- **No install-id churn fix.** The defensive `state.json` identity fix is its own PR.
  R1a only keeps `schemaVersion` at 1 so this spec cannot add churn.
- **No identity trio on `activation_milestone` or `hook_configured`.** No R6 metric
  needs them; activation is defined on `receipt_generated`.
- **No `commandClass` entries for `pr-check`, `pr-render-ref` or `hook-pre-push`.**
  `pr_attach_completed` measures the attach flow without turning every agent shell call
  into a `cli_run`.
- **No repo, org, branch or PR identity on attach events.** Per-repo rollout attribution
  stays impossible from telemetry, by design.
- **No parse-failure signal from cache hits or list scans.** Full loads only.
- **No change to receipts, goldens, or what `stats` prints.**

## Test matrix

| Requirement | Case | Expected |
|---|---|---|
| R1 | sequential: 2 hours of 120 polls, fixed clock, one surface state | 0 statusline `cli_run`; 1 heartbeat on hour 2's first poll; 2 surface rows; at most 5% of the 480-row baseline |
| R1 | sequential: two alternating surface states for an hour | exactly 2 surface rows that hour |
| R1 | concurrent: two pollers interleave read-modify-write at an hour boundary | valid JSON; install id unchanged; 1 or 2 heartbeats; never a crash |
| R1 | poll counts 1, 10, 11, 200, 201; failures 0, 1, 11 | exact bucket boundaries; raw counts absent |
| R1 | stored hour: previous, earlier same UTC day, previous UTC day, 3 days back | `previous_hour` / `same_day` / `previous_day` / `older`; no time field |
| R1 | queue empty vs non-empty, scoped and unscoped | 0 fetch calls vs 1 |
| R1 | new state read by the pinned v0.11.0 `parseState`, then written back and re-read | not `recovered`; `installId` kept; `statusline` key gone, as R1f states |
| R1 | two identical throws; two classes; same class across an hour rollover | 1; 2; 2 `cli_error` rows; failed-poll bucket counts every throw |
| R1 | state write fails | nothing recorded; 0 fetch calls |
| R1 | telemetry disabled, 50 polls | no `statusline` key; 0 fetch calls |
| R2 | single-agent render per adapter; `help`; multi-agent `compare` | adapter value; `unknown`; `unknown` |
| R2 | each inventoried failure path, full load | one `parse_failure` per distinct shape per run |
| R2 | same session via summary cache; list failure | no `parse_failure` |
| R2 | render with shapes attached | text, `--json` and export bytes equal the telemetry-off render; goldens unchanged |
| R2 | import graph | no `src/parse/**` file imports `src/telemetry/**` |
| R2 | `cli_error` and `parse_failure` payloads, CI env set and unset | identity trio present; `isCI` correct |
| R2 | statusline poll on a torn transcript | no `parse_failure` |
| R3 | hook payloads: `git status`; heredoc; `cd x && git push`; `git push origin b` | only the last records; others record and flush nothing |
| R3 | hook push: notice file absent; present; present under `AIRECEIPTS_HOME` | nothing sent; one event; one event |
| R3 | hook outcomes: written and pushed; push failed; no session; write failed; thrown | `attached` / `attached_push_failed` / `no_session` / `ref_write_failed` / `internal_error`; exit 0, empty stdout and stderr |
| R3 | `pr-check`: posted; found; notice; required; post failed; missing context; thrown | matching `ci` result, exactly one event each |
| R3 | trigger and result pairing | `pre_push` never yields comment results; `ci` never yields ref results |
| R3 | leakage fixtures: branch, repo slug, SHA, URL, error text | schema rejects |
| R3 | `invokedBy`: CI env; env `hook`; env `bogus`; payload `Status`; payload `SessionEnd`; none | `ci`; `hook`; falls through; `statusline_host`; `hook`; `human` |
| R3 | install and uninstall with legacy and new SessionEnd strings | both recognized; install writes the new string once |
| R4 | zero tool rows; rows, none priced; some; all | `n/a` / `none` / `some` / `all` |
| R4 | version `0.0.0`; package root with `.git`; each with explicit connection env | disabled, no install id; sends |
| R5 | schema key without docs; docs row without schema; enum value changed on one side; example payload invalid | test fails naming event and field |
| R5 | tl;dr count and list vs `EVENT_NAMES` | equal |
| R6 | KQL blocks in `docs/internal/telemetry-datasets.md` | every referenced event and field exists |
| R6 | datasets doc | contains no 64-hex literal |
| R7 | envelope snapshot | `tags["ai.location.ip"] === "0.0.0.0"` on every envelope; `properties` unchanged |
| All | `AIRECEIPTS_TELEMETRY=off` and `DO_NOT_TRACK=1` on every new path | 0 fetch calls |

## Success criteria

- [ ] Every matrix row above is green in the unmasked gate.
- [ ] `docs/telemetry.md` documents `statusline_heartbeat`, `pr_attach_completed`,
      `invokedBy` and its limits, the new identity fields, `pricedRowCoverage=n/a`, the
      dev-build rule, and R1f's accuracy limits, with one example payload per event, in
      the same PR as each schema change. The R5 test enforces fields and examples.
- [ ] SPEC-0043 gains a dated amendment note pointing here for the new events and the
      changed hook-suppression contract.
- [ ] The maintainer has run each R6 query against the workspace and recorded row counts
      in the slice B PR.
- [ ] R7's controlled ingestion check is recorded in the slice C PR, with its outcome.
- [ ] (post-release, maintainer KQL, observational) The R6 statusline row reduction query
      shows the median rows per install per active day down 95% or more against
      v0.11.0.
- [ ] (post-release, observational) `cli_run.agentType=unknown` falls below 5% on
      `receipt`, `mini` and `pr` rows from the new version.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs` and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-09-22 · S1 (self).** Every field is a bounded enum, a boolean, or an identity
field SPEC-0043 already permits; no dollar, model string, path, repo or raw count or
timestamp leaves the machine. No receipt output changes (I5), and `src/parse/**` stays
free of telemetry imports (I1). Self-found before review: "changed since the last poll"
floods when two panes alternate, so R1c counts first-seen per hour; the Bash-matcher
hook would record on every agent shell call, so R3b records only classified pushes; the
hook cannot disclose on its own, so R3c requires a prior notice; the maintainer hash
list must not enter a public file, so R6 takes it as a parameter.

**2026-09-22 · S2 (Codex, independent, read-only): verdict REWORK, reworked same
session.** 14 findings.
- Accepted (1, blocker): cross-process dedupe cannot be exact. R1f now states a
  lower-bound, possible-duplicate contract, and tests assert safety, not exactness.
- Accepted (2): an older CLI can erase a completed unflushed hour too. R1f and the
  mixed-version test say so.
- Accepted (3, blocker): the heartbeat could not be placed in time. `flushDelayBucket`
  became `dayOffsetBucket`, which recovers the active UTC day from arrival time, and R6
  defines the 95% metric as a named query.
- Accepted (4): statusline `cli_error` now means distinct classes per hour, with
  incidence in `failedPollCountBucket`; rollover, multi-class and failed-write cases added.
- Accepted (5): the `droppedRecords` claim was wrong (four adapters use it). R2b now
  starts with a committed inventory, measures full loads only, and tests cache hits and
  list failures separately.
- Accepted (6): `cli_error` lacked `isCI`, so the reliability filter could not work. R2c
  adds the identity trio to `cli_error` as well.
- Accepted (7): R3b adds a structured `store=ref` outcome to `PrRunResult`; R3a and R3d
  require exactly one event per run, thrown paths included.
- Partially accepted (8, blocker): a notice file proves the account saw the notice, not
  that the person triggering a committed hook did. Kept the rule, because the SessionEnd
  `--mini` hook already sends `cli_run` without interaction under the same notice, and
  added disclosure in the `integrations` network line and the docs. The consent question
  is raised to the maintainer below.
- Accepted (9): `--telemetry-show` cannot preview a future heartbeat or hook event. R5
  now requires a validated example payload per event, and the docs say which preview
  covers what.
- Accepted (10): R7 is now a gated experiment with a controlled ingestion check before
  any docs claim, with a fallback to option 4(b).
- Accepted (11): statusline-only installs now anchor on heartbeats, which carry
  `runOrdinalBucket`; the maintainer runs each query once. Rejected in part: CI cannot
  execute KQL, so a synthetic-dataset CI run is out of reach.
- Accepted (12): the post-release `0.0.0` criterion was unfalsifiable and is dropped;
  R4b is unit-tested.
- Rejected with narrowing (13, "cut `invokedBy`"): the plan's own review requires
  `invokedBy` before hook WAU is used, and the one retained external install is
  hook-driven. It is now labeled a declared context, legacy hooks report `human`, and
  R6 names the series "declared-hook". It remains the weakest requirement.
- Partially accepted (14, worth and scope): split into slices A, B and C so the
  statusline win ships alone and B or C can be parked. Not cut: see S3.

**2026-09-22 · S3 (worth).**
- **Who and how often.** The maintainer reads this telemetry for every release and
  pricing decision. The 2026-09-22 deep dive took a full session largely spent working
  around these gaps. Statusline cost grows linearly with always-on users: about $115
  a month at 1,000 heavy installs today, about $0 with a heartbeat (deep dive section 13).
- **One-off vs recurring.** Recurring. Every analysis pays the 413K-row noise, and every
  release reopens "which version, which agent, did attach work".
- **Do-nothing.** Cost stays near $0 at today's scale, so cost alone does not justify
  it. The live harm is analytical: unweighted counts are dominated by five pollers,
  agent mix is unknowable, adapter drift is invisible, and the org rollout's attach
  rate cannot be measured (0 `pr --post` rows since 2026-07-19, cause unproven).
- **Smaller fix.** Docs alone close none of these. The smallest code fix is slice A.
  R2b's parse wiring could shrink to one adapter, but drift is per vendor.
- **Steelman the cut.** At 4 to 7 weekly organic installs, the analytics may matter
  less than acquisition. Slices B and C add hook consent risk and an Azure experiment
  for a small population. That case is strong for C and weak for A.
- **Kill criterion dry-run.** Kill the heartbeat if, after one release, statusline
  install-days from heartbeats fall below the per-poll count for the same installs by
  more than the documented final-hour and mixed-version loss. Kill any field that a
  leakage fixture shows can carry content. Existing evidence for survival: the deep
  dive's per-poll data already shows about 80 polls an hour per heavy install, so
  hourly buckets lose no install-day.
- **Verdict: build now** for slice A; **build now** for slice B; **defer to maintainer
  judgment** for slice C, which rests on open questions 1 and 2.

**Open questions for the maintainer (button 1).**
1. Is the account-level notice enough consent for the committed pre-push hook to send
   (R3c), or should the hook stay network-free until a per-repo opt-in exists?
2. Keep `invokedBy` (R3e) as a declared context, or cut it, as the critic argues?
3. Should the installed SessionEnd command change at all? Changing it rewrites adopters'
   `settings.json` on the next `setup`.
4. R2a overlaps SPEC-0084 R1c in the onboarding draft; which spec owns
   `cli_run.agentType`?

**2026-09-22 · S4.** `node scripts/spec-lint.mjs specs/SPEC-0094-telemetry-hygiene-v2.md`
exits 0.
