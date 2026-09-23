// Self-contained validation of the seeded price tables under `data/prices/`.
//
// Unlike the adapter/pricing-resolver tests, this file has NO dependency on
// core-engine's exported contracts (`src/index.ts`) — it only reads the JSON
// files this role (test-writer) owns and checks their own internal shape and
// date-window sanity. It runs (and must pass) regardless of Wave sequencing.
//
// `scripts/cite-check.ts` already enforces the mechanical schema (types,
// citation URLs, date format) — this file adds the checks cite-check does
// NOT do: date windows are ordered/non-overlapping per model, `to_date` is
// only ever open (null) on the newest row, and `input_cached` is internally
// consistent with each vendor's documented cache-hit discount.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface TokenPriceRates {
  input: number;
  output: number;
  input_cached?: number;
  input_cache_write?: number;
  input_cache_write_5m?: number;
  input_cache_write_1h?: number;
}

interface ContextPriceTier extends TokenPriceRates {
  above_input_tokens: number;
}

interface PriceRow extends TokenPriceRates {
  context_tiers?: ContextPriceTier[];
  from_date: string;
  to_date: string | null;
  sources: { url: string; observed_at?: string; excerpt?: string }[];
}

interface PriceTable {
  vendor: string;
  models: Record<string, { price_history: PriceRow[] }>;
}

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/prices",
);

function loadTable(file: string): PriceTable {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
}

const tables: [string, PriceTable][] = [
  ["anthropic.json", loadTable("anthropic.json")],
  ["openai.json", loadTable("openai.json")],
];

const CACHE_READ_MULTIPLIER_EXCEPTIONS: Record<string, number> = {
  "claude-fable-5-1": 0.025,
  "claude-mythos-5-1": 0.025,
  "claude-opus-5-5": 0.05,
};

describe("seeded price tables — R2 cited seed tables", () => {
  for (const [file, table] of tables) {
    describe(file, () => {
      it("has a non-empty vendor and at least one model", () => {
        expect(table.vendor).toBeTruthy();
        expect(Object.keys(table.models).length).toBeGreaterThan(0);
      });

      for (const [modelId, { price_history }] of Object.entries(table.models)) {
        describe(modelId, () => {
          it("has at least one price_history row", () => {
            expect(price_history.length).toBeGreaterThan(0);
          });

          it("orders rows by from_date ascending", () => {
            const dates = price_history.map((r) => r.from_date);
            const sorted = [...dates].sort();
            expect(dates).toEqual(sorted);
          });

          it("never leaves an earlier row's to_date open (null) when a later row exists", () => {
            for (let i = 0; i < price_history.length - 1; i++) {
              expect(price_history[i].to_date).not.toBeNull();
            }
          });

          it("only the last row may have an open (null) to_date", () => {
            const last = price_history[price_history.length - 1];
            // last.to_date is either null (still current) or a closed date —
            // both are valid; this just documents the only-last-row invariant
            // by construction (checked jointly with the prior test).
            expect(last).toBeDefined();
          });

          it("has no gaps or overlaps between consecutive dated windows", () => {
            for (let i = 0; i < price_history.length - 1; i++) {
              const closes = price_history[i].to_date;
              const opensNext = price_history[i + 1].from_date;
              expect(closes).not.toBeNull();
              // The day after `to_date` must be exactly the next row's `from_date`
              // (contiguous, no silent coverage gap and no overlapping windows).
              const closesDate = new Date(`${closes}T00:00:00.000Z`);
              const dayAfter = new Date(closesDate.getTime() + 24 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10);
              expect(dayAfter).toBe(opensNext);
            }
          });

          for (const row of price_history) {
            it(`row from ${row.from_date}: input/output are positive numbers`, () => {
              expect(row.input).toBeGreaterThan(0);
              expect(row.output).toBeGreaterThan(0);
            });

            it(`row from ${row.from_date}: from_date matches YYYY-MM-DD`, () => {
              expect(row.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });

            it(`row from ${row.from_date}: to_date is null or matches YYYY-MM-DD`, () => {
              if (row.to_date !== null) {
                expect(row.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
              }
            });

            it(`row from ${row.from_date}: carries at least one https source`, () => {
              expect(row.sources.length).toBeGreaterThan(0);
              for (const s of row.sources) {
                expect(s.url).toMatch(/^https:\/\//);
              }
            });

            // Both vendors' pricing pages document a cache-hit-read discount at
            // exactly 0.1x base input (Anthropic's "Cache Hits & Refreshes"
            // column; OpenAI's "Cached input" column). We seeded every row
            // ourselves, so this checks *our own* arithmetic never drifted —
            // it does not assert this ratio holds for vendors in general.
            // Anthropic's pricing page footnotes a lower cache-read multiplier for
            // three models (0.025x on Fable 5.1 and Mythos 5.1, 0.05x on Opus 5.5);
            // every other row on both vendors' pages documents 0.1x.
            if (row.input_cached !== undefined) {
              const multiplier = CACHE_READ_MULTIPLIER_EXCEPTIONS[modelId] ?? 0.1;
              it(`row from ${row.from_date}: input_cached is exactly ${multiplier}x input (vendor-documented multiplier)`, () => {
                expect(row.input_cached).toBeCloseTo(row.input * multiplier, 10);
              });
            }

            if (row.input_cache_write !== undefined) {
              it(`row from ${row.from_date}: generic input_cache_write is exactly 1.25x input`, () => {
                expect(row.input_cache_write).toBeCloseTo(row.input * 1.25, 10);
              });
            }

            // TTL-specific cache-write prices remain Anthropic-only. OpenAI's
            // GPT-5.6 rows instead use the generic `input_cache_write` field.
            if (row.input_cache_write_5m !== undefined) {
              it(`row from ${row.from_date}: input_cache_write_5m is exactly 1.25x input (this table's own convention)`, () => {
                expect(row.input_cache_write_5m).toBeCloseTo(row.input * 1.25, 10);
              });
            }

            if (row.input_cache_write_1h !== undefined) {
              it(`row from ${row.from_date}: input_cache_write_1h is exactly 2x input (this table's own convention)`, () => {
                expect(row.input_cache_write_1h).toBeCloseTo(row.input * 2, 10);
              });
            }


            if (row.context_tiers !== undefined) {
              it(`row from ${row.from_date}: context tiers are ordered, unique, and carry complete positive rates`, () => {
                expect(row.context_tiers!.length).toBeGreaterThan(0);
                const thresholds = row.context_tiers!.map((tier) => tier.above_input_tokens);
                expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
                expect(new Set(thresholds).size).toBe(thresholds.length);
                for (const tier of row.context_tiers!) {
                  expect(Number.isSafeInteger(tier.above_input_tokens)).toBe(true);
                  expect(tier.above_input_tokens).toBeGreaterThanOrEqual(0);
                  expect(tier.input).toBeGreaterThan(0);
                  expect(tier.output).toBeGreaterThan(0);
                  if (tier.input_cached !== undefined) {
                    expect(tier.input_cached).toBeCloseTo(tier.input * 0.1, 10);
                  }
                  if (tier.input_cache_write !== undefined) {
                    expect(tier.input_cache_write).toBeCloseTo(tier.input * 1.25, 10);
                  }
                }
              });
            }
          }
        });
      }
    });
  }

  it("covers every model id used by the seeded fixtures (claude-opus-4-8, claude-sonnet-5, gpt-5.3-codex)", () => {
    const anthropic = tables.find(([f]) => f === "anthropic.json")![1];
    const openai = tables.find(([f]) => f === "openai.json")![1];
    expect(Object.keys(anthropic.models)).toContain("claude-opus-4-8");
    expect(Object.keys(anthropic.models)).toContain("claude-sonnet-5");
    expect(Object.keys(openai.models)).toContain("gpt-5.3-codex");
  });

  it("cites complete Standard context tiers for every GPT-5.6 variant, launch row and current row", () => {
    const openai = tables.find(([f]) => f === "openai.json")![1];
    // [launch row (2026-07-09), current row after the vendor's 2026-07-30 / 2026-08-21 cuts]
    const expected = {
      "gpt-5.6-sol": [
        { from: "2026-07-09", input: 5, cached: 0.5, output: 30, write: 6.25, longInput: 10, longCached: 1, longOutput: 45, longWrite: 12.5 },
        { from: "2026-08-21", input: 4, cached: 0.4, output: 20, write: 5, longInput: 8, longCached: 0.8, longOutput: 30, longWrite: 10 },
      ],
      "gpt-5.6-terra": [
        { from: "2026-07-09", input: 2.5, cached: 0.25, output: 15, write: 3.125, longInput: 5, longCached: 0.5, longOutput: 22.5, longWrite: 6.25 },
        { from: "2026-07-30", input: 2, cached: 0.2, output: 12, write: 2.5, longInput: 4, longCached: 0.4, longOutput: 18, longWrite: 5 },
      ],
      "gpt-5.6-luna": [
        { from: "2026-07-09", input: 1, cached: 0.1, output: 6, write: 1.25, longInput: 2, longCached: 0.2, longOutput: 9, longWrite: 2.5 },
        { from: "2026-07-30", input: 0.2, cached: 0.02, output: 1.2, write: 0.25, longInput: 0.4, longCached: 0.04, longOutput: 1.8, longWrite: 0.5 },
      ],
    } as const;

    for (const [model, rows] of Object.entries(expected)) {
      const history = openai.models[model]?.price_history;
      expect(history, model).toHaveLength(rows.length);
      rows.forEach((rates, i) => {
        const row = history![i];
        expect(row.from_date, `${model}[${i}]`).toBe(rates.from);
        if (i === rows.length - 1) {
          expect(row.to_date, `${model}[${i}]`).toBe(model === "gpt-5.6-sol" ? "2026-11-21" : null);
        } else {
          expect(typeof row.to_date, `${model}[${i}]`).toBe("string");
        }
        expect(row).toMatchObject({ input: rates.input, input_cached: rates.cached, output: rates.output });
        expect(row.input_cache_write).toBe(rates.write);
        expect(row.context_tiers).toEqual([
          {
            above_input_tokens: 272_000,
            input: rates.longInput,
            input_cached: rates.longCached,
            output: rates.longOutput,
            input_cache_write: rates.longWrite,
          },
        ]);
      });
    }
  });

  it("prices the GPT-6 family with the same per-request >272K context tier shape", () => {
    const openai = tables.find(([f]) => f === "openai.json")![1];
    for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      const row = openai.models[model]?.price_history.at(-1);
      expect(row, model).toBeDefined();
      expect(row!.to_date).toBeNull();
      expect(row!.context_tiers).toHaveLength(1);
      expect(row!.context_tiers![0].above_input_tokens).toBe(272_000);
      expect(row!.context_tiers![0].input).toBeCloseTo(row!.input * 2, 10);
      expect(row!.context_tiers![0].output).toBeCloseTo(row!.output * 1.5, 10);
    }
  });

  it("documents gpt-5.5 as omitted until full-session long-context scope is modeled", () => {
    const openai = tables.find(([f]) => f === "openai.json")![1];
    expect(openai.models["gpt-5.5"]).toBeUndefined();
    expect(openai.omitted).toContainEqual(expect.objectContaining({
      model: "gpt-5.5",
      source: "https://developers.openai.com/api/docs/models/gpt-5.5",
      reason: expect.stringContaining("full session"),
    }));
  });
});
