# App Insights telemetry deep dive (2026-09-22)

Scope: every event in the dedicated `aireceipts` Application Insights resource
(`rg-aireceipts`, appId `27aef4ec-bd68-44e1-968b-913ddc5ed538`) from the first
event (2026-07-02T15:29Z) to 2026-09-22T19:46Z, 82 days. This extends the
2026-07-13 onboarding read in the vault (`Research/aireceipts-onboarding/Onboarding
funnel, App Insights deep dive (2026-07-13).md`); where that read gave a number,
the then-vs-now comparison is stated inline.

All queries were run with:

```sh
az monitor app-insights query --app 27aef4ec-bd68-44e1-968b-913ddc5ed538 \
  --offset 90d --analytics-query "<KQL>" -o json
```

Raw outputs and every KQL file are in the session scratchpad (`q/*.kql`,
`out/*.json`, `out/cohort2.txt`). Small N is the rule in this dataset. N is
stated next to every rate, and any rate with N under 30 should be read as a
direction, not a measurement.

## Executive summary

1. **Retention deadline: 8 days.** The resource keeps data for 90 days
   (`retentionInDays: 90`). Launch-fortnight data (2026-07-02 to 07-18, which holds
   57% of all `receipt_generated` rows and 83% of `pr_flow_completed` rows) starts
   purging on about 2026-09-30. Export it now.
2. **Acquisition has stalled.** Excluding maintainer, CI, the 2026-07-11 matrix
   sweep and an install-id churn artifact, there were 36 new organic installs in
   the launch fortnight (Jul 5 to 18) and **7 in the 9 weeks since**. Weekly
   `first_run` milestones fell from 42 and 21 to between 0 and 2 per week.
3. **Install counts are inflated by an id-churn bug.** 124 real install hashes
   exist, but 53 belong to one darwin/Node 26 machine. 47 of them first appear
   with `runOrdinalBucket=unavailable`, which the code emits only when
   `state.json` exists but fails to parse. Each parse failure mints a fresh
   install id. Realistic count: about 40 to 45 distinct organic machines in 82 days.
4. **99.6% of events and bytes are statusline polling.** 413,607 of 415,228
   `cli_run` rows are statusline, and every poll also emits an
   `integration_surface_rendered` twin (413,602 rows). Only 1,621 `cli_run` rows
   are non-statusline, and 698 of those are the maintainer's.
5. **Retention lives only in always-on surfaces.** Every install active 7 or more
   distinct days is a statusline poller (4 unknown-owner installs with 18 to 66
   active days, the maintainer, and the Node 26 machine) or a hook user (`5c00904e`, 69 active days, still pinned to v0.8.0). Organic cohort
   week+1 retention was 1 of 19 (Jul 5 cohort) and 3 of 17 (Jul 12 cohort).
6. **Price coverage has collapsed.** Among receipts with at least one tool call,
   the share with zero priced rows rose from 4.4% in July (23 of 522) to 41% in
   August (56 of 136) and 56% in September (58 of 104). Price tables were last
   touched 2026-07-12. When coverage is `none`, the cheaper-model delta line
   disappears every time (238 of 238).
7. **No release in 10 weeks.** v0.11.0 was tagged 2026-07-13 and is the newest
   version in the data. Even a price refresh on `main` reaches nobody until a
   release ships. v0.10.0 (73,836 events) and v0.8.0 (hook-pinned) are still
   active this week.
8. **`pr --post` is dead in the field.** `pr_flow_completed` with `mode=post`: 224
   rows in the first two weeks and 0 since 2026-07-19. All 62 later
   `pr_flow_completed` rows are `dry_run`, and every `pr` `cli_run` since
   2026-07-19 comes from the maintainer install.
9. **Statusline latency tail.** 6.2% of 413,651 statusline polls take 2 to 10s
   and 0.39% take more than 10s. The tail is install-specific: 17.5% of polls on
   one linux install (N=19,446) and 8.4% on one Node 20 install (N=104,510) are
   2 to 10s, against 0% on another (N=4,922).
10. **Two telemetry fields are dead.** `cli_run.agentType` is `unknown` on 100%
   of 415,228 rows (hard-coded `undefined` at `src/cli/index.ts:43`).
   `parse_failure` has no caller anywhere in `src/`, so its 0 rows mean "not
   instrumented", not "no parse failures". Cost today is $0: about 0.21 GB a
   month against a 5 GB free allowance.

## 1. Volume over time

```kql
customEvents | summarize n=count() by name | order by n desc
customEvents | summarize n=count() by week=startofweek(timestamp), name
customEvents | where name=="cli_run"
| extend cc=tostring(customDimensions.commandClass)
| extend human=iff(cc=='statusline','statusline','human')
| summarize n=count() by week=startofweek(timestamp), human
```

| Event | 82-day rows | First seen |
|---|---:|---|
| cli_run | 415,228 | 2026-07-02 |
| integration_surface_rendered | 413,602 | 2026-07-05 |
| receipt_generated | 872 | 2026-07-05 |
| pr_flow_completed | 358 | 2026-07-05 |
| activation_milestone | 151 | 2026-07-05 |
| export_generated | 64 | 2026-07-06 |
| hook_configured | 7 | 2026-07-05 |
| card_generated | 2 | 2026-07-11 |
| cli_error | 0 | never |
| parse_failure | 0 | never |

| Week of | statusline cli_run | non-statusline cli_run | receipt_generated |
|---|---:|---:|---:|
| Jun 28 | 0 | 247 | 0 |
| Jul 5 | 19,920 | 680 | 357 |
| Jul 12 | 12,540 | 283 | 138 |
| Jul 19 | 25,038 | 21 | 21 |
| Jul 26 | 24,380 | 67 | 64 |
| Aug 2 | 36,349 | 47 | 42 |
| Aug 9 | 30,995 | 20 | 16 |
| Aug 16 | 44,500 | 40 | 35 |
| Aug 23 | 43,008 | 61 | 59 |
| Aug 30 | 65,048 | 77 | 73 |
| Sep 6 | 51,346 | 32 | 32 |
| Sep 13 | 42,972 | 25 | 20 |
| Sep 20 (partial) | 17,511 | 24 | 15 |

Non-statusline `cli_run` rows by install class (classification in section 2):

| Class | Installs | Non-statusline runs | Statusline runs |
|---|---:|---:|---:|
| Maintainer (`8859335b`, `fd5de25e`, `bb0f1580`) | 3 | 698 | 96,753 |
| Empty hash (v0.1.x, pre-install-id) | 1 | 312 | 0 |
| Organic candidates | 39 | 463 | 18 |
| Node 26 churn machine | 53 | 105 | 8,273 |
| Heavy statusline installs, owner unknown | 4 | 14 | 308,501 |
| 2026-07-11 matrix sweep | 14 | 21 | 0 |
| CI one-offs | 11 | 11 | 0 |

**Reading.** Statusline volume grew about 3x from July to September while
everything a person types fell by roughly 10x after launch week. The "true human
command" count is 1,621 non-statusline runs, and only about 460 of them come from
installs that are not the maintainer, a sweep, CI, or the churn machine. Of those
460, 144 are hook-driven `mini` runs from one install (`5c00904e`). Typed
commands by external users number in the low hundreds over 82 days. Compared
with 2026-07-13: that read counted 178 successful human receipt runs in 11 days.
There were 216 successful `receipt` runs in 82 days in total, so almost all of
them happened in the first two weeks.

## 2. Installs, new installs, retention

```kql
customEvents | where name=="cli_run"
| extend ih=tostring(customDimensions.installHash), cc=tostring(customDimensions.commandClass)
| summarize n=count() by ih, week=startofweek(timestamp), hum=(cc!='statusline')
// plus per-install fs=min(timestamp), ls=max(timestamp), dcount(bin(timestamp,1d)),
// os, nodeMajor, isCI, cliVersion; joined offline (scratchpad cohort.py)
```

Note: `summarize first=min(timestamp)` fails with `BadArgumentError` because
`first` and `last` are reserved. Use `fs` and `ls` as the aliases.

**Install census (N=126 distinct `installHash` values):**

| Class | Installs | How identified |
|---|---:|---|
| Real 64-hex hashes | 124 | |
| Empty string (v0.1.0 to 0.1.2, before install ids) | 1 | 312 events, still active on 2026-09-21 on v0.1.0 |
| `unavailable` | 1 | 67 statusline events, 0.02% of `cli_run` |
| Node 26 darwin machine, first seen on or after 2026-08-14 | 53 | see below |
| 2026-07-11 linux version-matrix sweep | 14 | same as the 2026-07-13 read |
| `isCI=true` one-offs | 11 | 1 event each |
| Maintainer | 3 | |
| Heavy statusline, owner unknown | 4 | 18 to 66 active days, 2 to 5 human commands each |
| Organic candidates | 39 | the rest |

**The Node 26 churn machine.** The long-lived Node 26 installs hand over to one
another exactly on burst days: `17a5c9f9` (Aug 14 to 18), then a burst of 9 to 13
new hashes an hour on Aug 18 to 21, then `aea6abe2` (Aug 21 to 26), `0164aa0e`
(Aug 26 to Sep 10), a burst of 17 on Sep 10, and `62b960df` (Sep 10 to now). 47 of
the 55 Node 26 installs report `runOrdinalBucket=unavailable` on their first
event. In `src/telemetry/index.ts:304` that value with a real hash only happens
when `readStateWithMeta` returned `recovered: true`: the file existed but failed
`parseState` (bad JSON, `schemaVersion !== 1`, or invalid counters). The code then
starts from `freshState()` and `ensureInstallId` mints a new UUID. Something on that
machine rewrites `~/.aireceipts/state.json` in a shape the released parser
rejects. Likely candidates are a dev build with a different state shape, a test
using the real HOME, or a truncated write. Every rewrite creates a phantom
install. It also suppresses the `first_run` milestone, which is why milestones
undercount installs.

**Weekly new and active installs (clean = organic candidates plus the 4 heavy statusline installs):**

| Week of | New (all hashes) | Active (all) | New (clean) | Active (clean) | Clean with a human command |
|---|---:|---:|---:|---:|---:|
| Jul 5 | 43 | 43 | 19 | 19 | 18 |
| Jul 12 | 21 | 25 | 17 | 18 | 18 |
| Jul 19 | 0 | 5 | 0 | 4 | 2 |
| Jul 26 | 2 | 6 | 2 | 5 | 3 |
| Aug 2 | 0 | 5 | 0 | 4 | 1 |
| Aug 9 | 1 | 6 | 0 | 4 | 1 |
| Aug 16 | 34 | 40 | 1 | 5 | 2 |
| Aug 23 | 5 | 11 | 3 | 7 | 4 |
| Aug 30 | 1 | 8 | 1 | 6 | 3 |
| Sep 6 | 17 | 24 | 0 | 5 | 1 |
| Sep 13 | 0 | 7 | 0 | 5 | 1 |
| Sep 20 | 0 | 6 | 0 | 4 | 0 |

**Retention cohorts (clean installs, by week first seen):**

| Cohort | Size | Active wk+1 | wk+2 | wk+4 | Active in 2 or more weeks |
|---|---:|---:|---:|---:|---:|
| Jul 5 | 19 | 1 | 1 | 1 | 1 |
| Jul 12 | 17 | 3 | 2 | 2 | 3 |
| Jul 26 | 2 | 1 | 1 | 1 | 1 |
| Aug 16 | 1 | 0 | 0 | 0 | 0 |
| Aug 23 | 3 | 1 | 0 | 0 | 1 |
| Aug 30 | 1 | 1 | 1 | 0 | 1 |

Other counts: 42 of 43 clean installs ran at least one non-statusline command. 7
of 43 were seen on 2 or more days. CI: 11 installs and 11 events (0.003% of
`cli_run`). `isCI` is empty on the 312 v0.1.x rows.

**Reading.** Organic weekly active installs have been flat at 4 to 7 machines
since late July, and 4 of them are the heavy statusline installs. After the launch
fortnight there is no acquisition engine. Seven new organic installs in nine
weeks is noise-level. The 2026-07-13 read's estimate of "25 to 30 organic
installs in 11 days" holds up (36 clean installs first seen in weeks Jul 5 and Jul
12). Its "one retained external install took the hook path" finding has grown
stronger. `5c00904e` is still running hook-driven `mini` 10 weeks later, and every
other retained install is a statusline poller.

## 3. Version adoption

```kql
customEvents | where name=="cli_run"
| extend v=tostring(customDimensions.cliVersion), ih=tostring(customDimensions.installHash)
| summarize installs=dcount(ih) by v
// and: last 14 days, by v, ih, commandClass
```

| Version | Events | Installs | Still active in the last 14 days |
|---|---:|---:|---|
| 0.11.0 (tagged 2026-07-13) | 317,072 | 70 | yes, 23 installs |
| 0.10.0 | 73,836 | 4 | yes, maintainer install, 18,822 events |
| 0.8.0 | 258 | 4 | yes, `5c00904e` hook `mini`, 15 events |
| 0.1.0 | 300 | 1 (empty hash) | yes, 14 events this fortnight |
| 0.2.0 to 0.9.1 | about 24,000 | 1 to 9 each | no |
| 0.0.0 (dev build) | 16 | 1 | no |

**Reading.** Upgrade speed can't be measured because nothing has shipped since
v0.11.0 on 2026-07-13. All 70 installs first seen after that date are on 0.11.0.
Stuck installs are real and belong to the most engaged users. The only retained
external hook user is pinned at 0.8.0, which predates the cost-accuracy floors and
the v0.9 to v0.11 fixes. The maintainer statusline still runs 0.10.0, and someone
still runs 0.1.0. The pinned hook version is the likely mechanism for the 0.8.0
case. That install's receipts use July-8 price tables and v0.8 cost logic
indefinitely.

## 4. Platform

```kql
customEvents | where name=="cli_run"
| summarize installs=dcount(tostring(customDimensions.installHash)), n=count()
  by os=tostring(customDimensions.os), nm=tostring(customDimensions.nodeMajor)
```

| os | Node | Installs | Events |
|---|---:|---:|---:|
| darwin | 26 | 55 | 8,539 |
| linux | 22 | 42 | 74 |
| darwin | 22 | 16 | 97,579 |
| darwin | 25 | 5 | 184,598 |
| darwin | 20 | 5 | 105,006 |
| darwin | 24 | 4 | 10 |
| linux | 24 | 2 | 19,448 |
| linux | 20 | 2 | 17 |

App Insights geo (IP-derived at ingestion, installs): United States 76, Hong Kong
31, Japan 12, India 7, and 1 each for Netherlands, Jordan, Ireland and the
Philippines.

**Reading.** Zero `win32` installs in 82 days. Node 26 looks dominant only
because of the churn machine. Without it, darwin on Node 22 and 25 carries the
real users. Linux Node 22 installs are almost all one-event containers (the
matrix sweep and CI). Node 20 is still in real use (`4c2fe5c7`, 104K events) and
also has one of the worst statusline latency tails (section 11). IP masking works:
`client_IP` is `0.0.0.0` or the all-zero IPv6 on 100% of rows. Country and city,
however, are stored by default and not disclosed in `docs/telemetry.md`.

## 5. Agent mix

```kql
customEvents | where name=="cli_run"
| summarize n=count() by at=tostring(customDimensions.agentType)
customEvents | where name=="receipt_generated"
| summarize n=count() by week=startofweek(timestamp), at=tostring(customDimensions.agentType)
```

| agentType | cli_run | receipt_generated, all time | receipt_generated since Jul 19 |
|---|---:|---:|---:|
| claude-code | 0 | 568 | 316 |
| codex | 0 | 165 | 38 |
| cursor | 0 | 3 | 2 |
| unknown | 415,228 (100%) | 136 | 21 |
| gemini, opencode | 0 | 0 | 0 |

**Reading.** `cli_run.agentType` carries no information. Every call site passes
`agentType: undefined` (`src/cli/index.ts:43` and `:55`), so the field is dead
weight on 415K rows. From `receipt_generated`, Claude Code is 84% of receipts
since 2026-07-19 (N=377). Codex fell from 26% of launch-fortnight receipts (127 of 495) to
10%, and Gemini and opencode have never produced a receipt. The 2026-07-13 read
flagged the same `cli_run.agentType` gap. It is unchanged.

## 6. Command mix and outcomes

```kql
customEvents | where name=="cli_run"
| extend cc=tostring(customDimensions.commandClass), ok=tostring(customDimensions.ok),
         ec=tostring(customDimensions.exitClass), v=tostring(customDimensions.cliVersion)
| where cc!='statusline' | summarize n=count() by cc, ok
// failures: | where ok=='false' | summarize n=count() by cc, ec, v
```

| Command | Runs | Installs | ok=false | Fail rate |
|---|---:|---:|---:|---:|
| mini | 419 | 19 | 0 | 0% |
| pr | 358 | 6 | 61 | 17% |
| receipt | 309 | 56 | 93 | 30% |
| other (v0.1.x only) | 223 | 1 | 26 | 12% |
| help | 85 | 28 | 0 | 0% |
| version | 51 | 13 | 0 | 0% |
| list | 40 | 10 | 0 | 0% |
| demo | 31 | 8 | 0 | 0% |
| week | 27 | 8 | 0 | 0% |
| check-budget | 21 | 5 | 0 | 0% |
| handoff | 16 | 6 | 5 | 31% |
| compare | 8 | 5 | 4 | 50% |
| install-hook | 7 | 5 | 0 | 0% |
| setup | 6 | 5 | 0 | 0% |
| integrations | 3 | 3 | 0 | 0% |
| stats, quota, methodology, backfill, templates | 4 each | 2 to 4 | 0 | 0% |
| statusline | 413,607 | 67 | 6 | 0.001% |

`exitClass` values seen: `no-session-match` 14 times (12 `pr` on 0.10.0 by the
maintainer, 1 `receipt` on 0.10.0, 1 `receipt` on 0.11.0). Every other failure is
from versions before `exitClass` existed.

**Reading.** On current versions the failure problem is almost gone: 2 failed
`receipt` runs on 0.10.0 or later. That is mostly because very few external users
run `receipt` any more. `setup` (6 runs) and `integrations` (3) are now counted
(#257 shipped in 0.11.0) and confirm what the 2026-07-13 read suspected: almost
no one reaches them. `help` is still the second most-reached surface by install
count (28 installs), as before. `other` is a pre-catalog v0.1.x class that the
docs enum does not list.

## 7. Errors

```kql
customEvents | where name in ("cli_error","parse_failure") | summarize count() by name
```

Result: 0 rows for both, in 82 days.

**Reading.** `cli_error` is wired (`src/cli/index.ts:55`) and zero means no
thrown top-level errors reached a flush. That is plausible given the controlled
exit design, but it can't be confirmed from the data. `parse_failure` is not
wired. `recordParseFailure` in `src/telemetry/index.ts:128` has no caller (the
only mention is a comment in `src/telemetry/signature.ts:9`). Adapter drift, such
as a Claude Code or Codex transcript format change, is invisible. The coverage
collapse in section 8 is exactly the kind of drift this event would localize.
There are no top signatures to fix because no signatures exist.

## 8. Receipt quality: price coverage

```kql
customEvents | where name=="receipt_generated"
| where tostring(customDimensions.toolCallCountBucket)!='0'
| summarize n=count() by m=startofmonth(timestamp), pc=tostring(customDimensions.pricedRowCoverage)
```

Caveat found while querying: a receipt with zero tool rows reports
`pricedRowCoverage=none`. 90 of the 98 zero-tool `mini` receipts are `none`, so
the raw metric overstates the gap. The table below excludes zero-tool receipts.

| Month | all | some | none | none share | N |
|---|---:|---:|---:|---:|---:|
| July | 481 | 18 | 23 | 4.4% | 522 |
| August | 72 | 8 | 56 | 41.2% | 136 |
| September (to 22nd) | 45 | 1 | 58 | 55.8% | 104 |

Since 2026-07-19, with tool calls, by agent and surface:

| Agent | Surface | all | some | none |
|---|---|---:|---:|---:|
| claude-code | mini | 112 | 8 | 85 |
| claude-code | pr | 2 | 0 | 22 |
| codex | mini | 11 | 0 | 15 |
| cursor | receipt | 0 | 0 | 2 |
| unknown (multi) | pr | 16 | 5 | 0 |

`hasPriceDelta` against coverage: `none` gives delta false 238 of 238 times, and
`all` gives delta true 605 of 607 times.

**Reading.** More than half of recent real receipts price zero rows. That
matches the price tables: `data/prices/` was last changed 2026-07-12. The
Anthropic table has `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5` and
`claude-haiku-4-5`, but not `claude-fable-5-1` or `claude-opus-5-5`. The Google
table stops at `gemini-2.5-*`. Codex is affected too (15 of 26 recent Codex
`mini` receipts are `none`). The cost is not only a blank dollar figure. The
cheaper-model delta, the headline insight line, silently disappears.
`receipt_generated` has neither `cliVersion` nor `installHash`, so the gap can't
be split between "table missing the model" and "user pinned to 0.8.0"
(`5c00904e` produces most `mini` receipts). Both have the same fix: refresh and
release.

## 9. Waste lines and receipt shape

```kql
customEvents | where name=='receipt_generated'
| summarize n=count() by sf=tostring(customDimensions.surface), val=tostring(customDimensions.<flag>)
```

Flag hit rates over all 872 receipts (the denominator excludes empty values for
fields added later):

| Flag | true | Rate | Notes |
|---|---:|---:|---|
| hasPriceDelta | 624 | 71.6% of 872 | tracks price coverage exactly |
| hasPreEditShare | 561 | 84.4% of 665 | |
| hasTrivialSpansWaste | 158 | 18.1% of 872 | 82 of them on `mini` |
| hasSubagents | 104 | 14.1% of 740 | |
| hasStuckLoopWaste | 46 | 5.3% of 872 | |
| hasContextThrashWaste | 9 | 1.0% of 872 | |
| detailsView | 6 | 0.8% of 749 | all on the `receipt` surface |

| Surface, outputMode, template | Receipts |
|---|---:|
| mini, text | 417 |
| pr, markdown (multi-agent) | 205 |
| pr, markdown (single) | 102 |
| receipt, text | 102 |
| receipt, json | 27 |
| receipt, csv | 6 |
| receipt, svg or png | 5 |
| receipt with `grocery` or `datavis` template | 4 |
| compare | 4 |

Shape: `mini` has 90 of 417 (22%) receipts with 0 or 1 turns and 0 tool calls.
`receiptOrdinalBucket` is `>50` for 221 of 417 `mini` and 258 of 307 `pr`
receipts, which means a few heavy users produce most receipts.

**Reading.** Context thrash fires on 1% (N=872) and stuck loop on 5%. They rarely
earn their line. Trivial spans fire on 18%. Templates and `--details` are nearly
unused: 4 and 6 receipts. About a fifth of hook-driven `mini` receipts are for
empty sessions, where a receipt adds noise and pulls coverage down to `none`.
Since 2026-07-19 the `receipt` surface itself produced 3 receipts. The product is
now used almost entirely through `mini` (the hook) and `pr` (the maintainer).

## 10. Funnel

```kql
customEvents | where name=='activation_milestone'
| summarize n=count() by ms=tostring(customDimensions.milestone), c=tostring(customDimensions.command), ab=tostring(customDimensions.installAgeBucket)
customEvents | where name=='pr_flow_completed'
| summarize n=count() by mode=tostring(customDimensions.mode), r=tostring(customDimensions.result), cr=tostring(customDimensions.commentResult), ccb=tostring(customDimensions.contributorCountBucket)
```

| Milestone | Count | Launch fortnight | Since Jul 19 |
|---|---:|---:|---:|
| first_run | 69 | 63 | 6 |
| first_receipt | 30 | 17 | 13 |
| third_receipt | 13 | 9 | 4 |
| tenth_receipt | 11 | 8 | 3 |
| first_week | 8 | 7 | 1 |
| first_export | 6 | 6 | 0 |
| first_hook_install | 5 | 4 | 1 |
| first_pr / first_pr_post | 3 / 2 | all | 0 |
| first_compare | 3 | all | 0 |
| first_artifact | 1 | 1 | 0 |

`first_run` came from `receipt` 44 times, `help` 9, `version` 9, `list` 2,
`statusline` 2, and `demo`, `week` and `mini` once each. `installAgeBucket` is
`first_day` or `2-7d` on every row except one `8-30d`.

`hook_configured` (N=7): 6 install successes (5 accepted, 1 not prompted) and 1
declined. There have been no uninstalls. The last one was on
2026-08-14.

`pr_flow_completed` (N=358):

| mode | result | commentResult | Rows |
|---|---|---|---:|
| post | success | success | 192 |
| dry_run | success | skipped | 105 |
| dry_run | no_data | skipped | 27 |
| post | no_data | skipped | 22 |
| post | external_failed | failed | 9 |
| dry_run | invalid_args | skipped | 2 |
| post | external_missing | failed | 1 |

By week, `post` had 201 rows (week of Jul 5), 23 (Jul 12) and **0 every week
after**. `dry_run` had between 2 and 22 rows a week through Aug 30. All `pr`
`cli_run` rows since 2026-07-19 come from install `8859335b` (the maintainer).
`contributorCountBucket`: `2-3` 138, `1` 102, `4-10` 67, `0` 51. Artifact
requested 7 times, share requested once.

`export_generated` (N=64, all `success`): receipt JSON 27, list JSON 12, pr HTML 6,
week JSON 4, receipt SVG 4, CSV 6, and 5 others.

`card_generated` (N=2, 2026-07-11, fields `format=svg`, `scope=session`,
`theme=light`, `linkIncluded=false`, `clipboardImageCopied=false`) is not in
`src/telemetry/schemas.ts` on `main`, nor in `docs/telemetry.md`. It came from
an unmerged branch build (the SPEC-0077 card work) that sent to the production
connection string.

**Reading.** In 82 days, 5 installs reached a hook install and 2 reached a
posted PR receipt. After launch, the funnel is 6 first runs and 13 first
receipts. The `pr --post` result is striking given the 2026-07 org rollout: the
12 org clones with pre-push hooks produced zero `post` rows. The hidden
`hook pre-push` path records nothing by design (`docs/telemetry.md`), so the
attach flow is unmeasured. Either it is not posting or it is posting invisibly.
Both need fixing: the first as a bug, the second as a gap.

## 11. Performance

```kql
customEvents | where name=="cli_run"
| extend cc=tostring(customDimensions.commandClass), db=tostring(customDimensions.durationBucket),
         v=tostring(customDimensions.cliVersion), ih=substring(tostring(customDimensions.installHash),0,8)
| where cc=='statusline' | summarize n=count() by ih, v, db
```

| Command | N | <100ms | 100-500ms | 500ms-2s | 2-10s | >10s |
|---|---:|---:|---:|---:|---:|---:|
| statusline | 413,651 | 44.6% | 32.8% | 16.0% | 6.2% | 0.39% |
| mini | 419 | 39% | 20% | 32% | 8.6% | 0% |
| receipt | 309 | 57% | 11% | 14% | 15% | 3.2% |
| pr | 358 | 4% | 0% | 7% | 76% | 13% |
| week | 27 | 11% | 11% | 7% | 41% | 30% |
| list | 40 | 45% | 0% | 40% | 7.5% | 7.5% |

Statusline 2-10s share by install:

| Install | Version, Node, os | Polls | 2-10s | >10s |
|---|---|---:|---:|---:|
| 6790631a | 0.11.0, 24, linux | 19,446 | 17.5% | 0% |
| 8859335b | 0.10.0, 22, darwin | 73,668 | 10.9% | 1.5% |
| 4c2fe5c7 | 0.11.0, 20, darwin | 104,507 | 8.4% | 0.42% |
| 96cc3076 | 0.11.0, 25, darwin | 132,997 | 2.9% | 0.02% |
| b1f1441c | 0.11.0, 25, darwin | 51,556 | 2.7% | 0% |
| 62b960df | 0.11.0, 26, darwin | 4,922 | 0% | 0% |

By version, statusline 2-10s is 10.9% on 0.10.0 (N=73,668) and 5.5% on 0.11.0
(N=316,855). That difference is confounded by install, because 0.10.0 is one
machine.

**Reading.** The statusline is polled by Claude Code, so a 2 to 10s poll is a
visibly stale or blocked status bar. About 25,500 polls fell in that bucket. The
tail tracks the machine, not the release, which points at per-poll transcript
parsing cost that scales with session size rather than at a code regression. No
version-over-version regression can be shown because there has been only one
release since July.

## 12. Integration surface

```kql
customEvents | where name=="integration_surface_rendered"
| summarize n=count() by it=tostring(customDimensions.integration), im=tostring(customDimensions.inputMode),
  pv=tostring(customDimensions.payloadValid), r=tostring(customDimensions.result)
```

| integration | inputMode | payloadValid | result | Rows |
|---|---|---|---|---:|
| statusline | stdin_payload | true | success | 412,579 |
| statusline | disk_fallback | false | success | 1,064 |
| quota | none | false | no_data | 4 |
| statusline | none | false | no_data | 3 |
| statusline | stdin_payload | false | no_data | 1 |

Options: `customFormat=true` on 133,031 rows (32%, essentially one install),
`configFile=true` on 0 rows, `scoped=true` on 0 rows (expected, since scoped
polls skip the flush). About 17,600 July rows predate the optional fields.

**Reading.** The surface is healthy, with a 99.99% success rate and 0.26% disk
fallback. Row for row it duplicates `cli_run` (`commandClass=statusline`), so it
doubles cost for about 2 bits of information per poll. `statusline.json`
(SPEC-0075 R6) has 0 observed users, and `quota` has 4 runs.

## 13. Telemetry cost and hygiene

```kql
customEvents | summarize b=sum(_BilledSize) by name
customEvents | summarize b=sum(_BilledSize) by m=startofmonth(timestamp)
customEvents | summarize n=count() by itemCount
```

| Event | Billed bytes (82 days) | Average bytes per event |
|---|---:|---:|
| cli_run | 209.8 MB | 505 |
| integration_surface_rendered | 172.1 MB | 416 |
| all others | 0.8 MB | 324 to 624 |
| Total | 382.6 MB | |

Billed by month: July 75 MB, August 155 MB, September to the 22nd 153 MB (about
210 MB for the full month). `itemCount` is 1 on every row, so nothing is sampled.

Pricing (Azure Monitor Analytics Logs, pay-as-you-go): $2.30/GB after 5 GB free
each month
([Microsoft pricing page](https://azure.microsoft.com/en-us/pricing/details/monitor/),
[cost docs](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs)).
The 5 GB allowance is per billing account, so if other Altimate resources share
the account the free tier may already be used up. In that case today's cost is
about $0.50 a month.

Projection: a heavy statusline install polls about 1,000 to 2,000 times a day
(`96cc3076` 2,015/day, `4c2fe5c7` 2,049/day, `b1f1441c` 937/day). At about 460
bytes times 2 events, that is about 55 MB per install per month.

| Heavy statusline installs | GB/month | Monthly cost, current design | With one statusline event per install per hour |
|---:|---:|---:|---:|
| 5 (today) | 0.2 | $0 | $0 |
| 100 | 5.5 | about $1 | $0 |
| 1,000 | 55 | about $115 | $0 (about 0.7 GB) |
| 10,000 | 550 | about $1,250 | about $4 (about 6.6 GB) |

Bursty senders: the only abnormal-volume senders are the 5 statusline installs
above (51K to 133K events each). That is Claude Code's poll rate, not a bot. The
real bursty-sender pattern is the Node 26 id-churn machine (up to 15 new hashes in
one hour), which inflates install counts rather than volume.

**Reading.** Cost is not a problem today, and statusline polling is 99.6% of the
bill. Polling becomes the cost driver after roughly 100 always-on users.
Deduplication also improves analysis: 413K near-identical rows make every other
query slower, and one statusline install outweighs the entire rest of the product
by 100x in any unweighted count.

## 14. Data quality and instrumentation gaps

| Gap | Evidence | Effect |
|---|---|---|
| `cli_run.agentType` always `unknown` | 415,228 of 415,228 rows; hard-coded at `src/cli/index.ts:43` | agent mix of human commands unknowable |
| `parse_failure` never emitted | 0 rows; `recordParseFailure` has no caller | adapter drift invisible |
| Only `cli_run` has `installHash` | as in the 07-13 read; SPEC-0084 R1 not shipped | receipts, milestones and PR flows can't be tied to installs |
| `receipt_generated` lacks `cliVersion` | the coverage gap can't be split by version | |
| install-id churn on state parse failure | 53 hashes from one machine; 47 first events `runOrdinalBucket=unavailable` | install counts inflated by about 2x |
| `pricedRowCoverage=none` when there are 0 tool rows | 90 of 98 zero-tool `mini` receipts | overstates the pricing gap |
| `card_generated` in data, absent from docs and schema | 2 rows from a branch build | docs-parity bug; dev builds send to production |
| `cliVersion=0.0.0` rows | 16 rows | dev builds send to production |
| `commandClass=other` | 223 rows, v0.1.x only | value outside the documented enum |
| `isCI` empty | 312 rows, v0.1.x | acceptable, legacy |
| geo stored and not disclosed | country on all rows, city on most | docs honesty gap (IP itself is masked) |
| `configFile`, `scoped` always false | 0 true rows | fine, but confirms no users |
| hidden `hook pre-push` records nothing | 0 attach-path events | the org rollout can't be measured |
| 90-day retention | resource setting | launch data purges from about 2026-09-30 |

Fields worth adding (content-free, bounded enums only):

- `receipt_generated.cliVersion` and `installHash`. Both are already on the wire
  for `cli_run`.
- `receipt_generated.unpricedModelFamily`, an enum such as `anthropic`, `openai`,
  `google` or `other`. It is never the raw model string.
- `receipt_generated.priceTableAgeBucket` (`<30d`, `30-90d`, `>90d`), computed
  from the bundled table's date.
- `cli_run.invokedBy` (`human`, `hook`, `statusline_host`, `ci`) to separate hook
  `mini` from typed commands.
- A `pr_attach_completed` event on the pre-push and CI path with a bounded
  `result` enum.

## Ranked improvements

Ranked by expected impact against effort within each group. Effort: S is under a
day, M is 1 to 3 days, L is more than 3 days.

### Product

1. **Refresh price tables and cut a release.**
   Evidence: `none` coverage is 56% of September receipts with tool calls (58 of
   104), against 4.4% in July (N=522). The tables date from 2026-07-12, and there
   has been no release since 2026-07-13.
   Change: run `update-prices` for Anthropic (fable-5-1, opus-5-5), Google
   (gemini-3.x) and OpenAI, then release v0.12.0.
   Expected effect: `none` returns to under 10%, and the cheaper-model delta line
   comes back on about 50% more receipts.
   Effort: S to M.
2. **Price freshness on a schedule.**
   Evidence: 10 weeks of drift went unnoticed.
   Change: a daily CI job that diffs vendor pricing pages against `data/prices/`
   and opens a PR, plus a patch release whenever tables change.
   Expected effect: coverage stays above 90% without manual work.
   Effort: M.
3. **Graceful unknown-model pricing.**
   Evidence: `none` coverage always removes the delta line (238 of 238).
   Change: resolve an unknown model within a known family to the nearest priced
   sibling, clearly labelled as an estimate, and print one line naming the
   unpriced family plus the command to update.
   Expected effect: the receipt never renders empty for a new model.
   Effort: M.
4. **Un-pin hook installs.**
   Evidence: the only retained external hook user still runs 0.8.0 ten weeks
   later, and the maintainer statusline runs 0.10.0.
   Change: make `install-hook` and `setup` write an unpinned or `@latest` invocation,
   or a pinned one with a staleness notice after 30 days. Add
   `aireceipts doctor` output that flags an old pinned version.
   Expected effect: engaged users get fixes and price updates.
   Effort: S.
5. **Route every first run to an always-on surface.**
   Evidence: 100% of installs retained 7 or more days are statusline or hook
   users. Organic week+1 retention is 1 of 19 and 3 of 17.
   Change: ship SPEC-0084 so successful and failed receipts both end with a
   single `setup` or `install-hook` next step.
   Expected effect: week+1 retention, currently about 11%, should move. The
   baseline is too small to promise a number.
   Effort: M.
6. **Fix or verify the PR auto-attach path.**
   Evidence: 0 `pr_flow_completed mode=post` rows since 2026-07-19, despite
   pre-push hooks in 12 org clones.
   Change: first instrument it (item 10), then check an org repo for posted
   receipts. If none exist, treat it as a P1 bug.
   Expected effect: either a working distribution loop or a known bug.
   Effort: S to M.
7. **Cut statusline latency tail.**
   Evidence: 6.2% of 413K polls take 2 to 10s, 17.5% on one linux install and
   8.4% on a Node 20 install.
   Change: cache parsed transcript state between polls, keyed by path, size and
   mtime, and parse only appended bytes. Also set a hard time budget with a
   stale-value fallback.
   Expected effect: 2-10s polls under 1%.
   Effort: M.
8. **Suppress empty `mini` receipts.**
   Evidence: 22% of `mini` receipts (90 of 417) are 0-1 turns with 0 tool calls.
   Change: skip or collapse to one line when there are no tool calls.
   Expected effect: less hook noise and honest coverage numbers.
   Effort: S.
9. **Reconsider low-yield waste lines.**
   Evidence: context thrash fires on 1.0% (N=872), stuck loop on 5.3%, and
   `--details` and templates were used 6 and 4 times.
   Change: keep the detectors, but review thresholds against a real corpus
   before investing further. Don't build new template variants.
   Expected effect: effort moves to surfaces that retain users.
   Effort: S.
10. **Acquisition work over feature work.**
    Evidence: 7 new organic installs in 9 weeks, and 0 to 2 `first_run` a week.
    Change: product time goes to distribution (always-on onboarding and a
    release cadence users can see) before new receipt features.
    Expected effect: the weekly-new-installs line moves off zero.
    Effort: L.

### Telemetry instrumentation

11. **Export launch data before purge.**
    Evidence: retention is 90 days and the first event was 2026-07-02.
    Change: run `az monitor app-insights query` exports of all non-statusline
    events and daily statusline aggregates to the vault or blob storage this
    week, or raise `retentionInDays` to 180.
    Expected effect: keeps 57% of all receipt history and 83% of PR-flow history.
    Effort: S.
12. **Fix install-id churn.**
    Evidence: 53 hashes from one machine, and 47 first events have
    `runOrdinalBucket=unavailable`.
    Change: in `src/telemetry/state.ts`, keep a valid `installId` even when
    other fields fail validation, and never mint a new id when the file exists
    but is unparseable. Also find the writer that corrupts it.
    Expected effect: install counts become trustworthy, with about 2x
    deflation.
    Effort: S.
13. **Wire `parse_failure`.**
    Evidence: 0 rows, no caller.
    Change: call `recordParseFailure` from each adapter's malformed-record path
    with the existing signature hash.
    Expected effect: format drift in Claude Code, Codex and others becomes
    visible within a day.
    Effort: S to M.
14. **Populate `cli_run.agentType`.**
    Evidence: 100% `unknown` on 415K rows.
    Change: pass the resolved adapter source from the command context into
    `recordCliRun`, or drop the field from the schema.
    Effort: S.
15. **Add `installHash` and `cliVersion` to `receipt_generated` and the other
    events.**
    Evidence: coverage and funnel questions can't be joined to installs or
    versions.
    Change: SPEC-0084 R1, plus `cliVersion`.
    Effort: S.
16. **Instrument the attach path.**
    Evidence: the pre-push and CI attach flow emits nothing.
    Change: add a bounded `pr_attach_completed` event (`result`,
    `trigger=pre_push|ci`).
    Effort: S.
17. **Fix `pricedRowCoverage` for zero-row receipts.**
    Evidence: 90 of 98 zero-tool receipts report `none`.
    Change: add an `n/a` value, or skip the field when there are no rows.
    Effort: S.
18. **Keep dev builds out of production telemetry.**
    Evidence: `card_generated` came from a branch build, and there are 16
    `cliVersion=0.0.0` rows.
    Change: disable the shipped connection string when running from a git
    checkout or when the version is `0.0.0`. Also add a CI docs-parity test that
    fails if any `record*` event name is missing from `docs/telemetry.md`.
    Effort: S.
19. **Disclose ingestion geo.**
    Evidence: country and city are stored on most rows.
    Change: state it in `docs/telemetry.md`, or disable geo by setting an empty
    `ai.location.ip` override in the sender.
    Effort: S.

### Telemetry cost

20. **Stop the statusline double-emit.**
    Evidence: `integration_surface_rendered` mirrors statusline `cli_run` row
    for row, at 172 MB of 383 MB.
    Change: emit `integration_surface_rendered` only when `inputMode`,
    `payloadValid` or `result` changes for the process state, or at most once
    per hour.
    Expected effect: about 45% fewer bytes.
    Effort: S.
21. **Rate-limit statusline `cli_run`.**
    Evidence: 1,000 to 2,000 polls per install per day, 99.6% of volume.
    Change: send at most one statusline `cli_run` per install per hour, carrying
    the hour's worst `durationBucket` and an `ok` that is false if any poll
    failed. Keep the local counter as the throttle, using the existing
    `state.json` read.
    Expected effect: 40x to 80x fewer statusline rows, and the latency tail stays visible.
    Effort: S to M.
22. **Sample, with correct weights, if full fidelity is wanted.**
    Change: as an alternative to item 21, send 1 in 50 statusline polls with
    `itemCount=50` on the envelope, so `sum(itemCount)` still reconstructs
    totals.
    Expected effect: 98% reduction, and dashboards stay correct.
    Effort: S.
23. **Set a daily cap alert.**
    Evidence: a heavy install produces about 1.8 MB a day, and a bad release or a
    tmux loop could multiply that.
    Change: set a daily ingestion cap of 1 GB with an alert on the resource.
    Expected effect: bounded worst case.
    Effort: S.

## Then vs now (2026-07-13 read against today)

| Metric | 2026-07-13 (11 days) | 2026-09-22 (82 days) |
|---|---|---|
| Identified installs | 53 | 124 hashes, about 70 after removing the churn machine |
| Organic external installs | 25 to 30 | about 43 clean, 36 of them from the first two weeks |
| Maintainer statusline polls (`8859335b`) | 19,239 | 93,906 |
| Successful human `receipt` runs | 178 | 216 |
| `hook_configured` events | 5 | 7 |
| `cli_error` / `parse_failure` | 0 / 0 | 0 / 0, and `parse_failure` is confirmed unwired |
| `cli_run.agentType` populated on receipt path | 0 of 178 | 0 of 415,228 |
| `exitClass` shipped | no, merged but unreleased | yes (0.11.0), 14 rows |
| Retained external hook install `5c00904e` | 4 days | 69 active days, pinned at 0.8.0 |
