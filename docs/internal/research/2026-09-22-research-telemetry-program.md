# aireceipts telemetry: state of the art + Azure App Insights cost and mechanics

Research date: 2026-09-22. Prepared for the aireceipts CLI telemetry review (830K events / 90 days, ~99.8% statusline polls, ~1.5K human-initiated commands).

---

## Part A: state of the art for open-source CLI telemetry

### A1. What mature OSS CLI telemetry programs actually measure

| Project | Opt model | What's collected | Notes |
|---|---|---|---|
| Homebrew | Opt-out (`brew analytics off` / `HOMEBREW_NO_ANALYTICS=1`), warns before first send | Aggregate install/uninstall/cask counts, OS version, CI flag | Sends to a self-hosted InfluxDB in the EU (moved off Google Analytics as of 4.0.23); public dashboard shows 30/90/365-day aggregate JSON and charts; 365-day retention. [docs.brew.sh/Analytics](https://docs.brew.sh/Analytics) |
| Next.js (Vercel) | Opt-out, prompts once, `NEXT_TELEMETRY_DEBUG=1` to inspect | Invoked command, Next.js version, machine info, plugins used, build duration, app size; MCP tool name + invocation count | Explicitly excludes env vars, file paths, file contents, logs, serialized errors. [nextjs.org/telemetry](https://nextjs.org/telemetry) |
| Nx | Opt-out via interactive prompt, `analytics:false` in `nx.json` | Command name, duration, tasks executed/cached, OS/CPU/Node/PM/Nx versions, CI flag, whether Nx Cloud is connected | In CI, telemetry is **off by default** and only runs if `analytics:true` is explicitly set, i.e. opt-in for CI specifically, inverse of the default for interactive use. [nx.dev/docs/reference/telemetry](https://nx.dev/docs/reference/telemetry) |
| Angular CLI | Opt-in prompt on install (Google Analytics-backed) | Command + flags, OS, PM, Node, CLI version, project shape (app/lib counts), schematics used | No data at all unless the user explicitly says yes at the install prompt; `NG_DEBUG=1` for GA DebugView. [angular.dev/cli/analytics](https://angular.dev/cli/analytics), [github.com/angular/angular-cli docs/design/analytics.md](https://github.com/angular/angular-cli/blob/main/docs/design/analytics.md) |
| Gatsby | Opt-out, `gatsby telemetry --disable` / `GATSBY_TELEMETRY_DISABLED=1` | Timestamp, command, machine ID (UUID), per-run session ID, one-way hash of cwd/git remote, OS/CPU/CI, Gatsby version | Hashing the repo identity (not just OS) is a notable design choice for correlating repeat runs against the same project without storing the path. [gatsbyjs.com/docs/telemetry](https://www.gatsbyjs.com/docs/telemetry/) |
| .NET SDK | Opt-out, `DOTNET_CLI_TELEMETRY_OPTOUT=1` | Command args/options (bounded set, not arbitrary strings), kernel version, libc version; on crash: exception name + stack trace of SDK/CLI code only | No PII, no source scanning, no project name/repo/author. [learn.microsoft.com/dotnet/core/tools/telemetry](https://learn.microsoft.com/en-us/dotnet/core/tools/telemetry) |
| Astro | Opt-out, `astro telemetry disable` / `ASTRO_TELEMETRY_DISABLED=1` | Command invoked, CPU count, OS | Deliberately minimal; excludes env vars, PII, paths, file contents, raw JS error text. [astro.build/telemetry](https://astro.build/telemetry/) |
| Turborepo | Opt-out, `TURBO_TELEMETRY_DEBUG=1` to inspect | Command invoked (`turbo run`, `turbo prune`, `turbo gen`, ...) with anonymized/randomized identifiers | Sensitive fields are one-way hashed with a **per-machine salt that never leaves the machine** — same pattern aireceipts already uses for its install hash. [turbo.build/telemetry](https://turbo.build/telemetry) |
| Yarn | Opt-out | Batched telemetry, sent roughly **every 7 days**, stored on Datadog | The 7-day batching is itself a form of client-side rate limiting for a tool that runs constantly. [yarnpkg.com/advanced/telemetry](https://yarnpkg.com/advanced/telemetry) |
| Docker (docker-agent / Docker Desktop) | Opt-out, `TELEMETRY_ENABLED=false`, notice shown on first run, `--debug` to preview | Command/session-level usage; Desktop analytics exclude opted-out users from analytics views entirely (not just anonymized) | [docker.github.io/docker-agent/community/telemetry](https://docker.github.io/docker-agent/community/telemetry/) |
| GitHub CLI (`gh`) | **Opt-out by default since v2.91.0 (Apr 2026)** — `GH_TELEMETRY=false`, `DO_NOT_TRACK=true`, or `gh config set telemetry disabled` | 20+ fields: command, agent, architecture, is_tty, skill_names, invocation ID, device ID, OS, user agent | Landed with no standalone announcement, just a docs page + changelog entry; became the top Hacker News story of the day (419 points / 302 comments) and press coverage from The Register and heise. Textbook trust-erosion case, covered in A6 below. [docs.github.com/github-cli-telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry), [theregister.com](https://www.theregister.com/2026/04/22/github_opts_all_cli_users/) |
| Supabase CLI | Opt-out, `supabase telemetry` subcommand | General usage; exact field list not published in the docs surfaced by this search — worth a direct source-read of the CLI repo if exact parity matters | [supabase.com/docs/guides/telemetry](https://supabase.com/docs/guides/telemetry) |
| Cloudflare Wrangler | Opt-out, `wrangler telemetry disable/enable/status`, `WRANGLER_SEND_METRICS` env var, `send_metrics` config key, `WRANGLER_LOG=debug` to preview | Anonymous usage; explicitly excludes usernames, raw error logs, stack traces, file names/paths, file contents, env vars | Three independent opt-out surfaces (CLI subcommand, env var, config file) is a useful pattern for aireceipts' own multi-surface config. [github.com/cloudflare/workers-sdk telemetry.md](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md) |
| Terraform / HashiCorp Checkpoint | Opt-out, `CHECKPOINT_DISABLE=1` (all HashiCorp tools) or `disable_checkpoint` in CLI config | Anonymous ID for de-duplicating version-check warnings; mainly used for the "new version available" nudge, not deep usage analytics | Narrowest-scope example in this survey: telemetry is nearly indistinguishable from a version-check ping. [developer.hashicorp.com/terraform/cdktf/telemetry](https://developer.hashicorp.com/terraform/cdktf/telemetry) |
| kubectl / Helm | No first-party telemetry at all | N/A | Neither project ships its own phone-home telemetry; "telemetry" hits for these tools are almost all about the unrelated OpenTelemetry Collector Helm chart, not CLI usage analytics. Worth citing as the "big infra tools with zero telemetry" counter-example. |
| VS Code | Opt-out, 4-level granularity | `off` / `crash` / `error` / `all` (usage) — `TelemetryLevel` policy lets an org allow crash+error but block usage data specifically | Best-in-class granularity model: most CLI tools are binary on/off; VS Code's 4-tier system is the more sophisticated reference design. [code.visualstudio.com/docs/configure/telemetry](https://code.visualstudio.com/docs/configure/telemetry) |
| consoledonottrack.com convention | N/A (a convention, not a tool) | Proposes `DO_NOT_TRACK=1` as the **one env var to rule them all** so a developer sets it once globally instead of learning each tool's bespoke flag | Adopted by Gatsby, Syncthing, GitHub CLI, and dozens more via the `toptout` aggregator project; dbt-core and .NET SDK have open issues requesting it. aireceipts should support this alongside any bespoke var. [github.com/gatsbyjs/gatsby PR #19528](https://github.com/gatsbyjs/gatsby/pull/19528), [github.com/alloydwhitlock/do-not-track-cli](https://github.com/alloydwhitlock/do-not-track-cli) |

Note: I could not verify a public dashboard for any of the JS-tooling projects (Next.js, Nx, Turborepo, Astro, Gatsby) — Homebrew is the standout for actually publishing aggregate stats. Bun and pnpm telemetry policies were not clearly documented in the sources surfaced; if precise parity matters, read their source directly rather than relying on this pass.

### A2. Activation, retention, and "power user" definitions

- **Activation** in PLG/DevTools literature is defined as the first action that *predicts* long-term retention, not just "installed" — commonly framed as "time to first value" (TTFV). ([amplitude.com](https://amplitude.com/explore/digital-analytics/what-is-activation-rate), [revenuecat.com](https://www.revenuecat.com/blog/growth/activation-metrics))
- **Retention** in Azure's own HEART framework (used inside Application Insights workbooks) is defined narrowly and usefully: *"A retained user is a user who was active in a specified reporting period and its previous reporting period."* Two paired metrics: **retained users** (count active in period N and N-1) and **retention** (% of period-N-1 actives who are also active in period N). ([learn.microsoft.com/azure-monitor/app/usage](https://learn.microsoft.com/en-us/azure/azure-monitor/app/usage))
- Application Insights' built-in **User Retention Analysis workbook** builds a cohort grid: each row is a cohort of users who did *any* tracked event in a period; each cell shows how many of that cohort returned in a later period. This is the standard "cohort retention triangle" pattern, directly reusable for aireceipts installs instead of users.
- **WAU/MAU** for CLIs is best defined as **distinct install-hashes that emitted at least one *human-initiated* event** in the window, explicitly excluding passive/polled signals — otherwise a single open terminal with a live statusline inflates "active" to nearly 100% of installs regardless of real usage, which defeats the metric's purpose.
- **"Power install" threshold**: several tools (Nx's HEART engagement dimension, Amplitude's stickiness ratio) use "N distinct active days within a trailing M-day window" as the power-user bar — e.g. Application Insights' own cohort template default is **5+ active days in a trailing 28-day window** as "engaged." ([learn.microsoft.com/azure-monitor/app/usage](https://learn.microsoft.com/en-us/azure/azure-monitor/app/usage))

### A3. Sampling, dedupe, and rate limits for high-frequency events

- **Yarn**: batches telemetry client-side and ships once every 7 days rather than per-command. ([yarnpkg.com/advanced/telemetry](https://yarnpkg.com/advanced/telemetry))
- **Application Insights adaptive sampling** (SDK-side, on by default for ASP.NET/ASP.NET Core/Functions): dynamically adjusts the *percentage kept* to hit a target events/sec, and stamps the kept envelope's `sampleRate` so downstream counts can be reconstructed (see B2). ([learn.microsoft.com sampling-classic-api](https://learn.microsoft.com/en-us/previous-versions/azure/azure-monitor/app/sampling-classic-api))
- **Ingestion sampling** (server-side, last resort): telemetry is still sent over the wire and billed for bandwidth even though it's discarded before storage — explicitly called out as the worst option for cost control precisely because you still pay to transmit what you then throw away. This directly informs the statusline recommendation in A8: don't rely on ingestion-side sampling for a chatty client, throttle client-side instead.
- **Angular CLI / Nx / Astro / Turborepo** all use a **first-run interactive prompt + persisted choice** rather than silent default-on, which is the opt-in-adjacent end of the spectrum; Homebrew/Docker/Wrangler/.NET are opt-out-with-notice; GitHub CLI is opt-out-with-no-notice (see A6, the backlash case).

### A4. CI-noise handling

- **Nx** is the cleanest pattern found: telemetry defaults to *disabled* in CI and only fires if a workspace has explicitly set `analytics:true`, inverting the interactive-mode default. ([nx.dev/docs/reference/telemetry](https://nx.dev/docs/reference/telemetry))
- **Gatsby / Astro / Turborepo / .NET / Nx** all detect CI (env-based) and tag events with a CI boolean so it can at least be filtered out of human-usage dashboards even when not fully suppressed.
- Applied to aireceipts: `cli_run` already has an implicit CI signal opportunity (most CI shells set `CI=true`); the statusline poller specifically should never fire in CI since a live TUI statusline has no CI equivalent — this is a free, zero-cost filter that should already be structurally true and is worth confirming rather than building.

### A5. Public dashboards

Homebrew is the only project in this survey with a genuinely public, live dashboard (30/90/365-day aggregate JSON + charts on the Homebrew site), and it is frequently cited by other maintainers as the reason Homebrew's telemetry, despite the 2016 backlash, is now considered a *model* of trust-preserving OSS telemetry: transparency plus genuinely aggregate, non-attributable data. ([docs.brew.sh/Analytics](https://docs.brew.sh/Analytics))

### A6. Community backlash lessons

| Case | What went wrong | What restored/preserved trust |
|---|---|---|
| **Homebrew, 2016** | Silently switched to Google Analytics; users called it "betrayal" because routing through Google broke the "no third party sees this" assumption even though IPs were anonymized and no PII was sent. ([chr4.org](https://chr4.org/blog/2016/04/26/homebrew-betrayed-us-all-to-google), [HN discussion](https://news.ycombinator.com/item?id=11566720)) | Kept the opt-out easy from day one; years later fully migrated off Google Analytics to a self-hosted EU InfluxDB and published a public dashboard — the backlash was about *whose infrastructure sees the data*, not about collection existing at all. |
| **Audacity, 2021 (Muse Group acquisition)** | New privacy policy included a line about sharing data for "law enforcement, litigation, and authorities' requests," broad and unspecific wording that read as a blank check; telemetry was proposed as opt-out-by-default in a fork of a formerly telemetry-free tool. ([hackaday.com](https://hackaday.com/2021/05/17/telemetry-debate-rocks-audacity-community-in-open-source-dustup/), [techradar.com reversal](https://www.techradar.com/news/audacity-reverses-opt-in-telemetry-plans-following-user-revolt)) | Muse Group reversed course to a clearer, narrower privacy notice. A fork ("Tenacity") was created in response but its maintainer was later driven off by targeted harassment — a reminder that backlash has real human cost beyond PR, and that vague legal-sounding data-sharing clauses are a bigger trigger than the technical scope of collection. |
| **GitHub CLI, April 2026** | Opt-out telemetry shipped with *zero standalone announcement* — just a docs page and a changelog line — for a tool millions of engineers already trusted implicitly. Went to #1 on Hacker News (419 points, 302 comments) within 24 hours; covered by The Register and heise. ([theregister.com](https://www.theregister.com/2026/04/22/github_opts_all_cli_users/), [heise.de](https://www.heise.de/en/news/GitHub-CLI-introduces-default-telemetry-collection-11275162.html)) | The complaint was never really about the field list (pseudonymous, bounded, arguably less invasive than Homebrew's historical GA integration) — it was entirely about **silence**: no blog post, no release-notes headline, opt-out with no notice banner on first run. The lesson generalizes directly: *announcement prominence matters as much as data minimality.* |
| **Rust compiler telemetry proposal, 2023** | A "no telemetry, ever" position paper from a core contributor pre-empted any formal compiler telemetry proposal from gaining traction, arguing metrics should stay local-only rather than network-transmitted, given the trust Rust gets specifically for *not* phoning home. ([internals.rust-lang.org](https://internals.rust-lang.org/t/no-telemetry-in-the-rust-compiler-metrics-without-betraying-user-privacy/19275), [HN](https://news.ycombinator.com/item?id=36959650)) | Never shipped network telemetry — the entire debate concluded that for some ecosystems, the correct answer is "don't," not "do it carefully." Relevant to aireceipts mainly as a reminder that "no telemetry" is a legitimate competitive/trust position some tools deliberately choose. |
| **Console.dev / consoledonottrack.com debates** | The broader OSS-telemetry-in-CLIs argument (referenced across the toptout/do-not-track-cli ecosystem) crystallized around: bespoke opt-out env vars per tool are a burden, and *opt-out-by-default with no honored universal convention* is the recurring complaint pattern across nearly every case above. ([github.com/alloydwhitlock/do-not-track-cli](https://github.com/alloydwhitlock/do-not-track-cli)) | The convention itself, `DO_NOT_TRACK=1`, honored by Gatsby, Syncthing, GitHub CLI, and others, is the community's answer: not "ask permission every time" but "respect the one flag a privacy-conscious developer already knows to set." |

**Pattern across all five cases**: nobody got in real trouble for collecting *bounded, non-PII, aggregate* data (that's what Homebrew, Turborepo, Astro, .NET all do uncontroversially). The trigger for backlash is always one of: (a) silent/no-announcement rollout, (b) opt-out with no first-run notice, (c) vague/broad legal language about data sharing, or (d) routing through a third party (Google) that itself has a trust deficit. aireceipts is already opt-out-with-notice, content-free, and honors `DO_NOT_TRACK` per its own product description, which places it on the safe side of every one of these lines — the main residual risk is disclosure prominence (a public, dated telemetry doc + changelog callout, not just a buried docs page) given the GitHub CLI precedent.

### A7. Recommended metric definitions for aireceipts

Given the existing event catalog (`cli_run`, `receipt_generated`, `activation_milestone`, `pr_flow_completed`, `hook_configured`, `integration_surface_rendered`, `export_generated`, `cli_error`, `parse_failure`) and the salted install hash:

1. **Activation** (binary, per install): first occurrence of `pr_flow_completed` OR `receipt_generated` with a non-trivial cost total — i.e., the moment the tool produced something the user actually looked at, not just `cli_run`. Track **time-to-activation** (install-hash first-seen to first `pr_flow_completed`) as the primary TTFV metric, following the Amplitude/RevenueCat pattern in A2.
2. **DAU/WAU/MAU of installs**: distinct install-hashes emitting at least one of the *human-initiated* events (`cli_run`, `receipt_generated`, `pr_flow_completed`, `export_generated`, `hook_configured`) in the window. **Explicitly exclude** statusline poll events from this count (see A8) so the metric isn't dominated by "terminal left open."
3. **Retention cohorts**: weekly cohort grid keyed by install-hash first-seen week, using the Azure HEART definition directly — "retained in week N" = emitted ≥1 human-initiated event in week N and also in week N-1. Report both **retained-count** and **retention-%** per cohort, matching the built-in Application Insights workbook shape so it can be reused as-is (see B5, query 2).
4. **Power install** threshold: ≥5 active days with a human-initiated event in a trailing 28-day window — directly reusing the Application Insights "Engaged Users" cohort template default cited in A2, rather than inventing a bespoke number.
5. **CI filter**: tag `cli_run` with the ambient `CI` env var (already likely present) and exclude CI-tagged installs from WAU/MAU/activation entirely, per the Nx/Gatsby/Astro pattern in A4 — CI runs are not adoption signal.
6. **Funnel**: `cli_run` → `receipt_generated` → `pr_flow_completed`, as a strict Application Insights-style funnel (query 3 in B5), to find the real drop-off point between "ran the tool" and "posted a receipt to a PR."

### A8. Sampling rule for the polled statusline surface

The core problem: ~828K of 830K events (90 days) are statusline polls firing every few seconds, while only ~1.5K are human commands. Two distinct goals are in tension — cut ingestion cost by ~99%+, while *still* being able to count "distinct active installs per day" from the statusline surface (since for many installs, the statusline may be the only signal that the tool is even open/in-use that day).

Recommendation: **this is a dedup problem, not a sampling problem.** Statistical sampling (Application Insights' `sampleRate`/adaptive sampling, per B2) is the right tool when you want to estimate a *rate* or *distribution* from a high-cardinality stream and you don't care which specific events survive. It is the *wrong* tool here because the one thing this surface needs to preserve is a **distinct-install-per-day** signal, and random sampling of poll events does not reliably preserve "at least one event from install X survived today" once you're discarding 99%+ of traffic — a moderately-active install could easily have zero surviving samples on a given day purely by chance.

Instead, apply **client-side rate limiting with a daily heartbeat**:
- The statusline component tracks its own poll count locally (in memory or a small local state file) but only emits **one aggregated event to Application Insights per install-hash per UTC calendar day** (or per terminal session if sessions commonly span midnight), e.g. `statusline_active_day` with a `poll_count` integer field summarizing how many local polls occurred.
- This mirrors Yarn's 7-day batching (A3) and Docker's session-level reporting (A1), just at daily granularity appropriate for a "is this install alive today" signal.
- Effect on volume: ~9,200 poll events/day collapses to at most (distinct installs with an open statusline that day) events/day — for a program with, say, a few hundred to low thousands of active installs, that's a 95-99%+ reduction with **zero loss** of the daily-active-install signal, versus real information loss under random sampling.
- If finer-grained "how long was the statusline open" data is later wanted, that can layer on top as a *duration* field on the same daily heartbeat event rather than as separate per-poll events.
- Only apply Application Insights' native `sampleRate` sampling (B2) to the human-initiated events if and when their volume itself becomes a cost concern — at ~1.5K/90 days that is nowhere close to necessary today.

---

## Part B: Azure Application Insights cost and query mechanics

### B0. Verified against aireceipts' live App Insights resource (2026-09-22)

`appinsights-analyst` ran queries and inspected the sender source directly against the production resource; these facts supersede the estimates below wherever they conflict, and materially change the recommended fix. Full detail in `docs/internal/research/2026-09-22-appinsights-deep-dive.md` on `worktree-20260922`.

- **No sampling is active today.** `customEvents | summarize n=count() by itemCount` returns `itemCount=1` on all 830,534 rows; `samplingPercentage` is null on the resource. Every envelope is billed and counted 1:1.
- **The raw sender (`src/telemetry/sender.ts`) sets no `sampleRate` field** — it posts bare envelopes (`{name, time, iKey, data:{baseType:"EventData", baseData:{ver:2, name, properties}}}`) to `/v2/track`. So any future sampling has to be added, it isn't silently happening.
- **Actual volume is far smaller than the 300K/day figure used for B4's illustrative "high volume" case**: 383 MB billed over 82 days ≈ **0.21 GB/month**, i.e. real daily volume is ~10,100 events/day (830,534/82), squarely in B4's "free tier, $0/month" bucket already, not the ~300K/day case.
- **The single highest-leverage, zero-tradeoff fix is not sampling or dedup, it's a duplicate-emission bug**: statusline polling is 99.6% of all rows, and **every poll is currently sent twice** — once as `cli_run` and once as `integration_surface_rendered`. Fixing that alone halves total volume with **no design change and no loss of any signal**, and should ship before anything in A8 or B2 is attempted.
- **Confirms the envelope-level fix in B2**: `sampleRate` is a top-level field on the Envelope schema, a **percentage, default 100** (not a divisor as one secondary source's phrasing implied); `itemCount = 100 / sampleRate`. Untested against this resource — before relying on it, send one test envelope with `AIRECEIPTS_TELEMETRY_CONNECTION` pointed at a scratch resource and confirm `itemCount` lands as expected.
- **`dcount()` of a dimension is not itself scaled by `itemCount`** — under event-level sampling, `dcount(installHash)` can genuinely undercount rare/low-frequency installs (an install with few events has a real chance every one of its events gets sampled out). This is independent confirmation of A8's conclusion: prefer client-side dedup (one heartbeat/day) over statistical sampling for anything that has to preserve a distinct-install-per-day count.
- **The funnel query in B5 (query 3, as originally drafted) will not run today**: `installHash` is currently only attached to `cli_run` events (SPEC-0084 R1, the fix that adds it everywhere, is unshipped), so `receipt_generated` and `pr_flow_completed` can't be joined to `cli_run` per install yet. B5 below has been corrected to use the actually-available `activation_milestone` event as a funnel proxy, with real numbers pulled from the resource.
- **Data-quality caveat for any per-install analysis**: 53 of 124 distinct install hashes observed trace back to *one machine*, because `state.json` parse failures mint a fresh install hash each time. Filter out installs whose first event has `runOrdinalBucket=="unavailable"`, or funnel/retention denominators roughly double.
- Practical KQL gotchas hit while running these live: always pass `--offset 90d` (default lookback is shorter); aliases named `first` or `last` throw `BadArgumentError` in this Kusto version, use `fs`/`ls` instead; multiple aggregates in one `summarize` sometimes fail and need to be split.

### B1. Ingestion pricing (East US, as surfaced 2026-09-22)

| Item | Price | Source |
|---|---|---|
| Analytics Logs (pay-as-you-go), standard workspace-based tier | **$2.30/GB** | [monitoringcost.com](https://monitoringcost.com/azure-monitor-cost), corroborated by [azure.microsoft.com/pricing/details/monitor](https://azure.microsoft.com/en-us/pricing/details/monitor/) (exact figure not rendered on the live pricing page for this fetch; use the calculator for a binding quote) |
| Basic Logs | **$0.50/GB** (~78% cheaper than Analytics Logs) | [monitoringcost.com](https://monitoringcost.com/azure-monitor-cost) |
| Auxiliary Logs | **$0.05/GB** | search-surfaced via [oreateai.com blog](https://www.oreateai.com/blog/demystifying-azure-app-insights-pricing-beyond-the-gb-count/870d984e98c35baa35ce9ecfdd3b0ab7) — verify against the official calculator before quoting externally |
| Free monthly allowance | **5 GB/month per billing account**, shared across the whole tier, not per-resource | [learn.microsoft.com/azure-monitor/logs/cost-logs](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs) |
| Included interactive retention | **31 days free** for Analytics Logs, **30 days free** for Basic/Auxiliary Logs | same |
| Extended retention beyond the free period | roughly **$0.10-0.15/GB/month** depending on source (search results gave $0.10/GB/month via [oneuptime.com](https://oneuptime.com/blog/post/2026-02-16-how-to-optimize-azure-log-analytics-workspace-costs-with-data-retention-and-archiving-policies/view); confirm exact current figure via the calculator, retention pricing changes more often than ingestion pricing) | up to 12 years max retention supported |
| Commitment tiers | 100 GB/day up to 50,000 GB/day tiers, up to ~30% cheaper than pay-as-you-go Analytics Logs; **do not apply to Basic or Auxiliary Logs**, which stay flat-rate | [learn.microsoft.com/azure-monitor/logs/cost-logs](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs) |
| Query cost | Analytics Logs queries are free (covered by ingestion price); Basic/Auxiliary Logs charge **per GB scanned** on query, so cheap ingestion tiers can get expensive if queried often | same |

**Caveat**: the live Azure pricing page did not render numeric values to the fetch tool (region-gated JS pricing table); the $2.30/$0.50/$0.05 figures above come from secondary sources that all agree with each other and with Microsoft Learn's cost-logs doc structure, but before committing budget, pull a live figure from the Azure Pricing Calculator for the exact target region.

### B2. Sampling mechanics

Three distinct sampling layers, and they interact:

1. **Fixed-rate sampling** (SDK-side): keeps a constant percentage of all telemetry, applied uniformly to all telemetry *types* within a correlated request/trace so App Map and correlation stay intact.
2. **Adaptive sampling** (SDK-side, default for ASP.NET/ASP.NET Core/Functions): dynamically varies the kept percentage to hit a target events/sec ceiling, i.e. self-tuning fixed-rate.
3. **Ingestion sampling** (service-side, at the App Insights endpoint): discards telemetry *after* it's already been transmitted from the client, so you still pay the bandwidth cost of what gets thrown away. It only takes effect when no SDK-side sampling is active; if adaptive/fixed-rate is enabled, ingestion sampling is automatically disabled for that telemetry type. **This ordering means ingestion sampling should never be relied on as the primary cost lever for a chatty client you control** — client-side (SDK or raw-sender) sampling is strictly better because it saves bandwidth too. ([learn.microsoft.com sampling-classic-api](https://learn.microsoft.com/en-us/previous-versions/azure/azure-monitor/app/sampling-classic-api), [Medium/Daniel Quilón](https://medium.com/@dquilong/reduce-costs-in-azure-application-insights-with-adaptive-sampling-68230c329221))

**Raw HTTP sender to `v2/track` and the envelope `sampleRate` field**: yes, a hand-rolled sender (no official SDK) can and should set `sampleRate` directly on the telemetry envelope. Per the Envelope schema, `sampleRate` is a **percentage, default 100** (100 = unsampled, every event kept), and Application Insights derives `itemCount = 100 / sampleRate` from it — e.g. keeping 1 in 50 events means setting `sampleRate: 2` on every surviving envelope, which lands as `itemCount = 50`. This is confirmed against aireceipts' own resource today: `itemCount` is 1 on all 830,534 rows because the current sender never sets `sampleRate` at all (see B0). KQL aggregations (`count()`, `summarize`) can be scaled back up to true totals using `itemCount`, and the built-in **Application Map** already uses it this way to avoid under-representing sampled traffic. Concretely for a raw sender: `count()` over sampled `customEvents` without correcting for `itemCount` will **undercount** by the sampling factor; the correct KQL pattern is `summarize sum(itemCount)` rather than `count()` whenever any sampling (client or ingestion) is active — with the caveat from B0 that `dcount()` of a dimension is *not* itself corrected by `itemCount`, so distinct-install counts stay vulnerable to under-sampling regardless. Before shipping this in aireceipts, send one test envelope with a set `sampleRate` against a scratch Application Insights resource and confirm `itemCount` lands as expected; this has not yet been tested end-to-end. ([oneuptime.com sampling guide](https://oneuptime.com/blog/post/2026-02-16-how-to-enable-telemetry-sampling-in-azure-application-insights-to-reduce-data-costs/view), [Envelope class docs](https://microsoft.github.io/ApplicationInsights-JS/webSdk/applicationinsights-common/classes/Envelope.html), [sampling-classic-api](https://learn.microsoft.com/en-us/previous-versions/azure/azure-monitor/app/sampling-classic-api), [opentelemetry-sampling](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-sampling))

Given the A8 recommendation (dedup, not sampling, for the statusline surface), `sampleRate` mainly matters for aireceipts if/when the *human-initiated* event volume grows enough to need statistical thinning — at which point, set `sampleRate` per-event at send time and always query with `sum(itemCount)`, never raw `count()`.

### B3. Daily cap

- Configurable per Log Analytics workspace and per (classic) Application Insights resource independently; for **workspace-based** App Insights resources (the current default resource type), the *effective* cap is the **minimum of the two settings**, so both need checking if a cap seems ineffective.
- Default when created via the Azure Portal: **100 GB/day**. Default when created via Visual Studio: a much smaller 32.3 MB/day (easy to trip accidentally).
- Max cap for a classic resource: **1,000 GB/day** unless a higher limit is explicitly requested from Microsoft.
- **The cap is not a hard stop** — Microsoft explicitly documents that some overage is expected once triggered, and *overage that occurs before the cap engages is still billed*. Treat the daily cap as a circuit-breaker against runaway/bug-driven volume, not as a cost ceiling you can budget against precisely. ([learn.microsoft.com daily-cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap), [why-daily-cap-exceeded](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-monitor/log-analytics/billing/why-daily-cap-exceeded))

### B4. Cheaper alternatives, with rough monthly cost at two volumes

Assume ~1 KB/event.

- **10,000 events/day** ≈ 300K events/month ≈ **~0.3 GB/month** — comfortably inside the 5 GB/month free Analytics Logs allowance. **Cost: effectively $0/month** on Application Insights as-is, no alternative needed at this volume.
- **300,000 events/day** ≈ 9M events/month ≈ **~9 GB/month**. After the 5 GB free allowance, ~4 GB billable.
  - Analytics Logs pay-as-you-go: ~4 GB × $2.30 ≈ **~$9/month** (ingestion only; add ~$0.10-0.15/GB/month for anything retained past 31 days).
  - Basic Logs: ~4 GB × $0.50 ≈ **~$2/month** ingestion, but every query then bills per-GB-scanned — fine for a "write and rarely query" pattern, bad if dashboards query constantly.
  - **This is a trivially small bill either way** — at these volumes Application Insights cost is a non-issue; the real cost driver for aireceipts today is the *unfiltered statusline poll volume* (830K/90 days ≈ ~9,200/day, i.e. already close to the 10K/day low-volume case above even before the A8 dedup fix), not the pricing model itself.
  - **PostHog Cloud**: $0.00005-0.00009/event scaling down with volume after 1M free events/month; at 9M events/month that's roughly **1M free + 8M billable × ~$0.00005-0.00007/event ≈ $400-560/month** — notably *more* expensive than Application Insights at this volume, because PostHog's product-analytics feature set (session replay, feature flags, experimentation) is priced for that, not raw event ingestion. ([flexprice.io PostHog pricing guide](https://flexprice.io/blog/posthog-pricing-guide))
  - **PostHog self-hosted**: infra-only cost ~$880-1,100/month even at the smallest (1M events/month) published tier, plus real DevOps overhead — the search consensus is that self-hosting only breaks even north of ~100M events/month with dedicated ops capacity; nowhere close to justified at aireceipts' volume. ([cotera.co](https://cotera.co/articles/posthog-self-hosted-guide))
  - **Tinybird / self-hosted ClickHouse**: not independently priced in this pass; qualitatively, ClickHouse's raw ingestion cost per GB is typically far below Application Insights, but the *all-in* cost (hosting, ops, dashboards, auth) usually only wins at a scale well beyond anything discussed here. Given aireceipts' actual volumes, this is not worth pursuing until human-initiated event volume is 2-3 orders of magnitude higher than today.
  - **Bottom line**: at aireceipts' real (non-poll) event volume, Application Insights pay-as-you-go, or even the free tier after the A8 statusline dedup fix, is already the cheapest reasonable option. The fix that actually matters is architectural (A8), not a vendor switch.

### B5. Three KQL patterns

Queries 1 and 2 below were run against the live aireceipts resource by `appinsights-analyst` and confirmed working (with the gotchas noted in B0: pass `--offset 90d`, avoid `first`/`last` as alias names, split multi-aggregate `summarize`s if one fails). Query 3 as originally designed (joining `cli_run` → `receipt_generated` → `pr_flow_completed` per install) **cannot run today** because `installHash` is only attached to `cli_run` events until SPEC-0084 R1 ships; it's given in two forms below — the proxy that works now, and the real join for once install-hash coverage is complete.

**1. Daily active installs, human-initiated vs. all (tested, live data)**

```kql
customEvents | where name=="cli_run"
| extend ih=tostring(customDimensions.installHash), cc=tostring(customDimensions.commandClass)
| where ih !in ("","unavailable")
| summarize dau=dcount(ih), human_dau=dcountif(ih, cc!="statusline") by bin(timestamp,1d)
```

Filter out installs whose *first-ever* event has `runOrdinalBucket=="unavailable"` before trusting `dau` at the install level (B0: 53 of 124 observed hashes are artifacts of one machine's `state.json` parse failures re-minting an install hash).

**2. Weekly cohort retention grid (tested, live data; Azure HEART-style: active in cohort week and week N)**

```kql
let ev = customEvents | where name=="cli_run"
| extend ih=tostring(customDimensions.installHash) | where ih !in ("","unavailable")
| summarize by ih, wk=startofweek(timestamp);
ev | summarize cohort=min(wk) by ih
| join kind=inner ev on ih
| extend k=datetime_diff('week', wk, cohort)
| summarize installs=dcount(ih) by cohort, k | order by cohort asc, k asc
```

If the `join` form throws `BadArgumentError` in your Kusto version, pull `(ih, wk)` pairs unjoined and pivot the cohort grid offline instead (this is what worked against the live resource).

**3a. Activation funnel proxy — `activation_milestone`, works today**

```kql
customEvents | where name=="activation_milestone"
| summarize n=count() by ms=tostring(customDimensions.milestone), wk=startofweek(timestamp)
```

Real numbers pulled from the live resource (last 90 days): `first_run` 69, `first_receipt` 30, `third_receipt` 13, `tenth_receipt` 11, `first_hook_install` 5, `first_pr_post` 2. Read as a funnel: roughly 43% of first-time runners ever generate a first receipt, and only 2 of 69 installs that ever ran the tool have completed a PR post — the real bottleneck in the funnel is far downstream of activation, at the hook-install and PR-post steps, not at "first run."

**3b. Activation funnel, per-install join — only valid once `installHash` is on every event (SPEC-0084 R1)**

```kql
customEvents | extend ih=tostring(customDimensions.installHash)
| summarize ran=countif(name=="cli_run")>0, rcpt=countif(name=="receipt_generated")>0, pr=countif(name=="pr_flow_completed")>0 by ih
| summarize installs=count(), to_receipt=countif(ran and rcpt), to_pr=countif(ran and rcpt and pr)
```

Note on `itemCount`: if aireceipts ever enables client-side sampling per B2, replace `count()`/`dcountif` above with sums of `itemCount` where the metric is a *volume*. `dcount(ih)` is **not** itself corrected by `itemCount` (confirmed in B0), so under any event-level sampling, distinct-install counts in all three queries above stay vulnerable to undercounting rare installs — yet another reason A8's daily-heartbeat dedup is preferable to statistical sampling for exactly the metrics these queries compute.

---

## Sources (deduplicated)

- Live aireceipts telemetry resource (verified queries and sender-code read, `appinsights-analyst`): `docs/internal/research/2026-09-22-appinsights-deep-dive.md` on `worktree-20260922`
- Homebrew: [docs.brew.sh/Analytics](https://docs.brew.sh/Analytics), [chr4.org 2016 backlash](https://chr4.org/blog/2016/04/26/homebrew-betrayed-us-all-to-google), [HN 2016](https://news.ycombinator.com/item?id=11566720)
- Next.js/Vercel: [nextjs.org/telemetry](https://nextjs.org/telemetry), [vercel.com/docs/cli/about-telemetry](https://vercel.com/docs/cli/about-telemetry)
- Nx: [nx.dev/docs/reference/telemetry](https://nx.dev/docs/reference/telemetry)
- Angular: [angular.dev/cli/analytics](https://angular.dev/cli/analytics), [github.com/angular/angular-cli analytics.md](https://github.com/angular/angular-cli/blob/main/docs/design/analytics.md)
- Gatsby: [gatsbyjs.com/docs/telemetry](https://www.gatsbyjs.com/docs/telemetry/), [DO_NOT_TRACK PR #19528](https://github.com/gatsbyjs/gatsby/pull/19528)
- .NET SDK: [learn.microsoft.com/dotnet/core/tools/telemetry](https://learn.microsoft.com/en-us/dotnet/core/tools/telemetry)
- Astro: [astro.build/telemetry](https://astro.build/telemetry/)
- Turborepo: [turbo.build/telemetry](https://turbo.build/telemetry)
- Yarn: [yarnpkg.com/advanced/telemetry](https://yarnpkg.com/advanced/telemetry)
- Docker: [docker.github.io/docker-agent/community/telemetry](https://docker.github.io/docker-agent/community/telemetry/)
- GitHub CLI: [docs.github.com/github-cli-telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry), [theregister.com](https://www.theregister.com/2026/04/22/github_opts_all_cli_users/), [heise.de](https://www.heise.de/en/news/GitHub-CLI-introduces-default-telemetry-collection-11275162.html)
- Cloudflare Wrangler: [github.com/cloudflare/workers-sdk telemetry.md](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md)
- HashiCorp Checkpoint: [developer.hashicorp.com/terraform/cdktf/telemetry](https://developer.hashicorp.com/terraform/cdktf/telemetry)
- VS Code: [code.visualstudio.com/docs/configure/telemetry](https://code.visualstudio.com/docs/configure/telemetry)
- consoledonottrack ecosystem: [github.com/alloydwhitlock/do-not-track-cli](https://github.com/alloydwhitlock/do-not-track-cli)
- Audacity: [hackaday.com telemetry debate](https://hackaday.com/2021/05/17/telemetry-debate-rocks-audacity-community-in-open-source-dustup/), [techradar.com reversal](https://www.techradar.com/news/audacity-reverses-opt-in-telemetry-plans-following-user-revolt)
- Rust compiler telemetry debate: [internals.rust-lang.org](https://internals.rust-lang.org/t/no-telemetry-in-the-rust-compiler-metrics-without-betraying-user-privacy/19275)
- Activation/retention definitions: [amplitude.com activation rate](https://amplitude.com/explore/digital-analytics/what-is-activation-rate), [revenuecat.com activation metrics](https://www.revenuecat.com/blog/growth/activation-metrics)
- Azure Monitor / App Insights usage analysis + HEART + cohorts + funnels: [learn.microsoft.com/azure-monitor/app/usage](https://learn.microsoft.com/en-us/azure/azure-monitor/app/usage)
- Azure Monitor pricing structure: [azure.microsoft.com/pricing/details/monitor](https://azure.microsoft.com/en-us/pricing/details/monitor/), [monitoringcost.com](https://monitoringcost.com/azure-monitor-cost), [learn.microsoft.com/azure-monitor/logs/cost-logs](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs)
- Retention pricing: [oneuptime.com retention/archiving](https://oneuptime.com/blog/post/2026-02-16-how-to-optimize-azure-log-analytics-workspace-costs-with-data-retention-and-archiving-policies/view)
- Daily cap: [learn.microsoft.com/azure-monitor/logs/daily-cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap), [why-daily-cap-exceeded](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-monitor/log-analytics/billing/why-daily-cap-exceeded)
- Sampling mechanics + envelope `sampleRate`/`itemCount`: [learn.microsoft.com sampling-classic-api](https://learn.microsoft.com/en-us/previous-versions/azure/azure-monitor/app/sampling-classic-api), [oneuptime.com sampling guide](https://oneuptime.com/blog/post/2026-02-16-how-to-enable-telemetry-sampling-in-azure-application-insights-to-reduce-data-costs/view), [Envelope class docs](https://microsoft.github.io/ApplicationInsights-JS/webSdk/applicationinsights-common/classes/Envelope.html)
- PostHog pricing: [flexprice.io PostHog pricing guide](https://flexprice.io/blog/posthog-pricing-guide), [cotera.co self-hosted guide](https://cotera.co/articles/posthog-self-hosted-guide)
