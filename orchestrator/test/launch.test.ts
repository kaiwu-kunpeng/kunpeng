import { expect, test } from "vitest";
import { planArgs, runArgs } from "../src/server/launch.js";

test("runArgs builds kunpeng run argv and appends acceptance when present", () => {
  expect(runArgs("做X", "/repo")).toEqual(["run", "做X", "--repo", "/repo"]);
  expect(runArgs("做X", "/repo", "npm test")).toEqual(["run", "做X", "--repo", "/repo", "--accept", "npm test"]);
  expect(runArgs("做X", "/repo", "   ")).toEqual(["run", "做X", "--repo", "/repo"]);
});

test("runArgs rejects empty requirement", () => {
  expect(() => runArgs("", "/repo")).toThrow("requirement 不能为空");
  expect(() => runArgs("   ", "/repo")).toThrow("requirement 不能为空");
});

test("planArgs builds kunpeng plan argv", () => {
  expect(planArgs("/p/plan.md", "/repo")).toEqual(["plan", "/p/plan.md", "--repo", "/repo"]);
});

test("planArgs rejects empty plan path", () => {
  expect(() => planArgs("", "/repo")).toThrow("planPath 不能为空");
  expect(() => planArgs("   ", "/repo")).toThrow("planPath 不能为空");
});
