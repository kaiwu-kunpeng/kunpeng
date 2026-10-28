import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderOnboard } from "../src/project/onboard.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("renderOnboard substitutes {{name}} everywhere", () => {
  const out = renderOnboard("接管 {{name}}，仅 {{name}}", "演示站");
  expect(out).toBe("接管 演示站，仅 演示站");
});

test("onboard.tmpl.md exists with {{name}} and the key constraints", async () => {
  const tmpl = await readFile(join(repoRoot, "onboard.tmpl.md"), "utf8");
  expect(tmpl).toContain("{{name}}");
  expect(tmpl).toContain("不直接改代码");
  expect(tmpl).toContain("不合并主干");
  expect(tmpl).toContain("不对外发布");
});
