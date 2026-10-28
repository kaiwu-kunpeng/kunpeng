import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qaVerdict, qaWithFixTask, type QaRunner } from "../../src/product/browser-qa.js";
import { listTasks } from "../../src/task/store.js";

const NOW = 1_800_000_000_000;

describe("qaVerdict", () => {
  it("健康页 ok", () => {
    const v = qaVerdict({ status: 200, bodyTextLength: 500, pageErrors: [], consoleErrors: [] });
    expect(v.ok).toBe(true);
  });
  it("空态页(正文短但有交互元素)不算空白——首航误报的修复", () => {
    const v = qaVerdict({ status: 200, bodyTextLength: 14, pageErrors: [], consoleErrors: [], interactiveCount: 3 });
    expect(v.ok).toBe(true);
    expect(v.problems).toHaveLength(0);
  });
  it("正文短且零交互元素才是真空白", () => {
    const v = qaVerdict({ status: 200, bodyTextLength: 3, pageErrors: [], consoleErrors: [], interactiveCount: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("空白");
  });
  it("非2xx/页面错误/控制台错误逐条点名", () => {
    const v = qaVerdict({ status: 500, bodyTextLength: 300, pageErrors: ["boom"], consoleErrors: ["bad"], interactiveCount: 5 });
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("500");
    expect(v.problems.join()).toContain("boom");
    expect(v.problems.join()).toContain("bad");
  });
});

describe("qaWithFixTask（注入 runner）", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-qa-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const failRunner: QaRunner = async () => ({
    verdictInput: { status: 200, bodyTextLength: 0, pageErrors: [], consoleErrors: ["ReferenceError: x"], interactiveCount: 0 },
  });
  const okRunner: QaRunner = async () => ({
    verdictInput: { status: 200, bodyTextLength: 300, pageErrors: [], consoleErrors: [], interactiveCount: 4 },
    screenshotPath: "shot.png",
  });

  it("失败自动落修复任务", async () => {
    const r = await qaWithFixTask(root, "demo", "http://localhost:1", NOW, { runQa: failRunner });
    expect(r.ok).toBe(false);
    expect(r.taskId).toBeTruthy();
    const tasks = await listTasks(root);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("fix");
  });
  it("通过则不建任务", async () => {
    const r = await qaWithFixTask(root, "demo", "http://localhost:1", NOW, { runQa: okRunner });
    expect(r.ok).toBe(true);
    expect(await listTasks(root)).toHaveLength(0);
  });
  it("重复跑同 id 不抛错", async () => {
    await qaWithFixTask(root, "demo", "http://x", NOW, { runQa: failRunner });
    await expect(qaWithFixTask(root, "demo", "http://x", NOW, { runQa: failRunner })).resolves.toMatchObject({ ok: false });
    expect(await listTasks(root)).toHaveLength(1);
  });
});