import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { attachPtyWebSocket, backpressureDecision } from "../../src/server/pty-endpoint.js";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

describe("backpressureDecision 纯判定", () => {
  test("未暂停且超高水位 → pause", () => {
    expect(backpressureDecision(200 * 1024, false)).toBe("pause");
  });
  test("已暂停且低于低水位 → resume", () => {
    expect(backpressureDecision(1 * 1024, true)).toBe("resume");
  });
  test("未暂停但在水位区间内 → none", () => {
    expect(backpressureDecision(64 * 1024, false)).toBe("none");
  });
  test("已暂停但仍高于低水位 → none（不过早恢复）", () => {
    expect(backpressureDecision(64 * 1024, true)).toBe("none");
  });
  test("未暂停且低 → none（无需动作）", () => {
    expect(backpressureDecision(1 * 1024, false)).toBe("none");
  });
  test("自定义水位线生效", () => {
    expect(backpressureDecision(50, false, 40, 10)).toBe("pause");
    expect(backpressureDecision(5, true, 40, 10)).toBe("resume");
  });
});

describe("attachPtyWebSocket 定时 reap", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function fakeFactory(): (o: PtySpawnOpts) => PtyHandle {
    return () => ({ write() {}, resize() {}, onData() {}, onExit() {}, kill() {} });
  }

  test("按 reapIntervalMs 周期调用 pool.reap，server close 后停止", () => {
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const server = { on: (ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; } } as unknown as import("node:http").Server;
    const pool = new PtySessionPool({ factory: fakeFactory() });
    const reapSpy = vi.spyOn(pool, "reap").mockReturnValue([]);

    const returned = attachPtyWebSocket(server, {
      stateDir: "/tmp/none",
      resolveCwd: async () => "/tmp",
      pool,
      reapIntervalMs: 1000,
    });
    expect(returned).toBe(pool);

    expect(reapSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3500);
    expect(reapSpy.mock.calls.length).toBe(3);

    // server close → 清掉计时器，不再 reap
    handlers["close"]?.();
    vi.advanceTimersByTime(5000);
    expect(reapSpy.mock.calls.length).toBe(3);
  });
});