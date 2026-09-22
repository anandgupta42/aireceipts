import type { VerificationEvidence } from "../analysis/verification.js";
import type { Block } from "./blocks.js";

/** Fable-authored SPEC-0085 design; one shared text/SVG/PNG presentation. */
export function verificationBlocks(evidence?: VerificationEvidence | null): Block[] {
  if (!evidence) return [];
  const result = evidence.outcome === "tool-error" ? "error" : "ok";
  return [
    { kind: "note", text: "VERIFICATION EVIDENCE", spaceBefore: true },
    { kind: "row", label: evidence.command, value: `tool result ${result} (turn ${evidence.checkTurnIndex + 1})` },
    ...(evidence.editTurnIndex === null ? [] : [{ kind: "row" as const, label: "TS edit after it", value: `turn ${evidence.editTurnIndex + 1}` }]),
    { kind: "note", text: "no later matching result recorded", muted: true },
    { kind: "note", text: "(recorded calls only; external checks unknown)", muted: true },
  ];
}
