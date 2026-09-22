import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { adapters } from "../../src/parse/registry.js";
import { ClaudeCodeAdapter } from "../../src/parse/claudeCode.js";
import fc from "fast-check";
import { netCacheAtRow, computeNetCache } from "../../src/pricing/netCache.js";
import { defaultDataDir } from "../../src/pricing/priceTable.js";
import type { PriceRow } from "../../src/pricing/types.js";
import { withTotal } from "../../src/parse/util.js";
import type { Session, TokenUsage } from "../../src/parse/types.js";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { validateReceiptBlocks } from "../../src/receipt/blocks.js";
import { netCacheBlocks } from "../../src/receipt/netCache.js";

const row: PriceRow = { from_date: "2026-01-01", to_date: null, input: 5, output: 25,
  input_cached: 0.5, input_cache_write_5m: 6.25, input_cache_write_1h: 10, sources: [{ url: "https://example.com" }] };
function usage(read = 100000, write5m = 1000, write1h = 1000): TokenUsage {
  return withTotal({ input: 100, output: 100, cacheRead: read, cacheCreation: write5m + write1h,
    cacheCreation5m: write5m, cacheCreation1h: write1h, total: 0, cacheEvidenceComplete: true });
}
function session(u = usage()): Session {
  return { id: "test", filePath: "test", source: "claude-code", turns: [{ index: 0,
    timestamp: Date.parse("2026-06-15"), model: "claude-opus-4-8", usage: u, toolCalls: [] }],
  totals: { tokens: u, turnCount: 1, toolCallCount: 0 } };
}
function rawUsage() { return { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 100000,
  cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } }; }
async function parsed(raws: unknown[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "aireceipts-cache-"));
  try {
    const file = path.join(dir, "session.jsonl");
    await writeFile(file, raws.map((u) => JSON.stringify({ type: "assistant", timestamp: "2026-06-15T00:00:00Z",
      message: { id: "request-1", model: "claude-opus-4-8", content: [], usage: u } })).join("\n"));
    return (await loadById("claude-code", file))!;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("complete observed cache price arithmetic", () => {
  it("subtracts both write premiums and retains negative and zero", () => {
    expect(netCacheAtRow(usage(), row)).toBeCloseTo(0.44375, 10);
    expect(netCacheAtRow(usage(0), row)).toBe(-0.00625);
    expect(netCacheAtRow(usage(0, 0, 0), row)).toBe(0);
  });
  it("matches an independent integer-rate oracle", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 1000000 }), (r, a, b) => {
      expect(netCacheAtRow(usage(r, a, b), row)).toBeCloseTo((18 * r - 5 * a - 20 * b) / 4000000, 10);
    }));
  });
  it.each(["cacheEvidenceComplete", "cacheCreation5m", "cacheCreation1h"] as const)("abstains without %s", (key) => {
    const u = usage(); delete u[key]; expect(netCacheAtRow(u, row)).toBeNull();
  });
  it("rejects contradictory/invalid counters", () => {
    expect(netCacheAtRow({ ...usage(), cacheCreation1h: 10 }, row)).toBeNull();
    expect(netCacheAtRow({ ...usage(), total: -1 }, row)).toBeNull();
  });
  it.each(["input_cached", "input_cache_write_5m", "input_cache_write_1h"] as const)("rejects absent nonzero-bucket rate %s", (key) => {
    const r = { ...row }; delete r[key]; expect(netCacheAtRow(usage(), r)).toBeNull();
  });
  it("allows missing zero-bucket rates and cited generic write rates", () => {
    expect(netCacheAtRow(usage(0, 0, 0), { ...row, input_cached: undefined, input_cache_write_5m: undefined, input_cache_write_1h: undefined })).toBe(0);
    expect(netCacheAtRow(usage(), { ...row, input_cache_write_5m: undefined, input_cache_write_1h: undefined, input_cache_write: 7 })).toBe(0.446);
  });
  it("uses prompt-side context tiers strictly above the boundary", () => {
    const tier = { ...row, input: 10, input_cached: 1, input_cache_write_5m: 12.5, input_cache_write_1h: 20, above_input_tokens: 102100 };
    const r = { ...row, context_tiers: [tier] };
    expect(netCacheAtRow(usage(), r)).toBeCloseTo(0.44375, 10);
    expect(netCacheAtRow(usage(100001), r)).toBeCloseTo(0.887509, 10);
  });
  it("refuses nonfinite arithmetic", () => {
    expect(netCacheAtRow(usage(), { ...row, input: Infinity })).toBeNull();
  });
  it("prices a complete session; excludes zero-activity sessions", async () => {
    expect((await computeNetCache(session(), defaultDataDir())).usd).toBeCloseTo(0.44375, 10);
    expect((await computeNetCache(session(usage(0)), defaultDataDir())).usd).toBe(-0.00625);
    expect((await computeNetCache(session(usage(0, 0, 0)), defaultDataDir())).unavailableReason).toBe("no-cache-activity");
  });
  it.each(["codex", "cursor", "gemini"] as const)("never infers missing write counters for %s", async source => {
    expect((await computeNetCache({ ...session(), source }, defaultDataDir())).unavailableReason).toBe(source === "codex" ? "write-counters-unobserved" : "unsupported-adapter");
  });
  it("withholds the entire session net when a nonzero bucket has no rate", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aireceipts-cache-rates-"));
    try {
      const missing = { ...row, input_cache_write_1h: undefined };
      await writeFile(path.join(dir, "anthropic.json"), JSON.stringify({ vendor: "anthropic", models: { "claude-opus-4-8": { price_history: [missing] } } }));
      expect((await computeNetCache(session(), dir)).unavailableReason).toBe("price-row-incomplete");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("requires every request to be complete", async () => {
    const s = session(); s.turns.push({ ...s.turns[0], index: 1, usage: { ...usage(), cacheEvidenceComplete: undefined } });
    expect((await computeNetCache(s, defaultDataDir())).unavailableReason).toBe("incomplete-cache-evidence");
  });
  it("rejects missing identity, routed providers, and unmatched dates", async () => {
    for (const change of [{ model: undefined }, { timestamp: undefined }, { pricingProvider: null }, { model: "unknown" }, { timestamp: Date.parse("2000-01-01") }]) {
      const s = session(); Object.assign(s.turns[0], change);
      expect((await computeNetCache(s, defaultDataDir())).unavailableReason).toBe("unpriced-usage");
    }
  });
  it("abstains on malformed or excluded session evidence", async () => {
    for (const change of [{ unpriceable: true }, { droppedRecords: 1 }, { usageReconciliationFailed: true }, { unattributedUsage: usage() }, { excludedUnattributedUsage: usage() }, { conflictingAggregateUsage: usage() }]) {
      expect((await computeNetCache({ ...session(), ...change }, defaultDataDir())).unavailableReason).toBe("unpriced-usage");
    }
  });
  it("does not treat a model-bearing request with missing usage as zero", async () => {
    const s = session(); s.turns.push({ index: 1, model: "claude-opus-4-8", toolCalls: [] });
    expect((await computeNetCache(s, defaultDataDir())).usd).toBeNull();
  });
  it("ignores tool-only nonrequest turns but rejects broken request envelopes", async () => {
    const s = session(); s.turns.push({ index: 1, toolCalls: [] });
    expect((await computeNetCache(s, defaultDataDir())).usd).not.toBeNull();
    s.turns[0]!.pricingUnits = [];
    expect((await computeNetCache(s, defaultDataDir())).unavailableReason).toBe("unpriced-usage");
  });
  it("keeps completeness on the selected whole streaming snapshot", async () => {
    const complete = rawUsage(); const incomplete = { ...complete, output_tokens: 200, cache_creation: undefined };
    expect((await parsed([complete])).turns[0]!.usage!.cacheEvidenceComplete).toBe(true);
    expect((await parsed([complete, incomplete])).turns[0]!.usage!.cacheEvidenceComplete).toBeUndefined();
    expect((await parsed([incomplete, { ...complete, output_tokens: 300 }])).turns[0]!.usage!.cacheEvidenceComplete).toBe(true);
  });
  it.each(["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"])("requires explicit %s even when normalized to zero", async key => {
    const raw = rawUsage() as Record<string, unknown>; delete raw[key];
    expect((await parsed([raw])).turns[0]!.usage!.cacheEvidenceComplete).toBeUndefined();
  });
  it("runs the actual CLI dispatch with real fixture discovery and details output", async () => {
    const registry = adapters(); const original = [...registry];
    const fixture = path.resolve("test/fixtures/claude-code/cache-economics-complete.jsonl");
    registry.splice(0, registry.length, new ClaudeCodeAdapter({ root: path.dirname(fixture) }));
    vi.stubEnv("AIRECEIPTS_TELEMETRY", "off");
    const writes: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await main([fixture, "--details"])).toBe(0);
      expect(writes.join("")).toContain("$0.44 lower");
      expect(writes.join("")).toContain("(read discount minus write premium)");
    } finally { registry.splice(0, registry.length, ...original); out.mockRestore(); err.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("renders only details, exports reasons, and preserves signed semantics", async () => {
    const model = await buildReceiptModel(await parsed([rawUsage()]));
    expect(renderReceipt(model, { color: false })).not.toContain("cache vs uncached");
    expect(renderReceipt(model, { color: false, details: true })).toContain("$0.44 lower");
    expect(receiptJsonSchema.safeParse(toJsonModel(model)).success).toBe(true);
    expect(toJsonModel(model).netCache?.interpretation).toBe("hypothetical no-cache price minus observed cache price, same tokens; arithmetic, not a prediction");
    const blocks = buildReceiptView(model, "classic", { details: true }).blocks;
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
    const index = blocks.findIndex(b => b.kind === "row" && b.label === "cache vs uncached");
    const invented = structuredClone(blocks); Object.assign(invented[index]!, { value: "$9.99 lower" });
    expect(validateReceiptBlocks(invented, model).some(x => x.code === "untraced-dollar")).toBe(true);
    const missingNote = blocks.filter((_, i) => i !== index + 1);
    expect(validateReceiptBlocks(missingNote, model).some(x => x.code === "unqualified-dollar")).toBe(true);
    const relabeled = structuredClone(blocks); Object.assign(relabeled[index]!, { label: "saved" });
    expect(validateReceiptBlocks(relabeled, model).some(x => x.code === "unqualified-dollar")).toBe(true);
    expect(netCacheBlocks({ ...model.netCache!, usd: -0.425 })[0]).toMatchObject({ value: "$0.43 higher" });
    expect(netCacheBlocks({ ...model.netCache!, usd: 0.004 })[0]).toMatchObject({ value: "$0.00" });
    expect(netCacheBlocks({ ...model.netCache!, usd: null })).toEqual([]);
    expect(netCacheBlocks(undefined)).toEqual([]);
  });
});
