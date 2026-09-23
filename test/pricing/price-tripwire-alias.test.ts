import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
// @ts-expect-error the advisory script is plain ESM
import { compareRows, discoveryFeed } from "../../scripts/price-tripwire.mjs";

const today = "2026-09-22";
const table = {
  vendor: "openai",
  models: { "gpt-a": { price_history: [{ input: 1, output: 2, from_date: "2026-01-01", to_date: null, sources: [{}] }], aliases: [{ id: "gpt-snapshot", from_date: "2026-01-01", to_date: null }] } },
};
const dataset = {
  "gpt-a": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
  "gpt-snapshot": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 0.000003, output_cost_per_token: 0.000002 },
};

describe("SPEC-0095 R5 tripwire aliases", () => {
  it("hides cited aliases from discovery", () => {
    expect(discoveryFeed([table], dataset, today)).toEqual([]);
  });
  it("reports alias rate drift against the canonical current row", () => {
    const { drift } = compareRows([table], dataset, today);
    expect(drift).toEqual([expect.objectContaining({ label: "openai/gpt-a via alias gpt-snapshot", field: "input", ours: 1, community: 3 })]);
  });
  it("exits 3 for alias drift", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "price-tripwire-alias-"));
    try {
      mkdirSync(path.join(dir, "data/prices"), { recursive: true });
      writeFileSync(path.join(dir, "data/prices/openai.json"), JSON.stringify(table));
      const dataUrl = `data:application/json,${encodeURIComponent(JSON.stringify(dataset))}`;
      const result = spawnSync(process.execPath, [path.resolve("scripts/price-tripwire.mjs")], {
        cwd: dir, env: { ...process.env, PRICE_TRIPWIRE_DATASET_URL: dataUrl }, encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(3);
      expect(result.stdout).toContain("openai/gpt-a via alias gpt-snapshot");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
