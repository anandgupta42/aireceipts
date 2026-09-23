import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteRunStart, noteStatuslinePoll, showTelemetryPayload } from "./index.js";
import { __setDevelopmentBuildRootForTests, isDevelopmentBuild } from "./helpers.js";
import { __resetQueueForTests, flushTelemetry, peekQueuedEvents } from "./sender.js";
import { readState, updateState } from "./state.js";

const CONN = "InstrumentationKey=test;IngestionEndpoint=https://example.com/";
const ENV = { AIRECEIPTS_TELEMETRY_CONNECTION: CONN };
const BASE = Date.parse("2026-09-22T21:00:00Z");
const SURFACE = { inputMode: "none", payloadValid: false, result: "no_data", customFormat: false, scoped: false, configFile: false } as const;
let home: string;
let savedHome: string | undefined;
const rows = (name: string) => peekQueuedEvents().filter((event) => event.name === name);

// Pinned v0.11.0 parseState fixture: it rebuilds known fields and drops unknown keys.
function parseStateV011(raw: string): { state?: Record<string, unknown>; recovered: boolean } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { recovered: true }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { recovered: true };
  const source = parsed as Record<string, unknown>;
  if (source.schemaVersion !== 1 || typeof source.runCount !== "number" || !Number.isInteger(source.runCount) || source.runCount < 0 ||
    typeof source.receiptCount !== "number" || !Number.isInteger(source.receiptCount) || source.receiptCount < 0 ||
    typeof source.milestones !== "object" || source.milestones === null || Array.isArray(source.milestones)) return { recovered: true };
  const milestones: Record<string, true> = {};
  for (const [key, value] of Object.entries(source.milestones)) if (value === true) milestones[key] = true;
  const state: Record<string, unknown> = { schemaVersion: 1, runCount: source.runCount, receiptCount: source.receiptCount, milestones };
  if (typeof source.installId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.installId)) state.installId = source.installId;
  if (typeof source.firstRunAt === "string") state.firstRunAt = source.firstRunAt;
  return { state, recovered: false };
}

beforeEach(async () => {
  __resetQueueForTests();
  home = await mkdtemp(join(tmpdir(), "aireceipts-statusline-telemetry-"));
  savedHome = process.env.AIRECEIPTS_HOME;
  process.env.AIRECEIPTS_HOME = home;
});
afterEach(async () => {
  __resetQueueForTests();
  __setDevelopmentBuildRootForTests();
  if (savedHome === undefined) delete process.env.AIRECEIPTS_HOME;
  else process.env.AIRECEIPTS_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("SPEC-0094 R1 statusline", () => {
  it("dedupes 120 polls in each hour and emits the completed hour on rollover", async () => {
    for (let i = 0; i < 120; i++) await noteStatuslinePoll(SURFACE, undefined, ENV, BASE + i * 1000);
    for (let i = 0; i < 120; i++) await noteStatuslinePoll(SURFACE, undefined, ENV, BASE + 3_600_000 + i * 1000);
    expect(rows("cli_run")).toHaveLength(0);
    expect(rows("integration_surface_rendered")).toHaveLength(2);
    expect(rows("statusline_heartbeat")).toHaveLength(1);
    expect(rows("statusline_heartbeat")[0]?.properties).toMatchObject({ pollCountBucket: "51-200", failedPollCountBucket: "0", hourOffset: "1" });
    expect(peekQueuedEvents().length).toBeLessThanOrEqual(24);
  });

  it("reports both alternating surface tuples once", async () => {
    for (let i = 0; i < 30; i++) await noteStatuslinePoll({ ...SURFACE, scoped: i % 2 === 0 }, undefined, ENV, BASE + i);
    expect(rows("integration_surface_rendered")).toHaveLength(2);
    expect(rows("integration_surface_rendered")[0]?.properties).toMatchObject({ cliVersion: expect.any(String), installHash: expect.stringMatching(/^[0-9a-f]{64}$/), isCI: false });
  });

  it.each([true, false])("uses CI=%s on surface and heartbeat rows", async (ci) => {
    const env = { ...ENV, CI: ci ? "true" : "", GITHUB_ACTIONS: "" };
    await noteStatuslinePoll(SURFACE, undefined, env, BASE);
    await noteStatuslinePoll(SURFACE, undefined, env, BASE + 3_600_000);
    for (const name of ["integration_surface_rendered", "statusline_heartbeat"]) {
      expect(rows(name)[0]?.properties).toMatchObject({ isCI: ci, cliVersion: expect.any(String), installHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
  });

  it.each([[1,"1"],[10,"2-10"],[11,"11-50"],[200,"51-200"],[201,">200"]] as const)("buckets %i polls", async (count, bucket) => {
    for (let i = 0; i < count; i++) await noteStatuslinePoll(undefined, undefined, ENV, BASE + i);
    await noteStatuslinePoll(undefined, undefined, ENV, BASE + 3_600_000);
    const payload = rows("statusline_heartbeat")[0]?.properties;
    expect(payload).toMatchObject({ pollCountBucket: bucket, hourOffset: "1" });
    expect(payload).not.toHaveProperty("pollCount");
  });

  it.each([[0,"0"],[1,"1"],[11,">10"]] as const)("buckets %i failures", async (count, bucket) => {
    for (let i = 0; i < Math.max(1,count); i++) await noteStatuslinePoll(undefined, i < count ? new Error("x") : undefined, ENV, BASE + i);
    await noteStatuslinePoll(undefined, undefined, ENV, BASE + 3_600_000);
    expect(rows("statusline_heartbeat")[0]?.properties).toMatchObject({ failedPollCountBucket: bucket });
  });

  it.each([[1,"1"],[2,"2"],[24,"24"],[25,">24"],[72,">24"]] as const)("uses closed offset for %i completed hours", async (hours, offset) => {
    await noteStatuslinePoll(undefined, undefined, ENV, BASE);
    await noteStatuslinePoll(undefined, undefined, ENV, BASE + hours * 3_600_000);
    const payload = rows("statusline_heartbeat")[0]?.properties;
    expect(payload).toMatchObject({ hourOffset: offset });
    if (hours <= 24) {
      const arrivalHour = Math.floor((BASE + hours * 3_600_000) / 3_600_000);
      expect(arrivalHour - Number((payload as Record<string, unknown> | undefined)?.hourOffset)).toBe(Math.floor(BASE / 3_600_000));
    }
    expect(payload).not.toHaveProperty("hour");
    expect(payload).not.toHaveProperty("date");
    expect(payload).not.toHaveProperty("durationBucket");
  });

  it("counts a backwards-clock poll into the stored hour without a heartbeat", async () => {
    await noteStatuslinePoll(undefined, undefined, ENV, BASE + 3_600_000);
    await noteStatuslinePoll(undefined, undefined, ENV, BASE);
    expect(rows("statusline_heartbeat")).toHaveLength(0);
    expect((await readState(home)).statusline).toMatchObject({ hour: "2026-09-22T22", pollCount: 2 });
    await noteStatuslinePoll(undefined, undefined, ENV, BASE + 2 * 3_600_000);
    expect(rows("statusline_heartbeat")[0]?.properties).toMatchObject({ hourOffset: "1", pollCountBucket: "2-10" });
  });

  it("dedupes thrown classes, counts every throw, resets at rollover", async () => {
    await noteStatuslinePoll(undefined, new Error("a"), ENV, BASE);
    await noteStatuslinePoll(undefined, new Error("b"), ENV, BASE + 1);
    expect(rows("cli_error")).toHaveLength(1);
    await noteStatuslinePoll(undefined, { code: "ENOENT" }, ENV, BASE + 2);
    expect(rows("cli_error")).toHaveLength(2);
    await noteStatuslinePoll(undefined, new Error("a"), ENV, BASE + 3_600_000);
    expect(rows("cli_error")).toHaveLength(3);
    expect(rows("statusline_heartbeat")[0]?.properties).toMatchObject({ failedPollCountBucket: "2-10" });
  });

  it("tracks first run locally while keeping disabled statusline and install id absent", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 50; i++) await noteStatuslinePoll(SURFACE, undefined, { ...ENV, DO_NOT_TRACK: "1" }, BASE + i);
    expect((await readState(home)).statusline).toBeUndefined();
    expect(await readState(home)).toMatchObject({ firstRunAt: "2026-09-22", milestones: { first_run: true }, runCount: 50 });
    expect((await readState(home)).installId).toBeUndefined();
    await flushTelemetry({ env: { ...ENV, DO_NOT_TRACK: "1" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records nothing when state write fails", async () => {
    await writeFile(join(home, ".aireceipts"), "occupied");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await noteStatuslinePoll(SURFACE, undefined, ENV, BASE);
    expect(peekQueuedEvents()).toHaveLength(0);
    await flushTelemetry({ env: ENV });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("concurrent updates preserve JSON and identity", async () => {
    await noteStatuslinePoll(SURFACE, undefined, ENV, BASE);
    const id = (await readState(home)).installId;
    await Promise.all([noteStatuslinePoll(SURFACE, undefined, ENV, BASE + 3_600_000), noteStatuslinePoll(SURFACE, undefined, ENV, BASE + 3_600_000)]);
    const raw = await readFile(join(home, ".aireceipts", "state.json"), "utf8");
    expect(JSON.parse(raw)).toBeTruthy();
    expect((await readState(home)).installId).toBe(id);
    expect(rows("statusline_heartbeat").length).toBeGreaterThanOrEqual(1);
    expect(rows("statusline_heartbeat").length).toBeLessThanOrEqual(2);
  });

  it("old v0.11.0 parser drops the new key without recovering or changing identity", async () => {
    await noteStatuslinePoll(SURFACE, undefined, ENV, BASE);
    const path = join(home, ".aireceipts", "state.json");
    const before = await readState(home);
    const old = parseStateV011(await readFile(path,"utf8"));
    expect(old.recovered).toBe(false);
    expect(old.state?.installId).toBe(before.installId);
    expect(old.state).not.toHaveProperty("statusline");
    await writeFile(path, JSON.stringify(old.state));
    const after = await updateState(() => {}, home);
    expect(after?.installId).toBe(before.installId);
    expect(after?.statusline).toBeUndefined();
  });
});

describe("SPEC-0094 R4 dev build", () => {
  it("detects fallback version and a package .git entry", async () => {
    expect(isDevelopmentBuild("0.0.0", home)).toBe(true);
    expect(isDevelopmentBuild("0.11.0", home)).toBe(false);
    await mkdir(join(home, ".git"));
    expect(isDevelopmentBuild("0.11.0", home)).toBe(true);
  });

  it("creates no install id with the shipped default and explains the disabled preview", async () => {
    await mkdir(join(home, ".git"));
    __setDevelopmentBuildRootForTests(home);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await noteRunStart("receipt", {}, BASE);
    await noteStatuslinePoll(SURFACE, undefined, {}, BASE);
    await flushTelemetry({ env: {} });
    expect((await readState(home)).installId).toBeUndefined();
    expect((await readState(home)).statusline).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(showTelemetryPayload({})).toMatchObject({ enabled: false, reason: "development-build" });
    await noteRunStart("receipt", ENV, BASE);
    expect((await readState(home)).installId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
