import assert from "node:assert/strict";
import test from "node:test";
import { validateOutcome } from "./validate.mjs";

function example() {
  return {
    schemaVersion: 1, scope: "controlled-engineering-pilot", protocolCommit: "a".repeat(40),
    assignedAttempts: 4, acceptedAttempts: 4, savingsClaim: null,
    attempts: ["A-baseline", "A-targeted", "B-targeted", "B-baseline"].map((attemptId, index) => ({
      attemptId, order: index + 1, task: attemptId[0], arm: attemptId.split("-")[1],
      snapshotSha256: "b".repeat(64), outputSha256: "c".repeat(64), elapsedSeconds: 1,
      startedAt: "2026-09-22T00:00:00Z", endedAt: "2026-09-22T00:00:01Z",
      timedOut: false, allowedFilesOnly: true, processExit: 0, checkExit: 0,
      repairCount: 0, checks: { passed: attemptId[0] === "A" ? 10 : 11, total: attemptId[0] === "A" ? 10 : 11, accepted: true },
      accepted: true, childCoverage: "unknown", children: null, dollarSavings: null,
      costPerAcceptedTask: null, receiptCoverage: "unpriced", observedTokens: null, modelIds: ["test-model"],
    })),
  };
}

test("complete unknown-price cohort validates without invented savings", () => {
  assert.deepEqual(validateOutcome(example()), { assigned: 4, accepted: 4, scope: "controlled-engineering-pilot", savingsClaim: null });
});

test("all failed assigned attempts remain valid with a zero acceptance count", () => {
  const data = example();
  data.acceptedAttempts = 0;
  for (const row of data.attempts) {
    row.checkExit = 1; row.checks.passed = 0; row.checks.accepted = false; row.accepted = false;
  }
  assert.equal(validateOutcome(data).assigned, 4);
});

for (const [name, mutate] of [
  ["missing attempt", data => data.attempts.pop()],
  ["duplicate attempt", data => data.attempts[1].attemptId = data.attempts[0].attemptId],
  ["false acceptance", data => data.attempts[0].checkExit = 1],
  ["invented savings", data => data.savingsClaim = 0.2],
  ["floor cost per accepted task", data => data.attempts[0].costPerAcceptedTask = 1],
  ["negative duration", data => data.attempts[0].elapsedSeconds = -1],
  ["nonfinite tokens", data => data.attempts[0].observedTokens = { input: Infinity }],
  ["contradictory token total", data => data.attempts[0].observedTokens = { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, total: 3 }],
  ["different paired snapshot", data => data.attempts[1].snapshotSha256 = "d".repeat(64)],
]) {
  test(`rejects ${name}`, () => { const data = example(); mutate(data); assert.throws(() => validateOutcome(data)); });
}
