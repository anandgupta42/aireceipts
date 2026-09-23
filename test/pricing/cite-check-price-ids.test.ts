import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "price-citations-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, "fixture.json");
const script = path.resolve("scripts/cite-check.ts");
const source = { url: "https://example.com", observed_at: "2026-02-01", excerpt: "same model at same price" };
function check(over: Record<string, unknown> = {}) {
  const table = { vendor: "openai", models: { "gpt-a": { price_history: [{ input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] }], aliases: [{ id: "gpt-snapshot", from_date: "2026-01-01", to_date: null, sources: [source] }] } }, comparison_candidates: [{ model: "gpt-a", reason: "fixture", sources: [source] }], ...over };
  writeFileSync(file, JSON.stringify(table));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script, "--no-network", file], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}
describe("SPEC-0095 R5 cite-check shapes", () => {
  it("accepts cited aliases and candidates", () => expect(check().status).toBe(0));
  it("rejects missing alias citation, candidate model and bad dates", () => {
    const missing = check({ models: { "gpt-a": { price_history: [{ input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] }], aliases: [{ id: "gpt-snapshot", from_date: "2026-02-30", to_date: null, sources: [{ url: "https://example.com", excerpt: "x" }] }] } }, comparison_candidates: [{ model: "gpt-nope", reason: "", sources: [] }] });
    expect(missing.status).toBe(1);
    for (const item of ["aliases[0]", "invalid date window", "observed_at", "comparison_candidates[0]"]) expect(missing.output).toContain(item);
  });
  it("rejects a reversed alias window", () => {
    const alias = { id: "gpt-snapshot", from_date: "2026-03-01", to_date: "2026-02-01", sources: [source] };
    const result = check({ models: { "gpt-a": { price_history: [{ input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] }], aliases: [alias] } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain("invalid date window");
  });
  it("adds alias and candidate URLs to the liveness set", () => {
    const aliasSource = { ...source, url: "https://example.com/alias" };
    const candidateSource = { ...source, url: "https://example.com/candidate" };
    const result = check({ models: { "gpt-a": { price_history: [{ input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [source] }], aliases: [{ id: "gpt-snapshot", from_date: "2026-01-01", to_date: null, sources: [aliasSource] }] } }, comparison_candidates: [{ model: "gpt-a", reason: "fixture", sources: [candidateSource] }] });
    expect(result.status).toBe(0);
    expect(result.output).toContain("skipping URL liveness for 3 cited url(s)");
  });
});
