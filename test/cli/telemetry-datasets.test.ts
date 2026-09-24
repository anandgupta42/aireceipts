import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, PROPERTIES_SCHEMA_BY_EVENT_NAME } from "../../src/telemetry/schemas.js";

const doc = readFileSync(resolve(process.cwd(), "docs/internal/telemetry-datasets.md"), "utf8");
const blocks = [...doc.matchAll(/^## ([^\n]+)\n[\s\S]*?```kql\n([\s\S]*?)\n```/gm)];
const fieldNames = new Set(Object.values(PROPERTIES_SCHEMA_BY_EVENT_NAME).flatMap((schema) => Object.keys(schema.shape)));

function references(query: string): { events: string[]; fields: string[] } {
  const events = [...query.matchAll(/\bname\s*(?:==|=~|in~?)\s*(\([^)]*\)|["'][^"']+["'])/g)]
    .flatMap((match) => [...match[1]!.matchAll(/["']([^"']+)["']/g)].map((part) => part[1]!));
  const fields = [...query.matchAll(/customDimensions(?:\.([A-Za-z][A-Za-z0-9]*)|\[["']([^"']+)["']\])/g)]
    .map((match) => (match[1] ?? match[2])!);
  return { events, fields };
}

function checkReferences(title: string, query: string): void {
  const { events, fields } = references(query);
  for (const event of events) expect(EVENT_NAMES, `${title}: ${event}`).toContain(event);
  for (const field of fields) expect(fieldNames.has(field), `${title}: ${field}`).toBe(true);
}

describe("SPEC-0094 R5 dataset definitions", () => {
  it("has named KQL blocks for every dataset", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    expect(blocks.map((block) => block[1])).toEqual(expect.arrayContaining([
      "Raw churn: new hashes and unavailable rows", "Adoption: weekly active installs",
      "Reliability: errors and failed polls", "Statusline row reduction",
    ]));
  });

  it("references only schema events and fields in every KQL block", () => {
    for (const [, title, query] of blocks) {
      checkReferences(title!, query!);
    }
  });

  it("uses the same attributed heartbeat pairs in every adoption dataset", () => {
    const adoption = blocks.filter(([, title]) => title?.startsWith("Adoption:"));
    expect(adoption).toHaveLength(4);
    const normalized = adoption.map(([, , query]) => query!.match(/let attributed_heartbeats = [\s\S]*?\| summarize by installHash, attributedHour;/)?.[0]);
    expect(normalized.every(Boolean)).toBe(true);
    expect(new Set(normalized).size).toBe(1);
    for (const [, , query] of adoption) {
      expect(query).toContain('hourOffset != ">24"');
      expect(query).toContain("bin(timestamp, 1h) - toint(hourOffset) * 1h");
      expect(query).toMatch(/attributed_heartbeats\s*\| (?:project installHash, activityTime = attributedHour|join kind=inner)/);
      expect(query).not.toMatch(/startofweek\(timestamp\)|activeDay = startofday\(timestamp\)/);
    }
    expect(adoption[1]?.[2]).toContain("let installCount = toscalar(allHeartbeats | summarize dcount(installHash));");
    expect(adoption[1]?.[2]).not.toContain("by day = startofday(timestamp)");
  });

  it("anchors cohort first-seen on attributed activity and excludes negative weeks", () => {
    const cohort = blocks.find(([, title]) => title === "Adoption: week-over-week cohort grid")?.[2];
    expect(cohort).toBeDefined();
    expect(cohort).toContain("let first_seen_activity = union");
    expect(cohort).toContain("attributed_heartbeats | project installHash, activityTime = attributedHour");
    expect(cohort).toContain("firstSeen = min(activityTime)");
    expect(cohort).toContain("| where weeksSinceFirst >= 0");
  });

  it("rejects a misspelled bracket field and event", () => {
    expect(() => checkReferences("bad field", 'customEvents | where name == "cli_run" | extend x = tostring(customDimensions["installHahs"])')).toThrow();
    expect(() => checkReferences("bad let field", 'let attributed_heartbeats = customEvents\n| extend hourOffset = tostring(customDimensions.hourOffest);\nattributed_heartbeats | count')).toThrow();
    expect(() => checkReferences("bad event", 'customEvents | where name in ("cli_run", "cli_rnu")')).toThrow();
    expect(references('where name == "cli_run" or name in ("cli_error", "parse_failure") | extend x = tostring(customDimensions.installHash)'))
      .toEqual({ events: ["cli_run", "cli_error", "parse_failure"], fields: ["installHash"] });
  });

  it("contains no parked fields or literal install hashes", () => {
    expect(doc).not.toMatch(/pr_attach_completed|invokedBy/);
    expect(doc).not.toMatch(/\b[0-9a-f]{64}\b/i);
  });
});
