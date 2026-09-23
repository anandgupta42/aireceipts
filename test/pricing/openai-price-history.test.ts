import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { priceTurn, resolvePrice } from "../../src/pricing/resolve.js";

const dataDir = fileURLToPath(new URL("../../data/prices", import.meta.url));

describe("GPT-5.6 Sol dated promotional pricing", () => {
  it.each([
    ["2026-08-20", 5, 30, 0.5, 6.25],
    ["2026-08-21", 4, 20, 0.4, 5],
    ["2026-09-22", 4, 20, 0.4, 5],
    ["2026-11-21", 4, 20, 0.4, 5],
  ])("resolves the cited rate on %s", async (date, input, output, cached, write) => {
    expect(await resolvePrice("openai", "gpt-5.6-sol", date as string, dataDir)).toMatchObject({
      input, output, input_cached: cached, input_cache_write: write,
    });
  });

  it("does not invent a rate beyond explicitly guaranteed coverage", async () => {
    expect(await resolvePrice("openai", "gpt-5.6-sol", "2026-11-22", dataDir)).toBeNull();
  });

  it("applies the new full-request tier only above 272K input, including writes", async () => {
    const usage = { input: 100_000, output: 1_000_000, cacheRead: 100_000,
      cacheCreation: 72_000, total: 1_272_000 };
    expect((await priceTurn("openai", "gpt-5.6-sol", "2026-08-21", usage, dataDir))?.usd)
      .toBeCloseTo(20.8, 12);
    expect((await priceTurn("openai", "gpt-5.6-sol", "2026-08-21",
      { ...usage, cacheCreation: 72_001, total: 1_272_001 }, dataDir))?.usd)
      .toBeCloseTo(31.60001, 12);
    expect((await priceTurn("openai", "gpt-5.6-sol", "2026-08-20", usage, dataDir))?.usd)
      .toBeCloseTo(31, 12);
  });
});
