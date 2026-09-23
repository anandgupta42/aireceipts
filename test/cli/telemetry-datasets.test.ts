import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, PROPERTIES_SCHEMA_BY_EVENT_NAME } from "../../src/telemetry/schemas.js";

const doc = readFileSync(resolve(process.cwd(), "docs/internal/telemetry-datasets.md"), "utf8");
const blocks = [...doc.matchAll(/^## ([^\n]+)\n[\s\S]*?```kql\n([\s\S]*?)\n```/gm)];
const fieldNames = new Set(Object.values(PROPERTIES_SCHEMA_BY_EVENT_NAME).flatMap((schema) => Object.keys(schema.shape)));

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
      const events = [...query.matchAll(/name\s*(?:==|in)\s*(?:\(([^)]+)\)|"([^"]+)")/g)]
        .flatMap((match) => match[2] ? [match[2]] : [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((part) => part[1]));
      for (const event of events) expect(EVENT_NAMES, `${title}: ${event}`).toContain(event);
      for (const [, field] of query.matchAll(/customDimensions\.([A-Za-z][A-Za-z0-9]*)/g)) {
        expect(fieldNames.has(field!), `${title}: ${field}`).toBe(true);
      }
    }
  });

  it("contains no parked fields or literal install hashes", () => {
    expect(doc).not.toMatch(/pr_attach_completed|invokedBy/);
    expect(doc).not.toMatch(/\b[0-9a-f]{64}\b/i);
  });
});
