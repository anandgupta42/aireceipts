# Sonnet 5: cancelled September price increase

The maintainer authorized implementation of the price-fidelity research plan on
2026-09-22. This is a vendor-only maintenance change under SPEC-0005 and
`update-prices`; it does not change pricing semantics or authorize a release.

Anthropic's [August 10 release note](https://platform.claude.com/docs/en/release-notes/overview#august-10-2026)
confirms that Sonnet 5's introductory input/output rates became standard and the
September 1 increase was cancelled. The [current cache table](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
corroborates input/output 2/10, reads 0.20, five-minute writes 2.50 and one-hour
writes 4 USD per million tokens. Both pages were opened on 2026-09-22.

The erroneous scheduled 3/15 row never became a historical tariff. Remove that
row and extend the existing unchanged 2/10 row; preserve its original numbers,
start date and original announcement citation, alongside the cancellation source.
This is a correction of a cancelled future announcement, not an overwrite of a
rate that users actually paid. The inherited pre-launch start date is unchanged;
no historical backfill is claimed by this correction.

A request with one million ordinary input, output and cache-read tokens plus one
million writes in each TTL category now contributes 18.70 USD to the Standard
API-equivalent arithmetic on September 1, rather than 28.05. The renderer still
qualifies all observed amounts as floors; neither figure is invoice evidence.

Regression cases cover August 9/10, August 31/September 1, the research date,
both write TTLs and wrong-vendor/unknown-model abstention. The old September
resolver expectation is deliberately corrected, with equivalent assertions
retained and additional independent rate arithmetic.

Validation on 2026-09-22: the built CLI read a local Sonnet 5 session through
normal discovery and JSON rendering. The parent used the corrected row; unknown
child usage remained unpriced. Only accounting metadata was inspected, with
telemetry disabled; no private transcript content or identifiers are included here.
A synthetic September 1 variant of `cache-tier-fallback-split.jsonl` independently
produced 0.00996 USD for 4,780 tokens. The product renderer's light/dark PNGs were
visually checked: total floor, TTL split and qualifiers remained legible.

Typecheck, lint, 102 golden artifacts, ten determinism runs, spec lint, hygiene
and citation checks passed. Two concurrent full-suite runs each hit a different
existing 200ms statusline timing assertion; the isolated statusline suite passed
all 51 tests without changes. The final test result is recorded in the PR.
