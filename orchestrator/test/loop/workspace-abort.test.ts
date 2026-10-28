import { describe, it, expect } from "vitest";
import { createDevCycleRunLoop } from "../../src/loop/devcycle-loop-adapter.js";
import { WorkspaceDriver, type LoopHandle, type DriverEvent } from "../../src/loop/workspace-driver.js";

describe("adapter handle.abort → AbortSignal 触发", () => {
  it("handle.abort() 让传给 runDevCycle 的 signal aborted", async () => {
    let captured: AbortSignal | undefined;
    const runLoop = createDevCycleRunLoop({
      runDevCycle: async (_ws, _msg, _onEvent, _model, signal) => {
        captured = signal;
        await new Promise((r) => setTimeout(r, 50)); // 模拟运行中
      },
      onMerge: async () => {},
      onReject: async () => {},
    });
    const handle = runLoop("ws1", "干活");
    await new Promise((r) => setTimeout(r, 5));
    expect(captured).toBeDefined();
    expect(captured!.aborted).toBe(false);
    handle.abort?.();
    expect(captured!.aborted).toBe(true);
    // 收尾
    for await (const _ of handle.events) { /* drain */ void _; }
  });
});

describe("driver 并发隔离:第二次 say 中止前一个孤儿", () => {
  it("同 workspace 再次 say → 前一个 handle.abort 被调用", async () => {
    const aborts: string[] = [];
    function fakeHandle(tag: string): LoopHandle {
      async function* gen(): AsyncGenerator<DriverEvent> {
        yield* [] as DriverEvent[];
        await new Promise((r) => setTimeout(r, 30));
      }
      return { events: gen(), answerGate: () => {}, abort: () => aborts.push(tag) };
    }
    let n = 0;
    const driver = new WorkspaceDriver({
      runLoop: () => fakeHandle("h" + n++),
      transcript: { append() {}, get() { return []; } } as never,
    });
    const s1 = driver.say("wsX", "第一个");
    // 不消费 s1,直接再起一个
    const s2 = driver.say("wsX", "第二个");
    expect(aborts).toContain("h0"); // 第一个孤儿被中止
    // drain 两个流避免悬挂
    for await (const _ of s1) { void _; }
    for await (const _ of s2) { void _; }
  });
});
