---
id: SPEC-0095
title: "Price-id resolution: cited aliases, a named unpriced-model line, comparison candidates"
status: approved
milestone: M6
depends: [SPEC-0005, SPEC-0043, SPEC-0054]
---

# SPEC-0095: Price-id resolution

Invariants touched: I1 (resolution stays a local, deterministic table lookup), I2
(an alias prices a session only when a cited vendor page says the id is the same model
at the same price; nothing is priced from a sibling), I3 (every alias and every
comparison candidate carries its own cited source, and the exported price row carries
the alias citation that justified it), I4 (R1 to R5 add no telemetry field; the deferred
age-bucket proposal would add one bounded enum and nothing else), I5 (the new receipt line is golden-gated and derived only from bundled
data and the transcript), I6 (the comparison set is recorded, cited set membership,
never a quality ranking). This spec carries the improvement plan's "SPEC-0086" bullets
under id 0095.

## Purpose

Receipts that price nothing are rising and say nothing about why. In production
telemetry, receipts with tool calls and zero priced rows went from 4.4% in July to
55.8% in September while `data/prices/` sat unchanged (App Insights deep dive,
2026-09-22, section 8, a working paper in the maintainer's research vault). Most of
that gap is missing canonical rows, which price PRs fix (#367 to #371); the telemetry
cannot yet split it from old installs. This spec closes three structural gaps that
price PRs alone cannot, and that recur at every model launch:

1. **Exact-id lookup misses documented synonyms.** `resolvePrice` matches only the
   canonical key (`src/pricing/resolve.ts:26`), so a vendor-documented snapshot id such
   as `claude-haiku-4-5-20251001` stayed tokens-only even though Anthropic lists it as
   the `claude-haiku-4-5` model. In the maintainer's own last-30-days Claude Code
   transcripts that id appears on 136 transcript records (records, not sessions or
   users), all unpriced before PR #369. That PR worked around the gap by adding the
   snapshot id as a second canonical entry in `anthropic.json` whose only row starts on
   2026-09-22 (its observation date), so sessions before that date are still unpriced
   and the two entries can drift apart at the next price change. R1 replaces that
   duplicate with a cited alias whose window covers the canonical row's history.
2. **Tokens-only is silent.** A reader cannot tell "this model is newer than the
   bundled tables" from "aireceipts is broken". The receipt should name the model, the
   table that was checked, and how recent that table's newest price citation is.
3. **Coverage and comparison are one rule.** Any current row automatically becomes the
   cheaper-model candidate (`cheapestCurrentRow`, `src/pricing/resolve.ts:197`), so a
   row added for coverage can change the headline cheaper-model line. That is why three
   OpenAI rows (`gpt-5.4-nano`, `gpt-5-mini`, `gpt-5-nano`) are held out of PR #370.
   This spec implements maintainer decision 0, option (a): coverage eligibility and
   comparison eligibility are separate, recorded data.

Sibling pricing (price an unknown id at its nearest family member's rate), which the
deep dive suggested, is rejected: it fabricates a dollar (I2).

Kill criterion: if, after the next Anthropic and OpenAI price PRs merge, the
maintainer's 30-day corpus contains no id that a cited alias resolves and no id that
reaches the R3 line, R1 and R3 are parked and only R4 ships.

## Requirements

- **R1. Cited aliases per model.** A model entry in `data/prices/<vendor>.json` may
  carry an optional `aliases` array next to `price_history`. Each entry holds `id`,
  `from_date`, `to_date` (`null` when current) and a non-empty `sources` array in the
  existing `PriceSource` shape (`src/pricing/types.ts:9`). An alias is admissible only
  when a cited vendor page lists that id as the same model at the same price: a dated
  snapshot id (`claude-haiku-4-5-20251001` for `claude-haiku-4-5`) or a vendor-documented
  alias id (for example `gpt-5.6` for `gpt-5.6-sol`, if and only if OpenAI's page states
  that mapping). Same price must hold for every price period the alias covers: each
  canonical `price_history` row that the alias window overlaps needs at least one alias
  source whose `observed_at` is on or after the earliest `observed_at` among that row's
  own sources, so the alias evidence is never older than the evidence that set the
  row's price. `observed_at` records when the page was read, not when a rate takes
  effect, so a scheduled row cited in advance (a 2027 rate observed in 2026) is covered
  by an alias source from the same announcement; requiring the alias observation to
  fall inside the billing window was rejected because it would reject exactly those
  advance citations. A vendor change that prices
  the snapshot differently closes the alias with `to_date`. `resolvePrice`
  (`src/pricing/resolve.ts:19`) tries the canonical key first, then an alias in the same
  vendor table whose window contains the session date, then prices the canonical
  model's row for that date. A canonical entry always shadows an alias: R2(a) makes an
  id that is both a CI failure, so the price PR that introduces an alias for an id that
  already has a canonical entry removes that entry in the same change. The first such
  migration is `claude-haiku-4-5-20251001`: its duplicate entry from PR #369 (one row
  from 2026-09-22) becomes an alias of `claude-haiku-4-5` with `from_date` equal to the
  start of that model's priced history (`2026-01-01` today) and `to_date: null`, cited
  from Anthropic's models page, so sessions before 2026-09-22 price too and the two ids
  can no longer drift apart. The resolved price keeps the canonical `model` and carries
  the matched alias id and the alias's `sources`. `priceRowsUsed` in `--json`
  (`src/receipt/json.ts:93`) emits them as `matched_id` and `alias_sources`, so the
  dollar traces to the transcript id, the cited mapping and the cited row (I3).
  Displayed model labels stay the transcript id. There is no heuristic normalization:
  no suffix or date stripping, no case folding, no removal of `[1m]`-style context
  suffixes. Provider-prefixed ids (Bedrock `anthropic.` and `us.anthropic.` forms with
  `:0` versions, Vertex `@` and `publishers/` forms) are not admissible aliases and stay
  unresolved, because those surfaces carry their own regional prices.
- **R2. Alias uniqueness and integrity, enforced in CI.** A new table-driven test over
  every `data/prices/*.json` asserts: (a) no alias id equals any canonical model id or
  any other alias id within its vendor table, since resolution picks the vendor table
  first and a within-vendor duplicate would let lookup order choose the dollar rate;
  (b) no alias id equals any canonical id or alias id in any other vendor table; (c) no
  alias id equals an `omitted` model id in any table; (d) every alias id routes through
  `vendorForModel` (`src/pricing/resolve.ts:233`) to the vendor table that holds it, so
  no cited alias is unreachable; (e) no alias id contains `/`, `:`, `@`, `[` or `]`,
  which makes R1's provider-prefix and suffix exclusions mechanical; (f) every alias
  window is a valid calendar range with `from_date <= to_date` and lies inside the
  canonical model's priced history; (g) R1's per-period evidence rule holds.
- **R3. A named unpriced-model line from the resolver's own reason.** Resolution gains
  an explicit reason for every unit it does not price, computed where the unit is
  actually priced (`priceTurn`, `src/pricing/resolve.ts:331`, and `priceSessionTurn`,
  `src/pricing/resolve.ts:377`), never by a separate lookup. The reasons that produce a
  line, with exact text (the `caveat: ` prefix matches every other caveat line, so a
  reader scanning for that word finds all of them; Q3 is resolved this way):
  - vendor resolved, id absent from that vendor table's `models` and `aliases`:
    `caveat: model <id> not in bundled <vendor> price table (latest citation <date>); tokens only`
  - no vendor resolved and the id is absent from every bundled table's `models`,
    `aliases` and `omitted`:
    `caveat: model <id> not in bundled price tables (latest citation <date>); tokens only`
  - vendor resolved, id in that table's `omitted` array:
    `caveat: model <id> omitted from bundled <vendor> price table; tokens only`
  - vendor resolved, id known (canonical or alias) but no row or alias window covers
    the unit's date: `caveat: model <id> has no bundled <vendor> price for <session
    date>; tokens only`

  Every other unpriced reason produces no line and keeps today's output: an
  `unpriceable` session, a router or custom provider (`pricingProvider === null`,
  `src/pricing/resolve.ts:260`), no vendor resolved while some table knows the id,
  missing model or timestamp, malformed usage, zero-usage units, and a missing or
  unreadable table. **Latest citation** is the newest `observed_at` across the
  `sources` of `price_history` rows only (alias and candidate citations never advance
  it), in the vendor table checked, or across all bundled tables for the no-vendor
  branch. It states only "no bundled price evidence in this table is newer than this
  date", not that every row was re-verified then; that is why the text says "latest
  citation" rather than presenting it as a review date. A hand-bumped top-level
  `generated_at` was rejected: it can advance without any re-verification and is tied
  to no citation (I3). **Session date** is the UTC date (`isoDateOf`,
  `src/pricing/resolve.ts:270`) of the first unpriced unit for that id. Lines appear one
  per distinct id in first-appearance order. Text surfaces cap at three lines plus
  `caveat: +<n> more unpriced model ids`; `--json` carries every line uncapped. The line is a new
  caveat kind `unpriced-model` (`src/receipt/caveats.ts:19`), built in
  `buildReceiptModel` next to the partial-coverage caveat (`src/receipt/model.ts:427`),
  rendered on every surface that already renders caveats, and exported as an additive
  enum value (`src/receipt/exportSchema.ts:199`) documented in `docs/json-schema.md`. No
  new surface renders it. **Display id.** The transcript id is untrusted text, so the
  line carries a bounded display form and `--json` carries the raw id: the caveat's
  `detail` holds the id after `sanitizeText` (`src/parse/util.ts:112`), whole; the line
  text uses that value with every character outside `[A-Za-z0-9._:/@+\[\]-]` replaced
  by `?` and then capped at 64 characters with a trailing `…`. The replacement keeps
  dollar-shaped text (`$100` inside an id) out of an unpriced receipt, where
  `validateReceiptBlocks` rejects any `$` (`src/receipt/blocks.ts:276`), and the cap
  keeps the SVG note, which renders as one unwrapped `<text>` element
  (`src/receipt/svg.ts:326`), inside the card. The `+<n> more` overflow line and the
  cap of three apply after this bounding. **Subagent rollup.** A full-session receipt
  names unpriced ids from rolled-up child transcripts too: `rollupChildren`
  (`src/pr/rollup.ts:99`) copies each child's `unpriced-model` caveats onto its
  `SubagentRow`, and `attachSubagentRollup` merges them into the parent's list, deduped
  by raw id, parent ids first and then children in row order, before the cap. The
  generic `subagents-unpriced` caveat stays as it is. `--json` lists every merged id.
- **R4. Coverage eligibility vs comparison eligibility.** A vendor table may carry a
  top-level `comparison_candidates` array in the `omitted` shape with a required
  citation: `{ model, reason, sources }`. A row in `models` prices sessions (coverage).
  Only models listed in `comparison_candidates` that have a current row feed
  `cheapestCurrentRow`, and through it the two lines built on it: the price-delta
  footnote (`src/pricing/waste.ts:540`) and the trivial-spans estimate
  (`src/pricing/waste.ts:278`). A table without the array, with an empty array, or whose
  candidates have no current row yields `null`; both lines are then omitted, never
  guessed. **Cheaper means cheaper for this session.** Once coverage-only rows exist,
  the cheapest listed candidate can cost more than the session's own model (a
  `gpt-5-nano` session against a listed `gpt-5.6` candidate). `priceDeltaFootnote`
  (`src/pricing/waste.ts:540`) and the trivial-spans estimate therefore emit only when
  the candidate's repriced floor is strictly lower than the session's actual floor;
  otherwise both lines are omitted and `--json` carries no `cheaperModel`. A comparison
  that costs more is never rendered as "cheaper". Membership is a recorded maintainer choice made through button 2, not
  arithmetic; `reason` states the basis and `sources` cites the vendor page it rests
  on. A per-vendor array was chosen over a per-model `comparison_candidate: true` flag
  because the whole comparison set for a vendor is then one reviewable block in the
  price PR, it mirrors the existing `omitted` idiom (`src/pricing/types.ts:61`), and an
  absent set is visible at a glance. **Compatibility seed:** the implementing PR lists
  every model that has a current row today, with `reason: "compatibility seed:
  pre-SPEC-0095 comparison set"` and the row's own price source, so `cheapestCurrentRow`
  returns the same row per vendor and existing goldens stay byte-identical. Narrowing
  that set is a later, separately cited button-2 change. The three deferred OpenAI rows
  (`gpt-5.4-nano`, `gpt-5-mini`, `gpt-5-nano`) then land in their own button-2 price PR
  as coverage-only, absent from `comparison_candidates`. Rejected alternatives:
  **(b) today's rule** (lowest current input rate) couples every coverage row to the
  headline line, so a sub-mini model silently becomes the comparison and coverage PRs
  stay held hostage to that line; **(c) agent-selectable models** needs a cited
  per-agent, per-plan model list that vendors do not publish in a stable, citable form,
  and it would turn the price table into an agent-capability registry.
- **R5. Tripwire and cite-check learn the fields.** `scripts/cite-check.ts` validates
  `aliases[]` (string `id`, `from_date` and `to_date` as valid calendar dates with
  `to_date` null or not before `from_date`, non-empty `sources` with `url` and
  non-empty `excerpt`) and `comparison_candidates[]` (string `model` present in
  `models`, non-empty `reason`, sources as above), adds their URLs to the liveness set,
  and now requires `observed_at` on every source, because R3 derives the latest citation
  from it (every source on main already carries one). `scripts/price-tripwire.mjs` adds
  alias ids to the discovery `known` set (`scripts/price-tripwire.mjs:151`) so cited
  snapshots stop reappearing as discoveries. For every alias current today that the
  community dataset also lists, it compares the dataset's rates for the alias id against
  the canonical model's current row; a mismatch is reported as drift
  `vendor/<canonical> via alias <id>.<field>` and counts toward the existing drift exit
  code. `data/prices/README.md` documents both fields in the same PR.
## Deferred proposal: price-table age telemetry (Q4, not a requirement)

This section is not part of the build contract. SPEC-0094 (approved) keeps
`priceTableAgeBucket` out of scope, so shipping it needs the maintainer's yes on Q4 and
then its own amendment to SPEC-0043 and SPEC-0094 with the disclosure PR. The proposal,
kept here so the question stays answerable: `receipt_generated` already carries `cliVersion`
  and `installHash` (#374, `src/telemetry/index.ts:170`). It would gain `priceTableAgeBucket`
  in `["session_before_table", "0-7d", "8-30d", "31-90d", ">90d", "unavailable"]`. The
  question it answers: are zero-priced receipts sessions that postdate their bundled
  price evidence (a stale bundle), or sessions within it (a missing model or an old
  install, split further by `cliVersion`)? Value: whole days from the session's
  applicable latest-citation date to the session's UTC start date, computed per session
  and only for sessions whose pricing path actually checked a bundled table. Per
  session: with several resolved vendors, the oldest latest citation among them; with
  no resolved vendor but at least one unit that reached the no-vendor lookup (the R3
  bundle-wide branch), the bundle-wide date; a session whose units all carry
  `pricingProvider === null` or that is `unpriceable`, or that has no start date, has no
  age. For a multi-session receipt (a PR receipt), each session's age is computed from
  its own start and its own citation date, and the receipt reports the largest age
  (the most stale pair); pairing the earliest start with the oldest citation across
  sessions was rejected because it can name an age no session has. `unavailable` when no
  session has an age. Computed from bundled data and the transcript, never the wall
  clock. It would ship
  with the SPEC-0043 disclosure in the same PR: `docs/telemetry.md`,
  `--telemetry-show`, and the schema test (`src/telemetry/schemas.test.ts`). A model id
  or vendor family field (the plan's `unpricedModelFamily`) is rejected under I4 by
  review: the unpriced id is exactly the transcript-derived string that can name a
  private deployment or a fine-tune, and a vendor enum adds little that `agentType` plus
  the age bucket do not already give.

## Scenarios

- **Given** a Claude Code session dated 2026-08-10 whose Haiku subagent turns record
  `claude-haiku-4-5-20251001`, and `anthropic.json` has replaced that id's duplicate
  canonical entry with a cited alias of `claude-haiku-4-5` windowed from 2026-01-01,
  **when** the receipt renders, **then** those turns price at the `claude-haiku-4-5` row
  for their date, the model label reads `claude-haiku-4-5-20251001`, and `--json`
  `priceRowsUsed` carries `model: "claude-haiku-4-5"`,
  `matched_id: "claude-haiku-4-5-20251001"` and the alias's `alias_sources`. With the
  duplicate entry still present, CI fails R2(a) naming both entries.
- **Given** a full-session receipt whose child transcript alone runs an id no table
  knows, **when** the receipt renders, **then** the parent's text and `--json` name that
  id in an `unpriced-model` line next to the existing `subagents-unpriced` caveat.
- **Given** an unpriced id containing `$100` or 200 characters, **when** the receipt
  renders, **then** the line shows `?100` or the first 64 characters plus `…`,
  `validateReceiptBlocks` reports no `dollar-in-unpriced` violation, the SVG stays
  inside the card, and `--json` carries the whole sanitized id.
- **Given** a canonical price change on date D whose new row was first cited on date C,
  and an alias whose sources were all observed before C, **when** CI runs, **then**
  R2(g) fails; with a source observed on or after C (even when C is before D, as for a
  scheduled rate) it passes, and sessions on both sides of D price at their own row.
- **Given** a transcript id `claude-haiku-4-5-20991231` that no table cites, **when**
  resolved, **then** it is tokens-only and the vendor-scoped absent line names it; no
  stripping to `claude-haiku-4-5` happens.
- **Given** a Bedrock id `us.anthropic.claude-haiku-4-5-20251001-v1:0`, **when**
  resolved, **then** it stays tokens-only and the no-vendor absent line uses the
  bundle-wide latest citation.
- **Given** a price PR that adds an alias equal to another vendor's canonical id, or two
  aliases with the same id in one vendor, **when** CI runs, **then** the R2 test fails
  and names both entries.
- **Given** a Codex session on `gpt-6-sol`, no row or alias for that id, and an OpenAI
  table whose newest row citation is 2026-09-22, **when** the receipt renders, **then**
  it shows `caveat: model gpt-6-sol not in bundled openai price table (latest citation
  2026-09-22); tokens only`, and ten consecutive runs are byte-identical.
- **Given** a DeepSeek session dated after the flat rows closed on 2026-08-15, **when**
  the receipt renders, **then** it shows `caveat: model deepseek-v4-pro has no bundled
  deepseek price for <session date>; tokens only` rather than claiming the id is unknown.
- **Given** an opencode session routed through a custom provider (`pricingProvider`
  null) on `claude-sonnet-5`, **when** the receipt renders, **then** no R3 line appears.
- **Given** the three sub-mini OpenAI rows land as coverage-only, **when** a Codex
  session on `gpt-5-mini` renders, **then** it is priced, and the price-delta and
  trivial-spans lines compare against the cheapest listed candidate only when that
  candidate's floor is lower than the session's own; a `gpt-5-nano` session, cheaper
  than every listed candidate, renders neither line and exports no `cheaperModel`.
- **Given** a vendor table with no `comparison_candidates`, **when** a session of that
  vendor renders, **then** no price-delta footnote and no trivial-spans line appear.

## Non-goals

- **Sibling or family pricing.** Pricing an unknown id at a related model's rate
  fabricates a dollar (I2). Permanent.
- **Network lookups** of prices or aliases at render time (I1). Permanent.
- **Heuristic id normalization** (date-suffix stripping, `[1m]` removal, lowercasing).
  An id resolves only by a cited mapping.
- **Provider-prefixed Bedrock and Vertex ids.** They carry their own regional prices;
  pricing them needs cited provider tables, which is a separate spec.
- **Moving pointer aliases** (an alias the vendor later repoints to a different model).
  R2 is strict id uniqueness; a repointed alias is closed with `to_date`, and the new
  mapping waits for a follow-up that relaxes R2 to date-disjoint windows (Q2).
- **A comparison-set policy.** This spec ships the mechanism and a byte-neutral seed;
  which models belong in each vendor's set is decided in button-2 PRs (Q1).
- **DeepSeek time-of-day pricing.** A separate maintainer decision (plan decision 1).
- **Any change to receipt dollar arithmetic.** `costOf`, context tiers, cache rules and
  lower-bound qualifiers are untouched; only which row a unit resolves to changes.
- **Editing the `update-prices` skill.** The skill surface is maintainer-curated
  (button 3); the README documents the fields and the maintainer may amend the skill.
- **Seeding real aliases.** Alias data lands in button-2 price PRs.

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | alias resolves | fixture table with cited alias; session inside window | canonical row priced; label is transcript id |
| R1 | alias trace | same fixture, `--json` | `priceRowsUsed` has `matched_id` and `alias_sources` equal to the fixture citation |
| R1 | alias outside window | same alias; session before `from_date` | unpriced; R3 no-dated-row line |
| R1 | canonical wins | id is canonical in the table | canonical row, no `matched_id` |
| R1 | no heuristics (fast-check) | arbitrary suffix, case and `[1m]` variants of priced ids | every uncited variant unpriced |
| R1 | provider prefix | Bedrock and Vertex id forms | unpriced; tokens-only |
| R1 | mutation | `src/pricing/resolve.ts` alias path | incremental Stryker score not below the current threshold |
| R2 | within-vendor duplicate | alias equals a canonical id; two equal aliases in one vendor | test fails naming both |
| R2 | cross-vendor duplicate | alias equals another vendor's canonical or alias id | test fails |
| R2 | omitted, routing, charset | alias equals an `omitted` id; alias not routed by `vendorForModel`; alias containing `:` | each fails |
| R2 | windows and per-period evidence | window outside history; `to_date` before `from_date`; alias spanning a price change with no source at least as new as the later row's earliest citation | each fails; the evidenced variant passes and prices each side at its own row; a scheduled row cited in advance passes with an alias source from the same day |
| R2 | live tables | every `data/prices/*.json` | passes |
| R3 | vendor absent | unpriced `gpt-6-sol` fixture | exact vendor-scoped absent line; golden |
| R3 | no-vendor absent | `us.anthropic.` id | exact bundle-wide absent line |
| R3 | omitted | `gpt-5.5` fixture | exact omitted line; golden |
| R3 | no dated row | DeepSeek session after 2026-08-15 | exact no-price-for-date line; golden |
| R3 | reason source | a unit unpriced for each resolver reason | line text chosen from the reason `priceSessionTurn` returned, not a second lookup |
| R3 | suppressed | `unpriceable`; router provider; no vendor but id known elsewhere; missing timestamp; malformed usage; zero-usage unit; unreadable table | no line; bytes equal to the pre-change golden |
| R3 | cap and order | five distinct unpriced ids | text: three lines in first-appearance order plus `+2 more unpriced model ids`; `--json`: all five |
| R3 | hostile id | 200-character id; id with control characters; id containing `$100`; id with a `<text>` fragment | line shows the bounded display form (64 characters plus `…`; `?` for each disallowed character, so no `$`); `validateReceiptBlocks` passes; SVG golden stays inside the card; `--json` `detail` carries the whole sanitized id |
| R3 | subagent rollup | parent priced; one child on an unknown id; two children sharing an unknown id | parent text and `--json` name each id once, parent ids first; `subagents-unpriced` still present |
| R3 | latest citation | fixture tables whose alias or candidate sources are newer than any row source | date uses row sources only; per vendor; bundle-wide max for the no-vendor branch |
| R3 | determinism | the R3 goldens | `determinism-check --runs=10` byte-identical |
| R4 | candidate filter | fixture with a cheaper non-candidate row | `cheapestCurrentRow` returns the cheapest listed candidate |
| R4 | no candidates | array absent, empty, or no current candidate row | `null`; price-delta and trivial-spans lines omitted |
| R4 | seed neutrality | each vendor's `cheapestCurrentRow` before and after seeding; all existing goldens | same model per vendor; goldens byte-identical |
| R4 | coverage-only rows | fixture adding `gpt-5-mini` and `gpt-5-nano` rows, not candidates | sessions on them priced; both comparison lines unchanged for sessions the candidate undercuts |
| R4 | candidate not cheaper | session on a coverage-only row cheaper than every listed candidate; session on the cheapest candidate itself | no price-delta footnote, no trivial-spans line, no `cheaperModel` in `--json` |
| R5 | cite-check shapes | alias or candidate missing `sources`, `excerpt` or `observed_at`; invalid calendar date; reversed window; unknown `model` | exit 1 naming the entry |
| R5 | cite-check liveness | alias and candidate URLs | included in the liveness set |
| R5 | tripwire discovery | dataset lists a cited alias id | alias id absent from the discovery feed |
| R5 | tripwire drift | dataset alias rate differs from the canonical row | drift entry `via alias`; exit 3 |

## Success criteria

- [ ] A real Claude Code session dated before 2026-09-22 on `claude-haiku-4-5-20251001`
      prices only after a button-2 PR replaces PR #369's duplicate canonical entry with
      an alias cited from Anthropic's models page; before that PR it shows the R3
      no-price-for-date line, and CI rejects the alias while the duplicate remains.
- [ ] Local corpus check: in the maintainer's 30-day corpus, every unpriced unit that
      falls in an R3 line-producing reason appears in `--json` caveats, and every other
      unpriced unit maps to one of the named suppression reasons. Zero units are
      unaccounted for.
- [ ] The three deferred OpenAI rows can merge as coverage-only with zero changes to the
      price-delta and trivial-spans goldens.
- [ ] The R2 test, the R5 cite-check cases and the tripwire cases pass against the live
      tables in CI.
- [ ] Field check after release, from existing fields only: among receipts with tool
      calls on the new version, the `pricedRowCoverage=none` share split by
      `cliVersion`, compared with the same share on the previous version. Measured only
      once at least 100 such receipts from at least 10 distinct non-maintainer installs
      exist; until then the result is "insufficient sample". The stale-bundle split
      needs the deferred age-bucket proposal (Q4).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs` and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`), plus `node --experimental-strip-types scripts/cite-check.ts` and
      incremental mutation testing on `src/pricing/**`.

## Open questions for the maintainer

- **Q1. Comparison-set policy.** After the byte-neutral seed, what rule admits a model
  to `comparison_candidates`? The draft's earlier rule ("a cited vendor page describes
  it as intended for coding or agentic tool use") was demoted to a proposal because the
  seed cannot satisfy it without changing today's comparisons.
- **Q2. Moving pointer aliases.** Should R2 later relax to date-disjoint uniqueness, so
  an alias the vendor repoints (a bare family id) can map to a new model from a date?
- **Q3. Line prefix: resolved in rev 3.** The R3 lines carry the `caveat: ` prefix
  like every other caveat, so the exact strings are fixed for golden gating. Dropping
  it later is a one-line golden change the maintainer can request.
- **Q4. Ship the price-table age telemetry?** The independent critic argued it should
  be cut until a measurement decision needs it; the Codex GitHub review noted it
  conflicts with approved SPEC-0094. It is now a deferred proposal (section above),
  outside the build contract, kept because it is the only way to split "stale bundle"
  from "missing model or old install" in the field, as the plan asks.

## Validation

**2026-09-22 · S1 (self, drafting context).** Every user-visible line was checked for
measurability and I1 to I6. One honesty gap was fixed before S2: a provider-pinned
vendor whose table lacks an id held by another table would have read "not in bundled
price tables", which is false. Evidence gathered: the maintainer's last-30-days Claude
Code transcripts carry `claude-haiku-4-5-20251001` on 136 records, which is the one id a
cited alias would fix. The other unpriced ids there (`claude-fable-5-1`,
`claude-opus-5`, `claude-opus-5-5`, `gpt-6-sol`, `gpt-6-astra`) need canonical rows,
not aliases. `claude-fable-5-1[1m]` appears 10 times and stays unresolved by design.

**S2 (Codex, independent context, read-only).** Eight findings; verdict "defer".
- BLOCKER, alias dollar not traceable and "same price" unproven across a canonical
  price change: **accepted.** R1 now exports `alias_sources` and requires alias
  evidence inside every price period it covers; R2(g) enforces it with a two-sided test.
- MAJOR, R3 reason computed separately from pricing: **accepted.** R3 now reads the
  reason returned where the unit is priced, and wording is scoped to the table checked.
- MAJOR, max `observed_at` overclaims freshness: **accepted in part.** The date is kept,
  because the plan wants the line dated, but it is labeled "latest citation", counts row
  sources only, and the spec states its narrow meaning. The omitted and no-dated-row
  lines drop the date because it adds nothing there.
- MAJOR, R4 admission rule conflicts with the byte-identical seed: **accepted.** The
  seed is an explicit compatibility seed; the admission rule moves to Q1.
- MAJOR, field check not measurable: **accepted.** The corpus check is local and
  reason-complete, and the field check uses `pricedRowCoverage` plus R6 only.
- MAJOR, cut R6 or define aggregation: **accepted in part.** Aggregation and the
  question it answers are defined; the cut is left to the maintainer as Q4.
- MINOR, missing matrix rows: **accepted.** Rows added for alias trace, two-sided price
  changes, cross-vendor suppression, zero-usage units, hostile ids and calendar dates.
- MAJOR, scope larger than the demonstrated miss: **rejected as a cut, recorded as a
  dissent.** Aliases alone are a small fix, but R3 and R4 address needs that recur at
  every model launch and a live blocker (three held rows), not the Haiku id alone.

**S3 (worth).**
- *Who and how often.* Every user whose agent runs a model the bundle does not cover.
  That was more than half of real receipts with tool calls in September. The gap
  reopens at each vendor launch until the next price release, which has happened three
  times since July. Aliases specifically: Claude Code users whose subagents record the
  Haiku snapshot id, 136 records in one maintainer corpus. Frequency across users is
  unmeasured.
- *One-off vs recurring.* Recurring. Model launches outpace price releases. The coupling
  in R4 blocks coverage rows now and will block them again for every sub-mini model.
- *Do-nothing.* Receipts stay honest, since tokens-only preserves I2. They stay silent
  about why, though, and the three OpenAI rows stay unmerged or silently change the
  headline comparison. That outcome is acceptable for R1 alone and not acceptable for
  R4.
- *Smaller fix.* A docs line ("tokens only means the model is not in the bundled
  tables") covers part of R3 but cannot name the id or table. A one-off canonical row
  for the snapshot id would duplicate the Haiku row and drift from it; R1 is the cited
  form of that same fix. R4 has no smaller form under decision 0 option (a).
- *Steelman the cut.* Price PRs plus a 7-day release policy close most of the gap. R3
  is a receipt-copy change whose value is unmeasured, and R6 adds telemetry for a
  question that `cliVersion` may already answer.
- *Kill criterion dry-run.* The kill criterion in Purpose has live evidence against it
  firing: one alias-resolvable id and five R3-reaching ids exist in the corpus today.
- **Verdict: build now**, for R1 to R5, with R6 flagged for the maintainer (Q4).
  Codex's "defer" is recorded as the dissent. If the maintainer prefers the narrow
  path, the cut order is R6, then R5's drift half, then R3.

**S4.** `node scripts/spec-lint.mjs` on this file: pass.

**2026-09-23 · S5 (Codex GitHub review of PR #378, six findings, all accepted).**
- P1, `claude-haiku-4-5-20251001` is already a canonical entry since PR #369, so the
  motivating alias could never fire and R2(a) would reject it: Purpose, R1, the first
  scenario and the first success criterion now describe the duplicate and require the
  alias PR to remove it in the same change.
- P1, a `$`-shaped id would put a dollar string into an unpriced receipt: R3 gains a
  bounded display form (`?` for disallowed characters) with the raw id in `--json`.
- P2, an unbounded id breaks the single-line SVG note: the same display form caps at
  64 characters; the hostile-id matrix row now lists the four inputs and the SVG check.
- P2, R6 pairing the earliest start with the oldest citation across sessions names an
  age no session has: ages are per session and the PR receipt reports the largest.
- P2, router-only and `unpriceable` sessions were assigned a bundle-wide age: they are
  `unavailable`, and the bundle-wide date applies only to sessions that reached the
  no-vendor lookup.
- P2, `rollupChildren` drops child caveats: R3 propagates child `unpriced-model`
  caveats through `SubagentRow`, deduped by raw id, with a matrix row.
Status moved to `approved` on the maintainer's instruction to address the review and
start the build (R1 to R5; R6 stays a maintainer question, Q4).

**2026-09-23 · S6 (Codex GitHub review of rev 2, four findings, all accepted).**
Build note: the seed itself is byte-neutral; the strictly-cheaper rule removed self-comparison price-delta lines from four context-thrash goldens whose session model was the cheapest candidate (deliberate I5 update).
- P1, an approved spec cannot carry R6 while approved SPEC-0094 excludes the field:
  R6 is no longer a requirement; it is a deferred proposal section outside the build
  contract, its scenario, matrix rows and success criterion are removed, and the
  invariants line says R1 to R5 add no telemetry field.
- P1, Q3 left the exact R3 strings undecided: resolved, the lines carry `caveat: `.
- P2, R2(g) rejected advance citations of scheduled rates (Gemini 3.7/3.8 rows
  effective 2027-01-01 cited on 2026-09-22): the per-period rule now requires alias
  evidence no older than the row's own earliest citation, not inside its billing window.
- P1, the cheapest listed candidate can cost more than the session's model once
  coverage-only rows exist: R4 requires a strictly lower repriced floor, otherwise both
  comparison lines and `cheaperModel` are omitted; matrix row and scenario added.
