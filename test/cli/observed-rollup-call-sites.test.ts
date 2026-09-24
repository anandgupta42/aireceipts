import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const rollupNames = new Set(["rollupChildren", "buildFullSessionReceiptModel", "buildFullSessionReceiptWithCoverage"]);
const rollupCall = /rollupChildren\(|buildFullSessionReceiptModel\(|buildFullSessionReceiptWithCoverage\(/;

// A plain directory walk keeps the audit independent of any external search tool.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

it("routes every CLI rollup call site through the observed child loader", () => {
  const files = sourceFiles("src").filter((file) => rollupCall.test(readFileSync(file, "utf8"))).sort();
  const audited: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && rollupNames.has(node.expression.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const location = `${file}:${line}`;
        audited.push(location);
        if (file === "src/cli/commands/statusline.ts" || file === "src/pr/index.ts" || file === "src/receipt/subagents.ts") {
          return;
        }
        const argumentsText = node.arguments.map((arg) => arg.getText(source)).join(" ");
        expect(argumentsText, location).toContain(file === "src/setup/report.ts" ? "childRollupDeps" : "observedChildRollupDeps(ctx)");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(audited.length).toBeGreaterThan(10);
});
