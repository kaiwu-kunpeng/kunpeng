import { describe, it, expect } from "vitest";
import {
  partsFromBody, bodyFromParts, isTerminal, nextState, deriveTask,
  type Part,
} from "../../src/switchboard/task.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";

const msg = (o: Partial<SwitchMessage> & Pick<SwitchMessage, "id" | "from">): SwitchMessage => ({
  to: "all", body: "", ts: 0, read: false, ...o,
});

describe("parts 与 body 桥接", () => {
  it("partsFromBody 把纯文本包成单个 text part", () => {
    expect(partsFromBody("hi")).toEqual([{ kind: "text", text: "hi" }]);
  });
  it("bodyFromParts 折回字符串:text 取文本、data 取 JSON、file 取 uri", () => {
    const parts: Part[] = [
      { kind: "text", text: "a" },
      { kind: "data", data: { x: 1 } },
      { kind: "file", uri: "file:///t.md" },
    ];
    expect(bodyFromParts(parts)).toBe('a\n{"x":1}\nfile:///t.md');
  });
});

describe("TaskState 终态守卫", () => {
  it("isTerminal 区分终态与活动态", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("working")).toBe(false);
    expect(isTerminal("submitted")).toBe(false);
  });
  it("nextState 正常转移", () => {
    expect(nextState("submitted", "start")).toBe("working");
    expect(nextState("working", "complete")).toBe("completed");
    expect(nextState("working", "cancel")).toBe("canceled");
    expect(nextState("working", "need-input")).toBe("input-required");
  });
  it("nextState 终态吸收:终态后任何事件都不再转移", () => {
    expect(nextState("completed", "cancel")).toBe("completed");
    expect(nextState("canceled", "start")).toBe("canceled");
    expect(nextState("failed", "complete")).toBe("failed");
  });
});

describe("deriveTask 折叠 append-only 消息成 Task", () => {
  it("未知 taskId 返回 null", () => {
    expect(deriveTask("nope", [msg({ id: "a", from: "main" })])).toBeNull();
  });
  it("仅开启消息 → submitted,history 长度1,createdBy=发起者", () => {
    const t = deriveTask("t1", [msg({ id: "t1", from: "main", body: "做个任务", ts: 100 })]);
    expect(t).not.toBeNull();
    expect(t!.status.state).toBe("submitted");
    expect(t!.history).toHaveLength(1);
    expect(t!.createdBy).toBe("main");
    expect(t!.history[0].parts).toEqual([{ kind: "text", text: "做个任务" }]);
    expect(t!.history[0].role).toBe("user");
  });
  it("有响应活动 → working,响应者 role=agent,history 按 ts 升序", () => {
    const t = deriveTask("t1", [
      msg({ id: "r1", from: "design-loop", topic: "t1", body: "在做", ts: 200 }),
      msg({ id: "t1", from: "main", body: "做个任务", ts: 100 }),
    ]);
    expect(t!.status.state).toBe("working");
    expect(t!.history.map((h) => h.id)).toEqual(["t1", "r1"]);
    expect(t!.history[1].role).toBe("agent");
    expect(t!.updatedAt).toBe(200);
  });
  it("线程内含 stop → canceled(覆盖 working)", () => {
    const t = deriveTask("t1", [
      msg({ id: "t1", from: "main", body: "做个任务", ts: 100 }),
      msg({ id: "s1", from: "main", topic: "t1", body: "停", ts: 300, kind: "stop" }),
    ]);
    expect(t!.status.state).toBe("canceled");
    expect(t!.history).toHaveLength(2);
  });
});
