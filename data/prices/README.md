# data/prices — cited price tables

One JSON file per vendor (e.g. `anthropic.json`, `openai.json`). Schema is a TypeScript
port of [simonw/llm-prices](https://github.com/simonw/llm-prices)'s `price_history`
model: every rate change is a new row, not an overwrite, so a session is always priced
at the rate that was live on the day it ran (I3, `AGENTS.md`).

## Schema

```json
{
  "vendor": "anthropic",
  "models": {
    "claude-fable-5": {
      "price_history": [
        {
          "input": 3.0,
          "output": 15.0,
          "input_cached": 0.3,
          "input_cache_write_5m": 3.75,
          "input_cache_write_1h": 6.0,
          "from_date": "2026-05-01",
          "to_date": null,
          "sources": [{ "url": "https://www.anthropic.com/pricing", "observed_at": "2026-07-01" }]
        }
      ]
    }
  }
}
```

- `input` / `output` — USD per million tokens.
- `input_cached` — USD per million cached-input (cache-read) tokens, if the vendor
  prices it separately; omit the field if not applicable (never guess a value).
- `input_cache_write_5m` / `input_cache_write_1h` — USD per million tokens for writing
  to the prompt cache at the vendor's 5-minute / 1-hour TTL tiers, if the vendor prices
  cache writes separately from cache reads; omit either or both fields if the vendor
  doesn't publish that tier (never guess a value).
- `input_cache_write` — the vendor's single cache-write rate when writes have no
  TTL-specific price (OpenAI's "cache writes" column).
- `context_tiers` — optional array of full rate cards, each with `above_input_tokens`,
  for vendors that price the whole request differently once prompt input (plain input +
  cache reads + cache writes) exceeds a boundary (OpenAI's >272K tier, Google's >200k
  tier). Every tier row carries complete rates; nothing is inherited from the base row.
- `from_date` / `to_date` — ISO date the rate took effect / was superseded. `to_date:
  null` means the row is currently active.
- `sources` — **required**, non-empty array of objects, each with a `url` (http/https) actually fetched and read, plus optional `observed_at` (YYYY-MM-DD) and `excerpt`. This is
  the field the `block-price-edit-without-citation` hook checks for; a PR that touches
  this directory without a `sources` array is rejected mechanically before it ever
  reaches review. `scripts/cite-check.ts` additionally (a) fetches every `url` and
  requires it to be live (HTTP < 400 — enforced in CI, offline-tolerant locally, and
  skippable with `--no-network`), and (b) **requires a non-empty `excerpt`** on any
  source `observed_at` on/after `2026-07-02`, so a reviewer can verify the number
  against the quoted page text without re-fetching (SPEC-0005 R3).

## Omitted models

A vendor whose official page prices a model in a shape the schema can't hold
honestly — priced by time of day (DeepSeek peak/off-peak), a long-context multiplier
with full-session rather than per-request scope, priority/batch-only, or tool-priced —
does **not** get a fabricated row. Instead the model is listed in an optional top-level
`omitted` array so a reviewer sees *why* a well-known model is absent rather than
assuming an oversight (SPEC-0005 R1):

```json
"omitted": [
  { "model": "deepseek-flash", "reason": "Priced by time of day …", "source": "https://…" }
]
```

Omitted models have no `price_history`, so the resolver never prices them — they stay
tokens-only, exactly as an unknown id would (I2).

## Rule

**Every row change needs a cited source URL.** No price is ever invented, inferred, or
carried over from memory. Closing out a stale row (setting its `to_date`) and appending
a new one is the only way to change a rate — historical rows are never edited in place.
The one exception is a row that never described a real rate (a vendor-announced future
change that was later cancelled): remove it and cite the cancellation on the row that
stays current.

Price tables are refreshed via the `update-prices` skill, one vendor per PR, each with a
real cited source. Never hand-write a row from placeholder or remembered numbers — that
violates I2 (never fabricate a dollar).
