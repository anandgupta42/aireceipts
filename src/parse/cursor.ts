import { homedir } from "node:os";
import { join } from "node:path";
import { openReadOnly } from "./sqlite.js";
import type { AgentSource, Session, SessionAdapter, SessionSummary, ToolCall, Turn } from "./types.js";
import { emptyUsage, pathExists, truncate, sanitizeText } from "./util.js";
import { plainObject, validFields, type FieldTable } from "./validate.js";

/**
 * Cursor stores chat history in SQLite (`globalStorage/state.vscdb`, table
 * `cursorDiskKV`):
 *   composerData:<id>            → one session (name, timestamps, ordered
 *                                   headers listing each bubble's id + role)
 *   bubbleId:<composerId>:<id>   → one message (type 1=user/2=assistant, text,
 *                                   toolFormerData = a tool call)
 *
 * DEGRADED (R1): Cursor's transcript has no per-turn model id, no cache/usage
 * breakdown, and no real per-message timestamp — only session-level
 * createdAt/lastUpdatedAt. We never synthesize timestamps or per-turn usage
 * (I2, I3: no fabricated precision, no fabricated dollars); every session
 * from this adapter is flagged `unpriceable: true`, and `src/pricing/**` must
 * skip flagged sessions.
 */

function defaultDbPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData/Roaming");
    return join(appData, "Cursor/User/globalStorage/state.vscdb");
  }
  return join(home, ".config/Cursor/User/globalStorage/state.vscdb");
}

// Resolved at call time (not module load) so `CURSOR_DB_PATH` overrides (tests) are honored.
function dbPath(): string {
  return process.env.CURSOR_DB_PATH || defaultDbPath();
}

// composerIds are UUID-ish — validate before inlining into a LIKE/WHERE clause.
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

interface ComposerData {
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  fullConversationHeadersOnly?: { bubbleId: string; type: number }[];
  tokenCount?: { inputTokens?: number; outputTokens?: number } | number;
}

interface ToolFormerData {
  /** newer Cursor: a string tool name; older: a numeric enum */
  tool?: string | number;
  name?: string;
  rawArgs?: unknown;
  result?: unknown;
  status?: string;
}

// Numeric tool-id enum used by older Cursor versions.
const TOOL_ENUM: Record<number, string> = {
  3: "grep_search",
  5: "read_file",
  6: "list_dir",
  7: "edit_file",
  8: "file_search",
  9: "codebase_search",
  15: "run_terminal_cmd",
};

function toolName(t: ToolFormerData): string {
  if (typeof t.name === "string" && t.name) {
    return t.name;
  }
  if (typeof t.tool === "string" && t.tool) {
    return t.tool;
  }
  if (typeof t.tool === "number") {
    return TOOL_ENUM[t.tool] ?? `tool_${t.tool}`;
  }
  return "tool";
}

interface Bubble {
  type?: number;
  toolFormerData?: ToolFormerData;
}

const toolFormerFields: FieldTable = {
  tool: { type: "stringOrNumber" }, name: { type: "string" }, rawArgs: { type: "any" },
  result: { type: "any" }, status: { type: "string" },
};
const headerFields: FieldTable = { bubbleId: { type: "string", required: true }, type: { type: "number" } };
const bubbleFields: FieldTable = {
  type: { type: "number" }, toolFormerData: { type: "object", fields: toolFormerFields },
};
const composerFields: FieldTable = {
  name: { type: "string" }, createdAt: { type: "number" }, lastUpdatedAt: { type: "number" },
  fullConversationHeadersOnly: { type: "array", elements: { type: "object", fields: headerFields } },
  tokenCount: { type: "numberOrObject", fields: {
    inputTokens: { type: "integer" }, outputTokens: { type: "integer" },
  } },
};

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const CURSOR_SHELL_TOOLS = new Set(["run_terminal_cmd", "terminal", "shell", "bash"]);

function toToolCall(t: ToolFormerData): ToolCall {
  const name = sanitizeText(toolName(t));
  return {
    name,
    input: parseArgs(t.rawArgs),
    output: typeof t.result === "string" ? t.result : undefined,
    status: t.status === "error" ? "error" : "ok",
    ...(CURSOR_SHELL_TOOLS.has(name) ? { shell: true } : {}),
  };
}

/** Session-level totals only — Cursor has no per-turn usage breakdown and no cache stats. */
function mapTokens(tc: ComposerData["tokenCount"]) {
  if (tc && typeof tc === "object" && !Array.isArray(tc)) {
    const input = Number.isSafeInteger(tc.inputTokens) && (tc.inputTokens ?? 0) >= 0 ? tc.inputTokens! : 0;
    const output = Number.isSafeInteger(tc.outputTokens) && (tc.outputTokens ?? 0) >= 0 ? tc.outputTokens! : 0;
    return { input, output, cacheRead: 0, cacheCreation: 0, total: input + output };
  }
  return emptyUsage();
}

function summaryOf(c: ComposerData, id: string): SessionSummary {
  const headers = Array.isArray(c.fullConversationHeadersOnly) ? c.fullConversationHeadersOnly : [];
  const startedAt = typeof c.createdAt === "number" && Number.isFinite(c.createdAt) ? c.createdAt : undefined;
  const endedAt = typeof c.lastUpdatedAt === "number" && Number.isFinite(c.lastUpdatedAt) ? c.lastUpdatedAt : startedAt;
  return {
    id,
    source: "cursor",
    title: typeof c.name === "string" && c.name ? truncate(c.name) : undefined,
    startedAt,
    endedAt,
    totals: {
      tokens: mapTokens(c.tokenCount),
      durationMs: startedAt !== undefined && endedAt !== undefined
        ? Math.max(0, endedAt - startedAt) : undefined,
      // headers carry role via `type`; 1 = user, anything else = assistant-ish.
      turnCount: headers.filter((h) => h && typeof h === "object" && h.type !== 1).length,
      toolCallCount: 0, // requires loading bubble bodies — not known at list time
    },
    filePath: dbPath(),
    unpriceable: true,
  };
}

export class CursorAdapter implements SessionAdapter {
  readonly adapterVersion = "1";
  readonly id: AgentSource = "cursor";
  readonly label = "Cursor";

  roots(): string[] {
    return [dbPath()];
  }

  async detect(): Promise<boolean> {
    if (!(await pathExists(dbPath()))) {
      return false;
    }
    const db = await openReadOnly(dbPath());
    if (!db) {
      return false;
    }
    db.close();
    return true;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const db = await openReadOnly(dbPath());
    if (!db) {
      return [];
    }
    try {
      const rows = db.all("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'");
      const out: SessionSummary[] = [];
      for (const r of rows) {
        const key = String(r.key ?? "");
        const id = key.slice("composerData:".length);
        const c = parseJson<ComposerData>(r.value);
        // A draft has no conversation. Validate header contents only on full load.
        const hasHeaders = plainObject(c) && Array.isArray(c.fullConversationHeadersOnly)
          && c.fullConversationHeadersOnly.length > 0;
        const hasBubbles = plainObject(c) && ID_RE.test(id) && !hasHeaders && db.all(
          `SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:${id}:%' LIMIT 1`,
        ).length > 0;
        if (plainObject(c) && id && (hasHeaders || hasBubbles)) {
          out.push(summaryOf(c as ComposerData, id));
        }
      }
      return out;
    } finally {
      db.close();
    }
  }

  async loadSession(id: string): Promise<Session | null> {
    if (!ID_RE.test(id)) {
      return null;
    }
    const db = await openReadOnly(dbPath());
    if (!db) {
      return null;
    }
    try {
      const head = db.all(`SELECT value FROM cursorDiskKV WHERE key = 'composerData:${id}'`);
      const composer = parseJson<ComposerData>(head[0]?.value);
      if (!plainObject(composer)) {
        return null;
      }
      const order = Array.isArray(composer.fullConversationHeadersOnly) ? composer.fullConversationHeadersOnly : [];
      const referencedBubbleIds = new Set(order
        .filter((h) => h && typeof h === "object" && !Array.isArray(h) && typeof h.bubbleId === "string")
        .map((h) => h.bubbleId));
      const bubbleRows = db.all(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${id}:%'`);
      if (order.length === 0 && bubbleRows.length === 0) return null;
      const byId = new Map<string, Bubble>();
      let malformedRecord = !Array.isArray(composer.fullConversationHeadersOnly);
      for (const r of bubbleRows) {
        const key = String(r.key ?? "");
        const bid = key.split(":")[2];
        const b = parseJson<Bubble>(r.value);
        if (plainObject(b) && bid) {
          byId.set(bid, b);
        } else if (!bid || !referencedBubbleIds.has(bid)) {
          malformedRecord = true;
        }
      }

      if (!validFields(composer, composerFields)) malformedRecord = true;
      if (composer.tokenCount && typeof composer.tokenCount === "object" &&
        [(composer.tokenCount as { inputTokens?: unknown }).inputTokens, (composer.tokenCount as { outputTokens?: unknown }).outputTokens].some((value) => value !== undefined
          && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))) malformedRecord = true;
      const turns: Turn[] = [];
      let toolCallCount = 0;
      let missingBubble = false;
      let current: Turn | null = null;

      for (const h of order) {
        if (!validFields(h, { bubbleId: headerFields.bubbleId! })) {
          malformedRecord = true;
          continue;
        }
        if (!validFields(h, headerFields)) malformedRecord = true;
        const b = byId.get(h.bubbleId);
        if (!b) {
          missingBubble = true;
          continue;
        }
        if (!validFields(b, bubbleFields)) malformedRecord = true;
        const isUser = h.type === 1 || b.type === 1;
        if (isUser) {
          current = null; // a user bubble ends the prior assistant turn
          continue;
        }
        // Assistant bubble: start (or continue) a turn. No real per-bubble
        // timestamp exists in this data — `timestamp` stays undefined rather
        // than synthesizing one.
        if (!current) {
          current = { index: turns.length, toolCalls: [] };
          turns.push(current);
        }
        if (b.toolFormerData && validFields(b.toolFormerData, toolFormerFields)
          && (b.toolFormerData.tool || b.toolFormerData.name)) {
          current.toolCalls.push(toToolCall(b.toolFormerData));
          toolCallCount++;
        }
      }

      const base = summaryOf(composer, id);
      return { ...base, totals: { ...base.totals, turnCount: turns.length, toolCallCount }, turns,
        ...(missingBubble || malformedRecord ? { parseFailureShapes: [
          ...(missingBubble ? ["cursor:missing_bubble"] : []),
          ...(malformedRecord ? ["cursor:malformed_record"] : []),
        ] } : {}) };
    } finally {
      db.close();
    }
  }
}
