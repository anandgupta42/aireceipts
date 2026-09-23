import { describe, expect, it } from "vitest";
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
});
