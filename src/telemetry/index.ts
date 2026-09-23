import type { AgentSource } from "../parse/types.js";
import { resolveTelemetryConfig } from "./config.js";
import {
  bucketCount,
  bucketDuration,
  bucketInstallAge,
  bucketOrdinal,
  classifyError,
  getCliVersion,
  isDevelopmentBuild,
  isCiEnv,
  isInPackage,
  toAgentTypeTelemetry,
  toCommandTelemetry,
  toOsTelemetry,
} from "./helpers.js";
import { ensureFirstRunNotice, FIRST_RUN_NOTICE } from "./notice.js";
import {
  type TelemetryState,
  ensureInstallId,
  installHashOf,
  readState,
  updateStateWithMeta,
} from "./state.js";
import { peekQueuedEvents, recordEvent, flushTelemetry } from "./sender.js";
import type { StatuslineTelemetryInfo } from "../cli/commands/statusline.js";
import { hashSignature } from "./signature.js";
import type {
  ExportFormatValue,
  ExportSurfaceValue,
  ExitClassValue,
  HookOperationValue,
  InstallIdSourceValue,
  InputModeValue,
  IntegrationValue,
  MilestoneValue,
  OutputModeValue,
  PrModeValue,
  PricedRowCoverageValue,
  PromptOutcomeValue,
  ReceiptSurfaceValue,
  ResultValue,
  StepResultValue,
  TemplateTelemetryValue,
} from "./schemas.js";

/**
 * Single public integration surface for SPEC-0002/SPEC-0043 telemetry.
 * This is the one file `src/cli/**` (surface-owned) should import from —
 * every other module under `src/telemetry/` is an internal implementation
 * detail. See `docs/telemetry.md` for the full field-by-field schema and
 * `AGENTS.md`/SPEC-0002/SPEC-0043 for the invariants this module upholds.
 */

export { flushTelemetry, ensureFirstRunNotice, FIRST_RUN_NOTICE, readState };
export type { TelemetryState };

export interface RunStartTelemetry {
  installHash: string;
  installIdSource: InstallIdSourceValue;
  runOrdinalBucket: "1" | "2-3" | "4-10" | "11-50" | ">50" | "unavailable";
  isCI: boolean;
}

let currentRunIdentity: Pick<RunStartTelemetry, "installHash" | "isCI"> | undefined;

/** Test-only: clears the per-process run identity so test order cannot leak it. */
export function __resetRunIdentityForTests(): void {
  currentRunIdentity = undefined;
}

export interface RecordCliRunInput extends RunStartTelemetry {
  command: string;
  agentType: AgentSource | undefined;
  durationMs: number;
  ok: boolean;
  /** Controlled non-zero classification only; thrown errors use `cli_error`. */
  exitClass?: ExitClassValue;
  /** SPEC-0042 R5 — set only for the handoff command; enum, never content. */
  handoffFormat?: "text" | "json";
}

/** Records one `cli_run` event (R2). Unknown command names drop the event rather than leaking raw argv text. */
export function recordCliRun(input: RecordCliRunInput): void {
  const commandClass = toCommandTelemetry(input.command);
  if (!commandClass) {
    return;
  }
  recordEvent({
    name: "cli_run",
    properties: {
      cliVersion: getCliVersion(),
      os: toOsTelemetry(),
      nodeMajor: Number(process.versions.node.split(".")[0]),
      commandClass,
      agentType: toAgentTypeTelemetry(input.agentType),
      durationBucket: bucketDuration(input.durationMs),
      ok: input.ok,
      isCI: input.isCI,
      installHash: input.installHash,
      installIdSource: input.installIdSource,
      runOrdinalBucket: input.runOrdinalBucket,
      ...(!input.ok && input.exitClass !== undefined ? { exitClass: input.exitClass } : {}),
      ...(input.handoffFormat !== undefined ? { handoffFormat: input.handoffFormat } : {}),
    },
  });
}

export interface RecordCliErrorInput {
  command: string;
  agentType: AgentSource | undefined;
  err: unknown;
}

/** Records one `cli_error` event (R2). Unknown command names drop the event rather than leaking raw argv text. */
export function recordCliError(input: RecordCliErrorInput): void {
  const command = toCommandTelemetry(input.command);
  if (!command) {
    return;
  }
  recordEvent({
    name: "cli_error",
    properties: {
      errorClass: classifyError(input.err),
      command,
      agentType: toAgentTypeTelemetry(input.agentType),
      inPackage: isInPackage(input.err),
    },
  });
}

export interface RecordParseFailureInput {
  agentType: AgentSource;
  adapterVersion: string;
  /** A content-free description of *where* parsing broke (e.g. `"claude-code:turn.usage.missing"`) — never a snippet of the transcript itself. Hashed before it ever reaches a payload. */
  shape: string;
}

/** Records one `parse_failure` event (R2). `shape` is hashed here — the raw string never leaves this function. */
export function recordParseFailure(input: RecordParseFailureInput): void {
  recordEvent({
    name: "parse_failure",
    properties: {
      agentType: input.agentType,
      adapterVersion: input.adapterVersion,
      signatureHash: hashSignature(input.shape),
    },
  });
}

export interface RecordReceiptGeneratedInput {
  surface: ReceiptSurfaceValue;
  agentType: AgentSource | undefined;
  multiAgent: boolean;
  outputMode: OutputModeValue;
  template: TemplateTelemetryValue;
  pricedRowCoverage: PricedRowCoverageValue;
  hasStuckLoopWaste: boolean;
  hasTrivialSpansWaste: boolean;
  hasContextThrashWaste: boolean;
  hasPriceDelta: boolean;
  /** SPEC-0061 R6 — subagent transcripts were folded into the rendered totals. */
  hasSubagents: boolean;
  /** SPEC-0067 R7 — the receipt rendered a pre-edit cost-share line. */
  hasPreEditShare: boolean;
  /** SPEC-0054 R8 — the render carried the opt-in `--details` section. */
  detailsView: boolean;
  turnCount: number;
  toolCallCount: number;
  receiptOrdinal?: number;
}

export function recordReceiptGenerated(input: RecordReceiptGeneratedInput): void {
  recordEvent({
    name: "receipt_generated",
    properties: {
      cliVersion: getCliVersion(),
      installHash: currentRunIdentity?.installHash ?? "unavailable",
      isCI: currentRunIdentity?.isCI ?? isCiEnv(),
      surface: input.surface,
      agentType: toAgentTypeTelemetry(input.agentType),
      multiAgent: input.multiAgent,
      outputMode: input.outputMode,
      template: input.template,
      pricedRowCoverage: input.pricedRowCoverage,
      hasStuckLoopWaste: input.hasStuckLoopWaste,
      hasTrivialSpansWaste: input.hasTrivialSpansWaste,
      hasContextThrashWaste: input.hasContextThrashWaste,
      hasPriceDelta: input.hasPriceDelta,
      hasSubagents: input.hasSubagents,
      hasPreEditShare: input.hasPreEditShare,
      detailsView: input.detailsView,
      turnCountBucket: bucketCount(input.turnCount),
      toolCallCountBucket: bucketCount(input.toolCallCount),
      receiptOrdinalBucket: bucketOrdinal(input.receiptOrdinal),
    },
  });
}

export interface RecordExportGeneratedInput {
  surface: ExportSurfaceValue;
  format: ExportFormatValue;
  wroteFile: boolean;
  result: ResultValue;
}

export function recordExportGenerated(input: RecordExportGeneratedInput): void {
  recordEvent({ name: "export_generated", properties: input });
}

export interface RecordPrFlowCompletedInput {
  mode: PrModeValue;
  artifactRequested: boolean;
  shareRequested: boolean;
  contributorCount: number;
  commentResult: StepResultValue;
  artifactResult: StepResultValue;
  shareResult: StepResultValue;
  /** SPEC-0059 R8. */
  handoffSectionIncluded: boolean;
  result: ResultValue;
}

export function recordPrFlowCompleted(input: RecordPrFlowCompletedInput): void {
  recordEvent({
    name: "pr_flow_completed",
    properties: {
      mode: input.mode,
      artifactRequested: input.artifactRequested,
      shareRequested: input.shareRequested,
      contributorCountBucket: bucketCount(input.contributorCount),
      commentResult: input.commentResult,
      artifactResult: input.artifactResult,
      shareResult: input.shareResult,
      handoffSectionIncluded: input.handoffSectionIncluded,
      result: input.result,
    },
  });
}

export interface RecordHookConfiguredInput {
  operation: HookOperationValue;
  promptOutcome: PromptOutcomeValue;
  result: ResultValue;
}

export function recordHookConfigured(input: RecordHookConfiguredInput): void {
  recordEvent({ name: "hook_configured", properties: input });
}

export interface RecordIntegrationSurfaceRenderedInput {
  integration: IntegrationValue;
  inputMode: InputModeValue;
  payloadValid: boolean;
  result: ResultValue;
  /** SPEC-0062 R5 — statusline only: an explicit `--format` was passed (boolean, never the format string). */
  customFormat?: boolean;
  /** SPEC-0075 R6 — boolean only; the raw `--cwd` path must never enter a telemetry payload. */
  scoped?: boolean;
  /** SPEC-0075 R6 — boolean only; config contents must never enter a telemetry payload. */
  configFile?: boolean;
}

export function recordIntegrationSurfaceRendered(input: RecordIntegrationSurfaceRenderedInput): void {
  recordEvent({ name: "integration_surface_rendered", properties: input });
}

function pollBucket(count: number): "1" | "2-10" | "11-50" | "51-200" | ">200" {
  if (count <= 1) return "1";
  if (count <= 10) return "2-10";
  if (count <= 50) return "11-50";
  if (count <= 200) return "51-200";
  return ">200";
}

function failedPollBucket(count: number): "0" | "1" | "2-10" | ">10" {
  if (count === 0) return "0";
  if (count === 1) return "1";
  return count <= 10 ? "2-10" : ">10";
}

/** One atomic local statusline update. Events are queued only after it succeeds. */
export async function noteStatuslinePoll(
  info?: StatuslineTelemetryInfo,
  err?: unknown,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<void> {
  if (!resolveTelemetryConfig(env).enabled) {
    await updateStateWithMeta((state) => { state.runCount += 1; });
    return;
  }
  const hour = new Date(now).toISOString().slice(0, 13);
  let completed: TelemetryState["statusline"];
  let newSurface = false;
  let newError = false;
  let firstRun = false;
  const errorClass = err === undefined ? undefined : classifyError(err);
  const surface = info === undefined ? undefined : JSON.stringify([info.inputMode, info.payloadValid, info.result, info.customFormat, info.scoped, info.configFile]);
  const result = await updateStateWithMeta((state) => {
    state.firstRunAt ??= isoDate(now);
    state.runCount += 1;
    ensureInstallId(state, true);
    if (!state.milestones.first_run) {
      state.milestones.first_run = true;
      firstRun = true;
    }
    if (state.statusline?.hour !== hour) {
      completed = state.statusline;
      state.statusline = { hour, pollCount: 0, failedPollCount: 0, surfaces: [], errorClasses: [] };
    }
    const current = state.statusline!;
    current.pollCount += 1;
    if (errorClass !== undefined) current.failedPollCount += 1;
    if (surface !== undefined && !current.surfaces.includes(surface)) {
      current.surfaces.push(surface);
      newSurface = true;
    }
    if (errorClass !== undefined && !current.errorClasses.includes(errorClass)) {
      current.errorClasses.push(errorClass);
      newError = true;
    }
  });
  if (!result) return;
  const identity = {
    cliVersion: getCliVersion(),
    installHash: result.state.installId ? installHashOf(result.state.installId) : "unavailable",
    isCI: isCiEnv(env),
  };
  if (firstRun && !result.recovered) recordActivationMilestone({ milestone: "first_run", command: "statusline", firstRunAt: result.state.firstRunAt, now });
  if (completed && completed.pollCount > 0) {
    const offset = Math.floor(now / 3_600_000) - Math.floor(Date.parse(`${completed.hour}:00:00.000Z`) / 3_600_000);
    recordEvent({ name: "statusline_heartbeat", properties: {
      ...identity,
      os: toOsTelemetry(),
      nodeMajor: Number(process.versions.node.split(".")[0]),
      runOrdinalBucket: result.recovered ? "unavailable" : bucketOrdinal(result.state.runCount),
      pollCountBucket: pollBucket(completed.pollCount),
      failedPollCountBucket: failedPollBucket(completed.failedPollCount),
      hourOffset: offset >= 1 && offset <= 24 ? String(offset) as (typeof import("./schemas.js").HOUR_OFFSET_VALUES)[number] : ">24",
    } });
  }
  if (newSurface && info) recordIntegrationSurfaceRendered({ integration: "statusline", ...info, ...identity });
  if (newError && err !== undefined) recordCliError({ command: "statusline", agentType: undefined, err });
}

export interface RecordActivationMilestoneInput {
  milestone: MilestoneValue;
  command: string;
  firstRunAt?: string;
  now?: number | Date;
}

export function recordActivationMilestone(input: RecordActivationMilestoneInput): void {
  const command = toCommandTelemetry(input.command);
  if (!command) {
    return;
  }
  recordEvent({
    name: "activation_milestone",
    properties: {
      milestone: input.milestone,
      command,
      installAgeBucket: bucketInstallAge(input.firstRunAt, input.now),
    },
  });
}

function isoDate(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Increments the local lifetime run counter and returns bounded fields for the eventual `cli_run` event. */
export async function noteRunStart(command: string, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<RunStartTelemetry> {
  const telemetryEnabled = resolveTelemetryConfig(env).enabled;
  let createdFirstRunMilestone = false;
  const result = await updateStateWithMeta((state) => {
    state.firstRunAt ??= isoDate(now);
    state.runCount += 1;
    ensureInstallId(state, telemetryEnabled);
    if (!state.milestones.first_run) {
      state.milestones.first_run = true;
      createdFirstRunMilestone = true;
    }
  });

  if (!result) {
    const run = {
      installHash: "unavailable",
      installIdSource: "unavailable",
      runOrdinalBucket: "unavailable",
      isCI: isCiEnv(env),
    } as const;
    currentRunIdentity = { installHash: run.installHash, isCI: run.isCI };
    return run;
  }

  if (createdFirstRunMilestone && !result.recovered) {
    recordActivationMilestone({ milestone: "first_run", command, firstRunAt: result.state.firstRunAt, now });
  }

  const installHash = telemetryEnabled && result.state.installId ? installHashOf(result.state.installId) : "unavailable";
  const run: RunStartTelemetry = {
    installHash,
    installIdSource: installHash === "unavailable" ? "unavailable" : result.installIdSource,
    runOrdinalBucket: result.recovered ? "unavailable" : bucketOrdinal(result.state.runCount),
    isCI: isCiEnv(env),
  };
  currentRunIdentity = { installHash: run.installHash, isCI: run.isCI };
  return run;
}

type ReceiptMilestone = "first_receipt" | "third_receipt" | "tenth_receipt";

function receiptMilestoneFor(count: number): ReceiptMilestone | undefined {
  if (count === 1) return "first_receipt";
  if (count === 3) return "third_receipt";
  if (count === 10) return "tenth_receipt";
  return undefined;
}

/** Increments the local receipt counter, records the receipt event, and fires once-only receipt milestones. */
export async function noteReceiptGenerated(
  input: Omit<RecordReceiptGeneratedInput, "receiptOrdinal">,
  command = input.surface,
  now: number = Date.now(),
): Promise<void> {
  let milestone: ReceiptMilestone | undefined;
  const result = await updateStateWithMeta((state) => {
    state.receiptCount += 1;
    const next = receiptMilestoneFor(state.receiptCount);
    if (next && !state.milestones[next]) {
      state.milestones[next] = true;
      milestone = next;
    }
  });

  recordReceiptGenerated({
    ...input,
    receiptOrdinal: result && !result.recovered ? result.state.receiptCount : undefined,
  });

  if (result && !result.recovered && milestone) {
    recordActivationMilestone({ milestone, command, firstRunAt: result.state.firstRunAt, now });
  }
}

export async function noteMilestone(milestone: MilestoneValue, command: string, now: number = Date.now()): Promise<void> {
  let shouldRecord = false;
  const result = await updateStateWithMeta((state) => {
    if (!state.milestones[milestone]) {
      state.milestones[milestone] = true;
      shouldRecord = true;
    }
  });
  if (result && shouldRecord) {
    recordActivationMilestone({ milestone, command, firstRunAt: result.state.firstRunAt, now });
  }
}

/**
 * Backs `--telemetry-show` (R5): returns exactly what the current run's
 * queue would send on the next `flushTelemetry()` call, without sending
 * it. Also reports whether telemetry is currently enabled, so a user can
 * tell "nothing queued yet" apart from "telemetry is off."
 */
export function showTelemetryPayload(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; events: readonly unknown[]; reason?: "development-build" } {
  const config = resolveTelemetryConfig(env);
  const telemetrySetting = env.AIRECEIPTS_TELEMETRY?.trim().toLowerCase();
  const killed = telemetrySetting === "off" || telemetrySetting === "0" || telemetrySetting === "false" || env.DO_NOT_TRACK === "1";
  return { enabled: config.enabled, events: peekQueuedEvents(),
    ...(!config.enabled && !killed && env.AIRECEIPTS_TELEMETRY_CONNECTION === undefined && isDevelopmentBuild()
      ? { reason: "development-build" as const } : {}) };
}
