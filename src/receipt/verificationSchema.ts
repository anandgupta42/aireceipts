import { z } from "zod";

export const verificationEvidenceSchema = z.object({
  command: z.literal("npx tsc --noEmit"),
  outcome: z.enum(["tool-error", "edit-after-tool-success"]),
  checkTurnIndex: z.number().int().nonnegative(),
  editTurnIndex: z.number().int().nonnegative().nullable(),
  scope: z.literal("captured-parent-calls"),
}).strict();
