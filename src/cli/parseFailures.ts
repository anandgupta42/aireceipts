import { adapterFor } from "../parse/registry.js";
import type { Session } from "../parse/types.js";
import { recordParseFailure } from "../telemetry/index.js";
import type { CommandContext } from "./types.js";

const observed = new WeakMap<CommandContext, Set<string>>();
const ALLOWED: Record<Session["source"], readonly string[]> = {
  "claude-code": ["claude-code:malformed_jsonl", "claude-code:malformed_usage"],
  codex: ["codex:malformed_jsonl"],
  cursor: ["cursor:missing_bubble"],
  gemini: ["gemini:malformed_jsonl"],
  opencode: ["opencode:malformed_record"],
};

export function observeSession(ctx: CommandContext, session: Session): void {
  const shapes = observed.get(ctx) ?? new Set<string>();
  for (const shape of session.parseFailureShapes ?? []) {
    if (ALLOWED[session.source].includes(shape)) shapes.add(shape);
  }
  observed.set(ctx, shapes);
}

/** The sole parse-failure recording site. Only explicitly observed full loads reach it. */
export function recordObservedParseFailures(ctx: CommandContext): void {
  for (const shape of observed.get(ctx) ?? []) {
    const source = shape.slice(0, shape.indexOf(":")) as Session["source"];
    const adapter = adapterFor(source);
    if (adapter) recordParseFailure({ agentType: source, adapterVersion: adapter.adapterVersion, shape });
  }
}
