import { expect, test } from "vitest";
import { runBuildRelease } from "../src/loop/build-release.js";

test("successful build command → released true", async () => {
  const r = await runBuildRelease(process.cwd(), "true", "v1");
  expect(r.released).toBe(true);
  expect(r.version).toBe("v1");
  expect(r.exitCode).toBe(0);
});

test("failed build command → released false with captured output", async () => {
  const r = await runBuildRelease(process.cwd(), "echo boom >&2; exit 3", "v2");
  expect(r.released).toBe(false);
  expect(r.exitCode).toBe(3);
  expect(r.output).toContain("boom");
});
