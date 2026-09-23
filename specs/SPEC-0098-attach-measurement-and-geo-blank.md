---
id: SPEC-0098
title: "Attach-path measurement, invokedBy, and ingestion geolocation blank"
status: draft
milestone: M6
depends: [SPEC-0043, SPEC-0064, SPEC-0073, SPEC-0094]
---

# SPEC-0098: Attach measurement and geolocation blank (parked slice C of SPEC-0094)

## Purpose

The seamless PR-receipt attach flow behind the org rollout is unmeasurable. The hidden
`hook pre-push` path records nothing (`src/cli/index.ts:22-30`), `pr-check` is outside
the command enum, and there have been 0 `pr --post` rows since 2026-07-19 with the cause
unproven (maintainer vault, "App Insights deep dive", sections 10 and 14). Hook-driven
`mini` runs look identical to typed ones, so hook adoption, the only retention pattern
seen in external installs, cannot be counted apart. Ingestion geolocation (country on
all rows, city on most) is stored without being needed. This spec measures the attach
path, declares an invocation context, and tries to blank geo, on the SPEC-0043 rails:
bounded enums, booleans and the identity trio (`cliVersion`, `installHash`, `isCI`)
only, docs parity in the same PR (SPEC-0094 R4), kill switches winning. It was slice C
of SPEC-0094 and is parked behind two maintainer questions (see Validation).

Invariants touched: **I1** (bounded, fail-safe, the hook never blocks a push), **I4**
(content-free; the hook consent rule below), **I5** (no receipt changes).

## Requirements

- **R1. `pr_attach_completed` event.**
  - **R1a. Event.** `trigger` {`pre_push`, `ci`}; `result` {`attached`,
    `attached_push_failed`, `no_session`, `ref_write_failed`, `comment_posted`,
    `comment_found`, `missing_notice`, `missing_required`, `post_failed`,
    `invalid_context`, `internal_error`}; plus `cliVersion`, `installHash` and `isCI`.
    No repo, org, branch, PR number, ref name, remote URL, commit SHA, or error text. A
    test pins which results each trigger can produce. Exactly one event per attempted
    run; a thrown path records `internal_error`.
  - **R1b. Pre-push seam.** `pre_push` fires from `hook-pre-push` only after
    `shouldAttach` classifies a real branch push (`src/cli/commands/hook-pre-push.ts:147`).
    The hook's matcher is `Bash` (`src/hook/settings.ts:50`), so it runs on every agent
    shell call; non-push calls record nothing and never flush. `runPrDetailed` gains a
    structured `store=ref` outcome in `PrRunResult` (`src/pr/index.ts:86`); today the
    ref write and push report only through `deps.err` (`src/pr/index.ts:696-720`).
  - **R1c. Consent.** This amends the suppression contract (`src/cli/index.ts:22-30`;
    SPEC-0043's 2026-07-13 amendment). The hook still prints nothing, never writes a
    notice, records no `cli_run`, and exits 0 on every path. It sends
    `pr_attach_completed` only when `~/.aireceipts/telemetry.json` (under
    `AIRECEIPTS_HOME` when set) shows this user account has already seen the first-run
    notice. The hook's `network:` line in `integrations` (`src/setup/integrations.ts:124`)
    and `docs/telemetry.md` gain "sends one content-free event per branch push".
    Gated on open question 1.
  - **R1d. CI seam.** `ci` fires once per `pr-check` run
    (`src/cli/commands/pr-check.ts:152`); early returns and verdict paths each map to
    one result.
- **R2. `invokedBy` on `cli_run`.** {`human`, `hook`, `statusline_host`, `ci`}, a
  declared invocation context, never a verified one. Resolution order: `isCI` gives
  `ci`; `AIRECEIPTS_INVOKED_BY` of exactly `hook` or `statusline_host` gives that value,
  and any other value is ignored; a stdin payload the command already reads with
  `hook_event_name` gives `statusline_host` for `Status` and `hook` otherwise; else
  `human`. No command reads stdin only for telemetry. The installed SessionEnd command
  (`src/hook/settings.ts:8`) sets `AIRECEIPTS_INVOKED_BY=hook`; install, uninstall and
  idempotency keep recognizing the legacy string, so existing installs report `human`
  until `setup` or `install-hook` is re-run. `docs/telemetry.md` states both limits.
  Gated on open questions 2 and 3.
- **R3. Ingestion geolocation blank.** (plan decision 4(a)) Every envelope carries
  `tags: { "ai.location.ip": "0.0.0.0" }` (`src/telemetry/sender.ts:33`), a constant
  never derived from the machine. Microsoft documents that ingestion geolocates from the
  sender's IP unless this tag is set, so the effect must be observed. Gate: before
  merge, the maintainer sends one tagged envelope to the shipped resource and queries
  `client_City` and `client_CountryOrRegion` for it. If empty, `docs/telemetry.md`
  states that new versions store no geo and that the service still sees the HTTPS source
  IP. If not, R3 is dropped and decision 4 returns to the maintainer as option 4(b).
- **R4. Dataset additions.** `docs/internal/telemetry-datasets.md` (SPEC-0094 R5) gains:
  a declared-hook WAU series split by `invokedBy`, applied only at or above the first
  release carrying R2, with earlier rows as a `pre_invokedBy` series; and a CI dataset of
  `isCI=true` rows covering `pr_attach_completed` with `trigger=ci`. The SPEC-0094 KQL
  reference test extends to these blocks.

## Scenarios

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
- **Given** the controlled ingestion check shows geo still populated, **when** the PR is
  prepared, **then** R3 is dropped and the docs keep the disclosure.
- **Given** any path above under `DO_NOT_TRACK=1`, **when** it runs, **then** zero
  network calls occur.

## Non-goals

- **No repo, org, branch or PR identity on attach events.** Per-repo rollout attribution
  stays impossible from telemetry, by design.
- **No `commandClass` entries for `pr-check`, `pr-render-ref` or `hook-pre-push`.** The
  attach event measures the flow without turning every agent shell call into a
  `cli_run`.
- **No verified human-versus-hook attribution.** `invokedBy` is what the caller
  declares.
- **No geo claim before the ingestion check.** The docs state a result only after it is
  observed.

## Test matrix

| Requirement | Case | Expected |
|---|---|---|
| R1 | hook payloads: `git status`; heredoc; `cd x && git push`; `git push origin b` | only the last records; others record and flush nothing |
| R1 | hook push: notice file absent; present; present under `AIRECEIPTS_HOME` | nothing sent; one event; one event |
| R1 | hook outcomes: written and pushed; push failed; no session; write failed; thrown | `attached` / `attached_push_failed` / `no_session` / `ref_write_failed` / `internal_error`; exit 0, empty stdout and stderr |
| R1 | `pr-check`: posted; found; notice; required; post failed; missing context; thrown | matching `ci` result, exactly one event each |
| R1 | trigger and result pairing | `pre_push` never yields comment results; `ci` never yields ref results |
| R1 | leakage fixtures: branch, repo slug, SHA, URL, error text | schema rejects |
| R2 | CI env; env `hook`; env `bogus`; payload `Status`; payload `SessionEnd`; none | `ci`; `hook`; falls through; `statusline_host`; `hook`; `human` |
| R2 | install and uninstall with legacy and new SessionEnd strings | both recognized; install writes the new string once |
| R3 | envelope snapshot | `tags["ai.location.ip"] === "0.0.0.0"` on every envelope; `properties` unchanged |
| R4 | added KQL blocks | every referenced event and field exists in the schemas |
| All | `AIRECEIPTS_TELEMETRY=off` and `DO_NOT_TRACK=1` on every new path | 0 fetch calls |

## Success criteria

- [ ] Open questions 1 to 3 answered by the maintainer (button 1) before any build.
- [ ] Every matrix row above is green in the unmasked gate.
- [ ] `docs/telemetry.md` documents `pr_attach_completed`, `invokedBy` and its limits,
      and the hook's per-push send, with example payloads, enforced by SPEC-0094 R4.
- [ ] R3's controlled ingestion check is recorded in the PR with its outcome.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs` and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Tombstone

Parked, not rejected. Split out of SPEC-0094 on 2026-09-22 so that spec could carry a
single `build now` verdict. It returns as a build candidate once the maintainer answers
the open questions below. If the answer to question 1 is "no hook sends", R1's
`pre_push` half is cut and the `ci` half can ship alone.

## Validation

**2026-09-22 · S1 (self).** Every field is a bounded enum or an identity field SPEC-0043
permits. Self-found in SPEC-0094 revision 1: the `Bash` matcher would record on every
agent shell call, so R1b records only classified pushes; the hook cannot disclose on its
own, so R1c requires a prior notice.

**2026-09-22 · S2 (Codex, independent, read-only, carried from SPEC-0094 revision 1).**
- Accepted (7): the attach result was not available from `runPrDetailed`. R1b adds a
  structured `store=ref` outcome; R1a and R1d require one event per run, thrown paths
  included.
- Partially accepted (8, blocker): a notice file proves the account saw the notice, not
  that the person triggering a committed hook did. The rule was kept because the
  SessionEnd `--mini` hook already sends `cli_run` under the same notice, with added
  disclosure. The consent judgment is open question 1.
- Accepted (10): R3 is a gated experiment with a controlled ingestion check.
- Rejected with narrowing (13, "cut `invokedBy`"): it is labeled a declared context and
  legacy hooks report `human`. It remains the weakest requirement; open question 2.
- Partially accepted (14, worth): this slice was the one the critic's scope attack hit
  hardest, and it is now parked.

**2026-09-22 · S3 (worth).**
- **Who and how often.** The maintainer, when judging the org rollout (12 org clones
  with hooks) and hook adoption. That is a few decisions a quarter, not every release.
- **Do-nothing.** The attach rate stays unknown; the plan's manual org-repo check can
  answer the immediate question once. Geo stays stored but is disclosed in the docs.
- **Smaller fix.** For attach, the manual check. For geo, disclosure alone (option 4(b)).
- **Steelman the cut.** R1 adds a network send to a silent hook that users of a
  committed kit never ran knowingly; R2's labels are caller assertions that invite
  over-reading; R3 rests on unverified vendor behavior. Each has a cheap non-feature
  alternative.
- **Kill criterion dry-run.** No evidence yet. Cheapest experiments: the manual attach
  check, and one tagged envelope to the shipped resource.
- **Verdict: defer.** Reasons: the consent question is a maintainer judgment the spec
  cannot settle; `invokedBy` is contested by the independent critic; the geo blank is
  unproven; and the manual attach check may answer the rollout question without code.

**Open questions for the maintainer (the gate).**
1. Is the account-level notice enough consent for the committed pre-push hook to send
   (R1c), or should the hook stay network-free until a per-repo opt-in exists?
2. Keep `invokedBy` (R2) as a declared context, or cut it, as the critic argues?
3. Should the installed SessionEnd command change at all? Changing it rewrites adopters'
   `settings.json` on the next `setup`.

**2026-09-22 · S4.** `node scripts/spec-lint.mjs specs/SPEC-0098-attach-measurement-and-geo-blank.md`
exits 0.
