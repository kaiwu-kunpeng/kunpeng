import { describe, it, expect } from "vitest";
import { taskStatusFromFlow, taskFromFlow } from "../../src/task/from-flow.js";

describe("taskStatusFromFlow", () => {
  it("verified → delivered", () => {
    expect(taskStatusFromFlow({ status: "verified" })).toBe("delivered");
  });
  it("rolled-back → blocked", () => {
    expect(taskStatusFromFlow({ status: "rolled-back" })).toBe("blocked");
  });
  it("挂人工门 → needs-review", () => {
    expect(taskStatusFromFlow({ gate: "合并主干 (人工门#1)" })).toBe("needs-review");
  });
  it("verified 但挂人工门 → needs-review（门优先，否则待合并的流永远进不了待审桶）", () => {
    expect(taskStatusFromFlow({ status: "verified", gate: "合并主干 (人工门#1)" })).toBe("needs-review");
  });
  it("verify/audit 阶段 → verifying，其余执行阶段 → running", () => {
    expect(taskStatusFromFlow({ stage: "verify" })).toBe("verifying");
    expect(taskStatusFromFlow({ stage: "audit" })).toBe("verifying");
    expect(taskStatusFromFlow({ stage: "implement" })).toBe("running");
    expect(taskStatusFromFlow({ stage: "spec" })).toBe("running");
  });
  it("未知输入回退 draft", () => {
    expect(taskStatusFromFlow({})).toBe("draft");
  });
});

describe("taskFromFlow", () => {
  it("flowId 与需求首行进入任务", () => {
    const t = taskFromFlow({ flowId: "f-1", requirement: "第一行目标\n其余细节", status: "verified" });
    expect(t.id).toBe("f-1");
    expect(t.title).toContain("第一行目标");
    expect(t.status).toBe("delivered");
  });
  it("无需求时 title 回退 flowId", () => {
    expect(taskFromFlow({ flowId: "f-2" }).title).toContain("f-2");
  });
  it("updatedAt 原样透传（今日窗口的依据）", () => {
    expect(taskFromFlow({ flowId: "f-3", updatedAt: 1_800_000_000_000 }).updatedAt).toBe(1_800_000_000_000);
    expect(taskFromFlow({ flowId: "f-4" }).updatedAt).toBeUndefined();
  });
});