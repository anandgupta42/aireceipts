import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Session, Turn } from "../../src/parse/types.js";
import { cheapestCurrentRow, priceSessionTurn, resolvePrice } from "../../src/pricing/resolve.js";
import type { PricingLookup } from "../../src/pricing/resolve.js";
import type { PriceTable } from "../../src/pricing/types.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { validateReceiptBlocks } from "../../src/receipt/blocks.js";
import { attachSubagentRollup } from "../../src/receipt/subagents.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";

const dir = mkdtempSync(path.join(tmpdir(), "price-id-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const source = { url: "https://example.com/models", observed_at: "2026-02-01", excerpt: "same model and price" };
const row = { input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] };
function table(over: Partial<PriceTable> = {}): void {
  const value: PriceTable = { vendor: "openai", models: { "gpt-a": { price_history: [row], aliases: [{ id: "gpt-snapshot", from_date: "2026-02-01", to_date: null, sources: [source] }] } }, comparison_candidates: [{ model: "gpt-a", reason: "fixture", sources: [source] }], ...over };
  writeFileSync(path.join(dir, "openai.json"), JSON.stringify(value));
}
function session(ids: string[], date = "2026-03-01", overrides: Partial<Session> = {}): Session {
  const turns: Turn[] = ids.map((model, index) => ({ index, timestamp: Date.parse(`${date}T00:00:00Z`), model, toolCalls: [], usage: { input: 100, output: 0, cacheRead: 0, cacheCreation: 0, total: 100 } }));
  return { id: "fixture", source: "codex", filePath: "/nonexistent", totals: { tokens: { input: ids.length * 100, output: 0, cacheRead: 0, cacheCreation: 0, total: ids.length * 100 }, turnCount: turns.length, toolCallCount: 0 }, turns, ...overrides };
}

describe("SPEC-0095 price ids", () => {
  it("resolves cited aliases by window and exports their own sources", async () => {
    table();
    expect(await resolvePrice("openai", "gpt-snapshot", "2026-01-31", dir)).toBeNull();
    expect(await resolvePrice("openai", "gpt-a", "2026-03-01", dir)).not.toHaveProperty("matched_id");
    const resolved = await resolvePrice("openai", "gpt-snapshot", "2026-03-01", dir);
    expect(resolved).toMatchObject({ model: "gpt-a", matched_id: "gpt-snapshot", alias_sources: [source] });
    const model = await buildReceiptModel(session(["gpt-snapshot"]), dir);
    expect(model.modelMix[0].model).toBe("gpt-snapshot");
    expect(toJsonModel(model).priceRowsUsed[0]).toMatchObject({ model: "gpt-a", matched_id: "gpt-snapshot", alias_sources: [source] });
  });
  it("prices each side of a canonical rate change through one cited alias", async () => {
    const earlier = { ...row, to_date: "2026-02-28" };
    const later = { ...row, input: 3, from_date: "2026-03-01", sources: [{ ...source, observed_at: "2026-03-01" }] };
    table({ models: { "gpt-a": { price_history: [earlier, later], aliases: [{ id: "gpt-snapshot", from_date: "2026-02-01", to_date: null, sources: [source, ...later.sources] }] } } });
    expect((await resolvePrice("openai", "gpt-snapshot", "2026-02-20", dir))?.input).toBe(1);
    expect((await resolvePrice("openai", "gpt-snapshot", "2026-03-20", dir))?.input).toBe(3);
  });
  it("never normalizes an uncited variant", async () => {
    table();
    await fc.assert(fc.asyncProperty(fc.oneof(fc.constant("[1m]"), fc.stringMatching(/-[A-Za-z0-9]{1,12}/), fc.constant("-20991231")), async (suffix) => {
      expect(await resolvePrice("openai", `gpt-a${suffix}`, "2026-03-01", dir)).toBeNull();
      expect(await resolvePrice("openai", `GPT-A${suffix}`, "2026-03-01", dir)).toBeNull();
    }));
  });
  it("names absent, omitted, no-dated-row and no-vendor reasons exactly", async () => {
    table({ omitted: [{ model: "gpt-omitted", reason: "fixture" }] });
    const absent = await buildReceiptModel(session(["gpt-missing"]), dir);
    expect(absent.caveats.find((c) => c.kind === "unpriced-model")?.text).toBe("caveat: model gpt-missing not in bundled openai price table (latest citation 2026-02-01); tokens only");
    const omitted = await buildReceiptModel(session(["gpt-omitted"]), dir);
    expect(omitted.caveats.find((c) => c.kind === "unpriced-model")?.text).toBe("caveat: model gpt-omitted omitted from bundled openai price table; tokens only");
    const early = await buildReceiptModel(session(["gpt-snapshot"], "2026-01-15"), dir);
    expect(early.caveats.find((c) => c.kind === "unpriced-model")?.text).toBe("caveat: model gpt-snapshot has no bundled openai price for 2026-01-15; tokens only");
    const unknown = await buildReceiptModel(session(["us.anthropic.x:0"]), dir);
    expect(unknown.caveats.find((c) => c.kind === "unpriced-model")?.text).toBe("caveat: model us.anthropic.x:0 not in bundled price tables (latest citation 2026-02-01); tokens only");
  });
  it("uses row citations only and suppresses a no-vendor id known in another table", async () => {
    const newer = { ...source, observed_at: "2099-01-01" };
    table({ models: { "gpt-a": { price_history: [row], aliases: [{ id: "gpt-snapshot", from_date: "2026-02-01", to_date: null, sources: [newer] }] }, "mystery": { price_history: [row] } }, comparison_candidates: [{ model: "gpt-a", reason: "fixture", sources: [newer] }] });
    const absent = await buildReceiptModel(session(["gpt-unknown"]), dir);
    expect(absent.caveats.find((c) => c.kind === "unpriced-model")?.text).toContain("latest citation 2026-02-01");
    const known = await buildReceiptModel(session(["mystery"], "2026-03-01", { source: "opencode" }), dir);
    expect(known.caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
  });
  it("bounds hostile ids, caps text at three, and keeps every raw sanitized id in JSON", async () => {
    table();
    const ids = ["gpt-$100", `gpt-${"x".repeat(200)}`, "gpt-<text>", "gpt-d", "gpt-e"];
    const model = await buildReceiptModel(session(ids), dir);
    const caveats = model.caveats.filter((c) => c.kind === "unpriced-model");
    expect(caveats).toHaveLength(5);
    expect(caveats[0].text).toContain("gpt-?100");
    expect(caveats[1].text).toContain(`${"gpt-"}${"x".repeat(60)}…`);
    expect(caveats[1].detail).toBe(ids[1]);
    const { blocks } = buildReceiptView(model, "classic");
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
    expect(blocks.some((b) => "text" in b && b.text === "caveat: +2 more unpriced model ids")).toBe(true);
    expect(toJsonModel(model).caveats.filter((c) => c.kind === "unpriced-model")).toHaveLength(5);
    expect(renderReceiptSvg(model)).toContain("caveat: +2 more unpriced model ids");
  });
  it("places overflow immediately after the third unpriced line", async () => {
    table();
    const model = await buildReceiptModel(session(["gpt-a", "gpt-b", "gpt-c", "gpt-d", "gpt-e"]), dir);
    const notes = buildReceiptView(model, "classic").blocks.filter((block) => block.kind === "note").map((block) => block.text);
    const third = notes.findIndex((text) => text.startsWith("caveat: model gpt-d "));
    expect(notes[third + 1]).toBe("caveat: +1 more unpriced model ids");
    expect(notes.some((text) => text.startsWith("caveat: 4 of 5 usage turns"))).toBe(true);
  });
  it("sanitizes control characters in a hostile id and keeps a dollar-shaped unpriced label out of the receipt", async () => {
    table();
    const model = await buildReceiptModel(session(["gpt-a\n$evil"]), dir);
    expect(model.caveats.find((c) => c.kind === "unpriced-model")?.text).toContain("gpt-a?evil");
    expect(model.modelMix[0]?.model).toBe("gpt-a?evil");
    expect(model.modelMix[0]?.usd).toBeNull();
  });
  it("wraps a 64-character unpriced id inside the SVG card", async () => {
    table();
    const model = await buildReceiptModel(session([`gpt-${"x".repeat(60)}`]), dir);
    const svg = renderReceiptSvg(model);
    for (const match of svg.matchAll(/<text ([^>]+)>([^<]*)<\/text>/g)) {
      const attrs = match[1]!;
      const x = Number(attrs.match(/\bx="([^"]+)"/)?.[1]);
      const size = Number(attrs.match(/\bfont-size="([^"]+)"/)?.[1]);
      const anchor = attrs.match(/\btext-anchor="([^"]+)"/)?.[1];
      const length = match[2]!.replace(/&amp;|&lt;|&gt;/g, "x").length * size * 0.6;
      const end = x + (anchor === "end" ? 0 : anchor === "middle" ? length / 2 : length);
      expect(end, match[0]).toBeLessThanOrEqual(608);
    }
  });
  it("uses bundle-wide reasons for Bedrock regions and treats prototype keys as unknown", async () => {
    table();
    for (const id of ["eu.anthropic.x", "apac.anthropic.x", "global.anthropic.x"]) {
      const model = await buildReceiptModel(session([id]), dir);
      expect(model.caveats.find((c) => c.kind === "unpriced-model")?.text).toContain("not in bundled price tables");
    }
    for (const id of ["constructor", "toString"]) {
      const model = await buildReceiptModel(session([id]), dir);
      expect(model.caveats.find((c) => c.kind === "unpriced-model")?.text).toContain("not in bundled openai price table");
    }
  });
  it("keeps an absent-id line when another row source is undated", async () => {
    table({ models: { "gpt-a": { price_history: [{ ...row, sources: [source, { ...source, observed_at: undefined as unknown as string }] }] } } });
    expect((await buildReceiptModel(session(["gpt-missing"]), dir)).caveats.find((c) => c.kind === "unpriced-model")?.text).toContain("latest citation 2026-02-01");
  });
  it("returns the miss reason with a null session-turn price", async () => {
    table();
    const s = session(["gpt-missing"]);
    expect(await priceSessionTurn(s, s.turns[0]!, dir, () => {})).toMatchObject({ usd: null, reasons: [{ id: "gpt-missing", kind: "vendor-absent" }] });
  });
  it("does not load the bundle for 2000 Bedrock turns when no caller collects reasons", async () => {
    const s = session(Array(2000).fill("us.anthropic.unknown:0") as string[]);
    let bundleReads = 0;
    const lookup = { tables: new Map() } as PricingLookup;
    Object.defineProperty(lookup, "bundle", { get: () => { bundleReads++; return Promise.resolve([]); }, configurable: true });
    for (const turn of s.turns) {
      expect(await priceSessionTurn(s, turn, dir, undefined, lookup)).toBeNull();
    }
    expect(bundleReads).toBe(0);
  });
  it("does not call a non-finite cost a missing dated row", async () => {
    table({ models: { "gpt-a": { price_history: [{ ...row, input: 1e308, output: 1e308 }] } } });
    const s = session(["gpt-a"]);
    s.turns[0]!.usage = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0, total: 2_000_000 };
    const model = await buildReceiptModel(s, dir);
    expect(model.totalUsd).toBeNull();
    expect(model.caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
  });
  it("marks a Codex GPT-5.6 alias as missing cache-write counters", async () => {
    table({ models: { "gpt-5.6-sol": { price_history: [row], aliases: [{ id: "gpt-5.6", from_date: "2026-01-01", to_date: null, sources: [source] }] } } });
    const model = await buildReceiptModel(session(["gpt-5.6"]), dir);
    expect(model.unobservedCacheWriteTokens).toBe(true);
    expect(model.caveats.some((caveat) => caveat.kind === "unobserved-cache-write-tokens")).toBe(true);
  });
  it("suppresses router, unpriceable, missing timestamp and zero usage", async () => {
    table();
    const base = session(["gpt-missing"]);
    for (const s of [{ ...base, unpriceable: true }, { ...base, turns: [{ ...base.turns[0], pricingProvider: null }] }, { ...base, turns: [{ ...base.turns[0], timestamp: undefined }] }, { ...base, turns: [{ ...base.turns[0], usage: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0, total: 2 } }] }, { ...base, turns: [{ ...base.turns[0], usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 } }] }]) {
      expect((await buildReceiptModel(s, dir)).caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
    }
    writeFileSync(path.join(dir, "openai.json"), "{");
    expect((await buildReceiptModel(base, dir)).caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
  });
  it("suppresses a no-vendor reason when any bundled table is unreadable", async () => {
    const bundleDir = mkdtempSync(path.join(tmpdir(), "price-id-bundle-"));
    try {
      const valid: PriceTable = { vendor: "openai", models: { "gpt-a": { price_history: [row] } } };
      writeFileSync(path.join(bundleDir, "openai.json"), JSON.stringify(valid));
      const malformedPath = path.join(bundleDir, "anthropic.json");
      writeFileSync(malformedPath, "{");
      const unknown = session(["us.anthropic.x:0"]);
      expect((await buildReceiptModel(unknown, bundleDir)).caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
      rmSync(malformedPath);
      expect((await buildReceiptModel(unknown, bundleDir)).caveats.find((c) => c.kind === "unpriced-model")?.text)
        .toBe("caveat: model us.anthropic.x:0 not in bundled price tables (latest citation 2026-02-01); tokens only");
    } finally {
      rmSync(bundleDir, { recursive: true, force: true });
    }
  });
  it("filters candidates and disables comparisons when no current candidate exists", async () => {
    table({ models: { "gpt-a": { price_history: [row] }, "gpt-cheaper": { price_history: [{ ...row, input: 0.1 }] } } });
    expect((await cheapestCurrentRow("openai", dir))?.model).toBe("gpt-a");
    table({ comparison_candidates: [], models: { "gpt-a": { price_history: [row] } } });
    expect(await cheapestCurrentRow("openai", dir)).toBeNull();
    const model = await buildReceiptModel(session(["gpt-a"]), dir);
    expect(model.priceDelta).toBeNull();
    expect(model.wasteLines.some((line) => line.kind === "trivial-spans")).toBe(false);
  });
  it("omits both comparisons when a coverage row or the candidate is already cheapest", async () => {
    const cheaper = { ...row, input: 0.25, output: 0.5 };
    table({ models: { "gpt-a": { price_history: [row] }, "gpt-coverage": { price_history: [cheaper] } } });
    for (const id of ["gpt-coverage", "gpt-a"]) {
      const model = await buildReceiptModel(session([id]), dir);
      expect(model.totalUsd).not.toBeNull();
      expect(model.priceDelta).toBeNull();
      expect(model.wasteLines.some((line) => line.kind === "trivial-spans")).toBe(false);
      const json = toJsonModel(model);
      expect(json.priceDelta).toBeNull();
      expect(json.wasteLines.some((line) => line.kind === "trivial-spans")).toBe(false);
    }
  });
  it("merges child unpriced ids after parent ids and dedupes by raw id", async () => {
    table();
    const parent = await buildReceiptModel(session(["gpt-parent"]), dir);
    const child = session(["gpt-child", "gpt-parent"]);
    const merged = await attachSubagentRollup(parent, "/fake", { discover: async () => ["child"], load: async () => child });
    expect(merged.caveats.filter((c) => c.kind === "unpriced-model").map((c) => c.detail)).toEqual(["gpt-parent", "gpt-child"]);
  });
  it("dedupes one unknown id shared by two children", async () => {
    table();
    const parent = await buildReceiptModel(session(["gpt-parent"]), dir);
    const merged = await attachSubagentRollup(parent, "/fake", { discover: async () => ["a", "b"], load: async () => session(["gpt-shared"]) });
    expect(merged.caveats.filter((c) => c.kind === "unpriced-model").map((c) => c.detail)).toEqual(["gpt-parent", "gpt-shared"]);
  });
});
