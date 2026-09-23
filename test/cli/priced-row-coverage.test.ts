import { describe, expect, it } from "vitest";
import { receiptTelemetryFromModels } from "../../src/cli/common/telemetry.js";
import type { ReceiptModel } from "../../src/receipt/model.js";

const model = (values: Array<number | null>): ReceiptModel => ({
  source: "codex",
  totalUsd: values.every((value) => value === null) ? null : 1,
  toolRows: values.map((usd) => ({ usd })),
  wasteLines: [],
  priceDelta: null,
  costShape: { preEdit: { totalTurnCount: 0 } },
} as unknown as ReceiptModel);

const coverage = (models: ReceiptModel[]) => receiptTelemetryFromModels({
  surface: "mini", models, outputMode: "text", template: "none", turnCount: 0, toolCallCount: 0, detailsView: false,
}).pricedRowCoverage;

describe("SPEC-0094 R4 priced row coverage", () => {
  it("distinguishes zero rows, no priced rows, partial and full", () => {
    expect(coverage([model([])])).toBe("n/a");
    expect(coverage([model([null])])).toBe("none");
    expect(coverage([model([null, 1])])).toBe("some");
    expect(coverage([model([1, 2])])).toBe("all");
  });
});
