import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, listTasks, readTask } from "../../src/task/store.js";
import { TaskBoard } from "../../src/taskboard/store.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("审计修复T 坏档可观测(warn 不吞)", () => {
  it("task store:坏档 warn+跳过,好档照常;读不存在 id 不 warn", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-tw-"));
    const good = await createTask(root, { title: "t", type: "dev" });
    writeFileSync(join(root, ".kunpeng", "tasks", "bad.json"), "{corrupt", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tasks = await listTasks(root);
    expect(tasks.map((t) => t.id)).toEqual([good.id]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("任务档损坏") && String(c[0]).includes("bad.json"))).toBe(true);
    warn.mockClear();
    expect(await readTask(root, "missing-id")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("taskboard:坏 JSON warn 且按不存在;字段非法 warn;不存在 id 不 warn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-tbw-"));
    writeFileSync(join(dir, "1.json"), "{corrupt", "utf8");
    writeFileSync(join(dir, "2.json"), JSON.stringify({ id: "2", wrong: true }), "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const board = new TaskBoard(dir);
    expect((await board.list()).length).toBe(0);
    expect(await board.get("1")).toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("任务档损坏") && String(c[0]).includes("1"))).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("任务档字段非法") && String(c[0]).includes("2"))).toBe(true);
    warn.mockClear();
    expect(await board.get("7")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});