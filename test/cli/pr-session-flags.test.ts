import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CommandContext } from "../../src/cli/types.js";

const { runPrDetailed } = vi.hoisted(() => ({
  runPrDetailed: vi.fn(async (...args: unknown[]) => {
    void args;
    return {
    code: 0,
    bodyRendered: false,
    contributorCount: 0,
    commentResult: "skipped" as const,
    artifactResult: "skipped" as const,
    shareResult: "skipped" as const,
    handoffSectionIncluded: false,
    result: "success" as const,
    };
  }),
}));

vi.mock("../../src/pr/index.js", () => ({ runPrDetailed, defaultPrDeps: (overrides: unknown) => overrides }));

import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";
import { createContext } from "../../src/cli/context.js";
import { agentTypeOf } from "../../src/cli/agentType.js";
import { recordObservedParseFailures } from "../../src/cli/parseFailures.js";
import { recordCliError, recordCliRun } from "../../src/telemetry/index.js";
import { __resetQueueForTests, peekQueuedEvents } from "../../src/telemetry/sender.js";
import { hashSignature } from "../../src/telemetry/signature.js";

describe("PR --session composition (#234)", () => {
  it("retains every repeated selector in argv order, including mixed flag spellings", () => {
    const options = parseOptions([
      "pr",
      "--session",
      "lead",
      "--session=review-one",
      "--session",
      "review-two",
    ]);

    expect(options.prSessions).toEqual(["lead", "review-one", "review-two"]);
    // The legacy scalar is intentionally only populated for the still-supported
    // one-selector mode; it must never expose a misleading last-wins value.
    expect(options.prSession).toBeUndefined();
  });

  it("preserves the legacy scalar for one --session selector", () => {
    const options = parseOptions(["pr", "--session", "lead"]);

    expect(options.prSessions).toEqual(["lead"]);
    expect(options.prSession).toBe("lead");
  });

  it("threads the lossless selector list through the pr command", async () => {
    const options = parseOptions(["pr", "--session", "lead", "--session", "review"]);
    const recordPrFlowCompleted = vi.fn();

    await prCommand.run({
      options,
      telemetry: { recordPrFlowCompleted },
    } as unknown as CommandContext);

    expect(runPrDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ session: undefined, sessions: ["lead", "review"] }),
      expect.objectContaining({ loadSession: expect.any(Function) }),
    );
    expect(recordPrFlowCompleted).toHaveBeenCalledOnce();
  });

  it("observes a preloaded malformed child and resolves its agent before a render error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aireceipts-pr-child-"));
    const childPath = join(dir, "agent-child.jsonl");
    const fixture = resolve(__dirname, "..", "fixtures", "pr", "parent-with-subagents", "subagents", "agent-child1.jsonl");
    writeFileSync(childPath, `${readFileSync(fixture, "utf8")}\n{torn\n`);
    const ctx = createContext(parseOptions(["pr", "--session", "agent-child"]), []);
    runPrDetailed.mockImplementationOnce(async (_opts, deps) => {
      const nested = deps as { loadNested: (path: string) => Promise<unknown> };
      expect(await nested.loadNested(childPath)).not.toBeNull();
      throw new Error("forced pre-render error");
    });
    try {
      await expect(prCommand.run(ctx)).rejects.toThrow("forced pre-render error");
      expect(agentTypeOf(ctx)).toBe("claude-code");
      recordObservedParseFailures(ctx);
      recordCliError({ command: "pr", agentType: agentTypeOf(ctx), err: new Error("forced pre-render error") });
      const failure = peekQueuedEvents().filter((event) => event.name === "parse_failure");
      expect(failure).toHaveLength(1);
      expect(failure[0]?.properties.signatureHash).toBe(hashSignature("claude-code:malformed_jsonl"));
      expect(peekQueuedEvents().find((event) => event.name === "cli_error")?.properties.agentType).toBe("claude-code");
    } finally {
      __resetQueueForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears a loaded adapter when attribution returns no body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aireceipts-pr-no-body-"));
    const childPath = join(dir, "agent-child.jsonl");
    const fixture = resolve(__dirname, "..", "fixtures", "pr", "parent-with-subagents", "subagents", "agent-child1.jsonl");
    writeFileSync(childPath, readFileSync(fixture, "utf8"));
    const ctx = createContext(parseOptions(["pr", "--session", "agent-child"]), []);
    runPrDetailed.mockImplementationOnce(async (_opts, deps) => {
      const nested = deps as { loadNested: (path: string) => Promise<unknown> };
      expect(await nested.loadNested(childPath)).not.toBeNull();
      return { code: 1, bodyRendered: false, contributorCount: 0, commentResult: "skipped",
        artifactResult: "skipped", shareResult: "skipped", handoffSectionIncluded: false, result: "no_data" };
    });
    try {
      expect(await prCommand.run(ctx)).toBe(1);
      expect(agentTypeOf(ctx)).toBeUndefined();
      recordCliRun({ command: "pr", agentType: agentTypeOf(ctx), durationMs: 1, ok: false,
        exitClass: "no-session-match", installHash: "unavailable", installIdSource: "unavailable",
        runOrdinalBucket: "unavailable", isCI: false });
      expect(peekQueuedEvents().find((event) => event.name === "cli_run")?.properties.agentType).toBe("unknown");
    } finally {
      __resetQueueForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
