import { expect, test } from "vitest";
import { isProcessAlive } from "../src/util/liveness.js";

test("detects the current process as alive", () => {
  expect(isProcessAlive(process.pid)).toBe(true);
});

test("treats impossible and invalid pids as dead", () => {
  expect(isProcessAlive(2_147_483_647)).toBe(false);
  expect(isProcessAlive(0)).toBe(false);
  expect(isProcessAlive(-1)).toBe(false);
});
