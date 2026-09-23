import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Session, Turn } from "../../src/parse/types.js";
import { cheapestCurrentRow, resolvePrice } from "../../src/pricing/resolve.js";
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
    await fc.assert(fc.asyncProperty(fc.constantFrom("[1m]", "-20991231", "-x", "-X"), async (suffix) => {
      expect(await resolvePrice("openai", `gpt-a${suffix}`, "2026-03-01", dir)).toBeNull();
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
  it("suppresses router, unpriceable, missing timestamp and zero usage", async () => {
    table();
    const base = session(["gpt-missing"]);
    for (const s of [{ ...base, unpriceable: true }, { ...base, turns: [{ ...base.turns[0], pricingProvider: null }] }, { ...base, turns: [{ ...base.turns[0], timestamp: undefined }] }, { ...base, turns: [{ ...base.turns[0], usage: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0, total: 2 } }] }, { ...base, turns: [{ ...base.turns[0], usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 } }] }]) {
      expect((await buildReceiptModel(s, dir)).caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
    }
    writeFileSync(path.join(dir, "openai.json"), "{");
    expect((await buildReceiptModel(base, dir)).caveats.some((c) => c.kind === "unpriced-model")).toBe(false);
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
});
