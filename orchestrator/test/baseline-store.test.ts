import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { baselineExists, baselinePath, captureBaseline } from "../src/design/baseline-store.js";
import { FakeCapturer } from "../src/design/screenshot.js";

function tempRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), "kunpeng-baseline-store-"));
}

test("baselinePath points at the design baseline png under .kunpeng", () => {
  const dir = tempRepoRoot();

  expect(baselinePath(dir, "starter")).toMatch(/\/\.kunpeng\/design-baselines\/starter\.png$/);
});

test("captureBaseline creates parent directories and makes the baseline exist", async () => {
  const dir = tempRepoRoot();
  const path = baselinePath(dir, "starter");

  expect(await baselineExists(dir, "starter")).toBe(false);
  expect(existsSync(join(dir, ".kunpeng", "design-baselines"))).toBe(false);

  const captured = await captureBaseline(dir, "starter", "<x/>", new FakeCapturer());

  expect(captured).toBe(path);
  expect(existsSync(path)).toBe(true);
  expect(await baselineExists(dir, "starter")).toBe(true);
});
