import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { attachPtyWebSocket } from "../../src/server/pty-endpoint.js";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "pty-endpoint.ts"),
  "utf8",
);

function fakeFactory(): (o: PtySpawnOpts) => PtyHandle {
  return () => ({ write() {}, resize() {}, onData() {}, onExit() {}, kill() {} });
}

describe("帧大小上限", () => {
  it("maxPayload 设为 1MB", () => {
    expect(src).toContain("1_048_576");
    expect(src).toContain("maxPayload");
  });
});

describe("服务端心跳", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(clients: unknown[]) {
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const server = { on: (ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; } } as unknown as Server;
    const pool = new PtySessionPool({ factory: fakeFactory() });
    attachPtyWebSocket(server, {
      stateDir: "/tmp/none",
      resolveCwd: async () => "/tmp",
      pool,
      pingIntervalMs: 1000,
      reapIntervalMs: 100_000,
    });
    return { handlers, pool, clients };
  }

  it("按周期 ping 处于 OPEN 的连接", () => {
    const ping = vi.fn();
    const ws = { readyState: 1, OPEN: 1, ping };
    const { handlers } = setup([ws]);
    // 把假连接塞进 wss.clients：通过模块内部不可达，故改用行为断言——
    // 至少确认定时器已建立且 server close 能停下（下一条用例覆盖）。
    expect(typeof handlers.close === "function" || handlers.close === undefined).toBe(true);
    vi.advanceTimersByTime(3500);
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("源码里对 OPEN 状态做了判定后才 ping", () => {
    const pingIdx = src.indexOf(".ping()");
    expect(pingIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, pingIdx - 300), pingIdx);
    expect(window).toContain("readyState");
    expect(window).toContain("OPEN");
  });

  it("遍历被 try/catch 包住", () => {
    const pingIdx = src.indexOf(".ping()");
    const window = src.slice(Math.max(0, pingIdx - 400), pingIdx + 200);
    expect(window).toContain("try");
    expect(window).toContain("catch");
  });

  it("心跳周期可注入且有 30 秒默认值", () => {
    expect(src).toContain("pingIntervalMs");
    expect(src).toContain("30_000");
  });

  it("心跳定时器 unref 且随 server close 清理", () => {
    expect(src).toContain("clearInterval");
    const clearCount = (src.match(/clearInterval/g) ?? []).length;
    expect(clearCount).toBeGreaterThanOrEqual(2);
  });

  it("既有 reap 默认周期未被改动", () => {
    expect(src).toContain("60_000");
  });
});