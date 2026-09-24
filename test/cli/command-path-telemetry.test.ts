// SPEC-0043 R3/R8 — command-path proof: a real receipt render through main()
// queues one receipt_generated event with bounded fields (S5 review finding 4:
// recorder unit tests alone don't prove commands actually fire them). Only the
// flush is stubbed, so the queue can be inspected after main() returns.
//
// Home isolation happens in the hoisted node:os mock, not in beforeEach: vitest
// workers can't propagate a process.env.HOME mutation into the native environ
// os.homedir() reads (the notice.ts lesson), and adapters capture their roots
// at module load — so the temp home must exist, and be the mocked homedir,
// before the src/ module graph evaluates. Without this, discovery scans the
// REAL home: silently green against a dev machine's transcripts, exit 1 on CI.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const savedEnv = vi.hoisted(() => {
  const keys = ["HOME", "USERPROFILE", "LOCALAPPDATA", "AIRECEIPTS_HOME", "AIRECEIPTS_TELEMETRY"] as const;
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(actual.tmpdir(), "aireceipts-cmdpath-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, "AppData", "Local");
  process.env.AIRECEIPTS_HOME = home;
  process.env.AIRECEIPTS_TELEMETRY = "off";
  return { ...actual, homedir: () => home };
});

import * as telemetry from "../../src/telemetry/index.js";
import * as budget from "../../src/budget/index.js";
import * as preview from "../../src/receipt/preview.js";
import { peekQueuedEvents, __resetQueueForTests } from "../../src/telemetry/sender.js";
import { validateEvent, RECEIPT_SURFACE_VALUES, COUNT_BUCKET_VALUES, ORDINAL_BUCKET_VALUES, type TelemetryEvent } from "../../src/telemetry/schemas.js";
import { main } from "../../src/cli/index.js";
import { listFullSessions } from "../../src/parse/load.js";
import { makeCursorDb } from "../fixtures/cursor/makeCursorDb.js";

const fixturesDir = resolve(__dirname, "..", "fixtures");

function opencodeRoot(home: string): string {
  return process.platform === "win32" ? join(home, "AppData", "Local", "opencode") : join(home, ".local", "share", "opencode");
}

async function withStdinPayload<T>(payload: string, fn: () => Promise<T>): Promise<T> {
  const stream = process.stdin;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
  const iteratorDescriptor = Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator);
  Object.defineProperty(stream, "isTTY", { configurable: true, value: false });
  Object.defineProperty(stream, Symbol.asyncIterator, {
    configurable: true,
    value: () => Readable.from([Buffer.from(payload, "utf8")])[Symbol.asyncIterator](),
  });
  try {
    return await fn();
  } finally {
    if (ttyDescriptor) Object.defineProperty(stream, "isTTY", ttyDescriptor);
    else delete (stream as { isTTY?: boolean }).isTTY;
    if (iteratorDescriptor) Object.defineProperty(stream, Symbol.asyncIterator, iteratorDescriptor);
    else delete (stream as unknown as Record<symbol, unknown>)[Symbol.asyncIterator];
  }
}

describe("SPEC-0043 command-path telemetry", () => {
  const home = homedir(); // the mocked, factory-created temp home
  // Captured ONCE at module scope: a beforeEach save would capture the previous
  // test's mock on the second run, and afterAll would then restore the mock.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    vi.restoreAllMocks();
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }));
    mkdirSync(opencodeRoot(home), { recursive: true });
    copyFileSync(join(fixturesDir, "opencode", "clean-multi-vendor.db"), join(opencodeRoot(home), "opencode.db"));
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    __resetQueueForTests();
    vi.spyOn(telemetry, "flushTelemetry").mockResolvedValue(undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetQueueForTests();
    rmSync(home, { recursive: true, force: true });
  });

  it("a default receipt render queues one valid, bucket-only receipt_generated event", async () => {
    const code = await main([]);
    expect(code).toBe(0);

    const events = peekQueuedEvents();
    const receipts = events.filter((e) => e.name === "receipt_generated");
    expect(receipts).toHaveLength(1);
    const event = receipts[0] as TelemetryEvent;
    expect(validateEvent(event)).toBe(true);

    const props = event.properties as Record<string, unknown>;
    expect(RECEIPT_SURFACE_VALUES).toContain(props.surface);
    expect(props.surface).toBe("receipt");
    // Pins the event to the staged fixture — a discovery escape into a real
    // home renders some other agent's session and fails here, loudly.
    expect(props.agentType).toBe("opencode");
    expect(props.outputMode).toBe("text");
    expect(COUNT_BUCKET_VALUES).toContain(props.turnCountBucket);
    expect(COUNT_BUCKET_VALUES).toContain(props.toolCallCountBucket);
    expect(ORDINAL_BUCKET_VALUES).toContain(props.receiptOrdinalBucket);
    // Bounded by construction: every value is a boolean or an enum string — no
    // raw numbers, no free text, nothing resembling a path or a dollar figure.
    for (const value of Object.values(props)) {
      expect(["boolean", "string"]).toContain(typeof value);
      if (typeof value === "string") {
        expect(value).not.toMatch(/[/\\$]/);
      }
    }

    const runs = events.filter((e) => e.name === "cli_run");
    expect(runs).toHaveLength(1);
    expect((runs[0].properties as Record<string, unknown>).commandClass).toBe("receipt");
    expect((runs[0].properties as Record<string, unknown>).agentType).toBe(props.agentType);
  });

  it.each(["claude-code", "codex", "cursor", "gemini", "opencode"] as const)("matches cli_run and receipt_generated for %s through main", async (source) => {
    const roots = [
      ["claude-code", join(home, ".claude", "projects", "test", "session.jsonl"), "claude-code/clean-multi-tool-2-models.jsonl"],
      ["codex", join(home, ".codex", "sessions", "rollout-test.jsonl"), "codex/clean-session.jsonl"],
      ["gemini", join(home, ".gemini", "tmp", "test", "chats", "session.jsonl"), "gemini/clean-session.jsonl"],
    ] as const;
    for (const [agent, target, fixture] of roots) {
      if (agent !== source) continue;
      mkdirSync(resolve(target, ".."), { recursive: true });
      copyFileSync(join(fixturesDir, fixture), target);
    }
    const oldCursorPath = process.env.CURSOR_DB_PATH;
    if (source === "cursor") {
      const path = join(home, "cursor-state.vscdb");
      makeCursorDb({ dbPath: path });
      process.env.CURSOR_DB_PATH = path;
    }
    try {
      const summary = (await listFullSessions()).find((item) => item.source === source);
      expect(summary, source).toBeDefined();
      expect(await main([summary!.id])).toBe(0);
      const events = peekQueuedEvents();
      const runs = events.filter((event) => event.name === "cli_run");
      const receipts = events.filter((event) => event.name === "receipt_generated");
      expect(runs).toHaveLength(1);
      expect(receipts).toHaveLength(1);
      expect(runs[0]?.properties.agentType).toBe(source);
      expect(runs[0]?.properties.agentType).toBe(receipts[0]?.properties.agentType);
    } finally {
      if (oldCursorPath === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = oldCursorPath;
    }
  });

  it("queues one Gemini parse_failure on a torn full render without changing receipt bytes", async () => {
    const chatDir = join(home, ".gemini", "tmp", "project", "chats");
    mkdirSync(chatDir, { recursive: true });
    const chat = join(chatDir, "torn.jsonl");
    writeFileSync(chat, `${readFileSync(join(fixturesDir, "gemini", "clean-session.jsonl"), "utf8")}\n{torn\n`);
    const oldTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    const oldConnection = process.env.AIRECEIPTS_TELEMETRY_CONNECTION;
    const output: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
      process.env.AIRECEIPTS_TELEMETRY = "on";
      process.env.AIRECEIPTS_TELEMETRY_CONNECTION = "InstrumentationKey=test;IngestionEndpoint=https://example.com/";
      expect(await main([chat])).toBe(0);
      const enabledBytes = output.join("");
      const failures = peekQueuedEvents().filter((event) => event.name === "parse_failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]?.properties).toMatchObject({ agentType: "gemini", cliVersion: expect.any(String),
        installHash: expect.stringMatching(/^[0-9a-f]{64}$/), isCI: expect.any(Boolean) });
      __resetQueueForTests();
      output.length = 0;
      process.env.AIRECEIPTS_TELEMETRY = "off";
      expect(await main([chat])).toBe(0);
      expect(output.join("")).toBe(enabledBytes);
      __resetQueueForTests();
      expect(await main(["--list"])).toBe(0);
      expect(peekQueuedEvents().filter((event) => event.name === "parse_failure")).toHaveLength(0);
    } finally {
      if (oldTelemetry === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
      else process.env.AIRECEIPTS_TELEMETRY = oldTelemetry;
      if (oldConnection === undefined) delete process.env.AIRECEIPTS_TELEMETRY_CONNECTION;
      else process.env.AIRECEIPTS_TELEMETRY_CONNECTION = oldConnection;
    }
  });

  it("a setup run emits cli_run with its own commandClass", async () => {
    expect(await main(["setup", "--json"])).toBe(0);

    const runs = peekQueuedEvents().filter((event) => event.name === "cli_run");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.properties).toEqual(expect.objectContaining({ commandClass: "setup", ok: true }));
  });

  it("classifies a selector miss as no-session-match", async () => {
    expect(await main(["definitely-not-a-session"])).toBe(1);

    const run = peekQueuedEvents().find((event) => event.name === "cli_run");
    expect(run?.properties).toEqual(
      expect.objectContaining({ commandClass: "receipt", ok: false, exitClass: "no-session-match" }),
    );
  });

  it("classifies a rejected option value as invalid-arguments", async () => {
    expect(await main(["--template", "fancy"])).toBe(1);

    const run = peekQueuedEvents().find((event) => event.name === "cli_run");
    expect(run?.properties).toEqual(
      expect.objectContaining({ commandClass: "receipt", ok: false, exitClass: "invalid-arguments" }),
    );
  });

  it("classifies check-budget's designed exit 1 as budget-exceeded", async () => {
    vi.spyOn(budget, "evaluateBudget").mockResolvedValue({
      status: "ok",
      lines: ["budget exceeded"],
      exceeded: true,
    });

    expect(await main(["--check-budget"])).toBe(1);

    const run = peekQueuedEvents().find((event) => event.name === "cli_run");
    expect(run?.properties).toEqual(
      expect.objectContaining({ commandClass: "check-budget", ok: false, exitClass: "budget-exceeded" }),
    );
  });

  it("classifies compare without two sessions as not-comparable", async () => {
    expect(await main(["compare"])).toBe(1);

    const run = peekQueuedEvents().find((event) => event.name === "cli_run");
    expect(run?.properties).toEqual(
      expect.objectContaining({ commandClass: "compare", ok: false, exitClass: "not-comparable" }),
    );
  });

  it("classifies an otherwise deliberate non-zero return as other-controlled", async () => {
    const unsafeDir = join(home, "unsafe-backfill-output");
    mkdirSync(unsafeDir, { recursive: true });
    writeFileSync(join(unsafeDir, "keep.txt"), "user data");

    expect(await main(["backfill", "--out", unsafeDir])).toBe(1);

    const run = peekQueuedEvents().find((event) => event.name === "cli_run");
    expect(run?.properties).toEqual(
      expect.objectContaining({ commandClass: "backfill", ok: false, exitClass: "other-controlled" }),
    );
  });

  it("a thrown error emits cli_error only and never carries exitClass", async () => {
    vi.spyOn(preview, "previewModel").mockImplementation(() => {
      throw new Error("boom");
    });

    expect(await main(["templates"])).toBe(1);

    const events = peekQueuedEvents();
    expect(events.filter((event) => event.name === "cli_error")).toHaveLength(1);
    expect(events.filter((event) => event.name === "cli_run")).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("exitClass");
  });

  it("disabled scoped statusline advances the local counter without a surface key or flush", async () => {
    const transcriptPath = join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl");
    const before = await telemetry.readState(home);
    const code = await withStdinPayload(JSON.stringify({ transcript_path: transcriptPath }), () => main(["statusline", "--cwd", home]));
    expect(code).toBe(0);
    expect((await telemetry.readState(home)).runCount).toBe(before.runCount + 1);
    expect((await telemetry.readState(home)).statusline).toBeUndefined();
    expect(telemetry.flushTelemetry).not.toHaveBeenCalled();
    expect(peekQueuedEvents().filter((event) => event.name === "cli_run")).toHaveLength(0);
  });

  it("a statusline poll of a torn transcript queues no parse_failure", async () => {
    const transcriptPath = join(fixturesDir, "claude-code", "dropped-record-midstream.jsonl");
    expect(await withStdinPayload(JSON.stringify({ transcript_path: transcriptPath }), () => main(["statusline"]))).toBe(0);
    expect(peekQueuedEvents().filter((event) => event.name === "parse_failure")).toHaveLength(0);
  });

  it("enabled scoped and unscoped statuslines flush only when the queue has an event", async () => {
    const priorConnection = process.env.AIRECEIPTS_TELEMETRY_CONNECTION;
    const priorTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T21:30:00Z"));
    try {
      process.env.AIRECEIPTS_TELEMETRY = "on";
      process.env.AIRECEIPTS_TELEMETRY_CONNECTION = "InstrumentationKey=test;IngestionEndpoint=https://example.com/";
      const transcriptPath = join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl");
      const poll = (args: string[]) => withStdinPayload(JSON.stringify({ transcript_path: transcriptPath }), () => main(args));
      expect(await poll(["statusline", "--cwd", home])).toBe(0);
      expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
      expect(peekQueuedEvents().filter((event) => event.name === "cli_run")).toHaveLength(0);
      __resetQueueForTests(); // The mocked flush does not drain its queue.
      expect(await poll(["statusline", "--cwd", home])).toBe(0);
      expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(1);
      expect(await poll(["statusline"])).toBe(0);
      expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(2);
      __resetQueueForTests();
      expect(await poll(["statusline"])).toBe(0);
      expect(telemetry.flushTelemetry).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      if (priorConnection === undefined) delete process.env.AIRECEIPTS_TELEMETRY_CONNECTION;
      else process.env.AIRECEIPTS_TELEMETRY_CONNECTION = priorConnection;
      if (priorTelemetry === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
      else process.env.AIRECEIPTS_TELEMETRY = priorTelemetry;
    }
  });

  it.each([true, false])("quota surface carries run identity with CI=%s", async (ci) => {
    const priorCI = process.env.CI;
    const priorActions = process.env.GITHUB_ACTIONS;
    const priorConnection = process.env.AIRECEIPTS_TELEMETRY_CONNECTION;
    const priorTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    try {
      process.env.CI = ci ? "true" : "";
      process.env.GITHUB_ACTIONS = "";
      process.env.AIRECEIPTS_TELEMETRY = "on";
      process.env.AIRECEIPTS_TELEMETRY_CONNECTION = "InstrumentationKey=test;IngestionEndpoint=https://example.com/";
      const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 20 } } });
      expect(await withStdinPayload(payload, () => main(["--quota"]))).toBe(0);
      const surface = peekQueuedEvents().find((event) => event.name === "integration_surface_rendered");
      expect(surface?.properties).toMatchObject({ integration: "quota", cliVersion: expect.any(String), installHash: expect.stringMatching(/^[0-9a-f]{64}$/), isCI: ci });
    } finally {
      for (const [key, value] of [["CI", priorCI], ["GITHUB_ACTIONS", priorActions], ["AIRECEIPTS_TELEMETRY_CONNECTION", priorConnection], ["AIRECEIPTS_TELEMETRY", priorTelemetry]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // SPEC-0054 R8 — detailsView is true only for renders that carry the DETAILS
  // section: text with the flag → true; --json ignores the flag (the export
  // never renders the section) → false.
  it("--details flips detailsView on the text render and stays false on --json", async () => {
    expect(await main(["--details"])).toBe(0);
    expect(await main(["--details", "--json"])).toBe(0);

    const receipts = peekQueuedEvents().filter((e) => e.name === "receipt_generated");
    expect(receipts).toHaveLength(2);
    for (const event of receipts) {
      expect(validateEvent(event as TelemetryEvent)).toBe(true);
    }
    const [text, json] = receipts.map((e) => e.properties as Record<string, unknown>);
    expect(text.outputMode).toBe("text");
    expect(text.detailsView).toBe(true);
    expect(json.outputMode).toBe("json");
    expect(json.detailsView).toBe(false);
  });
});
