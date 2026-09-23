# Diagnostics and adoption telemetry

`aireceipts` can send small, content-free telemetry events to help us find bugs and understand which CLI features are actually used. This document is the full, authoritative description of what is sent, when, and how to turn it off. If anything here disagrees with `src/telemetry/`, that is a bug.

## tl;dr

- **On by default in installed builds**, but every event is one of a fixed 10-event catalog: `cli_run`, `cli_error`, `parse_failure`, `receipt_generated`, `export_generated`, `pr_flow_completed`, `hook_configured`, `integration_surface_rendered`, `activation_milestone`, `statusline_heartbeat`.
- **Never sent**: transcript content, prompts, file paths, repo names, hostnames, usernames, session IDs, dollar amounts, raw model strings, raw counts, or session timestamps. (The App Insights wire format requires one client-stamped send time per envelope — the flush moment, nothing about your session's timeline; see "What is never sent".)
- **Derived by the receiver, not sent by the CLI**: a coarse location (country and city) from the sending IP, which the shipped resource masks before storing; see "How sending works".
- **Pseudonymous install identity**: when telemetry is enabled, a random install id is stored locally and sent only as a salted sha256 hash so events from the same install can be counted over time. Delete `~/.aireceipts/state.json` and any `state.json.corrupt-*` backups there to reset it.
- **Disable anytime**: `AIRECEIPTS_TELEMETRY=off` (or `0`/`false`) or `DO_NOT_TRACK=1`. Either one results in **zero network calls** and prevents install-id creation on a fresh install.
- **On by default in CI too**: `CI`/`GITHUB_ACTIONS` environments are treated the same as any other — telemetry is enabled by default there. Use a kill switch (`AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1`) to disable it in CI. (Before v0.7.0 it defaulted off in CI; reversed — see SPEC-0002.)
- **Inspect before you decide**: `aireceipts --telemetry-show` prints the exact application payload the current run would send, and sends nothing. It cannot show transport metadata (the flush time the wire format requires, the sending IP the receiver sees) or fields the receiver derives from them; those are described in "How sending works".
- **Bounded and fail-safe**: sending is capped at 300ms and can never throw, hang the CLI, or change its exit code.

## Event catalog

Every field below is validated against a `.strict()` zod schema before it is queued. Extra keys are rejected, so a bug elsewhere cannot smuggle a new field into a payload.

### `cli_run` — one per controlled return from a catalogued command

The fixed catalog covers every ordinary user-facing command listed below,
including `setup` and `integrations`. Unrecognized or hidden internal command
names never widen the schema: they are dropped rather than sent as raw text.
Thrown paths emit `cli_error` only. `telemetry-show` and the hidden `hook
pre-push` surface record nothing. Statusline polls are counted locally and send
a surface event for each new state in an hour plus a heartbeat after the hour ends.

| Field | Type | Values | Notes |
|---|---|---|---|
| `cliVersion` | string | semver | From this package's `package.json`. |
| `os` | enum | `darwin` \| `linux` \| `win32` \| `other` | Collapsed from `process.platform`. |
| `nodeMajor` | integer | e.g. `22` | Major Node version only. |
| `commandClass` | enum | `backfill` \| `benchmark` \| `check-budget` \| `compare` \| `demo` \| `handoff` \| `help` \| `install-hook` \| `integrations` \| `list` \| `methodology` \| `mini` \| `pr` \| `quota` \| `receipt` \| `setup` \| `stats` \| `statusline` \| `telemetry-show` \| `templates` \| `uninstall-hook` \| `version` \| `week` | Selected command name only; never raw argv or flag values. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | Which agent format was parsed, if known. |
| `durationBucket` | enum | `<100ms` \| `100-500ms` \| `500ms-2s` \| `2-10s` \| `>10s` | Coarse bucket; never raw milliseconds. |
| `ok` | boolean | | Whether the command returned exit code 0. |
| `exitClass` | enum (optional) | `no-session-match` \| `invalid-arguments` \| `budget-exceeded` \| `not-comparable` \| `other-controlled` | Present only when `ok` is false for a controlled return: respectively, no matching session/query; rejected flags or options; `check-budget` over its cap; `compare` lacking two comparable sessions; or another deliberate non-zero outcome. Thrown errors omit this field and emit `cli_error` instead. Never free text. |
| `isCI` | boolean | | True when `CI` or `GITHUB_ACTIONS` is set and not false. Telemetry is enabled by default in CI, so this field distinguishes CI runs from human runs in the data. |
| `installHash` | string | 64-hex sha256 or `unavailable` | Salted hash of the random local install id; raw id never leaves disk. |
| `runOrdinalBucket` | enum | `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` \| `unavailable` | Lifetime run ordinal bucket; never the raw count. |
| `installIdSource` | enum | `existing` \| `new` \| `recovered_after_corrupt` \| `unavailable` | Whether the id came from state, was newly minted, followed recovery of unparseable state, or was unavailable. |
| `handoffFormat` | enum (optional) | `text` \| `json` | SPEC-0042: emission mode, present only on handoff-command runs — never content. |

```json
{
  "cliVersion": "0.11.0",
  "os": "linux",
  "nodeMajor": 22,
  "commandClass": "receipt",
  "agentType": "unknown",
  "durationBucket": "<100ms",
  "ok": true,
  "isCI": false,
  "installHash": "unavailable",
  "installIdSource": "unavailable",
  "runOrdinalBucket": "1"
}
```

### `cli_error` — one per uncaught top-level CLI error

| Field | Type | Values | Notes |
|---|---|---|---|
| `errorClass` | enum | `parse_error` \| `io_error` \| `network_error` \| `validation_error` \| `unknown_error` | Derived from bounded error metadata; never `error.message`. |
| `command` | enum | `backfill` \| `benchmark` \| `check-budget` \| `compare` \| `demo` \| `handoff` \| `help` \| `install-hook` \| `integrations` \| `list` \| `methodology` \| `mini` \| `pr` \| `quota` \| `receipt` \| `setup` \| `stats` \| `statusline` \| `telemetry-show` \| `templates` \| `uninstall-hook` \| `version` \| `week` | Never raw argv. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `inPackage` | boolean | | Whether the top stack frame is inside aireceipts; the stack text never leaves the process. |

```json
{
  "errorClass": "io_error",
  "command": "receipt",
  "agentType": "unknown",
  "inPackage": false
}
```

### `parse_failure` — one per transcript parsing failure

| Field | Type | Values | Notes |
|---|---|---|---|
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `adapterVersion` | string | short opaque token | Internal adapter version, not read from a transcript. |
| `signatureHash` | string | 64-hex sha256 | Hash of a content-free structural failure descriptor. |

```json
{
  "agentType": "codex",
  "adapterVersion": "1",
  "signatureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

### `receipt_generated` — one per rendered cost receipt

| Field | Type | Values | Notes |
|---|---|---|---|
| `cliVersion` | string | semver | From this package's `package.json`. |
| `installHash` | string | 64-hex sha256 or `unavailable` | Salted hash of the random local install id; raw id never leaves disk. |
| `isCI` | boolean | | True when `CI` or `GITHUB_ACTIONS` is set and not false. Telemetry is enabled by default in CI, so this field distinguishes CI runs from human runs in the data. |
| `surface` | enum | `receipt` \| `compare` \| `mini` \| `pr` | Statusline/quota/template previews are not receipts. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | `unknown` for mixed-agent/multi-session surfaces. |
| `multiAgent` | boolean | | True when the rendered surface combines more than one session/model. |
| `outputMode` | enum | `text` \| `json` \| `csv` \| `svg` \| `png` \| `markdown` | |
| `template` | enum | `classic` \| `grocery` \| `datavis` \| `none` | `none` when no template flag drove the render. |
| `pricedRowCoverage` | enum | `n/a` \| `none` \| `some` \| `all` | `n/a`: zero tool rows; `none`: rows exist but none are priced. No dollars are sent. |
| `hasStuckLoopWaste` | boolean | | |
| `hasTrivialSpansWaste` | boolean | | |
| `hasContextThrashWaste` | boolean | | |
| `hasPriceDelta` | boolean | | Whether the receipt had an arithmetic cheaper-model delta line. |
| `hasSubagents` | boolean | | Whether subagent (child) transcripts were folded into the receipt's totals (SPEC-0061). A boolean, never a count. |
| `hasPreEditShare` | boolean | | Whether the receipt rendered a pre-edit cost-share line (SPEC-0067). A boolean, never the percentage, counts, or `$`. |
| `detailsView` | boolean | | Whether the receipt rendered the opt-in `--details` section. |
| `turnCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw turn count. |
| `toolCallCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw tool-call count. |
| `receiptOrdinalBucket` | enum | `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` \| `unavailable` | Lifetime local receipt ordinal bucket. |

```json
{
  "cliVersion": "0.11.0",
  "installHash": "unavailable",
  "isCI": false,
  "surface": "receipt",
  "agentType": "unknown",
  "multiAgent": false,
  "outputMode": "text",
  "template": "none",
  "pricedRowCoverage": "n/a",
  "hasStuckLoopWaste": false,
  "hasTrivialSpansWaste": false,
  "hasContextThrashWaste": false,
  "hasPriceDelta": false,
  "hasSubagents": false,
  "hasPreEditShare": false,
  "detailsView": false,
  "turnCountBucket": "0",
  "toolCallCountBucket": "0",
  "receiptOrdinalBucket": "1"
}
```

### `export_generated` — one per successful export path

| Field | Type | Values | Notes |
|---|---|---|---|
| `surface` | enum | `receipt` \| `compare` \| `week` \| `list` \| `pr` \| `backfill` | |
| `format` | enum | `json` \| `csv_session` \| `csv_tool` \| `svg` \| `png` \| `markdown` \| `html` \| `text` | |
| `wroteFile` | boolean | | False for stdout exports. |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

```json
{
  "surface": "receipt",
  "format": "json",
  "wroteFile": false,
  "result": "success"
}
```

### `pr_flow_completed` — one per `aireceipts pr` flow

| Field | Type | Values | Notes |
|---|---|---|---|
| `mode` | enum | `dry_run` \| `post` | |
| `artifactRequested` | boolean | | |
| `shareRequested` | boolean | | |
| `contributorCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw contributor count. |
| `commentResult` | enum | `success` \| `failed` \| `skipped` | |
| `artifactResult` | enum | `success` \| `failed` \| `skipped` | |
| `shareResult` | enum | `success` \| `failed` \| `skipped` | |
| `handoffSectionIncluded` | boolean | | SPEC-0059: the rendered body carried the handoff section (rendering rate only — never engagement, never contents). |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

```json
{
  "mode": "dry_run",
  "artifactRequested": false,
  "shareRequested": false,
  "contributorCountBucket": "0",
  "commentResult": "skipped",
  "artifactResult": "skipped",
  "shareResult": "skipped",
  "handoffSectionIncluded": false,
  "result": "success"
}
```

### `hook_configured` — one per hook install/uninstall command

| Field | Type | Values | Notes |
|---|---|---|---|
| `operation` | enum | `install` \| `uninstall` | |
| `promptOutcome` | enum | `accepted` \| `declined` \| `not_prompted` | |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

```json
{
  "operation": "install",
  "promptOutcome": "accepted",
  "result": "success"
}
```

### `integration_surface_rendered` — one per passive integration render

| Field | Type | Values | Notes |
|---|---|---|---|
| `integration` | enum | `statusline` \| `quota` | `mini` is a receipt, not an integration event. |
| `inputMode` | enum | `stdin_payload` \| `disk_fallback` \| `none` | |
| `payloadValid` | boolean | | Whether the stdin payload was usable for the integration. |
| `customFormat` | boolean (optional) | | statusline only (SPEC-0062): an explicit `--format` was passed. The boolean only — never the format string. |
| `scoped` | boolean (optional) | | statusline only (SPEC-0075 R6): `--cwd` was supplied. The boolean only — never the path. |
| `configFile` | boolean (optional) | | statusline only (SPEC-0075 R6): a valid `statusline.json` supplied the item order. The boolean only — never the items. |
| `cliVersion` | string (optional) | semver | Present on statusline and quota rows. |
| `installHash` | string (optional) | 64-hex sha256 or `unavailable` | Present on statusline and quota rows. |
| `isCI` | boolean (optional) | | Present on statusline and quota rows. |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

Scoped and unscoped statusline polls use the same rule: the queue is flushed only when non-empty. A statusline surface tuple is reported at most once per UTC hour in sequential execution. Quota rows are reported per run and carry the current run's identity trio. The trio remains optional in the shared schema for older payloads.

```json
{
  "integration": "statusline",
  "inputMode": "none",
  "payloadValid": false,
  "result": "no_data",
  "customFormat": false,
  "scoped": false,
  "configFile": false,
  "cliVersion": "0.11.0",
  "installHash": "unavailable",
  "isCI": false
}
```

### `activation_milestone` — once per milestone per local state file

| Field | Type | Values | Notes |
|---|---|---|---|
| `milestone` | enum | `first_run` \| `first_receipt` \| `third_receipt` \| `tenth_receipt` \| `first_export` \| `first_compare` \| `first_week` \| `first_hook_install` \| `first_pr` \| `first_pr_post` \| `first_artifact` | |
| `command` | enum | `backfill` \| `benchmark` \| `check-budget` \| `compare` \| `demo` \| `handoff` \| `help` \| `install-hook` \| `integrations` \| `list` \| `methodology` \| `mini` \| `pr` \| `quota` \| `receipt` \| `setup` \| `stats` \| `statusline` \| `telemetry-show` \| `templates` \| `uninstall-hook` \| `version` \| `week` | Command that caused the milestone. |
| `installAgeBucket` | enum | `first_day` \| `2-7d` \| `8-30d` \| `31-90d` \| `>90d` \| `unavailable` | Derived locally from `firstRunAt`; raw date is not sent. |

```json
{
  "milestone": "first_run",
  "command": "receipt",
  "installAgeBucket": "first_day"
}
```

### `statusline_heartbeat` — one completed UTC hour on a later poll

| Field | Type | Values | Notes |
|---|---|---|---|
| `cliVersion` | string | semver | From this package. |
| `os` | enum | `darwin` \| `linux` \| `win32` \| `other` | Coarse platform. |
| `nodeMajor` | integer | e.g. `22` | Major version only. |
| `installHash` | string | 64-hex sha256 or `unavailable` | Salted random install identity. |
| `isCI` | boolean | | CI marker. |
| `runOrdinalBucket` | enum | `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` \| `unavailable` | Lifetime run bucket at flush. |
| `pollCountBucket` | enum | `1` \| `2-10` \| `11-50` \| `51-200` \| `>200` | Completed hour polls. |
| `failedPollCountBucket` | enum | `0` \| `1` \| `2-10` \| `>10` | Thrown polls in completed hour. |
| `hourOffset` | enum | `1` \| `2` \| `3` \| `4` \| `5` \| `6` \| `7` \| `8` \| `9` \| `10` \| `11` \| `12` \| `13` \| `14` \| `15` \| `16` \| `17` \| `18` \| `19` \| `20` \| `21` \| `22` \| `23` \| `24` \| `>24` | Completed UTC hours between stored hour and flush hour. Arrival hour minus offset recovers the attributed hour except for `>24`. |

The counters are lock-free and last-write-wins. Under concurrent pollers, counts are lower bounds; an event can be duplicated or lost. A completed hour with no later poll is never sent. A state write failure records nothing and flushes nothing. An older CLI can erase unflushed current or completed hours. The heartbeat has no poll latency, exact hour or date field. Error rows represent distinct classes per hour; the failed-poll bucket counts every thrown poll.

```json
{
  "cliVersion": "0.11.0",
  "os": "linux",
  "nodeMajor": 22,
  "installHash": "unavailable",
  "isCI": false,
  "runOrdinalBucket": "2-3",
  "pollCountBucket": "2-10",
  "failedPollCountBucket": "0",
  "hourOffset": "1"
}
```

## Install identifier

On the first telemetry-enabled run, aireceipts creates a random UUID in `~/.aireceipts/state.json`. It is never derived from hostname, username, MAC address, machine id, repo, path, or transcript data. The wire payload carries only:

```text
sha256("aireceipts-install-v1:" + installId)
```

That hash intentionally links events from the same install over time so adoption and retention can be counted. It does not identify a person, machine, or repo. To reset it, delete `~/.aireceipts/state.json` and any `~/.aireceipts/state.json.corrupt-*` backups (they keep the bytes of an unparseable state file, which can include the old raw id). If `AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1` is active on a fresh install, no install id is created.

An unparseable state file is moved aside as `state.json.corrupt-<stamp>.<pid>.<random>` rather than silently replaced.

## Local counters

`~/.aireceipts/state.json` also stores local counters:

- `runCount`
- `receiptCount`
- `firstRunAt`
- once-only activation milestone booleans
- optional statusline UTC hour, poll and failed-poll counts, reported surface tuples and error classes

These exact counts stay on your machine. The `aireceipts stats` command prints the local receipt/run counters and labels them "on this machine." Telemetry payloads use only buckets.

## What is never sent

Permanently, structurally banned:

- Transcript content or any excerpt of it
- Prompts or user/assistant message text
- File paths
- Repo names or URLs
- Hostnames
- Usernames
- Session IDs
- Dollar amounts or cost/pricing data
- Raw model strings
- Raw counts
- Raw timestamps

## Kill switches

Either of the following disables telemetry completely. When disabled, `flushTelemetry()` returns immediately without making any network call, and fresh installs do not create an install id.

```bash
AIRECEIPTS_TELEMETRY=off aireceipts ...
# or: AIRECEIPTS_TELEMETRY=0 / AIRECEIPTS_TELEMETRY=false (case-insensitive)

DO_NOT_TRACK=1 aireceipts ...
```

### CI behavior (on by default)

Telemetry is **enabled by default in CI**, the same as any other environment — `CI` and
`GITHUB_ACTIONS` are not special-cased. Automated CI runs are counted; the `isCI` field (above)
records whether a run was in CI so CI vs. human usage stays distinguishable in the data. To turn
telemetry **off** in a CI environment, use a kill switch:

```bash
AIRECEIPTS_TELEMETRY=off aireceipts ...   # or DO_NOT_TRACK=1 — disables telemetry in CI or anywhere
```

Precedence is: `AIRECEIPTS_TELEMETRY=off`/`DO_NOT_TRACK=1` (always win) → the connection-string
checks below. (Before v0.7.0, telemetry defaulted **off** in CI; that default was reversed — see
SPEC-0002's 2026-07-08 amendment.)

## Inspecting what would be sent

```bash
aireceipts --telemetry-show
```

This prints whether telemetry is currently enabled and the exact events queued for the current run without sending anything. In a development build using the shipped connection, it reports `reason: "development-build"`. The command itself records nothing and skips the flush. It cannot preview a future hourly heartbeat; the validated event examples above show its shape. What it shows is the application payload, the `properties` of each event. It does not show the envelope's flush time or anything the receiving service sees or derives on its own (the sending IP and the coarse location derived from it, see "How sending works"), because those never exist inside the CLI.

## How sending works

- Events are queued in-process as they occur and sent as a single batched request at CLI shutdown.
- The send is bounded to **300ms**. If the network call is slow or hangs, it is abandoned; the CLI does not wait for it, and nothing is retried in the background.
- Every failure mode is swallowed inside the telemetry module. Telemetry can never throw, block the CLI, or change its exit code.
- The transport is Azure Application Insights, reached via a connection string (`InstrumentationKey=...;IngestionEndpoint=https://.../`) POSTed to `<ingestionEndpoint>/v2/track`.
- The App Insights wire format requires a `time` field per envelope; the sender stamps it client-side at flush (`src/telemetry/sender.ts`). It records when the batch was sent — not when your session ran, started, or ended. The "no timestamps" rule covers aireceipts' own event payload fields (`properties`), which carry only coarse buckets and no time fields.
- **Ingestion-side geolocation.** The receiving service sees the sending IP address. On the shipped Application Insights resource, Azure's default handling applies: the IP itself is masked (every stored row carries `0.0.0.0`) and a coarse location derived from it (country and city, sometimes state or province) is stored on the row before the address is discarded. aireceipts never sends, reads, or uses that field; it is not in the payload and `--telemetry-show` cannot show it, but it exists in the stored data. A custom resource set through `AIRECEIPTS_TELEMETRY_CONNECTION` follows that resource's own settings (Azure's `DisableIpMasking` option can retain the IP). If you do not want even a coarse location recorded, use a kill switch (`AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1`). Blanking the field at ingestion for the shipped resource is proposed in SPEC-0098; until that work ships, treat the coarse location as recorded.

## Connection-string honesty

- The ingestion key this package ships with is **not a secret**; Application Insights instrumentation keys are write-only and are commonly embedded in open-source clients. The shipped key: `InstrumentationKey=394da360-a50c-4700-bcf9-87b8d9d6e0ee` (ingestion endpoint `eastus-8.in.applicationinsights.azure.com`). <!-- gitleaks:allow -->
- `AIRECEIPTS_TELEMETRY_CONNECTION` overrides the shipped default. Set it to your own Application Insights resource or to an empty string to force-disable telemetry.
- With the shipped default connection string, a development build (`0.0.0` fallback version or package root containing `.git`) disables telemetry and creates no install id. An explicit `AIRECEIPTS_TELEMETRY_CONNECTION` override enables sends from that build. `--telemetry-show` reports whether it is disabled.
- A malformed connection string also degrades to `enabled: false` rather than sending to an incomplete endpoint.

## First-run notice

The first time `aireceipts` runs for a given user while telemetry is enabled, it prints a one-line disclosure pointing here, then persists `{ "shown": true }` to `~/.aireceipts/telemetry.json` so it never prints again. If `AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1` is active before that first enabled run, `aireceipts` prints no notice and does not persist the shown flag; the notice appears on the first later run where telemetry is enabled. If the notice file cannot be read or written, the notice is shown again on the next enabled run rather than failing the CLI.

## Source of truth

The schemas in `src/telemetry/schemas.ts` are the actual source of truth. This document is kept in sync with them and reviewed alongside any schema change.
