import { expect, test } from "vitest";
import { loopRunArgs } from "./launch.js";

test("loopRunArgs builds kunpeng loop run argv", () => {
  expect(loopRunArgs("acme-catalog", "/repo/x")).toEqual(["loop", "run", "--id", "acme-catalog", "--repo", "/repo/x"]);
});

test("loopRunArgs rejects empty loop id", () => {
  expect(() => loopRunArgs("  ", "/r")).toThrow("loopId 不能为空");
});
