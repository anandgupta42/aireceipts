import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SOURCES } from "../../src/parse/types.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { createContext } from "../../src/cli/context.js";
import { agentTypeOf, sharedAgentType } from "../../src/cli/agentType.js";
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
  const keys = ["AIRECEIPTS_HOME", "HOME", "USERPROFILE", "LOCALAPPDATA"] as const;
  const realState = join(homedir(), ".aireceipts", "state.json");
  let tempHome: string;
  let savedEnv: Record<string, string | undefined>;
  let originalReceiptState: unknown;

  function receiptState(): unknown {
    if (!existsSync(realState)) return undefined;
    const state = JSON.parse(readFileSync(realState, "utf8")) as Record<string, unknown>;
    return { receiptCount: state.receiptCount, milestones: state.milestones };
  }

  beforeEach(() => {
    originalReceiptState = receiptState();
    savedEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    tempHome = mkdtempSync(join(tmpdir(), "aireceipts-agent-type-"));
    process.env.AIRECEIPTS_HOME = tempHome;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    process.env.LOCALAPPDATA = join(tempHome, "AppData", "Local");
    __resetQueueForTests();
  });

  afterEach(() => {
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(tempHome, { recursive: true, force: true });
    expect(receiptState()).toEqual(originalReceiptState);
    __resetQueueForTests();
  });

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

  it("resolves only a nonempty set with one source", () => {
    expect(sharedAgentType([])).toBeUndefined();
    expect(sharedAgentType([{ source: "codex" }, { source: "codex" }])).toBe("codex");
    expect(sharedAgentType([{ source: "codex" }, { source: "gemini" }])).toBeUndefined();
  });
});
