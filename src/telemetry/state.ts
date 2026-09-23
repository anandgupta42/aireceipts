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

function parseState(raw: string): TelemetryState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    return undefined;
  }
  const runCount = parsed.runCount;
  const receiptCount = parsed.receiptCount;
  const milestones = parsed.milestones;
  if (
    typeof runCount !== "number" ||
    !Number.isInteger(runCount) ||
    runCount < 0 ||
    typeof receiptCount !== "number" ||
    !Number.isInteger(receiptCount) ||
    receiptCount < 0 ||
    !isRecord(milestones)
  ) {
    return undefined;
  }
  const cleanMilestones: Record<string, true> = {};
  for (const [key, value] of Object.entries(milestones)) {
    if (value === true) {
      cleanMilestones[key] = true;
    }
  }
  const state: TelemetryState = { schemaVersion: 1, runCount, receiptCount, milestones: cleanMilestones };
  // Only a v4-shaped UUID may persist as the install id: a corrupted or hand-edited
  // file could otherwise carry banned free text (a path, a hostname) into the salted
  // hash that goes on the wire (SPEC-0043 R6). Anything else is treated as absent.
  if (typeof parsed.installId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.installId)) {
    state.installId = parsed.installId;
  }
  if (typeof parsed.firstRunAt === "string") {
    state.firstRunAt = parsed.firstRunAt;
  }
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
  return state;
}

async function readStateWithMeta(homeOverride?: string): Promise<{ state: TelemetryState; recovered: boolean }> {
  try {
    const raw = await readFile(statePath(homeOverride), "utf8");
    const parsed = parseState(raw);
    return parsed ? { state: parsed, recovered: false } : { state: freshState(), recovered: true };
  } catch {
    return { state: freshState(), recovered: false };
  }
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
    return { state, recovered: read.recovered };
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
