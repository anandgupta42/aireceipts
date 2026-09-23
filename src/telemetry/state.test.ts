import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureInstallId, installHashOf, readState, updateState, updateStateWithMeta } from "./state.js";

const INSTALL_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("SPEC-0043 R7 local telemetry state", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "aireceipts-state-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const path = (): string => join(home, ".aireceipts", "state.json");

  it("missing state reads as zero counters", async () => {
    await expect(readState(home)).resolves.toEqual({ schemaVersion: 1, runCount: 0, receiptCount: 0, milestones: {} });
  });

  it("corrupt state self-heals on the next successful update", async () => {
    await writeFile(path(), "{not json", "utf8").catch(async () => {
      await updateState(() => {}, home);
      await writeFile(path(), "{not json", "utf8");
    });

    const state = await updateState((s) => {
      s.runCount += 1;
    }, home);

    expect(state?.runCount).toBe(1);
    const raw = await readFile(path(), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    const siblings = await readdir(join(home, ".aireceipts"));
    const backup = siblings.find((name) => name.startsWith("state.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(home, ".aireceipts", backup!), "utf8")).toBe("{not json");
  });

  it("salvages a valid install id and individual fields from valid JSON with bad counters", async () => {
    await mkdir(join(home, ".aireceipts"));
    await writeFile(path(), JSON.stringify({ schemaVersion: 1, installId: INSTALL_ID, firstRunAt: "2026-07-01", runCount: -1, receiptCount: 3, milestones: [] }));
    const result = await updateStateWithMeta((state) => { ensureInstallId(state, true); }, home);
    expect(result).toMatchObject({ recovered: true, installIdSource: "existing", state: { installId: INSTALL_ID, firstRunAt: "2026-07-01", runCount: 0, receiptCount: 3, milestones: {} } });
  });

  it("salvages an install id despite a wrong schemaVersion", async () => {
    await mkdir(join(home, ".aireceipts"));
    await writeFile(path(), JSON.stringify({ schemaVersion: 99, installId: INSTALL_ID, runCount: 2, receiptCount: 1, milestones: {} }));
    const result = await updateStateWithMeta((state) => { ensureInstallId(state, true); }, home);
    expect(result?.state.installId).toBe(INSTALL_ID);
    expect(result?.recovered).toBe(true);
    expect(result?.installIdSource).toBe("existing");
  });

  it("marks a missing file as a new id source", async () => {
    const result = await updateStateWithMeta((state) => { ensureInstallId(state, true); }, home);
    expect(result?.installIdSource).toBe("new");
  });

  it("moves unparseable bytes aside and mints a fresh id", async () => {
    await mkdir(join(home, ".aireceipts"));
    await writeFile(path(), "{not json", "utf8");
    const result = await updateStateWithMeta((state) => { ensureInstallId(state, true); }, home);
    expect(result?.installIdSource).toBe("recovered_after_corrupt");
    expect(result?.state.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const backup = (await readdir(join(home, ".aireceipts"))).find((name) => name.startsWith("state.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(home, ".aireceipts", backup!), "utf8")).toBe("{not json");
  });

  it("concurrent last-write-wins updates leave valid JSON", async () => {
    await Promise.all([
      updateState((s) => {
        s.runCount += 1;
      }, home),
      updateState((s) => {
        s.receiptCount += 1;
      }, home),
    ]);

    const parsed = JSON.parse(await readFile(path(), "utf8")) as { schemaVersion?: unknown };
    expect(parsed.schemaVersion).toBe(1);
  });

  it("concurrent fresh writers leave one valid v4 install id", async () => {
    await Promise.all([0, 1].map(() => updateStateWithMeta((state) => { ensureInstallId(state, true); }, home)));
    const parsed = JSON.parse(await readFile(path(), "utf8")) as { installId?: string };
    expect(parsed.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("creates a random install id only when telemetry is enabled", async () => {
    const disabled = await updateState((s) => {
      ensureInstallId(s, false);
    }, home);
    expect(disabled?.installId).toBeUndefined();

    const enabled = await updateState((s) => {
      ensureInstallId(s, true);
    }, home);
    expect(enabled?.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(installHashOf(enabled!.installId!)).toMatch(/^[0-9a-f]{64}$/);
    expect(installHashOf(enabled!.installId!)).not.toBe(enabled!.installId);
  });

  it("drops a non-UUID installId from a tampered/corrupt state file (never hash free text)", async () => {
    await updateState((s) => {
      s.runCount = 4;
    }, home);
    const tampered = JSON.parse(await readFile(path(), "utf8")) as Record<string, unknown>;
    tampered.installId = "/Users/alice/secret-repo";
    await writeFile(path(), JSON.stringify(tampered), "utf8");

    const read = await readState(home);
    expect(read.installId).toBeUndefined();
    expect(read.runCount).toBe(4);

    const regenerated = await updateState((s) => {
      ensureInstallId(s, true);
    }, home);
    expect(regenerated?.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
