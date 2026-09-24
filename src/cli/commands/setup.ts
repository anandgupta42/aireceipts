import { buildSetupReport, setupReportToJson } from "../../setup/report.js";
import { renderSetupReport } from "../../setup/render.js";
import type { CommandContext, CommandDef } from "../types.js";
import { noSessionsMessage } from "../common/session.js";
import { loadObservedSession, observedChildRollupDeps } from "../loadedSession.js";
import { loadSession } from "../../parse/load.js";
import type { Session } from "../../parse/types.js";
import { setAgentType, sharedAgentType } from "../agentType.js";

async function run(ctx: CommandContext): Promise<number> {
  const loadedSessions: Session[] = [];
  const report = await buildSetupReport(ctx.now(), async (summary) => {
    const session = await loadObservedSession(ctx, () => loadSession(summary));
    if (session) {
      loadedSessions.push(session);
      setAgentType(ctx, sharedAgentType(loadedSessions));
    }
    return session;
  }, observedChildRollupDeps(ctx));
  setAgentType(ctx, sharedAgentType(loadedSessions));
  if (ctx.options.json) {
    ctx.stdout.write(`${JSON.stringify(setupReportToJson(report), null, 2)}\n`);
    return 0;
  }
  const noSessionText = report.status === "no_sessions" ? await noSessionsMessage() : undefined;
  ctx.stdout.write(`${renderSetupReport(report, noSessionText)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "setup",
  priority: 75,
  matches: (options) => options.positional[0] === "setup",
  run,
  help: {
    order: 15,
    lines: ["  aireceipts setup [--json]             first-run report and local integration next steps"],
  },
};
