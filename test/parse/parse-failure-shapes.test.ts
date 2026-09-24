import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { adapters } from "../../src/parse/registry.js";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { getExporter } from "../../src/receipt/exporters.js";
import { CursorAdapter } from "../../src/parse/cursor.js";
import { completeSummariesWithCache } from "../../src/parse/summaryCache.js";
import { ALLOWED, observeSession, recordObservedParseFailures } from "../../src/cli/parseFailures.js";
import type { CommandContext } from "../../src/cli/types.js";
import { __resetQueueForTests, peekQueuedEvents } from "../../src/telemetry/sender.js";
import type { Session } from "../../src/parse/types.js";

interface InventoryRow { adapter: string; path: string; shape: string; reason?: string }
const root = process.cwd();
const inventory = JSON.parse(readFileSync(resolve(root, "test/fixtures/parse-failure-inventory.json"), "utf8")) as InventoryRow[];
const sqlite = await import("node:sqlite").catch(() => null);

function parseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? parseFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("SPEC-0094 R2b inventory and isolation", () => {
  it("covers all adapters, bounded shapes, and null-returning paths", () => {
    for (const adapter of adapters()) {
      const rows = inventory.filter((row) => row.adapter === adapter.id);
      expect(rows.length, adapter.id).toBeGreaterThanOrEqual(2);
      expect(rows.some((row) => row.shape === "not measurable by this spec"), adapter.id).toBe(true);
      expect(adapter.adapterVersion).toMatch(/^[0-9]{1,3}$/);
      for (const row of rows) {
        expect(row.path).toBeTruthy();
        if (row.shape === "not measurable by this spec") expect(row.reason).toBeTruthy();
        if (row.shape !== "not measurable by this spec") expect(row.shape.startsWith(`${adapter.id}:`)).toBe(true);
      }
    }
  });

  it("parse code never imports telemetry", () => {
    for (const file of parseFiles(resolve(root, "src/parse"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:from\s*|import\s*\(?\s*|export\s+[^;]*?from\s*)["'][^"']*telemetry\//);
    }
  });

  it("keeps measurable inventory, allowed shapes, and adapter literals aligned", () => {
    const measurable = inventory.filter((row) => row.shape !== "not measurable by this spec");
    expect(new Set(measurable.map((row) => row.shape))).toEqual(new Set(Object.values(ALLOWED).flat()));
    for (const row of measurable) {
      expect(ALLOWED[row.adapter as keyof typeof ALLOWED]).toContain(row.shape);
      for (const adapter of adapters()) {
        const source = readFileSync(resolve(root, `src/parse/${adapter.id === "claude-code" ? "claudeCode" : adapter.id}.ts`), "utf8");
        expect(source.includes(`"${row.shape}"`), `${row.shape} in ${adapter.id}`).toBe(adapter.id === row.adapter);
      }
    }
  });

  it("shapes never change text, JSON, or export bytes", async () => {
    const session = await loadById("claude-code", resolve(root, "test/fixtures/claude-code/dropped-record-midstream.jsonl"));
    expect(session?.parseFailureShapes).toContain("claude-code:malformed_jsonl");
    const withShapes = await buildReceiptModel(session!);
    const withoutShapes = await buildReceiptModel({ ...session!, parseFailureShapes: undefined });
    expect(renderReceipt(withShapes)).toBe(renderReceipt(withoutShapes));
    expect(JSON.stringify(toJsonModel(withShapes))).toBe(JSON.stringify(toJsonModel(withoutShapes)));
    for (const format of ["json", "csv-session", "csv-tool"]) {
      expect(getExporter(format)!.export(withShapes)).toBe(getExporter(format)!.export(withoutShapes));
    }
  });

  it("records once per distinct agent and shape despite repeated full loads", async () => {
    __resetQueueForTests();
    const ctx = {} as CommandContext;
    const session = await loadById("claude-code", resolve(root, "test/fixtures/claude-code/dropped-record-midstream.jsonl"));
    observeSession(ctx, session!);
    observeSession(ctx, session!);
    recordObservedParseFailures(ctx);
    expect(peekQueuedEvents().filter((event) => event.name === "parse_failure")).toHaveLength(1);
    __resetQueueForTests();
  });

  it("keeps null loads and summary-cache hits out of parse_failure", async () => {
    __resetQueueForTests();
    const filePath = resolve(root, "test/fixtures/claude-code/dropped-record-midstream.jsonl");
    const session = await loadById("claude-code", filePath);
    const cacheDir = await mkdtemp(resolve(tmpdir(), "aireceipts-shape-cache-"));
    try {
      const opts = {
        cachePath: resolve(cacheDir, "cache.json"),
        stat: (file: string) => stat(file),
        load: vi.fn(() => Promise.resolve(session)),
      };
      const first = await completeSummariesWithCache([session!], opts);
      expect(opts.load).toHaveBeenCalledTimes(1);
      const cacheLoad = vi.fn(() => { throw new Error("cache hit must not load"); });
      const second = await completeSummariesWithCache([session!], {
        ...opts,
        load: cacheLoad,
      });
      expect(cacheLoad).not.toHaveBeenCalled();
      expect(first[0]).not.toHaveProperty("parseFailureShapes");
      expect(second[0]).not.toHaveProperty("parseFailureShapes");
      const missing = await loadById("claude-code", resolve(cacheDir, "missing.jsonl"));
      expect(missing).toBeNull();
      const ctx = {} as CommandContext;
      for (const summary of [first[0], second[0], missing]) {
        if (summary) observeSession(ctx, summary as Session);
      }
      recordObservedParseFailures(ctx);
      expect(peekQueuedEvents().filter((event) => event.name === "parse_failure")).toHaveLength(0);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-code", "claude-code/clean-multi-tool-2-models.jsonl", "claude-code:malformed_jsonl"],
    ["codex", "codex/clean-session.jsonl", "codex:malformed_jsonl"],
    ["gemini", "gemini/clean-session.jsonl", "gemini:malformed_jsonl"],
  ] as const)("attaches %s torn-line shape on a full load", async (source, fixture, shape) => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-torn-"));
    try {
      const file = resolve(temp, "session.jsonl");
      await writeFile(file, `${readFileSync(resolve(root, "test/fixtures", fixture), "utf8")}\n{torn\n`);
      const session = await loadById(source, file);
      expect(session?.parseFailureShapes).toContain(shape);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each(["input_text", "output_text"] as const)("marks Codex %s with non-string text without changing receipt bytes", async (type) => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-codex-content-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const message = (extra?: unknown) => JSON.stringify({
        timestamp: "2026-09-23T12:00:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [
          { type: "input_text", text: "keep this text" },
          ...(extra === undefined ? [] : [extra]),
        ] },
      });
      await writeFile(file, `${message()}\n`);
      const clean = await loadById("codex", file);
      const cleanReceipt = renderReceipt(await buildReceiptModel(clean!), { color: false });

      await writeFile(file, `${message({ type, text: 42 })}\n`);
      const malformed = await loadById("codex", file);
      expect(malformed?.parseFailureShapes).toEqual(["codex:malformed_jsonl"]);
      expect(malformed?.droppedRecords).toBe(clean?.droppedRecords);
      expect(renderReceipt(await buildReceiptModel(malformed!), { color: false })).toBe(cleanReceipt);

      await writeFile(file, `${message({ type: "input_image", image_url: "data:image/png;base64,AA==" })}\n`);
      const image = await loadById("codex", file);
      expect(image?.parseFailureShapes).toBeUndefined();
      expect(image?.droppedRecords).toBe(clean?.droppedRecords);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("attaches Gemini's shape for a malformed checkpoint entry without changing receipt bytes", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-checkpoint-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const checkpoint = { $set: { messages: [
        { id: "kept", type: "gemini", model: "gemini-2.5-flash", tokens: { input: 10, output: 2 } },
        { type: "gemini", model: "gemini-2.5-flash", tokens: { input: 90 } },
      ] } };
      await writeFile(file, `${JSON.stringify(checkpoint)}\n`);
      const session = await loadById("gemini", file);
      expect(session?.parseFailureShapes).toContain("gemini:malformed_jsonl");
      expect(session?.droppedRecords).toBeUndefined();
      expect(session?.totals.turnCount).toBe(1);
      expect(session?.totals.tokens.total).toBe(12);
      const baseline = { ...session!, parseFailureShapes: undefined };
      expect(renderReceipt(await buildReceiptModel(session!), { color: false }))
        .toBe(renderReceipt(await buildReceiptModel(baseline), { color: false }));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("attaches Gemini's shape for id-less direct messages without changing receipt bytes", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-idless-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const clean = readFileSync(resolve(root, "test/fixtures/gemini/clean-session.jsonl"), "utf8");
      await writeFile(file, clean);
      const baseline = await loadById("gemini", file);
      await writeFile(file, `${clean}\n${JSON.stringify({ type: "gemini", tokens: { input: 90 } })}\n${JSON.stringify({ type: "user", content: "ignored" })}\n`);
      const session = await loadById("gemini", file);
      expect(session?.parseFailureShapes).toContain("gemini:malformed_jsonl");
      expect(session?.droppedRecords).toBeUndefined();
      expect(renderReceipt(await buildReceiptModel(session!), { color: false }))
        .toBe(renderReceipt(await buildReceiptModel(baseline!), { color: false }));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each([[], 42])("attaches Claude's shape for non-object message %j without changing receipt bytes", async (message) => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-message-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const clean = readFileSync(resolve(root, "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl"), "utf8");
      await writeFile(file, clean);
      const baseline = await loadById("claude-code", file);
      await writeFile(file, `${clean}\n${JSON.stringify({ type: "assistant", message })}\n`);
      const session = await loadById("claude-code", file);
      expect(session?.parseFailureShapes).toContain("claude-code:malformed_jsonl");
      expect(session?.droppedRecords).toBeUndefined();
      expect(renderReceipt(await buildReceiptModel(session!), { color: false }))
        .toBe(renderReceipt(await buildReceiptModel(baseline!), { color: false }));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains Claude's session when an assistant content part is null", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-part-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const clean = readFileSync(resolve(root, "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl"), "utf8");
      await writeFile(file, `${clean}\n${JSON.stringify({ type: "assistant", message: { content: [null] } })}\n`);
      const session = await loadById("claude-code", file);
      expect(session?.parseFailureShapes).toContain("claude-code:malformed_jsonl");
      expect(session?.droppedRecords).toBeUndefined();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.skipIf(sqlite === null).each(["{bad", "[]", "42", '"bubble text"'])("treats Cursor's %s bubble as missing", async (value) => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-nonobject-"));
    const dbPath = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const composerId = makeCursorDb({ dbPath });
      process.env.CURSOR_DB_PATH = dbPath;
      const adapter = new CursorAdapter();
      const clean = await adapter.loadSession(composerId);
      const db = new sqlite!.DatabaseSync(dbPath);
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(value, `bubbleId:${composerId}:bubble-0002`);
      db.close();
      const session = await adapter.loadSession(composerId);
      expect(session?.parseFailureShapes).toEqual(["cursor:missing_bubble"]);
      expect(session?.totals.turnCount).toBe(1);
      expect(session?.totals.toolCallCount).toBe(1);
      expect(renderReceipt(await buildReceiptModel(session!), { color: false }))
        .toBe(renderReceipt(await buildReceiptModel({ ...session!, parseFailureShapes: undefined }), { color: false }));
      expect(clean?.totals.toolCallCount).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.skipIf(sqlite === null)("attaches only Cursor's malformed-record shape for an unreferenced malformed bubble", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-unreferenced-"));
    const dbPath = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const composerId = makeCursorDb({ dbPath });
      const db = new sqlite!.DatabaseSync(dbPath);
      db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)")
        .run(`bubbleId:${composerId}:unreferenced`, "{bad");
      db.close();
      process.env.CURSOR_DB_PATH = dbPath;
      const session = await new CursorAdapter().loadSession(composerId);
      expect(session?.parseFailureShapes).toEqual(["cursor:malformed_record"]);
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.skipIf(sqlite === null)("attaches Cursor's malformed-record shape for a bad header", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-header-"));
    const dbPath = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const composerId = makeCursorDb({ dbPath });
      const db = new sqlite!.DatabaseSync(dbPath);
      const key = `composerData:${composerId}`;
      const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key) as { value: string };
      const composer = JSON.parse(row.value) as { fullConversationHeadersOnly: unknown[] };
      composer.fullConversationHeadersOnly.push(null);
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(composer), key);
      db.close();
      process.env.CURSOR_DB_PATH = dbPath;
      const session = await new CursorAdapter().loadSession(composerId);
      expect(session?.parseFailureShapes).toContain("cursor:malformed_record");
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-code", "claude-code/clean-multi-tool-2-models.jsonl", "claude-code:malformed_jsonl"],
    ["codex", "codex/clean-session.jsonl", "codex:malformed_jsonl"],
    ["gemini", "gemini/clean-session.jsonl", "gemini:malformed_jsonl"],
  ] as const)("attaches %s shape for a valid JSON non-object line", async (source, fixture, shape) => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-nonobject-"));
    try {
      const file = resolve(temp, "session.jsonl");
      const transcript = readFileSync(resolve(root, "test/fixtures", fixture), "utf8");
      await writeFile(file, transcript);
      const clean = await loadById(source, file);
      expect(clean).not.toBeNull();
      const cleanReceipt = renderReceipt(await buildReceiptModel(clean!), { color: false });
      for (const value of ["42", "null", "[]", "[1,2]"]) {
        await writeFile(file, `${transcript}\n${value}\n`);
        const session = await loadById(source, file);
        expect(session?.parseFailureShapes).toContain(shape);
        expect(session?.droppedRecords).toBeUndefined();
        const model = await buildReceiptModel(session!);
        expect(model.caveats.some((c) => c.kind === "dropped-transcript-records")).toBe(false);
        expect(renderReceipt(model, { color: false })).toBe(cleanReceipt);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.skipIf(sqlite === null)("attaches Cursor's missing-bubble shape", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-torn-"));
    const dbPath = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const composerId = makeCursorDb({ dbPath });
      const db = new sqlite!.DatabaseSync(dbPath);
      db.prepare("DELETE FROM cursorDiskKV WHERE key = ?").run(`bubbleId:${composerId}:bubble-0002`);
      db.close();
      process.env.CURSOR_DB_PATH = dbPath;
      const session = await new CursorAdapter().loadSession(composerId);
      expect(session?.parseFailureShapes).toContain("cursor:missing_bubble");
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });
});
