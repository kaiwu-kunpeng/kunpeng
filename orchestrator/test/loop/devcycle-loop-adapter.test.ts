import { describe, it, expect } from "vitest";
import { createDevCycleRunLoop, doneFailureReason } from "../../src/loop/devcycle-loop-adapter.js";
import type { KunpengEvent } from "../../src/sdk/events.js";
import type { DriverEvent } from "../../src/loop/workspace-driver.js";

async function collect(events: AsyncIterable<DriverEvent>): Promise<DriverEvent[]> {
  const out: DriverEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function loopEmitting(script: KunpengEvent[]) {
  return createDevCycleRunLoop({
    runDevCycle: async (_ws, _msg, onEvent) => { for (const e of script) onEvent(e); },
    onMerge: async () => {},
    onReject: async () => {},
  })("test-workspace", "test requirement");
}

describe("doneFailureReason", () => {
  it("常见终态映射为可读中文", () => {
    expect(doneFailureReason("rolled-back")).toContain("回滚");
    expect(doneFailureReason("stopped")).toContain("中止");
    expect(doneFailureReason("blocked")).toContain("阻塞");
    expect(doneFailureReason("weird")).toContain("weird");
    expect(doneFailureReason("")).toBeTruthy();
  });
});

describe("失败终态显式产生 error 帧（治静默）", () => {
  it("done=verified → done 帧，无 error", async () => {
    const handle = loopEmitting([{ type: "done", status: "verified" }]);
    const evs = await collect(handle.events);
    expect(evs.some((e) => e.type === "done")).toBe(true);
    expect(evs.some((e) => e.type === "error")).toBe(false);
  });

  it("done=rolled-back → error 帧（不再静默）", async () => {
    const handle = loopEmitting([{ type: "done", status: "rolled-back" }]);
    const evs = await collect(handle.events);
    expect(evs.some((e) => e.type === "done")).toBe(false);
    const err = evs.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect((err as { reason: string }).reason).toContain("回滚");
  });

  it("done=stopped → error 帧", async () => {
    const handle = loopEmitting([{ type: "done", status: "stopped" }]);
    const evs = await collect(handle.events);
    expect(evs.some((e) => e.type === "error")).toBe(true);
  });

  it("flow 失败 status 追加 error 帧，stage 帧仍在", async () => {
    const handle = loopEmitting([
      { type: "flow", flowId: "f", stage: "build", status: "running" },
      { type: "flow", flowId: "f", stage: "build", status: "rolled-back" },
      { type: "done", status: "rolled-back" },
    ]);
    const evs = await collect(handle.events);
    expect(evs.filter((e) => e.type === "stage").length).toBe(2);
    expect(evs.filter((e) => e.type === "error").length).toBeGreaterThanOrEqual(1);
  });
});