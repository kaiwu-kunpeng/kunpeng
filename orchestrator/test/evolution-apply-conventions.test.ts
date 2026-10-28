import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConventions } from "../src/evolution/apply-conventions.js";
import type { ProposedChange } from "../src/loop/self-evolution.js";

let dir: string;
let md: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-conv-"));
  md = join(dir, "conventions.md");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const change = (text: string): ProposedChange => ({ target: "conventions", text, source: "exp-1" });

test("新约定作为 bullet 追加到 md，文件内容包含新文本", async () => {
  await writeFile(md, "# 可调约定\n", "utf8");

  const res = await applyConventions(md, [change("PR 必须带验证证据 (C3)")]);

  expect(res.appended).toEqual(["PR 必须带验证证据 (C3)"]);
  expect(res.skipped).toEqual([]);

  const after = await readFile(md, "utf8");
  expect(after).toContain("- PR 必须带验证证据 (C3)");
  // 末尾恰好一个换行符。
  expect(after.endsWith("\n")).toBe(true);
  expect(after.endsWith("\n\n")).toBe(false);
});

test("重复 apply 幂等：第二次起全部 skipped、appended 为空、文件不再变化", async () => {
  await writeFile(md, "# 可调约定\n", "utf8");
  const changes = [change("约定甲"), change("约定乙")];

  const first = await applyConventions(md, changes);
  expect(first.appended).toEqual(["约定甲", "约定乙"]);
  expect(first.skipped).toEqual([]);
  const afterFirst = await readFile(md, "utf8");

  const second = await applyConventions(md, changes);
  expect(second.appended).toEqual([]);
  expect(second.skipped).toEqual(["约定甲", "约定乙"]);
  const afterSecond = await readFile(md, "utf8");

  expect(afterSecond).toBe(afterFirst);
});

test("skipped/appended 分流：已存在的进 skipped，新的进 appended，顺序与输入一致", async () => {
  await writeFile(md, "# 可调约定\n- 已存在的约定\n", "utf8");

  const res = await applyConventions(md, [
    change("已存在的约定"),
    change("全新约定 A"),
    change("全新约定 B"),
  ]);

  expect(res.skipped).toEqual(["已存在的约定"]);
  expect(res.appended).toEqual(["全新约定 A", "全新约定 B"]);

  const after = await readFile(md, "utf8");
  expect(after).toContain("- 全新约定 A");
  expect(after).toContain("- 全新约定 B");
});

test("空批次不报错且不改文件", async () => {
  await writeFile(md, "# 可调约定\n", "utf8");
  const res = await applyConventions(md, []);
  expect(res).toEqual({ appended: [], skipped: [] });
  expect(await readFile(md, "utf8")).toBe("# 可调约定\n");
});
