import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface TelemetryState {
  schemaVersion: 1;
  installId?: string;
  firstRunAt?: string;
  runCount: number;
  receiptCount: number;
  milestones: Record<string, true>;
}

export interface StateUpdateResult {
  state: TelemetryState;
  recovered: boolean;
  installIdSource: "existing" | "new" | "recovered_after_corrupt";
}

function freshState(): TelemetryState {
  return { schemaVersion: 1, runCount: 0, receiptCount: 0, milestones: {} };
}

function statePath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(parsed: unknown): { state: TelemetryState; recovered: boolean } {
  const state = freshState();
  if (!isRecord(parsed)) return { state, recovered: true };
  let recovered = parsed.schemaVersion !== 1;
  for (const field of ["runCount", "receiptCount"] as const) {
    const value = parsed[field];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) state[field] = value;
    else recovered = true;
  }
  if (isRecord(parsed.milestones)) {
    for (const [key, value] of Object.entries(parsed.milestones)) {
      if (value === true) state.milestones[key] = true;
      else recovered = true;
    }
  } else recovered = true;
  // Only a v4-shaped UUID may persist as the install id: a corrupted or hand-edited
  // file could otherwise carry banned free text (a path, a hostname) into the salted
  // hash that goes on the wire (SPEC-0043 R6). Anything else is treated as absent.
  if (typeof parsed.installId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.installId)) {
    state.installId = parsed.installId;
  } else if (parsed.installId !== undefined) recovered = true;
  if (typeof parsed.firstRunAt === "string") {
    state.firstRunAt = parsed.firstRunAt;
  } else if (parsed.firstRunAt !== undefined) recovered = true;
  return { state, recovered };
}

async function readStateWithMeta(homeOverride?: string): Promise<StateUpdateResult> {
  const path = statePath(homeOverride);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: freshState(), recovered: false, installIdSource: "new" };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    let movedAside = false;
    try {
      await rename(path, `${path}.corrupt-${new Date().toISOString().replace(/:/g, "")}`);
      movedAside = true;
    } catch { /* Best effort: state still starts fresh. */ }
    return { state: freshState(), recovered: true, installIdSource: movedAside ? "recovered_after_corrupt" : "new" };
  }
  const result = parseState(parsed);
  return { ...result, installIdSource: result.state.installId ? "existing" : "new" };
}

export async function readState(homeOverride?: string): Promise<TelemetryState> {
  return (await readStateWithMeta(homeOverride)).state;
}

async function writeState(path: string, state: TelemetryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
}

/**
 * Lock-free read-mutate-write: concurrent CLI runs are last-write-wins (SPEC-0043
 * R7 — a lost increment or a rare double-fired milestone is acceptable; corruption
 * is not, which the atomic tmp+rename write below guarantees).
 */
export async function updateStateWithMeta(
  mutate: (state: TelemetryState) => void,
  homeOverride?: string,
): Promise<StateUpdateResult | undefined> {
  try {
    const read = await readStateWithMeta(homeOverride);
    const state = read.state;
    mutate(state);
    await writeState(statePath(homeOverride), state);
    return { state, recovered: read.recovered, installIdSource: read.installIdSource };
  } catch {
    return undefined;
  }
}

export async function updateState(mutate: (state: TelemetryState) => void, homeOverride?: string): Promise<TelemetryState | undefined> {
  return (await updateStateWithMeta(mutate, homeOverride))?.state;
}

export function ensureInstallId(state: TelemetryState, telemetryEnabled: boolean): string | undefined {
  if (!telemetryEnabled) {
    return undefined;
  }
  state.installId ??= randomUUID();
  return state.installId;
}

export function installHashOf(installId: string): string {
  return createHash("sha256").update(`aireceipts-install-v1:${installId}`).digest("hex");
}
