import type { AgentSource } from "../parse/types.js";
import type { CommandContext } from "./types.js";

const agentTypes = new WeakMap<CommandContext, AgentSource>();

export function setAgentType(ctx: CommandContext, agentType: AgentSource | undefined): void {
  if (agentType) agentTypes.set(ctx, agentType);
  else agentTypes.delete(ctx);
}

export function agentTypeOf(ctx: CommandContext): AgentSource | undefined {
  return agentTypes.get(ctx);
}

export function sharedAgentType(items: readonly { source: AgentSource }[]): AgentSource | undefined {
  const source = items[0]?.source;
  return source && items.every((item) => item.source === source) ? source : undefined;
}
