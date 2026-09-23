import { loadById } from "../src/parse/load.js";
import { buildReceiptModel } from "../src/receipt/model.js";
import { renderReceipt } from "../src/receipt/render.js";
import { renderReceiptSvg } from "../src/receipt/svg.js";

export async function verificationGoldens(check: (path: string, text: string) => void): Promise<void> {
  const session = await loadById("claude-code", "test/fixtures/claude-code/verification-after-typecheck.jsonl");
  if (!session) throw new Error("verification workload fixture failed to load");
  const model = await buildReceiptModel(session);
  check("goldens/verification-evidence-details.txt", renderReceipt(model, { color: false, details: true }) + "\n");
  for (const theme of ["light", "dark"] as const) {
    check(`goldens/svg/verification-evidence-${theme}.svg`, renderReceiptSvg(model, { details: true, theme }));
  }
}
