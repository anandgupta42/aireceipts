import { describe, expect, it } from "vitest";
import { AGENT_SOURCES } from "../../src/parse/types.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { createContext } from "../../src/cli/context.js";
import { agentTypeOf } from "../../src/cli/agentType.js";
import { parseOptions } from "../../src/cli/options.js";
import { receiptTelemetryFromModels } from "../../src/cli/common/telemetry.js";
import { __resetQueueForTests, peekQueuedEvents } from "../../src/telemetry/sender.js";
import { recordCliRun } from "../../src/telemetry/index.js";

function model(source: (typeof AGENT_SOURCES)[number]): ReceiptModel {
  return { source, wasteLines: [], toolRows: [], totalUsd: null, priceDelta: null,
    costShape: { preEdit: { totalTurnCount: 0 } } } as unknown as ReceiptModel;
}

function input(models: ReceiptModel[]) {
  return receiptTelemetryFromModels({ surface: "compare", models, outputMode: "text",
    template: "none", turnCount: 1, toolCallCount: 1, detailsView: false });
}

describe("SPEC-0094 R2a resolved agent seam", () => {
  it.each(AGENT_SOURCES)("matches receipt_generated for %s", async (source) => {
    __resetQueueForTests();
    const ctx = createContext(parseOptions([]), []);
    await ctx.telemetry.noteReceiptGenerated(input([model(source)]));
    recordCliRun({ command: "receipt", agentType: agentTypeOf(ctx), durationMs: 0,
      ok: true, installHash: "unavailable", installIdSource: "unavailable",
      runOrdinalBucket: "unavailable", isCI: false });
    const events = peekQueuedEvents();
    expect(events.find((event) => event.name === "cli_run")?.properties.agentType).toBe(source);
    expect(events.find((event) => event.name === "receipt_generated")?.properties.agentType).toBe(source);
  });

  it("keeps help and cross-agent compare unknown", async () => {
    __resetQueueForTests();
    const help = createContext(parseOptions(["--help"]), []);
    expect(agentTypeOf(help)).toBeUndefined();
    const compare = createContext(parseOptions(["compare", "a", "b"]), []);
    await compare.telemetry.noteReceiptGenerated(input([model("codex"), model("gemini")]));
    expect(agentTypeOf(compare)).toBeUndefined();
    expect(peekQueuedEvents().find((event) => event.name === "receipt_generated")?.properties.agentType).toBe("unknown");
  });
});
