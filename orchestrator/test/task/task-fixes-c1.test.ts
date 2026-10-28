import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, readTask, transitionTask } from "../../src/task/store.js";

describe("任务修复C1", () => {
  it("路径穿越 id 被拒", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-task-c1-"));
    await expect(readTask(root, "../../etc/passwd")).rejects.toThrow();
    await expect(transitionTask(root, "../x", "in_progress" as never)).rejects.toThrow();
  });

  it("并发流转不丢合法更新", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-task-c1b-"));
    const task = await createTask(root, { title: "t", type: "dev" });
    const results = await Promise.allSettled([
      transitionTask(root, task.id, "ready"),
      transitionTask(root, task.id, "ready"),
    ]);
    const after = await readTask(root, task.id);
    expect(after?.status).toBe("ready");
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});