import { expect, test } from "vitest";
import { harnessLocks, fullHarnessCount } from "../../src/metrics/harness-locks.js";

test("verified plan flow engages all four locks", () => {
  const locks = harnessLocks({ planId: "plan-1", status: "verified", history: [{ stage: "implement" }, { stage: "verify" }] });
  expect(locks.worktree).toBe(true);
  expect(locks.specGate).toBe(true);
  expect(locks.humanReview).toBe(true);
  expect(locks.determinism).toBe(true);
  expect(locks.count).toBe(4);
});

test("bare chat flow (no plan, no verify) engages only determinism", () => {
  const locks = harnessLocks({ status: "running", history: [{ stage: "chat" }] });
  expect(locks.worktree).toBe(false);
  expect(locks.specGate).toBe(false);
  expect(locks.humanReview).toBe(false);
  expect(locks.determinism).toBe(true);
  expect(locks.count).toBe(1);
});

test("fullHarnessCount counts only flows with all four locks", () => {
  const flows = [
    { planId: "p1", status: "verified", history: [] },
    { planId: "p2", status: "running", history: [{ stage: "verify" }] },
    { status: "running", history: [] },
  ];
  expect(fullHarnessCount(flows)).toBe(2);
});