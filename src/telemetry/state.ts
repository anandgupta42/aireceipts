import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ERROR_CLASS_VALUES, INPUT_MODE_VALUES, RESULT_VALUES } from "./schemas.js";

export interface TelemetryState {
  schemaVersion: 1;
  installId?: string;
  firstRunAt?: string;
  runCount: number;
  receiptCount: number;
  milestones: Record<string, true>;
  statusline?: StatuslineState;
}

export interface StatuslineState {
  hour: string;
  pollCount: number;
  failedPollCount: number;
  surfaces: string[];
  errorClasses: string[];
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

function validSurface(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const tuple: unknown = JSON.parse(value);
    return Array.isArray(tuple) && tuple.length === 6 &&
      INPUT_MODE_VALUES.includes(tuple[0]) && typeof tuple[1] === "boolean" && RESULT_VALUES.includes(tuple[2]) &&
      tuple.slice(3).every((item: unknown) => typeof item === "boolean");
  } catch {
    return false;
  }
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
  const statusline = parsed.statusline;
  if (isRecord(statusline) && typeof statusline.hour === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(statusline.hour) &&
    !Number.isNaN(Date.parse(`${statusline.hour}:00:00.000Z`)) &&
    new Date(`${statusline.hour}:00:00.000Z`).toISOString().slice(0, 13) === statusline.hour &&
    Number.isSafeInteger(statusline.pollCount) && (statusline.pollCount as number) >= 0 &&
    Number.isSafeInteger(statusline.failedPollCount) && (statusline.failedPollCount as number) >= 0 &&
    (statusline.failedPollCount as number) <= (statusline.pollCount as number) &&
    Array.isArray(statusline.surfaces) && statusline.surfaces.every(validSurface) &&
    Array.isArray(statusline.errorClasses) && statusline.errorClasses.every((v: unknown) => ERROR_CLASS_VALUES.includes(v as typeof ERROR_CLASS_VALUES[number]))) {
    state.statusline = statusline as unknown as StatuslineState;
  }
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
      // pid + random suffix: two processes recovering in the same millisecond must
      // not overwrite each other's backup (the same shape writeState uses for tmp files).
      const stamp = new Date().toISOString().replace(/:/g, "");
      await rename(path, `${path}.corrupt-${stamp}.${process.pid}.${Math.random().toString(16).slice(2)}`);
      movedAside = true;
    } catch { /* Best effort: state still starts fresh. */ }
    return { state: freshState(), recovered: true, installIdSource: movedAside ? "recovered_after_corrupt" : "new" };
  }
  // A file written by a newer CLI (a pinned older hook can run beside a newer install)
  // is never salvaged or rewritten: that would downgrade it. The run reports its
  // identity as unavailable instead.
  if (isRecord(parsed) && typeof parsed.schemaVersion === "number" && parsed.schemaVersion > 1) {
    throw new Error(`unsupported state schemaVersion ${parsed.schemaVersion}`);
  }
  const result = parseState(parsed);
  return { ...result, installIdSource: result.state.installId ? "existing" : "new" };
}

/** Read-only view for local surfaces such as `stats`: an unreadable file reads as fresh, never as an error. */
export async function readState(homeOverride?: string): Promise<TelemetryState> {
  try {
    return (await readStateWithMeta(homeOverride)).state;
  } catch {
    return freshState();
  }
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
