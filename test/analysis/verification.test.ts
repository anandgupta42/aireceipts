import { describe, expect, it } from "vitest";
import { verificationEvidence } from "../../src/analysis/verification.js";
import type { Session, ToolCall } from "../../src/parse/types.js";
import { emptyUsage } from "../../src/parse/util.js";

function check(patch: Partial<ToolCall> = {}): ToolCall {
  return { name: "Bash", shell: true, input: { command: "npx tsc --noEmit" }, status: "ok", startedAt: 10, endedAt: 20, ...patch };
}

function edit(patch: Partial<ToolCall> = {}): ToolCall {
  return { name: "Edit", input: { file_path: "src/value.ts" }, status: "ok", startedAt: 30, endedAt: 40, ...patch };
}

function session(calls: ToolCall[], patch: Partial<Session> = {}): Session {
  return {
    id: "test", filePath: "test", source: "claude-code",
    totals: { tokens: emptyUsage(), turnCount: calls.length, toolCallCount: calls.length },
    turns: calls.map((call, index) => ({ index, toolCalls: [call] })),
    ...patch,
  };
}

describe("SPEC-0085 recorded TypeScript check evidence", () => {
  it("identifies the recorded check and subsequent typed edit without exporting the path", () => {
    expect(verificationEvidence(session([check(), edit()]))).toEqual({
      command: "npx tsc --noEmit", outcome: "edit-after-tool-success", checkTurnIndex: 0,
      editTurnIndex: 1, scope: "captured-parent-calls",
    });
  });

  it("trusts the linked tool status, never an output claim that tests passed", () => {
    expect(verificationEvidence(session([check({ status: "error", output: "All tests passed" })]))).toEqual({
      command: "npx tsc --noEmit", outcome: "tool-error", checkTurnIndex: 0,
      editTurnIndex: null, scope: "captured-parent-calls",
    });
    expect(verificationEvidence(session([check({ status: undefined, output: "All tests passed" }), edit()]))).toBeNull();
  });

  it("uses only the latest literal invocation, without saying an earlier failure was repaired", () => {
    expect(verificationEvidence(session([check({ status: "error" }), edit(), check({ startedAt: 50, endedAt: 60 })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit(), check({ startedAt: 50, endedAt: 60, status: "error" })]))).toMatchObject({ outcome: "tool-error", checkTurnIndex: 2 });
  });

  it.each([
    "npx tsc --noEmit; echo $?", "npx tsc --noEmit | cat", "npx tsc --noEmit && true",
    "cd repo && npx tsc --noEmit", "CI=1 npx tsc --noEmit", "npm test", "echo 'npx tsc --noEmit'",
    "npx tsc --noEmit --project other", "npx tsc --noEmit &", "npx tsc --noEmit > result.log",
  ])("does not interpret a compound or different command: %s", command => {
    expect(verificationEvidence(session([check({ input: { command } }), edit()]))).toBeNull();
  });

  it.each([
    { name: "mcp__exec", shell: false }, { name: "Agent", shell: true },
    { input: { command: "npx tsc --noEmit", run_in_background: true } },
    { input: { command: "npx tsc --noEmit", run_in_background: "false" } },
  ])("rejects non-Bash and background execution: %j", patch => {
    expect(verificationEvidence(session([check(patch), edit()]))).toBeNull();
  });

  it.each(["doc.md", "README", "image.png", "src/value.ts.txt"])("does not flag a non-TypeScript edit to %s", file_path => {
    expect(verificationEvidence(session([check(), edit({ input: { file_path } })]))).toBeNull();
  });

  it.each(["src/value.tsx", "src/value.mts", "src/value.cts"])("recognizes a typed edit to %s", file_path => {
    expect(verificationEvidence(session([check(), edit({ input: { file_path } })]))?.outcome).toBe("edit-after-tool-success");
  });

  it("does not classify failed edits, shell mutations, or prose as recorded named edits", () => {
    for (const call of [edit({ status: "error" }), edit({ name: "Bash", shell: true, input: { command: "sed -i ... value.ts" } }), edit({ name: "Agent", output: "Edited src/value.ts" })]) {
      expect(verificationEvidence(session([check(), call]))).toBeNull();
    }
  });

  it("abstains on a still-running call, malformed record, or unknown status", () => {
    expect(verificationEvidence(session([check(), edit({ status: "running" })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit()], { droppedRecords: 1 }))).toBeNull();
    expect(verificationEvidence(session([check(), edit(), check({ status: "running", startedAt: 50, endedAt: undefined })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit(), { name: "Agent" }]))).toBeNull();
  });

  it.each([{ startedAt: undefined }, { endedAt: undefined }, { endedAt: 0 }, { startedAt: Number.NaN }, { endedAt: Infinity }])("abstains on an unorderable check: %j", patch => {
    expect(verificationEvidence(session([check(patch), edit()]))).toBeNull();
  });

  it("requires a typed edit to start strictly after the completed check", () => {
    expect(verificationEvidence(session([check(), edit({ startedAt: 20 })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit({ startedAt: 15 })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit({ startedAt: undefined })]))).toBeNull();
    expect(verificationEvidence(session([check(), edit({ startedAt: 15 }), edit({ startedAt: 50, endedAt: 60 })]))).toBeNull();
  });

  it("does not sort contradictory or overlapping check calls into an invented order", () => {
    expect(verificationEvidence(session([check(), check({ startedAt: 15, endedAt: 25 }), edit()]))).toBeNull();
    expect(verificationEvidence(session([check({ startedAt: 50, endedAt: 60 }), check(), edit()]))).toBeNull();
  });

  it("has no claim for another adapter, an external-CI statement or absent captured checks", () => {
    expect(verificationEvidence(session([check(), edit()], { source: "codex" }))).toBeNull();
    expect(verificationEvidence(session([edit()]))).toBeNull();
    expect(verificationEvidence(session([]))).toBeNull();
    expect(verificationEvidence(session([{ name: "Agent", status: "ok", output: "CI passed" }, edit()]))).toBeNull();
  });
});
