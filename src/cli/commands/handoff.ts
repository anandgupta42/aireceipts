// SPEC-0018: `--handoff` — paste-ready block of detector-flagged patterns, plus
// standing-rule suggestions for pattern classes recurring across recent sessions. priority
// 40 (above the default receipt, below every subcommand), matches `--handoff`.
import { loadSession } from "../../index.js";
import type { Session } from "../../parse/types.js";
import { DEFAULT_HANDOFF_THRESHOLD, renderHandoff, standingRuleSuggestions, type HandoffCounts } from "../../receipt/handoff.js";
import { toHandoffJson } from "../../receipt/json.js";
import { buildFullSessionReceiptModel } from "../../receipt/subagents.js";
import { partitionWindows, windowBounds } from "../../aggregate/week.js";
import { aggregateWaste, type WasteClassAggregate } from "../../aggregate/waste.js";
import { listFullSessions } from "../../index.js";
import type { CommandContext, CommandDef } from "../types.js";
import { resolveSelector } from "../common/session.js";
import { setExitClass } from "../exitClass.js";
import { setAgentType, sharedAgentType } from "../agentType.js";
import { loadObservedSession, observedChildRollupDeps } from "../loadedSession.js";

/**
 * SPEC-0013 R1: aggregate waste across the trailing-7-day window (SPEC-0008's
 * window definition, reused so there's one notion of "recent"). Feeds the
 * distinct-session recurrence check for standing-rule suggestions. Re-exported
 * from `src/cli/index.js` for the existing handoff-recent test.
 */
export async function recentWasteAggregates(now: number = Date.now(), observe?: (session: Session) => void,
  load: typeof loadSession = loadSession): Promise<WasteClassAggregate[]> {
  const bounds = windowBounds(now);
  const summaries = await listFullSessions();
  const { current } = partitionWindows(summaries, bounds);
  const loaded = await Promise.all(current.map((s) => load(s)));
  for (const session of loaded) if (session) observe?.(session);
  return aggregateWaste(loaded.filter((s): s is Session => s !== null));
}

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const threshold = options.handoffThreshold ?? DEFAULT_HANDOFF_THRESHOLD;
  if (options.handoffThreshold !== undefined && (!Number.isInteger(threshold) || threshold < 1)) {
    ctx.stderr.write("invalid --handoff-threshold (expected a positive integer)\n");
    setExitClass(ctx, "invalid-arguments");
    return 1;
  }
  const resolved = await resolveSelector(options.positional[0], (summary) => loadObservedSession(ctx, () => loadSession(summary)));
  if ("error" in resolved) {
    ctx.stderr.write(`${resolved.error}\n`);
    setExitClass(ctx, "no-session-match");
    return 1;
  }
  const session = resolved.session ?? (await loadObservedSession(ctx, () => loadSession(resolved.summary)));
  if (!session) {
    ctx.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    setExitClass(ctx, "other-controlled");
    return 1;
  }
  const sources: Session[] = [session];
  setAgentType(ctx, sharedAgentType(sources));
  const model = await buildFullSessionReceiptModel(session, observedChildRollupDeps(ctx));
  // SPEC-0042 R1/R2 — counts come from the loaded Session; the render stays pure.
  const counts: HandoffCounts = {
    turns: session.turns.length,
    toolCalls: session.totals.toolCallCount,
    compactions: session.compactions?.length ?? 0,
  };
  const aggregates = await recentWasteAggregates(ctx.now(), (loaded) => {
    sources.push(loaded);
    setAgentType(ctx, sharedAgentType(sources));
  }, (summary) => loadObservedSession(ctx, () => loadSession(summary)));
  const suggestions = standingRuleSuggestions(aggregates, threshold);
  // SPEC-0042 R3 — the global `--json` flag is honored (it was previously
  // ignored here). JSON always emits the full structure, empty arrays included.
  if (options.json) {
    ctx.stdout.write(`${JSON.stringify(toHandoffJson(model, suggestions, threshold, counts, aggregates), null, 2)}\n`);
    return 0;
  }
  ctx.stdout.write(`${renderHandoff(model, suggestions, counts)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "handoff",
  priority: 40,
  matches: (options) => options.handoff,
  run,
  help: {
    order: 40,
    lines: [
      "  aireceipts --handoff [selector] [--handoff-threshold N] [--json]",
      "                                        paste-ready block of detector-flagged patterns;",
      "                                         suggests CLAUDE.md rules for detector classes",
      "                                         recurring in N+ recent sessions (default 3)",
    ],
  },
};
