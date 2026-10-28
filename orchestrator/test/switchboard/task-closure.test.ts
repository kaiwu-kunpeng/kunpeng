import { describe, it, expect } from "vitest";
import { deriveTask } from "../../src/switchboard/task.js";

function msg(over: Record<string, unknown>) {
  return { id: "m", from: "a", to: "b", topic: "t1", body: "x", ts: 1, read: false, kind: "msg", ...over };
}

describe("A2A 任务闭环", () => {
  it("receipt → completed", () => {
    const task = deriveTask("t1", [
      msg({ id: "t1", ts: 1 }),
      msg({ id: "m2", ts: 2 }),
      msg({ id: "m3", ts: 3, kind: "receipt", body: "done" }),
    ] as never);
    expect(task?.state).toBe("completed");
  });

  it("failure → failed,终态粘滞(后续 stop 不翻转)", () => {
    const task = deriveTask("t1", [
      msg({ id: "t1", ts: 1 }),
      msg({ id: "m2", ts: 2, kind: "failure" }),
      msg({ id: "m3", ts: 3, kind: "stop" }),
    ] as never);
    expect(task?.state).toBe("failed");
  });

  it("无终态信号仍 working/submitted", () => {
    expect(deriveTask("t1", [msg({ id: "t1", ts: 1 })] as never)?.state).toBe("submitted");
    expect(deriveTask("t1", [msg({ id: "t1", ts: 1 }), msg({ id: "m2", ts: 2 })] as never)?.state).toBe("working");
  });
});