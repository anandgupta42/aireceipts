import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { CursorAdapter } from "../../src/parse/cursor.js";
import { OpenCodeAdapter } from "../../src/parse/opencode.js";

const wrongTypes: unknown[] = [42, [], {}, null, false];
type Json = Record<string, unknown>;

async function jsonlProperty(
  agent: "claude-code" | "codex" | "gemini",
  clean: Json,
  shape: string,
  mutations: Array<(record: Json, bad: unknown) => void>,
): Promise<void> {
  const temp = await mkdtemp(resolve(tmpdir(), `aireceipts-${agent}-fields-`));
  const file = resolve(temp, "session.jsonl");
  try {
    await writeFile(file, `${JSON.stringify(clean)}\n`);
    const baseline = await loadById(agent, file);
    expect(baseline).not.toBeNull();
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: mutations.length - 1 }),
      fc.integer({ min: 0, max: wrongTypes.length - 1 }),
      async (field, wrong) => {
        const record = structuredClone(clean);
        if (typeof wrongTypes[wrong] === "number" &&
          ((agent === "claude-code" && field === 3) || (agent === "codex" && field === 2)
            || (agent === "gemini" && field === 4))) return;
        if (agent === "codex" && field === 1 && wrong === 2) return;
        mutations[field]!(record, wrongTypes[wrong]);
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = await loadById(agent, file);
        expect(result?.parseFailureShapes).toContain(shape);
        expect(result?.droppedRecords).toBe(baseline?.droppedRecords);
        expect(result?.turns).toHaveLength(0);
        expect(result?.totals.tokens.total).toBe(0);
      },
    ), { numRuns: mutations.length * wrongTypes.length });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

describe("known transcript field types", () => {
  it("Claude Code rejects wrong typed record, message, block and usage fields", async () => {
    await jsonlProperty("claude-code", {
      type: "assistant", message: { id: "msg_1", model: "claude-opus-4-8",
        content: [{ type: "text", text: "answer" }], usage: { input_tokens: 10, output_tokens: 2 } },
    }, "claude-code:malformed_jsonl", [
      (r, bad) => { r.type = bad; },
      (r, bad) => { (r.message as Json).model = bad; },
      (r, bad) => { ((r.message as Json).content as Json[])[0]!.text = bad; },
      (r, bad) => { ((r.message as Json).usage as Json).input_tokens = bad; },
    ]);
    await jsonlProperty("claude-code", { type: "user", message: { content: [{ type: "text", text: "prompt" }] } },
      "claude-code:malformed_jsonl", [
        (r, bad) => { ((r.message as Json).content as Json[])[0]!.text = bad; },
      ]);
  });

  it("Codex rejects wrong typed model before attributing usage", async () => {
    await jsonlProperty("codex", { type: "event_msg", payload: { type: "token_count", model: "gpt-5.6-sol",
      info: { total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } },
    "codex:malformed_jsonl", [
      (r, bad) => { (r.payload as Json).model = bad; },
      (r, bad) => { ((r.payload as Json).info as Json).total_token_usage = bad; },
      (r, bad) => { (((r.payload as Json).info as Json).last_token_usage as Json).input_tokens = bad; },
    ]);
  });

  it("Claude Code rejects numeric record type and numeric user text", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-direct-fields-"));
    const file = resolve(temp, "session.jsonl");
    try {
      for (const record of [
        { type: 42, message: { content: "prompt" } },
        { type: "user", message: { content: [{ type: "text", text: 42 }] } },
      ]) {
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = await loadById("claude-code", file);
        expect(result?.parseFailureShapes).toContain("claude-code:malformed_jsonl");
        expect(result?.droppedRecords).toBeUndefined();
        expect(result?.turns).toHaveLength(0);
        expect(result?.title).toBeUndefined();
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("Codex does not charge bad-model usage to the preceding model", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-codex-stale-model-"));
    const file = resolve(temp, "session.jsonl");
    try {
      await writeFile(file, [
        { type: "turn_context", payload: { model: "gpt-5.6-sol" } },
        { type: "event_msg", payload: { type: "token_count", model: 42,
          info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
            last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } },
      ].map((record) => JSON.stringify(record)).join("\n"));
      const result = await loadById("codex", file);
      expect(result?.parseFailureShapes).toContain("codex:malformed_jsonl");
      expect(result?.droppedRecords).toBeUndefined();
      expect(result?.turns).toHaveLength(0);
      expect(result?.totals.tokens.total).toBe(0);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("Gemini rejects wrong typed message, part, tool and usage fields", async () => {
    await jsonlProperty("gemini", { id: "answer", type: "gemini", model: "gemini-2.5-flash",
      content: [{ text: "answer" }], tokens: { input: 10, output: 2 },
      toolCalls: [{ id: "tool_1", name: "read_file", status: "success" }] },
    "gemini:malformed_jsonl", [
      (r, bad) => { r.type = bad; },
      (r, bad) => { r.model = bad; },
      (r, bad) => { (r.content as Json[])[0]!.text = bad; },
      (r, bad) => { (r.toolCalls as Json[])[0]!.name = bad; },
      (r, bad) => { (r.tokens as Json).input = bad; },
    ]);
  });

  it("ignores unknown string discriminators without a failure shape", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-unknown-types-"));
    const file = resolve(temp, "session.jsonl");
    try {
      for (const [agent, record] of [
        ["claude-code", { type: "future_record", message: { model: 42 } }],
        ["codex", { type: "response_item", payload: { type: "future_item", model: 42 } }],
        ["gemini", { type: "future_message", model: 42 }],
      ] as const) {
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = await loadById(agent, file);
        expect(result?.parseFailureShapes, agent).toBeUndefined();
        expect(result?.droppedRecords, agent).toBeUndefined();
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

const sqlite = await import("node:sqlite").catch(() => null);

describe.skipIf(sqlite === null)("SQLite adapter field types", () => {
  it("Cursor rejects non-object composers and wrong typed tool fields", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-fields-"));
    const file = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const id = makeCursorDb({ dbPath: file });
      process.env.CURSOR_DB_PATH = file;
      const adapter = new CursorAdapter();
      const clean = await adapter.loadSession(id);
      const db = new sqlite!.DatabaseSync(file);
      const composerKey = `composerData:${id}`;
      for (const value of ["42", "[]", "false", '"text"']) {
        db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(value, composerKey);
        expect(await adapter.loadSession(id)).toBeNull();
      }
      // Restore the valid composer from a fresh fixture snapshot.
      db.close();
      await rm(file);
      makeCursorDb({ dbPath: file });
      const bubbleKey = `bubbleId:${id}:bubble-0002`;
      const bubbleDb = new sqlite!.DatabaseSync(file);
      const baseline = (bubbleDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(bubbleKey) as { value: string }).value;
      const checkToolField = async (field: "name" | "status", bad: unknown) => {
        const bubble = JSON.parse(baseline) as Json;
        (bubble.toolFormerData as Json)[field] = bad;
        bubbleDb.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(bubble), bubbleKey);
        const result = await adapter.loadSession(id);
        expect(result?.parseFailureShapes).toContain("cursor:malformed_record");
        expect(result?.totals.toolCallCount).toBe((clean?.totals.toolCallCount ?? 0) - 1);
      };
      await checkToolField("name", 42);
      await checkToolField("status", 42);
      await fc.assert(fc.asyncProperty(fc.constantFrom("name", "status"), fc.constantFrom(...wrongTypes), checkToolField), { numRuns: 24 });
      bubbleDb.close();
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("opencode rejects wrong typed current tool parts", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-opencode-fields-"));
    const file = resolve(temp, "session.db");
    try {
      await copyFile(resolve("test/fixtures/opencode/clean-multi-vendor.db"), file);
      const adapter = new OpenCodeAdapter({ dbPath: file });
      const clean = await adapter.loadSession(file);
      const db = new sqlite!.DatabaseSync(file);
      const key = "msg_assistant_1";
      const original = JSON.parse((db.prepare("SELECT data FROM session_message WHERE id = ?").get(key) as { data: string }).data) as Json;
      const checkPartField = async (field: "name" | "tool" | "status", bad: unknown) => {
        const message = structuredClone(original);
        const part = (message.content as Json[])[0]!;
        if (field === "status") (part.state as Json).status = bad;
        else part[field] = bad;
        db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(message), key);
        const result = await adapter.loadSession(file);
        expect(result?.parseFailureShapes).toContain("opencode:malformed_record");
        expect(result?.turns.length).toBe((clean?.turns.length ?? 0) - 1);
        expect(result?.droppedRecords).toBe(clean?.droppedRecords);
      };
      await checkPartField("name", 42);
      await fc.assert(fc.asyncProperty(fc.constantFrom("name", "tool", "status"), fc.constantFrom(...wrongTypes), checkPartField), { numRuns: 48 });
      db.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
