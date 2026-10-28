import { expect, test } from "vitest";
import { makeFlowId } from "../src/cli.js";

test("makeFlowId is filesystem/branch safe", () => {
  const id = makeFlowId("Build a Login Page!", 1718000000000);
  expect(id).toMatch(/^[a-z0-9-]+$/);
  expect(id).toContain("build-a-login-page");
});
