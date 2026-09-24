import type { Session } from "../parse/types.js";
import { loadById } from "../parse/load.js";
import type { SubagentRollupDeps } from "../receipt/subagents.js";
import type { CommandContext } from "./types.js";

/** Full-load boundary for CLI commands, including sessions preloaded by a builder. */
export async function loadObservedSession(
  ctx: CommandContext,
  load: () => Promise<Session | null>,
): Promise<Session | null> {
  const session = await load();
  if (session) observeLoadedSession(ctx, session);
  return session;
}

export function observeLoadedSession(ctx: CommandContext, session: Session): void {
  ctx.telemetry.observeSession?.(session);
}

/** Route every CLI child transcript through the same full-load observer as parents. */
export function observedChildRollupDeps(ctx: CommandContext): Pick<SubagentRollupDeps, "load"> {
  return { load: (childFilePath) => loadObservedSession(ctx, () => loadById("claude-code", childFilePath)) };
}
