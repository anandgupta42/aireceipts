---
id: SPEC-0094
title: "Telemetry hygiene v2: statusline heartbeat, live dead signals, dataset definitions"
status: approved
milestone: M6
depends: [SPEC-0002, SPEC-0043, SPEC-0075]
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
`unknown`. `recordParseFailure` (`src/telemetry/index.ts:135`) has no caller. Zero-tool
receipts report `pricedRowCoverage=none` (90 of 98), and dev builds send to production
(16 rows at `cliVersion=0.0.0`, 2 rows of an undocumented `card_generated` event).
Attach-path measurement, `invokedBy` and the ingestion geolocation blank are parked in
SPEC-0098.

This spec fixes those on the SPEC-0043 rails. It adds no new data class: every new field
is a bounded enum, a boolean, or one of the three identity fields SPEC-0043 already
permits (`cliVersion`, the salted `installHash`, `isCI`). Every change lands with its
`docs/telemetry.md` rows in the same PR, and the kill switches (`AIRECEIPTS_TELEMETRY=off`,
`DO_NOT_TRACK=1`) still win with zero network calls. Research basis: the improvement plan
(`docs/internal/research/2026-09-22-improvement-plan.md`, research worktree) section 3B,
decision 3(a), and section 6.

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
    `hourOffset`, a closed enum {`1`, `2`, ..., `24`, `>24`}: the number of completed UTC
    hours between the stored hour and the flush. Analysis recovers the attributed hour
    as the row's arrival time floored to the hour minus `hourOffset`, for every value
    except `>24`. No hour, date or duration field is sent.
  - **R1c. Surface events.** `integration_surface_rendered` for `statusline` is recorded
    only when the poll's surface tuple (`inputMode`, `payloadValid`, `result`,
    `customFormat`, `scoped`, `configFile`) has not been reported in the current hour.
    "Changed since the last poll" would flood when two panes with different states
    alternate. The event gains `cliVersion`, `installHash` and `isCI`, so statusline
    rows are countable per install; `quota` rows carry them too because the schema is
    shared, and `quota` keeps its per-run behavior.
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
    value `receipt_generated` already derives (`src/cli/common/telemetry.ts:17`). This
    requirement owns `cli_run.agentType`; SPEC-0084 R1c defers to it.
  - **R2b. `parse_failure` callers.** Claude Code, Codex, Gemini and opencode already
    count malformed records in `droppedRecords` (`src/parse/types.ts:222`); Cursor has
    its own skip paths. The first build step is an inventory, committed as a test
    fixture table, of each adapter's failure paths on a full load. Only failures that
    still yield a `Session` (record-level skips) are measured: each maps to a
    content-free shape from a closed per-adapter list, such as
    `claude-code:malformed_record`, attached to the loaded session and never rendered or
    exported. Full-load failures that return null carry no session to attach a shape
    to; the inventory lists them as `not measurable by this spec`. One recording site
    under `src/cli/` calls `recordParseFailure` once per distinct (agent, shape) per
    run. Summary-cache hits (`src/parse/summaryCache.ts:115` strips full-load fields)
    and swallowed list failures (`src/parse/load.ts:62-70`) record nothing.
    `src/parse/**` never imports `src/telemetry/**`. Each adapter exports a short
    `adapterVersion` token.
  - **R2c. Identity on error events.** `parse_failure` and `cli_error` gain
    `cliVersion`, `installHash` and `isCI`, so the reliability dataset (R5) can separate
    CI and installs. Statusline polls record no `parse_failure`, because they re-read the
    same transcript every poll.
- **R3. Honest coverage and no dev-build sends.**
  - **R3a.** `pricedRowCoverage` gains `n/a` for a render with zero tool rows
    (`src/cli/common/telemetry.ts:7`). `none` then means rows existed and none priced.
  - **R3b.** When the resolved connection string is the shipped default, telemetry is
    disabled if `getCliVersion()` returns its `0.0.0` fallback
    (`src/telemetry/helpers.ts:161`) or the package root (`helpers.ts:122`) contains a
    `.git` entry. An explicit `AIRECEIPTS_TELEMETRY_CONNECTION` still sends, so a
    maintainer can test against their own resource. A disabled dev build creates no
    install id.
- **R4. Schema, docs and example parity gate.** The hand-listed parity test
  (`src/telemetry/schemas.test.ts:43`) is replaced by one derived from
  `PROPERTIES_SCHEMA_BY_EVENT_NAME` (`src/telemetry/schemas.ts:358`). For every event, a
  `docs/telemetry.md` section exists, its field set equals the zod key set in both
  directions, and each enum field's documented values equal the schema's values. This
  covers the identity trio added to `integration_surface_rendered`, `parse_failure` and
  `cli_error`. The tl;dr event count and list match `EVENT_NAMES`. Each event section
  carries one literal example payload, and the test validates it against the schema.
  `--telemetry-show` still prints only the current invocation's queue; it cannot preview
  a future heartbeat, so the docs examples are the preview for it, and the docs say so.
- **R5. Dataset definitions as documented KQL.** New
  `docs/internal/telemetry-datasets.md` defines named KQL:
  - **Raw churn first.** Over unfiltered data: new real hashes per day, and a row-level
    unavailable rate, the share of rows carrying `runOrdinalBucket` whose value is
    `unavailable`. Install-level denominators count only real 64-hex hashes. Rows whose
    `installHash` is `unavailable` or empty cannot be grouped into installs; the query
    reports their count and share separately.
  - **Adoption.** An install's first-seen time is its earliest `cli_run` or
    `statusline_heartbeat`. Exclusions: `isCI=true`; hashes whose first such event has
    `runOrdinalBucket=unavailable`; the 2026-07-11 version-matrix sweep, defined by
    first-seen day, `os` and lifetime active days; and maintainer hashes. Series: one
    WAU series; statusline install-days from heartbeats; activation as the first
    `receipt_generated` whose `toolCallCountBucket` is not `0`; power installs at 5 or
    more active days in a trailing 28; a week-over-week cohort grid.
  - **Reliability.** Non-CI rows, maintainer included: `exitClass`, `cli_error`,
    `parse_failure`, and heartbeat `failedPollCountBucket`.
  - **Statusline row reduction.** Statusline rows per install per UTC arrival day. For
    the new version: statusline `integration_surface_rendered`, `statusline_heartbeat`,
    and `cli_error` with `command=statusline`, all keyed on `installHash`. For v0.11.0,
    whose surface rows lack identity: twice the statusline `cli_run` rows per install,
    since each poll emitted both. The median across installs active on both versions is
    compared.
  - **Rules.** Every exclusion is computable from stored fields. Maintainer hashes are
    the one list: a `let maintainer_hashes = dynamic([])` parameter whose values live in
    the maintainer vault, never in the repo. `isCI` filters on `parse_failure` and
    `cli_error` apply only in versions carrying R2c. Heartbeat duplicates are removed on
    distinct (`installHash`, attributed hour) pairs; `>24` rows count toward installs
    but not toward hour or day series.
  - A CI test checks every event and `customDimensions` field the KQL references exists
    in the schemas. CI cannot run KQL, so the maintainer runs each query once against
    the workspace before merging the slice B PR and records row counts in the PR.

**Delivery slices.** One PR each, in order: A (R1, R3, R4), then B (R2, R5).

## Scenarios

- **Given** Claude Code polls `aireceipts statusline` for two hours with a valid stdin
  payload, **when** the first poll of hour three runs, **then** one
  `statusline_heartbeat` for hour two with `hourOffset: 1` is flushed, no poll records
  `cli_run`, and one `integration_surface_rendered` carrying the identity trio was
  recorded per hour.
- **Given** a tmux `statusline --cwd` pane and a Claude Code pane poll alternately with
  two surface states, **when** they run for an hour, **then** the hour has about two
  `integration_surface_rendered` rows, a rare duplicate allowed under R1f, never one
  per poll.
- **Given** a machine that last polled Friday at 18:40 UTC and polls again Monday,
  **when** Monday's first poll runs, **then** Friday's hour flushes with
  `hourOffset: >24` and carries no date.
- **Given** v0.11.0 writes `state.json` between two new-CLI polls, **when** the new CLI
  reads it, **then** the install id is unchanged, the file is not treated as corrupt, and
  the pending statusline hour is lost, as R1f documents.
- **Given** `aireceipts --session <id>` on a Codex session, **when** it renders,
  **then** `cli_run.agentType` is `codex` and equals `receipt_generated.agentType`.
- **Given** a Gemini transcript with one torn JSONL line loaded in full, **when**
  `aireceipts` renders it, **then** one `parse_failure` is queued with `agentType:
  gemini` and the identity fields, and the receipt bytes equal the telemetry-off render.
  The same session served from the summary cache records nothing.
- **Given** a transcript whose full load returns null, **when** it is requested,
  **then** no `parse_failure` is recorded, and the inventory lists that path as not
  measurable by this spec.
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

- **No attach measurement, `invokedBy`, or geolocation blank.** Parked as SPEC-0098
  behind two maintainer questions (hook consent, `invokedBy`). This spec leaves the
  hidden `hook pre-push` suppression contract unchanged.
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
- **No structured load result.** Full-load failures that return null stay unmeasured;
  giving loaders a structured failure result is a separate change.
- **No install-id churn fix.** The defensive `state.json` identity fix is its own PR.
  R1a only keeps `schemaVersion` at 1 so this spec cannot add churn.
- **No identity trio on `activation_milestone` or `hook_configured`.** No R5 metric
  needs them; activation is defined on `receipt_generated`.
- **No parse-failure signal from cache hits or list scans.** Full loads only.
- **No change to receipts, goldens, or what `stats` prints.**

## Test matrix

| Requirement | Case | Expected |
|---|---|---|
| R1 | sequential: 2 hours of 120 polls, fixed clock, one surface state | 0 statusline `cli_run`; 1 heartbeat on hour 2's first poll; 2 surface rows; at most 5% of the 480-row baseline |
| R1 | sequential: two alternating surface states for an hour | exactly 2 surface rows that hour |
| R1 | concurrent: two pollers interleave read-modify-write at an hour boundary | valid JSON; install id unchanged; 1 or 2 heartbeats; never a crash |
| R1 | poll counts 1, 10, 11, 200, 201; failures 0, 1, 11 | exact bucket boundaries; raw counts absent |
| R1 | stored hour 1, 2, 24, 25 and 72 completed UTC hours before the flush, including a UTC day rollover | `1` / `2` / `24` / `>24` / `>24`; no time field; arrival hour minus offset equals the stored hour for `1` to `24` |
| R1 | surface and heartbeat payloads, CI env set and unset | identity trio present; `isCI` correct; `quota` rows also carry the trio |
| R1 | queue empty vs non-empty, scoped and unscoped | 0 fetch calls vs 1 |
| R1 | new state read by the pinned v0.11.0 `parseState`, then written back and re-read | not `recovered`; `installId` kept; `statusline` key gone, as R1f states |
| R1 | two identical throws; two classes; same class across an hour rollover | 1; 2; 2 `cli_error` rows; failed-poll bucket counts every throw |
| R1 | state write fails | nothing recorded; 0 fetch calls |
| R1 | telemetry disabled, 50 polls | no `statusline` key; 0 fetch calls |
| R2 | single-agent render per adapter; `help`; multi-agent `compare` | adapter value; `unknown`; `unknown` |
| R2 | each inventoried record-level skip path, full load | one `parse_failure` per distinct shape per run |
| R2 | full load returning null; same session via summary cache; list failure | no `parse_failure`; the null path is listed as not measurable in the inventory |
| R2 | render with shapes attached | text, `--json` and export bytes equal the telemetry-off render; goldens unchanged |
| R2 | import graph | no `src/parse/**` file imports `src/telemetry/**` |
| R2 | `cli_error` and `parse_failure` payloads, CI env set and unset | identity trio present; `isCI` correct |
| R2 | statusline poll on a torn transcript | no `parse_failure` |
| R3 | zero tool rows; rows, none priced; some; all | `n/a` / `none` / `some` / `all` |
| R3 | version `0.0.0`; package root with `.git`; each with explicit connection env | disabled, no install id; sends |
| R4 | schema key without docs; docs row without schema; enum value changed on one side; example payload invalid | test fails naming event and field |
| R4 | tl;dr count and list vs `EVENT_NAMES` | equal |
| R5 | KQL blocks in `docs/internal/telemetry-datasets.md` | every referenced event and field exists; no reference to `pr_attach_completed` or `invokedBy` |
| R5 | datasets doc | contains no 64-hex literal |
| All | `AIRECEIPTS_TELEMETRY=off` and `DO_NOT_TRACK=1` on every new path | 0 fetch calls |

## Success criteria

- [ ] Every matrix row above is green in the unmasked gate.
- [ ] `docs/telemetry.md` documents `statusline_heartbeat`, the identity trio on
      `integration_surface_rendered`, `parse_failure` and `cli_error`,
      `pricedRowCoverage=n/a`, the dev-build rule, and R1f's accuracy limits, with one
      example payload per event, in the same PR as each schema change. The R4 test
      enforces fields and examples.
- [ ] SPEC-0043 gains a dated amendment note pointing here for the new event and the
      statusline recording rules.
- [ ] The maintainer has run each R5 query against the workspace and recorded row counts
      in the slice B PR.
- [ ] (post-release, maintainer KQL, observational) The R5 statusline row reduction query
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

Requirement numbers in the S1 to S4 records below refer to revision 1 (R1 to R7). In
revision 2, old R4, R5 and R6 are R3, R4 and R5, and old R3 and R7 moved to SPEC-0098.

**2026-09-22 · S1 (self).** Every field is a bounded enum, a boolean, or an identity
field SPEC-0043 already permits; no dollar, model string, path, repo or raw count or
timestamp leaves the machine. No receipt output changes (I5), and `src/parse/**` stays
free of telemetry imports (I1). Self-found before review: "changed since the last poll"
floods when two panes alternate, so R1c counts first-seen per hour; the Bash-matcher
hook would record on every agent shell call; the hook cannot disclose on its own; the
maintainer hash list must not enter a public file, so R6 takes it as a parameter.

**2026-09-22 · S2 (Codex, independent, read-only): verdict REWORK, reworked same
session.** 14 findings.
- Accepted (1, blocker): cross-process dedupe cannot be exact. R1f states a
  lower-bound, possible-duplicate contract, and tests assert safety, not exactness.
- Accepted (2): an older CLI can erase a completed unflushed hour too. R1f and the
  mixed-version test say so.
- Accepted (3, blocker): the heartbeat could not be placed in time. A relative time
  bucket was added (revision 2 replaces it with `hourOffset`), and R6 defines the 95%
  metric as a named query.
- Accepted (4): statusline `cli_error` means distinct classes per hour, with incidence in
  `failedPollCountBucket`; rollover, multi-class and failed-write cases added.
- Accepted (5): the `droppedRecords` claim was wrong (four adapters use it). R2b starts
  with a committed inventory, measures full loads only, and tests cache hits and list
  failures separately.
- Accepted (6): `cli_error` lacked `isCI`. R2c adds the identity trio to `cli_error`.
- Accepted (7), partially accepted (8), rejected with narrowing (13), accepted (10):
  these concern the attach event, hook consent, `invokedBy` and the geo tag, now in
  SPEC-0098, whose Validation carries them.
- Accepted (9): `--telemetry-show` cannot preview a future heartbeat. R5 (now R4)
  requires a validated example payload per event.
- Accepted (11): statusline-only installs anchor on heartbeats, which carry
  `runOrdinalBucket`; the maintainer runs each query once. Rejected in part: CI cannot
  execute KQL.
- Accepted (12): the post-release `0.0.0` criterion was unfalsifiable and is dropped.
- Partially accepted (14, worth and scope): split into slices; slice C is now parked as
  SPEC-0098.

**2026-09-22 · Revision 2 (PR #376, Codex GitHub bot review, 6 findings, all
accepted).**
1. The relative time bucket could not key duplicates to one hour. R1b now sends
   `hourOffset` (`1` to `24`, `>24`), and R5 keys duplicates on (`installHash`,
   attributed hour).
2. The row-reduction query needed identity on both sides. R1c adds the trio to
   `integration_surface_rendered`, and the v0.11.0 side is estimated from statusline
   `cli_run` rows.
3. A null full load has no session to carry a shape. R2b measures record-level skips
   only; null-returning paths are inventoried as not measurable, and a structured load
   result is a non-goal.
4. Slice B referenced slice C fields. R5 drops the `invokedBy` series, the CI attach
   dataset and their parity checks; they moved to SPEC-0098.
5. An install share over the `unavailable` hash is not computable. R5 reports a
   row-level unavailable rate and counts installs over real hashes only.
6. One spec, one verdict. Slice C moved to SPEC-0098 (`defer`); this spec keeps slices A
   and B with a single verdict, and requirements are renumbered.

**2026-09-22 · S3 (worth), slices A and B.**
- **Who and how often.** The maintainer reads this telemetry for every release and
  pricing decision. The 2026-09-22 deep dive spent much of a session working around
  these gaps. Statusline cost grows linearly with always-on users: about $115 a month
  at 1,000 heavy installs today, about $0 with a heartbeat (deep dive section 13).
- **One-off vs recurring.** Recurring. Every analysis pays the 413K-row noise, and every
  release reopens "which version, which agent, did parsing drift".
- **Do-nothing.** Cost stays near $0 at today's scale, so cost alone does not justify
  it. The live harm is analytical: unweighted counts are dominated by five pollers,
  agent mix is unknowable, and adapter drift is invisible.
- **Smaller fix.** Docs alone close none of these. The smallest code fix is slice A.
- **Steelman the cut.** At 4 to 7 weekly organic installs, analytics may matter less
  than acquisition. That argument is weak for slice A, which also removes a 300ms
  network flush from most polls, and moderate for slice B.
- **Kill criterion dry-run.** Kill the heartbeat if, after one release, statusline
  install-days from heartbeats fall below the per-poll count for the same installs by
  more than the documented final-hour and mixed-version loss. Kill any field a leakage
  fixture shows can carry content. The deep dive's per-poll data shows about 80 polls
  an hour per heavy install, so hourly buckets lose no install-day.
- **Verdict: build now.**

**Resolved question.** Revision 1's open question on `cli_run.agentType` ownership:
SPEC-0094 R2a owns it, and SPEC-0084 R1c should defer to it. The other three open
questions moved to SPEC-0098.

**2026-09-22 · S4.** `node scripts/spec-lint.mjs specs/SPEC-0094-telemetry-hygiene-v2.md`
exits 0.

2026-09-22 · Approved by the maintainer for slices A and B (button 1, chat instruction); slice C parked as SPEC-0098.
