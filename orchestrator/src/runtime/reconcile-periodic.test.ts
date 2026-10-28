import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startPeriodicReconcile } from "./reconcile.js";

describe("周期 reconcile 调度器", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("按间隔触发,stop 后不再触发", async () => {
    let runs = 0;
    const stop = startPeriodicReconcile(async () => {
      runs++;
    }, 1000);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(3500);
    expect(runs).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(3);
  });

  it("上一轮未结束时跳过本轮(防重入),结束后恢复", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = startPeriodicReconcile(async () => {
      runs++;
      await gate;
    }, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(runs).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    stop();
  });

  it("run 拒绝被吞掉,后续照常触发", async () => {
    let runs = 0;
    const stop = startPeriodicReconcile(async () => {
      runs++;
      throw new Error("boom");
    }, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(runs).toBe(2);
    stop();
  });
});