import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cheapestCurrentRow, vendorForModel } from "../../src/pricing/resolve.js";
import type { PriceTable } from "../../src/pricing/types.js";

const dataDir = path.resolve("data/prices");
const tables: PriceTable[] = readdirSync(dataDir).filter((file) => file.endsWith(".json"))
  .sort().map((file) => JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as PriceTable);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function aliasErrors(input: PriceTable[]): string[] {
  const errors: string[] = [];
  const ids = new Map<string, string[]>();
  for (const table of input) {
    for (const model of Object.keys(table.models)) ids.set(model, [...(ids.get(model) ?? []), `${table.vendor}/${model} canonical`]);
    for (const omitted of table.omitted ?? []) ids.set(omitted.model, [...(ids.get(omitted.model) ?? []), `${table.vendor}/${omitted.model} omitted`]);
  }
  for (const table of input) for (const [model, entry] of Object.entries(table.models)) {
    const history = [...entry.price_history].sort((a, b) => a.from_date.localeCompare(b.from_date));
    for (const alias of entry.aliases ?? []) {
      const at = `${table.vendor}/${model} alias ${alias.id}`;
      const previous = ids.get(alias.id) ?? [];
      if (previous.length) errors.push(`${at} duplicates ${previous.join(", ")}`);
      ids.set(alias.id, [...previous, at]);
      if (vendorForModel(alias.id) !== table.vendor) errors.push(`${at} routes outside ${table.vendor}`);
      if (/[/:@\[\]]/.test(alias.id)) errors.push(`${at} has forbidden character`);
      if (!validDate(alias.from_date) || (alias.to_date !== null && !validDate(alias.to_date)) ||
        (alias.to_date !== null && alias.to_date < alias.from_date)) errors.push(`${at} invalid window`);
      if (alias.from_date < history[0].from_date ||
        (history.at(-1)?.to_date !== null && (alias.to_date === null || alias.to_date > history.at(-1)!.to_date!))) errors.push(`${at} outside history`);
      for (const row of history) {
        if (alias.from_date > (row.to_date ?? "9999-12-31") || (alias.to_date ?? "9999-12-31") < row.from_date) continue;
        const earliestRowCitation = row.sources.map((source) => source.observed_at).sort()[0];
        if (!alias.sources.some((source) => source.observed_at >= earliestRowCitation))
          errors.push(`${at} has no evidence for period ${row.from_date}`);
      }
    }
  }
  return errors;
}

describe("SPEC-0095 R2 alias integrity", () => {
  it("validates every live vendor table", () => expect(aliasErrors(tables)).toEqual([]));
  it("names both entries for each isolated collision", () => {
    const source = { url: "https://example.com", observed_at: "2026-01-01", excerpt: "same price" };
    const row = { input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] };
    const alias = (id: string) => ({ id, from_date: "2026-01-01", to_date: null, sources: [source] });
    const fixture = (vendor: string, model: string, ids: string[] = []): PriceTable =>
      ({ vendor, models: { [model]: { price_history: [row], ...(ids.length ? { aliases: ids.map(alias) } : {}) } } });
    expect(aliasErrors([fixture("anthropic", "claude-a", ["claude-b"]), fixture("anthropic", "claude-b")])).toContain("anthropic/claude-a alias claude-b duplicates anthropic/claude-b canonical");
    expect(aliasErrors([fixture("anthropic", "claude-a", ["gpt-a"]), fixture("openai", "gpt-a")])).toContain("anthropic/claude-a alias gpt-a duplicates openai/gpt-a canonical");
    expect(aliasErrors([fixture("anthropic", "claude-a", ["claude-s"]), fixture("anthropic", "claude-b", ["claude-s"])] )).toContain("anthropic/claude-b alias claude-s duplicates anthropic/claude-a alias claude-s");
    expect(aliasErrors([fixture("anthropic", "claude-a", ["gpt-s"]), fixture("openai", "gpt-b", ["gpt-s"])] )).toContain("openai/gpt-b alias gpt-s duplicates anthropic/claude-a alias gpt-s");
    const omitted = fixture("anthropic", "claude-a", ["claude-o"]);
    omitted.omitted = [{ model: "claude-o", reason: "fixture" }];
    expect(aliasErrors([omitted])).toContain("anthropic/claude-a alias claude-o duplicates anthropic/claude-o omitted");
    expect(aliasErrors([fixture("anthropic", "claude-a", ["gpt-x"])] )).toContain("anthropic/claude-a alias gpt-x routes outside anthropic");
    expect(aliasErrors([fixture("anthropic", "claude-a", ["claude-a"])] )).toContain("anthropic/claude-a alias claude-a duplicates anthropic/claude-a canonical");
  });
  it("names an unreachable alias and its canonical entry", () => {
    const source = { url: "https://example.com", observed_at: "2026-01-01", excerpt: "same price" };
    const row = { input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] };
    const table: PriceTable = { vendor: "anthropic", models: { "claude-a": { price_history: [row], aliases: [{ id: "gpt-b", from_date: "2026-01-01", to_date: null, sources: [source] }] } } };
    expect(aliasErrors([table])).toEqual(["anthropic/claude-a alias gpt-b routes outside anthropic"]);
  });
  it("names an alias with a forbidden character", () => {
    const source = { url: "https://example.com", observed_at: "2026-01-01", excerpt: "same price" };
    const row = { input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] };
    const table: PriceTable = { vendor: "openai", models: { "gpt-a": { price_history: [row], aliases: [{ id: "gpt-b:0", from_date: "2026-01-01", to_date: null, sources: [source] }] } } };
    expect(aliasErrors([table])).toEqual(["openai/gpt-a alias gpt-b:0 has forbidden character"]);
  });
  it("checks windows against sorted history and names the alias", () => {
    const source = { url: "https://example.com", observed_at: "2026-01-01", excerpt: "same price" };
    const early = { input: 1, output: 2, from_date: "2026-01-01", to_date: "2026-02-28", sources: [source] };
    const late = { ...early, from_date: "2026-03-01", to_date: null };
    const table: PriceTable = { vendor: "openai", models: { "gpt-a": { price_history: [late, early], aliases: [{ id: "gpt-b", from_date: "2025-12-01", to_date: null, sources: [source] }] } } };
    expect(aliasErrors([table])).toEqual(["openai/gpt-a alias gpt-b outside history"]);
  });
  it("rejects an invalid window and alias evidence missing after a price change", () => {
    const source = (date: string) => ({ url: "https://example.com", observed_at: date, excerpt: "same price" });
    const table: PriceTable = { vendor: "openai", models: { "gpt-a": {
      price_history: [
        { input: 1, output: 2, from_date: "2026-01-01", to_date: "2026-02-28", sources: [source("2026-01-01")] },
        { input: 2, output: 4, from_date: "2026-03-01", to_date: null, sources: [source("2026-03-01")] },
      ],
      aliases: [{ id: "gpt-snapshot", from_date: "2026-01-01", to_date: null, sources: [source("2026-01-01")] }],
    } } };
    expect(aliasErrors([table])).toEqual(["openai/gpt-a alias gpt-snapshot has no evidence for period 2026-03-01"]);
    table.models["gpt-a"].aliases![0].sources.push(source("2026-03-01"));
    expect(aliasErrors([table])).toEqual([]);
    table.models["gpt-a"].aliases![0].to_date = "2025-12-31";
    expect(aliasErrors([table]).join(" ")).toContain("invalid window");
    table.models["gpt-a"].aliases![0].to_date = null;
    table.models["gpt-a"].aliases![0].from_date = "2025-12-01";
    expect(aliasErrors([table]).join(" ")).toContain("outside history");
    table.models["gpt-a"].aliases![0].from_date = "2026-01-01";
    table.models["gpt-a"].aliases![0].id = "gpt-a:0";
    expect(aliasErrors([table]).join(" ")).toContain("forbidden character");
  });
  it("accepts a scheduled row cited in advance and rejects older alias evidence", () => {
    const source = (date: string) => ({ url: "https://example.com", observed_at: date, excerpt: "same price" });
    const alias = { id: "gpt-snapshot", from_date: "2026-01-01", to_date: null, sources: [source("2026-09-22")] };
    const table: PriceTable = { vendor: "openai", models: { "gpt-a": {
      price_history: [
        { input: 1, output: 2, from_date: "2026-01-01", to_date: "2026-12-31", sources: [source("2026-01-01")] },
        { input: 2, output: 4, from_date: "2027-01-01", to_date: null, sources: [source("2026-09-22")] },
      ], aliases: [alias],
    } } };
    expect(aliasErrors([table])).toEqual([]);
    alias.sources = [source("2026-09-21")];
    expect(aliasErrors([table]).join(" ")).toContain("no evidence for period 2027-01-01");
  });
  it("preserves each vendor's pre-SPEC-0095 cheapest row", async () => {
    for (const table of tables) {
      let expected: { model: string; input: number } | null = null;
      for (const [model, entry] of Object.entries(table.models)) {
        const row = entry.price_history.find((price) => price.to_date === null);
        if (row && (!expected || row.input < expected.input)) expected = { model, input: row.input };
      }
      expect((await cheapestCurrentRow(table.vendor, dataDir))?.model ?? null).toBe(expected?.model ?? null);
    }
  });
});
