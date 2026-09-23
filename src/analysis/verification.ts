import type { Session, ToolCall } from "../parse/types.js";

/** A captured command outcome, never proof of compiler/project correctness. */
export interface VerificationEvidence {
  command: "npx tsc --noEmit";
  outcome: "tool-error" | "edit-after-tool-success";
  checkTurnIndex: number;
  editTurnIndex: number | null;
  scope: "captured-parent-calls";
}

function timed(call: ToolCall): call is ToolCall & { startedAt: number; endedAt: number } {
  return typeof call.startedAt === "number" && Number.isFinite(call.startedAt)
    && typeof call.endedAt === "number" && Number.isFinite(call.endedAt)
    && call.endedAt >= call.startedAt;
}

function inputOf(call: ToolCall): Record<string, unknown> {
  return call.input !== null && typeof call.input === "object" && !Array.isArray(call.input)
    ? call.input as Record<string, unknown>
    : {};
}

function isCheck(call: ToolCall): boolean {
  const input = inputOf(call);
  return call.shell === true && call.name === "Bash"
    && typeof input.command === "string" && input.command.trim() === "npx tsc --noEmit"
    && (input.run_in_background === undefined || input.run_in_background === false);
}

function isTypedEdit(call: ToolCall): boolean {
  const input = inputOf(call);
  return (call.name === "Edit" || call.name === "Write") && call.status === "ok"
    && typeof input.file_path === "string" && /\.(?:ts|tsx|mts|cts)$/u.test(input.file_path);
}

/**
 * SPEC-0091: intentionally one literal foreground command and one adapter.
 * Output prose is never examined. All references address only captured calls.
 */
export function verificationEvidence(session: Session): VerificationEvidence | null {
  if (session.source !== "claude-code" || session.isSidechain || (session.droppedRecords ?? 0) > 0) {
    return null;
  }
  const calls = session.turns.flatMap(turn => turn.toolCalls.map(call => ({ call, turn: turn.index })));
  if (calls.some(({ call }) => call.status !== "ok" && call.status !== "error")) {
    return null;
  }
  const checks = calls.filter(({ call }) => isCheck(call));
  if (checks.length === 0 || checks.some(({ call }) => !timed(call))) {
    return null;
  }
  // Do not invent a total order for concurrent, reordered or ambiguous checks.
  for (let index = 1; index < checks.length; index++) {
    if (checks[index].call.startedAt! <= checks[index - 1].call.endedAt!) {
      return null;
    }
  }
  const last = checks[checks.length - 1];
  const common = {
    command: "npx tsc --noEmit" as const,
    checkTurnIndex: last.turn,
    scope: "captured-parent-calls" as const,
  };
  if (last.call.status === "error") {
    return { ...common, outcome: "tool-error", editTurnIndex: null };
  }
  const edits = calls.slice(calls.indexOf(last) + 1).filter(({ call, turn }) => turn > last.turn && isTypedEdit(call));
  // A missing edit timestamp prevents deciding which side of the check it falls on.
  if (edits.some(({ call }) => !timed(call) || call.startedAt <= last.call.endedAt!)) {
    return null;
  }
  const laterEdit = edits[0];
  return laterEdit
    ? { ...common, outcome: "edit-after-tool-success", editTurnIndex: laterEdit.turn }
    : null;
}
