# GPT-5.6 Sol: dated promotional price change

The maintainer authorized implementation of the price-fidelity research plan on
2026-09-22. This vendor-only maintenance change uses SPEC-0005's reviewed context
tier amendment and `update-prices`; no pricing architecture changes are needed.

The official [August 21 changelog entry](https://developers.openai.com/api/docs/changelog#august-2026)
dates the input/output reduction to 4/20 USD per million tokens and guarantees
the promotion at least through November 21, 2026. The [model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
retains the full-request threshold above 272,000 prompt tokens and write-rate
multiplier. The [price table](https://developers.openai.com/api/docs/pricing)
corroborates all short/long Standard input, cached, write and output categories.
These primary pages were opened on 2026-09-22.

Close the historical 5/30 row on August 20 without changing any historical rate.
Append a row starting August 21: input/cached/write/output 4/0.40/5/20; above
272,000 input tokens, 8/0.80/10/30. Its end date is November 21, the last date
the source explicitly guarantees. This is a conservative coverage cutoff, not
a claim that the promotion ends that day. November 22 onward remains tokens-only
until dated evidence supports extension or a replacement; no reversion is guessed.

Regression cases cover both effective-date boundaries, the promotion coverage
cutoff, and a prompt of exactly 272,000 versus 272,001 tokens with a mixture of
uncached/read/write categories. Historical fixtures retain their old prices.
All receipt amounts retain the existing Standard-API-equivalent floor semantics;
Codex's absent cache-write counters remain absent, not inferred.

Validation on 2026-09-22: typecheck, lint, all 2,238 tests, 102 golden artifacts,
ten determinism runs, spec lint, hygiene and citation checks passed. The built
CLI also processed a local Sol-labelled session and retained its tokens-only
result: its data did not yield a matched pricing row. This is evidence that
abstention remains intact, not proof of priced coverage for that workload.
Only accounting metadata was inspected, with telemetry disabled.

A synthetic September 22 variant of `gpt-5.6-context-tiers.jsonl` exercised the
product parser and renderer: four request amounts of 0.46, 0.46, 0.4888 and
0.967608 sum to 2.376408 USD. Light/dark PNGs were visually checked for legible
floor labels and the missing-cache-write caveat. The request threshold remains
per request; the cumulative session token total does not select a tariff.
