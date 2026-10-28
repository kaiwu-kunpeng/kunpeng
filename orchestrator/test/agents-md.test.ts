import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAgentsMd } from "../src/compile/agents-md.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kp-c-"));
  mkdirSync(join(root, "constitution"), { recursive: true });
  mkdirSync(join(root, "roster"), { recursive: true });
  writeFileSync(join(root, "constitution", "core.md"), "# CORE\n## C1 单写者\n只有 implementer 改代码。");
  writeFileSync(join(root, "constitution", "conventions.md"), "# CONVENTIONS\n- 错误处理 fail-closed。");
  writeFileSync(join(root, "roster", "implementer.role.md"), "role: implementer\nwrites_code: true");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("compiles core + roster into AGENTS.md when none exists（不留指针）", async () => {
  const out = join(root, "AGENTS.md");
  const res = await compileAgentsMd({ kunpengRoot: root, outFile: out });
  expect(res.clobberAvoided).toBe(false);
  expect(res.path).toBe(out);
  expect(res.pointerEnsured).toBeFalsy();
  const txt = readFileSync(out, "utf8");
  expect(txt).toContain("单写者");
  expect(txt).toContain("可演进约定（来自 constitution/conventions.md）");
  expect(txt).toContain("错误处理 fail-closed");
  expect(txt).toContain("implementer");
  expect(txt).not.toContain("KUNPENG-POINTER");
});

test("避让别人的 AGENTS.md：写 .kunpeng/AGENTS.kunpeng.md + 原文件追加必读指针", async () => {
  const out = join(root, "AGENTS.md");
  const original = "# 项目自己的 214 行规矩\n别动我";
  writeFileSync(out, original);
  const res = await compileAgentsMd({ kunpengRoot: root, outFile: out });
  expect(res.clobberAvoided).toBe(true);
  expect(res.path).toBe(join(root, ".kunpeng", "AGENTS.kunpeng.md"));
  expect(res.pointerEnsured).toBe(true);
  // 宪法落在 .kunpeng/AGENTS.kunpeng.md
  expect(readFileSync(res.path, "utf8")).toContain("单写者");
  // 原文件：原内容一字不动地保留 + 末尾多出指向 .kunpeng/AGENTS.kunpeng.md 的指针
  const after = readFileSync(out, "utf8");
  expect(after.startsWith(original)).toBe(true);
  expect(after).toContain("KUNPENG-POINTER:BEGIN");
  expect(after).toContain(".kunpeng/AGENTS.kunpeng.md");
});

test("指针追加幂等：避让分支重复编译，原 AGENTS.md 只含一个指针块", async () => {
  const out = join(root, "AGENTS.md");
  writeFileSync(out, "# 项目自己的规矩\n别动我");
  await compileAgentsMd({ kunpengRoot: root, outFile: out });
  const once = readFileSync(out, "utf8");
  await compileAgentsMd({ kunpengRoot: root, outFile: out });
  const twice = readFileSync(out, "utf8");
  expect(twice).toBe(once); // 第二次不再改原文件
  const occurrences = twice.split("KUNPENG-POINTER:BEGIN").length - 1;
  expect(occurrences).toBe(1);
});

test("re-compile 覆盖自己上次产出（自建仓幂等，不留指针）", async () => {
  const out = join(root, "AGENTS.md");
  await compileAgentsMd({ kunpengRoot: root, outFile: out });
  const res = await compileAgentsMd({ kunpengRoot: root, outFile: out });
  expect(res.clobberAvoided).toBe(false);
  expect(res.path).toBe(out);
  expect(res.pointerEnsured).toBeFalsy();
  expect(existsSync(join(root, ".kunpeng", "AGENTS.kunpeng.md"))).toBe(false);
  expect(readFileSync(out, "utf8")).not.toContain("KUNPENG-POINTER");
});
