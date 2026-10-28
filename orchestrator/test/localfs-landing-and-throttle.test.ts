import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";

import { buildChatPrompt } from "../src/server/workspace-endpoints.js";
import { createOpQueue, resolveNoListenerMs } from "../src/server/localfs/op-queue.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("契约 A · 写文件落点默认远程", () => {
  const prompt = buildChatPrompt([], "帮我写份方案", "act");

  test("提示词含【写文件落点】规则的全部要点", () => {
    expect(prompt).toContain("【写文件落点】");
    expect(prompt).toContain("默认写到用户授权的本地目录");
    expect(prompt).toContain("只有用户明确说要写到服务器");
    expect(prompt).toContain("落点不明确时必须停下来请用户指定");
    expect(prompt).toContain("不得默认落到服务器");
  });

  test("『要问』被限定在落点,不污染任务澄清", () => {
    expect(prompt).toContain("仅限写入落点");
  });

  test("既有自主性锚点未被删除(防回归)", () => {
    expect(prompt).toContain("选定目录=已确认");
    expect(prompt).toContain("不得再反问");
    expect(prompt).toContain("不要求用户口述");
  });
});

describe("契约 B · no-listener 宽限", () => {
  test("resolveNoListenerMs 按授权状态给宽限", () => {
    expect(resolveNoListenerMs(true)).toBe(65000);
    expect(resolveNoListenerMs(false)).toBe(8000);
  });

  test("已授权宽限必须越过 Chrome 60 秒密集节流周期", () => {
    expect(resolveNoListenerMs(true)).toBeGreaterThan(60000);
  });

  test("已授权:64 秒仍在等,65 秒后才报未在轮询", async () => {
    vi.useFakeTimers();
    const queue = createOpQueue({ hasAuthz: () => true });
    const seen: string[] = [];
    queue.enqueue("conv-authz", { kind: "list", path: "." }).catch((e: Error) => { seen.push(e.message); });
    await vi.advanceTimersByTimeAsync(64000);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("未在轮询");
  });

  test("未授权:仍在 8 秒快失败", async () => {
    vi.useFakeTimers();
    const queue = createOpQueue({ hasAuthz: () => false });
    const seen: string[] = [];
    queue.enqueue("conv-noauthz", { kind: "list", path: "." }).catch((e: Error) => { seen.push(e.message); });
    await vi.advanceTimersByTimeAsync(8500);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("未授权");
  });

  test("显式传入的 noListenerMs 仍然优先(既有调用方行为不变)", async () => {
    vi.useFakeTimers();
    const queue = createOpQueue({ hasAuthz: () => true });
    const seen: string[] = [];
    queue.enqueue("conv-explicit", { kind: "list", path: "." }, 120000, 20).catch((e: Error) => { seen.push(e.message); });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen.length).toBe(1);
  });

  test("hasAuthz 抛异常时按未授权处理", async () => {
    vi.useFakeTimers();
    const queue = createOpQueue({ hasAuthz: () => { throw new Error("boom"); } });
    const seen: string[] = [];
    queue.enqueue("conv-throw", { kind: "list", path: "." }).catch((e: Error) => { seen.push(e.message); });
    await vi.advanceTimersByTimeAsync(8500);
    expect(seen.length).toBe(1);
  });

  test("硬超时 120 秒未被改动(轮询已发生,压住 no-listener 分支)", async () => {
    vi.useFakeTimers();
    const queue = createOpQueue({ hasAuthz: () => true });
    const seen: string[] = [];
    queue.enqueue("conv-hard", { kind: "list", path: "." }).catch((e: Error) => { seen.push(e.message); });
    queue.markPolled("conv-hard");
    await vi.advanceTimersByTimeAsync(119000);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("120s");
  });
});

describe("接线证据", () => {
  test("workspace-endpoints 的 enqueue 调用不再硬编码宽限", () => {
    const src = readFileSync(new URL("../src/server/workspace-endpoints.ts", import.meta.url), "utf8");
    expect(src).toMatch(/queue\.enqueue\(/);
    expect(src).not.toMatch(/queue\.enqueue\([^)]*8_?000/);
  });
});