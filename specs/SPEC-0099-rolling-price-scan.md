---
id: SPEC-0099
title: Maintain one advisory price-scan issue
status: approved
milestone: M2
depends: [SPEC-0005]
---

# SPEC-0099: Maintain one advisory price-scan issue

## Purpose

Define the scheduled price tripwire and its rolling GitHub issue as a maintainer
workflow. SPEC-0005 left automatic price scanning out of scope; this spec gives
the issue's state transitions an explicit review and approval gate. The scan
reports third-party hints and never changes cited price rows. I1 keeps the
product path deterministic and offline, I2 and I3 keep vendor citations as the
only authority for dollars, I4 keeps transcript data local, I5 leaves receipts
unchanged, and I6 forbids model rankings.

## Requirements

- **R1 — Advisory scan.** A daily schedule and manual dispatch may fetch the
  community model-price dataset in CI. Drift, new model ids, dated snapshots,
  other-modality ids, and retired ids are reported separately. The scan never
  edits `data/prices/`, calls a model, or fetches data while rendering a receipt.
- **R2 — Canonical issue.** Search every page of open repository issues for the
  exact title `prices: drift/discovery report`; exclude pull requests. Select
  the lowest issue number as canonical and close later matching duplicates
  with a reference to it. Serialize scheduled and manual runs so they cannot
  create two canonical issues concurrently.
- **R3 — Drift or discovery.** When the scan completes with either finding
  status, update the canonical issue body with the full report and a link to
  the run, or create that issue if absent. Repeated scans update the same issue.
- **R4 — Clean.** When a successful scan finds no counted drift or discovery,
  close the canonical issue if present. Close duplicate reports as in R2.
  If no matching issue exists, do nothing.
- **R5 — Warning or failure.** A dataset fetch warning makes **no issue
  changes**, including no duplicate closure: zero counts do not establish a
  clean scan. A malformed summary or GitHub lookup/write failure fails the
  workflow visibly and cannot be interpreted as clean.
- **R6 — Scope and permissions.** The scheduled workflow has read-only
  contents permission and write permission only for issues. Its report is
  advisory; only a separately reviewed, vendor-cited price-table PR can alter
  receipt arithmetic.

## Scenarios

- **Given** no matching issue, **when** drift is reported, **then** create one
  report with the current run link.
- **Given** several matching issues, **when** discovery is reported, **then**
  update the oldest and close each newer duplicate against it.
- **Given** an open report, **when** a successful clean scan completes,
  **then** close it; a later discovery creates a new report.
- **Given** an open report, **when** the dataset fetch warns or fails,
  **then** leave its body, state, and duplicates untouched.

## Non-goals

Automatic price-row updates, historical rate inference, third-party prices as
vendor authority, a network call in the CLI product path, and per-run issues.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 advisory | Dataset with drift, snapshots, retired and other-mode ids | Distinct report groups; no table write |
| R2 canonical | Paginated issues including PRs and duplicate titles | Lowest matching issue retained; later matches closed |
| R3 update | Drift or discovery, with and without an open report | Edit or create one report with run link |
| R4 clean | Clean scan, with and without matching issues | Close existing matches or do nothing |
| R5 warning/failure | Fetch warning; malformed summary; GitHub API error | No issue mutation on warning; visible failure otherwise |
| R6 permissions | Workflow permissions and CI invocation | Only `contents: read`, `issues: write`; CLI remains offline |

## Success criteria

- [x] Maintainer approved this spec on 2026-09-22 before the rolling issue workflow merges.
- [ ] Transition cases in the test matrix are validated with mocked GitHub
      issue operations; no live issue is created during tests.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, ten-run determinism, spec lint, and
      hygiene pass unmasked; CI is green.
