import { describe, expect, test, vi } from "vitest";
import { createOpQueue } from "./op-queue.js";

describe("localfs op-queue 基础（回归锁）", () => {
  test("enqueue→take FIFO；resolve 解阻塞；conversation 隔离", async () => {
    const q = createOpQueue();
    const p = q.enqueue("c1", { kind: "read", path: "a" });
    q.enqueue("c1", { kind: "write", path: "b", content: "x" });
    expect(q.take("c2")).toBeNull();
    const first = q.take("c1")!;
    expect(first.kind).toBe("read");
    expect(q.take("c1")!.kind).toBe("write");
    expect(q.resolve(first.opId, { opId: first.opId, ok: true, data: "hi" })).toBe(true);
    await expect(p).resolves.toMatchObject({ ok: true, data: "hi" });
  });
});

describe("localfs op-queue fail-fast（无监听者）", () => {
  test("入队后无 poll、无 take → 8s 后以未授权文案 reject", async () => {
    vi.useFakeTimers();
    const q = createOpQueue();
    const p = q.enqueue("c1", { kind: "read", path: "a" }, 120_000, 8_000)
      .then(() => ({ ok: true }), (e: Error) => ({ ok: false, msg: e.message }));
    await vi.advanceTimersByTimeAsync(8_100);
    const r = (await p) as { ok: boolean; msg?: string };
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("未授权或需恢复");
    vi.useRealTimers();
  });

  test("入队后 markPolled（客户端在线）→ 8s 不 fail-fast，撑到 120s 真超时且文案含 120s", async () => {
    vi.useFakeTimers();
    const q = createOpQueue();
    const p = q.enqueue("c1", { kind: "read", path: "a" }, 120_000, 8_000)
      .then(() => ({ ok: true }), (e: Error) => ({ ok: false, msg: e.message }));
    q.markPolled("c1");
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(8_100);
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    const r = (await p) as { ok: boolean; msg?: string };
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("120s");
    vi.useRealTimers();
  });

  test("被 take 后不再 fail-fast，等 resolve", async () => {
    vi.useFakeTimers();
    const q = createOpQueue();
    const p = q.enqueue("c1", { kind: "read", path: "a" }, 120_000, 8_000);
    const op = q.take("c1")!;
    await vi.advanceTimersByTimeAsync(8_100);
    q.resolve(op.opId, { opId: op.opId, ok: true, data: "ok" });
    await expect(p).resolves.toMatchObject({ ok: true, data: "ok" });
    vi.useRealTimers();
  });

  test("入队前的旧 poll 不算数（lastPollAt<enqueuedAt 仍 fail-fast）", async () => {
    vi.useFakeTimers();
    const q = createOpQueue();
    q.markPolled("c1");
    await vi.advanceTimersByTimeAsync(9_000);
    const p = q.enqueue("c1", { kind: "read", path: "a" }, 120_000, 8_000)
      .then(() => ({ ok: true }), (e: Error) => ({ ok: false, msg: e.message }));
    await vi.advanceTimersByTimeAsync(8_100);
    const r = (await p) as { ok: boolean; msg?: string };
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("未授权或需恢复");
    vi.useRealTimers();
  });
});