# Current-main reconciliation and revised priorities

Date: 2026-09-22. Freshly fetched `origin/main`: `34867fa8515230a9c283b1d40c975dca85487633`. Repository release inventory: v0.11.0.

The initial checkout was an older feature branch at `a56a6a7`, whose inventory described v0.2.0. Before delivery, a worktree inventory exposed newer main. The research team inspected an immutable archive of current main through a freshly indexed codebase-memory graph, reviewed its docs/specs, then advanced the new research worktree to that same commit while preserving the research. The original checkout and its dirty files were not changed.

**This reconciliation and the revised synthesis govern implementation priorities.** Earlier code-audit references explicitly describe the historical checkout. Several initial gaps have already been fixed; rebuilding them would waste effort.

## What is already implemented

| Area | Current code evidence | Consequence for the plan |
|---|---|---|
| Context-tier pricing | `src/pricing/types.ts:36` / `:45`; `src/pricing/resolve.ts:74` | No new generic context-tier schema required |
| Request-local pricing identity | `src/parse/types.ts:83`; `src/pricing/resolve.ts:377` | Reuse `PricingUnit`, provider/model/date gates and per-request resolution |
| Standard-API-equivalent floors | `src/receipt/costEstimate.ts:8`, `:25`, `:34`; `docs/trust.md` | Billing-basis distinction and uncertainty are already public contracts |
| Codex request reconciliation | `src/parse/codex.ts:396`, `:425`, `:507` | Contradictory request evidence already suppresses request dollars |
| Reasoning billing | `src/parse/codex.ts:42`, `:70` | Reasoning is validated as a subset of output; do not propose charging it again |
| Cache categories and details | `src/receipt/present.ts:411`, `:425`, `:451` | Read/write/TTL detail and read-only cache arithmetic already exist |
| Cost-shape facts | `src/pricing/costShape.ts:95`; `src/receipt/model.ts:326` | Pre-edit share, expensive-turn concentration and confounded late-turn ratio already exist |
| Same-file rereads | `src/pricing/waste.ts:188`; `src/receipt/model.ts:327` | Standalone low-confidence diagnostic already excludes recorded edits, compactions, failed reads and shell touches |
| Loop source positions | `src/receipt/model.ts:338`; `src/receipt/present.ts:339` | Model/text already retain locations; JSON consistency is the narrower gap |
| Pattern handoff | `src/receipt/handoff.ts:70`, `:104`; `src/pr/body.ts:623` | Largest observed-cost class subtotal, not a sum of overlaps or a savings prediction |
| Exported interpretation | `src/receipt/json.ts:262` | Legacy `couldHaveSaved` key is explicitly heuristic-pattern pricing; percentage is null |
| Scoped discovery failure | SPEC-0045 shipped; `docs/trust.md` discovery entry | Do not reopen the old scoped discovery fix as missing work |
| Child cost rollups | SPEC-0060/0061 shipped and documented on session/PR/JSON/statusline surfaces | Extend timing/evidence only if useful; do not rebuild child-cost inclusion |
| Cost-model documentation | `docs/cost-model.md`, including independent oracle discussion | Documentation exists despite stale “missing docs” inventory wording |

These references are for current-main commit `34867fa`, not the historical audit's line numbers. Spec frontmatter alone is not an implementation inventory: SPEC-0067/0068 still say approved while code and published schema contain their features. Reconcile remaining acceptance/corpus evidence rather than assuming the features are unbuilt.

The historical GPT-5.5 short-rate concern is also superseded: `data/prices/openai.json:127` deliberately omits GPT-5.5 because its session-wide context tariff scope cannot be safely inferred for a request or PR slice.

## Concrete current issues and opportunities

### 1. Investigate price drift before any new savings calculation

Two current-table conflicts deserve immediate investigation through the cited-price process:

| Model | Current repo row | Official page observed 2026-09-22 | What remains unknown |
|---|---|---|---|
| Claude Sonnet 5 | `data/prices/anthropic.json:63`: September 1 onward input/output 3/15 USD per million | Current cache table input/output 2/10, with corresponding lower write/read prices | Whether an announced increase was cancelled, deferred or otherwise qualified; historical effective interval |
| GPT-5.6 Sol | `data/prices/openai.json:43`: input/output 5/30 USD per million; cited July 10 | Current pricing table 4/20 short context, 8/30 long context; promotional pricing mentioned | Promotion start, eligibility and applicable date interval; confirm model-page/table alignment |

Sources: [Anthropic caching table](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing).

These are verified conflicts between recorded and currently displayed rates, **not proven incorrect historical receipts or invoices**. A current webpage does not establish when a change became effective. Do not overwrite old rows or backdate current prices from access date. Resolve announcements, exact model/tier eligibility and effective intervals; if history cannot be established, preserve explicit uncertainty.

If a stale row exceeds the applicable Standard list price, labeling its result a floor does not repair the arithmetic. This makes drift investigation a higher-priority task than a new pricing architecture. No price rows were edited in this research.

### 2. Extend gross cache-read arithmetic to net write-adjusted economics

`src/pricing/resolve.ts:153` and the details view already show a read-only same-token cache comparison. The useful increment is subtracting the observed write premium and any observable storage charge on a common, complete component set.

Start with compatible Claude traces whose write/TTL fields are actually present. Codex explicitly lacks persisted write counters; the zero normalization at `src/parse/codex.ts:87` does not prove no writes were billed. Its current read-only comparison must not be promoted to a net benefit.

**Subtracting two lower-bound totals does not yield a lower-bound savings number.** A net arithmetic comparison requires known common coverage; otherwise keep the read-only fact and explain which component is missing. Suppress economic conclusions if unresolved write or tariff evidence can change the sign.

### 3. Use retained outcomes to improve the existing loop detector

`flattenCalls` now preserves raw input, shell marker and status (`src/pricing/waste.ts:70`), so the historical statement that it drops status is obsolete. However `detectStuckLoops` at line 105 still compares consecutive tool/input identities without using those outcomes. This is a smaller implementation opportunity than creating a general event schema.

The short-output repricing heuristic remains at `src/pricing/waste.ts:270`, now with stricter per-unit pricing evidence. Its pricing integrity has improved; the heuristic still does not establish task difficulty or cheaper-model success. Evaluate wording and actionability without weakening its existing evidence gates.

Loop locations now survive into the model/text, but `wasteLineJson` at `src/receipt/json.ts:57` still omits them for stuck-loop findings. Trivial-span locations are omitted earlier. Consistent versioned evidence references are a narrow export improvement.

### 4. Add verification chronology and test advice empirically

Existing handoff already connects detected patterns to fixed next-run advice. The new question is whether that advice is applicable and useful. Add observed checks, post-check edits and unresolved terminal outcomes only where source coverage permits. Use current handoff and `compare`; trial a manual local task/outcome sidecar before building experiment infrastructure.

For existing same-file reread and cost-shape facts, evaluate comprehension and remaining independent corpus gates. Do not relabel rereads as unnecessary work or require a statistical waste-classification gate for an exact neutral arithmetic identity. The stricter gate in the plan applies to new default waste/causal labels, not every descriptive fact.

### 5. Respect the rejected onboarding proposal

SPEC-0081 is rejected. Its tombstone records unsupported funnel inference from a tiny cohort and a misleading use of nonzero exit counts. It suggests a smaller controlled-exit taxonomy/measurement follow-up. Do not resurrect automatic demos or generic conversion flows as a new research discovery. The proposed 12-person pilot is qualitative observation of existing onboarding and new insight usability; it makes no conversion-lift claim.

## Revised implementation order

1. Reconcile the two dated-price conflicts; verify actual remaining SPEC-0044 acceptance evidence and spec-status drift.
2. Audit source-field coverage and independently label current loop/reread/advice behavior.
3. Extend shipped cache details with net write-adjusted arithmetic only for complete evidence.
4. Improve loop outcome handling and JSON evidence parity as narrow follow-ups.
5. Add one verification chronology slice to existing handoff.
6. Measure one workflow intervention with all attempts, acceptance and missing prices retained.

Current-main verification results are recorded separately from the initial older-baseline run in [Validation and Review](Validation%20and%20Review.md). This correction removes redundant work while preserving the research's core recommendation: reliable observations, a specific available action, and measured task outcomes.
