import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";

const root = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "aireceipts-verification-cli-"));
// A private build avoids cleaning dist while other CLI suites are executing it.
const buildRoot = mkdtempSync(path.join(root, "node_modules", "aireceipts-verification-build-"));
// Scope vendor discovery to this child process's disposable fixture directory.
const env = { ...process.env, HOME: fixtureRoot, USERPROFILE: fixtureRoot, LOCALAPPDATA: path.join(fixtureRoot, "AppData", "Local"), AIRECEIPTS_HOME: fixtureRoot, AIRECEIPTS_TELEMETRY: "off", AIRECEIPTS_TELEMETRY_CONNECTION: "", DO_NOT_TRACK: "1", NO_COLOR: "1", TZ: "UTC" };

beforeAll(() => {
  writeFileSync(path.join(buildRoot, "package.json"), JSON.stringify({ type: "module" }));
  const built = spawnSync(process.execPath, ["node_modules/tsup/dist/cli-default.js", "--out-dir", path.join(buildRoot, "dist")], { cwd: root, encoding: "utf8" });
  expect(built.status, built.stderr || built.stdout).toBe(0);
  mkdirSync(path.join(fixtureRoot, ".claude", "projects"), { recursive: true });
  copyFileSync(path.join(root, "test/fixtures/claude-code/verification-after-typecheck.jsonl"), path.join(fixtureRoot, ".claude/projects/verification.jsonl"));
}, 30_000);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});

function cli(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(buildRoot, "dist/cli.js"), ...args], { cwd: root, env, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("SPEC-0091 built CLI actual-workload replay", () => {
  it("renders details and strict JSON while keeping the default and handoff unchanged", () => {
    const details = cli(["--details"]);
    expect(details).toBe(readFileSync(path.join(root, "goldens/verification-evidence-details.txt"), "utf8"));
    expect(cli([])).not.toContain("VERIFICATION EVIDENCE");
    expect(cli(["--handoff"])).not.toContain("VERIFICATION EVIDENCE");
    const json = receiptJsonSchema.parse(JSON.parse(cli(["--json"])));
    expect(json.verificationEvidence).toMatchObject({ checkTurnIndex: 1, editTurnIndex: 2 });
  });

  it("exports the same evidence into actual SVG and PNG artifacts", () => {
    const svg = path.join(fixtureRoot, "verification.svg");
    const png = path.join(fixtureRoot, "verification.png");
    cli(["--details", "--svg", "-o", svg]);
    cli(["--details", "--png", "-o", png]);
    expect(readFileSync(svg, "utf8")).toContain("VERIFICATION EVIDENCE");
    expect(readFileSync(svg, "utf8")).toContain("TS edit after it");
    expect(readFileSync(png).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
