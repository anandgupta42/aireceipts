# Verification fixture provenance

`verification-after-typecheck.jsonl` derives from a real Claude Code session
executed with Claude Fable 5.1 on 2026-09-22 in a disposable TypeScript project.
The agent read `src/value.ts`, executed the exact foreground command
`npx tsc --noEmit`, received its completed tool result, then used `Edit` to
clamp a function's negative inputs without running another check.

The six retained vendor records contain the three actual tool calls and their
linked results. Tool identifiers, timestamps, structured `is_error` outcomes,
model and usage records remain vendor evidence. Paths become `/workload/…`;
output/prose and unrelated environment records were removed. This is a sanitized
vendor-recorded replay, not a synthetic assertion that a check succeeded.

The built CLI was also run on the original capture locally. Its JSON identified
check turn 2 and edit turn 3, and its PNG was visually inspected. Resuming the
same real agent session to run a second exact typecheck with no further edits
removed the finding. Original transcript content stays outside the repository.
This controlled workload proves support for this shape, not natural-world
frequency or general verification coverage.
