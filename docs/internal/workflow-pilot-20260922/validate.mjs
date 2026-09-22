import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const assignments = ["A-baseline", "A-targeted", "B-targeted", "B-baseline"];
const finiteNonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function validateOutcome(data) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.scope, "controlled-engineering-pilot");
  assert.match(data.protocolCommit, /^[0-9a-f]{40}$/);
  assert.equal(data.assignedAttempts, 4);
  assert.equal(data.savingsClaim, null, "This pilot cannot establish savings");
  assert.equal(data.attempts.length, 4);
  assert.deepEqual(data.attempts.map(row => row.attemptId), assignments);
  let accepted = 0;
  for (const [index, row] of data.attempts.entries()) {
    assert.equal(row.order, index + 1);
    assert.equal(row.task, row.attemptId.slice(0, 1));
    assert.equal(row.arm, row.attemptId.split("-")[1]);
    assert.match(row.snapshotSha256, /^[0-9a-f]{64}$/);
    assert.match(row.outputSha256, /^[0-9a-f]{64}$/);
    assert.ok(finiteNonnegative(row.elapsedSeconds));
    assert.ok(Number.isFinite(Date.parse(row.startedAt)));
    assert.ok(Number.isFinite(Date.parse(row.endedAt)));
    assert.ok(Date.parse(row.endedAt) >= Date.parse(row.startedAt));
    assert.equal(typeof row.timedOut, "boolean");
    assert.equal(typeof row.allowedFilesOnly, "boolean");
    assert.ok(Number.isInteger(row.processExit));
    assert.ok(Number.isInteger(row.checkExit));
    assert.equal(row.repairCount, 0, "No hidden-test repairs were assigned");
    assert.ok(integer(row.checks.passed));
    assert.equal(row.checks.total, row.task === "A" ? 10 : 11);
    assert.ok(row.checks.passed <= row.checks.total);
    assert.equal(row.checks.accepted, row.checks.passed === row.checks.total);
    assert.equal(row.checkExit === 0, row.checks.accepted);
    const expected = row.processExit === 0 && !row.timedOut && row.checkExit === 0 && row.allowedFilesOnly;
    assert.equal(row.accepted, expected, "Acceptance must follow the independent checks");
    accepted += Number(row.accepted);
    assert.equal(row.childCoverage, "unknown");
    assert.equal(row.children, null, "No complete ancestry evidence was captured");
    assert.equal(row.dollarSavings, null);
    assert.equal(row.costPerAcceptedTask, null);
    assert.ok(["unpriced", "partial", "full", "unknown"].includes(row.receiptCoverage));
    assert.ok(row.observedTokens === null || Object.values(row.observedTokens).every(integer));
    assert.ok(Array.isArray(row.modelIds) && row.modelIds.every(id => typeof id === "string"));
    if (row.observedTokens !== null) {
      const usage = row.observedTokens;
      for (const key of ["input", "output", "cacheRead", "cacheCreation", "total"]) assert.ok(integer(usage[key]));
      assert.equal(usage.total, usage.input + usage.output + usage.cacheRead + usage.cacheCreation);
    }
  }
  assert.equal(data.acceptedAttempts, accepted);
  assert.equal(data.attempts[0].snapshotSha256, data.attempts[1].snapshotSha256);
  assert.equal(data.attempts[2].snapshotSha256, data.attempts[3].snapshotSha256);
  return { assigned: 4, accepted, scope: data.scope, savingsClaim: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.parse(await readFile(process.argv[2], "utf8"));
  const summary = validateOutcome(data);
  const directory = dirname(resolve(process.argv[2]));
  for (const row of data.attempts) {
    assert.equal(row.outputArtifact, `results/${row.attemptId}.mjs`);
    assert.equal(row.acceptanceArtifact, `results/${row.attemptId}-acceptance.json`);
    const output = await readFile(resolve(directory, row.outputArtifact));
    const acceptance = await readFile(resolve(directory, row.acceptanceArtifact));
    assert.equal(createHash("sha256").update(output).digest("hex"), row.outputSha256);
    assert.equal(createHash("sha256").update(acceptance).digest("hex"), row.acceptanceEvidenceSha256);
    assert.deepEqual(JSON.parse(acceptance.toString()), row.checks);
  }
  console.log(JSON.stringify(summary));
}
