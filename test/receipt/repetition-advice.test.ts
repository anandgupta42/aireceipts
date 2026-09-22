import { describe, expect, it } from "vitest";
import type { Session, ToolCall } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { detectStuckLoops } from "../../src/pricing/waste.js";
import { renderHandoff, standingRuleSuggestions } from "../../src/receipt/handoff.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { toHandoffJson } from "../../src/receipt/json.js";

function session(calls: ToolCall[]): Session {
  return {
    id: "repetition-advice",
    filePath: "repetition-advice",
    source: "claude-code",
    totals: { tokens: emptyUsage(), turnCount: calls.length, toolCallCount: calls.length },
    turns: calls.map((call, index) => ({ index, toolCalls: [call] })),
  };
}

describe("neutral repetition advice (SPEC-0089)", () => {
  it.each([
    ["successful rereads", "Read", ["ok", "ok", "ok"]],
    ["deliberate negative tests", "Bash", ["error", "error", "error"]],
    ["successful polls", "sleep", ["ok", "ok", "ok"]],
    ["pending polls", "wait", ["running", "running", "running"]],
    ["unobserved results", "exec", [undefined, undefined, undefined]],
    ["mixed results", "poll", ["error", "ok", undefined]],
  ] as const)("does not interpret %s as repeated failures", async (_, name, statuses) => {
    const calls: ToolCall[] = statuses.map((status) => ({ name, status, input: { argument: "same" } }));
    const model = await buildReceiptModel(session(calls));
    expect(model.wasteLines).toHaveLength(1);
    expect(model.wasteLines[0]).toMatchObject({ kind: "stuck-loop", runLength: 3, turnIndices: [0, 1, 2], usd: null });
    const handoff = renderHandoff(model);
    expect(handoff).toContain("check whether repeated calls were needed");
    expect(handoff).not.toMatch(/fail|stop|avoidab|saved/i);
    expect(handoff).toContain("not proven savings");
  });

  it("does not merge attempts across an intervening edit or changed input", async () => {
    const repeated: ToolCall = { name: "Bash", input: { command: "check" }, status: "error" };
    expect(await detectStuckLoops(session([repeated, repeated, { name: "Edit", input: { file_path: "a.ts" } }, repeated])))
      .toEqual([]);
    expect(await detectStuckLoops(session([repeated, repeated, { ...repeated, input: { command: "check --verbose" } }])))
      .toEqual([]);
  });

  it("preserves priced amounts and complete handoff JSON when only recorded statuses vary", async () => {
    const variants: Array<Array<ToolCall["status"]>> = [
      ["ok", "ok", "ok"], ["error", "error", "error"], ["running", "running", "running"],
      [undefined, undefined, undefined], ["error", "ok", undefined],
    ];
    const exports = [];
    for (const statuses of variants) {
      const input = session(statuses.map((status) => ({ name: "Bash", status, input: { command: "check" } })));
      for (const turn of input.turns) {
        turn.model = "claude-opus-4-8";
        turn.timestamp = Date.parse("2026-06-15T00:00:00Z");
        turn.usage = withTotal({ input: 1000, output: 100, cacheRead: 0, cacheCreation: 0, total: 0 });
      }
      input.totals.tokens = withTotal({ input: 3000, output: 300, cacheRead: 0, cacheCreation: 0, total: 0 });
      const model = await buildReceiptModel(input);
      // Dated opus row: 3 × (1,000 × $5/M + 100 × $25/M) = $0.0225.
      expect(model.wasteLines[0].usd).toBeCloseTo(0.0225, 12);
      exports.push(toHandoffJson(model, [], 3, { turns: 3, toolCalls: 3, compactions: 0 }, []));
    }
    for (const output of exports.slice(1)) expect(output).toEqual(exports[0]);
  });

  it("allows another call when an earlier result is insufficient or no longer current", () => {
    const [rule] = standingRuleSuggestions([{ class: "stuck-loop", cost: 0, tokens: emptyUsage(), distinctSessionCount: 3 }]);
    expect(rule).toContain("check whether the earlier result already answers it");
    expect(rule).toContain("If it does and is still current, reuse it");
    expect(rule).not.toMatch(/fail|stop|twice/i);
  });
});
