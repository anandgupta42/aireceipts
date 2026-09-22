import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";
import { renderHandoff } from "../../src/receipt/handoff.js";
import { verificationBlocks } from "../../src/receipt/verification.js";

const fixture = "test/fixtures/claude-code/verification-after-typecheck.jsonl";

async function model() {
  const session = await loadById("claude-code", fixture);
  if (!session) throw new Error("real-workload fixture failed to load");
  return buildReceiptModel(session);
}

describe("SPEC-0091 verification evidence surfaces", () => {
  it("renders linked actual-workload evidence only in details, with byte-pinned shared text/SVG", async () => {
    const receipt = await model();
    const detailed = renderReceipt(receipt, { color: false, details: true });
    expect(detailed + "\n").toBe(await readFile(path.resolve("goldens/verification-evidence-details.txt"), "utf8"));
    expect(detailed).toContain("tool result ok (turn 2)");
    expect(detailed).toContain("TS edit after it");
    expect(detailed).toContain("(recorded calls only; external checks unknown)");
    expect(detailed).not.toContain("/workload/");
    for (const line of detailed.split("\n")) expect([...line].length, line).toBeLessThanOrEqual(50);
    expect(renderReceipt(receipt, { color: false })).not.toContain("VERIFICATION EVIDENCE");
    for (const theme of ["light", "dark"] as const) {
      expect(renderReceiptSvg(receipt, { details: true, theme })).toBe(await readFile(`goldens/svg/verification-evidence-${theme}.svg`, "utf8"));
    }
  });

  it("exports strict optional evidence without changing money or handoff", async () => {
    const receipt = await model();
    const json = toJsonModel(receipt);
    expect(receiptJsonSchema.parse(json).verificationEvidence).toEqual({
      command: "npx tsc --noEmit", outcome: "edit-after-tool-success", checkTurnIndex: 1,
      editTurnIndex: 2, scope: "captured-parent-calls",
    });
    const without = { ...receipt, verificationEvidence: undefined };
    expect(toJsonModel(without)).not.toHaveProperty("verificationEvidence");
    expect(renderHandoff(receipt)).toBe(renderHandoff(without));
    const unrecognized = await loadById("claude-code", fixture);
    if (!unrecognized) throw new Error("real-workload fixture failed to load");
    for (const turn of unrecognized.turns) {
      for (const call of turn.toolCalls) {
        if (call.name === "Bash") call.input = { command: "npx tsc --noEmit --pretty false" };
      }
    }
    const alternative = await buildReceiptModel(unrecognized);
    expect(alternative.verificationEvidence).toBeNull();
    expect(receipt.totalUsd).toBe(alternative.totalUsd);
    expect(receipt.totalTokens).toEqual(alternative.totalTokens);
    expect(receipt.wasteLines).toEqual(alternative.wasteLines);
  });

  it("names an error as a tool result and never interpolates output prose or paths", () => {
    const blocks = verificationBlocks({ command: "npx tsc --noEmit", outcome: "tool-error", checkTurnIndex: 5, editTurnIndex: null, scope: "captured-parent-calls" });
    expect(blocks).toContainEqual({ kind: "row", label: "npx tsc --noEmit", value: "tool result error (turn 6)" });
    expect(JSON.stringify(blocks)).not.toMatch(/untested|verified|failing|stale|compiles|safe|TS edit/u);
    expect(verificationBlocks(null)).toEqual([]);
  });

  it("keeps a nonzero priced control unchanged when evidence recognition is disabled", async () => {
    const control = await loadById("claude-code", fixture);
    if (!control) throw new Error("real-workload fixture failed to load");
    // Explicitly synthetic pricing control; do not relabel the real capture itself.
    for (const turn of control.turns) turn.model = "claude-sonnet-5";
    const recognized = await buildReceiptModel(control);
    expect(recognized.totalUsd).toBeGreaterThan(0);
    expect(recognized.verificationEvidence?.outcome).toBe("edit-after-tool-success");
    for (const turn of control.turns) {
      for (const call of turn.toolCalls) {
        if (call.name === "Bash") call.input = { command: "npx tsc --noEmit --pretty false" };
      }
    }
    const unrecognized = await buildReceiptModel(control);
    expect(unrecognized.verificationEvidence).toBeNull();
    expect(unrecognized.totalUsd).toBe(recognized.totalUsd);
    expect(unrecognized.toolRows).toEqual(recognized.toolRows);
    expect(unrecognized.wasteLines).toEqual(recognized.wasteLines);
  });
});
