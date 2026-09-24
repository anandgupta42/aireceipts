import type { Session } from "../parse/types.js";
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
