import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAgentsMd } from "../../src/compile/agents-md.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kp-cg-"));
  mkdirSync(join(root, "constitution"), { recursive: true });
  mkdirSync(join(root, "roster"), { recursive: true });
  writeFileSync(join(root, "constitution", "core.md"), "# CORE\n## C1 单写者\nx");
  writeFileSync(join(root, "constitution", "conventions.md"), "# CONVENTIONS\n- y");
  writeFileSync(join(root, "roster", "implementer.role.md"), "role: implementer");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("compiled AGENTS.md content includes the codegraph section", async () => {
  const out = join(root, "AGENTS.md");
  const res = await compileAgentsMd({ kunpengRoot: root, outFile: out });
  const txt = readFileSync(res.path, "utf8");
  expect(txt).toContain("单写者"); // 既有正文仍在
  expect(txt).toContain("codegraph_callers"); // 新增 codegraph 段
  expect(txt).toContain("kunpeng:codegraph:begin");
});