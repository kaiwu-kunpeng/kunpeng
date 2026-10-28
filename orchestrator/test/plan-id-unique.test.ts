import { expect, test } from "vitest";
import { makePlanId } from "../src/plan/orchestrator.js";

test("makePlanId adds a random suffix even when now is identical", () => {
  const ids = Array.from({ length: 20 }, () => makePlanId(123));

  expect(new Set(ids).size).toBe(ids.length);
});

test("makePlanId keeps the base36 timestamp and six hex random digits", () => {
  const id = makePlanId(123);

  expect(id).toMatch(/^plan-[0-9a-z]+-[0-9a-f]{6}$/);
  expect(id.startsWith(`plan-${(123).toString(36)}-`)).toBe(true);
});
