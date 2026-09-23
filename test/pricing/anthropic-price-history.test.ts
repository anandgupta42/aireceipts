import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { priceTurn, resolvePrice } from "../../src/pricing/resolve.js";

const dataDir = fileURLToPath(new URL("../../data/prices", import.meta.url));

describe("Sonnet 5 cancelled September 2026 price increase", () => {
  it.each(["2026-08-09", "2026-08-10", "2026-08-31", "2026-09-01", "2026-09-22"])(
    "preserves the unchanged input, output and cache rates on %s", async (date) => {
      expect(await resolvePrice("anthropic", "claude-sonnet-5", date, dataDir)).toMatchObject({
        input: 2, output: 10, input_cached: 0.2,
        input_cache_write_5m: 2.5, input_cache_write_1h: 4,
      });
      const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000,
        cacheCreation: 2_000_000, cacheCreation5m: 1_000_000, cacheCreation1h: 1_000_000, total: 5_000_000 };
      expect((await priceTurn("anthropic", "claude-sonnet-5", date, usage, dataDir))?.usd).toBeCloseTo(18.7, 12);
    },
  );

  it("does not borrow Sonnet 5 prices for a different vendor or unknown model", async () => {
    expect(await resolvePrice("openai", "claude-sonnet-5", "2026-09-22", dataDir)).toBeNull();
    expect(await resolvePrice("anthropic", "claude-sonnet-5-unknown", "2026-09-22", dataDir)).toBeNull();
  });
});

it("uses Sonnet 4.6's cited standard rate throughout its 1M context window", async () => {
  const usage = { input: 250_000, output: 10_000, cacheRead: 0, cacheCreation: 0, total: 260_000 };
  expect((await priceTurn("anthropic", "claude-sonnet-4-6", "2026-09-22", usage, dataDir))?.usd).toBeCloseTo(0.9, 12);
});

it.each([
  "claude-fable-5-1", "claude-mythos-5-1", "claude-mythos-5", "claude-opus-5-5",
  "claude-opus-5", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929",
])("does not backfill today's observed rate for %s to its launch date", async (model) => {
  expect(await resolvePrice("anthropic", model, "2026-09-21", dataDir)).toBeNull();
  expect(await resolvePrice("anthropic", model, "2026-09-22", dataDir)).not.toBeNull();
});
