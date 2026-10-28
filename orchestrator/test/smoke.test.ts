import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { version } from "../src/index.js";

test("module loads; version is sourced from package.json (single source, #3)", () => {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version: string };
  expect(version).toBe(pkg.version);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
