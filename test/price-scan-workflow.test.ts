import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/price-scan.yml"), "utf8");
const issueStep = workflow.split("      - name: Upsert drift/discovery issue\n")[1];
if (!issueStep) throw new Error("price-scan issue step missing");
const block = issueStep.split("        run: |\n")[1];
if (!block) throw new Error("price-scan issue script missing");
const script = block.split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runIssueStep(status: string, matches: string, apiFailure = false) {
  const dir = mkdtempSync(join(tmpdir(), "aireceipts-price-scan-"));
  dirs.push(dir);
  const log = join(dir, "gh.log");
  const mock = join(dir, "mock-gh.sh");
  writeFileSync(mock, `gh() {
    if [ "$1" = api ]; then
      if [ "$MOCK_API_FAILURE" = 1 ]; then return 9; fi
      printf '%s\\n' "$MOCK_MATCHES"
    else
      printf '%s\\n' "$*" >> "$MOCK_GH_LOG"
    fi
  }
`);
  writeFileSync(join(dir, "price-tripwire-report.md"), "# Current report\n");
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      BASH_ENV: mock,
      GH_REPO: "owner/repo",
      TRIPWIRE_STATUS: status,
      RUN_URL: "https://github.com/owner/repo/actions/runs/1",
      MOCK_MATCHES: matches,
      MOCK_API_FAILURE: apiFailure ? "1" : "0",
      MOCK_GH_LOG: log,
    },
  });
  const operations = readFileSync(log, { encoding: "utf8", flag: "a+" }).trim().split("\n").filter(Boolean);
  return { result, operations, dir };
}

describe("rolling price-scan issue state transitions", () => {
  it("rejects malformed or inconsistent scan summaries before any issue step", () => {
    const validator = workflow.split("summary=\"$(node <<'NODE'\n")[1]?.split("\n          NODE")[0];
    expect(validator).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "aireceipts-price-summary-"));
    dirs.push(dir);
    const summaryPath = join(dir, "price-tripwire-summary.json");
    for (const [summary, expected] of [
      [{ status: "clean", driftCount: 0, discoveryCount: 0 }, 0],
      [{ status: "drift", driftCount: 1, discoveryCount: 0 }, 0],
      [{ status: "clean", driftCount: 1, discoveryCount: 0 }, 1],
      [{ status: "discovery", driftCount: 0, discoveryCount: 0 }, 1],
      [{ status: "unknown", driftCount: 0, discoveryCount: 0 }, 1],
    ] as const) {
      writeFileSync(summaryPath, JSON.stringify(summary));
      const result = spawnSync("node", ["-"], { cwd: dir, input: validator, encoding: "utf8" });
      expect(result.status === 0).toBe(expected === 0);
    }
  });

  it("filters exact-titled issues, excludes PRs, and skips all mutations on warning", () => {
    expect(script).toContain('.pull_request == null and .title == \\"$title\\"');
    expect(workflow).toContain("if: steps.tripwire.outputs.status != 'warn'");
  });

  it("creates one issue when drift has no open report", () => {
    const { result, operations, dir } = runIssueStep("drift", "");
    expect(result.status).toBe(0);
    expect(operations).toEqual([expect.stringContaining("issue create --title prices: drift/discovery report")]);
    expect(readFileSync(join(dir, "price-tripwire-issue.md"), "utf8"))
      .toContain("https://github.com/owner/repo/actions/runs/1");
  });

  it("updates the oldest report and closes newer duplicates", () => {
    const { result, operations } = runIssueStep("discovery", "43\n11\n42");
    expect(result.status).toBe(0);
    expect(operations).toEqual([
      expect.stringContaining("issue close 42 --reason not planned --comment Duplicate of #11"),
      expect.stringContaining("issue close 43 --reason not planned --comment Duplicate of #11"),
      expect.stringContaining("issue edit 11 --body-file price-tripwire-issue.md"),
    ]);
  });

  it("closes the canonical report on clean and does nothing if absent", () => {
    const existing = runIssueStep("clean", "22\n10");
    expect(existing.result.status).toBe(0);
    expect(existing.operations).toEqual([
      expect.stringContaining("issue close 22 --reason not planned --comment Duplicate of #10"),
      expect.stringContaining("issue close 10 --comment Tripwire is clean"),
    ]);
    const absent = runIssueStep("clean", "");
    expect(absent.result.status).toBe(0);
    expect(absent.operations).toEqual([]);
  });

  it("fails closed when the issue lookup fails", () => {
    const { result, operations } = runIssueStep("drift", "", true);
    expect(result.status).not.toBe(0);
    expect(operations).toEqual([]);
  });
});
