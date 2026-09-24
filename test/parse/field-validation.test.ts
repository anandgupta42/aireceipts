import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { CursorAdapter } from "../../src/parse/cursor.js";
import { OpenCodeAdapter } from "../../src/parse/opencode.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";

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
          ((agent === "claude-code" && field === 2) || (agent === "codex" && field === 2)
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
  it.each([
    ["claude-code", { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
      message: { id: "msg_1", model: "claude-opus-4-8", content: [
        { type: "text", text: "answer" }, { type: "tool_use", id: "tool_1", name: "Read", input: {} }],
      usage: { input_tokens: 10, output_tokens: 2 } } }, "usage", "claude-code:malformed_usage"],
    ["gemini", { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
      model: "gemini-2.5-flash", content: "answer", toolCalls: [{ id: "tool_1", name: "read_file" }],
      tokens: { input: 10, output: 2 } }, "tokens", "gemini:malformed_jsonl"],
  ] as const)("retains %s evidence for malformed usage containers", async (agent, clean, field, shape) => {
    const temp = await mkdtemp(resolve(tmpdir(), `aireceipts-${agent}-container-`));
    const file = resolve(temp, "session.jsonl");
    try {
      const without = structuredClone(clean) as Json;
      const owner = agent === "claude-code" ? without.message as Json : without;
      delete owner[field];
      const user = agent === "claude-code"
        ? { type: "user", timestamp: "2026-09-24T11:59:59Z", message: { content: "prompt" } }
        : { id: "user", type: "user", timestamp: "2026-09-24T11:59:59Z", content: "prompt" };
      await writeFile(file, `${JSON.stringify(user)}\n${JSON.stringify(without)}\n`);
      const baseline = (await loadById(agent, file))!;
      let malformedReceipt: string | undefined;
      for (const bad of [42, [], null]) {
        const record = structuredClone(clean) as Json;
        (agent === "claude-code" ? record.message as Json : record)[field] = bad;
        await writeFile(file, `${JSON.stringify(user)}\n${JSON.stringify(record)}\n`);
        const result = (await loadById(agent, file))!;
        expect(result.parseFailureShapes).toContain(shape);
        expect(result.totals.turnCount).toBe(baseline.totals.turnCount);
        expect(result.totals.toolCallCount).toBe(baseline.totals.toolCallCount);
        expect(result.turns.map((turn) => turn.toolCalls.map((call) => call.name)))
          .toEqual(baseline.turns.map((turn) => turn.toolCalls.map((call) => call.name)));
        expect(result.title).toBe(baseline.title);
        expect(result.totals.tokens.total).toBe(0);
        const receipt = await buildReceiptModel(result);
        expect(receipt.totalUsd).toBeNull();
        const bytes = renderReceipt(receipt);
        malformedReceipt ??= bytes;
        expect(bytes).toBe(malformedReceipt);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains Codex message and tool evidence for malformed usage containers", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-codex-container-"));
    const file = resolve(temp, "session.jsonl");
    const records: Json[] = [
      { type: "response_item", payload: { type: "message", role: "user", content: "prompt" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: "answer" } },
      { type: "response_item", payload: { type: "function_call", name: "read_file", call_id: "call_1" } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10 } } } },
    ];
    try {
      const write = async (rows: Json[]) => writeFile(file, `${rows.map(JSON.stringify).join("\n")}\n`);
      const without = structuredClone(records);
      delete ((without[3]!.payload as Json).info as Json).total_token_usage;
      await write(without);
      const baseline = (await loadById("codex", file))!;
      for (const bad of [42, [], null]) {
        const changed = structuredClone(records);
        ((changed[3]!.payload as Json).info as Json).total_token_usage = bad;
        await write(changed);
        const result = (await loadById("codex", file))!;
        expect(result.parseFailureShapes, JSON.stringify(bad)).toContain("codex:malformed_usage");
        expect(result.totals.turnCount).toBe(baseline.totals.turnCount);
        expect(result.totals.toolCallCount).toBe(baseline.totals.toolCallCount);
        expect(result.title).toBe(baseline.title);
        expect(result.turns.map((turn) => turn.toolCalls.map((call) => call.name)))
          .toEqual(baseline.turns.map((turn) => turn.toolCalls.map((call) => call.name)));
        expect((await buildReceiptModel(result)).totalUsd).toBeNull();
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("preserves main's boolean guard outcomes for truthy wrong types", async () => {
    const at = "2026-09-24T12:00:00Z";
    const cases: Array<{ agent: "claude-code" | "codex"; field: string; expected: boolean;
      records: Json[]; set: (records: Json[], value: unknown) => void }> = [
      { agent: "claude-code", field: "isMeta", expected: true,
        records: [{ type: "user", timestamp: at, message: { content: "internal metadata prompt" } }],
        set: (records, value) => { records[0]!.isMeta = value; } },
      { agent: "claude-code", field: "isCompactSummary", expected: false,
        records: [{ type: "user", timestamp: at, message: { content: "summary text" } }],
        set: (records, value) => { records[0]!.isCompactSummary = value; } },
      { agent: "claude-code", field: "isSidechain", expected: false,
        records: [{ type: "user", timestamp: at, message: { content: "prompt" } }],
        set: (records, value) => { records[0]!.isSidechain = value; } },
      { agent: "claude-code", field: "is_error", expected: true,
        records: [
          { type: "assistant", timestamp: at, message: { id: "msg_1", model: "claude-opus-4-8",
            content: [{ type: "tool_use", id: "tool_1", name: "Read", input: {} }] } },
          { type: "user", timestamp: at, message: { content: [
            { type: "tool_result", tool_use_id: "tool_1", content: "failed" }] } },
        ],
        set: (records, value) => { (((records[1]!.message as Json).content as Json[])[0] as Json).is_error = value; } },
      { agent: "codex", field: "success", expected: true,
        records: [
          { type: "response_item", timestamp: at, payload: { type: "function_call", name: "read_file", call_id: "call_1" } },
          { type: "response_item", timestamp: at, payload: { type: "function_call_output", call_id: "call_1", output: "done" } },
        ],
        set: (records, value) => { (records[1]!.payload as Json).success = value; } },
    ];
    const truthyWrongTypes: unknown[] = ["true", 1, [], {}];
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-boolean-guards-"));
    const file = resolve(temp, "session.jsonl");
    const writeRecords = async (records: Json[]) => writeFile(file, `${records.map(JSON.stringify).join("\n")}\n`);
    try {
      for (const scenario of cases) {
        const baselineRecords = structuredClone(scenario.records);
        scenario.set(baselineRecords, scenario.expected);
        await writeRecords(baselineRecords);
        const baseline = (await loadById(scenario.agent, file))!;
        const expectedReceipt = renderReceipt(await buildReceiptModel(baseline));
        await fc.assert(fc.asyncProperty(fc.constantFrom(...truthyWrongTypes), async (bad) => {
          const records = structuredClone(scenario.records);
          scenario.set(records, bad);
          await writeRecords(records);
          const result = (await loadById(scenario.agent, file))!;
          expect(result.parseFailureShapes, scenario.field).toContain(`${scenario.agent}:malformed_jsonl`);
          expect(renderReceipt(await buildReceiptModel(result)), scenario.field).toBe(expectedReceipt);
          expect(result.isSidechain, scenario.field).toBe(baseline.isSidechain);
          expect(result.compactions, scenario.field).toEqual(baseline.compactions);
          expect(result.turns.flatMap((turn) => turn.toolCalls.map((call) => call.status)), scenario.field)
            .toEqual(baseline.turns.flatMap((turn) => turn.toolCalls.map((call) => call.status)));
        }), { numRuns: 16 });
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-code", { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
      message: { id: "msg_1", model: "claude-opus-4-8", content: [{ type: "text", text: "answer" }],
        usage: { input_tokens: 10, output_tokens: 2 } } }, "claude-code:malformed_jsonl",
    (r: Json, bad: unknown) => { (((r.message as Json).content as Json[])[0] as Json).text = bad; }],
    ["codex", { type: "event_msg", timestamp: "2026-09-24T12:00:00Z",
      payload: { type: "token_count", model: "gpt-5.6-sol", name: "unused",
        info: { total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } },
    "codex:malformed_jsonl", (r: Json, bad: unknown) => { (r.payload as Json).name = bad; }],
    ["gemini", { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
      model: "gemini-2.5-flash", content: [{ text: "answer" }], tokens: { input: 10, output: 2 } },
    "gemini:malformed_jsonl", (r: Json, bad: unknown) => { (r.content as Json[])[0]!.text = bad; }],
  ] as const)("preserves %s usage for wrong typed non-usage fields", async (agent, clean, shape, mutate) => {
    const temp = await mkdtemp(resolve(tmpdir(), `aireceipts-${agent}-usage-property-`));
    const file = resolve(temp, "session.jsonl");
    try {
      await writeFile(file, `${JSON.stringify(clean)}\n`);
      const baseline = (await loadById(agent, file))!;
      const cost = (await buildReceiptModel(baseline)).totalUsd;
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes), async (bad) => {
        const record = structuredClone(clean) as Json;
        mutate(record, bad);
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = (await loadById(agent, file))!;
        expect(result.parseFailureShapes).toContain(shape);
        expect(result.totals.tokens).toEqual(baseline.totals.tokens);
        expect((await buildReceiptModel(result)).totalUsd).toBe(cost);
      }), { numRuns: 20 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("keeps Claude output tokens from a malformed usage component", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-usage-gate-"));
    const file = resolve(temp, "session.jsonl");
    try {
      await writeFile(file, `${JSON.stringify({ type: "assistant", timestamp: "2026-06-01T12:00:00Z",
        message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: "bad", output_tokens: 2 } } })}\n`);
      const session = (await loadById("claude-code", file))!;
      expect(session.parseFailureShapes).toContain("claude-code:malformed_usage");
      expect(session.totals.tokens.output).toBe(2);
      const receipt = await buildReceiptModel(session);
      expect(receipt.totalUsd).toBeNull();
      expect(renderReceipt(receipt).replaceAll(" ", "·")).toMatchInlineSnapshot(`
        "-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-
        ····················AIRECEIPTS····················
        ···Claude·Code···Jun·01·2026·12:00:00·UTC···0s····

        pre-edit:·no·named·edit·tool·observed
        ··(share·before·the·first·named·edit·tool)

        (thinking/reply)...................2·tok··(1·turn)

        caveat:·session·span·is·non-positive·but·carries·token·usage
        caveat:·1·transcript·record·unreadable·or·malformed·—·omitted·components·may·make·total·incomplete
        --------------------------------------------------
        TOTAL........................................2·tok
        no·price·table·matched
        -·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-
        ················npx·aireceipts-cli················
        ·········github.com/anandgupta42/receipts·········
        -·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-·-"
      `);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("keeps Gemini usage when one content element is malformed", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-part-gate-"));
    const file = resolve(temp, "session.jsonl");
    try {
      const clean = { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
        model: "gemini-2.5-flash", content: [{ text: "answer" }], tokens: { input: 10, output: 2 } };
      await writeFile(file, `${JSON.stringify(clean)}\n`);
      const baseline = (await loadById("gemini", file))!;
      const mutated = structuredClone(clean);
      mutated.content.push({ text: 42 as unknown as string });
      await writeFile(file, `${JSON.stringify(mutated)}\n`);
      const result = (await loadById("gemini", file))!;
      expect(result.parseFailureShapes).toContain("gemini:malformed_jsonl");
      expect(result.totals.tokens).toEqual(baseline.totals.tokens);
      expect(renderReceipt(await buildReceiptModel(result))).toBe(renderReceipt(await buildReceiptModel(baseline)));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains valid Gemini usage components and disables pricing for a bad component", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-usage-parts-"));
    const file = resolve(temp, "session.jsonl");
    try {
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes.slice(1)), async (bad) => {
        await writeFile(file, `${JSON.stringify({ id: "answer", type: "gemini", model: "gemini-2.5-flash",
          tokens: { input: bad, output: 2 } })}\n`);
        const result = (await loadById("gemini", file))!;
        expect(result.parseFailureShapes).toContain("gemini:malformed_jsonl");
        expect(result.totals.tokens.output).toBe(2);
        expect((await buildReceiptModel(result)).totalUsd).toBeNull();
      }), { numRuns: 20 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("uses Codex's existing fail-closed usage mapping for a bad component", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-codex-usage-parts-"));
    const file = resolve(temp, "session.jsonl");
    try {
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes.slice(1)), async (bad) => {
        await writeFile(file, `${JSON.stringify({ type: "event_msg", payload: { type: "token_count",
          model: "gpt-5.6-sol", info: { total_token_usage: { input_tokens: bad, output_tokens: 2 },
            last_token_usage: { input_tokens: bad, output_tokens: 2 } } } })}\n`);
        const result = (await loadById("codex", file))!;
        expect(result.parseFailureShapes).toContain("codex:malformed_usage");
        expect(result.totals.tokens.total).toBe(0);
      }), { numRuns: 20 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
  it("Claude Code rejects wrong typed record, message, block and usage fields", async () => {
    await jsonlProperty("claude-code", {
      type: "assistant", message: { id: "msg_1", model: "claude-opus-4-8",
        content: [{ type: "text", text: "answer" }], usage: { input_tokens: 10, output_tokens: 2 } },
    }, "claude-code:malformed_jsonl", [
      (r, bad) => { r.type = bad; },
    ]);
    await jsonlProperty("claude-code", { type: "user", message: { content: [{ type: "text", text: "prompt" }] } },
      "claude-code:malformed_jsonl", [
        (r, bad) => { ((r.message as Json).content as Json[])[0]!.text = bad; },
      ]);
  });

  it("keeps independent Claude usage when a content sub-field changes", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-content-fields-"));
    const file = resolve(temp, "session.jsonl");
    const clean = { type: "assistant", timestamp: "2026-09-24T12:00:00.000Z",
      message: { id: "msg_1", model: "claude-opus-4-8",
        content: [{ type: "text", text: "answer" }], usage: { input_tokens: 10, output_tokens: 2 } } };
    try {
      await writeFile(file, `${JSON.stringify(clean)}\n`);
      const baseline = (await loadById("claude-code", file))!;
      const baselineModel = await buildReceiptModel(baseline);
      expect(baselineModel.totalUsd).not.toBeNull();
      const baselineReceipt = renderReceipt(baselineModel);
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes), async (bad) => {
        const record = structuredClone(clean);
        (record.message.content[0] as Json).text = bad;
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = (await loadById("claude-code", file))!;
        expect(result.parseFailureShapes).toContain("claude-code:malformed_jsonl");
        expect(result.totals.tokens).toEqual(baseline.totals.tokens);
        expect((await buildReceiptModel(result)).totalUsd).toBe(baselineModel.totalUsd);
        expect(renderReceipt(await buildReceiptModel(result))).toBe(baselineReceipt);
      }), { numRuns: 20 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rebuilds Gemini checkpoints around malformed entries", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-checkpoint-fields-"));
    const file = resolve(temp, "session.jsonl");
    const message = (id: string, input: number) => ({ id, type: "gemini", model: "gemini-2.5-flash",
      content: "answer", tokens: { input, output: 2 } });
    const earlier = message("old", 100);
    const valid = [message("new-1", 10), message("new-2", 20)];
    try {
      await writeFile(file, [earlier, { $set: { messages: valid } }].map(JSON.stringify).join("\n"));
      const baseline = (await loadById("gemini", file))!;
      const baselineReceipt = renderReceipt(await buildReceiptModel(baseline));
      for (const bad of [42, { id: "bad", type: "gemini", tokens: "x" }]) {
        await writeFile(file, [earlier, { $set: { messages: [valid[0], bad, valid[1]] } }].map(JSON.stringify).join("\n"));
        const result = (await loadById("gemini", file))!;
        expect(result.parseFailureShapes).toContain("gemini:malformed_jsonl");
        expect(result.totals.tokens).toEqual(baseline.totals.tokens);
        expect(result.turns).toHaveLength(typeof bad === "number" ? 2 : 3);
        if (typeof bad === "number") {
          expect(renderReceipt(await buildReceiptModel(result))).toBe(baselineReceipt);
        } else {
          expect((await buildReceiptModel(result)).totalUsd).toBeNull();
        }
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
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
      expect(result?.turns).toHaveLength(1);
      expect(result?.totals.tokens.total).toBe(120);
      expect((await buildReceiptModel(result!)).totalUsd).toBeNull();
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
    ]);
  });

  it("ignores a Gemini vendor usageMalformed field when pricing valid usage", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-sentinel-"));
    const file = resolve(temp, "session.jsonl");
    const clean = { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
      model: "gemini-2.5-flash", tokens: { input: 10, output: 2 } };
    try {
      await writeFile(file, `${JSON.stringify(clean)}\n`);
      const baseline = (await loadById("gemini", file))!;
      const expected = renderReceipt(await buildReceiptModel(baseline));
      expect((await buildReceiptModel(baseline)).totalUsd).not.toBeNull();
      await writeFile(file, `${JSON.stringify({ ...clean, usageMalformed: true })}\n`);
      const result = (await loadById("gemini", file))!;
      expect(result.parseFailureShapes).toBeUndefined();
      expect(renderReceipt(await buildReceiptModel(result))).toBe(expected);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains common Claude metadata from unknown record types", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-claude-unknown-metadata-"));
    const file = resolve(temp, "session.jsonl");
    try {
      await writeFile(file, [
        { type: "future_record", timestamp: "2026-09-24T11:59:00Z", cwd: "/work/project",
          gitBranch: "feature", isSidechain: true, message: 42 },
        { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
          message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 2 } } },
      ].map(JSON.stringify).join("\n"));
      const result = (await loadById("claude-code", file))!;
      expect(result.cwd).toBe("/work/project");
      expect(result.gitBranch).toBe("feature");
      expect(result.isSidechain).toBe(true);
      expect(result.startedAt).toBe(Date.parse("2026-09-24T11:59:00Z"));
      expect(result.totals.durationMs).toBe(60_000);
      expect(result.parseFailureShapes).toBeUndefined();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains Gemini title, time and usage around malformed identity fields", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-gemini-identity-"));
    const file = resolve(temp, "session.jsonl");
    try {
      const user = { type: "user", timestamp: "2026-09-24T11:59:00Z", content: "prompt" };
      const answer = { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
        model: 42, tokens: { input: 10, output: 2 } };
      await writeFile(file, `${JSON.stringify(user)}\n`);
      const idless = (await loadById("gemini", file))!;
      expect(idless.parseFailureShapes).toContain("gemini:malformed_jsonl");
      expect(idless.title).toBe("prompt");
      expect(idless.startedAt).toBe(Date.parse(user.timestamp));
      await writeFile(file, `${JSON.stringify(user)}\n${JSON.stringify(answer)}\n`);
      const result = (await loadById("gemini", file))!;
      expect(result.parseFailureShapes).toContain("gemini:malformed_jsonl");
      expect(result.title).toBe("prompt");
      expect(result.startedAt).toBe(Date.parse(user.timestamp));
      expect(result.totals.durationMs).toBe(60_000);
      expect(result.totals.tokens.total).toBe(12);
      expect(result.totals.turnCount).toBe(1);
      expect((await buildReceiptModel(result)).totalUsd).toBeNull();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-code", { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
      message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 2 } } },
    (record: Json, bad: unknown) => { (record.message as Json).id = bad; }, 12],
    ["claude-code", { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
      message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 2 } } },
    (record: Json, bad: unknown) => { (record.message as Json).model = bad; }, 12],
    ["codex", { type: "event_msg", timestamp: "2026-09-24T12:00:00Z",
      payload: { type: "token_count", model: "gpt-5.6-sol", info: {
        total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } },
    (record: Json, bad: unknown) => { (record.payload as Json).model = bad; }, 12],
    ["gemini", { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
      model: "gemini-2.5-flash", tokens: { input: 10, output: 2 } },
    (record: Json, bad: unknown) => { record.model = bad; }, 12],
  ] as const)("retains %s token evidence for a wrong typed identity", async (agent, clean, mutate, expectedTokens) => {
    const temp = await mkdtemp(resolve(tmpdir(), `aireceipts-${agent}-identity-fields-`));
    const file = resolve(temp, "session.jsonl");
    try {
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes), async (bad) => {
        const record = structuredClone(clean) as Json;
        mutate(record, bad);
        await writeFile(file, `${JSON.stringify(record)}\n`);
        const result = (await loadById(agent, file))!;
        expect(result.parseFailureShapes).toContain(`${agent}:malformed_jsonl`);
        expect(result.totals.tokens.total).toBe(expectedTokens);
        expect(result.totals.turnCount).toBe(1);
        expect((await buildReceiptModel(result)).totalUsd).toBeNull();
      }), { numRuns: 20 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-code", { type: "assistant", timestamp: "2026-09-24T12:00:00Z",
      message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 2 } } }],
    ["codex", { type: "event_msg", timestamp: "2026-09-24T12:00:00Z",
      payload: { type: "token_count", model: "gpt-5.6-sol", info: {
        total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } }],
    ["gemini", { id: "answer", type: "gemini", timestamp: "2026-09-24T12:00:00Z",
      model: "gemini-2.5-flash", tokens: { input: 10, output: 2 } }],
  ] as const)("ignores unknown %s JSONL fields in receipt bytes", async (agent, clean) => {
    const temp = await mkdtemp(resolve(tmpdir(), `aireceipts-${agent}-extra-fields-`));
    const file = resolve(temp, "session.jsonl");
    try {
      await writeFile(file, `${JSON.stringify(clean)}\n`);
      const baseline = renderReceipt(await buildReceiptModel((await loadById(agent, file))!));
      await fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => {
        for (const name of ["usageMalformed", "malformedRecord", "parseFailureShapes", "futureField"]) {
          const record = { ...clean, [name]: value };
          await writeFile(file, `${JSON.stringify(record)}\n`);
          const result = (await loadById(agent, file))!;
          expect(renderReceipt(await buildReceiptModel(result))).toBe(baseline);
        }
      }), { numRuns: 10 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
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
  it("retains Cursor and opencode evidence for malformed optional identity", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-sqlite-identity-"));
    const cursorFile = resolve(temp, "state.vscdb");
    const openFile = resolve(temp, "session.db");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const id = makeCursorDb({ dbPath: cursorFile });
      process.env.CURSOR_DB_PATH = cursorFile;
      const cursor = new CursorAdapter();
      const cursorBaseline = (await cursor.loadSession(id))!;
      const cursorDb = new sqlite!.DatabaseSync(cursorFile);
      const composerKey = `composerData:${id}`;
      const composer = JSON.parse((cursorDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
        .get(composerKey) as { value: string }).value) as Json;
      ((composer.fullConversationHeadersOnly as Json[])[1] as Json).type = "wrong";
      cursorDb.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?")
        .run(JSON.stringify(composer), composerKey);
      const cursorResult = (await cursor.loadSession(id))!;
      expect(cursorResult.parseFailureShapes).toContain("cursor:malformed_record");
      expect(cursorResult.totals.tokens).toEqual(cursorBaseline.totals.tokens);
      expect(cursorResult.totals.turnCount).toBe(cursorBaseline.totals.turnCount);
      cursorDb.close();

      await copyFile(resolve("test/fixtures/opencode/clean-multi-vendor.db"), openFile);
      const open = new OpenCodeAdapter({ dbPath: openFile });
      const openBaseline = (await open.loadSession(openFile))!;
      const openDb = new sqlite!.DatabaseSync(openFile);
      const key = "msg_assistant_1";
      const message = JSON.parse((openDb.prepare("SELECT data FROM session_message WHERE id = ?")
        .get(key) as { data: string }).data) as Json;
      message.model = 42;
      openDb.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(message), key);
      const openResult = (await open.loadSession(openFile))!;
      expect(openResult.parseFailureShapes).toContain("opencode:malformed_record");
      expect(openResult.totals.tokens).toEqual(openBaseline.totals.tokens);
      expect(openResult.totals.turnCount).toBe(openBaseline.totals.turnCount);
      openDb.close();
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("ignores unknown Cursor and opencode fields in receipt bytes", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-sqlite-extra-fields-"));
    const cursorFile = resolve(temp, "state.vscdb");
    const openFile = resolve(temp, "session.db");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const id = makeCursorDb({ dbPath: cursorFile });
      process.env.CURSOR_DB_PATH = cursorFile;
      const cursor = new CursorAdapter();
      await copyFile(resolve("test/fixtures/opencode/clean-multi-vendor.db"), openFile);
      const open = new OpenCodeAdapter({ dbPath: openFile });
      for (const scenario of [
        { dbPath: cursorFile, table: "cursorDiskKV", column: "value", keyColumn: "key",
          key: `composerData:${id}`, load: () => cursor.loadSession(id) },
        { dbPath: openFile, table: "session_message", column: "data", keyColumn: "id",
          key: "msg_assistant_1", load: () => open.loadSession(openFile) },
      ]) {
        const db = new sqlite!.DatabaseSync(scenario.dbPath);
        const original = JSON.parse((db.prepare(`SELECT ${scenario.column} FROM ${scenario.table} WHERE ${scenario.keyColumn} = ?`)
          .get(scenario.key) as Record<string, string>)[scenario.column]!) as Json;
        const baseline = renderReceipt(await buildReceiptModel((await scenario.load())!));
        await fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => {
          for (const name of ["usageMalformed", "malformedRecord", "parseFailureShapes", "futureField"]) {
            db.prepare(`UPDATE ${scenario.table} SET ${scenario.column} = ? WHERE ${scenario.keyColumn} = ?`)
              .run(JSON.stringify({ ...original, [name]: value }), scenario.key);
            expect(renderReceipt(await buildReceiptModel((await scenario.load())!))).toBe(baseline);
          }
        }), { numRuns: 10 });
        db.close();
      }
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains Cursor turns and tools for malformed tokenCount containers", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-cursor-container-"));
    const file = resolve(temp, "state.vscdb");
    const previous = process.env.CURSOR_DB_PATH;
    try {
      const id = makeCursorDb({ dbPath: file });
      process.env.CURSOR_DB_PATH = file;
      const adapter = new CursorAdapter();
      const db = new sqlite!.DatabaseSync(file);
      const key = `composerData:${id}`;
      const original = JSON.parse((db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key) as { value: string }).value) as Json;
      const without = structuredClone(original);
      delete without.tokenCount;
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(without), key);
      const baseline = (await adapter.loadSession(id))!;
      for (const bad of ["42", [], false, null]) {
        const changed = structuredClone(original);
        changed.tokenCount = bad;
        db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(changed), key);
        const result = (await adapter.loadSession(id))!;
        expect(result.parseFailureShapes).toContain("cursor:malformed_record");
        expect(result.totals.turnCount).toBe(baseline.totals.turnCount);
        expect(result.totals.toolCallCount).toBe(baseline.totals.toolCallCount);
        expect(result.title).toBe(baseline.title);
        expect(result.turns.map((turn) => turn.toolCalls.map((call) => call.name)))
          .toEqual(baseline.turns.map((turn) => turn.toolCalls.map((call) => call.name)));
        expect(result.totals.tokens.total).toBe(0);
        expect((await buildReceiptModel(result)).totalUsd).toBeNull();
      }
      const scalar = structuredClone(original);
      scalar.tokenCount = 42;
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(scalar), key);
      const scalarResult = (await adapter.loadSession(id))!;
      expect(scalarResult.parseFailureShapes).toBeUndefined();
      expect(scalarResult.totals.tokens.total).toBe(0);
      expect(renderReceipt(await buildReceiptModel(scalarResult)))
        .toBe(renderReceipt(await buildReceiptModel(baseline)));
      db.close();
    } finally {
      if (previous === undefined) delete process.env.CURSOR_DB_PATH;
      else process.env.CURSOR_DB_PATH = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retains opencode turns and tools for malformed tokens containers", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-opencode-container-"));
    const file = resolve(temp, "session.db");
    try {
      await copyFile(resolve("test/fixtures/opencode/clean-multi-vendor.db"), file);
      const adapter = new OpenCodeAdapter({ dbPath: file });
      const db = new sqlite!.DatabaseSync(file);
      const originals = ["msg_assistant_1", "msg_assistant_2"].map((key) => ({ key,
        data: JSON.parse((db.prepare("SELECT data FROM session_message WHERE id = ?").get(key) as { data: string }).data) as Json }));
      for (const { key, data } of originals) {
        const without = structuredClone(data);
        delete without.tokens;
        db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(without), key);
      }
      const baseline = (await adapter.loadSession(file))!;
      for (const bad of [42, [], null]) {
        for (const { key, data } of originals) {
          const changed = structuredClone(data);
          changed.tokens = bad;
          db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(changed), key);
        }
        const result = (await adapter.loadSession(file))!;
        expect(result.parseFailureShapes).toContain("opencode:malformed_record");
        expect(result.totals.turnCount).toBe(baseline.totals.turnCount);
        expect(result.totals.toolCallCount).toBe(baseline.totals.toolCallCount);
        expect(result.title).toBe(baseline.title);
        expect(result.turns.map((turn) => turn.toolCalls.map((call) => call.name)))
          .toEqual(baseline.turns.map((turn) => turn.toolCalls.map((call) => call.name)));
        expect(result.turns.map((turn) => turn.usage?.total)).toEqual([0, 0]);
        expect(result.turns.map((turn) => turn.pricingUnits)).toEqual([[], []]);
        expect((await buildReceiptModel(result)).totalUsd).toBeNull();
      }
      for (const { key, data } of originals) {
        const changed = structuredClone(data);
        delete changed.tokens;
        changed.role = 42;
        db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(changed), key);
      }
      const malformedRole = (await adapter.loadSession(file))!;
      expect(malformedRole.parseFailureShapes).toContain("opencode:malformed_record");
      expect(malformedRole.totals.turnCount).toBe(baseline.totals.turnCount);
      expect(malformedRole.totals.toolCallCount).toBe(baseline.totals.toolCallCount);
      db.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

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
      const draftId = "00000000-0000-4000-8000-000000000001";
      db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)")
        .run(`composerData:${draftId}`, JSON.stringify({ name: "Untitled", createdAt: Date.now() }));
      expect((await adapter.listSessions()).map((summary) => summary.id)).not.toContain(draftId);
      expect(await adapter.loadSession(draftId)).toBeNull();
      const composerKey = `composerData:${id}`;
      const composer = JSON.parse((db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(composerKey) as { value: string }).value) as Json;
      composer.tokenCount = "x";
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(composer), composerKey);
      expect((await adapter.listSessions()).map((summary) => summary.id)).toContain(id);
      const malformedComposer = await adapter.loadSession(id);
      expect(malformedComposer?.parseFailureShapes).toContain("cursor:malformed_record");
      expect(malformedComposer?.turns).toEqual(clean?.turns);
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes.slice(1)), async (bad) => {
        composer.tokenCount = { inputTokens: 1900, outputTokens: bad };
        db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(composer), composerKey);
        const result = (await adapter.loadSession(id))!;
        expect(result.parseFailureShapes).toContain("cursor:malformed_record");
        expect(result.totals.tokens.input).toBe(1900);
        expect(result.totals.tokens.output).toBe(0);
      }), { numRuns: 16 });
      composer.tokenCount = { inputTokens: 1900, outputTokens: 268 };
      (composer.fullConversationHeadersOnly as Json[])[0]!.type = "x";
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(composer), composerKey);
      expect((await adapter.listSessions()).map((summary) => summary.id)).toContain(id);
      const malformedHeader = (await adapter.loadSession(id))!;
      expect(malformedHeader.parseFailureShapes).toContain("cursor:malformed_record");
      expect(malformedHeader.totals.tokens).toEqual(clean?.totals.tokens);
      composer.fullConversationHeadersOnly = "damaged";
      db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(JSON.stringify(composer), composerKey);
      expect((await adapter.listSessions()).map((summary) => summary.id)).toContain(id);
      const damagedHeaders = (await adapter.loadSession(id))!;
      expect(damagedHeaders.parseFailureShapes).toContain("cursor:malformed_record");
      expect(damagedHeaders.totals.tokens).toEqual(clean?.totals.tokens);
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
        expect(result?.totals.tokens).toEqual(clean?.totals.tokens);
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

  it("opencode discards only wrong typed current tool parts", async () => {
    const temp = await mkdtemp(resolve(tmpdir(), "aireceipts-opencode-fields-"));
    const file = resolve(temp, "session.db");
    try {
      await copyFile(resolve("test/fixtures/opencode/clean-multi-vendor.db"), file);
      const adapter = new OpenCodeAdapter({ dbPath: file });
      const clean = await adapter.loadSession(file);
      const db = new sqlite!.DatabaseSync(file);
      const key = "msg_assistant_1";
      const original = JSON.parse((db.prepare("SELECT data FROM session_message WHERE id = ?").get(key) as { data: string }).data) as Json;
      const withoutPart = structuredClone(original);
      withoutPart.content = [];
      db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(withoutPart), key);
      const baseline = (await adapter.loadSession(file))!;
      const baselineReceipt = renderReceipt(await buildReceiptModel(baseline));
      const checkPartField = async (field: "name" | "tool" | "status", bad: unknown) => {
        const message = structuredClone(original);
        const part = (message.content as Json[])[0]!;
        if (field === "status") (part.state as Json).status = bad;
        else part[field] = bad;
        db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(message), key);
        const result = await adapter.loadSession(file);
        expect(result?.parseFailureShapes).toContain("opencode:malformed_record");
        expect(result?.turns.length).toBe(clean?.turns.length);
        expect(result?.totals.tokens).toEqual(baseline.totals.tokens);
        expect(renderReceipt(await buildReceiptModel(result!))).toBe(baselineReceipt);
        expect(result?.droppedRecords).toBe(clean?.droppedRecords);
      };
      await checkPartField("name", 42);
      await fc.assert(fc.asyncProperty(fc.constantFrom("name", "tool", "status"), fc.constantFrom(...wrongTypes), checkPartField), { numRuns: 48 });
      await fc.assert(fc.asyncProperty(fc.constantFrom(...wrongTypes.slice(1)), async (bad) => {
        const message = structuredClone(original);
        (message.tokens as Json).input = bad;
        db.prepare("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify(message), key);
        const result = (await adapter.loadSession(file))!;
        expect(result.parseFailureShapes).toContain("opencode:malformed_record");
        expect(result.turns[0]?.usage?.output).toBe(350);
        expect(result.turns[0]?.pricingUnits).toEqual([]);
      }), { numRuns: 16 });
      db.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
