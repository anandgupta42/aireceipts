import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../src/parse/types.js";
import type { CommandContext } from "../../src/cli/types.js";
import { agentTypeOf } from "../../src/cli/agentType.js";
import { command } from "../../src/cli/commands/setup.js";
import { buildSetupReport } from "../../src/setup/report.js";
import { recordCliRun } from "../../src/telemetry/index.js";
import { __resetQueueForTests, peekQueuedEvents } from "../../src/telemetry/sender.js";

vi.mock("../../src/setup/report.js", () => ({
  buildSetupReport: vi.fn(),
  setupReportToJson: vi.fn(() => ({})),
}));
vi.mock("../../src/parse/load.js", () => ({ loadSession: vi.fn(async (summary) => summary) }));
vi.mock("../../src/cli/loadedSession.js", () => ({
  loadObservedSession: vi.fn((_ctx, load) => load()),
  observedChildRollupDeps: vi.fn(() => ({ load: vi.fn() })),
}));
vi.mock("../../src/setup/render.js", () => ({ renderSetupReport: vi.fn(() => "setup") }));

describe("setup agent type telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetQueueForTests();
  });

  it.each([
    [["codex", "codex"], "codex"],
    [["codex", "gemini"], "unknown"],
  ] as const)("records %s as %s", async (sources, expected) => {
    vi.mocked(buildSetupReport).mockImplementation(async (_now, load) => {
      for (const source of sources) await load({ source } as Session);
      return { status: "ready" } as Awaited<ReturnType<typeof buildSetupReport>>;
    });
    const ctx = {
      now: () => 0,
      options: { json: true },
      stdout: { write: vi.fn() },
    } as unknown as CommandContext;
    await command.run(ctx);
    recordCliRun({ command: "setup", agentType: agentTypeOf(ctx), durationMs: 0,
      ok: true, installHash: "unavailable", installIdSource: "unavailable",
      runOrdinalBucket: "unavailable", isCI: false });
    expect(peekQueuedEvents().find((event) => event.name === "cli_run")?.properties.agentType).toBe(expected);
  });
});
