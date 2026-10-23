import assert from "node:assert/strict";
import { jobStatusTransitions } from "../lib/operations-contract.ts";

const cases = [
  ["DRAFT", "PROPOSED"],
  ["PROPOSED", "APPROVED"],
  ["APPROVED", "PLANNED"],
  ["PLANNED", "ACTIVE"],
  ["ACTIVE", "COMPLETED"],
  ["BLOCKED", "ACTIVE"],
  ["COMPLETED", "CLOSED"],
];

for (const [current, expectedNext] of cases) {
  assert.equal(
    jobStatusTransitions(current)[0],
    expectedNext,
    `${current} must offer ${expectedNext} as the primary status transition`,
  );
}

assert.deepEqual(jobStatusTransitions("PROPOSED"), ["APPROVED", "DRAFT", "CANCELLED"]);
assert.deepEqual(jobStatusTransitions("CLOSED"), []);
assert.deepEqual(jobStatusTransitions("CANCELLED"), []);

console.log("PASS job status transition order");
